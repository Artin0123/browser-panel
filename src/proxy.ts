import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import { CookieJar } from './cookie-jar';

/**
 * Local HTTP proxy that lets frame-blocked sites render inside the webview iframe.
 *
 * URL scheme:  http://127.0.0.1:<port>/p/<token>/<scheme>/<host>/<path>
 * - The token keeps other local processes from using this as an open proxy.
 * - Only binds to 127.0.0.1.
 * - Strips X-Frame-Options / CSP frame-ancestors, rewrites Origin/Referer so the
 *   target sees the page as same-origin, rewrites redirects through the proxy.
 * - Rewrites `Sec-Fetch-Dest: iframe|frame` to `document`, because app servers can
 *   veto framing server-side from that header alone and answer with an HTML 403
 *   page that carries no XFO (so the browser renders it inside the frame). Strip-
 *   ping XFO alone was therefore not enough — see _rewriteSecFetchDest.
 * - Forwards request headers (not a tiny allow-list). SPAs (Next.js RSC, Vite,
 *   etc.) send custom headers; dropping them makes the client treat the response
 *   as a full document and reload-loop. See docs/PROXY.md.
 * - Document navigations arriving in the /p/<token>/... form are bounced (302)
 *   to the target's own root-relative path, so the embedded page's
 *   location.pathname is always the target path, never the proxy prefix
 *   (path-prefix pathname breaks SPAs that route on pathname — e.g. opencode's
 *   web UI throws "Unrecognised route!" and dies with a TypeError). No
 *   sec-fetch-dest gate: VS Code webviews send dest=empty for iframe docs.
 * - Service worker scripts are refused (the shared proxy origin must never be
 *   captured by one site's service worker).
 * - No <base> / path rewriting (those caused SPA redirect loops). For text/html
 *   only, may buffer and inject the shim at the earliest possible position
 *   (right after <head>) so window.open / target=_blank are intercepted before
 *   any page script runs — pages that auto-open OAuth popups during parse
 *   would otherwise escape the shim. If the page's CSP restricts scripts, the
 *   shim reuses the policy's own nonce or appends 'self' to script-src /
 *   default-src (host sources are what authorize external scripts), since a
 *   blocked shim means blocked popups and no URL tracking.
 * - Set-Cookie is never forwarded to the browser; when an opt-in CookieJar is
 *   enabled, cookies are held on the extension host instead.
 */

/** Max HTML body size to buffer for shim injection (bytes). */
const HTML_INJECT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Served at /p/<token>/__bp_shim.js and referenced from injected script tags.
 * Bridges window.open / target=_blank / target=_top(_parent) and clipboard
 * failures to the parent webview,
 * and reports the document's real URL back to the parent (an iframe's src
 * attribute is NOT updated by in-frame navigations, so without these reports the
 * webview cannot track link clicks/redirects — breaking back/forward, the URL
 * bar and reachability probing of the actually-loaded page).
 *
 * The per-document target mapping rides on the script URL's ?bp= query (JSON,
 * URL-encoded): the target origin for root-relative documents, and the proxy
 * prefix to detect the explicit /p/<token>/... document form. A separate inline
 * bootstrap would be blocked by nonce-based CSPs; the query is not.
 *
 * The shim also neutralizes `crossorigin` on script/link elements (descriptor
 * setters + setAttribute). Sites that fetch their own bundles from a CDN with
 * `crossorigin="anonymous"` — Google's boq/jetski loader does exactly this —
 * require an Access-Control-Allow-Origin for the PROXY origin, which the CDN
 * gives only to the site's own origin; the load then fails even though the CDN
 * answered 200, and the app never boots (observed: antigravity.google.com spun
 * forever with 'No Access-Control-Allow-Origin' on www.gstatic.com bundles).
 * A classic script needs no CORS grant at all, so dropping the attribute makes
 * the very same URL load. Elements parsed from HTML are handled in the proxy
 * (_stripCrossOrigin); this hook covers the ones the page creates later.
 */
export const SHIM_JS =
	'(function(){' +
	'var bp={};try{bp=JSON.parse(new URL(document.currentScript.src).searchParams.get("bp")||"{}")}catch(e){}' +
	'function send(t,p){try{parent.postMessage(Object.assign({type:t},p),"*")}catch(e){}}' +
	'function openExt(u){var a=realUrl(u);if(a)send("openExternal",{url:a})}' +
	'function hrefOf(a){' +
	'try{var h=a.href;if(typeof h==="string"&&h)return h}catch(e){}' +
	'var r=a.getAttribute&&a.getAttribute("href");' +
	'try{return r?new URL(r,document.baseURI||location.href).href:null}catch(e){return null}' +
	'}' +
	// Rewrites a URL that is already in its proxied form back to the real site
	// URL — handing a proxy URL to a real browser is a dead link once the panel
	// stops. A bounced document's own relative links (the usual case) resolve
	// against the proxy origin, so their path belongs to the target site.
	'function realUrl(u){' +
	'var x;try{x=new URL(u,location.href)}catch(e){return null}' +
	'if(x.origin!==location.origin)return x.href;' +
	'var p=bp.prefix||"";' +
	'if(p&&x.pathname.lastIndexOf(p,0)===0){' +
	'var r=x.pathname.slice(p.length).split("/");' +
	'if(r.length>=2&&r[0]&&r[1])return r[0]+"://"+r[1]+(r.length>2?"/"+r.slice(2).join("/"):"/")+x.search+x.hash' +
	'}' +
	'if(bp.origin)return bp.origin+x.pathname+x.search+x.hash;' +
	'return x.href' +
	'}' +
	// Rewrites a URL into its proxied form so following it stays in the panel:
	// panel: URLs already on the proxy origin pass through untouched, the target
	// site's own absolute URLs become /p/<token>/<scheme>/<host>/<path> (a
	// same-site link's absolute href would otherwise send the frame straight to
	// the real host, where X-Frame-Options blocks framing). null = another site.
	'function inPanel(u){' +
	'if(!u)return null;' +
	'try{var x=new URL(u,location.href);' +
	'if(x.origin===location.origin)return x.href;' +
	'if(bp.origin&&x.origin===bp.origin){' +
	'if(bp.prefix)return location.origin+bp.prefix+x.protocol.slice(0,-1)+"/"+x.host+x.pathname+x.search+x.hash;' +
	'return location.origin+x.pathname+x.search+x.hash' +
	'}' +
	'}catch(e){}' +
	'return null' +
	'}' +
	'function reportUrl(){' +
	'var p=location.pathname;' +
	'var u=(bp.prefix&&p.lastIndexOf(bp.prefix,0)===0)?location.href:((bp.origin||location.origin)+p+location.search+location.hash);' +
	'send("pageNavigated",{url:u})' +
	'}' +
	'reportUrl();' +
	'window.addEventListener("load",reportUrl);' +
	'window.addEventListener("popstate",reportUrl);' +
	'window.addEventListener("hashchange",reportUrl);' +
	'try{var ps=history.pushState;history.pushState=function(){var r=ps.apply(this,arguments);setTimeout(reportUrl,0);return r};}catch(e){}' +
	'try{var rs=history.replaceState;history.replaceState=function(){var r=rs.apply(this,arguments);setTimeout(reportUrl,0);return r};}catch(e){}' +
	'window.open=function(u){if(u)openExt(u);return null};' +
	'document.addEventListener("click",function(e){' +
	'var t=e.target;while(t&&String(t.tagName).toUpperCase()!=="A")t=t.parentElement;if(!t)return;' +
	'var g=(t.getAttribute("target")||"").toLowerCase();' +
	'if(g==="_blank"||g==="_new"){e.preventDefault();e.stopPropagation();openExt(hrefOf(t));return}' +
	// target=_top / _parent asks to break out of the frame. The webview iframe is
	// sandboxed without allow-top-navigation (read out of the installed IDE's
	// workbench.desktop.main.js: allow-scripts, allow-same-origin, allow-forms,
	// allow-pointer-lock, allow-downloads), so the browser drops that navigation
	// silently — the click simply looks dead. Google's One Bar "Sign in"
	// (accounts.google.com/ServiceLogin, target=_top) on antigravity.google.com is
	// exactly that case. Emulate the intent instead: the same site opens in the
	// panel (the panel IS the browsing surface here), another site leaves for a
	// real browser, where its own cookies and its own session actually work.
	'if(g==="_top"||g==="_parent"){' +
	'var raw=t.getAttribute("href")||"";' +
	'if(/^(javascript|mailto|tel|data|blob|about):/i.test(raw))return;' +
	'var u=hrefOf(t);if(!u)return;' +
	'var p=inPanel(u);' +
	'if(p){e.preventDefault();e.stopPropagation();location.href=p}' +
	'else if(/^https?:/i.test(u)){e.preventDefault();e.stopPropagation();openExt(u)}' +
	'}' +
	'},true);' +
	// Clipboard bridge: in a VS Code webview iframe, Permissions-Policy often blocks
	// clipboard-write (making writeText/write reject, permissions.query report
	// "denied", or document.execCommand("copy") return false). Fall back to
	// extension-host vscode.env.clipboard.writeText via postMessage.
	'var clipCopy=function(t){send("copy",{text:String(t)})};' +
	'var writeItems=function(items){' +
	'var arr=Array.isArray(items)?items:Array.from(items||[]);' +
	'for(var i=0;i<arr.length;i++){var it=arr[i];' +
	'if(it&&it.types&&it.types.indexOf("text/plain")!==-1&&it.getType){' +
	'return Promise.resolve(it.getType("text/plain")).then(function(b){return b.text()}).then(function(t){clipCopy(t)})' +
	'}}return null};' +
	'try{' +
	'var clip=navigator.clipboard;' +
	'if(clip){' +
	'if(clip.writeText){' +
	'var wt=clip.writeText.bind(clip);' +
	'clip.writeText=function(text){' +
	'try{return Promise.resolve(wt(text)).catch(function(){clipCopy(text)})}' +
	'catch(e){clipCopy(text);return Promise.resolve()}' +
	'}' +
	'}else{clip.writeText=function(text){clipCopy(text);return Promise.resolve()}}' +
	'if(clip.write){' +
	'var wr=clip.write.bind(clip);' +
	'clip.write=function(items){' +
	'var fallback=function(err){' +
	'try{var p=writeItems(items);if(p)return p}catch(e){}return Promise.reject(err)' +
	'};' +
	'try{return Promise.resolve(wr(items)).catch(fallback)}catch(e){return fallback(e)}' +
	'}' +
	'}' +
	'}else{' +
	'Object.defineProperty(navigator,"clipboard",{configurable:true,value:{' +
	'writeText:function(text){clipCopy(text);return Promise.resolve()},' +
	'write:function(items){' +
	'try{var p=writeItems(items);if(p)return p}catch(e){}' +
	'return Promise.reject(new DOMException("Clipboard write failed","NotAllowedError"))' +
	'}}})' +
	'}' +
	'}catch(e){}' +
	'try{if(navigator.permissions&&navigator.permissions.query){' +
	'var pq=navigator.permissions.query.bind(navigator.permissions);' +
	'navigator.permissions.query=function(desc){' +
	'var isClipWrite=desc&&desc.name==="clipboard-write";' +
	'var grant=function(){return{state:"granted",name:"clipboard-write",onchange:null,addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return true}}};' +
	'if(!isClipWrite)return pq(desc);' +
	'try{return Promise.resolve(pq(desc)).then(function(st){return st&&st.state==="denied"?grant():st},function(){return grant()})}catch(e){return Promise.resolve(grant())}' +
	'}' +
	'}}catch(e){}' +
	'try{var ec=Document.prototype.execCommand;' +
	'if(ec){Document.prototype.execCommand=function(cmd){' +
	'var ok=false;try{ok=ec.apply(this,arguments)}catch(e){ok=false}' +
	'if(!ok&&String(cmd).toLowerCase()==="copy"){' +
	'var txt="";try{' +
	'var ae=document.activeElement;' +
	'if(ae&&(ae.tagName==="TEXTAREA"||ae.tagName==="INPUT")&&typeof ae.selectionStart==="number"&&typeof ae.selectionEnd==="number"){' +
	'txt=ae.value.slice(ae.selectionStart,ae.selectionEnd)' +
	'}' +
	'if(!txt&&window.getSelection)txt=String(window.getSelection()||"")' +
	'}catch(e){}' +
	'if(txt){clipCopy(txt);return true}' +
	'}return ok' +
	'}}' +
	'}catch(e){}' +
	// Drop cross-origin mode from scripts/links the page creates: the CDN grants
	// CORS to the site's real origin, never to the proxy origin, so a CORS-mode
	// load fails with ERR_FAILED 200 (OK). Classic/no-cors needs no grant.
	// Elements carrying `integrity` keep the real setter — SRI over an opaque
	// (no-cors) response always fails, so for those the original behavior is the
	// better bet (best-effort: the check reads integrity at call time, so a page
	// that assigns crossorigin BEFORE integrity still loses CORS mode).
	'try{' +
	'var keepCors=function(el){try{return !!(el&&el.getAttribute&&el.getAttribute("integrity"))}catch(e){return true}};' +
	'["HTMLScriptElement","HTMLLinkElement"].forEach(function(n){' +
	'var c=window[n];if(!c)return;' +
	'var d=Object.getOwnPropertyDescriptor(c.prototype,"crossOrigin");' +
	'if(d&&d.set)Object.defineProperty(c.prototype,"crossOrigin",{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){if(keepCors(this))return d.set.call(this,v)}})' +
	'});' +
	'var sa=Element.prototype.setAttribute;' +
	'Element.prototype.setAttribute=function(n,v){' +
	'if(this&&(this.tagName==="SCRIPT"||this.tagName==="LINK")&&String(n).toLowerCase()==="crossorigin"&&!keepCors(this))return;' +
	'return sa.apply(this,arguments)' +
	'};' +
	'}catch(e){}' +
	// Opt-in child iframe coverage (browser.proxyIframeRewrite): rewrite child
	// iframe src so nested frames (both same-origin and cross-origin) load
	// through their per-target proxy origin and receive this shim, then relay
	// openExternal/copy upward (never pageNavigated, so child frames cannot
	// pollute the URL bar/history).
	'if(bp.iframeRewrite){' +
	'var rewriteIfSrc=function(u){' +
	'if(!u||typeof u!=="string")return null;' +
	'var s=u.trim();' +
	'if(!s||(s.charAt(0)==="/"&&s.charAt(1)!=="/"))return null;' +
	'if(bp.prefix&&s.lastIndexOf(bp.prefix,0)===0)return null;' +
	'if(/^(about|javascript|data|blob|mailto|tel):/i.test(s))return null;' +
	'try{var x=new URL(s,document.baseURI||location.href);' +
	'if(x.origin===location.origin||(x.port===location.port&&/^t-[0-9a-f]{12}\\.localhost$/i.test(x.hostname)))return null;' +
	'if(x.protocol==="http:"||x.protocol==="https:"){' +
	'if(bp.origin&&x.origin===bp.origin){return x.pathname+x.search+x.hash}' +
	'if(bp.prefix){return location.origin+bp.prefix+x.protocol.slice(0,-1)+"/"+x.host+x.pathname+x.search+x.hash}' +
	'}' +
	'}catch(e){}return null' +
	'};' +
	'var sweepIframe=function(el){' +
	'if(!el||!el.getAttribute)return;' +
	'var r=rewriteIfSrc(el.getAttribute("src"));' +
	'if(r!==null&&el.getAttribute("src")!==r)el.setAttribute("src",r)' +
	'};' +
	'try{' +
	'var ifs=document.querySelectorAll("iframe,frame");' +
	'for(var i=0;i<ifs.length;i++)sweepIframe(ifs[i]);' +
	'if(typeof MutationObserver!=="undefined"){' +
	'new MutationObserver(function(muts){' +
	'for(var i=0;i<muts.length;i++){var m=muts[i];' +
	'if(m.type==="attributes"){sweepIframe(m.target);continue}' +
	'var added=m.addedNodes;for(var j=0;j<added.length;j++){var n=added[j];' +
	'if(!n||n.nodeType!==1)continue;' +
	'if(n.tagName==="IFRAME"||n.tagName==="FRAME")sweepIframe(n);' +
	'if(n.querySelectorAll){var sub=n.querySelectorAll("iframe,frame");for(var k=0;k<sub.length;k++)sweepIframe(sub[k])}' +
	'}}' +
	'}).observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:["src"]})' +
	'}' +
	'["HTMLIFrameElement","HTMLFrameElement"].forEach(function(n){' +
	'var c=window[n];if(!c||!c.prototype)return;' +
	'var d=Object.getOwnPropertyDescriptor(c.prototype,"src");' +
	'if(d&&d.set)Object.defineProperty(c.prototype,"src",{configurable:true,enumerable:d.enumerable,get:d.get,' +
	'set:function(v){var r=rewriteIfSrc(v);return d.set.call(this,r!==null?r:v)}})' +
	'})' +
	'}catch(e){}' +
	'window.addEventListener("message",function(e){' +
	'if(!e||e.source===window)return;' +
	'var d=e.data;if(!d||typeof d.type!=="string")return;' +
	'if(d.type==="openExternal"&&typeof d.url==="string"&&d.url){send("openExternal",{url:d.url})}' +
	'else if(d.type==="copy"&&typeof d.text==="string"){send("copy",{text:d.text})}' +
	'})' +
	'}' +
	'})();';;

const DROP_REQUEST_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'cookie',
	'host',
]);

/**
 * Content encodings the proxy offers upstream. HTML responses may be buffered
 * and decompressed for shim injection, so only encodings _decompressBody can
 * decode are requested — anything else (e.g. zstd on newer Chromium) would be
 * served as garbage when the content-encoding header is stripped.
 */
const ACCEPT_ENCODING =
	typeof zlib.zstdDecompressSync === 'function' ? 'gzip, deflate, br, zstd' : 'gzip, deflate, br';

// WebSocket handshake requires Connection + Upgrade; those are hop-by-hop for
// ordinary HTTP but must be forwarded on the upgrade request.
const DROP_UPGRADE_HEADERS = new Set(
	[...DROP_REQUEST_HEADERS].filter((h) => h !== 'connection' && h !== 'upgrade')
);

interface ProxyTarget {
	url: URL;
}

export class FrameProxy {
	private _server: http.Server | undefined;
	private _port = 0;
	private readonly _token = Math.random().toString(36).slice(2) + Date.now().toString(36);
	private readonly _targets = new Map<string, URL>();
	// Upgraded (WebSocket) sockets; closeAllConnections doesn't cover them.
	private readonly _upgradeSockets = new Set<import('stream').Duplex>();

	/**
	 * Whether to accept self-signed certificates (browser.acceptSelfSignedCerts)
	 * and optional extension-host CookieJar (browser.proxyCookieJar).
	 * Both settings are read per request so changes apply without restarting.
	 */
	constructor(
		private readonly _acceptSelfSigned: () => boolean,
		private readonly _cookieJar?: CookieJar,
		private readonly _cookieJarEnabled: () => boolean = () => Boolean(_cookieJar),
		private readonly _iframeRewriteEnabled: () => boolean = () => false
	) { }

	get baseUrl(): string {
		return `http://127.0.0.1:${this._port}/p/${this._token}/`;
	}

	/** Bound port (0 until started). The host persists it to keep the origin stable. */
	get port(): number {
		return this._port;
	}

	get listening(): boolean {
		return !!this._server;
	}

	private get _shimPath(): string {
		return '/p/' + this._token + '/__bp_shim.js';
	}

	/**
	 * Start the proxy, preferring a previously bound port when given. A stable
	 * port keeps the proxy origin (and with it the embedded pages' localStorage —
	 * e.g. opencode's pairing token and theme) stable across extension-host
	 * restarts. If the preferred port is taken (another process grabbed it, or a
	 * second VS Code window's proxy is already there), fall back to a random one.
	 */
	async start(preferredPort = 0): Promise<void> {
		// Never leak a previous server (e.g. if start() is called twice in a row).
		if (this._server) {
			await this.dispose();
		}
		if (preferredPort > 0 && (await this._tryStart(preferredPort))) {
			return;
		}
		await this._tryStart(0);
	}

	/** Bind once; resolves false on bind errors (port taken, no permission, …). */
	private _tryStart(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = http.createServer((req, res) => this._handle(req, res));
			// Forward WebSocket upgrades (dev-server HMR etc.) to the target.
			server.on('upgrade', (req, socket, head) => this._handleUpgrade(req, socket, head));
			let settled = false;
			server.on('error', () => {
				// Post-listen errors must not escape as unhandled ('error' has no
				// other listener once resolved); bind errors resolve false.
				if (!settled) {
					settled = true;
					server.close();
					resolve(false);
				}
			});
			server.listen(port, '127.0.0.1', () => {
				this._port = (server.address() as { port: number }).port;
				this._server = server;
				if (!settled) {
					settled = true;
					resolve(true);
				}
			});
		});
	}

	dispose(): Promise<void> {
		return new Promise((resolve) => {
			const server = this._server;
			this._server = undefined;
			this._targets.clear();
			if (!server) {
				resolve();
				return;
			}
			// Force-close active connections so dispose doesn't hang on long streams.
			// Must be called as a bound method (unbound extraction makes `this` undefined
			// and older Node versions throw); guarded for engines without it (Node < 18.2).
			try {
				server.closeAllConnections?.();
			} catch {
				// best-effort only
			}
			// Destroy upgraded sockets too — server.close() waits on them, so an open
			// HMR WebSocket would otherwise hang dispose forever.
			for (const s of this._upgradeSockets) {
				s.destroy();
			}
			this._upgradeSockets.clear();
			server.close(() => resolve());
			// Safety net: never hang dispose on unexpected socket states.
			setTimeout(resolve, 2000).unref();
		});
	}

	/** Parse /p/<token>/<scheme>/<host>/<path...> into a target URL, or null. */
	private _parseTarget(reqUrl: string): ProxyTarget | null {
		const pathPrefix = '/p/' + this._token + '/';
		if (!reqUrl.startsWith(pathPrefix)) {
			return null;
		}
		const rest = reqUrl.slice(pathPrefix.length);
		const schemeEnd = rest.indexOf('/');
		if (schemeEnd <= 0) {
			return null;
		}
		const scheme = rest.slice(0, schemeEnd);
		if (scheme !== 'http' && scheme !== 'https') {
			return null;
		}
		const hostAndPath = rest.slice(schemeEnd + 1);
		const slash = hostAndPath.indexOf('/');
		const host = slash === -1 ? hostAndPath : hostAndPath.slice(0, slash);
		const path = slash === -1 ? '/' : hostAndPath.slice(slash);
		let url: URL;
		try {
			url = new URL(scheme + '://' + host + path);
		} catch {
			return null;
		}
		return { url };
	}

	private _registerTarget(targetUrl: URL): { id: string; proxyOrigin: string } {
		const origin = targetUrl.protocol + '//' + targetUrl.host;
		const id = 't-' + crypto.createHash('sha256').update(origin).digest('hex').slice(0, 12);
		if (!this._targets.has(id)) {
			this._targets.set(id, new URL(origin));
		}
		return { id, proxyOrigin: `http://${id}.localhost:${this._port}` };
	}

	private _hostTargetId(host: unknown): string | null {
		if (typeof host !== 'string') {
			return null;
		}
		const suffix = '.localhost:' + this._port;
		if (!host.endsWith(suffix)) {
			return null;
		}
		const id = host.slice(0, -suffix.length);
		return /^t-[0-9a-f]{12}$/.test(id) ? id : null;
	}

	/** Resolve a request to a target: /p/<token>/... or a root-relative path against the Host's registered origin. */
	private _resolveTarget(req: http.IncomingMessage): ProxyTarget | null {
		const reqUrl = req.url || '';
		const parsed = this._parseTarget(reqUrl);
		if (parsed) {
			this._registerTarget(parsed.url);
			return parsed;
		}
		// Root-relative request from a per-target *.localhost:<port> origin.
		// Anything under /p/ with a wrong token stays null (404).
		const id = this._hostTargetId(req.headers.host);
		const baseOrigin = id ? this._targets.get(id) : undefined;
		if (!baseOrigin || !reqUrl || reqUrl.startsWith('/p/')) {
			return null;
		}
		// Reject forms that would let the request pick its own origin (open proxy / SSRF):
		// protocol-relative //host, absolute-form http://host, and backslash tricks.
		if (reqUrl.startsWith('//') || reqUrl.includes('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(reqUrl)) {
			return null;
		}
		try {
			// Explicit origin concatenation (not new URL(reqUrl, baseOrigin)): the request
			// path must never be able to change the target origin.
			const url = new URL(baseOrigin.origin + reqUrl);
			return { url };
		} catch {
			return null;
		}
	}

	private _targetOrigin(target: ProxyTarget): string {
		return target.url.protocol + '//' + target.url.host;
	}

	/**
	 * Map a proxy-space path (or absolute proxy URL) back to the target path.
	 * Next.js `Next-Url` / Referer must not contain `/p/<token>/...`.
	 */
	private _toTargetPath(value: string, fallback: ProxyTarget): string {
		try {
			const u = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
				? new URL(value)
				: new URL(value, 'http://proxy.invalid');
			const parsed = this._parseTarget(u.pathname + u.search);
			if (parsed) {
				return parsed.url.pathname + parsed.url.search;
			}
			if (!u.pathname.startsWith('/p/')) {
				// A foreign absolute URL is neither proxy space nor this target's: keep
				// it verbatim instead of folding it into a path on the current site
				// (that would silently rewrite another host's URL into this one's).
				if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) && u.origin !== fallback.url.origin) {
					return value;
				}
				return u.pathname + u.search;
			}
		} catch {
			// fall through
		}
		return fallback.url.pathname + fallback.url.search;
	}

	/**
	 * Rewrite Origin/Referer to the target origin so the page looks same-origin to
	 * the target server. Without this, dev servers (e.g. Next.js HMR websockets)
	 * reject the cross-origin requests and the page reload-loops.
	 */
	private _rewriteOrigin(headers: http.OutgoingHttpHeaders, target: ProxyTarget): http.OutgoingHttpHeaders {
		const origin = this._targetOrigin(target);
		headers.origin = origin;
		const ref = headers.referer;
		if (ref !== undefined) {
			try {
				const r = new URL(String(ref));
				const parsed = this._parseTarget(r.pathname + r.search);
				headers.referer = parsed ? parsed.url.href : origin + this._toTargetPath(r.pathname + r.search, target);
			} catch {
				headers.referer = origin + '/';
			}
		}
		return headers;
	}

	/** Copy request headers, drop hop-by-hop / cookies, fix Host and proxy-path headers. */
	private _outgoingHeaders(
		req: http.IncomingMessage,
		target: ProxyTarget,
		drop: Set<string> = DROP_REQUEST_HEADERS
	): http.OutgoingHttpHeaders {
		const headers: http.OutgoingHttpHeaders = {};
		for (const [k, v] of Object.entries(req.headers)) {
			if (v === undefined || drop.has(k.toLowerCase())) {
				continue;
			}
			headers[k] = v;
		}
		headers.host = target.url.host;
		// Only offer encodings we can decode (see ACCEPT_ENCODING) — the webview's
		// Chromium may offer zstd which we otherwise serve back as garbage.
		headers['accept-encoding'] = ACCEPT_ENCODING;
		this._rewriteOrigin(headers, target);
		this._rewriteSecFetchDest(headers);
		// Next.js (and similar) send the current page URL in Next-Url; it must be
		// the target path, not /p/<token>/..., or the router disagrees with itself.
		const nextUrl = headers['next-url'];
		if (typeof nextUrl === 'string') {
			headers['next-url'] = this._toTargetPath(nextUrl, target);
		}
		if (this._cookieJar && this._cookieJarEnabled()) {
			const cookieHeader = this._cookieJar.send(target.url, target.url.protocol === 'https:');
			if (cookieHeader) {
				headers.cookie = cookieHeader;
			}
		}
		return headers;
	}

	/**
	 * Server-side anti-framing bypass.
	 *
	 * Stripping `X-Frame-Options` / `frame-ancestors` only defeats the *browser-side*
	 * framing veto. Some sites veto framing in the app server instead, purely from
	 * `Sec-Fetch-Dest`, which the browser computes and we otherwise forward verbatim
	 * — so a framed document gets an HTML error page that the browser happily renders
	 * inside the frame (it carries no XFO either).
	 *
	 * Measured against Google's properties (antigravity.google.com, 2026-11-12), with
	 * Origin/Referer already rewritten by _rewriteOrigin:
	 *   dest=iframe  (site=cross-site | same-origin | none) -> 403 "That's an error"
	 *   dest=frame   (site=cross-site)                      -> 403
	 *   dest=document(site=cross-site | same-origin | none) -> 302/200
	 *   dest=empty   (site=cross-site)                      -> 302/200
	 * Only `Sec-Fetch-Dest` discriminates: `Sec-Fetch-Site`/`-Mode` were varied
	 * independently and changed nothing, so they are deliberately left untouched
	 * (rewriting them would misdescribe subresource loads, which never use the
	 * frame destinations).
	 *
	 * VS Code webviews really do send dest=iframe for the document here — which is
	 * why proxy mode still showed Google's 403 page in the field, not ours.
	 */
	private _rewriteSecFetchDest(headers: http.OutgoingHttpHeaders): void {
		const dest = headers['sec-fetch-dest'];
		if (typeof dest !== 'string') {
			return;
		}
		const d = dest.trim().toLowerCase();
		// Nested-document destinations are the framed ones. `empty` (the send XHR /
		// Electron navigation case) and `document` already pass, so they are left as-is.
		if (d === 'iframe' || d === 'frame') {
			headers['sec-fetch-dest'] = 'document';
		}
	}

	/**
	 * DNS rebinding defense: only accept requests whose Host is this proxy's own
	 * loopback address (the webview always uses the baseUrl form).
	 */
	private _isAllowedHost(host: unknown): boolean {
		if (host === '127.0.0.1:' + this._port || host === 'localhost:' + this._port) {
			return true;
		}
		const id = this._hostTargetId(host);
		return id !== null && this._targets.has(id);
	}

	private _handleUpgrade(
		req: http.IncomingMessage,
		socket: import('stream').Duplex,
		head: Buffer
	): void {
		if (!this._isAllowedHost(req.headers.host)) {
			socket.destroy();
			return;
		}
		const target = this._resolveTarget(req);
		if (!target) {
			socket.destroy();
			return;
		}
		this._upgradeSockets.add(socket);
		socket.on('close', () => this._upgradeSockets.delete(socket));
		const lib = target.url.protocol === 'https:' ? https : http;
		// TLS validation is controlled by browser.acceptSelfSignedCerts (default on):
		// local https dev servers are typically self-signed and must render through
		// the proxy. The server binds to 127.0.0.1 behind a path token, and
		// Set-Cookie is dropped, so cookies/credentials never flow through here.
		const rejectUnauthorized = !this._acceptSelfSigned();
		const preq = lib.request({
			hostname: target.url.hostname,
			port: target.url.port || (target.url.protocol === 'https:' ? 443 : 80),
			path: target.url.pathname + target.url.search,
			method: req.method,
			headers: this._outgoingHeaders(req, target, DROP_UPGRADE_HEADERS),
			rejectUnauthorized,
		});
		preq.on('upgrade', (res: http.IncomingMessage, upSocket: import('stream').Duplex, upHead: Buffer) => {
			this._upgradeSockets.add(upSocket);
			upSocket.on('close', () => this._upgradeSockets.delete(upSocket));
			this._receiveCookies(res, target);
			socket.write('HTTP/1.1 101 Switching Protocols\r\n');
			for (const [k, v] of Object.entries(res.headers)) {
				if (k.toLowerCase() === 'set-cookie') {
					continue; // never forward Set-Cookie to the browser
				}
				socket.write(k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v)) + '\r\n');
			}
			socket.write('\r\n');
			if (upHead && upHead.length) {
				upSocket.unshift(upHead);
			}
			upSocket.pipe(socket);
			socket.pipe(upSocket);
		});
		preq.on('error', () => socket.destroy());
		preq.on('response', () => socket.destroy()); // target refused the upgrade (returned HTTP)
		socket.on('error', () => preq.destroy());
		if (head && head.length) {
			preq.write(head);
		}
		preq.end();
	}

	private _rawHeaderValues(res: http.IncomingMessage, headerName: string): string[] {
		const target = headerName.toLowerCase();
		const values: string[] = [];
		const raw = res.rawHeaders || [];
		for (let i = 0; i + 1 < raw.length; i += 2) {
			if (raw[i].toLowerCase() === target) {
				values.push(raw[i + 1]);
			}
		}
		if (values.length === 0) {
			const v = res.headers[target];
			if (typeof v === 'string') values.push(v);
			else if (Array.isArray(v)) values.push(...v);
		}
		return values;
	}

	private _receiveCookies(res: http.IncomingMessage, target: ProxyTarget): void {
		if (!this._cookieJar || !this._cookieJarEnabled()) {
			return;
		}
		const isHttps = target.url.protocol === 'https:';
		for (const sc of this._rawHeaderValues(res, 'set-cookie')) {
			this._cookieJar.receive(target.url, sc, isHttps);
		}
	}

	private _copyResponseHeaders(pres: http.IncomingMessage, target: ProxyTarget): http.OutgoingHttpHeaders {
		this._receiveCookies(pres, target);
		const outHeaders: http.OutgoingHttpHeaders = {};
		for (const [k, v] of Object.entries(pres.headers)) {
			const lk = k.toLowerCase();
			if (lk === 'x-frame-options' || lk === 'set-cookie') {
				continue; // strip frame-blocking; never forward Set-Cookie to the browser
			}
			// Hop-by-hop headers must not be forwarded (and transfer-encoding in
			// particular conflicts with the recomputed content-length on the inject
			// path; passthrough re-chunks automatically).
			if (
				lk === 'transfer-encoding' ||
				lk === 'connection' ||
				lk === 'keep-alive' ||
				lk === 'upgrade' ||
				lk === 'proxy-connection' ||
				lk === 'te' ||
				lk === 'trailer'
			) {
				continue;
			}
			if (lk === 'content-security-policy') {
				continue; // multi-policy aware handling after the loop
			}
			outHeaders[k] = v;
		}

		// A CSP header VALUE is a comma-separated LIST OF POLICIES, each enforced
		// independently (CSP3 §policy delivery), and upstreams commonly send
		// several policies — Google's product pages send one with a nonce for
		// scripts and a second carrying require-trusted-types-for. Node collapses
		// duplicate headers into one ', '-joined string, so the policy structure
		// has to be recovered by splitting on ',' as well as on ';'; treating it
		// as a single policy makes a `script-src` sitting after a comma invisible
		// (its nonce then never reaches the shim tag, and the nonce-only policy
		// blocks the shim (the field bug: a nonce-only policy sitting after the
		// comma hid its script-src from the single-policy parser, so the shim was
		// blocked even though the tag carried the right nonce).
		const cspPolicies = this._cspPolicies(pres);
		if (cspPolicies.length > 0) {
			FrameProxy._setCspHeader(outHeaders, cspPolicies);
		}

		// Each target origin maps 1-to-1 to its own t-<hash>.localhost:<port>, so
		// upstream Cache-Control / Expires / Pragma headers stay isolated per site.
		const status = pres.statusCode ?? 502;
		if (status >= 300 && status < 400 && outHeaders.location) {
			try {
				const locUrl = new URL(String(outHeaders.location), target.url);
				if (locUrl.origin === target.url.origin) {
					// Same-origin redirect: rewrite to the root-relative path so the
					// page stays at location.pathname == target path (never the proxy
					// prefix). The browser keeps the original #fragment when the
					// Location carries none.
					outHeaders.location = (locUrl.pathname || '/') + locUrl.search + (locUrl.hash || '');
				} else {
					// Cross-origin redirect: pre-register the new target origin and land
					// directly on its own t-<id>.localhost:<port> origin.
					const { proxyOrigin } = this._registerTarget(locUrl);
					outHeaders.location =
						proxyOrigin +
						(locUrl.pathname || '/') +
						(locUrl.search || '') +
						(locUrl.hash || '');
				}
			} catch {
				delete outHeaders.location;
			}
		}
		return outHeaders;
	}

	private _isHtmlResponse(headers: http.IncomingHttpHeaders): boolean {
		return /text\/html/i.test(String(headers['content-type'] || ''));
	}

	private _decompressBody(buf: Buffer, encoding: string): Buffer {
		const enc = encoding.toLowerCase();
		if (enc === 'gzip') {
			return Buffer.from(zlib.gunzipSync(buf, { maxOutputLength: HTML_INJECT_MAX_BYTES }));
		}
		if (enc === 'deflate') {
			return Buffer.from(zlib.inflateSync(buf, { maxOutputLength: HTML_INJECT_MAX_BYTES }));
		}
		if (enc === 'br') {
			return Buffer.from(zlib.brotliDecompressSync(buf, { maxOutputLength: HTML_INJECT_MAX_BYTES }));
		}
		if (enc === 'zstd' && typeof zlib.zstdDecompressSync === 'function') {
			return Buffer.from(zlib.zstdDecompressSync(buf, { maxOutputLength: HTML_INJECT_MAX_BYTES }));
		}
		return buf;
	}

	/**
	 * Write the policy list onto the outgoing headers, keeping the policies
	 * separate. Node emits one header line per array element; should a runtime
	 * join them with ', ' instead, that is equally valid — browsers split a CSP
	 * header value on commas into separate policies.
	 */
	private static _setCspHeader(outHeaders: http.OutgoingHttpHeaders, policies: string[]): void {
		if (policies.length === 1) {
			outHeaders['content-security-policy'] = policies[0];
			return;
		}
		(outHeaders as Record<string, http.OutgoingHttpHeader>)['content-security-policy'] = policies;
	}

	/** Normalize one or more CSP header values into individual policies. */
	private static _splitCspList(value: string | string[] | number | undefined | null): string[] {
		const raw = Array.isArray(value) ? value : [value ?? ''];
		const out: string[] = [];
		for (const v of raw) {
			for (const p of String(v).split(',')) {
				const t = p.trim();
				if (t) out.push(t);
			}
		}
		return out;
	}

	/**
	 * Collect every policy the upstream sent, minus frame-ancestors (which the
	 * proxy strips elsewhere: it is the frame-blocking gate this extension
	 * exists to work around). rawHeaders keeps repeated headers apart; the
	 * comma split then recovers policies that were packed into one value.
	 */
	private _cspPolicies(pres: http.IncomingMessage): string[] {
		const values = this._rawHeaderValues(pres, 'content-security-policy');
		return FrameProxy._splitCspList(values)
			.map((p) =>
				p
					.split(';')
					.map((d) => d.trim())
					.filter((d) => d.length > 0 && !/^frame-ancestors\b/i.test(d))
					.join('; ')
			)
			.filter((p) => p.length > 0);
	}

	/**
	 * Make room for the shim in EVERY policy the page enforces, and lift a nonce
	 * when one is usable. Without this, pages with a strict script-src (nonce /
	 * allowlist — typical for auth providers and Google products) block the shim
	 * entirely: popups stop being intercepted, URL tracking stops, and the
	 * cross-origin fix in the shim never runs. Rules (verified against
	 * Chromium):
	 * - Within ONE policy only the FIRST script-src (else the first default-src,
	 *   which governs scripts when script-src is absent) counts; later repeats
	 *   are ignored. Each policy is handled on its own, because all of them are
	 *   enforced and our script must satisfy every one.
	 * - A policy that already allows 'self', or that restricts neither directive,
	 *   needs no change. 'self' is the document's own origin, which behind the
	 *   proxy IS the proxy origin the shim is served from; loosening to
	 *   same-origin adds no attacker power, since same-origin script content
	 *   comes from the same target server that already controls the page body.
	 * - A closed policy with a nonce is left untouched and the nonce is reused on
	 *   the shim tag (works under 'strict-dynamic' too). A single tag holds a
	 *   single nonce, so this is only possible when every closed policy shares
	 *   the same nonce; otherwise every closed policy gets 'self' appended
	 *   instead (a host source is what authorizes EXTERNAL scripts; hash sources
	 *   only match inline content, and Chromium ignores 'none' when combined).
	 * - Appending goes to the directive that is already there — never a new
	 *   script-src when only default-src exists, as that would override
	 *   default-src and drop e.g. its 'unsafe-inline' for the page's own scripts.
	 */
	private _cspForShim(policies: string[]): { policies: string[]; nonce: string } {
		const isSelf = (v: string): boolean => /^'self'$/i.test(v);
		const nonceOf = (values: string[]): string => {
			const tok = values.find((v) => /^'nonce-[^']+'$/i.test(v));
			return tok ? tok.slice(7, -1).replace(/[^A-Za-z0-9+/=_-]/g, '') : '';
		};
		const parsed = policies.map((policy) => {
			const directives = policy.split(';').map((d) => d.trim()).filter((d) => d.length > 0);
			const scriptIdx = directives.findIndex((d) => /^script-src(\s|$)/i.test(d));
			const target =
				scriptIdx !== -1 ? scriptIdx : directives.findIndex((d) => /^default-src(\s|$)/i.test(d));
			return { directives, target };
		});
		// Policies that would reject the shim as things stand.
		const closed = parsed.filter(
			(p) => p.target !== -1 && !p.directives[p.target].split(/\s+/).some(isSelf)
		);
		const nonces = new Set(closed.map((p) => nonceOf(p.directives[p.target].split(/\s+/))));
		const sharedNonce = nonces.size === 1 && !nonces.has('') ? [...nonces][0] : '';
		const out = parsed.map((p) => {
			if (p.target === -1) {
				return p.directives.join('; '); // this policy restricts nothing relevant
			}
			const values = p.directives[p.target].split(/\s+/);
			if (values.some(isSelf)) {
				return p.directives.join('; ');
			}
			if (sharedNonce && nonceOf(values) === sharedNonce) {
				return p.directives.join('; '); // satisfied by the nonce on the tag
			}
			p.directives[p.target] += " 'self'";
			return p.directives.join('; ');
		});
		return { policies: out, nonce: sharedNonce };
	}

	/** Shim script URL carrying the per-document target mapping in ?bp=. */
	private _shimSrc(target: ProxyTarget): string {
		const bp: Record<string, unknown> = {
			origin: this._targetOrigin(target),
			prefix: '/p/' + this._token + '/',
		};
		if (this._iframeRewriteEnabled()) {
			bp.iframeRewrite = true;
		}
		const raw = JSON.stringify(bp).replace(/</g, '\\u003c');
		return this._shimPath + '?bp=' + encodeURIComponent(raw);
	}

	/**
	 * Opt-in child iframe rewrite (browser.proxyIframeRewrite): rewrite child
	 * <iframe src> values (same-origin to root-relative, cross-origin http(s) to
	 * their own pre-registered t-<id>.localhost:<port> origin) so nested frames
	 * also load through the proxy and receive the shim.
	 */
	private _rewriteIframeSrcs(html: string, target: ProxyTarget): string {
		if (!/<iframe\b/i.test(html)) {
			return html;
		}
		const targetOrigin = this._targetOrigin(target);
		const prefix = '/p/' + this._token + '/';
		return html.replace(/<iframe\b[^>]*>/gi, (tag) =>
			tag.replace(/(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i, (full, attrPrefix, dq, sq, uq) => {
				const raw = String(dq ?? sq ?? uq ?? '').trim();
				if (!raw || (raw.startsWith('/') && !raw.startsWith('//')) || raw.startsWith(prefix)) {
					return full;
				}
				if (/^(about|javascript|data|blob|mailto|tel):/i.test(raw)) {
					return full;
				}
				try {
					const u = new URL(raw, target.url);
					if (u.protocol === 'http:' || u.protocol === 'https:') {
						const rewritten =
							u.origin === targetOrigin
								? u.pathname + u.search + u.hash
								: this._registerTarget(u).proxyOrigin + u.pathname + u.search + u.hash;
						const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '"';
						return attrPrefix + quote + rewritten + quote;
					}
				} catch {
					// malformed URL: fail-safe, keep untouched
				}
				return full;
			})
		);
	}

	/**
	 * Remove `crossorigin` from script/link tags in the HTML. A CORS-mode
	 * subresource load requires the CDN to grant CORS to OUR origin, which it
	 * never does (it grants the site's real origin), so the load fails with a
	 * CORS error even though it answered 200 — Google's boq loader tags its
	 * bundles with crossorigin="anonymous" and the app then never boots.
	 * Without the attribute the same URL loads as an ordinary classic script,
	 * which needs no grant. Tags carrying `integrity` are left alone: SRI over an
	 * opaque (no-cors) response always fails. Font preloads are left alone too —
	 * fonts are always fetched in CORS mode by @font-face, so a no-cors preload
	 * would only be wasted (harmless, but noisy in the console).
	 */
	private _stripCrossOrigin(html: string): string {
		if (!/crossorigin/i.test(html)) return html;
		return html.replace(/<(script|link)\b[^>]*>/gi, (tag) => {
			if (!/crossorigin/i.test(tag) || /\sintegrity\s*=/i.test(tag)) return tag;
			if (/\bas\s*=\s*["']?font/i.test(tag)) return tag;
			return tag.replace(/\scrossorigin(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/i, '');
		});
	}

	/**
	 * Insert the shim script at the earliest possible position — right after
	 * <head> (then <html>, then the doctype) — so it runs BEFORE any page
	 * script: pages that call window.open during parse (OAuth auto-open pages)
	 * would otherwise escape the interception injected before </body>. The
	 * returned policies are the (possibly relaxed) CSP policies to send along
	 * with the injected body.
	 */
	private _injectShimTag(
		html: Buffer,
		target: ProxyTarget,
		cspIn: string | string[] | number | undefined
	): { html: Buffer; policies: string[] } {
		const { policies, nonce } = this._cspForShim(FrameProxy._splitCspList(cspIn));
		const nonceAttr = nonce ? ' nonce="' + nonce + '"' : '';
		const tag = '<script' + nonceAttr + ' src="' + this._shimSrc(target) + '"></script>';
		let s = this._stripCrossOrigin(html.toString('utf8'));
		if (this._iframeRewriteEnabled()) {
			s = this._rewriteIframeSrcs(s, target);
		}
		// <head> (not a prefix match — <header> would false-positive).
		let m = /<head(\s[^>]*)?>/i.exec(s);
		if (m) {
			const at = m.index + m[0].length;
			return { html: Buffer.from(s.slice(0, at) + tag + s.slice(at), 'utf8'), policies };
		}
		m = /<html(\s[^>]*)?>/i.exec(s);
		if (m) {
			const at = m.index + m[0].length;
			return { html: Buffer.from(s.slice(0, at) + tag + s.slice(at), 'utf8'), policies };
		}
		// No <html> either: after the doctype if there is one — inserting before
		// it would flip the document into quirks mode.
		m = /^(\s*<!doctype[^>]*>)/i.exec(s);
		if (m) {
			return { html: Buffer.from(m[1] + tag + s.slice(m[1].length), 'utf8'), policies };
		}
		return { html: Buffer.from(tag + s, 'utf8'), policies };
	}

	private _pipeOrInjectHtml(
		pres: http.IncomingMessage,
		res: http.ServerResponse,
		target: ProxyTarget,
		method: string
	): void {
		const outHeaders = this._copyResponseHeaders(pres, target);
		const status = pres.statusCode ?? 502;
		const declaredLen = parseInt(String(pres.headers['content-length'] || ''), 10);
		// Bodyless responses must be relayed as-is: injecting the shim into a HEAD
		// reply or into a 204/304 would both synthesize a body that must not exist
		// and rewrite content-length to the shim tag's size.
		const bodyless = method === 'HEAD' || status === 204 || status === 304;
		// Known-large or non-HTML: stream unchanged (no shim).
		if (
			bodyless ||
			!this._isHtmlResponse(pres.headers) ||
			(Number.isFinite(declaredLen) && declaredLen > HTML_INJECT_MAX_BYTES)
		) {
			res.writeHead(status, outHeaders);
			pres.pipe(res);
			return;
		}

		const encoding = String(pres.headers['content-encoding'] || '');
		const chunks: Buffer[] = [];
		let size = 0;
		let passthrough = false;

		// Backpressure: if the client socket is full, pause the upstream until drained.
		const writeChunk = (chunk: Buffer): void => {
			if (!res.write(chunk)) {
				pres.pause();
				res.once('drain', () => pres.resume());
			}
		};

		const startPassthrough = (firstOverflowChunk: Buffer) => {
			passthrough = true;
			res.writeHead(status, outHeaders);
			for (const c of chunks) {
				writeChunk(c);
			}
			chunks.length = 0;
			writeChunk(firstOverflowChunk);
		};

		pres.on('data', (chunk: Buffer) => {
			if (passthrough) {
				writeChunk(chunk);
				return;
			}
			size += chunk.length;
			if (size > HTML_INJECT_MAX_BYTES) {
				// Over limit mid-stream: flush buffered bytes + rest without injection.
				startPassthrough(chunk);
				return;
			}
			chunks.push(chunk);
		});
		pres.on('error', () => {
			if (!res.headersSent) {
				res.writeHead(502, { 'content-type': 'text/plain' });
				res.end('Proxy error: ' + target.url.href);
			} else {
				res.destroy();
			}
		});
		pres.on('end', () => {
			if (passthrough) {
				res.end();
				return;
			}
			const raw = Buffer.concat(chunks);
			try {
				let buf: Buffer = Buffer.from(raw);
				if (encoding) {
					buf = this._decompressBody(buf, encoding);
				}
				const injected = this._injectShimTag(buf, target, outHeaders['content-security-policy']);
				buf = injected.html;
				// Send the shim-adapted CSP only on the injected path — if injection
				// failed and we serve the raw body below, the page keeps its original
				// policy (and its original script rules).
				if (injected.policies.length === 0) {
					delete outHeaders['content-security-policy'];
				} else {
					FrameProxy._setCspHeader(outHeaders, injected.policies);
				}
				delete outHeaders['content-encoding'];
				delete outHeaders['content-length'];
				outHeaders['content-length'] = buf.length;
				res.writeHead(status, outHeaders);
				res.end(buf);
			} catch {
				delete outHeaders['content-length'];
				outHeaders['content-length'] = raw.length;
				res.writeHead(status, outHeaders);
				res.end(raw);
			}
		});
	}

	private _handle(req: http.IncomingMessage, res: http.ServerResponse): void {
		if (!this._isAllowedHost(req.headers.host)) {
			res.writeHead(403);
			res.end('Forbidden');
			return;
		}
		const reqUrl = req.url || '';
		// Same-origin shim for proxied pages (CSP script-src 'self' friendly).
		if (reqUrl.split('?')[0] === this._shimPath) {
			res.writeHead(200, {
				'content-type': 'application/javascript; charset=utf-8',
				'cache-control': 'no-store',
			});
			res.end(SHIM_JS);
			return;
		}
		const dest = String(req.headers['sec-fetch-dest'] || '');
		// Service worker scripts are refused in proxy mode: the proxy origin is
		// SHARED across every site served through it, so a service worker
		// registered by one site would persist (sticky port keeps the origin
		// alive) and later intercept another site's requests — its cache knows
		// nothing about the bounce/target semantics. The 404 makes
		// navigator.serviceWorker.register() fail; direct mode is unaffected.
		// (Observed in the field: opencode's web UI registers one — sw.js
		// arrived with sec-fetch-dest: serviceworker.)
		if (dest === 'serviceworker') {
			res.writeHead(404);
			res.end();
			return;
		}

		const target = this._resolveTarget(req);
		if (!target) {
			res.writeHead(404);
			res.end('Not Found');
			return;
		}

		// Per-target origin bounce: a /p/<token>/... GET/HEAD request is answered
		// with a 302 redirect to the target's deterministic t-<id>.localhost:<port>
		// origin, so each site gets its own isolated origin and pathname-routing SPAs work.
		if (
			(req.method === 'GET' || req.method === 'HEAD') &&
			this._parseTarget(reqUrl) !== null
		) {
			const { proxyOrigin } = this._registerTarget(target.url);
			res.writeHead(302, {
				location: proxyOrigin + target.url.pathname + target.url.search + target.url.hash,
				'cache-control': 'no-store',
			});
			res.end();
			return;
		}

		const lib = target.url.protocol === 'https:' ? https : http;
		// Same TLS setting as _handleUpgrade — see the comment there.
		const rejectUnauthorized = !this._acceptSelfSigned();
		const preq = lib.request(
			{
				hostname: target.url.hostname,
				port: target.url.port || (target.url.protocol === 'https:' ? 443 : 80),
				path: target.url.pathname + target.url.search,
				method: req.method || 'GET',
				headers: this._outgoingHeaders(req, target),
				rejectUnauthorized,
			},
			(pres) => {
				this._pipeOrInjectHtml(pres, res, target, req.method || 'GET');
			}
		);
		preq.on('error', () => {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			res.writeHead(502, { 'content-type': 'text/plain' });
			res.end('Proxy error: ' + target.url.href);
		});
		req.on('error', () => preq.destroy());
		req.pipe(preq);
	}
}
