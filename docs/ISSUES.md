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
> **說明**：問題一於 v0.4.1 引入修復（`src/proxy.ts` 文件導航 bounce），同日實測發現其 `Sec-Fetch-Dest` 閘門在 VS Code webview 內永不命中（見 4b），於 v0.4.2 移除閘門完成修復；問題二經查證為 VS Code webview sandbox 固有限制，直連模式不可修，與本檔「已修 vs 未修」表一致。

## 定案摘要

| # | 議題 | 定案 |
|---|------|------|
| 1 | proxy 模式下 opencode（v2.2.0）整頁 `TypeError: Cannot read properties of undefined (reading 'type')` | **已修**：文檔導航 bounce——以 `/p/<token>/...` 形式到達的 GET/HEAD 文檔導航（`Sec-Fetch-Dest: document/iframe/frame`）302 到目標自己的根相對路徑，讓 iframe 的 `location.pathname` 永遠是目標路徑、不是代理前綴 |
| 2 | 直連模式點外部連結被擋（`allow-popups` not set） | **不可修（直連）**：VS Code webview 外層 sandboxed iframe 未開 `allow-popups`，sandbox 旗標被巢狀 iframe 繼承且子層只能加嚴、extension 無法放寬。出路 = proxy shim 攔截（修好問題一即生效）或選單「在外部瀏覽器開啟」 |
| 3 | proxy port 隨機 → localStorage（opencode 配對 token／主題）每次重開 VS Code 就清空 | **已修**：sticky port——綁定過的 port 記在 globalState 並在下次 start 重用；被佔用時自動 fallback 隨機 port |
| 4 | 偶發：第一次載入 VS Code 面板整個白畫面，無錯誤視窗、不會自動重試、無法穩定重現 | **已加防護**（無法在擴展端根治 VS Code webview 偶發載入失敗，但可自癒）：webview 端重試 `getConfig`（治訊息丟失）；host 端 10s 靜默後強制重載 webview（上限 2 次，治腳本沒跑起來）；無效 URL 改顯示錯誤頁而非靜默白框 |

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

- 代理層 9 項斷言全過：bounce 保留目標路徑與 query、無循環、shim 注入、br/gzip 透傳、同源/跨源重定向改寫、錯誤 Host 仍 403。
- 修復後的真實 `FrameProxy` + 真實瀏覽器完整走過使用者場景：密碼登入、會話列表、開啟會話，console 零錯誤。

### 4b. 2026-10-29 修正（v0.4.2）：bounce 閘門在 VS Code webview 內失效（實測日誌抓到）

初版 bounce 以 `Sec-Fetch-Dest ∈ {document, iframe, frame}` 閘門判定文檔導航——在獨立瀏覽器驗證通過（該環境確實送 `iframe`），但**VS Code 的 webview iframe 送的是 `dest=empty`**，閘門永遠不命中，使用者實測仍崩潰（同一堆疊）。臨時請求日誌（`[proxy] GET … dest=…`）直接暴露此事實。

修正：

1. **移除 dest 閘門**：prefix 形式的 GET/HEAD 一律 bounce。正當性——prefix 形式只可能來自 webview 的 `iframe.src` bootstrap 與我們自己的跨源重定向改寫，兩者都是要反彈的導航；子資源／XHR 走根相對路徑根本不會進入此分支。頁面自身對 prefix URL 的 `fetch()`（只有崩潰中的舊頁會做）被反彈也無害。
2. **阻擋 Service Worker 腳本**：實測發現 opencode 嘗試註冊 SW（`GET /sw.js dest=serviceworker`）。proxy origin 為所有經代理網站**共用**，sticky port 又讓 origin 持久——A 站的 SW 會存續並攔截之後 B 站的請求（其快取不認得 bounce/目標語義），必須從源頭擋掉：`dest=serviceworker` 一律 404，`register()` 必然失敗；直連模式不受影響。

驗證（真實 FrameProxy + 真實 opencode）：`dest=empty` bootstrap → 302 → `/` HTML+shim；無 dest → 同；`/sw.js`（SW dest）→ 404；子資源/API → 正常透傳；Host 檢查 → 403。**教訓：驗證環境必須含 VS Code webview 本身——它的 header 行為與獨立瀏覽器不同，不能以獨立瀏覽器的觀察外推。**

### 5. 邊界

- POST/PUT 文檔導航（表單直接 POST 到帶前綴的絕對 URL）不 bounce（避開 307/308 語義陷阱），維持 prefix 直通，pathname 仍帶前綴——此場景罕見。
- 302 是服務端重定向，瀏覽器跟隨後才渲染，無舊方案「先渲染錯路徑再客戶端補救」的白屏；`#fragment` 在 Location 無 fragment 時由瀏覽器沿用原 URL 的。
- 既有性質（非本次引入）：proxy port 每次啟動隨機 → opencode 存在 localStorage 的配對 token 隨 origin 失效，每次重開 VS Code 需重新配對。

## 問題三：proxy port 隨機 → localStorage（配對 token／主題）每次重來

### 1. 現象

proxy 每次啟動 `listen(0)` 隨機綁 port；proxy origin（`http://127.0.0.1:<port>`）跟著變，iframe 內網站的 localStorage／IndexedDB 是 per-origin 的——重開 VS Code 後 opencode 的配對 token、主題等全部清空，需重新配對。

### 2. 根因

Origin 含隨機 port；沒有任何機制讓 port 在重啟後重用。

### 3. 實作（v0.4.1）

1. `FrameProxy.start(preferredPort)`：優先綁偏好 port；綁定失敗（EADDRINUSE——其他進程搶走、或第二個 VS Code 視窗的 proxy 已佔用）自動 fallback 回隨機 port，不再讓 listen error 直接 reject。
2. `get port()` 暴露實際綁定 port；`extension.ts` 在 start 成功後寫入 `globalState('browser.proxyPort')`，下次 start 讀回。fallback 後存的是新隨機 port（自然成為下次的 sticky port）。
3. 安全性不變：Host header 檢查（防 DNS rebinding）與 token（顯式目標形式）維持；root 相對請求本來就不帶 token，port 可預測只是讓「借用 proxy 存取當前目標」的既有暴露更容易被找到，實際可做的事不變（無憑證流經 proxy）。

### 4. 驗證

- 隨機啟動 → dispose → 以同一 port 重啟：重綁成功（同 port）。
- 第二個實體偏好已被佔用的 port：自動 fallback 到不同 port。
- POST body 經真實 proxy 位元組級完整轉發；SSE（`text/event-stream`）增量串流無緩衝（chunk 間隔 ~300ms 如期到達）。

### 5. opencode 場景其餘確認事項（2026-10-29 盤點）

- **配對連結**：`/auth/connect/<key>` 由伺服器端處理（回 JSON／重定向，非 SPA fallback），從面板位址列導航不會踩到路由崩潰；建議流程＝讓「伺服器 URL」保持預填的 proxy 位址 + 密碼登入（已實測）。
- **Reload 深層路由**：bounce 後重載 `lastUrl`（如 `/server/x/session/y`）會直接落在正確路由，比舊設計更好。
- **既有未修項**（iframe／webview 平台限制，見上方表格）：frame-busting、下載、跨來源位址列、`alert/confirm/prompt` 等，與 opencode 無衝突；opencode 不用 Service Worker、不用 cookie，均不受影響。

## 問題四：偶發「第一次載入 VS Code 面板白畫面」（無法穩定重現）

### 1. 現象

有時 VS Code 啟動後面板整個白畫面：沒有「無法連線」錯誤視窗、自動重試沒啟動、什麼都不能用；無法穩定重現。

### 2. 根因分析（代碼審查）

關鍵事實：`index.html` 的初始 DOM 就是「白畫面狀態」——`viewport-wrap` 預設可見、iframe 無 `src`、`empty-state`／`error-state` 都隱藏。唯一能離開這個狀態的路徑是 webview 載入後送 `getConfig` → host 回 `config` → `navigate()` 啟動導航／probe／重連鏈。這條鏈任何一環斷掉，症狀與回報完全一致：

| 斷點 | 情境 | 結果 |
|------|------|------|
| webview 腳本沒跑起來 | VS Code webview 偶發載入失敗（平台層 flake，已知問題類別） | 永久白畫面 |
| `getConfig`（webview→host）丟失 | 啟動期 IPC race／extension host 忙碌 | host 永遠不會回 config → 永久白畫面 |
| `config`（host→webview）丟失 | 同上（host 只在被動收到 getConfig 後才回） | webview 永遠收不到 → 永久白畫面 |
| `navigate()` 靜默早退 | `lastUrl` 與 `defaultUrl` 都無法 normalize（如 `browser.defaultUrl` 被設成空字串） | 不啟動任何導航/probe → 白畫面，且 Go 鍵也靜默無動作 |

設計上的結構性弱點：**啟動流程完全依賴單次、被動的訊息交換，沒有任何超時自救路徑**——正常時 <100ms 完成，但失敗時沒有第二機會。這解釋了「偶發且無法重現」：只在 IPC race／webview 載入 flake 恰好發生在面板首次 resolve 時出現。

### 3. 實作（v0.4.1，自癒機制）

1. **webview 端重試**（`app.js`）：`config` 收到前每 1.5s 重送 `getConfig`（最多 5 次；`configReceived` 旗標防重）——治「訊息偶發丟失」，快（1.5s）且無可見重載。
2. **host 端看門狗**（`browserView.ts` `_armStartupWatchdog`）：resolve 後追蹤「是否收過任何 webview 訊息」；**10s 靜默 → 重新賦值 `webview.html` 強制重載 webview 文檔**（治腳本沒跑起來——此時 webview 自己的重試也不會執行）；上限 2 次。view dispose／被取代時定時器清理；任何入站訊息解除武裝。正常路徑（config <100ms 到達）永遠不觸發。
   *設計取捨*：曾考慮 host 在靜默時「主動推送 config」作為中間層，審查後移除——它與 webview 重試修的是同一個斷點（回覆丟失），重試 1.5s 就已涵蓋，push 幾乎不會被需要；多一條代碼路徑只增加複雜度。看門狗只保留 webview 重試無法涵蓋的場景（腳本未執行）。
3. **無效 URL 顯性化**（`app.js`）：`navigate()` 回傳布林；啟動導航失敗時顯示「無效網址」錯誤頁（i18n ×3），不再是靜默白框。
4. **資源 URI 加版本參數**（`?v=<version>`，2 行）：防擴展更新後 webview 資源快取供應舊 `app.js`（舊腳本 + 新 host 契約 = 行為異常／白框的另一候選來源）。

### 4. 驗證限制

白畫面本身無法穩定重現（其成因就在無法重現裡），以上為代碼審查 + 針對每個斷點的機制性防護；typecheck/build 通過。若日後再出現白畫面，看門狗的 `console.warn` 會在 extension host 輸出留下痕跡（「webview silent since resolve」/「forcing a webview reload」），可據此確認命中哪一層。

### 5. 邊界

- 若是**整個視窗**（非僅面板）白畫面，屬 VS Code 本體問題，擴展端無從介入。
- **強制重載發生在啟動後 10s 且僅限 webview 完全靜默時**；正常路徑（config <100ms 到達）永遠不會觸發。

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
| `src/proxy.ts` | 文檔導航 bounce（302 → 根相對）；同源重定向根相對改寫；sticky port（`start(preferredPort)` + `port` getter + 綁定失敗 fallback） |
| `src/extension.ts` | proxy port 記入／讀回 `globalState('browser.proxyPort')` |
| `src/browserView.ts` | 啟動看門狗（10s 靜默 → 強制重載 webview，上限 2 次）；資源 URI 版本參數防快取 |
| `src/webview/app.js` | `getConfig` 重試；無效 URL 錯誤頁（i18n）；`navigate()` 回傳布林 |
| `docs/PROXY.md` | bounce 機制、崩潰根因、sticky port、撤銷「path-prefix 固有限制/目前不做」記載 |
| `README.md` | proxy 設定說明與 popup 限制措辭更新 |
| `CHANGELOG.md` / `package.json` | 0.4.1 / 0.4.2 |
