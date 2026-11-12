# 本地 frame proxy

`browser.proxyEnabled` 打開後，webview 的 iframe 不直連目標站，而是走 extension host 內綁在 `127.0.0.1` 的 HTTP 代理（`src/proxy.ts`）。任何 `http`／`https` 站台都走同一條路徑，與框架無關。

這份文件只寫現行的行為與判據；2026-08-22 與 2026-10-29 兩次調查的逐段過程收在 `PROXY-HISTORY.md`。

讓「禁止內嵌」的頁面顯示，必須同時通過兩道閘門：

| 閘門 | 判據 | 做法 |
| --- | --- | --- |
| 瀏覽器端 | 回應帶 `X-Frame-Options` 或 CSP `frame-ancestors` | 剝掉標頭與該 directive |
| 伺服器端 | 請求的 `Sec-Fetch-Dest` 是 `iframe`／`frame` | 轉發前改寫成 `document` |

第二道是目標站在應用層自行判斷，否決時回一份**不帶 `X-Frame-Options`** 的 403 HTML 頁，瀏覽器照實把它畫進 iframe，剝標頭完全擋不住。

容易撞上這兩道閘門的有三類頁面：讀 `location.pathname` 做路由的 SPA、需要自訂請求頭或 WebSocket 的開發伺服器（Next.js RSC、Vite HMR）、靠 cookie 維持 session 的登入流程。前兩類由下面的 URL 形態與請求頭處理，第三類見「登入態」。

## URL 形態

```
http://127.0.0.1:<port>/p/<token>/<scheme>/<host>/<path>
```

- `<token>` 讓本機其他行程無法把它當開放代理使用；`Host` 也必須是代理自己的位址（`127.0.0.1:<port>`／`localhost:<port>`），其餘回 403 並斷線，防 DNS rebinding。
- 根相對路徑（`/_next/static/…`、`/api/…`）落在代理根上，按「上一次解析到的目標」轉發。目標 origin 由代理端拼接鎖定，請求路徑不能改寫目標：`//host`、absolute-form、反斜線一律拒絕。
- **文檔導航 bounce**：以 `/p/<token>/…` 形式到達的 GET／HEAD 導航不在代理路徑下回應，而是 302 到目標自己的根相對路徑。iframe 的 `location.pathname` 因此永遠是目標路徑，按 pathname 路由的 SPA（opencode web UI、把 `/` 當唯一入口的 PWA）不會解析失敗。prefix 形式只來自 webview 的 bootstrap 與跨源重定向改寫，兩者本來都是導航，所以不必再判 `Sec-Fetch-Dest`。
- 同源 3xx 改寫成根相對路徑；跨源 3xx 仍走 `/p/<token>/…` 顯式形式，再由 bounce 落到新目標的根相對路徑。
- `dest=serviceworker` 的請求回 404。代理 origin 由所有經代理網站共用，任一個網站註冊的 Service Worker 都會存活並攔截其他網站的請求（opencode 就會註冊）。
- 所有轉發的回應強制 `cache-control: no-store`，並移除 `expires`／`pragma`。代理 origin 共用、bounce 又讓文檔落在 `/` 這類與目標無關的 URL 上，上游任何可快取的回應（最典型是 `http → https` 的 301）被瀏覽器記住後，會劫持之後所有經過該路徑的導航。本地開發代理從瀏覽器快取得不到任何好處。
- 探測回報 status ≥ 400 且 body 近乎空時，面板顯示 HTTP 錯誤頁而不是白屏（bot 防護站對 iframe 常回空的 403／404）。站台自己帶內容的錯誤頁照常渲染；4xx 不啟動自動重連，5xx 會。
- Port 記在 globalState 並優先重用，被佔用或開第二個視窗時退回隨機 port。port 固定，代理 origin 就固定，內嵌頁的 localStorage（例如 opencode 的配對 token）才能跨重啟存活。
- 地址欄永遠顯示目標 URL，不顯示代理 URL。

## 請求頭

除 hop-by-hop、`Host`、`Cookie` 之外全部轉發。白名單式的轉發會丟掉 `RSC`、`Next-Url`、`Next-Router-State-Tree` 之類的頭：Next.js 收到缺 `RSC: 1` 的請求會回整頁 HTML，客戶端發現不是 flight response 就改成整頁導航，於是 hydrate → 發 `?_rsc=` → 整頁導航無限循環。同一套白名單也會壞在別的地方：沒有 `Content-Type` 的 POST、缺 HMR 頭的 Vite。

轉發時改寫三處，讓目標站把請求看成本站自己的：

- `Origin`、`Referer` 從代理形態改回目標站路徑。
- `Next-Url` 用同一套映射；指向其他 origin 的絕對值原樣保留，不折成當前站台的路徑。
- `Sec-Fetch-Dest` 的 `iframe`／`frame` 改寫成 `document`，其餘（`script`、`style`、`image`、`empty`、`document`）不動。判據實測只有 `Dest`：

| `Sec-Fetch-Dest` | 結果（`antigravity.google.com`，`Origin`／`Referer` 已改寫） |
| --- | --- |
| `iframe`、`frame` | 403（`Sec-Fetch-Site` 為 `cross-site`／`same-origin`／`none` 都一樣） |
| `document`、`empty` | 302 → 200 |

`Sec-Fetch-Site`、`Sec-Fetch-Mode` 單獨變動不影響結果，因此不改；改了反而造出 `mode=cors` 配 `site=none` 這種不自然的組合。把 `iframe`／`frame` 視為 `document`，讓經代理的頁面在每個伺服器眼中都是 top-level，與 `Origin`／`Referer` 改寫是同一個意圖，不另設開關。不以 `Dest` 判定的站台（`www.google.com`、`gemini.google.com` 實測 `iframe` 也是 200）不受影響。

## 回應頭

- 剝掉 `X-Frame-Options` 與 CSP 的 `frame-ancestors` directive，其餘 directive 原樣保留。
- 沒有 body 的回應（`HEAD`、`204`、`304`）原樣轉送。注入 shim 會偽造一個不該存在的 body，還會把 `content-length` 改成標籤大小。
- `Location` 依同源／跨源改寫成對應的代理形態，無法解析的值原樣轉發。
- 向上游只要求自己解壓得了的編碼（`gzip`、`deflate`、`br`，執行時支援時含 `zstd`）。解不開的壓縮回應會被當成 HTML 處理，變成亂碼。

## HTML shim

`text/html` 回應會在最早位置插入一支外掛腳本：

```html
<script nonce="…" src="/p/<token>/__bp_shim.js?bp=%7B…%7D"></script>
```

插入點是 `<head>` 之後，沒有 `<head>` 就退到 `<html>` 之後，再退到 doctype 之後。必須在任何頁面腳本之前執行，否則在 parse 階段就呼叫 `window.open` 的頁面（OAuth 自動跳轉頁）會先跑掉。`?bp=` 帶該文檔的目標映射（目標 origin 加代理前綴），shim 用它把回報的 URL 還原成目標 URL；用 query 而不用 inline bootstrap，是因為 nonce 型 CSP 會攔下 inline。

頁面自帶 CSP 時，代理改寫政策讓這支腳本合法。一個 `Content-Security-Policy` 標頭值可以是用逗號分隔的**政策清單**，每條各自獨立強制執行，文件必須同時滿足全部（Google 的產品頁就送兩條：一條帶每次回應都不同的 `script-src` nonce，一條帶 `require-trusted-types-for` 與 `report-uri`）。因此政策從 `rawHeaders` 取（保留重名標頭）並按逗號切開，逐條處理：

- 每條政策裡只有第一個 `script-src`（沒有則第一個 `default-src`）算數，後續重複的忽略。
- 政策已允許 `'self'` 就原樣保留。
- 政策用 nonce 收緊時，只有在所有這類政策共用同一顆 nonce 才借用它（一個標籤只能有一個 nonce 屬性），否則各自補 `'self'`；`'strict-dynamic'` 下借用 nonce 同樣有效。
- 補 `'self'` 才能授權外部腳本：hash source 只匹配 inline 內容，而 Chromium 在 `'none'` 與其他來源並列時忽略 `'none'`。
- 補在既有的 directive 上，不新增 `script-src`，否則會蓋掉 `default-src` 給頁面 inline script 的 `'unsafe-inline'`。
- 輸出時保持多條政策（多個標頭行）。

shim 做四件事，都經 `parent.postMessage` 交給 webview：

- `window.open` 與 `a[target=_blank|_new]` → `openExternal`，交給系統瀏覽器。
- Clipboard `writeText` 被 Permissions Policy 擋下 → `copyText` → `vscode.env.clipboard.writeText`。
- `pageNavigated` 回報：document start、`load`、`popstate`、`hashchange`，以及 `pushState`／`replaceState`。iframe 的 `src` 屬性不隨 in-frame 導航更新，沒有這些回報，URL 欄、前進後退與可達性探測在第一次點連結後就失準。
- `target="_top"`／`target="_parent"` 的「模擬意圖」。宿主給 webview iframe 的 sandbox 旗標是 `allow-scripts`、`allow-same-origin`、`allow-forms`、`allow-pointer-lock`、`allow-downloads`，**沒有 `allow-top-navigation`，也沒有 `allow-popups`**，要求換掉頂層文件的導航會被瀏覽器**靜默丟棄**：沒有錯誤、沒有日誌，頁面自己也觀察不到，看起來就是按鈕壞了。Google One Bar 的登入連結正是這個形狀。同站的 `_top`／`_parent` 改在面板內導航（絕對 href 先改寫成代理形態，否則 frame 會跑去真站、被 `X-Frame-Options` 擋成空白），跨站的交給系統瀏覽器，`javascript:`、`mailto:`、`tel:`、`data:`、`blob:`、`about:` 放行給瀏覽器。

shim 也負責把相對 URL 還原成真站 URL：`window.open('/path')` 與相對的 `_blank` 連結按代理 origin 解析，直接轉出去就是 `http://127.0.0.1:<port>/path`，面板一關就成了死鏈。bounce 後的根相對文檔與 `/p/<token>/…` 顯式形式都會映射回真站。

超過約 5MB 的 HTML（包含沒有 `Content-Length`、邊收邊超限的情況）跳過注入，原樣串流。

## 子資源的 `crossorigin`

CDN 只對站台的真實 origin 發 `Access-Control-Allow-Origin`。頁面若在 script／link 上標 `crossorigin="anonymous"`，載入就變成 CORS 模式，同一個檔案雖然回 200 仍被判失敗（`net::ERR_FAILED 200 (OK)`），主 bundle 從未執行。經典 script 不需要 CORS 授權，所以代理把 `crossorigin` 移除：

- HTML 內的標籤由代理剝除。帶 `integrity` 的標籤不動——對 opaque 回應做 SRI 必然失敗；`as=font` 的 preload 也不動——`@font-face` 本來就用 CORS 抓取，no-cors 的 preload 只多做一次白工。
- 頁面之後動態建立的元素由 shim 接管：覆寫 `HTMLScriptElement`、`HTMLLinkElement` 的 `crossOrigin` setter 與 `setAttribute('crossorigin')`。

## 登入態

面板拿不到你在外部瀏覽器的登入狀態，這是三層各自獨立的原因，只修好其中一層都不夠：

1. **兩個行程、兩個儲存分區。** 系統瀏覽器的 profile 與 webview 的 Electron session 分開，兩者之間沒有 API，webview 也讀不到瀏覽器的 profile。代理模式下頁面又只有 `http://127.0.0.1:<port>` 一個 origin，「同站 cookie」只會綁在代理 origin 上。
2. **代理丟掉 cookie。** 請求的 `Cookie` 在丟棄清單裡，回應的 `Set-Cookie` 在 HTTP 與 WebSocket 握手兩條路徑都不轉發。代理 origin 由所有經代理網站共用，把上游 cookie 轉給瀏覽器會讓不同站台的 session 落在同一個 origin 下互相污染，`Domain`／`Path` 在改寫過的位址下也失去原意。
3. **OAuth 回呼只認已註冊的位址。** 用站台自己的 client id 打 `accounts.google.com/o/oauth2/v2/auth`（`response_type=token`）：

| `redirect_uri` | 結果 |
| --- | --- |
| `https://antigravity.google.com/` | 已註冊（`prompt=none` 回 `interaction_required`） |
| `https://antigravity.google.com/u/2/` | `redirect_uri_mismatch` |
| `http://127.0.0.1:<port>/`、`…/p/<token>/https/antigravity.google.com/u/2/` | `invalid_request`，訊息要求「upgrade to a supported browser」 |

補上 cookie 轉發只對靠伺服器端 session 的普通站台有用（Django、Rails、PHP 那種），對第 3 層的硬否決照樣無效，而共用 origin 會帶進一批新邊界：domain 衝突、`HttpOnly` 失去意義、兩個站台互相看到對方的 cookie。所以代理不做 cookie jar。

登入能成立的情況只有一種：關掉代理，且站台本身允許被內嵌。cookie 存在 webview 的 Electron session 裡，跨 hide／show、Close／Reopen、編輯器重啟都在，只有「Developer: Clear Webview Storage」或站台自己的過期會清掉。需要身分的流程一律用選單的 **Open in external browser**。

## 外部開啟的 URL 要原樣送出

`vscode.env.openExternal` 的型別只收 `Uri`，但宿主對兩種形態處理不同：字串原樣轉發，`Uri` 會先經過一次 `encodeURI(uri.toString(true))`。`encodeURI` 自己會轉義 `%`，於是每個既有的百分號轉義都多一層。同一顆登入按鈕的實測：

| 送出形態 | 瀏覽器收到 | `continue` 解出來 | 登入完成後 |
| --- | --- | --- | --- |
| 字串 | `…continue=…%3Fpli=1` | `https://antigravity.google.com/?pli=1` | 200 |
| `Uri` | `…continue=…%253Fpli=1` | `https://antigravity.google.com/%3Fpli=1` | 404 |

轉送因此一律先送字串，宿主拒收才退回 `Uri.parse(...)`。把 `%3F` 還原成 `?` 的補償寫法不可行：那會改動 URL 本體，遇到位元組完全一致的簽名式網址就會壞。

## 仍然做不到的

- **把 localhost 當開發環境的站台會走 dev 分支**，因為代理模式下每個頁面都在 `127.0.0.1`。`antigravity.google.com` 的藍色 Sign in 按鈕就是例子：`signIn()` 整段內容在 `protocol!=="http:" || !isLocalhost(hostname)` 條件下，條件在代理環境永遠不成立，函式等於空的。`window.location` 無法偽造（重新定義會拋 `TypeError`，`href` 存取子不可配置），只有 `Location.prototype.assign`／`replace` 可包，所以 shim 也攔不到 `location.href = …`。
- 頁面用 `<form target="_top|_blank">`、`<meta http-equiv="refresh">`、`<area>`、腳本裡的 `form.submit()` 離開 frame 時，shim 不介入，行為與 sandbox 預設相同。
- JS 寫死的絕對 `https://` URL 會繞過代理。
- 同時只服務一個 iframe（單一 `_lastTarget`），根相對請求按最後解析到的目標轉發。
- 跨源 iframe 讀不到 `contentWindow.location`，地址欄跟的是 iframe 的 `src` 屬性，站內再導航時可能仍顯示你輸入的 URL。
- `base-uri 'self'` 會擋掉頁面自己的 `<base>`；相對 URL 於是以代理 origin 解析並按 last target 轉發，取到的資源正確，所以不改這條 directive。
- 需要 `Access-Control-Allow-Credentials` **加上**站台 cookie 的跨源 XHR（`ogads-pa.clients6.google.com`）與遙測（`play.google.com/log`）不可能成功，但都不影響渲染。
- Service Worker 在 webview 內不執行。

## 測試

`npm test` 跑 `test/proxy-units.js`：用專案自己的 esbuild 打包 `src/proxy.ts` 再斷言，測的是出貨碼。涵蓋 CSP 政策清單與 nonce 抬升、`crossorigin` 剝離、shim 注入點與它能否被編譯、`Sec-Fetch-Dest` 映射、SSRF 拒絕、`Next-Url`／`Referer` 映射、防快取污染標頭、重定向改寫。
