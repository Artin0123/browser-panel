'use strict';
/**
 * Unit checks for the proxy's pure-ish logic: CSP policy handling, shim
 * injection, crossorigin stripping, and the URL/header mapping rules.
 *
 * Why these and not the HTTP path: every rule here has already caused a field
 * bug (0.4.4 cache poisoning, the multi-policy CSP blank page, the CORS-mode
 * CDN bundle, the `/p/<token>/` leak into Next-Url), and none of them needs a
 * network round trip to pin down. The end-to-end behaviour (bounce, WebSocket,
 * streaming) is exercised against real servers out of tree — see docs/PROXY.md.
 *
 * No dependencies beyond esbuild, which is already the bundler: src/proxy.ts is
 * bundled to a throwaway CJS file and its exports are poked directly. The
 * TypeScript `private` marker does not exist at runtime, which is deliberate —
 * these are internal rules worth testing on their own.
 */
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const esbuild = require('esbuild');

const CACHE_DIR = path.join(__dirname, '.cache');
const BUNDLE = path.join(CACHE_DIR, 'proxy.bundle.cjs');
const JAR_BUNDLE = path.join(CACHE_DIR, 'cookie-jar.bundle.cjs');

fs.mkdirSync(CACHE_DIR, { recursive: true });
esbuild.buildSync({
	entryPoints: [path.join(__dirname, '..', 'src', 'proxy.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	outfile: BUNDLE,
	logLevel: 'silent',
});
esbuild.buildSync({
	entryPoints: [path.join(__dirname, '..', 'src', 'cookie-jar.ts')],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	outfile: JAR_BUNDLE,
	logLevel: 'silent',
});

const { FrameProxy, SHIM_JS } = require(BUNDLE);
const {
	CookieJar,
	domainMatch,
	defaultPath,
	pathMatch,
	MAX_COOKIES_PER_ORIGIN,
	MAX_COOKIES_TOTAL,
	MAX_JAR_SERIALIZED_BYTES,
} = require(JAR_BUNDLE);

let passed = 0;
const failures = [];

function eq(name, got, want) {
	const a = JSON.stringify(got);
	const b = JSON.stringify(want);
	if (a === b) {
		passed++;
		return;
	}
	failures.push(name + '\n    got:  ' + a + '\n    want: ' + b);
}

function ok(name, cond, detail) {
	if (cond) {
		passed++;
		return;
	}
	failures.push(name + (detail === undefined ? '' : '\n    ' + JSON.stringify(detail)));
}

function makeProxy() {
	const p = new FrameProxy(() => false);
	p._port = 4599; // baseUrl is only assembled from this; no server is started
	return p;
}

const p = makeProxy();
const TOKEN = p._token;
const BASE = p.baseUrl; // http://127.0.0.1:4599/p/<token>/
const TARGET = { url: new URL('https://site.test/app/page?x=1') };

function fakeReq(headers) {
	return { headers };
}

function fakeRes(status, headers, rawHeaders) {
	return { statusCode: status, headers, rawHeaders };
}

// ---------------------------------------------------------------------------
// The injected shim: the one thing no compiler checks (it is a string).
// ---------------------------------------------------------------------------
ok('SHIM_JS parses as JavaScript', (() => {
	try {
		new Function(SHIM_JS);
		return true;
	} catch (e) {
		return false;
	}
})(), SHIM_JS.length);
ok('SHIM_JS is one self-invoking wrapper',
	SHIM_JS.startsWith('(function(){') && SHIM_JS.trimEnd().endsWith('})();'),
	SHIM_JS.slice(0, 40) + ' … ' + SHIM_JS.slice(-40));
for (const hook of ['openExt', 'hrefOf', 'realUrl', 'inPanel', 'crossOrigin', 'postMessage']) {
	ok('SHIM_JS defines ' + hook, SHIM_JS.includes(hook));
}
ok('SHIM_JS reads its own ?bp= mapping', SHIM_JS.includes('document.currentScript'));

// Execute SHIM_JS in a minimal mocked browser context to verify clipboard fallbacks.
{
	const posted = [];
	function Document() {}
	Document.prototype.execCommand = () => false;
	const doc = new Document();
	doc.currentScript = { src: 'http://127.0.0.1:4599/p/' + TOKEN + '/__bp_shim.js?bp=' + encodeURIComponent(JSON.stringify({ origin: 'https://site.test', prefix: '/p/' + TOKEN + '/' })) };
	doc.addEventListener = () => {};
	doc.activeElement = { tagName: 'TEXTAREA', value: 'copied-via-exec', selectionStart: 0, selectionEnd: 15 };

	const ctx = {
		URL,
		Document,
		document: doc,
		location: { href: 'http://127.0.0.1:4599/', origin: 'http://127.0.0.1:4599', pathname: '/', search: '', hash: '' },
		history: { pushState() {}, replaceState() {} },
		parent: { postMessage(m) { posted.push(m); } },
		navigator: {
			clipboard: {
				writeText: () => Promise.reject(new Error('NotAllowedError')),
				write: () => Promise.reject(new Error('NotAllowedError')),
			},
			permissions: {
				query: (d) => Promise.resolve({ state: d.name === 'clipboard-write' ? 'denied' : 'prompt' }),
			},
		},
		addEventListener: () => {},
		setTimeout,
		getSelection: () => '',
	};
	ctx.window = ctx;
	vm.runInNewContext(SHIM_JS, ctx);

	// 1. execCommand('copy') fallback
	const execOk = doc.execCommand('copy');
	eq('SHIM_JS execCommand("copy") returns true on fallback', execOk, true);
	ok('SHIM_JS execCommand("copy") relays selected textarea text',
		posted.some((m) => m.type === 'copy' && m.text === 'copied-via-exec'), posted);

	// 2. writeText, write(ClipboardItem), permissions.query
	globalThis.__shimChecks = Promise.all([
		ctx.navigator.clipboard.writeText('hello-wt'),
		ctx.navigator.clipboard.write([{
			types: ['text/plain'],
			getType: () => Promise.resolve({ text: () => Promise.resolve('hello-wr') }),
		}]),
		ctx.navigator.permissions.query({ name: 'clipboard-write' }),
		ctx.navigator.permissions.query({ name: 'geolocation' }),
	]).then(([, , cw, geo]) => {
		ok('SHIM_JS writeText fallback relays copy',
			posted.some((m) => m.type === 'copy' && m.text === 'hello-wt'));
		ok('SHIM_JS write(ClipboardItem) fallback relays text/plain',
			posted.some((m) => m.type === 'copy' && m.text === 'hello-wr'));
		eq('SHIM_JS permissions.query("clipboard-write") grants when denied', cw.state, 'granted');
		eq('SHIM_JS permissions.query leaves other permissions untouched', geo.state, 'prompt');
	});
}

// ---------------------------------------------------------------------------
// Shim URL + target parsing.
// ---------------------------------------------------------------------------
ok('_shimSrc points at the shim path', p._shimSrc(TARGET).startsWith('/p/' + TOKEN + '/__bp_shim.js?bp='));
{
	const bp = JSON.parse(decodeURIComponent(p._shimSrc(TARGET).split('?bp=')[1]));
	eq('_shimSrc ?bp= describes target origin + prefix', bp, {
		origin: 'https://site.test',
		prefix: '/p/' + TOKEN + '/',
	});
}
eq('_parseTarget keeps path + query',
	p._parseTarget('/p/' + TOKEN + '/https/site.test/a/b?q=1').url.href, 'https://site.test/a/b?q=1');
eq('_parseTarget defaults an empty path to /',
	p._parseTarget('/p/' + TOKEN + '/http/h.test').url.href, 'http://h.test/');
eq('_parseTarget rejects a foreign token', p._parseTarget('/p/nope/https/site.test/'), null);
eq('_parseTarget rejects a non-http scheme', p._parseTarget('/p/' + TOKEN + '/ftp/site.test/'), null);
eq('_parseTarget rejects a truncated prefix', p._parseTarget('/p/' + TOKEN + '/https'), null);

// ---------------------------------------------------------------------------
// Per-target Host resolution — the open-proxy / SSRF gate.
// ---------------------------------------------------------------------------
{
	const fresh = makeProxy();
	eq('_resolveTarget has no target before any registration', fresh._resolveTarget({ url: '/x', headers: {} }), null);
	eq('_resolveTarget rejects unregistered t-<id>.localhost',
		fresh._resolveTarget({ url: '/x', headers: { host: 't-0123456789ab.localhost:4599' } }), null);
}
{
	const fresh = makeProxy();
	const fakeReq = (url, host) => ({ url, headers: host ? { host } : {} });
	eq('_resolveTarget accepts the explicit target form',
		fresh._resolveTarget(fakeReq('/p/' + fresh._token + '/https/site.test/x')).url.href, 'https://site.test/x');
	const siteHost = fresh._registerTarget(new URL('https://site.test')).proxyOrigin.slice('http://'.length);
	const otherHost = fresh._registerTarget(new URL('https://other.test')).proxyOrigin.slice('http://'.length);
	ok('two different origins get distinct t-<id>.localhost hosts', siteHost !== otherHost, [siteHost, otherHost]);
	eq('_isAllowedHost accepts registered t-<id>.localhost', fresh._isAllowedHost(siteHost), true);
	eq('_isAllowedHost rejects unregistered t-<id>.localhost', fresh._isAllowedHost('t-ffffffffffff.localhost:4599'), false);
	eq('_resolveTarget resolves root-relative path against Host target',
		fresh._resolveTarget(fakeReq('/y/z?k=2', siteHost)).url.href, 'https://site.test/y/z?k=2');
	eq('_resolveTarget isolates second target simultaneously',
		fresh._resolveTarget(fakeReq('/only-other', otherHost)).url.href, 'https://other.test/only-other');
	eq('_resolveTarget still resolves first target after second was registered',
		fresh._resolveTarget(fakeReq('/still-site', siteHost)).url.href, 'https://site.test/still-site');
	eq('_resolveTarget rejects protocol-relative //host', fresh._resolveTarget(fakeReq('//evil.test/x', siteHost)), null);
	eq('_resolveTarget rejects absolute-form http://host', fresh._resolveTarget(fakeReq('http://evil.test/x', siteHost)), null);
	eq('_resolveTarget rejects backslash tricks', fresh._resolveTarget(fakeReq('/a\\b', siteHost)), null);
	eq('_resolveTarget rejects another token', fresh._resolveTarget(fakeReq('/p/othertok/https/evil.test/x', siteHost)), null);
}

// ---------------------------------------------------------------------------
// _toTargetPath: proxy space must never leak into Next-Url / Referer.
// ---------------------------------------------------------------------------
eq('_toTargetPath unwraps a proxy path',
	p._toTargetPath('/p/' + TOKEN + '/http/other.test/p?q=1', TARGET), '/p?q=1');
eq('_toTargetPath unwraps a proxy URL',
	p._toTargetPath('http://127.0.0.1:4599/p/' + TOKEN + '/https/other.test/p', TARGET), '/p');
eq('_toTargetPath leaves a plain path alone', p._toTargetPath('/next?x=1', TARGET), '/next?x=1');
eq('_toTargetPath maps the root', p._toTargetPath('/p/' + TOKEN + '/https/site.test/', TARGET), '/');
eq('_toTargetPath keeps a foreign absolute URL verbatim',
	p._toTargetPath('https://foreign.test/x?y', TARGET), 'https://foreign.test/x?y');
eq('_toTargetPath folds a same-origin absolute URL',
	p._toTargetPath('https://site.test/same?z', TARGET), '/same?z');

// ---------------------------------------------------------------------------
// Sec-Fetch-Dest: the server-side framing veto (Google 403).
// ---------------------------------------------------------------------------
{
	const h = { 'sec-fetch-dest': 'iframe' };
	p._rewriteSecFetchDest(h);
	eq('_rewriteSecFetchDest maps iframe -> document', h['sec-fetch-dest'], 'document');
}
{
	const h = { 'sec-fetch-dest': 'FRAME' };
	p._rewriteSecFetchDest(h);
	eq('_rewriteSecFetchDest maps FRAME -> document (case-insensitive)', h['sec-fetch-dest'], 'document');
}
for (const dest of ['document', 'empty', 'script', 'serviceworker']) {
	const h = { 'sec-fetch-dest': dest };
	p._rewriteSecFetchDest(h);
	eq('_rewriteSecFetchDest leaves ' + dest + ' alone', h['sec-fetch-dest'], dest);
}
{
	const h = {};
	p._rewriteSecFetchDest(h);
	eq('_rewriteSecFetchDest never invents the header', 'sec-fetch-dest' in h, false);
}

// ---------------------------------------------------------------------------
// Outgoing request headers.
// ---------------------------------------------------------------------------
{
	const out = p._outgoingHeaders(fakeReq({
		host: '127.0.0.1:4599',
		cookie: 'a=1',
		accept: '*/*',
		origin: BASE,
		referer: BASE + 'https/site.test/app/page',
		'next-url': BASE + 'https/site.test/app/page',
		'sec-fetch-dest': 'iframe',
		'sec-fetch-site': 'cross-site',
		'accept-encoding': 'zstd',
		connection: 'keep-alive',
	}), TARGET);
	eq('_outgoingHeaders points Host at the target', out.host, 'site.test');
	eq('_outgoingHeaders drops cookies', 'cookie' in out, false);
	eq('_outgoingHeaders drops hop-by-hop connection', 'connection' in out, false);
	eq('_outgoingHeaders keeps unrelated headers', out.accept, '*/*');
	eq('_outgoingHeaders rewrites Origin to the target', out.origin, 'https://site.test');
	eq('_outgoingHeaders rewrites Referer into target space', out.referer, 'https://site.test/app/page');
	eq('_outgoingHeaders strips the proxy prefix from Next-Url', out['next-url'], '/app/page');
	eq('_outgoingHeaders clears the framing veto', out['sec-fetch-dest'], 'document');
	eq('_outgoingHeaders leaves Sec-Fetch-Site alone', out['sec-fetch-site'], 'cross-site');
	ok('_outgoingHeaders advertises a decodable Accept-Encoding',
		/gzip/.test(String(out['accept-encoding'])) && String(out['accept-encoding']) !== 'zstd',
		out['accept-encoding']);
}
eq('_outgoingHeaders survives a broken Referer', (() => {
	const out = p._outgoingHeaders(fakeReq({ referer: 'not a url' }), TARGET);
	return out.referer;
})(), 'https://site.test/');

// ---------------------------------------------------------------------------
// CSP: one header value may carry several policies, each enforced separately.
// ---------------------------------------------------------------------------
eq('_splitCspList splits a packed header value',
	FrameProxy._splitCspList("script-src 'self', require-trusted-types-for 'script'"),
	["script-src 'self'", "require-trusted-types-for 'script'"]);
eq('_splitCspList splits inside an array too', FrameProxy._splitCspList(['a, b']), ['a', 'b']);
eq('_splitCspList tolerates undefined', FrameProxy._splitCspList(undefined), []);
eq('_splitCspList drops empty entries', FrameProxy._splitCspList('  ,  '), []);

eq('_cspPolicies keeps repeated headers apart and strips frame-ancestors', p._cspPolicies(fakeRes(200, {
	'content-security-policy': "script-src 'self'; frame-ancestors 'none', require-trusted-types-for 'script'",
}, [
	'Content-Security-Policy', "script-src 'self'; frame-ancestors 'none'",
	'Content-Security-Policy', "require-trusted-types-for 'script'",
	'Content-Type', 'text/html',
])), ["script-src 'self'", "require-trusted-types-for 'script'"]);
eq('_cspPolicies falls back to pres.headers',
	p._cspPolicies(fakeRes(200, { 'content-security-policy': "default-src 'self'" })),
	["default-src 'self'"]);
eq('_cspPolicies drops a frame-ancestors-only policy',
	p._cspPolicies(fakeRes(200, { 'content-security-policy': "frame-ancestors 'none'" })), []);
eq('_cspPolicies returns nothing when there is no CSP',
	p._cspPolicies(fakeRes(200, { 'content-type': 'text/html' })), []);

eq('_cspForShim lifts a nonce from the first policy', p._cspForShim([
	"script-src 'report-sample' 'nonce-AAA' 'unsafe-inline'; object-src 'none'; base-uri 'self'",
	"require-trusted-types-for 'script'; report-uri /r",
]), {
	policies: [
		"script-src 'report-sample' 'nonce-AAA' 'unsafe-inline'; object-src 'none'; base-uri 'self'",
		"require-trusted-types-for 'script'; report-uri /r",
	],
	nonce: 'AAA',
});
eq('_cspForShim lifts a nonce from a later policy too (the multi-policy blank-page bug)', p._cspForShim([
	"require-trusted-types-for 'script'; report-uri /r",
	"script-src 'report-sample' 'nonce-BBB' 'unsafe-inline'",
]), {
	policies: [
		"require-trusted-types-for 'script'; report-uri /r",
		"script-src 'report-sample' 'nonce-BBB' 'unsafe-inline'",
	],
	nonce: 'BBB',
});
eq("_cspForShim never widens a policy that already allows 'self'",
	p._cspForShim(["script-src 'self' https://cdn.test"]),
	{ policies: ["script-src 'self' https://cdn.test"], nonce: '' });
eq('_cspForShim appends to default-src rather than adding script-src',
	p._cspForShim(["default-src 'none'"]),
	{ policies: ["default-src 'none' 'self'"], nonce: '' });
eq('_cspForShim leaves a policy that restricts neither alone',
	p._cspForShim(["img-src *; style-src 'unsafe-inline'"]),
	{ policies: ["img-src *; style-src 'unsafe-inline'"], nonce: '' });
eq('_cspForShim refuses to pick between two different nonces', p._cspForShim([
	"script-src 'nonce-AAA'",
	"script-src 'nonce-BBB'",
]), { policies: ["script-src 'nonce-AAA' 'self'", "script-src 'nonce-BBB' 'self'"], nonce: '' });
eq('_cspForShim reuses a nonce that only one policy needs', p._cspForShim([
	"script-src 'nonce-AAA'",
	"script-src 'self'",
]), { policies: ["script-src 'nonce-AAA'", "script-src 'self'"], nonce: 'AAA' });

// ---------------------------------------------------------------------------
// crossorigin stripping (CORS-mode CDN loads fail behind the proxy).
// ---------------------------------------------------------------------------
eq('_stripCrossOrigin drops the attribute from a script',
	p._stripCrossOrigin('<script crossorigin src="a.js"></script>'), '<script src="a.js"></script>');
eq('_stripCrossOrigin drops an unquoted value too',
	p._stripCrossOrigin('<script crossorigin=anonymous src="a.js"></script>'), '<script src="a.js"></script>');
eq('_stripCrossOrigin keeps it next to integrity (SRI over no-cors cannot pass)',
	p._stripCrossOrigin('<script crossorigin="anonymous" integrity="sha384-x" src="a.js"></script>'),
	'<script crossorigin="anonymous" integrity="sha384-x" src="a.js"></script>');
eq('_stripCrossOrigin keeps a font preload', p._stripCrossOrigin('<link rel="preload" as="font" crossorigin="anonymous" href="f.woff2">'),
	'<link rel="preload" as="font" crossorigin="anonymous" href="f.woff2">');
eq('_stripCrossOrigin leaves non script/link tags alone',
	p._stripCrossOrigin('<img crossorigin="anonymous" src="i.png">'), '<img crossorigin="anonymous" src="i.png">');
eq('_stripCrossOrigin is a no-op without the attribute',
	p._stripCrossOrigin('<p>hi</p>'), '<p>hi</p>');

// ---------------------------------------------------------------------------
// Shim injection points.
// ---------------------------------------------------------------------------
{
	const r = p._injectShimTag(Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head></html>'),
		TARGET, undefined);
	const html = r.html.toString('utf8');
	ok('_injectShimTag inserts right after <head>', html.includes('<head><script src="/p/' + TOKEN + '/__bp_shim.js'),
		html);
	ok('_injectShimTag injects exactly once', html.split('__bp_shim.js').length === 2, html);
}
{
	const html = p._injectShimTag(Buffer.from('<html lang="en"><head lang="x">'), TARGET, undefined)
		.html.toString('utf8');
	ok('_injectShimTag survives attributes on <head>', /<head lang="x"><script src=/.test(html), html);
}
{
	const html = p._injectShimTag(Buffer.from('<body><header>h</header></body>'), TARGET, undefined)
		.html.toString('utf8');
	ok('_injectShimTag does not mistake <header> for <head>', html.indexOf('<script') === 0, html);
}
{
	const html = p._injectShimTag(Buffer.from('<html><body>x'), TARGET, undefined).html.toString('utf8');
	ok('_injectShimTag falls back to <html>', /^<html><script src=/.test(html), html);
}
{
	const html = p._injectShimTag(Buffer.from('<!DOCTYPE html><p>x'), TARGET, undefined).html.toString('utf8');
	ok('_injectShimTag falls back to after the doctype (no quirks mode)', /^<!DOCTYPE html><script src=/.test(html), html);
}
{
	const r = p._injectShimTag(Buffer.from('<head></head>'), TARGET, "script-src 'nonce-ZZZ'");
	const html = r.html.toString('utf8');
	ok('_injectShimTag puts the lifted nonce on the tag', html.includes('<script nonce="ZZZ" src='), html);
	eq('_injectShimTag returns the policies it enforced', r.policies, ["script-src 'nonce-ZZZ'"]);
}

// ---------------------------------------------------------------------------
// Response headers: framing, cookies, cache poisoning, redirects.
// ---------------------------------------------------------------------------
{
	const out = p._copyResponseHeaders(fakeRes(200, {
		'x-frame-options': 'DENY',
		'set-cookie': ['sid=1; Path=/'],
		'cache-control': 'max-age=60',
		expires: 'Thu, 01 Jan 1970 00:00:00 GMT',
		pragma: 'cache',
		'transfer-encoding': 'chunked',
		'content-type': 'text/html',
		'content-security-policy': "script-src 'self'; frame-ancestors 'none'",
		'content-length': '10',
	}), TARGET);
	eq('_copyResponseHeaders strips X-Frame-Options', 'x-frame-options' in out, false);
	eq('_copyResponseHeaders drops Set-Cookie (proxy never persists logins)', 'set-cookie' in out, false);
	eq('_copyResponseHeaders preserves upstream cache-control (per-target origin)', out['cache-control'], 'max-age=60');
	eq('_copyResponseHeaders preserves validators', ['expires' in out, 'pragma' in out], [true, true]);
	eq('_copyResponseHeaders drops hop-by-hop transfer-encoding', 'transfer-encoding' in out, false);
	eq('_copyResponseHeaders keeps the body headers', out['content-type'], 'text/html');
	eq('_copyResponseHeaders strips frame-ancestors only', out['content-security-policy'], "script-src 'self'");
}
eq('_copyResponseHeaders keeps a same-origin redirect root-relative',
	p._copyResponseHeaders(fakeRes(301, { location: 'https://site.test/new?x=1#frag' }), TARGET).location,
	'/new?x=1#frag');
eq('_copyResponseHeaders keeps a relative redirect relative',
	p._copyResponseHeaders(fakeRes(302, { location: '/rel' }), TARGET).location, '/rel');
eq('_copyResponseHeaders routes a cross-origin redirect to its per-target origin',
	p._copyResponseHeaders(fakeRes(302, { location: 'https://other.test/y?z' }), TARGET).location,
	p._registerTarget(new URL('https://other.test')).proxyOrigin + '/y?z');
eq('_copyResponseHeaders drops an unparseable Location',
	p._copyResponseHeaders(fakeRes(302, { location: 'http://[::1' }), TARGET).location, undefined);
eq('_copyResponseHeaders leaves a Location-less redirect alone',
	p._copyResponseHeaders(fakeRes(302, {}), TARGET).location, undefined);

eq('_isHtmlResponse matches text/html with parameters',
	p._isHtmlResponse({ 'content-type': 'text/html; charset=utf-8' }), true);
eq('_isHtmlResponse rejects JSON', p._isHtmlResponse({ 'content-type': 'application/json' }), false);

// ---------------------------------------------------------------------------
// CookieJar: RFC 6265 subset, eviction, serialization, and proxy wiring.
// ---------------------------------------------------------------------------
eq('defaultPath /a/b/c -> /a/b', defaultPath('/a/b/c'), '/a/b');
eq('defaultPath /a -> /', defaultPath('/a'), '/');
eq('defaultPath / -> /', defaultPath('/'), '/');
eq('domainMatch exact', domainMatch('app.site.test', 'app.site.test'), true);
eq('domainMatch subdomain', domainMatch('app.site.test', 'site.test'), true);
eq('domainMatch rejects partial label', domainMatch('badsite.test', 'site.test'), false);
eq('domainMatch rejects IP suffix', domainMatch('10.127.0.0.1', '127.0.0.1'), false);
eq('pathMatch /foo vs /foobar is false', pathMatch('/foobar', '/foo'), false);
eq('pathMatch /foo vs /foo/bar is true', pathMatch('/foo/bar', '/foo'), true);
eq('pathMatch /foo vs /foo is true', pathMatch('/foo', '/foo'), true);

{
	const jar = new CookieJar();
	const u = new URL('https://app.site.test/sub/page');
	const t0 = 1_000_000;

	// Basic receive + default-path + hostOnly
	jar.receive(u, 'sid=abc; HttpOnly; SameSite=Strict', true, t0);
	eq('jar sends hostOnly cookie on matching path', jar.send(new URL('https://app.site.test/sub/other'), true, t0 + 1), 'sid=abc');
	eq('jar omits cookie on parent path', jar.send(new URL('https://app.site.test/'), true, t0 + 1), '');
	eq('jar isolates by targetOrigin', jar.send(new URL('http://app.site.test/sub/other'), false, t0 + 1), '');

	// Domain attribute: reject mismatch, accept parent domain
	jar.receive(u, 'bad=1; Domain=evil.test', true, t0 + 2);
	jar.receive(u, 'shared=xyz; Domain=.site.test; Path=/', true, t0 + 3);
	eq('jar rejects mismatched Domain and sorts longer path first',
		jar.send(new URL('https://app.site.test/sub/x'), true, t0 + 4),
		'sid=abc; shared=xyz');

	// Replace same key preserves createdAt
	jar.receive(u, 'sid=def', true, t0 + 10);
	eq('jar replaces same (name, domain, path) value',
		jar.send(new URL('https://app.site.test/sub/x'), true, t0 + 11),
		'sid=def; shared=xyz');

	// Max-Age overrides Expires; Max-Age=0 deletes
	jar.receive(u, 'sid=gone; Max-Age=0; Expires=Wed, 21 Oct 2099 07:28:00 GMT', true, t0 + 20);
	eq('Max-Age=0 deletes cookie even with future Expires',
		jar.send(new URL('https://app.site.test/sub/x'), true, t0 + 21),
		'shared=xyz');

	// Secure flag only sent over https
	const httpUrl = new URL('http://local.test:3080/');
	jar.receive(httpUrl, 'sec=1; Secure; Path=/', false, t0 + 30);
	eq('Secure cookie withheld on http', jar.send(httpUrl, false, t0 + 31), '');
	eq('Secure cookie sent when isHttps=true', jar.send(httpUrl, true, t0 + 31), 'sec=1');

	// Malformed / empty values do not throw
	jar.receive(u, '', true, t0 + 40);
	jar.receive(u, '   =nope', true, t0 + 40);
	jar.receive(u, 'noequals', true, t0 + 40);
	jar.load('not json{{{');
	jar.load('[]');
	ok('jar survives malformed inputs', jar.size() >= 2);
}

// Per-origin & global eviction + 64KB serialization cap + roundtrip
{
	const jar = new CookieJar();
	const u = new URL('https://limit.test/');
	const t0 = 2_000_000;
	for (let i = 0; i < MAX_COOKIES_PER_ORIGIN + 10; i++) {
		jar.receive(u, `c${i}=v${i}; Path=/`, true, t0 + i);
	}
	eq('jar caps per-origin cookies', jar.size(), MAX_COOKIES_PER_ORIGIN);
	const sent = jar.send(u, true, t0 + 1000);
	ok('oldest lastUsed evicted first (c0 gone, newest kept)', !sent.includes('c0=') && sent.includes(`c${MAX_COOKIES_PER_ORIGIN + 9}=`));

	// Global cap
	for (let o = 0; o < 10; o++) {
		const ou = new URL(`https://origin${o}.test/`);
		for (let i = 0; i < 40; i++) {
			jar.receive(ou, `k${i}=v${i}; Path=/`, true, t0 + 2000 + o * 100 + i);
		}
	}
	eq('jar caps global cookies', jar.size(), MAX_COOKIES_TOTAL);

	// Serialize/load roundtrip + merge mode (startup race protection)
	const json = jar.serialize(t0 + 5000);
	ok('serialized jar respects 64KB cap', Buffer.byteLength(json, 'utf8') <= MAX_JAR_SERIALIZED_BYTES);
	const restored = new CookieJar();
	restored.load(json, t0 + 5000);
	eq('restored jar preserves cookie count', restored.size(), jar.size());

	const raced = new CookieJar();
	const racedUrl = new URL('https://origin0.test/');
	raced.receive(racedUrl, 'k0=newer; Path=/', true, t0 + 6000);
	raced.load(json, t0 + 6000, true);
	eq('merge load preserves newer in-memory cookie while restoring others',
		raced.send(racedUrl, true, t0 + 6001).split('; ').includes('k0=newer'), true);
	eq('merge load restores remaining persisted cookies', raced.size(), MAX_COOKIES_TOTAL);
}

// FrameProxy + CookieJar wiring (enabled vs disabled)
{
	const jar = new CookieJar();
	let enabled = true;
	const jp = new FrameProxy(() => false, jar, () => enabled);
	const dshTarget = { url: new URL('http://127.0.0.1:3080/') };

	// rawHeaders keeps Set-Cookie with comma in Expires intact
	const resHeaders = jp._copyResponseHeaders(fakeRes(303, {
		'set-cookie': ['dsh-auth=v1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/; HttpOnly; SameSite=Strict'],
	}, [
		'Set-Cookie', 'dsh-auth=v1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/; HttpOnly; SameSite=Strict',
		'Set-Cookie', 'extra=2; Path=/',
	]), dshTarget);
	eq('FrameProxy with jar still strips Set-Cookie from browser response', 'set-cookie' in resHeaders, false);

	const outReq = jp._outgoingHeaders(fakeReq({ cookie: 'browser=untrusted' }), dshTarget);
	eq('FrameProxy attaches jar cookies and ignores browser cookie', outReq.cookie, 'dsh-auth=v1; extra=2');

	// Toggling off disables send/receive immediately
	enabled = false;
	const outDisabled = jp._outgoingHeaders(fakeReq({ cookie: 'browser=untrusted' }), dshTarget);
	eq('FrameProxy with jar disabled drops cookies as before', 'cookie' in outDisabled, false);
}

// ---------------------------------------------------------------------------
// Child iframe rewrite & shim relay (browser.proxyIframeRewrite).
// ---------------------------------------------------------------------------
{
	const irp = new FrameProxy(() => false, undefined, () => false, () => true);
	irp._port = 4599;
	const IR_TOK = irp._token;

	// _rewriteIframeSrcs cases
	eq('_rewriteIframeSrcs rewrites same-origin double-quoted src',
		irp._rewriteIframeSrcs('<iframe src="https://site.test/sub/a?x=1#h"></iframe>', TARGET),
		'<iframe src="/sub/a?x=1#h"></iframe>');
	eq('_rewriteIframeSrcs rewrites same-origin single-quoted src',
		irp._rewriteIframeSrcs("<IFRAME id='f' SRC='https://site.test/b'></IFRAME>", TARGET),
		"<IFRAME id='f' SRC='/b'></IFRAME>");
	eq('_rewriteIframeSrcs rewrites same-origin unquoted src',
		irp._rewriteIframeSrcs('<iframe src=https://site.test/c></iframe>', TARGET),
		'<iframe src="/c"></iframe>');
	eq('_rewriteIframeSrcs rewrites cross-origin iframe to per-target origin',
		irp._rewriteIframeSrcs('<iframe src="https://accounts.google.com/o/oauth2"></iframe>', TARGET),
		`<iframe src="${irp._registerTarget(new URL('https://accounts.google.com')).proxyOrigin}/o/oauth2"></iframe>`);
	eq('_rewriteIframeSrcs leaves /p/ prefix, root-relative, srcdoc, about:blank, javascript:, data-src alone',
		irp._rewriteIframeSrcs(
			`<iframe src="/p/${IR_TOK}/https/site.test/x"></iframe>` +
			'<iframe src="/already"></iframe>' +
			'<iframe srcdoc="<p>hi</p>"></iframe>' +
			'<iframe src="about:blank"></iframe>' +
			'<iframe src="javascript:void(0)"></iframe>' +
			'<iframe data-src="https://site.test/lazy"></iframe>' +
			'<iframe></iframe>',
			TARGET
		),
		`<iframe src="/p/${IR_TOK}/https/site.test/x"></iframe>` +
		'<iframe src="/already"></iframe>' +
		'<iframe srcdoc="<p>hi</p>"></iframe>' +
		'<iframe src="about:blank"></iframe>' +
		'<iframe src="javascript:void(0)"></iframe>' +
		'<iframe data-src="https://site.test/lazy"></iframe>' +
		'<iframe></iframe>');
	eq('_rewriteIframeSrcs survives malformed URL',
		irp._rewriteIframeSrcs('<iframe src="http://[::1"></iframe>', TARGET),
		'<iframe src="http://[::1"></iframe>');

	// Opt-in gating in _injectShimTag & _shimSrc
	const disabledHtml = p._injectShimTag(Buffer.from('<head></head><iframe src="https://site.test/sub"></iframe>'), TARGET, undefined).html.toString('utf8');
	ok('iframeRewrite off leaves same-origin iframe untouched', disabledHtml.includes('src="https://site.test/sub"'), disabledHtml);
	const enabledHtml = irp._injectShimTag(Buffer.from('<head></head><iframe src="https://site.test/sub"></iframe>'), TARGET, undefined).html.toString('utf8');
	ok('iframeRewrite on rewrites same-origin iframe in HTML', enabledHtml.includes('<iframe src="/sub">'), enabledHtml);
	const bpEnabled = JSON.parse(decodeURIComponent(irp._shimSrc(TARGET).split('?bp=')[1]));
	eq('_shimSrc includes iframeRewrite:true when enabled', bpEnabled.iframeRewrite, true);

	// Shipped SHIM_JS assertions
	for (const token of ['MutationObserver', 'attributeFilter:["src"]', 'HTMLIFrameElement', 'HTMLFrameElement']) {
		ok('SHIM_JS includes ' + token, SHIM_JS.includes(token));
	}

	// Execute SHIM_JS with iframeRewrite=true & empty prefix to test P2/P3/P4
	const posted = [];
	const listeners = {};
	function Document() {}
	Document.prototype.execCommand = () => false;
	function HTMLIFrameElement() {}
	let rawSrc = '';
	Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
		configurable: true,
		enumerable: true,
		get() { return rawSrc; },
		set(v) { rawSrc = v; },
	});
	const doc = new Document();
	doc.currentScript = {
		src: 'http://127.0.0.1:4599/p/' + TOKEN + '/__bp_shim.js?bp=' +
			encodeURIComponent(JSON.stringify({ origin: 'https://site.test', prefix: '/p/' + TOKEN + '/', iframeRewrite: true })),
	};
	doc.addEventListener = () => {};
	doc.querySelectorAll = () => [];
	doc.documentElement = {};

	const ctx = {
		URL,
		Document,
		HTMLIFrameElement,
		document: doc,
		location: { href: 'http://127.0.0.1:4599/', origin: 'http://127.0.0.1:4599', pathname: '/', search: '', hash: '' },
		history: { pushState() {}, replaceState() {} },
		parent: { postMessage(m) { posted.push(m); } },
		navigator: {},
		addEventListener: (ev, fn) => { listeners[ev] = listeners[ev] || []; listeners[ev].push(fn); },
		setTimeout,
	};
	ctx.window = ctx;
	vm.createContext(ctx);
	vm.runInContext(SHIM_JS, ctx);
	const vmWindow = vm.runInContext('window', ctx);

	// P2: HTMLIFrameElement.prototype.src setter rewrites same-origin URL synchronously
	const frameEl = new HTMLIFrameElement();
	frameEl.src = 'https://site.test/embed?a=1';
	eq('SHIM_JS HTMLIFrameElement.src setter rewrites same-origin to root-relative', rawSrc, '/embed?a=1');
	frameEl.src = 'https://other.test/embed';
	eq('SHIM_JS HTMLIFrameElement.src setter rewrites cross-origin via prefix',
		rawSrc, 'http://127.0.0.1:4599/p/' + TOKEN + '/https/other.test/embed');

	// P3: relay openExternal & copy, NEVER relay pageNavigated
	posted.length = 0;
	const childWin = {};
	for (const fn of listeners.message || []) {
		fn({ source: childWin, data: { type: 'openExternal', url: 'https://ext.test/' } });
		fn({ source: childWin, data: { type: 'copy', text: 'from-child' } });
		fn({ source: childWin, data: { type: 'pageNavigated', url: 'https://site.test/child' } });
		fn({ source: vmWindow, data: { type: 'openExternal', url: 'https://self-loop.test/' } });
	}
	ok('SHIM_JS relays child openExternal', posted.some((m) => m.type === 'openExternal' && m.url === 'https://ext.test/'), posted);
	ok('SHIM_JS relays child copy', posted.some((m) => m.type === 'copy' && m.text === 'from-child'), posted);
	eq('SHIM_JS never relays child pageNavigated', posted.some((m) => m.type === 'pageNavigated'), false);
	eq('SHIM_JS ignores message from self', posted.some((m) => m.url === 'https://self-loop.test/'), false);
}

// ---------------------------------------------------------------------------
try {
	fs.unlinkSync(BUNDLE);
	fs.unlinkSync(JAR_BUNDLE);
} catch {
	/* best effort: it is regenerated on every run */
}

Promise.resolve(globalThis.__shimChecks).then(() => {
	const total = passed + failures.length;
	if (failures.length > 0) {
		console.error('\n' + failures.length + ' of ' + total + ' checks FAILED:\n');
		for (const f of failures) {
			console.error('  FAIL ' + f);
		}
		process.exitCode = 1;
	} else {
		console.log('proxy units: all ' + total + ' checks passed');
	}
});
