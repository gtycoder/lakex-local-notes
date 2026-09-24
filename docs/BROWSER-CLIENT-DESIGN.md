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
- **第三个事件 `library-changed`（260924 bug 修复）**：目录树结构变更的 IPC 通道（create/move/rename/delete/restore/…）在主进程 `afterInvoke` 里无条件广播；桌面 preload 的 `onLibraryChanged` 与 shim 的 SSE 订阅都接它，渲染层 `useSyncRefresh` 收到后重读目录树 + 摘要 ⇒ **浏览器端写入后，桌面端目录栏自动刷新**（此前需手动刷新）。
- 验证：单测（`webApiServer.test.ts`：无 token 403 / 200 + 帧投递）+ 真机冒烟（Web API 写操作 → SSE 收到 `pending-summary-changed`；Web API 建画板 → 桌面收到 `library-changed{channel}` 且目录树自动出现）。

**为什么用 SSE 不用 WS**：我们的 RPC 已走 HTTP POST，推送是**单向**的；SSE 复用同一 HTTP 服务与 header 鉴权，零新依赖。

### 阶段 2（已落地，260924）：宿主能力 + 浏览器等价路径

- shim 暴露 `window.lakeNative.capabilities = { browserClient: true, nativeDialog: false }`；`src/lib/native.ts` 加 `native.capabilities` getter（桌面/移动缺省 `browserClient:false, nativeDialog:true`）。
- shim **透明覆盖**三个宿主专属方法（无需改调用点）：
  - `saveAssetAs` → 用 assetServer URL（带 `?token=`）`fetch` 成 blob + `a[download]` 浏览器下载（不再弹桌面保存框）；
  - `openAttachment` → `window.open(assetUrl, "_blank")`（新标签，不拉起桌面应用）；
  - `copyAssetPath` → 复制**资源 URL**（替代浏览器里无意义的本地绝对路径）。
- UI 按能力 gate（不吞错）：`useNoteActions.exportNoteById` 与 `SettingsPanel.runBackup`/`runCloudRestore` 在 `!nativeDialog` 时给明确提示「请在桌面端操作」，不弹桌面目录框。
- **未做（无 zip 依赖，不打算为它加依赖）**：整库备份 / Markdown 资料包这类**目录**导出的浏览器下载；若要做需先定 zip/多文件下载方案。
- 验证：单测（shim 断言 capabilities + 三个覆盖）；真机冒烟（`/__native.js` 取 shim；跨源带 token 取真实资源 200 + 回显 ACAO，无 token/坏源 403）。
- 参考：思源 `getHostCapabilities()` 用「连接来源+内核归属」推导能力；本项目的 `reveal*`/`copyAssetImage` 因**浏览器与桌面同机**，沿用主进程实现即可（未改）。

### 阶段 3（部分已做，260924）：体验与加固

- ✅ 设置页「浏览器端」说明更新：读写同库 + SSE 实时推送 + 图片走浏览器下载/附件新标签打开；导出/整库备份仍需桌面端；开关不落盘。
- ✅ 静态响应加 `X-Content-Type-Options: nosniff`（与 assetServer 口径一致）。
- ⏸ **`dev:web`（HMR）不做**（用户 260924 决定）：要动 Origin 白名单、有安全面，等真要高频调浏览器端 UI 再开。
- **不开放局域网/远程访问**（用户 260924 明确）：故不引入 AccessAuthCode/OIDC/JWT/限流那一套。

## 4. 明确**不借鉴**思源的部分（形态不同，照搬是过度设计 AGENTS 3 #17）

- 编译期 `#if BROWSER` 双 bundle（673 处）：我们同一份 dist + 运行时 shim 已足够，渲染层本就不 import electron。
- 局域网/远程访问 + AccessAuthCode/OIDC/JWT 角色/限流/多工作空间：除非产品决定开放跨机访问。
- 发布服务、WebDAV/CalDAV、插件/挂件生态、WS 双向 RPC：非当前形态。
- **两个反面坑**：思源 CORS ACAO:* 与 Credentials:true 同设（规范不允许）；「回环无密码即管理员」直通（我们用 header token 更稳）。
