import * as vscode from 'vscode';
import { BrowserViewProvider } from './browserView';
import { getConfig } from './config';
import { FrameProxy } from './proxy';

export function activate(context: vscode.ExtensionContext): void {
	// Local proxy that strips frame-blocking headers (lazy: only runs while enabled).
	// Cert acceptance is read per request so the setting applies without a restart.
	const proxy = new FrameProxy(() => getConfig().acceptSelfSignedCerts);
	context.subscriptions.push({ dispose: () => void proxy.dispose() });

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
		})
	);

	// Start/stop the proxy when the setting toggles, then refresh the webview.
	// Serialized so concurrent config events can never interleave start/dispose
	// (which would leak servers and change the port -> endless rerouting).
	let proxyQueue: Promise<void> = Promise.resolve();
	const applyProxyInner = async (): Promise<void> => {
		try {
			const enabled = getConfig().proxyEnabled;
			if (enabled && !proxy.listening) {
				await proxy.start();
			} else if (!enabled && proxy.listening) {
				await proxy.dispose();
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
