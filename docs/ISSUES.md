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
| `docs/PROXY.md` / `README.md` | shim 與限制說明 |
