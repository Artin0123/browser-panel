# Per-Target Origin 代理架構（`*.localhost:<port>`）— 設計草案

狀態：**設計草案（2026-11-17）**。本文從「統一架構原則」出發，整理目前單一 `127.0.0.1:<port>` 共用 Origin 代理所累積的結構性內耗，並提出以 `t-<hash>.localhost:<port>` 為核心的收斂方案與明確邊界。

---

## 1. 背景：為什麼目前會有「補不完」的感覺？

回顧 `v0.4.1` 至今的演進，許多複雜度與「預設關閉（opt-in）」的妥協開關，其實都源自**同一個根本原因**：**所有經代理的網站都擠在同一個 Origin（`http://127.0.0.1:<port>`）底下**。

| 現有妥協 / 風險 | 根因（皆來自共用 Origin） |
| --- | --- |
| 全域單一 `_lastTarget`（`src/proxy.ts`） | 根相對請求沒有目標資訊，只能猜最後一次導航的站台；多框架並存時互相覆蓋（`IFRAME-SHIM-DESIGN.md` R3） |
| 強制 `cache-control: no-store` | A 站的 `/` 或靜態資源若被快取，B 站導航會被劫持；為防污染只好全面停用快取，導致大型 SPA（如 7MB+ JS bundle）每次載入都極慢 |
| `browser.proxyCookieJar` 預設關閉（`default: false`） | 共用 Origin 下，A 站頁面可透過 `/p/<token>/...` 讀取 B 站的已認證內容（`COOKIE-JAR-DESIGN.md` R1） |
| `browser.proxyIframeRewrite` 預設關閉且限「同站」 | 跨來源子 iframe（如 `antigravity.google.com` 內嵌的 `antigravity.static.usercontent.goog`）若走代理會覆寫 `_lastTarget`，導致外層 API 請求全數打錯站台 |
| 必須封鎖 Service Worker（`dest=serviceworker` → 404） | 共用 Origin 一旦被 A 站的 SW 註冊，之後會劫持所有 B 站的請求 |

只要維持單一 Origin，上述每一項都需要各自獨立的防禦規則與保守開關；每當接觸更複雜的現代多域應用，就必須再多補一層邊界。

---

## 2. 統一原則：1 Target Origin ＝ 1 Localhost Subdomain

**核心不變量**：每一個真實目標 Origin（`scheme://host[:port]`）1 對 1 對應到一個確定性的本地 Origin：

```text
https://antigravity.google.com          -> http://t-<12hex>.localhost:<port>
https://antigravity.static.usercontent.goog -> http://t-<12hex>.localhost:<port>
http://127.0.0.1:4096                   -> http://t-<12hex>.localhost:<port>
```

其中 `<12hex>` 為 `sha256(targetOrigin)` 的前 12 碼十六進位（確定性雜湊）。

### 為什麼這個原則成立？

1. **零系統設定解析**：依 RFC 6761 與 Chromium `HostResolver` 行為，`*.localhost` 原生解析至 `127.0.0.1`，不需修改系統 `hosts` 檔。
2. **維持 Secure Context**：Chromium 將 `http://*.localhost` 視為潛在可信任來源（Secure Context），`navigator.clipboard`、`crypto.subtle` 等 API 均可正常運作。
3. **不違反 Webview CSP**：`src/webview/index.html` 的 `frame-src http: https:;` 已放行任意 `http:` 子網域。
4. **保留跨重開持久化**：確定性雜湊搭配既有的 sticky port（`globalState('browser.proxyPort')`），同一目標站台重開 VS Code 後仍落在完全相同的 Origin，`localStorage` / `IndexedDB` / 瀏覽器快取皆可保留。

---

## 3. 統一原則能解決什麼 vs 明確不解決什麼

### 目標（由單一原則一次消滅的四個架構問題）

1. **完全移除 `_lastTarget`**：每個入站請求的 `Host` 標頭（`t-<id>.localhost:<port>`）直接唯一決定上游目標，從根本消滅多請求/多框架競態。
2. **原生支援跨來源子 iframe 注入 `SHIM_JS`**：跨站子 iframe（如 `antigravity.static.usercontent.goog`）各自落在自己的 `t-<child>.localhost:<port>`，自動取得 `SHIM_JS` 並透過既有的 `relay listener` 上拋 `openExternal` / `copy`，不會干擾父框架的請求路由，修正子框架內點擊外部連結無反應的問題。
3. **解除全域 `no-store` 強制禁快取**：各站台擁有獨立的瀏覽器快取分區，代理層不再需要強制覆寫 `cache-control: no-store`，可保留上游正常的快取策略，改善大型 SPA 重載速度。
4. **Cookie Jar 天然按目標隔離**：`proxyCookieJar` 與每個 `t-<id>` 綁定，消除跨目標讀取的 R1 風險，未來可評估簡化並整合為預設安全的代理行為。

### 非目標（VS Code Webview `<iframe>` 的物理邊界 — 不因本方案而改變）

即使切換至 `*.localhost:<port>`，只要容器仍然是 **VS Code Webview 內的 `<iframe>`**，以下限制依然存在，屬於擴充平台的先天邊界（遇此類站台應直接交由「在外部瀏覽器開啟」）：

1. **第三方 OAuth 硬否決**：OAuth provider（如 Google）檢查真實的 `https://` `redirect_uri`，不會承認 `http://t-<id>.localhost:<port>`；系統瀏覽器的登入憑證也無法回流到 Webview。
2. **顯式比對真實 Origin 的站台腳本**：例如 JS 主動檢查 `location.protocol === 'https:'`、或 `postMessage(msg, 'https://exact-origin')` 指定真實目標 Origin 時仍會失敗。
3. **Webview 宿主級權限與環境差異**：例如 Electron Webview 下的 WebRTC 連線策略、或如 `antigravity.google.com` 透過 BYOA token 模式無法連上遠端實例等屬於站台/宿主層的問題。

---

## 4. 架構藍圖與接線點

### 4.1 Target Registry 與 Bootstrap Bounce（`src/proxy.ts`）

- **入口形式不變**：`webview` 與跨站跳轉仍可使用 `/p/<token>/<scheme>/<host>/<path>`（由 token 把關，防止其他本機行程將代理當成開放式代理使用）。
- **註冊與 302 落地**：
  1. `_handle` 收到合法的 `/p/<token>/...` 文件請求時，計算 `id = 't-' + sha256(targetOrigin).slice(0, 12)`，將 `id -> targetOrigin` 寫入 `Map<string, URL>`。
  2. 回傳 `302`（附帶 `cache-control: no-store`）導向 `http://<id>.localhost:<port><pathname><search><hash>`。
- **Host 驗證與路由**：
  - `_isAllowedHost(host)`：僅放行 `127.0.0.1:<port>`、`localhost:<port>`、以及已註冊於 `Map` 中的 `t-<id>.localhost:<port>`；其餘一律 `403 Forbidden`（維持 DNS rebinding 防護）。
  - 一般根相對請求直接由 `Host` 查表取得 `targetOrigin`，不再依賴 `_lastTarget`。

### 4.2 跨來源重定向與子 iframe 改寫

- **`_copyResponseHeaders` 3xx Redirect**：
  - 同源重定向：維持根相對路徑。
  - 跨源重定向：為新目標計算並預先註冊 `newId`，將 `Location` 改寫為 `http://t-<newId>.localhost:<port><path><search><hash>`。
- **子 iframe 改寫（HTML 與 `SHIM_JS`）**：
  - `_rewriteIframeSrcs` 與 `SHIM_JS` 的 `MutationObserver` / `src` setter 可統一處理所有 `http://` / `https://` 子 iframe：
    - 將 `https://other.site/path` 改寫為 `/p/<token>/https/other.site/path`（或由代理預先註冊後直接寫為 `http://t-<childId>.localhost:<port>/path`），使每層子框架都能經代理取得 `SHIM_JS`。
    - 子框架仍透過 `bp.origin` 記錄其真實 Origin，確保 `realUrl()` 與 `openExternal` 交給外部瀏覽器時能還原為真實網址。

### 4.3 快取與 Service Worker

- **快取**：移除 `_copyResponseHeaders` 中對一般資源強制寫入 `cache-control: no-store` 的邏輯（僅對 `/p/<token>/...` 的 302 bounce 回應保留 `no-store`）。
- **Service Worker**：因各站台已分屬不同子網域，不再有跨站劫持風險；初版仍可維持 `dest=serviceworker` → `404` 以保持行為可預測，或視需求開放。

### 4.4 Webview 位址列同步（`src/webview/app.js`）

- 頂層框架的 `SHIM_JS` 已會透過 `pageNavigated` 上報真實 URL（`bp.origin + pathname + search + hash`）。
- `app.js` 的 `toProxyUrl()` / `fromProxyUrl()` 與 `nav` 狀態需同步識別 `http://t-<id>.localhost:<port>` 形態，確保工具列位址列、Reload 與「在外部瀏覽器開啟」始終顯示並使用真實 URL。

---

## 5. 實作前待驗證項目

1. **跨平台 Webview `*.localhost` 解析實測**：於 Windows / macOS / Linux 的 VS Code Webview（Electron）中確認 `iframe.src = "http://t-0123456789ab.localhost:<port>/..."` 可正常連線至 `127.0.0.1:<port>`，且不觸發額外預檢或沙箱攔截。
2. **動態子框架註冊路徑**：若子 iframe 由 `SHIM_JS` 改寫為 `/p/<token>/https/...` 並在同一個 proxy origin 上觸發 302 到 `http://t-<childId>.localhost:<port>/...`，需確認該跨子網域 302 在 Webview sandbox 內可順利跟隨載入。
3. **跨站 `postMessage` 回歸測試**：以真實多域站台驗證將子 iframe 移至 `t-<childId>.localhost:<port>` 後，對父子通訊與既有功能的實際影響，據此決定是否保留單一總開關或預設啟用。
