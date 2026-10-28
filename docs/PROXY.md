# [已完成] 本地 frame proxy

> **狀態標記**：[已完成]
> **時間**：2026-08-22（2026-09-18 覆核完成）
> **說明**：本文檔記錄之 Next.js 頁面閃爍循環問題與 Header 轉發機制已於 2026-08-22（v0.3.14）在 `src/proxy.ts` 完成修復並驗證。

---

`browser.proxyEnabled` 打开后，webview iframe 不直连目标站，而是走 extension host 里绑在 `127.0.0.1` 的 HTTP 代理（`src/proxy.ts`）。目的只有一件事：剥掉 `X-Frame-Options` / CSP `frame-ancestors`，让「只禁止内嵌」的页面能显示。

这不是 Next.js 专用通道。任意 `http`/`https` localhost（或外网）都走同一条路径。静态页、普通多页站点本来就不会闪；会出问题的是**会读 `window.location.pathname` 或自订请求头**的 SPA / 开发服务器。

## HTML shim（另开分页 / 剪贴簿 fallback）

对 `text/html` 回应会在 `</body>` 前插入：

```html
<script src="/p/<token>/__bp_shim.js"></script>
```

代理只向上游请求自己能解压的编码（`gzip`、`deflate`、`br`，运行时支持时含 `zstd`），否则压缩响应会被当作 HTML 处理而渲染成乱码。

脚本与页面同属代理 origin，将 `window.open`、`a[target=_blank|_new]` 以及 Clipboard API 失败时的写入，经 `parent.postMessage` 交给 webview：另开走 `openExternal`，复制走 `copyText` → `vscode.env.clipboard.writeText`（不依赖 webview 自己的 Clipboard Permissions-Policy）。不注入 `<base>`、不改写路径。超过约 5MB 的 HTML（含无 `Content-Length`、边收边超限）**跳过注入并原样串流**，不再回 502。

## URL 形态

```
http://127.0.0.1:<port>/p/<token>/<scheme>/<host>/<path>
```

- `token` 防止本机其它进程把它当开放代理；v0.4.0 起另验证 `Host` 头必须是代理自身地址（`127.0.0.1:<port>` / `localhost:<port>`），其余一律 403 / 断开，防 DNS rebinding 与借用代理。
- 根相对路径（`/_next/static/...`、`/api/...`）落到代理根上，按「上一次解析到的目标」转发；目标 origin 由代理侧拼接锁定，请求路径不能改写目标（`//host`、绝对形式、反斜线等请求目标会被拒绝）。
- **文档导航 bounce（v0.4.1）**：以 `/p/<token>/...` 形式到达的 GET/HEAD 文档导航（`Sec-Fetch-Dest: document/iframe/frame`）不再直接在代理路径下伺服，而是 302 到目标自己的根相对路径。iframe 的 `location.pathname` 因此永远是目标路径、绝不是代理前缀——按 `location.pathname` 做路由的 SPA（opencode web UI、其它把 `/` 当唯一入口的 PWA）不再因解析出 `Unrecognised route!` 而崩溃。XHR/fetch 与子资源（`dest: empty` 等）和未携带 `Sec-Fetch-*` 的引擎保持旧的 prefix 直通行为（fail-open）。
- 同源 302/3xx 重定向同样改写为根相对路径（原来是带前缀形式）；跨源重定向仍走 `/p/<token>/...` 显式形式，随后被同一条 bounce 规则落到新目标的根相对路径上。
- **Sticky port（v0.4.1）**：綁定過的 port 記在 globalState，下次 start 優先重用（被其他進程佔用或第二個 VS Code 視窗時自動 fallback 到隨機 port）。port 穩定 → proxy origin 穩定 → 內嵌頁的 localStorage（opencode 的配對 token、主題設定）跨重啟保存，不必每次重新配對。
- 地址栏始终显示真实目标 URL，不显示代理 URL。

## 2026-08-22：开启 proxy 后页面闪烁（pi-web / Next.js）

### 现象

开启 `browser.proxyEnabled` 后访问 `http://localhost:30141/`（[pi-web](https://github.com/agegr/pi-web)）：

- webview 控制台反复 `iframe load #0`，`src` 不变
- extension host 反复打印同一组 `[proxy] GET /api/...`、`GET /?_rsc=...`、`GET /`
- **没有任何 4xx/5xx**，所以从 log 看「一切正常」

父页面没有改 `iframe.src`（没有 `nav to` / `proxy changed`）。是 iframe **里面的页面自己在整页重载**。

对照 pi-web 的 #329 / #286 / #497：那些是 Host/Origin `403 Untrusted API request`。这次 API 都成功，不是同一类问题。

### 为何静态 localhost 不闪、Next.js 会闪

iframe 的真实地址是代理路径 `/p/<token>/http/localhost:30141/`，不是 `/`。

| 站点类型 | 行为 |
|----------|------|
| 静态 HTML、普通多页 | 请求 `/style.css`、`/api` 走 last-target 转发即可，不读 pathname，稳定 |
| Vite / webpack HMR | 需要 WebSocket upgrade + 把 `Origin`/`Referer` 改成目标源；失败时 dev client 会整页 reload |
| Next.js App Router（pi-web） | hydrate 后发 `GET /?_rsc=...`，并带 `RSC`、`Next-Url`、`Next-Router-State-Tree` |

旧代理只转发 `user-agent` / `accept` / `accept-language`（当初为了改 HTML 才用白名单）。丢掉 `RSC: 1` 后，Next 把这次请求当成普通文档，返回 **整页 HTML**。客户端发现不是 RSC flight，就 fallback 成 `GET /` 整页导航 → 再 hydrate → 再发 `/?_rsc=` → 循环。这正好对上每一轮 log 的顺序。

同一套白名单也会伤其它框架：缺 `Content-Type` 的 POST、缺 HMR 头、Server Actions 用不了（旧代码还用了 `http.get`，根本不转发 body）。

### 修了什么

1. **转发几乎全部请求头**（只丢 hop-by-hop、`Host`、`Cookie`），不再用白名单。这是通用反向代理行为，不是 Next 特判。
2. 把 `Origin` / `Referer` / `Next-Url` 从 `/p/<token>/...` 改回目标站路径，让目标觉得是同源。
3. `http.request` + `pipe`，支持 POST 等带 body 的方法。
4. 不再注入 `<base>`（更早一轮：`<base>` 会污染 pathname，和框架的 canonical redirect 互撞）。

### 为何修完后「还会再加载一次」然后稳定

iframe 第一次仍落在 `/p/<token>/http/host/`。Next 看到 pathname 对不上路由，会再导航到 `/`（一次）。之后 RSC 头齐全，停在 `/`，不再循环。

这是 **path-prefix 代理的固有限制**，不是 infinte loop。要零次额外导航，得让 iframe 的 pathname 就是 `/`（例如每目标一个端口、或按 Host 分流），成本更高，目前不做。

> **2026-10-29 更新**：上面的「固有限制」已用第三种方式解决——文档导航 bounce（见「URL 形态」）。浏览器在 302 这一跳之后落在根相对路径上，`location.pathname` 就是目标路径，SPA 不再需要任何客户端补救导航；当时的「每目标一个端口 / 按 Host 分流」两个选项都没有采用。

## 2026-10-29：pathname 路由 SPA 崩溃（opencode web UI，TypeError reading 'type'）

### 现象

proxy 模式访问 `opencode serve`（v2.2.0，`localhost:4096`）：整页错误报告

```text
TypeError: Cannot read properties of undefined (reading 'type')
    at Object.current (…/_assets/current-DyM6QvW-.js:6:44234)
```

### 根因（bundle 实测，非推测）

opencode 的 web UI 是把 `/` 当唯一入口的 SPA：路由解析器只认 `pathname` 为 `/`、`/settings`、`/connect`、`/components`、`/new-session`、`/server/:key/session/:id`，其余一律 `throw Error('Unrecognised route!')`。代理路径 `/p/<token>/http/localhost:4096/` 五段全不匹配 → 路由 memo 保持 `undefined` → 下游 `current` computed 读 `e.type` 抛 TypeError，行:列 `6:44234` 正落在 `return e.type===` 的属性读取上。

**独立复现**（不经过本扩展）：opencode 对任意未知路径都回退同一份 SPA，所以直接在浏览器开 `http://127.0.0.1:4097/p/abc123/http/localhost:4097/` 即得到一字不差的同一崩溃——证明崩因是 pathname 本身，与代理的其余行为无关。已排除：Set-Cookie/Cookie 丢弃（opencode web UI 不用 cookie，认证走 URL `auth_token` 参数）、压缩处理、shim 注入。

### 修复

文档导航 bounce（见「URL 形态」）：302 落到根相对路径，`location.pathname === '/'`，路由解析 `{type:'home'}`，正常渲染。已用真实 `FrameProxy` + 真实浏览器验证：密码登录、会话列表、打开会话、消息渲染全部正常，console 无错误。

### 边界

- POST/PUT 文档导航（表单直接 POST 到带前缀的绝对 URL）不 bounce（避免 307/308 语义陷阱），仍是 prefix 直通——这类 SPA 场景罕见，pathname 仍带前缀。
- 不发 `Sec-Fetch-*` 的客户端 fail-open 回旧行为（VS Code webview 的 Chromium 一定发送）。
- 302 这一跳是服务端重定向，浏览器跟随后才渲染，不存在旧方案「先渲染错路径再客户端补救」的白屏/闪烁。

## 其它已知边界

- `Set-Cookie` 故意丢弃（HTTP 响应与 WebSocket upgrade 握手都不转发）；走 proxy 的登录不持久。
- JS 写死的绝对 `https://` URL 会绕过代理。
- 单一 `_lastTarget`：同时只服务当前这一个 iframe。
- 跨源 iframe 读不到 `contentWindow.location`，地址栏跟的是 `iframe.src` 属性，站内再跳到 `/` 时栏上可能仍显示你输入的 URL。
- WebSocket upgrade 必须保留 `Connection` / `Upgrade`（普通 HTTP 请求则要丢掉这两项）。
