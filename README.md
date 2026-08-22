# Browser Panel

Embedded browser for the VS Code **bottom panel / secondary sidebar** — defaults to `http://localhost:80` for local development preview.

## Features

- Opens in the **bottom panel**; drag the tab to the **secondary sidebar** (VS Code built-in behavior)
- Address bar with an inline **Go arrow** (auto-prepends `http://`)
- Back / Forward / **Reload** toolbar icons (official VS Code codicon shapes)
- **Home** — returns to the configured default URL
- **DevTools** — opens DevTools for the current page
- **Connection-error page** — unreachable hosts (e.g. no server on the port) show a localized error page with Retry / Open in external browser / Home, plus a progress bar while loading
- **「...」menu**:
  - Settings
  - Open in external browser
  - Zoom in / Zoom out / Reset zoom
  - **Device emulation** — viewport presets (iPhone / Pixel / iPad / Surface Duo) + custom width×height inputs; **Responsive** shows the current container size
  - **History** — native QuickPick grouped by day with built-in search (limit configurable, default 200)
  - **Clear storage** — clears this extension's history & last URL (see limitation below)
  - **Close browser** — unloads the page to free memory and **stays closed** (state is remembered: the next open restores the last URL, not the default); press Home/Reopen to come back
- Remembers the last URL and the closed state across VS Code restarts
- UI follows the VS Code theme (light/dark) and display language (中文 / English)

## Usage

1. Run the command **Browser: Open Browser** from the Command Palette, or click the **Browser** tab in the bottom panel.
2. Navigate to `http://localhost:80` (or any http/https page).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `browser.defaultUrl` | `http://localhost:80` | Default URL (Home target). Change the port by editing the URL. |
| `browser.retainContextWhenHidden` | `true` | Keep page state (scroll, forms, JS state) alive while the view is hidden. Set to `false` and collapse the panel to fully release the page when unused. Takes effect after reload. |

> **Close vs. hidden**: a webview view is *hidden* when it is not visible in the layout — e.g. switching the panel tab from **Browser** to **Terminal**, collapsing the panel, or switching the activity bar away (minimizing the OS window does *not* count). `retainContextWhenHidden` decides what happens then. The **Close browser** action is separate: it unloads the page (frees memory) and remembers the last URL, but scroll position cannot survive an unload (cross-origin iframe — VS Code cannot read it).
| `browser.historyLimit` | `200` | Maximum history entries to keep (oldest removed first). |
| `browser.proxyEnabled` | `false` | Route pages through a local proxy that strips frame-blocking headers (`X-Frame-Options` / CSP `frame-ancestors`). Same proxy for any localhost/http(s) site — not Next.js-specific. Best-effort: logins and JS-hardcoded https URLs may not work. Path-aware SPAs may do one extra navigation to `/` on first load. |

## Known limitations

- Sites that send `X-Frame-Options` / CSP `frame-ancestors` (e.g. Google, GitHub) **cannot be embedded — you get a "Site cannot be embedded" error page** (detected by the reachability probe; enable `browser.proxyEnabled` to render them through the local proxy, or use **Open in external browser**). Sites that block via JS (frame-busting) or need a login still show a blank frame — those are not detectable from outside.
- The **proxy** is a general reverse proxy (any localhost or http(s) site). It fixes sites that *only* block embedding. Static pages are unchanged; SPAs that read `location.pathname` or custom headers (Next.js RSC, Vite HMR, …) need the header/WebSocket forwarding described in `docs/PROXY.md`. Sites that need a real browser session — logins, heavy JS (e.g. PayPal, Microsoft sign-in) — still render blank through the proxy; use **Open in external browser** for those.
- Webview pages do not share cookies/logins with your normal browser (some sites stay blank because they need a login/session).
- Service Workers do not run inside webviews.
- **Find in page is not available**: the embedded page is a cross-origin iframe, which VS Code's webview find widget cannot search (the official integrated browser needs Electron's `findInPage`, which extensions cannot use). Use the external browser for full-text search.
- **Clear storage** only clears this extension's own data (history / last URL); it cannot clear the embedded site's cookies or localStorage (no webview storage API).
- **Protocols**: `http` and `https` are supported. The reachability probe accepts self-signed certificates, so local https dev servers work; `file://` URLs are not supported (webview CSP + no local-file access) — use Live Preview or the external browser for local files.
- **Redirects & logins**: iframes follow redirects, but the address bar keeps the URL you typed (the final URL of a cross-origin iframe is unreadable). Logins **work and persist** — cookies live in VS Code's persistent Electron session, surviving hide/show, Close/Reopen and editor restarts (cleared only by "Developer: Clear Webview Storage" or the site's own cookie expiry). Exceptions: OAuth popups are blocked, and Service-Worker-based sessions don't work in webviews.

## Development

```
npm install
npm run watch     # or: npm run build
```

Press `F5` in VS Code to launch the Extension Development Host.

## License

MIT
