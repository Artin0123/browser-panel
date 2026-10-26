import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';

/**
 * Local HTTP proxy that lets frame-blocked sites render inside the webview iframe.
 *
 * URL scheme:  http://127.0.0.1:<port>/p/<token>/<scheme>/<host>/<path>
 * - The token keeps other local processes from using this as an open proxy.
 * - Only binds to 127.0.0.1.
 * - Strips X-Frame-Options / CSP frame-ancestors, rewrites Origin/Referer so the
 *   target sees the page as same-origin, rewrites redirects through the proxy.
 * - Forwards request headers (not a tiny allow-list). SPAs (Next.js RSC, Vite,
 *   etc.) send custom headers; dropping them makes the client treat the response
 *   as a full document and reload-loop. See docs/PROXY.md.
 * - No <base> / path rewriting (those caused SPA redirect loops). For text/html
 *   only, may buffer and inject a tiny external shim script tag so window.open /
 *   target=_blank and clipboard fallback can reach the parent webview.
 * - Set-Cookie is intentionally dropped (logins don't persist via the proxy).
 */

/** Max HTML body size to buffer for shim injection (bytes). */
const HTML_INJECT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Served at /p/<token>/__bp_shim.js and referenced from injected script tags.
 * Bridges window.open / target=_blank and clipboard failures to the parent webview.
 */
const SHIM_JS =
	'(function(){' +
	'function abs(u){try{return new URL(u,location.href).href}catch(e){return null}}' +
	'function send(t,p){try{parent.postMessage(Object.assign({type:t},p),"*")}catch(e){}}' +
	'function openExt(u){var a=abs(u);if(a)send("openExternal",{url:a})}' +
	'window.open=function(u){if(u)openExt(u);return null};' +
	'document.addEventListener("click",function(e){' +
	'var t=e.target;while(t&&t.tagName!=="A")t=t.parentElement;if(!t)return;' +
	'var g=(t.getAttribute("target")||"").toLowerCase();' +
	'if(g==="_blank"||g==="_new"){e.preventDefault();e.stopPropagation();openExt(t.href)}' +
	'},true);' +
	'try{if(navigator.clipboard&&navigator.clipboard.writeText){' +
	'var w=navigator.clipboard.writeText.bind(navigator.clipboard);' +
	'navigator.clipboard.writeText=function(text){' +
	'return w(text).catch(function(){send("copy",{text:String(text)});return Promise.resolve()})' +
	'}}' +
	'}catch(e){}' +
	'})();';

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
	private _lastTarget: ProxyTarget | null = null;

	/**
	 * Whether to accept self-signed certificates (browser.acceptSelfSignedCerts).
	 * Read per request so setting changes apply without restarting the proxy.
	 */
	constructor(private readonly _acceptSelfSigned: () => boolean) {}

	get baseUrl(): string {
		return `http://127.0.0.1:${this._port}/p/${this._token}/`;
	}

	get listening(): boolean {
		return !!this._server;
	}

	private get _shimPath(): string {
		return '/p/' + this._token + '/__bp_shim.js';
	}

	async start(): Promise<void> {
		// Never leak a previous server (e.g. if start() is called twice in a row).
		if (this._server) {
			await this.dispose();
		}
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => this._handle(req, res));
			// Forward WebSocket upgrades (dev-server HMR etc.) to the target.
			server.on('upgrade', (req, socket, head) => this._handleUpgrade(req, socket, head));
			server.on('error', reject);
			server.listen(0, '127.0.0.1', () => {
				this._port = (server.address() as { port: number }).port;
				this._server = server;
				resolve();
			});
		});
	}

	dispose(): Promise<void> {
		return new Promise((resolve) => {
			const server = this._server;
			this._server = undefined;
			this._lastTarget = null;
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
			server.close(() => resolve());
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

	/** Resolve a request URL to a target: /p/<token>/... or a root-relative path against the last target. */
	private _resolveTarget(reqUrl: string): ProxyTarget | null {
		const parsed = this._parseTarget(reqUrl);
		if (parsed) {
			this._lastTarget = parsed;
			return parsed;
		}
		// Root-relative request from the currently proxied page (e.g. /_next/static/... or CSS
		// url(/x)): those resolve against the origin root and bypass <base>. Anything under
		// /p/ with a wrong token stays null (404).
		const last = this._lastTarget;
		if (!last || !reqUrl || reqUrl.startsWith('/p/')) {
			return null;
		}
		try {
			const url = new URL(reqUrl, last.url);
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
		this._rewriteOrigin(headers, target);
		// Next.js (and similar) send the current page URL in Next-Url; it must be
		// the target path, not /p/<token>/..., or the router disagrees with itself.
		const nextUrl = headers['next-url'];
		if (typeof nextUrl === 'string') {
			headers['next-url'] = this._toTargetPath(nextUrl, target);
		}
		return headers;
	}

	private _handleUpgrade(
		req: http.IncomingMessage,
		socket: import('stream').Duplex,
		head: Buffer
	): void {
		const target = this._resolveTarget(req.url || '');
		if (!target) {
			socket.destroy();
			return;
		}
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
			socket.write('HTTP/1.1 101 Switching Protocols\r\n');
			for (const [k, v] of Object.entries(res.headers)) {
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

	private _copyResponseHeaders(pres: http.IncomingMessage, target: ProxyTarget): http.OutgoingHttpHeaders {
		const outHeaders: http.OutgoingHttpHeaders = {};
		for (const [k, v] of Object.entries(pres.headers)) {
			const lk = k.toLowerCase();
			if (lk === 'x-frame-options' || lk === 'set-cookie') {
				continue; // strip frame-blocking; drop cookies (logins don't persist via proxy)
			}
			if (lk === 'content-security-policy') {
				const cleaned = (Array.isArray(v) ? v.join('; ') : String(v))
					.split(';')
					.map((d) => d.trim())
					.filter((d) => !/^frame-ancestors\b/i.test(d))
					.join('; ');
				if (cleaned) {
					outHeaders[k] = cleaned;
				}
				continue;
			}
			outHeaders[k] = v;
		}

		const status = pres.statusCode ?? 502;
		if (status >= 300 && status < 400 && outHeaders.location) {
			try {
				const locUrl = new URL(String(outHeaders.location), target.url);
				outHeaders.location =
					this.baseUrl +
					locUrl.protocol.slice(0, -1) +
					'/' +
					locUrl.host +
					(locUrl.pathname || '/') +
					(locUrl.search || '');
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
			return Buffer.from(zlib.gunzipSync(buf));
		}
		if (enc === 'deflate') {
			return Buffer.from(zlib.inflateSync(buf));
		}
		if (enc === 'br') {
			return Buffer.from(zlib.brotliDecompressSync(buf));
		}
		return buf;
	}

	/** Insert external shim script before </body> (or append). */
	private _injectShimTag(html: Buffer): Buffer {
		const tag = '<script src="' + this._shimPath + '"></script>';
		const s = html.toString('utf8');
		const lower = s.toLowerCase();
		const idx = lower.lastIndexOf('</body>');
		if (idx !== -1) {
			return Buffer.from(s.slice(0, idx) + tag + s.slice(idx), 'utf8');
		}
		return Buffer.from(s + tag, 'utf8');
	}

	private _pipeOrInjectHtml(
		pres: http.IncomingMessage,
		res: http.ServerResponse,
		target: ProxyTarget
	): void {
		const outHeaders = this._copyResponseHeaders(pres, target);
		const declaredLen = parseInt(String(pres.headers['content-length'] || ''), 10);
		// Known-large or non-HTML: stream unchanged (no shim).
		if (!this._isHtmlResponse(pres.headers) || (Number.isFinite(declaredLen) && declaredLen > HTML_INJECT_MAX_BYTES)) {
			res.writeHead(pres.statusCode ?? 502, outHeaders);
			pres.pipe(res);
			return;
		}

		const encoding = String(pres.headers['content-encoding'] || '');
		const chunks: Buffer[] = [];
		let size = 0;
		let passthrough = false;

		const startPassthrough = (firstOverflowChunk: Buffer) => {
			passthrough = true;
			res.writeHead(pres.statusCode ?? 502, outHeaders);
			for (const c of chunks) {
				res.write(c);
			}
			chunks.length = 0;
			res.write(firstOverflowChunk);
		};

		pres.on('data', (chunk: Buffer) => {
			if (passthrough) {
				res.write(chunk);
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
				buf = Buffer.from(this._injectShimTag(buf));
				delete outHeaders['content-encoding'];
				delete outHeaders['content-length'];
				outHeaders['content-length'] = buf.length;
				res.writeHead(pres.statusCode ?? 502, outHeaders);
				res.end(buf);
			} catch {
				delete outHeaders['content-length'];
				outHeaders['content-length'] = raw.length;
				res.writeHead(pres.statusCode ?? 502, outHeaders);
				res.end(raw);
			}
		});
	}

	private _handle(req: http.IncomingMessage, res: http.ServerResponse): void {
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

		const target = this._resolveTarget(reqUrl);
		if (!target) {
			res.writeHead(404);
			res.end('Not Found');
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
				this._pipeOrInjectHtml(pres, res, target);
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
