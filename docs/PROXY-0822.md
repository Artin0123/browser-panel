# 本地 frame proxy

`browser.proxyEnabled` 打开后，webview iframe 不直连目标站，而是走 extension host 里绑在 `127.0.0.1` 的 HTTP 代理（`src/proxy.ts`）。目的只有一件事：剥掉 `X-Frame-Options` / CSP `frame-ancestors`，让「只禁止内嵌」的页面能显示。

这不是 Next.js 专用通道。任意 `http`/`https` localhost（或外网）都走同一条路径。静态页、普通多页站点本来就不会闪；会出问题的是**会读 `window.location.pathname` 或自订请求头**的 SPA / 开发服务器。

## URL 形态

```
http://127.0.0.1:<port>/p/<token>/<scheme>/<host>/<path>
```

- `token` 防止本机其它进程把它当开放代理。
- 根相对路径（`/_next/static/...`、`/api/...`）落到代理根上，按「上一次解析到的目标」转发。
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

## 其它已知边界

- `Set-Cookie` 故意丢弃；走 proxy 的登录不持久。
- JS 写死的绝对 `https://` URL 会绕过代理。
- 单一 `_lastTarget`：同时只服务当前这一个 iframe。
- 跨源 iframe 读不到 `contentWindow.location`，地址栏跟的是 `iframe.src` 属性，站内再跳到 `/` 时栏上可能仍显示你输入的 URL。
- WebSocket upgrade 必须保留 `Connection` / `Upgrade`（普通 HTTP 请求则要丢掉这两项）。
