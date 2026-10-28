# [已完成] Browser Panel 問題定位與架構改進 (2026-09-18)

> **狀態標記**：[已完成]
> **時間**：2026-09-18
> **說明**：三項問題之根因分析、決策定案與實作對照。決策已拍板並已實作於原始碼。

---

## 定案摘要

| # | 議題 | 定案 |
|---|------|------|
| 1 | 關閉狀態 | **保留 `browser.closed` 持久化**。關閉後重啟仍顯示 empty／需按 Reopen。點 Reopen／導航開啟時自動載入 `lastUrl`。連不上時停轉圈 + 自動重連（見 #4–5），不改成「關閉不持久化」。 |
| 2 | 站內導航寫回 `lastUrl` | **C：不寫回**。僅工具列／選單／前進後退等會 `postMessage({ type: 'navigate' })` 的路徑更新 Host `lastUrl`。iframe 內點連結只更新位址列與本地 back stack。 |
| 3 | `lastUrl` 儲存 | **A：僅 `workspaceState`**（不寫 `globalState`）。 |
| 4 | 自動重連範圍 | **A：僅連線失敗**（`ok: false`）。`frameBlocked`（禁內嵌）不自動重試。 |
| 5 | 重連節奏 | **A：固定 10 秒**倒數；僅「取消自動重試」（與錯誤頁其他按鈕同款 `empty-btn`）；換網址／關閉／隱藏錯誤頁即停。工具列重新整理仍可手動重試。 |
| 6 | 剪貼簿 | **B**：iframe 加 `allow`（盡力）；**可靠路徑需 `proxyEnabled`**：shim 攔截 `writeText` 的 `NotAllowedError`，經 webview → `copyText` → `vscode.env.clipboard.writeText`。直連跨來源無法注入 shim，Permissions Policy 錯誤仍會出現。 |
| 7–8 | 頁內另開分頁 | **等同選單「在外部瀏覽器開啟」**：經同一條 `openExternal` → `vscode.env.openExternal`。僅 **`browser.proxyEnabled`** 時以**外部 shim 腳本**攔截 `window.open` 與 `a[target=_blank]`。未開 proxy 請用選單。 |

---

## 目錄

1. [問題一：複製按鈕與 JS 功能無效（如另開新分頁未在外部瀏覽器開啟）](#問題一複製按鈕與-js-功能無效如另開新分頁未在外部瀏覽器開啟)
2. [問題二：重新整理箭頭一直旋轉無後續畫面，需加入定時自動重連](#問題二重新整理箭頭一直旋轉無後續畫面需加入定時自動重連)
3. [問題三：開啟瀏覽器時未自動填入上次連結／點開後一直轉圈](#問題三開啟瀏覽器時未自動填入上次連結點開後一直轉圈)
4. [影響檔案清單](#影響檔案清單)

---

## 問題一：複製按鈕與 JS 功能無效（如另開新分頁未在外部瀏覽器開啟）

### 1. 現象

* **情境 A**：內嵌頁「複製」按鈕無反應（Clipboard Permissions Policy）。
* **情境 B**：`<a target="_blank">` / `window.open` 被 webview sandbox 擋下，也不會開系統瀏覽器。

### 2. 根因

* `#browser-frame` 無 `allow` → 子 frame Clipboard API 被擋。
* VS Code webview sandbox **無** `allow-popups`；跨來源父層無法攔截 iframe 內點擊。
* 選單「外部開啟」已走 `openExternal`；頁內另開沒有橋接。

### 3. 實作（對應定案 6、7–8）

1. iframe 加上 `allow="clipboard-read; clipboard-write; …"`（盡力；VS Code 外層 Permissions-Policy 常仍擋，見下方錯誤）。
2. Webview 監聽 iframe `postMessage`：`openExternal` → Host；`copy` → Host `copyText` → `vscode.env.clipboard.writeText`。
3. Proxy：對 `text/html` 注入 `<script src="/p/<token>/__bp_shim.js">`；shim 攔截 `window.open`／`target=_blank`，以及 `clipboard.writeText` 的 `NotAllowedError` 後轉送父層。**不做** `<base>`／路徑改寫。

典型錯誤（需 proxy shim 才能救）：

```text
NotAllowedError: Failed to execute 'writeText' on 'Clipboard':
The Clipboard API has been blocked because of a permissions policy...
```

---

## 問題二：重新整理箭頭一直旋轉無後續畫面，需加入定時自動重連

### 1. 現象

連線失敗或超時後，`#btn-reload` 的 `.loading` 旋轉不停；錯誤頁無自動重試。

### 2. 根因

* `btnReload.classList.remove('loading')` 只在 iframe `load` 執行。
* `showError()` 清掉 `frame.src` 且未移除 `.loading`；`loadTimer` 亦然。

### 3. 實作（對應定案 4、5）

1. 統一 `stopLoading()`：於 `showError`、載入安全逾時、成功 `load` 等路徑呼叫。
2. 連線失敗錯誤頁底部：「取消自動重試」按鈕，其下為 10 秒倒數文字；倒數歸零自動 `navigate`（不重複寫 history）。
3. `frameBlocked` 只顯示錯誤 + 外部開啟，不排程重連。

---

## 問題三：開啟瀏覽器時未自動填入上次連結／點開後一直轉圈

### 1. 現象

關閉後重開或本機服務未就緒時：位址列空白或一直轉圈，需手動再按才連上。

### 2. 根因

* `closed === true` 時刻意不 `navigate`（應保留）。
* 關閉時清空 `urlInput`，體感像「沒記住網址」。
* `closeBrowser` 清掉 `nav.current` 前未寫回本地 `lastUrl`，Reopen 可能落到過期值。
* 連不上時的無限轉圈屬問題二。

### 3. 實作（對應定案 1、2、3）

1. **保留** `setClosed`／`browser.closed`；關閉狀態不自動載入頁面。
2. 關閉或 `config` 且 closed：位址列仍填 `lastUrl || defaultUrl`（可看見上次連結）；Reopen／Home／Go 才 `navigate`。
3. `closeBrowser`／工具列導航時更新本地 `lastUrl`；**不**在 iframe `load` 回寫 Host（定案 2C）。
4. 儲存維持 `workspaceState` only（定案 3A）。
5. 轉圈與自動重連交問題二處理。

---

## 已修 vs 未修（iframe／webview 常見限制）

| 項目 | 狀態 | 說明 |
|------|------|------|
| 連線失敗轉圈 / 自動重連 | **已修** | 停 spinner + 10s 重連 UI |
| 關閉後記住狀態 + Reopen 載入 lastUrl | **已修** | 見問題三 |
| 剪貼簿 `writeText` Permissions Policy | **已修（需 proxy）** | shim → `copyText` → extension clipboard |
| 頁內 `_blank` / `window.open` | **已修（需 proxy）** | shim → `openExternal` |
| OAuth／完整登入 popup 回流 | **未修** | 可開外部瀏覽器，登入態通常回不來面板 |
| Frame-busting（`window.top`） | **未修** | 站點自行跳走／空白 |
| 下載行為 | **未修** | webview 內可能異常 |
| 通知／支付／WebUSB 等 | **未修** | 權限與政策限制 |
| Service Worker | **未修** | webview 不支援（README 已述） |
| 跨來源最終 URL／位址列 | **未修** | 父層讀不到 redirect 後 URL |
| `alert` / `confirm` / `prompt` | **未修** | 可能被擋或體驗差 |
| Proxy 丟棄 Set-Cookie | **刻意不修** | 見 PROXY.md |

---

## 影響檔案清單

| 檔案 | 變更 |
|------|------|
| `src/webview/index.html` | iframe `allow`；錯誤頁重連 UI（取消在下、倒數在其下） |
| `src/webview/app.js` | stopLoading、10s 重連、closed 位址列、iframe bridge、i18n |
| `src/webview/styles.css` | 重連區塊置底樣式 |
| `src/proxy.ts` | HTML 注入 shim；`/__bp_shim.js` |
| `src/browserView.ts` | `copyText` → `vscode.env.clipboard.writeText` |

---

# [已完成] opencode web UI 崩潰與直連模式 popup 被擋 (2026-10-29)

> **狀態標記**：[已完成]
> **時間**：2026-10-29
> **說明**：問題一已修復（v0.4.1，`src/proxy.ts` 文件導航 bounce）並以真實瀏覽器 + 真實 `FrameProxy` 端到端驗證；問題二經查證為 VS Code webview sandbox 固有限制，直連模式不可修，與本檔「已修 vs 未修」表一致。

## 定案摘要

| # | 議題 | 定案 |
|---|------|------|
| 1 | proxy 模式下 opencode（v2.2.0）整頁 `TypeError: Cannot read properties of undefined (reading 'type')` | **已修**：文檔導航 bounce——以 `/p/<token>/...` 形式到達的 GET/HEAD 文檔導航（`Sec-Fetch-Dest: document/iframe/frame`）302 到目標自己的根相對路徑，讓 iframe 的 `location.pathname` 永遠是目標路徑、不是代理前綴 |
| 2 | 直連模式點外部連結被擋（`allow-popups` not set） | **不可修（直連）**：VS Code webview 外層 sandboxed iframe 未開 `allow-popups`，sandbox 旗標被巢狀 iframe 繼承且子層只能加嚴、extension 無法放寬。出路 = proxy shim 攔截（修好問題一即生效）或選單「在外部瀏覽器開啟」 |

## 問題一：opencode web UI 經 proxy 開啟即 TypeError

### 1. 現象

`OPENCODE_PASSWORD=" " opencode serve --hostname 0.0.0.0`（port 4096），proxy 模式連入後整頁錯誤報告：

```text
TypeError: Cannot read properties of undefined (reading 'type')
    at Object.current (…/_assets/current-DyM6QvW-.js:6:44234)
    at Object.fn (…/_assets/solid-Cy8xcLB5.js:1:40792)
    …
```

### 2. 根因（bundle 反推 + 真實瀏覽器 1:1 重現，非推測）

opencode web UI 是把 `/` 當唯一入口的 SPA：路由解析器（`current-DyM6QvW-.js` 內 `Aa`）只認 `pathname` 為 `/`、`/settings`、`/connect`、`/components`、`/new-session`、`/server/:key/session/:id`，其餘一律 `throw Error('Unrecognised route!')`。代理路徑 `/p/<token>/http/localhost:4096/` 全部落空 → 路由 memo 維持 `undefined` → 下游 `current` computed 讀 `e.type` 拋 TypeError；堆疊 `6:44234` 欄位正落在 `return e.type===` 的屬性讀取上。

**獨立重現**（不經本擴展）：opencode 對任意未知路徑回退同一份 SPA，直接在瀏覽器開 `http://127.0.0.1:4097/p/abc123/http/localhost:4097/` 即得一字不差的同一崩潰——證明崩因是 pathname 本身。

**已排除**：Set-Cookie/Cookie 丟棄（opencode web UI 完全不用 cookie，認證走 URL `auth_token` 參數）、壓縮處理（br/gzip 透傳正確）、shim 注入破壞 HTML。

### 3. 實作（v0.4.1）

1. `src/proxy.ts` `_handle`：prefix 形式 + GET/HEAD + `Sec-Fetch-Dest ∈ {document, iframe, frame}` → 302 `Location: <目標路徑+query>`，附 `cache-control: no-store`。根相對請求不進此分支（`_parseTarget` 為 null），不可能循環。
2. `src/proxy.ts` `_copyResponseHeaders`：同源 3xx 重定向改寫為根相對路徑（原為帶前綴形式）；跨源重定向保留顯式 `/p/<token>/...` 形式，隨後被同一條 bounce 落到新目標的根相對路徑。
3. webview／host **零改動**：位址列讀的是 iframe `src` 屬性（始終是我們設定的 bootstrap URL），`fromProxyUrl` 行為不變。

### 4. 驗證

- 代理層 9 項斷言全過：bounce 保留目標路徑與 query、無循環、shim 注入、br/gzip 透傳、同源/跨源重定向改寫、`dest=empty` 與無 Sec-Fetch 引擎 fail-open 回舊行為、錯誤 Host 仍 403。
- 修復後的真實 `FrameProxy` + 真實瀏覽器完整走過使用者場景：302 → `/` 正常渲染 → 密碼登入成功 → 會話列表 → 開啟實際會話（訊息/模型/計費全渲染），console 零錯誤。

### 5. 邊界

- POST/PUT 文檔導航（表單直接 POST 到帶前綴的絕對 URL）不 bounce（避開 307/308 語義陷阱），維持 prefix 直通，pathname 仍帶前綴——此場景罕見。
- 不發 `Sec-Fetch-*` 的客戶端 fail-open 回舊行為（VS Code webview 的 Chromium 一定發送）。
- 302 是服務端重定向，瀏覽器跟隨後才渲染，無舊方案「先渲染錯路徑再客戶端補救」的白屏；`#fragment` 在 Location 無 fragment 時由瀏覽器沿用原 URL 的。
- 既有性質（非本次引入）：proxy port 每次啟動隨機 → opencode 存在 localStorage 的配對 token 隨 origin 失效，每次重開 VS Code 需重新配對。

## 問題二：直連模式外部連結被 sandbox 擋下

### 1. 現象

```text
Blocked opening 'https://auth.openai.com/oauth/authorize?…' in a new window
because the request was made in a sandboxed frame whose 'allow-popups'
permission is not set.
```

### 2. 根因

VS Code webview 內容住在外層 sandboxed iframe（無 `allow-popups`）；HTML 規範規定 sandbox 旗標被巢狀 iframe **繼承**，子層 `sandbox` 屬性只能再加嚴、不能放寬，extension 無法改動 VS Code 外層。故 iframe 內任何 `window.open`／`target=_blank` 必被 Chromium 擋下。本檔 2026-09-18 的「已修 vs 未修」表（OAuth popup 回流＝未修、頁內另開＝已修需 proxy）記載正確。

### 3. 結論

直連模式**不可修**。可行路徑：

1. proxy 模式 + shim 攔截（`window.open` / `target=_blank` → `openExternal` → 系統瀏覽器）——問題一修復後即可用；opencode 的 OAuth callback 回 `localhost:1455`（opencode 自己的本地 callback 服務），在外部瀏覽器完成登入沒有問題。
2. 直連模式的替代：工具列選單「在外部瀏覽器開啟」（既有功能）。

## 影響檔案清單（2026-10-29）

| 檔案 | 變更 |
|------|------|
| `src/proxy.ts` | 文檔導航 bounce（302 → 根相對）；同源重定向根相對改寫 |
| `docs/PROXY.md` | bounce 機制、崩潰根因、撤銷「path-prefix 固有限制/目前不做」記載 |
| `README.md` | proxy 設定說明與 popup 限制措辭更新 |
| `CHANGELOG.md` / `package.json` | 0.4.1 |
