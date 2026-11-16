# 全域儲存：`lastUrl` / `history` / `closed` 統一至 `globalState` — 設計草案

狀態：**已實作（2026-11-16）**。2026-11-16 決策討論定案：三鍵全數改存 `globalState`
（跨工作區共用），不做資料遷移。本文件實作時修訂 `docs/ISSUES.md` 定案 3
（原「A：僅 workspaceState（不寫 globalState）」）、§實作備忘第 4 點，並在
定案 1 補註 `closed` 的範圍變更。

## 背景與實證（2026-11-16 查證）

- 現況三鍵 `browser.lastUrl` / `browser.history` / `browser.closed` 皆存 `workspaceState`
  （`src/browserView.ts` L47–49），實證：VS Code
  `workspaceStorage\<workspace-hash>\state.vscdb` 的 `artin.browser-panel` memento
  含 `{"browser.closed":...,"browser.lastUrl":...,"browser.history":[...]}`。
- `globalState` 存於使用者層單一 DB（實證：同一 DB 內
  `artin.browser-panel = {"browser.proxyPort":12580}`；`globalStorage\` 下無本擴充資料夾）。
- 同步能力不對稱：`setKeysForSync` 僅存在於 `globalState`
  （`@types/vscode` 1.96 `index.d.ts` L8068；`workspaceState` 無對應 API）。
- memento 按擴充 id 整包命名空間存放，改存 global **無跨擴充撞名風險**，鍵名不變。

## 決策理由

- `lastUrl` / `history`：跨專案連續性是真實收益；全域化的已知成本（誤還原、
  picker 混雜）在使用型態趨同（同一 dev server／同一批文件）時趨近於零，
  且皆為一次按鍵可恢復。
- `closed`：它與 `lastUrl` 在同一條啟動路徑上
  （`app.js` L1094–1100：`closed` 為 true 時不自動導航，否則 `navigate(lastUrl || ...)`）。
  內容狀態全域化後，若把守還原的閘門留在各專案，還原行為將取決於各專案
  無關的歷史（在 B 有沒有關過面板），語意不連貫。瀏覽器「開著停在離開時的
  狀態」應是整體事實，故一併全域。面板在工作列的顯示／隱藏由 workbench
  自行按工作區管理（`workbench.view.extension.browser-container.state`），
  與本鍵分工不變。
- `defaultUrl` 是設定（`window` scope），使用者本可透過 `.vscode/settings.json`
  按專案覆寫；三鍵是狀態，沒有對應的按專案管道——範圍的選擇只能在儲存層做。

## 目標與非目標

**目標**

- 三鍵跨工作區共用單份。
- 清除語意一致：Clear Webview Storage 清的就是那一（唯一）份。
- 改動最小：置換儲存後端，不新增任何一次性的相容墊片。

**非目標**

- **不做資料遷移**。搬運物僅為一份低價值的 localhost 網址清單，重新導航一次
  即可重建；為此引入 ~30 行遷移函式、~80 行測試與殘留復活邊界（原 R4），
  屬過度工程。升級後歷史與 lastUrl 從零開始，CHANGELOG 明寫。
- 不做 Settings Sync（不呼叫 `setKeysForSync`）——現有歷史以 localhost 為主，
  跨裝置同步無價值；列為未來選項。

## 改動點

| 檔案 | 位置 | 改動 |
| --- | --- | --- |
| `src/browserView.ts` | L183、213–214、219–220、323、338、339、371 | 九處 `workspaceState` → `globalState`（`HISTORY_KEY` / `LAST_URL_KEY` / `CLOSED_KEY`） |

僅此而已。鍵名不變；無新檔案、無新函式、無介面變更。

## 變更紀律（防冗餘）

- 置換處**不加任何「舊→新」敘事註解**（如「原本存 `workspaceState`，現改存
  `globalState`」）。行為差異的說明只屬於 CHANGELOG、commit message 與本文件；
  程式碼裡的是歷史垃圾。
- **驗收標準：diff 淨新增行數 ≤ 淨刪除行數**。九處同構置換應接近零淨增；
  若發現想為「解釋這次改動」加註解或額外分支，停下——那是文件的內容，
  不是程式碼的內容。
- 連動文件同步同理：CHANGELOG 一條描述行為變化即可，不在 ISSUES.md 保留
  「原決策全文＋新決策」的雙份敘事，修訂以替換而非附加的方式進行。

## 風險

- **R1 跨專案 picker 可見性**：設計上接受（本次決策核心）。既有 per-entry 移除
  與 Clear Webview Storage 可事後清理。
- **R2 per-workspace `browser.defaultUrl` 退化**：全域 lastUrl 幾乎恆非空，
  啟動路徑 `lastUrl || config.defaultUrl` 的 defaultUrl 分支變成極少走到；
  per-workspace 的 defaultUrl 從「啟動首頁」退化為「Home 按鈕首頁」。
  文件明寫此行為變化，不改程式。
- **R3 升級即清空**：首次以新版開啟時歷史為空、面板依 `defaultUrl` 起始
  （或維持關閉——`closed` 初值 `false`，面板會開在 `defaultUrl`）。
  可接受的行為變更，CHANGELOG 明寫。

## 測試計畫

- `test/webview-units.js` 現況不涵蓋儲存層（已查：無 workspaceState／lastUrl／
  history 相關引用），本次改動不影響既有測試。
- 手動 QA：
  - 專案 A 導航 → 開專案 B → 面板還原 A 的網址，picker 歷史連續。
  - 專案 A 關閉面板 → 開專案 B → 面板維持關閉狀態（一致）。
  - Clear Webview Storage → 兩專案皆空。
  - proxy sticky port 行為不受影響。

## 文件同步

- `CHANGELOG.md`：新條目（行為變更：上次網址、歷史與面板開合狀態改為
  跨專案共用；升級後舊記錄不保留、不遷移；per-workspace defaultUrl
  僅作用於 Home 按鈕）。
- `docs/ISSUES.md`：定案 3 修訂為「三鍵皆存 `globalState`」、§實作備忘第 4 點
  更新、定案 1 補註範圍變更，註記修訂日期與本文件連結。
- `docs/PLAN.md`：不動（歷史規劃文件）。

## 工作量估算

`browserView.ts` 九處置換；CHANGELOG 與 ISSUES 修訂。測試程式零新增。
