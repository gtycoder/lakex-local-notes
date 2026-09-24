# 浏览器端设计（桌面附属窗口）

> 本文是「浏览器端」的方向与阶段计划。**现状/待办以 `HANDOFF.md` 3.10 为准**；思源调研原文见工作区根
> `siyuan-kernel-web-server-report.md`（内核）与 `siyuan-browser-adaptation-report.md`（前端），本文只留结论。

## 1. 我们的形态（先定边界）

- 浏览器端 = **桌面端的附属窗口**：主进程额外起一个 HTTP 服务（默认 `127.0.0.1:19880`，`electron/webApiServer.ts`），
  - 静态服务渲染层构建产物 `dist/`；`/__native.js` 注入 `window.lakeNative` 的 HTTP shim（方法面与 `preload.cjs` 一致，单测卡漂移）；
  - `POST /api/<channel>` 复用 IPC 注册表，数据仍是本机那一份 SQLite/文件（**单一真相**）；
  - **只绑回环、不做局域网伺服**；**运行期起停**（默认关，重启恢复关）；**不是同步参与者**（只覆盖本机）。
- 与思源的差异：思源是「内核+Web UI」架构，浏览器=另一前端，desktop/mobile 是独立编译产物、UA 分流、
  可选局域网/远程 + AccessAuthCode；我们**不做**那些（见 4「不借鉴」）。

## 2. 现状（electron/webApiServer.ts）

- 已覆盖约 100 个 IPC 方法（WEB_METHODS）。
- 安全面（**已比早期交接记录的更完整**）：仅 header `x-lake-token`（常量时间比较、禁 query token）、
  Origin/Host 白名单（防 DNS rebinding、空端口旁路）、`Sec-Fetch-Site: cross-site` 拒绝、
  `/__native.js` 仅 same-origin/none、dist 路径穿越防护、256MB body 上限。
- 已知缺口：**推送曾缺失**（shim 里两个订阅是空桩）→ 本阶段已补；**宿主能力语义错**；无 `dev:web` HMR。

## 3. 阶段计划

### 阶段 1（已落地）：SSE 推送

- 端点 `GET /__events`（`webApiServer.ts`）：与 `/api` 同一 header token 鉴权；响应 `text/event-stream`，常驻连接；
  `WebApiServer.broadcast(event, data)` 把 `event: <name> + 空行 + data: <json>` 写给所有客户端；服务关闭时清理。
- 主进程接线：`broadcastSyncProgress`（`electron/main.ts`）与 pending 摘要 diff（`afterInvoke`）各加一行 `webServerController?.broadcast(...)`。
- 客户端 shim（`renderNativeShim`）：两个订阅用 **fetch 流自解析 SSE**（EventSource 不能带 header）实现为单连接多监听，
  `onSyncProgress`/`onPendingSummaryChanged` 返回 unsubscribe；无监听时断开、断线 3s 重连。
- 验证：单测（`webApiServer.test.ts`：无 token 403 / 200 + 帧投递）+ 真机冒烟（Web API 写操作 → SSE 收到 `pending-summary-changed`）。

**为什么用 SSE 不用 WS**：我们的 RPC 已走 HTTP POST，推送是**单向**的；SSE 复用同一 HTTP 服务与 header 鉴权，零新依赖。

### 阶段 2（待做）：宿主能力 + 浏览器等价路径

- 在 shim 暴露 `window.lakeNative.hostCapabilities`（或 `__lakeHost`），由「本机自持内核 vs 远程」推导，**只用于 UI 显隐/换实现**（不吞错）：
  接口草案 `{ localFileSystem, importExport, remoteKernel, ownsKernel }`（先最小集，按需扩）。
- 浏览器等价实现：
  - 导出/备份：不用 `dialog.showSaveDialog`，改 `Content-Disposition: attachment` 下载（或 blob + a[download]）；
  - `openAttachment` → 新标签/下载；`showAttachmentInFolder`/`revealNoteFile`/`revealDataFolder` → 隐藏；
  - `copyAssetImage` → `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`；
  - `pickExportDir`/`pickBackupDir`/`confirmRelaunch` → 浏览器无对应，走下载/忽略。
- 参考：思源 `getHostCapabilities()`（`app/src/util/hostCapabilities.ts`）用「连接来源+内核归属」推导能力；
  `saveExportFile` 纯浏览器分支 = window.open(url + download=true)。

### 阶段 3（可选）：体验

- `npm run dev:web`（vite dev + 独立浏览器入口）以拿到 HMR；设置页「浏览器端」说明与开/关打磨。
- 可选安全增强：响应 `X-Content-Type-Options: nosniff`；若将来支持非回环访问，再评估 token/锁屏/Origin 组合。

## 4. 明确**不借鉴**思源的部分（形态不同，照搬是过度设计 AGENTS 3 #17）

- 编译期 `#if BROWSER` 双 bundle（673 处）：我们同一份 dist + 运行时 shim 已足够，渲染层本就不 import electron。
- 局域网/远程访问 + AccessAuthCode/OIDC/JWT 角色/限流/多工作空间：除非产品决定开放跨机访问。
- 发布服务、WebDAV/CalDAV、插件/挂件生态、WS 双向 RPC：非当前形态。
- **两个反面坑**：思源 CORS ACAO:* 与 Credentials:true 同设（规范不允许）；「回环无密码即管理员」直通（我们用 header token 更稳）。
