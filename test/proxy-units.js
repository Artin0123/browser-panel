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
const esbuild = require('esbuild');

const CACHE_DIR = path.join(__dirname, '.cache');
const BUNDLE = path.join(CACHE_DIR, 'proxy.bundle.cjs');

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

const { FrameProxy, SHIM_JS } = require(BUNDLE);

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
// Root-relative resolution — the open-proxy / SSRF gate.
// ---------------------------------------------------------------------------
{
	const fresh = makeProxy();
	eq('_resolveTarget has no target before any navigation', fresh._resolveTarget('/x'), null);
}
{
	const fresh = makeProxy();
	eq('_resolveTarget accepts the explicit target form',
		fresh._resolveTarget('/p/' + fresh._token + '/https/site.test/x').url.href, 'https://site.test/x');
	eq('_resolveTarget resolves a root-relative path against the last target',
		fresh._resolveTarget('/y/z?k=2').url.href, 'https://site.test/y/z?k=2');
	eq('_resolveTarget rejects protocol-relative //host', fresh._resolveTarget('//evil.test/x'), null);
	eq('_resolveTarget rejects absolute-form http://host', fresh._resolveTarget('http://evil.test/x'), null);
	eq('_resolveTarget rejects backslash tricks', fresh._resolveTarget('/a\\b'), null);
	eq('_resolveTarget rejects another token', fresh._resolveTarget('/p/othertok/https/evil.test/x'), null);
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
	eq('_copyResponseHeaders forces no-store', out['cache-control'], 'no-store');
	eq('_copyResponseHeaders drops stale validators', ['expires' in out, 'pragma' in out], [false, false]);
	eq('_copyResponseHeaders drops hop-by-hop transfer-encoding', 'transfer-encoding' in out, false);
	eq('_copyResponseHeaders keeps the body headers', out['content-type'], 'text/html');
	eq('_copyResponseHeaders strips frame-ancestors only', out['content-security-policy'], "script-src 'self'");
}
eq('_copyResponseHeaders keeps a same-origin redirect root-relative',
	p._copyResponseHeaders(fakeRes(301, { location: 'https://site.test/new?x=1#frag' }), TARGET).location,
	'/new?x=1#frag');
eq('_copyResponseHeaders keeps a relative redirect relative',
	p._copyResponseHeaders(fakeRes(302, { location: '/rel' }), TARGET).location, '/rel');
eq('_copyResponseHeaders routes a cross-origin redirect through the proxy',
	p._copyResponseHeaders(fakeRes(302, { location: 'https://other.test/y?z' }), TARGET).location,
	BASE + 'https/other.test/y?z');
eq('_copyResponseHeaders drops an unparseable Location',
	p._copyResponseHeaders(fakeRes(302, { location: 'http://[::1' }), TARGET).location, undefined);
eq('_copyResponseHeaders leaves a Location-less redirect alone',
	p._copyResponseHeaders(fakeRes(302, {}), TARGET).location, undefined);

eq('_isHtmlResponse matches text/html with parameters',
	p._isHtmlResponse({ 'content-type': 'text/html; charset=utf-8' }), true);
eq('_isHtmlResponse rejects JSON', p._isHtmlResponse({ 'content-type': 'application/json' }), false);

// ---------------------------------------------------------------------------
try {
	fs.unlinkSync(BUNDLE);
} catch {
	/* best effort: it is regenerated on every run */
}

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
