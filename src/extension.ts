import * as vscode from 'vscode';
import { BrowserViewProvider } from './browserView';
import { getConfig } from './config';
import { CookieJar } from './cookie-jar';
import { FrameProxy } from './proxy';

export function activate(context: vscode.ExtensionContext): void {
	// Extension-host cookie jar (opt-in via browser.proxyCookieJar, default off).
	// Persisted in SecretStorage (OS-encrypted) so logins survive VS Code restarts.
	const PROXY_COOKIE_JAR_KEY = 'browser.proxyCookieJar';
	let saveCookiesTimer: NodeJS.Timeout | undefined;
	let jarDirty = false;
	const flushCookies = (): void => {
		if (!saveCookiesTimer) {
			return;
		}
		clearTimeout(saveCookiesTimer);
		saveCookiesTimer = undefined;
		const data = cookieJar.serialize();
		if (data === '{}') {
			void context.secrets.delete(PROXY_COOKIE_JAR_KEY);
		} else {
			void context.secrets.store(PROXY_COOKIE_JAR_KEY, data);
		}
	};
	const cookieJar = new CookieJar(() => {
		jarDirty = true;
		clearTimeout(saveCookiesTimer);
		saveCookiesTimer = setTimeout(flushCookies, 500);
	});
	void Promise.resolve(context.secrets.get(PROXY_COOKIE_JAR_KEY))
		.then((raw) => {
			if (raw) {
				cookieJar.load(raw, Date.now(), jarDirty);
			}
		})
		.catch(() => {});

	// Local proxy that strips frame-blocking headers (lazy: only runs while enabled).
	// Cert acceptance and cookie jar opt-in are read per request so settings apply without a restart.
	// The bound port is remembered in globalState and re-used on the next start so
	// the proxy origin (and the embedded pages' localStorage — e.g. opencode's
	// pairing token) stays stable across editor restarts; a taken port falls back
	// to a random one (second VS Code window, port grabbed meanwhile).
	const proxy = new FrameProxy(
		() => getConfig().acceptSelfSignedCerts,
		cookieJar,
		() => getConfig().proxyCookieJar
	);
	const PROXY_PORT_KEY = 'browser.proxyPort';
	context.subscriptions.push({
		dispose: () => {
			flushCookies();
			void proxy.dispose();
		},
	});

	// Register the browser webview view (bottom panel container, draggable to secondary sidebar).
	const provider = new BrowserViewProvider(context, proxy);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(BrowserViewProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: getConfig().retainContextWhenHidden },
		})
	);

	// Command: show the browser container (bottom panel) and focus the view.
	context.subscriptions.push(
		vscode.commands.registerCommand('browser.open', () => {
			void vscode.commands.executeCommand('workbench.view.extension.browser-container');
		}),
		vscode.commands.registerCommand('browser.clearProxiedLogins', async () => {
			clearTimeout(saveCookiesTimer);
			saveCookiesTimer = undefined;
			jarDirty = true;
			cookieJar.clear();
			await context.secrets.delete(PROXY_COOKIE_JAR_KEY);
			void vscode.window.showInformationMessage('Browser Panel: Proxied logins cleared.');
		})
	);

	// Start/stop the proxy when the setting toggles, then refresh the webview.
	// Serialized so concurrent config events can never interleave start/dispose
	// (which would leak servers and change the port -> endless rerouting).
	let proxyQueue: Promise<void> = Promise.resolve();
	// Guard against a hung start()/dispose() (e.g. dispose waiting on long-lived
	// connections): race a timeout so the serialized queue can never stall for
	// good. The underlying op keeps running; a late rejection is swallowed to
	// avoid an unhandled rejection after the race has settled.
	const PROXY_APPLY_TIMEOUT_MS = 5000;
	const applyProxyInner = async (): Promise<void> => {
		try {
			const enabled = getConfig().proxyEnabled;
			const op =
				enabled && !proxy.listening
					? proxy.start(context.globalState.get<number>(PROXY_PORT_KEY, 0))
					: !enabled && proxy.listening
						? proxy.dispose()
						: undefined;
			if (op) {
				op.catch(() => {});
				let timer: NodeJS.Timeout | undefined;
				try {
					await Promise.race([
						op,
						new Promise<never>((_, reject) => {
							timer = setTimeout(
								() => reject(new Error('start/dispose timed out after ' + PROXY_APPLY_TIMEOUT_MS + 'ms, continuing')),
								PROXY_APPLY_TIMEOUT_MS
							);
						}),
					]);
				} finally {
					clearTimeout(timer);
				}
			}
			// Persist whatever port actually got bound (preferred or fallback) so the
			// next start re-uses it. Only after a settled successful start: a hung
			// start must not clobber the remembered port.
			if (enabled && proxy.listening && proxy.port > 0) {
				await context.globalState.update(PROXY_PORT_KEY, proxy.port);
			}
		} catch (err) {
			void vscode.window.showWarningMessage(
				'Browser Panel: proxy error: ' + (err instanceof Error ? err.message : String(err))
			);
		} finally {
			// Always push the current state so the webview never keeps stale proxy URLs.
			provider.broadcastConfig();
		}
	};
	const applyProxy = (): void => {
		proxyQueue = proxyQueue.then(applyProxyInner, applyProxyInner);
	};
	applyProxy();

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('browser')) {
				if (e.affectsConfiguration('browser.proxyEnabled')) {
					void applyProxy();
				} else {
					provider.broadcastConfig();
				}
			}
		})
	);
}

export function deactivate(): void {
	// Nothing to clean up beyond disposables registered on the context.
}
