import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { localize } from './i18n';
import { FrameProxy } from './proxy';

interface WebviewMessage {
	type:
		| 'getConfig'
		| 'navigate'
		| 'openDevtools'
		| 'openExternal'
		| 'openSettings'
		| 'historyQuickPick'
		| 'clearStorage'
		| 'checkUrl'
		| 'setClosed'
		| 'copyText';
	url?: string;
	closed?: boolean;
	text?: string;
}

interface UrlStatus {
	ok: boolean;
	error?: string;
	frameBlocked?: boolean;
}

interface HistoryEntry {
	url: string;
	timestamp: number;
}

interface HistoryPickItem extends vscode.QuickPickItem {
	url?: string;
	clearAll?: boolean;
	removeUrl?: string;
	removeTimestamp?: number;
}

const HISTORY_KEY = 'browser.history';
const LAST_URL_KEY = 'browser.lastUrl';
const CLOSED_KEY = 'browser.closed';
// Keep in sync with package.json — used for webview resource cache-busting.
const EXTENSION_VERSION = '0.4.2';

export class BrowserViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'browser.view';

	private _view?: vscode.WebviewView;
	// Listeners tied to the current webview view instance (disposed on re-resolve/dispose).
	private _viewDisposables: vscode.Disposable[] = [];
	// Set by any inbound webview message; the startup watchdog treats "no message
	// since resolve" as a stuck webview (see resolveWebviewView).
	private _webviewAlive = false;

	constructor(private readonly _context: vscode.ExtensionContext, private readonly _proxy: FrameProxy) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._viewDisposables.forEach((d) => d.dispose());
		this._viewDisposables = [];
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview')],
		};

		webviewView.webview.html = this._getHtml(webviewView.webview);
		this._viewDisposables.push(
			// Drop the stale reference so broadcastConfig()/show() never touch a disposed view.
			webviewView.onDidDispose(() => {
				if (this._view === webviewView) {
					this._view = undefined;
				}
			}),
			// _handleMessage is async: catch rejections (clipboard, commands, ...) so a
			// failure can never surface as an unhandled rejection in the extension host.
			webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
				this._webviewAlive = true;
				this._handleMessage(msg).catch((err) => {
					console.error('[browser-panel] failed to handle webview message:', err);
				});
			})
		);
		this._armStartupWatchdog(webviewView);
	}

	/**
	 * Startup watchdog against the intermittent blank panel: the webview's initial
	 * DOM is a blank viewport, and only a completed config exchange navigates it.
	 * If the webview's script never ran (VS Code webview load flake), its own
	 * getConfig retry can't help either — nothing will ever arrive. So after 10 s
	 * of webview silence, re-assign webview.html to force the document (and its
	 * script) to reload; capped at two attempts. Any inbound message marks the
	 * webview alive and disarms the timer. (A lost getConfig/reply is covered
	 * faster and invisibly by the webview's own retry — this layer is only for a
	 * webview that is not running at all.)
	 */
	private _armStartupWatchdog(webviewView: vscode.WebviewView): void {
		this._webviewAlive = false;
		let reloads = 0;
		const arm = (): void => {
			const timer = setTimeout(() => {
				if (this._view !== webviewView || this._webviewAlive) {
					return; // view replaced/disposed, or the webview is talking to us
				}
				if (reloads >= 2) {
					console.warn('[browser-panel] webview still silent after 2 forced reloads — giving up');
					return;
				}
				reloads++;
				console.warn('[browser-panel] webview silent since resolve — forcing a webview reload (attempt ' + reloads + ')');
				webviewView.webview.html = this._getHtml(webviewView.webview);
				arm(); // re-check: a reloaded webview that talks disarms, a dead one gets one more
			}, 10000);
			this._viewDisposables.push({ dispose: () => clearTimeout(timer) });
		};
		arm();
	}

	/** Push current settings to the webview (used on config change). */
	public broadcastConfig(): void {
		this._view?.webview.postMessage({ type: 'configChanged', config: getConfig(), proxy: this._proxyInfo() });
	}

	private _proxyInfo(): { enabled: boolean; baseUrl: string } {
		return {
			enabled: getConfig().proxyEnabled && this._proxy.listening,
			baseUrl: this._proxy.listening ? this._proxy.baseUrl : '',
		};
	}

	private _getHtml(webview: vscode.Webview): string {
		try {
			const webviewDir = vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview');
			// Version query busts the webview's resource cache: without it an
			// extension update could keep serving the previous app.js/index.html
			// (stale script + fresh host contract = broken/blank panel).
			const v = '?v=' + EXTENSION_VERSION;
			const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'app.js')).toString() + v;
			const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'styles.css')).toString() + v;

			const htmlPath = path.join(this._context.extensionPath, 'dist', 'webview', 'index.html');
			let html = fs.readFileSync(htmlPath, 'utf8');
			// CSP must use webview.cspSource (resources are served from the vscode-resource host,
			// not the webview's own origin, so 'self' alone would block scripts/styles).
			html = html.split('${cspSource}').join(webview.cspSource);
			html = html.split('${styleUri}').join(styleUri.toString());
			html = html.split('${scriptUri}').join(scriptUri.toString());
			return html;
		} catch (err) {
			// Missing/corrupt webview assets must not crash resolveWebviewView with an
			// internal error — degrade to a minimal explanation page instead.
			console.error('[browser-panel] failed to load webview html:', err);
			return (
				'<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2em">' +
				'<h2>Browser Panel</h2>' +
				'<p>Failed to load the webview UI (dist/webview). Please rebuild the extension ' +
				'(npm run build) and reload the window.</p>' +
				'</body></html>'
			);
		}
	}

	// ------------------------------------------------------------------ history
	private _getHistory(): HistoryEntry[] {
		const raw = this._context.workspaceState.get<unknown>(HISTORY_KEY, []);
		// Defensive parse: corrupt storage or an older format must not break the
		// history feature (TypeError in _addHistory / the picker) — filter bad entries.
		if (!Array.isArray(raw)) {
			return [];
		}
		return raw.filter(
			(h): h is HistoryEntry =>
				typeof h === 'object' &&
				h !== null &&
				typeof (h as HistoryEntry).url === 'string' &&
				typeof (h as HistoryEntry).timestamp === 'number' &&
				Number.isFinite((h as HistoryEntry).timestamp)
		);
	}

	private async _addHistory(url: string): Promise<void> {
		const limit = Math.max(1, getConfig().historyLimit);
		const history = this._getHistory();
		let next: HistoryEntry[];
		if (history.length > 0 && history[0].url === url) {
			// Dedupe consecutive entries: still refresh the timestamp and trim to the
			// limit (it may have shrunk since the entry was added).
			next = history.slice(0, limit);
			next[0] = { url, timestamp: Date.now() };
		} else {
			next = history.slice(0, limit - 1);
			next.unshift({ url, timestamp: Date.now() });
		}
		await Promise.all([
			this._context.workspaceState.update(LAST_URL_KEY, url),
			this._context.workspaceState.update(HISTORY_KEY, next),
		]);
	}

	private async _clearStorage(): Promise<void> {
		await this._context.workspaceState.update(HISTORY_KEY, []);
		await this._context.workspaceState.update(LAST_URL_KEY, undefined);
		this._view?.webview.postMessage({ type: 'storageCleared' });
	}

	/**
	 * Native history picker (same pattern as the official integrated browser's
	 * browserHistoryFeature.ts: createQuickPick + useSeparators + built-in filter).
	 */
	private async _showHistoryQuickPick(): Promise<void> {
		const history = this._getHistory();
		if (history.length === 0) {
			void vscode.window.showInformationMessage(
				localize('No browser history yet', '暂无浏览器历史记录', '尚無瀏覽器歷史紀錄')
			);
			return;
		}
		const picker = vscode.window.createQuickPick<HistoryPickItem>();
		picker.placeholder = localize('Filter browser history', '筛选浏览器历史', '篩選瀏覽器歷史');
		picker.matchOnDescription = true;

		const removeButton: vscode.QuickInputButton = {
			iconPath: new vscode.ThemeIcon('trash'),
			tooltip: localize('Remove entry', '删除该条目', '刪除該條目'),
		};

		const buildItems = (hist: HistoryEntry[]): HistoryPickItem[] => {
			const now = new Date();
			const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
			// Calendar-day arithmetic (not ms subtraction): on DST transition days
			// "yesterday" is 23 or 25 hours away, so startOfToday - 24h is wrong.
			const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
			const groups = [
				{ label: localize('Today', '今天', '今天'), entries: [] as HistoryEntry[] },
				{ label: localize('Yesterday', '昨天', '昨天'), entries: [] as HistoryEntry[] },
				{ label: localize('Earlier', '更早', '更早'), entries: [] as HistoryEntry[] },
			];
			for (const h of hist) {
				const target =
					h.timestamp >= startOfToday
						? groups[0]
						: h.timestamp >= startOfYesterday
							? groups[1]
							: groups[2];
				target.entries.push(h);
			}
			const items: HistoryPickItem[] = [
				{
					label: localize('Clear all history', '清除全部历史', '清除全部歷史'),
					alwaysShow: true,
					clearAll: true,
				} as HistoryPickItem,
			];
			for (const g of groups) {
				if (g.entries.length === 0) {
					continue;
				}
				items.push({ label: g.label, kind: vscode.QuickPickItemKind.Separator } as HistoryPickItem);
				for (const h of g.entries) {
					items.push({
						label: h.url,
						description: new Date(h.timestamp).toLocaleString(),
						url: h.url,
						removeUrl: h.url,
						removeTimestamp: h.timestamp,
						buttons: [removeButton],
					});
				}
			}
			return items;
		};

		picker.items = buildItems(history);

		picker.onDidAccept(() => {
			const sel = picker.selectedItems[0];
			picker.dispose();
			if (!sel) {
				return;
			}
			const target = sel as HistoryPickItem;
			if (target.clearAll) {
				// Same contract as the clearStorage message (also clears lastUrl and
				// notifies the webview); keep the picker open as before.
				void this._clearStorage();
				return;
			}
			if (target.url) {
				this._view?.webview.postMessage({ type: 'navigate', url: target.url });
			}
		});

		// Dispose when dismissed (Esc / click-away), not just on accept.
		picker.onDidHide(() => picker.dispose());

		picker.onDidTriggerItemButton(async (e) => {
			const target = e.item as HistoryPickItem;
			if (!target.removeUrl) {
				return;
			}
			const filtered = this._getHistory().filter(
				(h) => !(h.url === target.removeUrl && h.timestamp === target.removeTimestamp)
			);
			await this._context.workspaceState.update(HISTORY_KEY, filtered);
			picker.items = buildItems(filtered);
		});

		picker.show();
	}

	private async _handleMessage(msg: WebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'getConfig':
				this._view?.webview.postMessage({
					type: 'config',
					config: getConfig(),
					proxy: this._proxyInfo(),
					language: vscode.env.language,
					lastUrl: this._context.workspaceState.get<string>(LAST_URL_KEY, ''),
					closed: this._context.workspaceState.get<boolean>(CLOSED_KEY, false),
				});
				break;
			case 'navigate':
				if (msg.url) {
					await this._addHistory(msg.url);
				}
				break;
			case 'openDevtools':
				await this._openDevtools();
				break;
			case 'openExternal':
				// Only http/https: the relay is fed by embedded pages, so other schemes
				// (file:, vscode:, custom protocol handlers) must never reach openExternal.
				if (msg.url && /^https?:\/\//i.test(msg.url)) {
					void vscode.env.openExternal(vscode.Uri.parse(msg.url));
				}
				break;
			case 'copyText':
				if (typeof msg.text === 'string') {
					await vscode.env.clipboard.writeText(msg.text);
				}
				break;
			case 'openSettings':
				// Opens the settings page with the search box pre-filled for this extension.
				await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:artin.browser-panel');
				break;
			case 'historyQuickPick':
				await this._showHistoryQuickPick();
				break;
			case 'setClosed':
				// Persist the explicit closed state so a re-resolve / restart stays closed.
				await this._context.workspaceState.update(CLOSED_KEY, msg.closed === true);
				break;
			case 'clearStorage':
				await this._clearStorage();
				break;
			case 'checkUrl':
				if (msg.url) {
					const status = await this._checkUrl(msg.url);
					this._view?.webview.postMessage({ type: 'urlStatus', url: msg.url, ...status });
				}
				break;
		}
	}

	/**
	 * Parallel reachability probe: a plain HTTP(S) request from the extension host.
	 * Only the network result matters (CORS does not apply here). Any HTTP status
	 * counts as reachable; transport errors (refused/timeout/DNS) count as failures.
	 * Also detects frame-blocking headers (X-Frame-Options / CSP frame-ancestors)
	 * so the webview can show an error page instead of a blank frame. Follows up to
	 * 3 redirects. Uses node http/https (works on all supported VS Code engines).
	 */
	private _checkUrl(url: string): Promise<UrlStatus> {
		return this._request(url, 0);
	}

	private _request(url: string, depth: number): Promise<UrlStatus> {
		return new Promise((resolve) => {
			let u: URL;
			try {
				u = new URL(url);
			} catch {
				resolve({ ok: false, error: 'Invalid URL' });
				return;
			}
			if (u.protocol !== 'http:' && u.protocol !== 'https:') {
				resolve({ ok: false, error: 'Unsupported protocol: ' + u.protocol });
				return;
			}
			const lib = u.protocol === 'https:' ? https : http;
			let timer: NodeJS.Timeout | undefined;
			// Controlled by browser.acceptSelfSignedCerts (default on): the probe only
			// checks reachability; self-signed certs (typical for local https dev) must
			// not be misreported as unreachable. No credentials are sent (cookies
			// don't exist here).
			const req = lib.get(
				u,
				{ headers: { 'user-agent': 'browser-panel' }, rejectUnauthorized: !getConfig().acceptSelfSignedCerts },
				(res) => {
					if (timer) {
						clearTimeout(timer);
					}
					res.resume(); // discard the body, we only care about reachability
					// Body read can fail mid-stream (ECONNRESET etc.); without this
					// listener the error throws as an uncaught exception in the host.
					// Safe even after resolve() — a later resolve is a no-op.
					res.on('error', (err: Error) => {
						resolve({ ok: false, error: err.message });
					});
					const status = res.statusCode ?? 502;
					if (status >= 300 && status < 400 && res.headers.location && depth < 3) {
						try {
							const next = new URL(String(res.headers.location), u).href;
							resolve(this._request(next, depth + 1));
						} catch {
							resolve({ ok: true });
						}
						return;
					}
					// Frame-blocking detection (only when the proxy is actually serving —
					// it strips these headers; intent alone would misreport if start() failed).
					const frameBlocked =
						!(getConfig().proxyEnabled && this._proxy.listening) &&
						(!!res.headers['x-frame-options'] ||
							/frame-ancestors/i.test(String(res.headers['content-security-policy'] || '')));
					resolve({ ok: true, frameBlocked });
				}
			);
			timer = setTimeout(() => {
				req.destroy();
				resolve({ ok: false, error: 'ETIMEDOUT' });
			}, 8000);
			req.on('error', (err: Error) => {
				if (timer) {
					clearTimeout(timer);
				}
				resolve({ ok: false, error: err.message });
			});
		});
	}

	private async _openDevtools(): Promise<void> {
		const view = this._view;
		if (!view) {
			return;
		}
		// Make sure the view is visible and focused before opening webview devtools.
		view.show(true);
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			// Official OSS command: opens DevTools for the focused webview.
			await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
		} catch (err) {
			void vscode.window.showWarningMessage(
				localize(
					'Could not open DevTools for the browser view. Run "Developer: Toggle Developer Tools" from the Command Palette instead.',
					'无法打开浏览器视图的开发者工具。请改用命令面板中的“开发人员:切换开发人员工具”。',
					'無法開啟瀏覽器檢視的開發者工具。請改用命令面板中的「開發人員:切換開發人員工具」。'
				)
			);
		}
	}
}
