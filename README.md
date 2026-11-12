# Browser Panel

[![Open VSX Version](https://img.shields.io/open-vsx/v/artin/browser-panel)](https://open-vsx.org/extension/artin/browser-panel)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/artin/browser-panel)](https://open-vsx.org/extension/artin/browser-panel)
[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Marketplace-artin.browser--panel-0098FF?logo=visualstudiomarketplace&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=artin.browser-panel)

Embedded browser for the VS Code **bottom panel / secondary sidebar** — defaults to `http://localhost:80` for local development preview.

<img src="https://i.ibb.co/Z6yFRLLH/Pix-Pin-2026-08-22-18-26-26.jpg" alt="Pix Pin 2026 08 22 18 26 26" border="0">

## Features

- Opens in the **bottom panel**; drag the tab to the **secondary sidebar** (VS Code built-in behavior)
- Address bar with an inline **Go arrow** (auto-prepends `http://`)
- Back / Forward / **Reload** toolbar icons (official VS Code codicon shapes)
- **Home** — returns to the configured default URL
- **DevTools** — opens DevTools for the current page
- **Connection-error page** — unreachable hosts show a localized error with Open in external browser, plus **seamless auto-reconnect** (5s countdown / Cancel; retries run in the background without hiding the error overlay). A progress bar shows while loading
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
| `browser.historyLimit` | `200` | Maximum history entries to keep (oldest removed first, clamped to 1–10000). |
| `browser.proxyEnabled` | `false` | Render sites that refuse to be framed by routing them through a local proxy (any localhost or http(s) site, not Next.js-specific). Pages then live on `http://127.0.0.1:<port>`, and logins do not persist. The port is sticky, so a proxied site's localStorage survives editor restarts. Details: `docs/PROXY.md`. |
| `browser.acceptSelfSignedCerts` | `true` | Accept self-signed certificates when loading pages (proxy mode) and during the reachability probe. Keep on for local https dev servers; turn off to enforce certificate validation everywhere (self-signed hosts then show as unreachable). |

> **Close vs. hidden**: a webview view is *hidden* when it leaves the layout — switching the panel tab to **Terminal**, collapsing the panel, switching the activity bar away (minimizing the OS window does not count). `retainContextWhenHidden` decides what happens then. **Close browser** is different: it unloads the page to free memory and remembers the last URL. Scroll position cannot survive an unload (cross-origin iframe — VS Code cannot read it).

## Known limitations

- **Framing-blocked sites** (`X-Frame-Options`, CSP `frame-ancestors`, or a server-side check on `Sec-Fetch-Dest`) show a "Site cannot be embedded" page unless `browser.proxyEnabled` is on. Sites that block by JS, or that need a login, can still come up blank — use **Open in external browser**.
- **Proxied pages appear to live on `127.0.0.1`.** Sites that behave differently on localhost take their development branch there, and their buttons may do nothing at all.
- **Logins do not carry over.** The panel and your normal browser are separate processes with separate cookie stores, and the proxy drops cookies by design. Signing in elsewhere never signs the panel in; with the proxy off, a login made inside the panel does persist.
- **New tabs and `target=_blank` / `_top` / `_parent`** go to the system browser when the proxy is on. With the proxy off, the webview sandbox drops them silently — use the menu **Open in external browser**. Flows that need a real session (OAuth, heavy JS apps, PayPal, Microsoft sign-in) do not work in the panel either way.
- **Find in page** is unavailable: the embedded page is a cross-origin iframe, which the webview's find widget cannot search. Service Workers, downloads, notifications, `alert` / `confirm` / `prompt` and some device APIs also do not work.
- **Clear storage** clears this extension's history and last URL only, not the embedded site's cookies or localStorage.
- **Protocols**: `http` and `https` only; `file://` is not supported. After an in-frame redirect, the address bar keeps the URL you typed (the final URL of a cross-origin iframe is unreadable).
- Mechanisms, measurements and edge cases: `docs/PROXY.md`.

## Development

```
npm install
npm run watch     # or: npm run build
npm test          # proxy unit checks (CSP, shim injection, URL/header mapping)
```

Press `F5` in VS Code to launch the Extension Development Host.

## License

MIT
