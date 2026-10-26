# Changelog

## [0.4.0] - 2026-10-26

### Security

- Proxy: closed the **token bypass** — a root-relative request target could pick its own origin via protocol-relative (`//host`), absolute-form (`GET http://host/`) or backslash paths and fetch arbitrary origins without the token (open proxy / SSRF). The fallback now pins the target origin, and such request targets are rejected
- Proxy: **Host header validation** (DNS rebinding defense) — only `127.0.0.1:<port>` / `localhost:<port>` are accepted; other Host values get 403 / socket destroy
- Proxy: response **decompression is capped** at the 5 MB inject limit (`maxOutputLength` for gzip/deflate/brotli); oversized bodies fall back to raw passthrough instead of unbounded synchronous decompression (previously a ~0.15 MB gzip could inflate to 150 MB and stall the extension host's event loop)
- Proxy: `Set-Cookie` is no longer forwarded on WebSocket 101 upgrades (consistent with the HTTP path)

### Fixed

- Proxy: proxied HTML no longer renders as **garbage on sites that answer with `zstd`** (e.g. google.com): the proxy only requests encodings it can decode (`gzip, deflate, br`, plus `zstd` when the runtime supports it) and decompresses zstd for shim injection instead of serving compressed bytes as text
- Proxy: upstream **chunked responses no longer produce an invalid reply** (a buffered HTML injection kept `Transfer-Encoding: chunked` alongside the recomputed `Content-Length`, crashing clients with a parse error); hop-by-hop response headers (`connection`, `keep-alive`, …) are now stripped
- Proxy: `dispose()` no longer **hangs on live WebSocket (HMR) connections** — upgraded sockets are destroyed and a 2 s safety timeout guarantees resolution (previously it could stall the serialized proxy toggle forever)
- Proxy: redirect `Location` rewriting keeps the `#fragment`
- Proxy: passthrough streaming honors backpressure (no unbounded buffering on slow clients)
- webview: proxy URLs keep the **`#hash`** (hash-router SPAs work with the proxy on; redirects round-trip fragments too)
- webview: URLs with basic-auth credentials (`http://user:pass@host`) fall back to direct mode with a localized hint instead of silently dropping the credentials
- webview: multi-line pasted input no longer navigates to a garbage host (`http://a\nhttp://b` was normalized into one broken URL); plain spaces are still accepted and percent-encoded so paths like `example.com/my page` keep working
- webview: pressing Enter / Reload on the **same URL now actually reloads** (previously a silent no-op with the loading bar stuck until the 20 s timer)
- webview: stale probe results after closing the browser no longer bring up the error page or start auto-reconnect
- webview: **Clear storage** now also clears the back/forward stacks
- webview: back/forward can no longer get stuck (programmatic-navigation flag resets on error, invalid history entries are peek-validated before popping)
- host: probe response errors (mid-body `ECONNRESET`) no longer crash the extension host
- host: the view reference is cleared on dispose; webview message handler rejections are logged instead of escaping as unhandled rejections
- host: frame-blocked detection now uses the proxy's actual listening state (previously a failed proxy start made blocked sites render blank without the explanation page)
- host: history hardening — corrupt/legacy persisted entries are filtered, consecutive-dedupe refreshes the timestamp, per-entry delete removes exactly one entry, QuickPick “Clear all” matches the webview contract (also clears last URL), and `historyLimit` is validated (clamped 1–10000) so a bad value can't wipe history
- host: history QuickPick “yesterday” grouping is DST-safe
- i18n: `zh-HK` / `zh-MO` now select Traditional Chinese; missing keys fall back to English instead of `undefined`

### Changed

- Moved the device-emulation `.invalid` input style from an inline `<style>` in the webview HTML to `styles.css`

## [0.3.18] - 2026-10-26

### Changed

- **Seamless auto-reconnect**: background retries no longer hide the error overlay while the page loads (the blank iframe used to flash white on every 10s attempt); the page is revealed only after the iframe has actually rendered. Retry interval shortened from 10s to **5s**

## [0.3.17] - 2026-09-18

### Added

- **Auto-reconnect** on connection failure: 10s countdown with Cancel auto-retry; toolbar Reload still works for a manual retry. Embed-blocked sites are not auto-retried
- With `browser.proxyEnabled`: in-page **Open in new tab** (`window.open` / `target=_blank`) opens the system browser (same path as the menu action); Clipboard `writeText` blocked by Permissions Policy is relayed via `vscode.env.clipboard`

### Fixed

- Reload spinner could spin forever after a failed probe / timeout (`.loading` was only cleared on iframe `load`)
- Closed browser cleared the address bar; it now keeps the last URL visible, and Reopen navigates to it
- Oversized proxied HTML no longer returns 502 — skips shim injection and streams the page through

### Changed

- Minimum VS Code engine raised to **^1.96.0** (types pinned to `~1.96.0`)
- Dev tooling: `@vscode/vsce` 4, `ovsx` 1.2, `@types/node` 26
- README / `docs/PROXY.md` / `docs/ISSUES.md` document proxy shim behavior and remaining iframe limits

## [0.3.16] - 2026-08-22

### Fixed

- Fixed the repository URL in the package.json

## [0.3.15] - 2026-08-22

### Added

- Marketplace / OpenVSX icon (browser window + globe, 128×128 PNG). The panel tab still uses the matching SVG.

## [0.3.14] - 2026-08-22

### Fixed

- **Proxy flicker / reload loop** (reproduced with pi-web / Next.js App Router; the same proxy serves any localhost): a tiny header allow-list dropped `RSC` / `Next-Url` / POST bodies, so the client got HTML for `?_rsc=` fetches and hard-navigated in a loop. The proxy now forwards headers, pipes any method, and rewrites `Next-Url` / `Referer` off the `/p/<token>/...` prefix. One extra navigation to `/` can still happen (path-prefix vs `location.pathname`); after that it stays put. See `docs/PROXY.md`
- **Open in external browser** while the proxy was on opened the proxy URL (`127.0.0.1:<port>/p/...`) instead of the real target
- WebSocket upgrades no longer drop `Connection` / `Upgrade` (those must be forwarded for the handshake)

### Changed

- Removed diagnostic `console.log` from the proxy and webview (they were added to hunt the reload loop)
## [0.3.10] - 2026-08-22

### Fixed

- **Reload loop with the proxy on** (Next.js etc.): the page's `Origin`/`Referer` were the proxy's (`http://127.0.0.1:<port>`), so dev servers rejected the cross-origin HMR websocket and the page reload-looped (the webview console showed repeated `iframe load` events). The proxy now rewrites `Origin`/`Referer` to the target origin so the target sees the page as same-origin
## [0.3.8] - 2026-08-22

### Fixed

- **Load-timeout false positive**: the 20s timer showed the error page even when the page was rendering fine (direct mode works; the iframe just never fires `load` because a dev-server resource keeps hanging). The timer now only stops the connecting bar — never an error page
- Added navigation diagnostics to the webview console to identify the remaining proxy-mode reload loop

## [0.3.7] - 2026-08-22
## [0.3.7] - 2026-08-22

### Fixed

- **Endless reload loop with the proxy on** (e.g. Next.js apps): ① the proxy now forwards **WebSocket upgrades** (dev-server HMR) to the target instead of failing them — Next.js's dev client was reloading the page on WS failure; ② `applyProxy` runs are now serialized and `start()` disposes any previous server, so concurrent config events can't leak servers / change the port / trigger endless re-routing
## [0.3.6] - 2026-08-22

### Fixed

- Proxy: root-relative asset URLs (Next.js/Vite style — `/_next/static/...`, CSS `url(/x)`) bypass the injected `<base>` and hit the proxy root → 404 → blank page. The proxy now remembers the current target and routes root-relative requests against it (also covers JS-generated requests, not just HTML tags)
## [0.3.4] - 2026-08-22

### Fixed

- Proxy `dispose()` crashed on `closeAllConnections` (the method was extracted unbound, so `this` was undefined) — the crash prevented the webview from receiving the proxy-off state, leaving it stuck on stale proxy URLs (blank pages after toggling the proxy off). Now called as a bound method inside try/catch
- `applyProxy` now broadcasts the config in a `finally` block, so the webview always gets the updated proxy state even if start/stop fails
## [0.3.3] - 2026-08-22

### Changed

- Device custom inputs/button left-aligned next to the "Custom" label (no longer pushed to the right by the growing label)
- Removed the viewport width transition (it lagged drag-resize)

### Fixed

- `npm run lint` script removed (eslint was never a dependency)
- History QuickPick now disposes on dismiss (Esc/click-away), not only on accept
- Proxy `dispose()` force-closes active connections so it can't hang
- esbuild watch now also rebuilds static webview assets on change

### Removed

- Dead i18n keys (`settings`, `historyEmpty`, `historyClearAll`) and the stale README "Settings button" bullet (the toolbar button was removed in 0.2.4)
## [0.3.2] - 2026-08-22

### Docs

- Clarified the proxy boundary in settings + README: it fixes sites that *only* block embedding; sites needing a real browser session (logins, heavy JS — e.g. PayPal, Microsoft sign-in) still render blank (the page loads but its own JS cannot run without a session) — use Open in external browser for those
## [0.3.1] - 2026-08-22

### Added

- Frame-blocking detection: the reachability probe now inspects `X-Frame-Options` / CSP `frame-ancestors` headers (skipped while the proxy is on) and the webview shows a localized **"Site cannot be embedded"** error page instead of a blank frame
- The probe now follows up to 3 redirects (more accurate reachability + detection)

## [0.3.0] - 2026-08-22

### Added

- **Local frame-proxy** (`browser.proxyEnabled`): routes pages through a local `127.0.0.1` proxy that strips `X-Frame-Options` / CSP `frame-ancestors`, injects a `<base>` tag so relative links keep flowing through the proxy, and rewrites redirects. Token-protected against open-proxy abuse. Lazy-started/stopped on the setting; the address bar keeps showing the real target URL. Best-effort: logins (Set-Cookie dropped) and JS-hardcoded https URLs may not work — documented.

## [0.2.11] - 2026-08-22

### Fixed

- History QuickPick trash button did nothing (the item was missing `removeUrl`)
- Device emulation submenu gets a fixed wider width so the Custom row no longer widens/misaligns the other options; increased spacing in the Custom row

## [0.2.10] - 2026-08-22

### Fixed

- Applying a **Custom** device size now re-renders the menu so the checkmark moves to Custom (it previously stayed on the old preset)
- The https reachability probe accepts self-signed certificates (`rejectUnauthorized: false`) so local https dev servers are no longer misreported as unreachable

## [0.2.9] - 2026-08-22

### Changed

- Device menu: responsive/custom numbers now update **live** while dragging the panel (ResizeObserver), not only after reopening the menu
- Removed "(default)" text from the Responsive option so every device option has the same `Name (W×H)` format

## [0.2.8] - 2026-08-22

### Fixed

- Device emulation responsive/custom numbers showed 0×0 when the browser was closed (measured the hidden viewport); now measured on the always-laid-out content area

## [0.2.7] - 2026-08-22

### Added

- Device emulation: **Responsive (default)** now reports the actual container size in the width×height inputs (and in the menu label)
- The browser **remembers its state across re-resolves / restarts**: closing stays closed (no auto-navigation back to the last URL), reopening restores the last URL instead of the default

## [0.2.6] - 2026-08-22

### Removed

- Keyboard shortcuts for zoom (commands, keybindings and gray shortcut hints in the menu) — zoom stays available via the menu items

### Changed

- Closing the browser now clears the address bar

## [0.2.5] - 2026-08-22

### Changed

- Error page: removed Retry / Home buttons, kept only **Open in external browser**; all buttons use the primary (blue) style again (secondary style removed)

### Fixed

- Zoom now uses a **transform-based zoom layer** (scale + 1/zoom sizing). CSS `zoom` does not take effect on an iframe element / inset-positioned wrapper in the webview (the official image preview zooms an `<img>` via `style.zoom`, which is why it works there). Transform is reliable in any Chromium context

## [0.2.4] - 2026-08-22

### Added

- History now opens a **native QuickPick** (same pattern as the official integrated browser): grouped by day, built-in search box, per-entry remove, clear-all
- Device emulation: presets now include height; **Custom** uses two number inputs (width × height) instead of drag-only
- Zoom shortcuts via VS Code keybindings (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`, only while the browser view is focused) — overrides VS Code's own window zoom; menu items show gray shortcut hints
- Error page buttons restyled as neutral secondary buttons

### Changed

- Removed the toolbar settings button (Settings stays in the «...» menu)

### Fixed

- Error page → valid page: `hideError()` now restores the viewport, so navigating back from an unreachable page works
- Zoom now applied to the iframe element itself (was ineffective on the wrapper in some cases)

## [0.2.3] - 2026-08-22

### Added

- Connection-error page: the extension host probes the URL in parallel (node http/https) and the webview shows a localized error page (Retry / Open in external browser / Home) instead of a blank frame
- Slim progress bar while a page is loading (shown after 400ms)

### Fixed

- Menu "..." button: clicking the SVG icon made `e.target` the `<path>`, so the click-away handler closed the menu instantly. Now uses `btnMenu.contains(e.target)`

## [0.2.2] - 2026-08-22

### Fixed

- Back/forward navigation stack: the current page was pushed into the back stack (first click was a no-op) and forward history was cleared on every load. Rewritten with proper back/current/forward segments
- Menu: double-click no longer opens+closes instantly; Escape closes it
- History writes run in parallel and cap correctly at the limit

## [0.2.1] - 2026-08-22

### Fixed

- Empty-state was always visible because `.empty-state { display:flex }` overrode the `hidden` attribute; added `[hidden] { display: none !important }`
- Explicit theme background for the empty state (light/dark)
- Toolbar raised above sibling layers; menu background fallback for themes without `menu-background`

## [0.2.0] - 2026-08-22

### Added

- Inline SVG toolbar icons (official codicon shapes, zero runtime dependency)
- Address bar with embedded Go arrow
- DevTools button with official `developer-tools` icon
- Settings button → opens this extension's settings page (`@ext:artin.browser-panel`)
- 「...」menu: settings, external browser, zoom (Ctrl+=/-/0), device emulation (viewport presets + drag-resize), history (limit 200, clearable), clear storage, close browser (unloads page to free memory)
- `browser.historyLimit` setting
- History persisted in `workspaceState` (dedupe consecutive, cap at limit)

### Fixed

- CSP: use `webview.cspSource` so bundled scripts/styles actually load
- Full zh-CN / zh-TW / en localization for the webview UI

## [0.1.0] - 2026-08-22

### Added

- Initial skeleton (M1): panel view container + webview view, `Browser: Open Browser` command
- Address bar, reload, back/forward, Home, F12 DevTools, open-in-external-browser toolbar
- `browser.defaultUrl` (default `http://localhost:80`) and `browser.retainContextWhenHidden` settings
- Last URL persisted across VS Code reloads (`workspaceState`)
