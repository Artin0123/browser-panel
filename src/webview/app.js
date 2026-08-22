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
	const btnErrorExternal = document.getElementById('btn-error-external');
	const zoomLayer = document.getElementById('zoom-layer');

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
			embedTitle: 'Site cannot be embedded', embedDetail: 'The site blocks embedding (X-Frame-Options / CSP frame-ancestors). Use "Open in external browser" or enable the browser.proxyEnabled setting.',
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
			embedTitle: '网站无法内嵌', embedDetail: '该网站禁止内嵌（X-Frame-Options / CSP frame-ancestors）。请使用「在外部浏览器中打开」，或开启 browser.proxyEnabled 设置。',
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
			embedTitle: '網站無法內嵌', embedDetail: '該網站禁止內嵌（X-Frame-Options / CSP frame-ancestors）。請使用「在外部瀏覽器開啟」，或開啟 browser.proxyEnabled 設定。',
			devices: { 'iphone-se': 'iPhone SE (375\u00d7667)', 'iphone-14': 'iPhone 14 (390\u00d7844)', 'iphone-plus': 'iPhone Plus (414\u00d7896)', pixel: 'Pixel 7 (412\u00d7915)', ipad: 'iPad (768\u00d71024)', 'ipad-air': 'iPad Air (820\u00d71180)', 'surface-duo': 'Surface Duo (912\u00d71368)' },
		},
	};

	let S = STRINGS.en;

	function pickStrings(lang) {
		const l = (lang || '').toLowerCase();
		if (l.startsWith('zh')) {
			return l.includes('tw') || l.includes('hant') ? STRINGS['zh-tw'] : STRINGS['zh-cn'];
		}
		return STRINGS.en;
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
	function normalizeUrl(raw) {
		const url = (raw || '').trim();
		if (!url) {
			return null;
		}
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
			return url;
		}
		return 'http://' + url;
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

	/** Translate a target URL into the proxy URL (identity when the proxy is off). */
	function toProxyUrl(u) {
		if (!proxy.enabled || !proxy.baseUrl) {
			return u;
		}
		try {
			const url = new URL(u);
			return proxy.baseUrl + url.protocol.slice(0, -1) + '/' + url.host + url.pathname + url.search;
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

	function loadUrl(u) {
		const src = toProxyUrl(u);
		if (frame.getAttribute('src') !== src) {
			frame.setAttribute('src', src);
		}
		nav.current = u;
		urlInput.value = u;
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

	function showError(url, detail, blocked) {
		stopConnecting();
		clearTimeout(loadTimer);
		frame.removeAttribute('src'); // cancel the hanging iframe load
		errorUrl = url;
		errorTitleEl.textContent = blocked ? S.embedTitle : S.errorTitle;
		errorDetailEl.textContent = url + ' \u2014 ' + (blocked ? S.embedDetail : detail);
		errorState.hidden = false;
		viewportWrap.hidden = true;
	}

	function hideError() {
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
			}
		}, 20000);
	}

	function navigate(url, { record = true } = {}) {
		const u = normalizeUrl(url);
		if (!u) {
			return;
		}
		if (nav.current && nav.current !== u) {
			nav.back.push(nav.current);
			nav.forward = [];
		}
		programmaticNav = false;
		startNavigation(u);
		if (record) {
			vscode.postMessage({ type: 'navigate', url: u });
		}
	}

	function goBack() {
		const prev = nav.back.pop();
		if (prev === undefined) {
			return;
		}
		if (nav.current) {
			nav.forward.unshift(nav.current);
		}
		programmaticNav = true;
		startNavigation(prev);
		vscode.postMessage({ type: 'navigate', url: prev });
	}

	function goForward() {
		const next = nav.forward.shift();
		if (next === undefined) {
			return;
		}
		if (nav.current) {
			nav.back.push(nav.current);
		}
		programmaticNav = true;
		startNavigation(next);
		vscode.postMessage({ type: 'navigate', url: next });
	}

	function reload() {
		ensureOpen();
		const u = nav.current || fromProxyUrl(currentUrl());
		if (!u) {
			return;
		}
		// contentWindow.location is blocked cross-origin; re-setting src works everywhere.
		frame.setAttribute('src', toProxyUrl(u));
		btnReload.classList.add('loading');
		showConnecting();
		const id = ++checkSeq;
		pendingCheck = { id, url: u };
		vscode.postMessage({ type: 'checkUrl', url: u });
	}

	// Track in-iframe navigations (link clicks / redirects) so back/forward work.
	// iframe does not fire `loadstart`; loading state is set at navigate/reload.
	frame.addEventListener('load', () => {
		const url = fromProxyUrl(currentUrl());
		if (!url) {
			return; // ignore about:blank loads (e.g. right after close)
		}
		clearTimeout(loadTimer);
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
		nav.back = [];
		nav.forward = [];
		nav.current = '';
		stopConnecting();
		hideError();
		frame.removeAttribute('src'); // unloads the page, frees its memory
		urlInput.value = ''; // clear the address bar while closed
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
			if (w && h) {
				device.preset = 'custom';
				device.width = w;
				device.height = h;
				applyDevice();
				renderDeviceMenu(); // move the checkmark from the old option to Custom
			}
		};
		applyBtn.addEventListener('click', (e) => { e.stopPropagation(); applyCustom(); });
		wInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { applyCustom(); } });
		hInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { applyCustom(); } });
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
	btnErrorExternal.addEventListener('click', () => {
		if (errorUrl) {
			vscode.postMessage({ type: 'openExternal', url: errorUrl });
		}
	});

	// ---------------------------------------------------------------------------
	// Host messages
	// ---------------------------------------------------------------------------
	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (!msg || typeof msg.type !== 'string') {
			return;
		}
		if (msg.type === 'config') {
			config = Object.assign({}, config, msg.config);
			proxy = { enabled: !!msg.proxy?.enabled, baseUrl: msg.proxy?.baseUrl || '' };
			S = pickStrings(msg.language);
			applyStrings();
			urlInput.placeholder = config.defaultUrl;
			lastUrl = msg.lastUrl || '';
			if (msg.closed === true) {
				// The browser was explicitly closed last time: stay closed (no auto navigation).
				closed = true;
				viewportWrap.hidden = true;
				emptyState.hidden = false;
				urlInput.value = '';
				updateButtons();
			} else {
				navigate(lastUrl || config.defaultUrl);
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
			// Only apply if the user is still on the checked URL (stale responses ignored).
			if (pendingCheck && msg.url === pendingCheck.url) {
				if (!msg.ok) {
					showError(msg.url, msg.error || '', false);
				} else if (msg.frameBlocked) {
					// Reachable, but the site refuses to render inside an iframe.
					showError(msg.url, '', true);
				}
				// ok: keep the connecting bar until the iframe load settles
			}
		} else if (msg.type === 'storageCleared') {
			// Host cleared history + lastUrl; reload the page to drop in-memory state.
			if (!closed) {
				reload();
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
	}

	// ---------------------------------------------------------------------------
	// Init
	// ---------------------------------------------------------------------------
	injectIcons();
	applyStrings();
	vscode.postMessage({ type: 'getConfig' });

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
