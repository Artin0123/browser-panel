# 代理端 cookie jar — 設計草案

狀態：**已實作（2026-11-17，opt-in，預設 off）**。功能回歸評估（2026-11-16）：現況 `cookie`
與 `set-cookie` 兩個方向皆被丟棄，頁面今天本來就在零 cookie 下運作；預設 off 時行為
與現在完全相同，開啟後只是由「無 cookie」變「有 cookie」，未發現會因此失效的既有功能。

本提案縮小 `docs/ISSUES.md`「決策：不做 cookie jar」的否決範圍：被否決的是
「把 cookie 交給瀏覽器」的做法；本提案讓 cookie 完全不進瀏覽器，由代理在
extension host 端自持。首個驗證標的：`dsh web`（`SameSite=Strict` cookie，
在跨站 iframe 中註定不被送出，實測 303 → `GET /` → 401）。

## 目標與非目標

**目標**

- 依賴伺服器端 session cookie 的站台（dsh web、Django/Rails/PHP 式後端）在代理模式下維持登入。
- cookie 不經過瀏覽器：`Set-Cookie` 不轉發給頁面，請求的 `Cookie` 由 jar 組裝，頁面無從讀取。
- 登入態跨 VS Code 重啟存活（SecretStorage，OS 加密），目標體驗：30 天內 token 只用一次。

**非目標**

- 不做瀏覽器端 cookie 轉發（原決策維持）。
- 不解 OAuth / 第三方 callback 的硬否決（原 L3 層，與 cookie 無關）。
- 不做多帳號 / 多 session 並存（每個目標 origin 一個 jar）。

## 架構

| 檔案 | 改動 |
| --- | --- |
| `src/cookie-jar.ts`（新） | 純 Node 的 `CookieJar` 類別，不 import vscode，可獨立測試 |
| `src/proxy.ts` | 三個接線點（見下）；`FrameProxy` 建構子加可選參數，向下相容 |
| `src/extension.ts` | SecretStorage adapter、debounce 持久化、新指令與設定 |
| `package.json` | 新設定 `browser.proxyCookieJar`（**預設 off**，見風險）、新指令 `browser.clearProxiedLogins` |
| `test/proxy-units.js` | jar 解析/發送/驅逐的單元測試 |

## 資料模型

```
Map<targetOrigin, Map<cookieKey, StoredCookie>>
cookieKey = name + '|' + domain + '|' + path
StoredCookie = { name, value, domain, hostOnly, path, secure, expiresAt|null, createdAt, lastUsed }
```

上限（防無限成長）：每 origin ≤ 50 條、全域 ≤ 300 條、持久化序列化 ≤ 64 KB；
驅逐按 `lastUsed` 最舊優先；過期條目在讀取與存檔時清掉。

## RFC 6265 子集

**收（Set-Cookie）**：解析 `name=value` 與 `Expires`/`Max-Age`/`Domain`/`Path`/`Secure`
（`SameSite`/`HttpOnly` 記錄但不影響行為——代理是 HTTP client，不存在跨站語境）。
`Domain` 有值 → `hostOnly=false` 且必須 domain-match 請求 host，否則整條拒收；
無值 → `hostOnly=true`、domain = 請求 host。`Path` 缺省用 default-path 演算法
（取請求路徑最後一個 `/` 之前）。`Max-Age` 優先於 `Expires`；已過期 → 刪除同鍵條目；
同 `(name, domain, path)` → 取代並保留原 `createdAt`。

**發（Cookie header）**：domain-match + path-match（§5.1.4）+ `secure` 僅配 https；
排序 Path 長者優先、同長按 `createdAt`；序列化 `n=v; n2=v2`。

**多值 Set-Cookie**：Node 會把重名 header 折疊成逗號串；比照 `_cspPolicies` 用
`rawHeaders` 取出每一條。（逗號也是 cookie `Expires` 日期裡的字符，切分必須按
header 邊界而不是按逗號——rawHeaders 天然解決。）

## 接線點（src/proxy.ts）

1. **`_outgoingHeaders`**：`cookie` 照舊從 DROP 清單剔除（頁面的 cookie 本來就不可信），
   改為附加 `jar.send(target.url, isHttps)` 的結果；jar 無條目時不產生 header。
2. **`_copyResponseHeaders`**：在剝除 `set-cookie` **之前**，用 `pres.rawHeaders`
   逐條 `jar.receive(target.url, cookieString, isHttps)`。
3. **`_handleUpgrade`**：出閘 headers 同 1；101 握手回應的 `set-cookie` 同 2
   （dsh 的 `/connect` 走 HTTP，但 mux 握手可能刷新 cookie，一律收）。
4. **bounce / redirect**：302 bounce 保留 query，`?token=` 因此能抵達上游；
   3xx 的每一跳各自是一個代理請求，自然經過 1–3。
5. **`dispose()`**：不清 jar（登入態要跨重啟）；清空只由指令觸發。

## dsh 端到端流程（實作後的驗證標的）

1. 面板輸入 `/p/<t>/http/127.0.0.1:3080/?token=X` → bounce 302 → `/?token=X`。
2. 代理轉發 → dsh `303` + `Set-Cookie: dsh-auth-…=v1.…; Max-Age=2592000; HttpOnly; SameSite=Strict`
   → jar 收下（SameSite 忽略）；`Location: ./` 改寫成根相對 `/`。
3. 頁面 `GET /` → jar 帶 cookie → `200`，UI 載入。
4. 頁面 WebSocket `/api/remote.mux` → 握手帶 cookie → `101`。
5. VS Code 重啟 → jar 自 SecretStorage 載回 → 免登入，直到 30 天 cookie 過期。
6. 期間 dsh 重啟換新 token → 不影響（cookie 簽章金鑰持久，已實測舊 cookie 跨重啟有效）。

## 風險（誠實面）

**R1 — 共用 origin 的跨目標讀取。** 代理 origin 由所有站台共用，已載入的頁面
本來就能用顯式 `/p/<token>/<scheme>/<host>/…` 形式讀其他目標的**公開**內容
（shim 的 `?bp=` 就帶著含 token 的 prefix，頁面讀得到）。jar 開啟後，同一路徑
升級為可讀其他站台的**已認證**內容。

實測（真實 `FrameProxy` + 兩個假上游）：站台 A 的頁面對站台 B 發 `/p/<token>/…`
形式 GET，proxy 會 302 bounce 並**立即把 `_lastTarget` 切成 B**，之後 A 頁面的
所有根相對請求（含普通子資源）都被送到 B；B 看到的 `Referer`/`Origin` 已被
`_rewriteOrigin` 改寫成 B 自己。「僅當請求的 `Referer` 解析回同一 target origin，
或請求本身是文檔導航時才附 cookie」的緩解因此**恆不成立、擋不住任何事**
（Referer 被頁面策略剝除的非導航請求不附 cookie → 該站退回未登入，寧可壞、
不越權的路線也走不通）。

處置：不實作 Referer 緩解（假安全感）；設定**預設 off**、opt-in，設定說明與
`docs/PROXY.md` 寫明威脅模型：適合自架/可信服務（dsh、內網開發伺服器），
不建議在代理瀏覽不可信網站時開啟。根治（每請求自帶 target、per-target origin，
如 loopback 別名分址）列為獨立任務，不阻擋本功能。

**R2 — 憑證落碟。** 用 `context.secrets`（Windows 上 DPAPI 加密、per-extension
隔離），不用明文 `globalState`。序列化內容僅 cookie；jar 內不含 proxy token。

**R3 — 除錯透明度。** DevTools 的 Application → Cookies 看不到 jar 內容；
`browser.clearProxiedLogins` 指令與（可選）輸出通道日誌補償。

**R4 — 與既有清理的關係。** jar 與 webview 的「Clear Webview Storage」獨立，
單獨提供清空指令，避免使用者誤以為清 storage 會登出代理端 session。

## 測試計畫（test/proxy-units.js 增補）

- 解析：基本收發、`Domain` 拒收不匹配、`Path` default-path、`Max-Age` 覆蓋
  `Expires`、過期刪除、同鍵取代、`Secure` 標記。
- 發送：domain-match（hostOnly 與否）、path-match 邊界（`/foo` vs `/foobar`）、
  https-only、排序、序列化格式。
- 邊界：上限驅逐順序、重複 Set-Cookie（rawHeaders 路徑）、空/畸形值不拋例外。
- 端到端（out of tree，docs/PROXY.md 補測量）：dsh token → 303 → 200 →
  WS 101 → 重啟 VS Code 免登入。

## 工作量估算

`cookie-jar.ts` ~200 行；`proxy.ts` 改動 ~40 行；`extension.ts` ~30 行；
測試 ~150 行；文件同步（PROXY.md「登入態」拆成「瀏覽器端轉發：維持不做」與
「代理端 jar：新、opt-in」、ISSUES.md 決策修訂、CHANGELOG 條目）。
