/* Browser Panel webview frontend (plain JS, bundled by esbuild). */
import { svgIcon } from './icons.js';

(function () {
	'use strict';

	const vscode = acquireVsCodeApi();

	const frame = document.getElementById('browser-frame');
	const urlInput = document.getElementById('url-input');
	const btnBack = document.getElementById('btn-back');
	const btnForward = document.getElementById('btn-forward');
	const btnReload = document.getElementById('btn-reload');
	const btnGo = document.getElementById('btn-go');
	const btnHome = document.getElementById('btn-home');
	const btnDevtools = document.getElementById('btn-devtools');
	const btnMenu = document.getElementById('btn-menu');
	const menuEl = document.getElementById('menu');
	const viewportWrap = document.getElementById('viewport-wrap');
	const viewportEl = document.getElementById('viewport');
	const resizeHandle = document.getElementById('resize-handle');
	const contentEl = document.getElementById('content');
	const emptyState = document.getElementById('empty-state');
	const emptyIcon = document.getElementById('empty-icon');
	const emptyMessage = document.getElementById('empty-message');
	const btnReopen = document.getElementById('btn-reopen');
	const progressEl = document.getElementById('progress');
	const errorState = document.getElementById('error-state');
	const errorTitleEl = document.getElementById('error-title');
	const errorDetailEl = document.getElementById('error-detail');
	const errorReconnectBlock = document.getElementById('error-reconnect-block');
	const errorReconnectEl = document.getElementById('error-reconnect');
	const btnErrorCancelReconnect = document.getElementById('btn-error-cancel-reconnect');
	const btnErrorExternal = document.getElementById('btn-error-external');
	const zoomLayer = document.getElementById('zoom-layer');

	const RECONNECT_INTERVAL_SEC = 5;

	/** @type {{ defaultUrl: string, retainContextWhenHidden: boolean, historyLimit: number }} */
	let config = { defaultUrl: 'http://localhost:80', retainContextWhenHidden: true, historyLimit: 200 };

	// ---------------------------------------------------------------------------
	// i18n (en / zh-CN / zh-TW)
	// ---------------------------------------------------------------------------
	const STRINGS = {
		en: {
			back: 'Back', forward: 'Forward', reload: 'Reload', go: 'Go', home: 'Home',
			devtools: 'Open DevTools', menu: 'More actions', frameTitle: 'Browser content',
			menuSettings: 'Settings', menuExternal: 'Open in external browser',
			menuZoomIn: 'Zoom in', menuZoomOut: 'Zoom out', menuZoomReset: 'Reset zoom',
			menuDevice: 'Device emulation', menuHistory: 'History', menuClearStorage: 'Clear storage',
			menuClose: 'Close browser', backShort: 'Back',
			deviceResponsive: 'Responsive', deviceCustom: 'Custom',
			deviceWidth: 'Width', deviceHeight: 'Height', deviceApply: 'Apply',
			emptyTitle: 'Browser closed', emptyReopen: 'Reopen',
			errorTitle: 'Cannot connect',
			invalidUrl: 'Invalid URL',
			embedTitle: 'Site cannot be embedded', embedDetail: 'The site blocks embedding (X-Frame-Options / CSP frame-ancestors). Use "Open in external browser" or enable the browser.proxyEnabled setting.',
			proxyAuthNote: 'The URL contains credentials (user:pass) that the proxy cannot forward; the site is loaded directly instead.',
			reconnectIn: 'Retrying in {n}s\u2026',
			cancelReconnect: 'Cancel auto-retry',
			devices: { 'iphone-se': 'iPhone SE (375\u00d7667)', 'iphone-14': 'iPhone 14 (390\u00d7844)', 'iphone-plus': 'iPhone Plus (414\u00d7896)', pixel: 'Pixel 7 (412\u00d7915)', ipad: 'iPad (768\u00d71024)', 'ipad-air': 'iPad Air (820\u00d71180)', 'surface-duo': 'Surface Duo (912\u00d71368)' },
		},
		'zh-cn': {
			back: '后退', forward: '前进', reload: '刷新', go: '前往', home: '主页',
			devtools: '打开开发者工具', menu: '更多操作', frameTitle: '浏览器内容',
			menuSettings: '设置', menuExternal: '在外部浏览器中打开',
			menuZoomIn: '放大', menuZoomOut: '缩小', menuZoomReset: '重置缩放',
			menuDevice: '设备仿真', menuHistory: '历史记录', menuClearStorage: '清除存储',
			menuClose: '关闭浏览器', backShort: '返回',
			deviceResponsive: '自适应', deviceCustom: '自定义',
			deviceWidth: '宽度', deviceHeight: '高度', deviceApply: '应用',
			emptyTitle: '浏览器已关闭', emptyReopen: '重新打开',
			errorTitle: '无法连接',
			invalidUrl: '无效网址',
			embedTitle: '网站无法内嵌', embedDetail: '该网站禁止内嵌（X-Frame-Options / CSP frame-ancestors）。请使用「在外部浏览器中打开」，或开启 browser.proxyEnabled 设置。',
			proxyAuthNote: '网址包含认证信息（user:pass），Proxy 无法转发，已改为直接连接加载。',
			reconnectIn: '{n} 秒后自动重试\u2026',
			cancelReconnect: '取消自动重试',
			devices: { 'iphone-se': 'iPhone SE (375\u00d7667)', 'iphone-14': 'iPhone 14 (390\u00d7844)', 'iphone-plus': 'iPhone Plus (414\u00d7896)', pixel: 'Pixel 7 (412\u00d7915)', ipad: 'iPad (768\u00d71024)', 'ipad-air': 'iPad Air (820\u00d71180)', 'surface-duo': 'Surface Duo (912\u00d71368)' },
		},
		'zh-tw': {
			back: '上一頁', forward: '下一頁', reload: '重新整理', go: '前往', home: '首頁',
			devtools: '開啟開發者工具', menu: '更多操作', frameTitle: '瀏覽器內容',
			menuSettings: '設定', menuExternal: '在外部瀏覽器開啟',
			menuZoomIn: '放大', menuZoomOut: '縮小', menuZoomReset: '重設縮放',
			menuDevice: '設備仿真', menuHistory: '歷史紀錄', menuClearStorage: '清除存儲',
			menuClose: '關閉瀏覽器', backShort: '返回',
			deviceResponsive: '響應式', deviceCustom: '自訂',
			deviceWidth: '寬度', deviceHeight: '高度', deviceApply: '套用',
			emptyTitle: '瀏覽器已關閉', emptyReopen: '重新開啟',
			errorTitle: '無法連線',
			invalidUrl: '無效網址',
			embedTitle: '網站無法內嵌', embedDetail: '該網站禁止內嵌（X-Frame-Options / CSP frame-ancestors）。請使用「在外部瀏覽器開啟」，或開啟 browser.proxyEnabled 設定。',
			proxyAuthNote: '網址包含認證資訊（user:pass），Proxy 無法轉發，已改為直接連線載入。',
			reconnectIn: '{n} 秒後自動重試\u2026',
			cancelReconnect: '取消自動重試',
			devices: { 'iphone-se': 'iPhone SE (375\u00d7667)', 'iphone-14': 'iPhone 14 (390\u00d7844)', 'iphone-plus': 'iPhone Plus (414\u00d7896)', pixel: 'Pixel 7 (412\u00d7915)', ipad: 'iPad (768\u00d71024)', 'ipad-air': 'iPad Air (820\u00d71180)', 'surface-duo': 'Surface Duo (912\u00d71368)' },
		},
	};

	let S = STRINGS.en;

	/** Shallow-merge a locale over en so missing keys never render as undefined. */
	function mergeStrings(locale) {
		return Object.assign({}, STRINGS.en, locale, {
			devices: Object.assign({}, STRINGS.en.devices, locale.devices),
		});
	}

	function pickStrings(lang) {
		const l = (lang || '').toLowerCase();
		if (l.startsWith('zh')) {
			// hk/mo use traditional Chinese too.
			return l.includes('tw') || l.includes('hant') || l.includes('hk') || l.includes('mo')
				? mergeStrings(STRINGS['zh-tw'])
				: mergeStrings(STRINGS['zh-cn']);
		}
		return mergeStrings(STRINGS.en);
	}

	// ---------------------------------------------------------------------------
	// Icon injection
	// ---------------------------------------------------------------------------
	function injectIcons() {
		document.querySelectorAll('[data-icon]').forEach((el) => {
			el.innerHTML = svgIcon(el.getAttribute('data-icon'));
		});
		emptyIcon.innerHTML = svgIcon('device-mobile', 40);
	}

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------
	// Navigation stacks hold URLs *other than* the current page.
	// (Cross-origin iframes: contentWindow.history is not accessible.)
	const nav = { back: [], forward: [], current: '' };
	let programmaticNav = false; // back/forward set this; in-iframe loads must not re-push
	let zoom = 1;
	const device = { preset: 'off', width: null, height: null }; // null = responsive (fill)
	let lastUrl = '';
	let closed = false;
	// Local frame-proxy state (host strips frame-blocking headers).
	let proxy = { enabled: false, baseUrl: '' };

	// Device presets (CSS pixel width x height; null = fill the container).
	const DEVICE_PRESETS = [
		{ id: 'off', width: null, height: null },
		{ id: 'iphone-se', width: 375, height: 667 },
		{ id: 'iphone-14', width: 390, height: 844 },
		{ id: 'iphone-plus', width: 414, height: 896 },
		{ id: 'pixel', width: 412, height: 915 },
		{ id: 'ipad', width: 768, height: 1024 },
		{ id: 'ipad-air', width: 820, height: 1180 },
		{ id: 'surface-duo', width: 912, height: 1368 },
	];

	// ---------------------------------------------------------------------------
	// Navigation
	// ---------------------------------------------------------------------------
	/**
	 * Normalize input to an absolute http(s) URL, or null if unsupported.
	 * Only http/https can be embedded (webview CSP: frame-src http: https:);
	 * parsing — instead of string tests — guarantees no other scheme
	 * (javascript:, file:, vscode:, …) ever reaches the iframe src, no matter
	 * which input path it came from (address bar, history, or postMessage).
	 */
	function normalizeUrl(raw) {
		if (typeof raw !== 'string') {
			return null;
		}
		const url = raw.trim();
		// Multi-line pastes ("http://a\nhttp://b") must never reach the URL parser:
		// they would concatenate into a garbage host and actually navigate. Only
		// line-breaking whitespace is rejected — plain spaces are left to the URL
		// parser, which percent-encodes them in the path ("a/my page" is a legal
		// paste) and throws for spaces in the host.
		if (!url || /[\n\r\t\f\v]/.test(url)) {
			return null;
		}
		try {
			const u = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : 'http://' + url);
			return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
		} catch {
			return null;
		}
	}

	function currentUrl() {
		return frame.getAttribute('src') || '';
	}

	function updateButtons() {
		btnBack.disabled = nav.back.length === 0;
		btnForward.disabled = nav.forward.length === 0;
	}

	function ensureOpen() {
		if (closed) {
			closed = false;
			viewportWrap.hidden = false;
			emptyState.hidden = true;
		}
	}

	// Bumped on every iframe src mutation so a pending force-reload callback can
	// detect that the frame state moved on (error page, close, …) and back off.
	let frameSrcSeq = 0;

	/** Translate a target URL into the proxy URL (identity when the proxy is off). */
	function toProxyUrl(u) {
		if (!proxy.enabled || !proxy.baseUrl) {
			return u;
		}
		try {
			const url = new URL(u);
			if (url.username) {
				// The proxy cannot carry URL credentials: fall back to a direct load
				// (warnProxyAuth tells the user).
				return u;
			}
			return proxy.baseUrl + url.protocol.slice(0, -1) + '/' + url.host + url.pathname + url.search + url.hash;
		} catch {
			return u;
		}
	}

	/** Translate a proxy URL back into the target URL (identity otherwise). */
	function fromProxyUrl(raw) {
		if (!proxy.enabled || !proxy.baseUrl || !raw.startsWith(proxy.baseUrl)) {
			return raw;
		}
		const rest = raw.slice(proxy.baseUrl.length);
		const schemeEnd = rest.indexOf('/');
		if (schemeEnd <= 0) {
			return raw;
		}
		const scheme = rest.slice(0, schemeEnd);
		const hostPath = rest.slice(schemeEnd + 1);
		const slash = hostPath.indexOf('/');
		const host = slash === -1 ? hostPath : hostPath.slice(0, slash);
		const path = slash === -1 ? '' : hostPath.slice(slash);
		return scheme + '://' + host + path;
	}

	function clearFrameSrc() {
		frameSrcSeq++;
		frame.removeAttribute('src');
	}

	/**
	 * Set the iframe src, forcing a real navigation when the value is unchanged:
	 * a same-value setAttribute is a no-op and its 'load' event never fires (the
	 * loading state would hang for the full 20s safety timeout). Cross-origin
	 * iframes cannot be reloaded via contentWindow.location.reload(), so drop src
	 * and restore it on the next frame instead.
	 */
	function setFrameSrc(src) {
		if (frame.getAttribute('src') === src) {
			const seq = ++frameSrcSeq;
			frame.removeAttribute('src');
			requestAnimationFrame(() => {
				// Skip when the frame moved on meanwhile (error page, close, reconnect).
				if (seq === frameSrcSeq) {
					frame.setAttribute('src', src);
				}
			});
			return;
		}
		frameSrcSeq++;
		frame.setAttribute('src', src);
	}

	/**
	 * Proxy mode cannot carry URL credentials (user:pass@host) — toProxyUrl falls
	 * back to a direct load. Surface that via the error panel as a transient
	 * notice: the iframe 'load' (direct render succeeded) dismisses it and a
	 * probe failure replaces it with the regular error page.
	 */
	function warnProxyAuth(u) {
		if (!proxy.enabled) {
			return;
		}
		let hasAuth = false;
		try {
			hasAuth = !!new URL(u).username;
		} catch { }
		if (hasAuth) {
			errorUrl = u;
			errorTitleEl.textContent = S.proxyAuthNote;
			errorDetailEl.textContent = u;
			errorState.hidden = false;
			errorReconnectBlock.classList.add('is-idle');
		}
	}

	function loadUrl(u) {
		setFrameSrc(toProxyUrl(u));
		nav.current = u;
		urlInput.value = u;
		warnProxyAuth(u);
	}

	// ---------------------------------------------------------------------------
	// Reachability check + connecting/error UI
	// (Chromium keeps the old page until a navigation settles; for unreachable
	// hosts the host does a parallel HTTP probe and we show our own error page.)
	// ---------------------------------------------------------------------------
	let pendingCheck = null; // { id, url }
	let checkSeq = 0;
	let connectingTimer = null;
	let loadTimer = null;
	let errorUrl = '';
	let reconnectUrl = '';
	let reconnectSecondsLeft = 0;
	let reconnectCountdownTimer = null;
	let reconnectArmed = false; // auto-retry scheduled (not cancelled)
	let reconnectAttemptPending = false; // a background retry navigation is in flight
	let configReceived = false; // startup config exchange completed

	function stopLoading() {
		btnReload.classList.remove('loading');
	}

	function showConnecting() {
		clearTimeout(connectingTimer);
		connectingTimer = setTimeout(() => {
			progressEl.hidden = false;
		}, 400);
	}

	function stopConnecting() {
		clearTimeout(connectingTimer);
		connectingTimer = null;
		progressEl.hidden = true;
	}

	function clearReconnect() {
		clearInterval(reconnectCountdownTimer);
		reconnectCountdownTimer = null;
		reconnectUrl = '';
		reconnectSecondsLeft = 0;
		reconnectArmed = false;
		reconnectAttemptPending = false;
		errorReconnectBlock.classList.add('is-idle');
		errorReconnectEl.textContent = '\u00a0';
	}

	function updateReconnectLabel() {
		errorReconnectEl.textContent = (S.reconnectIn || '').replace('{n}', String(reconnectSecondsLeft));
	}

	function startReconnect(url) {
		clearReconnect();
		reconnectUrl = url;
		reconnectArmed = true;
		errorReconnectBlock.classList.remove('is-idle');
		btnErrorCancelReconnect.textContent = S.cancelReconnect;
		reconnectSecondsLeft = RECONNECT_INTERVAL_SEC;
		updateReconnectLabel();
		reconnectCountdownTimer = setInterval(() => {
			if (!reconnectArmed) {
				return;
			}
			reconnectSecondsLeft -= 1;
			if (reconnectSecondsLeft <= 0) {
				// Retry in the background, then restart the countdown for the next round.
				reconnectSecondsLeft = RECONNECT_INTERVAL_SEC;
				updateReconnectLabel();
				attemptReconnect();
				return;
			}
			updateReconnectLabel();
		}, 1000);
	}

	/**
	 * Background retry for the auto-reconnect loop. Unlike a regular navigation
	 * it never reveals the viewport while the attempt is in flight — the blank
	 * iframe (white background) would flash otherwise. The iframe 'load' handler
	 * reveals the page only once it has actually rendered; a failed probe just
	 * re-enters showError() (already on screen) and rearms the countdown.
	 */
	function attemptReconnect() {
		const u = reconnectUrl;
		if (!u || closed || reconnectAttemptPending) {
			if (closed) {
				clearReconnect();
			}
			return;
		}
		reconnectAttemptPending = true;
		setFrameSrc(toProxyUrl(u));
		const id = ++checkSeq;
		pendingCheck = { id, url: u };
		vscode.postMessage({ type: 'checkUrl', url: u });
		clearTimeout(loadTimer);
		// Safety net: if the attempt neither loads nor gets a probe response,
		// allow the next scheduled retry to proceed.
		loadTimer = setTimeout(() => {
			reconnectAttemptPending = false;
		}, 20000);
	}

	function cancelReconnect() {
		clearReconnect();
	}

	function showError(url, detail, blocked) {
		// Re-normalize: the URL can be relayed from a message response.
		const u = normalizeUrl(url);
		if (u === null) {
			return;
		}
		stopConnecting();
		stopLoading();
		clearTimeout(loadTimer);
		clearReconnect();
		// A failed navigation must not leave programmaticNav set (it would eat the
		// next in-iframe navigation's back/forward bookkeeping).
		programmaticNav = false;
		clearFrameSrc(); // cancel the hanging iframe load
		errorUrl = u;
		errorTitleEl.textContent = blocked ? S.embedTitle : S.errorTitle;
		errorDetailEl.textContent = u + ' \u2014 ' + (blocked ? S.embedDetail : detail);
		errorState.hidden = false;
		viewportWrap.hidden = true;
		btnErrorExternal.hidden = false; // visible again for URL-backed errors
		// Auto-reconnect only for reachability failures (not frame-blocked sites).
		if (!blocked) {
			startReconnect(u);
		}
	}

	function hideError() {
		programmaticNav = false;
		clearReconnect();
		errorState.hidden = true;
		errorUrl = '';
		if (!closed) {
			viewportWrap.hidden = false;
		}
	}

	/** Shared navigation entry: load a URL, run the parallel reachability probe. */
	function startNavigation(u) {
		ensureOpen();
		hideError();
		loadUrl(u);
		updateButtons();
		btnReload.classList.add('loading');
		showConnecting();
		const id = ++checkSeq;
		pendingCheck = { id, url: u };
		vscode.postMessage({ type: 'checkUrl', url: u });
		vscode.postMessage({ type: 'setClosed', closed: false }); // opening clears the closed flag
		// Safety net: if the probe passed but the iframe never fires 'load' (some page
		// keeps a resource hanging — common with dev servers), just stop the connecting
		// bar. Never show an error page: the page may be rendering fine (false positive).
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => {
			if (pendingCheck && pendingCheck.url === u && !closed) {
				stopConnecting();
				stopLoading();
			}
		}, 20000);
	}

	function navigate(url, { record = true } = {}) {
		const u = normalizeUrl(url);
		if (!u) {
			// Callers that must react to a failure (startup config) check the return;
			// toolbar paths ignore it (the URL bar already holds what the user typed).
			return false;
		}
		if (nav.current && nav.current !== u) {
			nav.back.push(nav.current);
			nav.forward = [];
		}
		programmaticNav = false;
		startNavigation(u);
		if (record) {
			lastUrl = u;
			vscode.postMessage({ type: 'navigate', url: u });
		}
		return true;
	}

	function goBack() {
		// Peek first: only pop once the entry is usable (a dropped entry must
		// still refresh the button states).
		const u = normalizeUrl(nav.back[nav.back.length - 1]);
		if (u === null) {
			if (nav.back.length) {
				nav.back.pop();
				updateButtons();
			}
			return;
		}
		nav.back.pop();
		if (nav.current) {
			nav.forward.unshift(nav.current);
		}
		startNavigation(u);
		// Set after startNavigation: its hideError() clears the flag, and the load
		// event that consumes it always fires later.
		programmaticNav = true;
		lastUrl = u;
		vscode.postMessage({ type: 'navigate', url: u });
	}

	function goForward() {
		// Peek first: only shift once the entry is usable.
		const u = normalizeUrl(nav.forward[0]);
		if (u === null) {
			if (nav.forward.length) {
				nav.forward.shift();
				updateButtons();
			}
			return;
		}
		nav.forward.shift();
		if (nav.current) {
			nav.back.push(nav.current);
		}
		startNavigation(u);
		// Set after startNavigation (see goBack).
		programmaticNav = true;
		lastUrl = u;
		vscode.postMessage({ type: 'navigate', url: u });
	}

	function reload() {
		ensureOpen();
		// Re-normalize: errorUrl/lastUrl can hold values relayed via messages.
		const u = normalizeUrl(nav.current || fromProxyUrl(currentUrl()) || errorUrl || lastUrl);
		if (!u) {
			return;
		}
		hideError();
		// contentWindow.location is blocked cross-origin; re-setting src works everywhere.
		setFrameSrc(toProxyUrl(u));
		nav.current = u;
		urlInput.value = u;
		warnProxyAuth(u);
		btnReload.classList.add('loading');
		showConnecting();
		const id = ++checkSeq;
		pendingCheck = { id, url: u };
		vscode.postMessage({ type: 'checkUrl', url: u });
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => {
			if (pendingCheck && pendingCheck.url === u && !closed) {
				stopConnecting();
				stopLoading();
			}
		}, 20000);
	}

	// Track in-iframe navigations (link clicks / redirects) so back/forward work.
	// iframe does not fire `loadstart`; loading state is set at navigate/reload.
	frame.addEventListener('load', () => {
		const url = fromProxyUrl(currentUrl());
		if (!url) {
			return; // ignore about:blank loads (e.g. right after close)
		}
		clearTimeout(loadTimer);
		pendingCheck = null; // load settled; any in-flight probe response is stale
		stopConnecting();
		hideError();
		// Only programmatic back/forward update the stacks synchronously;
		// any other navigation moves the previous page into the back stack.
		if (!programmaticNav && nav.current && nav.current !== url) {
			nav.back.push(nav.current);
			nav.forward = [];
		}
		nav.current = url;
		programmaticNav = false;
		urlInput.value = url;
		updateButtons();
		btnReload.classList.remove('loading');
	});

	// ---------------------------------------------------------------------------
	// Zoom (transform-based zoom layer; reliable in Chromium webviews, unlike CSS
	// zoom on an iframe element). Shortcuts come from VS Code keybindings.
	// ---------------------------------------------------------------------------
	function applyZoom() {
		const z = zoom;
		zoomLayer.style.transform = 'scale(' + z + ')';
		zoomLayer.style.width = 100 / z + '%';
		zoomLayer.style.height = 100 / z + '%';
	}

	function zoomIn() {
		zoom = Math.min(2, +(zoom + 0.1).toFixed(1));
		applyZoom();
	}

	function zoomOut() {
		zoom = Math.max(0.5, +(zoom - 0.1).toFixed(1));
		applyZoom();
	}

	function zoomReset() {
		zoom = 1;
		applyZoom();
	}

	// ---------------------------------------------------------------------------
	// Device emulation (viewport width x height presets + custom inputs + drag)
	// ---------------------------------------------------------------------------
	function applyDevice() {
		if (device.width) {
			viewportEl.style.width = device.width + 'px';
			viewportEl.style.height = device.height ? device.height + 'px' : '100%';
			viewportEl.classList.add('emulated');
			resizeHandle.hidden = false;
		} else {
			viewportEl.style.width = '100%';
			viewportEl.style.height = '100%';
			viewportEl.classList.remove('emulated');
			resizeHandle.hidden = true;
		}
	}

	function setDevice(preset) {
		const found = DEVICE_PRESETS.find((p) => p.id === preset) || DEVICE_PRESETS[0];
		device.preset = found.id;
		device.width = found.width;
		device.height = found.height;
		applyDevice();
	}

	resizeHandle.addEventListener('mousedown', (e) => {
		e.preventDefault();
		const startX = e.clientX;
		const startW = viewportEl.offsetWidth;
		const maxW = viewportWrap.clientWidth;
		const move = (ev) => {
			const w = Math.min(Math.max(startW + (ev.clientX - startX), 240), maxW);
			viewportEl.style.width = w + 'px';
			device.preset = 'custom';
			device.width = w;
		};
		const up = () => {
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	});

	// ---------------------------------------------------------------------------
	// Close / reopen (unloads the page -> frees memory; keeps toolbar + history)
	// ---------------------------------------------------------------------------
	function closeBrowser() {
		if (nav.current) {
			lastUrl = nav.current;
		} else if (urlInput.value.trim()) {
			const kept = normalizeUrl(urlInput.value);
			if (kept) {
				lastUrl = kept;
			}
		}
		nav.back = [];
		nav.forward = [];
		nav.current = '';
		pendingCheck = null; // an in-flight probe must not paint an error page after close
		stopConnecting();
		stopLoading();
		hideError();
		clearFrameSrc(); // unloads the page, frees its memory
		urlInput.value = lastUrl || config.defaultUrl; // keep last URL visible while closed
		closed = true;
		viewportWrap.hidden = true;
		emptyState.hidden = false;
		updateButtons();
		vscode.postMessage({ type: 'setClosed', closed: true }); // persist closed state
	}

	function reopenBrowser() {
		closed = false;
		viewportWrap.hidden = false;
		emptyState.hidden = true;
		navigate(lastUrl || config.defaultUrl);
	}

	// ---------------------------------------------------------------------------
	// Menu
	// ---------------------------------------------------------------------------
	function menuItem(icon, label, onClick, opts = {}) {
		const div = document.createElement('div');
		div.className = 'menu-item' + (opts.danger ? ' danger' : '');
		if (icon) {
			const ic = document.createElement('span');
			ic.className = 'menu-icon';
			ic.innerHTML = svgIcon(icon, 14);
			div.appendChild(ic);
		}
		const span = document.createElement('span');
		span.className = 'menu-label';
		span.textContent = label;
		div.appendChild(span);
		if (opts.checked) {
			div.classList.add('checked');
		}
		if (opts.arrow) {
			const ar = document.createElement('span');
			ar.className = 'menu-arrow';
			ar.innerHTML = svgIcon('arrow-right', 14);
			div.appendChild(ar);
		}
		div.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
		return div;
	}

	function menuSeparator() {
		const s = document.createElement('div');
		s.className = 'menu-sep';
		return s;
	}

	function renderMenu(items) {
		menuEl.innerHTML = '';
		items.forEach((it) => menuEl.appendChild(it));
		menuEl.hidden = false;
	}

	function hideMenu() {
		menuEl.hidden = true;
		menuEl.innerHTML = '';
		menuEl.classList.remove('wide');
	}

	function renderMainMenu() {
		menuEl.classList.remove('wide');
		renderMenu([
			menuItem('settings-gear', S.menuSettings, () => {
				hideMenu();
				vscode.postMessage({ type: 'openSettings' });
			}),
			menuItem('link-external', S.menuExternal, () => {
				hideMenu();
				const url = fromProxyUrl(currentUrl()) || nav.current || config.defaultUrl;
				if (url) {
					vscode.postMessage({ type: 'openExternal', url });
				}
			}),
			menuSeparator(),
			menuItem('zoom-in', S.menuZoomIn, () => { zoomIn(); }),
			menuItem('zoom-out', S.menuZoomOut, () => { zoomOut(); }),
			menuItem(null, S.menuZoomReset, () => { zoomReset(); }),
			menuSeparator(),
			menuItem('device-mobile', S.menuDevice, () => renderDeviceMenu(), { arrow: true }),
			menuItem('history', S.menuHistory, () => {
				hideMenu();
				vscode.postMessage({ type: 'historyQuickPick' });
			}),
			menuItem('trash', S.menuClearStorage, () => {
				hideMenu();
				vscode.postMessage({ type: 'clearStorage' });
			}, { danger: true }),
			menuSeparator(),
			menuItem('close', S.menuClose, () => {
				hideMenu();
				closeBrowser();
			}, { danger: true }),
		]);
	}

	function renderDeviceMenu() {
		const respW = contentEl.clientWidth;
		const respH = contentEl.clientHeight;
		const respItem = menuItem(
			null,
			S.deviceResponsive + ' (' + respW + '\u00d7' + respH + ')',
			() => { setDevice('off'); renderDeviceMenu(); },
			{ checked: device.preset === 'off' }
		);
		const items = [menuItem('arrow-left', S.backShort, renderMainMenu)];
		items.push(menuSeparator());
		items.push(respItem);
		DEVICE_PRESETS.slice(1).forEach((p) => {
			items.push(
				menuItem('device-mobile', S.devices[p.id], () => { setDevice(p.id); renderDeviceMenu(); }, { checked: device.preset === p.id })
			);
		});
		// Custom: two number inputs (width x height).
		const customItem = document.createElement('div');
		customItem.className = 'menu-item menu-custom-item' + (device.preset === 'custom' ? ' checked' : '');
		const lab = document.createElement('span');
		lab.className = 'menu-label';
		lab.textContent = S.deviceCustom;
		customItem.appendChild(lab);
		const customRow = document.createElement('div');
		customRow.className = 'menu-custom';
		let inputW = '';
		let inputH = '';
		if (device.preset === 'off') {
			// Responsive: the real content area size (never 0 — content is always laid out).
			inputW = contentEl.clientWidth;
			inputH = contentEl.clientHeight;
		} else if (device.width && device.height) {
			inputW = device.width;
			inputH = device.height;
		}
		const wInput = document.createElement('input');
		wInput.type = 'number';
		wInput.min = '240';
		wInput.max = '9999';
		wInput.placeholder = S.deviceWidth;
		wInput.value = String(inputW);
		const hInput = document.createElement('input');
		hInput.type = 'number';
		hInput.min = '200';
		hInput.max = '9999';
		hInput.placeholder = S.deviceHeight;
		hInput.value = String(inputH);
		const xMark = document.createElement('span');
		xMark.className = 'menu-custom-x';
		xMark.textContent = '\u00d7';
		const applyBtn = document.createElement('button');
		applyBtn.className = 'menu-apply';
		applyBtn.textContent = S.deviceApply;
		const applyCustom = () => {
			const w = parseInt(wInput.value, 10);
			const h = parseInt(hInput.value, 10);
			const wOk = Number.isFinite(w);
			const hOk = Number.isFinite(h);
			wInput.classList.toggle('invalid', !wOk);
			hInput.classList.toggle('invalid', !hOk);
			if (wOk && hOk) {
				// Clamp to the same range as the inputs' min/max attributes.
				device.preset = 'custom';
				device.width = Math.min(Math.max(w, 240), 9999);
				device.height = Math.min(Math.max(h, 200), 9999);
				applyDevice();
				renderDeviceMenu(); // move the checkmark from the old option to Custom
			}
		};
		applyBtn.addEventListener('click', (e) => { e.stopPropagation(); applyCustom(); });
		wInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { applyCustom(); } });
		hInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { applyCustom(); } });
		wInput.addEventListener('input', () => wInput.classList.remove('invalid'));
		hInput.addEventListener('input', () => hInput.classList.remove('invalid'));
		customRow.appendChild(wInput);
		customRow.appendChild(xMark);
		customRow.appendChild(hInput);
		customRow.appendChild(applyBtn);
		customItem.appendChild(customRow);
		customItem.addEventListener('click', (e) => e.stopPropagation());
		items.push(customItem);
		deviceMenuRefs = {
			respLabel: respItem.querySelector('.menu-label'),
			wInput,
			hInput,
		};
		menuEl.classList.add('wide');
		renderMenu(items);
	}

	let menuOpenedAt = 0;

	// Live resize updates for the device menu (panel drag resizes the content area).
	let deviceMenuRefs = null; // { respLabel, wInput, hInput }
	btnMenu.addEventListener('click', () => {
		const now = Date.now();
		// Ignore the second click of a double-click so the menu doesn't open+close instantly.
		if (now - menuOpenedAt < 200) {
			return;
		}
		if (!menuEl.hidden) {
			hideMenu();
		} else {
			menuOpenedAt = now;
			renderMainMenu();
		}
	});
	document.addEventListener('click', (e) => {
		// contains() covers clicks on the SVG icon inside the button (e.target would be the <path>).
		if (!menuEl.hidden && !menuEl.contains(e.target) && !btnMenu.contains(e.target)) {
			hideMenu();
		}
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !menuEl.hidden) {
			hideMenu();
		}
	});

	// ---------------------------------------------------------------------------
	// Toolbar wiring
	// ---------------------------------------------------------------------------
	btnBack.addEventListener('click', goBack);
	btnForward.addEventListener('click', goForward);
	btnReload.addEventListener('click', reload);
	btnGo.addEventListener('click', () => navigate(urlInput.value));
	urlInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			navigate(urlInput.value);
		} else if (e.key === 'Escape') {
			urlInput.blur();
		}
	});
	btnHome.addEventListener('click', () => navigate(config.defaultUrl));
	btnDevtools.addEventListener('click', () => vscode.postMessage({ type: 'openDevtools' }));
	btnReopen.addEventListener('click', reopenBrowser);
	btnErrorCancelReconnect.addEventListener('click', cancelReconnect);
	btnErrorExternal.addEventListener('click', () => {
		if (errorUrl) {
			vscode.postMessage({ type: 'openExternal', url: errorUrl });
		}
	});

	// ---------------------------------------------------------------------------
	// Host messages (+ iframe bridge for proxy shim: openExternal / copy)
	// ---------------------------------------------------------------------------
	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (!msg || typeof msg.type !== 'string') {
			return;
		}
		// Bridge from the embedded page (shim or direct postMessage): only accept
		// relays whose sender is the iframe itself, never another window.
		if (event.source === frame.contentWindow) {
			if (msg.type === 'openExternal' && typeof msg.url === 'string' && msg.url) {
				// Scheme is re-validated host-side (openExternal); relay as-is.
				vscode.postMessage({ type: 'openExternal', url: msg.url });
				return;
			}
			if (msg.type === 'copy' && typeof msg.text === 'string') {
				// Prefer extension-host clipboard (webview Permissions-Policy often still blocks).
				vscode.postMessage({ type: 'copyText', text: msg.text });
				return;
			}
		}
		if (msg.type === 'config') {
			configReceived = true;
			config = Object.assign({}, config, msg.config);
			proxy = { enabled: !!msg.proxy?.enabled, baseUrl: msg.proxy?.baseUrl || '' };
			S = pickStrings(msg.language);
			applyStrings();
			urlInput.placeholder = config.defaultUrl;
			lastUrl = normalizeUrl(msg.lastUrl) || '';
			if (msg.closed === true) {
				// Explicitly closed last time: stay closed (no auto navigation).
				closed = true;
				viewportWrap.hidden = true;
				emptyState.hidden = false;
				urlInput.value = lastUrl || config.defaultUrl;
				updateButtons();
			} else if (!navigate(lastUrl || config.defaultUrl)) {
				// Neither the stored nor the default URL is usable. Leaving the
				// initial DOM as-is would be a silent blank frame (no error page,
				// no reconnect — nothing ever starts); surface the raw value instead.
				errorUrl = '';
				errorTitleEl.textContent = S.invalidUrl;
				errorDetailEl.textContent = String(lastUrl || config.defaultUrl || '');
				errorState.hidden = false;
				viewportWrap.hidden = true;
				btnErrorExternal.hidden = true;
			}
		} else if (msg.type === 'configChanged') {
			const prevProxy = proxy;
			config = Object.assign({}, config, msg.config);
			proxy = { enabled: !!msg.proxy?.enabled, baseUrl: msg.proxy?.baseUrl || '' };
			urlInput.placeholder = config.defaultUrl;
			// If the proxy mode changed, re-route the current page through the new mode.
			if ((prevProxy.enabled !== proxy.enabled || prevProxy.baseUrl !== proxy.baseUrl) && !closed && nav.current) {
				navigate(nav.current);
			}
		} else if (msg.type === 'navigate') {
			// Host-triggered navigation (e.g. history QuickPick).
			if (msg.url) {
				navigate(msg.url);
			}
		} else if (msg.type === 'urlStatus') {
			// The browser was closed: never paint an error page or arm a reconnect
			// for a probe that was in flight when it closed.
			if (closed) {
				return;
			}
			// Only apply if the user is still on the checked URL (stale responses
			// ignored); report against the normalized pending URL, never the raw
			// message value.
			if (pendingCheck && msg.url === pendingCheck.url) {
				if (!msg.ok) {
					showError(pendingCheck.url, msg.error || '', false);
				} else if (msg.frameBlocked) {
					// Reachable, but the site refuses to render inside an iframe.
					showError(pendingCheck.url, '', true);
				}
				// ok: keep the connecting bar until the iframe load settles
			}
		} else if (msg.type === 'storageCleared') {
			// Host cleared history + lastUrl; reload the page to drop in-memory state.
			lastUrl = '';
			nav.back = [];
			nav.forward = [];
			nav.current = '';
			updateButtons();
			if (!closed) {
				reload();
			} else {
				urlInput.value = config.defaultUrl;
			}
		}
	});

	function applyStrings() {
		btnBack.title = S.back;
		btnForward.title = S.forward;
		btnReload.title = S.reload;
		btnGo.title = S.go;
		btnHome.title = S.home;
		btnDevtools.title = S.devtools;
		btnMenu.title = S.menu;
		frame.title = S.frameTitle;
		emptyMessage.textContent = S.emptyTitle;
		btnReopen.textContent = S.emptyReopen;
		errorTitleEl.textContent = S.errorTitle;
		btnErrorExternal.textContent = S.menuExternal;
		btnErrorCancelReconnect.textContent = S.cancelReconnect;
		if (reconnectArmed && reconnectSecondsLeft > 0) {
			updateReconnectLabel();
		}
	}

	// ---------------------------------------------------------------------------
	// Init
	// ---------------------------------------------------------------------------
	injectIcons();
	applyStrings();
	vscode.postMessage({ type: 'getConfig' });

	// Startup watchdog: the panel's initial DOM is a blank viewport (empty state
	// and error state both hidden), and the ONLY way out of it is the config
	// exchange — if the getConfig message or its reply is ever dropped (webview
	// IPC race / extension host busy at startup), the panel stays blank forever
	// with no error page and nothing to auto-retry. Re-request until the config
	// arrives; the host-side watchdog is the second layer (forces a reload when
	// even this script never ran).
	let configRetries = 0;
	const configWatchdog = setInterval(() => {
		if (configReceived || ++configRetries >= 5) {
			clearInterval(configWatchdog);
			return;
		}
		vscode.postMessage({ type: 'getConfig' });
	}, 1500);

	// Live-update the device menu numbers while the panel is dragged/resized.
	new ResizeObserver(() => {
		if (!deviceMenuRefs || !menuEl.contains(deviceMenuRefs.respLabel)) {
			return; // device menu not open (or elements detached)
		}
		const w = contentEl.clientWidth;
		const h = contentEl.clientHeight;
		deviceMenuRefs.respLabel.textContent = S.deviceResponsive + ' (' + w + '\u00d7' + h + ')';
		if (device.preset === 'off') {
			// Don't clobber the user's typing in the custom inputs.
			if (document.activeElement === deviceMenuRefs.wInput || document.activeElement === deviceMenuRefs.hInput) {
				return;
			}
			deviceMenuRefs.wInput.value = String(w);
			deviceMenuRefs.hInput.value = String(h);
		}
	}).observe(contentEl);
})();
