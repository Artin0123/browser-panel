'use strict';
/**
 * Checks over the webview script (src/webview/app.js), which runs in the panel
 * and has no other way to be unit tested: the functions under test are lifted
 * out of the shipped source by name and evaluated here, so nothing is copied.
 *
 * Covered: the scheme gate in front of the iframe `src` write. The address bar,
 * the navigations a page reports and the stored startup URL are all outside
 * input, so every value that reaches the DOM is re-checked; the CSP declares
 * `frame-src http: https:` as the second line of defence.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'src', 'webview', 'app.js');
const source = fs.readFileSync(APP, 'utf8');

let failed = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) {
    failed++;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

/** Return the text of `function <signature>` up to its balancing brace. */
function takeFunction(signature) {
  const start = source.indexOf(signature);
  if (start < 0) {
    throw new Error('app.js no longer contains: ' + signature);
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces for: ' + signature);
}

const normalizeUrl = new Function('return ' + takeFunction('function normalizeUrl(raw)'))();
const isFrameSrc = new Function('return ' + takeFunction('function isFrameSrc(u)'))();

// toProxyUrl reads `proxy` from the module scope; hand it in as a parameter.
const toProxyUrlFor = (proxy) => new Function('proxy',
  takeFunction('function toProxyUrl(u)').replace('function toProxyUrl(u)', 'return function (u)') + ';'
)(proxy);

// ---------------------------------------------------------------- producers
// Every value the panel can legitimately navigate to, run through both stages
// the callers use: normalizeUrl() at the input, toProxyUrl() at the sink.
const userInputs = [
  ['https://antigravity.google.com/u/2/', 'https://antigravity.google.com/u/2/'],
  ['example.com/no-scheme', 'http://example.com/no-scheme'],
  ['localhost:3000', 'http://localhost:3000/'],
  ['https://example.com:8443/a/b?q=1#frag', 'https://example.com:8443/a/b?q=1#frag'],
  ['http://127.0.0.1:4599/x', 'http://127.0.0.1:4599/x'],
  ['https://example.com/a b', 'https://example.com/a%20b'],
  ['https://user:pass@example.com/a', 'https://user:pass@example.com/a'],
];

const modes = [
  ['proxy off', { enabled: false, baseUrl: '' }],
  ['proxy on', { enabled: true, baseUrl: 'http://127.0.0.1:4599/p/tok/' }],
];

for (const [modeName, proxy] of modes) {
  const toProxyUrl = toProxyUrlFor(proxy);
  for (const [typed, expected] of userInputs) {
    const normalized = normalizeUrl(typed);
    check('[' + modeName + '] normalizeUrl(' + typed + ')', normalized === expected, 'got ' + normalized);
    if (normalized === null) {
      continue;
    }
    const sink = toProxyUrl(normalized);
    check('[' + modeName + '] gate accepts ' + normalized, isFrameSrc(sink) === true, 'got ' + sink);
    check('[' + modeName + '] gate keeps ' + sink + ' http(s)-shaped',
      /^https?:\/\/[^\s]+$/i.test(sink) === true, 'got ' + sink);
  }
}

// The proxy rewrites a target URL to its own origin, so a proxied https page is
// handed to the frame as http://127.0.0.1:<port>/p/<token>/https/<host>/<path>.
const proxied = toProxyUrlFor({ enabled: true, baseUrl: 'http://127.0.0.1:4599/p/tok/' })('https://antigravity.google.com/u/2/');
check('proxied form starts at the proxy origin', proxied === 'http://127.0.0.1:4599/p/tok/https/antigravity.google.com/u/2/', 'got ' + proxied);
check('proxy is bypassed for URL credentials', toProxyUrlFor({ enabled: true, baseUrl: 'http://127.0.0.1:4599/p/tok/' })('https://u:p@example.com/') === 'https://u:p@example.com/');

// Inputs the address bar rejects outright (normalizeUrl returns null, so no
// navigation starts) — the gate must never be the only line of defence here.
for (const raw of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/Windows/win.ini', 'about:blank', '', '   ', 'http://a\nhttp://b', 'ftp://example.com/']) {
  check('normalizeUrl rejects ' + JSON.stringify(raw), normalizeUrl(raw) === null, 'got ' + normalizeUrl(raw));
}

// ------------------------------------------------------------------- gate
// Shapes no producer emits, but that a future caller could: the gate drops them.
for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/Windows/win.ini', 'about:blank', 'blob:http://127.0.0.1/uuid', 'HTTP://example.com/', ' https://example.com/', 'http:/example.com', 'httpx://example.com/', '', null, undefined, 42, {}]) {
  check('gate blocks ' + JSON.stringify(bad === undefined ? 'undefined' : bad), isFrameSrc(bad) === false, 'gate accepted it');
}

// And shapes it must not touch.
for (const good of ['http://example.com/', 'https://example.com/', 'http://127.0.0.1:4599/p/tok/https/example.com/a', 'https://example.com/#/route?x=1']) {
  check('gate passes ' + good, isFrameSrc(good) === true);
}

console.log('webview units: ' + (checks - failed) + '/' + checks + ' checks passed');
process.exit(failed ? 1 : 0);
