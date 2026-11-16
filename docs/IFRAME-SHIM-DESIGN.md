# 子 iframe 的 shim 涵蓋 — 設計草案

狀態：**已實作（2026-11-17，opt-in，`browser.proxyIframeRewrite` 預設 off）**。接線點已逐一對照 `src/proxy.ts` 與 `app.js`，皆與現況相符。

本文解決 `docs/ISSUES.md` 2026-10-29「問題二」與 2026-11-13 覆核
後仍存在的一層缺口：proxy 模式下，**頁面自己內嵌的子 iframe**（如
`antigravity.google.com/r/...` 分享頁的 session 檢視）以真實 origin 的絕對網址
直接載入、繞過 proxy，裡面沒有 shim；其內的 `window.open`／`target=_blank`
撞上 VS Code webview 繼承下來的沙箱（無 `allow-popups`）被擋，使用者在面板
點連結按鈕無反應，只能改用外部瀏覽器。

## 背景與證據（2026-11-16 瀏覽器實測）

以 agent-browser + 本地三層測試頁 1:1 重現面板結構，實測三情境：

| 情境 | 模擬 | 結果 |
| --- | --- | --- |
| 沙箱 wrapper（VS Code webview 旗標，無 `allow-popups`）→ 父層 → 子頁 `window.open` | 面板、子框架無 shim | ❌ BLOCKED（回傳 null） |
| 無沙箱祖先，同一子頁 | 外部瀏覽器 | ✅ POPUP OPENED |
| 同樣的沙箱，子頁先注入 shim 再跑頁面邏輯 | 面板 + shim 涵蓋到彈出來源框架 | ✅ INTERCEPTED → openExternal |

結論：(1) 擋人的是沙箱繼承；(2) shim 只要在**彈出來源的那份文件**裡先於頁面
邏輯安裝，即可有效攔截。因此修復方向＝讓同站的子 iframe 文件也經過 proxy、
取得 shim。未驗證項：真實分享頁的 iframe 結構需登入才能檢視；「彈出來源在
無 shim 的子框架」為實測機制 + 行為反推的最可能解釋。

## 目標與非目標

**目標**

- 同站（origin 與當前 proxy 目標相同）的子 iframe 文件改經 proxy 載入 →
  自動獲得 shim → 其內 `window.open`／`a[target=_blank]`／`_top`／`_parent`
  與頂層文件獲得同等的攔截與轉送。
- 嵌套任意深度：每層文件都有自己的 shim，逐級上拋。

**非目標**

- 不改寫**跨站**子 iframe（如 `accounts.google.com`）：顯式 `targetOrigin` 的
  postMessage、OAuth 流程風險高，且共享 proxy origin 的互染邊界已在
  `docs/PROXY.md` 定案——維持直連（其內彈出仍被擋，邊界記錄於 ISSUES.md）。
- 不注入 `srcdoc`／`about:blank` + `document.write` 的同源框架（proxy 看不到
  這些請求）。同源理論上可從 parent 以 `contentDocument` 補注入，列為 v2 候選。
- 不接子框架的 `pageNavigated` 回報：URL 追蹤只算頂層文件，避免子框架內部
  導航污染網址列與 back/forward stack。

## 設定

`browser.proxyIframeRewrite`：初版**預設 off**，需 `browser.proxyEnabled`。
關閉時 `_rewriteIframeSrcs` 與 shim 的 iframe 攔截整組停用，其餘 shim 行為不變。
預設 off 的依據是 R1／R2 兩個實測的功能回歸；在真實分享頁驗證有效且未破壞
既有內嵌站台後再改預設 on（屆時 R2 需先有 cookie 方案，見
`docs/COOKIE-JAR-DESIGN.md`）。

## 關鍵決策：改寫成「根相對路徑」，不是 prefix 形式

子 iframe 的 src 改寫目標形式必須是**根相對**（`https://host/path?q` → `/path?q`）：

1. **prefix 形式會被 bounce 彈回**：`_handle` 的 bounce 規則（v0.4.2）把
   `/p/<token>/...` 形式的 GET/HEAD 文檔導航一律 302 到目標自己的根相對路徑
   ——改寫成 prefix 形式的子框架會被彈回真實 origin 直連，恰好失去 shim。
2. **根相對由既有機制服務**：`_resolveTarget()`（`src/proxy.ts` L333）對
   根相對請求以 `_lastTarget` 解析 origin，且不進 bounce 分支。
3. **位置模型一致**：子文件的 `location.pathname` 即目標路徑，與 bounce 後的
   頂層文件相同——pathname 感知的 SPA 在子框架內同樣不會踩 prefix 路徑。
4. **反框架防護自動解除**：子文件經 proxy → `_rewriteSecFetchDest()` 把
   `dest=iframe` 改寫成 `document`（Google 站台應用層 403 的解法已就位）、
   XFO／`frame-ancestors` 剝除、`_stripCrossOrigin` 一併生效、CSP 逐政策處理
   注入 shim 標籤——全部既有程式碼直接覆用。

## 接線點

| # | 位置 | 改動 |
| --- | --- | --- |
| P1 | `src/proxy.ts` `_injectShimTag()` 內新增 `_rewriteIframeSrcs(html, target)` | HTML 層改寫 parser 建立的 `<iframe src>`（見下） |
| P2 | `SHIM_JS` | MutationObserver + `src` 屬性 setter patch，攔 JS 動態建立的 iframe |
| P3 | `SHIM_JS` | 新增 message relay listener，把子框架的 `openExternal`／`copy` 逐級上拋 |
| P4 | `SHIM_JS` `inPanel()` | `bp.prefix` 為空（根相對文件）時的 fallback，讓 `_top`／同站絕對連結留在面板內 |
| — | `src/webview/app.js`、`src/browserView.ts` | **零改動**：頂層 shim 轉發的訊息 `event.source === frame.contentWindow` 成立，既有橋接直接收 |

**P1 — `_rewriteIframeSrcs`（靜態 HTML）**

- 比照 `_stripCrossOrigin`（L794）的 tag-regex 風格：對每個 `<iframe\b[^>]*>`
  取出 `src` 屬性值（單引號／雙引號／無引號三種形式）後分類：
  - 根相對、`/p/` prefix 形式、`srcdoc`、`about:blank`、非 http(s) scheme → 不動；
  - 絕對 URL 且 origin === 當前 target origin → 改寫為 `u.pathname + u.search + u.hash`；
  - 其他 origin → 不動（非目標）。
- 與 shim 注入同一個緩衝路徑（`_pipeOrInjectHtml`），超大 HTML 的 passthrough
  分支本來就不注入，也不改寫——一致性由同一開關保證。

**P2 — shim 動態攔截**

- shim 執行時（此時在 `<head>` 最前，早於一切頁面腳本）：
  1. 立即 sweep `document.querySelectorAll('iframe')` 改寫既有節點；
  2. `new MutationObserver(...)` 監聽 `{ childList: true, subtree: true,
     attributes: true, attributeFilter: ['src'] }`——parser／`innerHTML` 建立、
     以及事後對既有 iframe 賦值 `src`（property 反映到 attribute）都會被捕捉；
  3. 同步保險：包一層 `HTMLIFrameElement.prototype.src` 的 setter（observer 是
     microtask 非同步，parser 插入的 iframe 可能已開始直連載入——此時改寫 src
     會觸發第二次導航取代之，代價一次多餘請求；setter patch 把 JS 賦值路徑
     變成同步改寫，連這次多餘請求也省下）。
- 判準與 P1 相同：以 `document.baseURI` 解析，`x.origin === bp.origin` 才改寫
  為根相對；`bp.origin` 不存在（非根相對語境）時整組邏輯不啟用。
- `HTMLFrameElement` 同步 patch（legacy，一行，避免舊式 frameset 網站漏攔）。

**P3 — relay listener（每一層 shim 都裝）**

- 現狀缺口：shim 的 `send()` 用 `parent.postMessage`——子框架的訊息落在頂層
  文件（它沒有 listener），訊息死在中間層。
- shim 新增 `window.addEventListener('message', ...)`：收到 `event.source !==
  window` 且 `type` 為 `openExternal`／`copy` → 以自己的 `send()` 原樣上拋。
- **明確不轉發 `pageNavigated`**（非目標第 3 條）；惡意頁面偽造同型訊息的最壞
  結果只是「請求用系統瀏覽器開某 URL」，與頂層既有攔截面相同，威脅面不變；
  host 端 `_openExternal` 的 scheme 驗證照舊把關。

**P4 — `inPanel()` 無前綴 fallback**

- 現狀：`bp.prefix` 為空（bounce 後的頂層、以及改寫後的子框架）時 `inPanel()`
  回 null → 同站 `_top`／絕對連結被當成跨站交給外部瀏覽器。
- 修法：`x.origin === bp.origin && !bp.prefix` → 回
  `location.origin + x.pathname + x.search + x.hash`（根相對形式，留在面板內
  導航）。此改動同時改善既有頂層行為（同站絕對連結不再外開）。

## 資料流（改寫後）

```
webview(沙箱,無allow-popups)
└─ #browser-frame：頂層文件（proxy 根相對，shim ✓）
   └─ 子 iframe：src 由 HTML 改寫/shim 改寫成根相對 → 經 proxy（XFO 剝除、
      dest 改寫、shim 注入 ✓，shim ✓）
      └─ 孫 iframe：同上，遞迴成立
點擊 → 子框架 shim 攔 window.open/_blank → send() → 頂層 shim relay
     → webview（event.source 閘門通過）→ host openExternal → 系統瀏覽器
```

## 風險（誠實面）

**R1 — 顯式 `targetOrigin` 的跨框架 postMessage 退化。** 實測（Chromium）：
改寫後父、子同在 proxy origin——

| 方向 | 直連（現況） | 改寫後 |
| --- | --- | --- |
| 父→子，`targetOrigin` = 真實 origin | ✅ 收到 | ❌ **丟失（退化）** |
| 子→父，`targetOrigin` = 真實 origin | ❌ 丟失 | ❌ 仍丟失（並未轉為必成） |
| 兩方向 `targetOrigin` = `*` | ✅ | ✅ |
| 接收端 `e.origin` | 真實 origin | 為 proxy origin |

退化僅「父→子且指定真實 origin」一項。postMessage 的 origin 比對是原生行為，
無法通用修復。緩解：Google 系頁面現能在面板運作，代表其跨框架訊息不是全部
依賴顯式 origin；實測為準。若特定站台因此壞掉，v2 再評估 opt-out 設定
（`browser.proxyIframeRewrite`）。

**R2 — 子 iframe 失去真實 cookie 登入態。** 現況同站子 iframe 直連真實 origin，
瀏覽器會附並保存該站 cookie；改走 proxy 後 `cookie`/`set-cookie` 被丟棄。
實測（Chromium 151；站台在 `localhost`、proxy 在 `127.0.0.1` 以模擬跨站；子頁設
`sid=1; SameSite=None; Secure`，載入兩次）：直連 → 第二次起
`document.cookie="sid=1"`；改寫成根相對 → 兩次皆為空。保留限制：VS Code
Electron webview 的第三方 cookie 政策未測。此項是設定預設 off 的主因；
若要預設 on，需先有 cookie 方案（`docs/COOKIE-JAR-DESIGN.md`）。

**R3 — 根相對請求依賴 `_lastTarget`。** 實測（真實 `FrameProxy` + 兩個假上游）：
`_lastTarget` 被任何 `/p/<token>/…` GET（含頁面自己發的 fetch）靜默切換，之後
所有根相對請求（含本提案改寫出的子框架與其子資源）改打新目標——頂層導航到
B 站後，A 站殘留子框架的後續請求會打到 B 站。此缺陷**已存在於現行行為**，
不由本提案引入；本提案新增其消費者。單面板單站台為主場景；`docs/PROXY.md` 註明。

**R4 — 改寫時機的競態。** parser 建立的 iframe 可能在 observer callback 前
已開始直連載入 → 改寫 src 觸發第二次導航取代之（一次多餘請求）；setter patch
涵蓋 JS 賦值路徑。可接受，測試驗證最終落在 proxy。

**R5 — 改寫誤傷。** src 屬性 regex 解析的極端形式（屬性值內含 `>`）——比照
`_stripCrossOrigin` 既有接受度；單元測試覆蓋常見形式，畸形輸入以「不動」為
fail-safe。

## 測試計畫

**單元（`test/proxy-units.js` 增補，測出貨碼）**

- `_rewriteIframeSrcs`：同站絕對 → 根相對；跨站、prefix 形式、根相對、
  `srcdoc`、`about:blank`、`javascript:`、無 src、單/雙/無引號、大小寫混寫
  各自的預期行為；畸形 HTML 不拋例外、原樣通過。
- `SHIM_JS` 出貨內容斷言：含 MutationObserver、`attributeFilter:['src']`、
  `HTMLIFrameElement` setter patch、relay listener、**不含** pageNavigated 轉發、
  `inPanel()` 的無前綴 fallback 分支。
- 既有 90 檢查全數不回歸。

**端到端（本地測試頁，out of tree）**

- 父嵌子、子內三種觸發（`window.open`、`a[target=_blank]`、
  `createElement('iframe')` 後賦值 src 的孫框架）走 proxy：全部轉外部瀏覽器；
  面板網址列與 back stack 不被子框架導航污染。

**真實標的（使用者登入的環境）**

- Antigravity 分享頁（`/r/...-v2`）：分享頁內連結按鈕 → 外部瀏覽器開啟。
- 回歸：`/u/2/` 主應用照常啟動、Google One Bar Sign in 行為不變（v0.4.5 四連修
  不退化）、opencode 的 root-relative 子資源照常。

## 工作量估算

`proxy.ts` ~60 行（`_rewriteIframeSrcs` + `_injectShimTag` 接線）；
`SHIM_JS` ~50 行（sweep + observer + setter patch + relay + inPanel fallback）；
測試 ~80 行；文件同步（`docs/PROXY.md` 新節「子框架涵蓋」、`docs/ISSUES.md`
追加 2026-11-16 結論與本提案、`CHANGELOG.md` 0.4.6、README 限制表更新）。
