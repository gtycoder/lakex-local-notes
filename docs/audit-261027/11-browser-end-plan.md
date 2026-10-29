# 11 · 浏览器端完善计划（用户 261028 裁决：保留，不删除）

> 决策：**浏览器端保留并完善**。用途 = 桌面端偶尔需要在浏览器里**分屏读笔记**；**仅桌面端**，移动端不做浏览器端。
> **补充（261028 二次确认）**：分屏由**浏览器自身**（并排窗口/分屏）完成，我们**不做**深链路由、多窗口会话、窗口间独立标签等我们侧的分屏功能——只需「能在浏览器里正常打开、正常读」。
> 计划因此缩减为：P0 安全收口 → P1 能力矩阵 + 下载等价物 → P2（可选）bundle 分离。
> 方向：学习思源（见 `/Users/admin/file/local-lake/siyuan-browser-adaptation-report.md` §6 的 10 条借鉴点），但**不照搬**它的远程内核/多工作空间模型——我们的浏览器端只服务"本机 127.0.0.1 + 同一份本地数据"。
> 基线：`master @ ea576a80` + A 批工作树。本文只给计划，不含实现；与 `02-security.md`（SEC-07 等）、`07-rfc`（v4）并行。

---

## 1. 现状（as-is，证据）

```
Electron 主进程
├── webApiServer.ts（默认关；设置页「浏览器端」开关）
│     ├── GET  /            → 静态服务 dist/（与 Electron 同一份前端）
│     ├── GET  /__native.js → 注入 window.lakeNative 的 HTTP shim（内含 API_TOKEN + ASSET_TOKEN）
│     ├── POST /api/<channel> → 复用 IPC 注册表（135 个方法，含写操作）
│     └── GET  /__events    → SSE 推送（进度/刷新事件；header token）
└── assetServer :19876      → 图片/附件（Origin 白名单 + token）
```

已具备（比 261025 报告时更好）：SSE 推送已实现；token 与资产 token 已拆开；默认关、纯内存态、每次启动重置；`/api` 已校验 `x-lake-token` 与 Host/Origin（有测试）。

**缺口（按用户真实用法；分屏本身交给浏览器，不在此列）**
| # | 缺口 | 证据 | 对"分屏读笔记"的影响 |
|---|---|---|---|
| G3 | **token 下发面** | `/__native.js` 对非浏览器客户端可伪造 `Sec-Fetch-Site: none` 拿全量 token（SEC-07） | 保留浏览器端后这是必须修的 P1 安全口 |
| G4 | **宿主能力语义粗** | 只有 `browserClient/nativeDialog` 两个标志；导出/备份/打开文件夹散落判断 | 浏览器里"点了报错/没反应"的入口多，读笔记之外的流程易踩坑 |
| G5 | **导出/下载无浏览器等价路径** | 导出依赖 Electron `showSaveDialog`；浏览器端被 `nativeDialog` 挡下 | 浏览器里无法导出/保存附件（读笔记可接受，但阅读场景常有"下载原文"） |
| G6 | **同一份 bundle 双端复用** | dist 同时给 Electron 与浏览器；Electron-only 依赖未按目标剪裁 | 首屏体积/初始化路径不区分；未来加浏览器专属逻辑会污染桌面 |

---

## 2. 目标与非目标

**目标**
1. 浏览器里能**正常打开/阅读**笔记（分屏用浏览器自带能力，我们不做深链/多窗口改造）。
2. 读笔记路径上的能力（渲染、图片/附件、大纲、搜索、同步状态）**无报错、无静默失败**。
3. 安全面收口：token 只在可信页面上下文可用；Origin/WS 校验单一来源。
4. 导出/下载有浏览器等价物（`Content-Disposition` 下载端点）。
5. 不与桌面端抢"完整端"定位：写操作保留（同一份数据），但危险动作（换云、恢复、备份）继续由 `nativeDialog` 能力挡。

**非目标**
- 移动端浏览器端（用户明确不需要）；局域网/远程访问（仍只 127.0.0.1）；账号体系；多用户。
- **我们侧的分屏/深链/多窗口会话功能**（用户 261028 二次确认：浏览器自带分屏，不需要我们做）。
- 不重写 webApiServer 为"第二后端"：它仍只是 IPC 注册表的 HTTP 传输层。

---

## 3. 计划（P0 → P3）

### P0 安全收口（S，**已实现 261028，未提交**）
1. **SEC-07**：`/__native.js` 不再无条件下发 token。改为：
   - 页面引导走 `GET /`（静态）→ `POST /api/bootstrap` 前先取"一次性 handshake"：`GET /__handshake` 仅接受 **同源 document 请求**（`Sec-Fetch-Dest: document` + Origin==Host），返回短期 token（内存、30s、单次）；
   - `/api`、`/__events`、`/__native.js` 一律要求 token + Origin 校验（`Origin === http://127.0.0.1:<port>` 或 `http://localhost:<port>`），**不再接受 `Sec-Fetch-Site: none` 作为放行依据**；
   - 对齐思源：`CheckOrigin` + `IsSessionOriginAllowed`（Origin 为空只放行原生客户端——这里没有原生 HTTP 客户端，可直接拒绝）。
2. **SEC-04/05 联动**：浏览器端开启时资产 URL 已带 token；`/__events` SSE 校验 Origin。**CSP `127.0.0.1:*` 保持通配**（261028 复核：功能性决定 + 去过度防御范围，撤回原"收成固定端口"方案）。
3. **验收**：`curl -H 'Sec-Fetch-Site: none' /__native.js` ⇒ 403；`Origin: http://evil` ⇒ 403；同源页面取图/推送正常；`webApiServer.test.ts` 扩 6 例。
4. **实施结果（261028）**：`/__native.js` 不再含任何 token；API 凭据改文档响应下发的 HttpOnly+SameSite=Strict cookie `lake_web_token`（资产 token 用可读 cookie `lake_asset_token`，与 IPC 凭据分离）；`/api`/`/__events` 接受 cookie 或原 `x-lake-token`（CLI 兼容）；来源判定统一 `isAllowedRequest`（删 `Sec-Fetch-Site: none` 放行）。**CSP 未收窄（撤回）**。测试 25 例通过。
5. **已知限制**：同机多实例（不同 `LAKE_WEB_PORT`）共用 cookie 名（后开页面顶掉前者）；资产 token 仍页面可读（功能所需）；不支持 Sec-Fetch-* 的旧浏览器无法打开。

### P0.5 编辑完整性（S，**已实现 261028**）

浏览器端跑的是同一套桌面渲染层，五类编辑器（文档/表格/多维表/画板/手写板）+ 小记本来就能编辑；此前有两处"编辑动作"不可用，已修：

1. **插图/附件**：`upload_resource` 在主进程要求 `Uint8Array`，而 shim 用 JSON 传 `Uint8Array` 会变成普通对象 ⇒ 粘贴/拖拽/文件选择插图失败。修法：
   - shim 的请求序列化加 `jsonReplacer`（TypedArray/ArrayBuffer → number[]）；
   - 主进程新增 `electron/ipc/bytes.ts` 的 `toUint8Array`（单一来源），`upload_resource` / `stage_quick_note_image` / `stage_quick_note_file` 统一接受 `Uint8Array | number[]`。
2. **AI 助手**：shim 没有 `onAiStream`，SSE 也没有 `ai:stream` 事件 ⇒ 浏览器 AI 面板不可用。修法：
   - SSE 事件白名单加 `ai:stream`；shim 加 `onAiStream: subscribe("ai:stream")`；
   - `createIpcRegistrar` 支持注入 `httpSend`，`main.ts` 把它接到 `webServerController.broadcast`（HTTP 调用方的 `event.sender.send` 不再 no-op，AI 流式/同步进度都能到浏览器）。
3. **仍不可用**（按 P1 计划做下载端点后再补）：导出 Markdown/HTML/PDF/CSV/Excel、整库备份/导入、系统选择目录/文件对话框。

### P1 能力矩阵与下载等价物（M，**已实现 261028**）
1. **capability 矩阵**（学习思源 `hostCapabilities`）：把 `browserClient/nativeDialog` 扩成显式数据表（`localFileSystem / importExport / nativeDialog / windowControls / globalShortcuts / plugins`），由 `isBrowserClient()` 派生；UI 只做显隐（不抛错），并给统一 `capabilityHint()` 文案。
2. **下载端点**：`GET /download/<noteId>?...`（带 token）→ `Content-Disposition: attachment`；导出/保存走它，不再依赖 `showSaveDialog`。
3. **验收**：浏览器端导出 Markdown/HTML/CSV 可用；"在文件夹中显示/整库备份/云端恢复"在浏览器端隐藏且在设置页有说明。
4. **实施结果（261028）**：`src/lib/hostCapabilities.ts`（localFileSystem/importExport/nativeDialog/windowControls/globalShortcuts）；`GET /download?path=&name=`（cookie/同源校验 + 导出 handler 白名单 + realpath 限根 + 10min/64 条 TTL + Content-Disposition；目录产物即时 zip）；shim 覆盖 5 个 `export*`（先 IPC 生成再下载），`pickExportDir/pickBackupDir` 返回 null。测试 webApiServer 33 例、hostCapabilities 5 例。

### P2 bundle 与启动分离（L，**已评估·不做** 261029）
- 评估双 bundle（Electron 一份 / 浏览器一份）或构建期 `define` 剪裁 Electron-only import；以"浏览器端首屏字节/初始化时间"为判据，先量化再决定（AGENTS §3#17）。
- **结论（261029，见 `docs/BROWSER-BUNDLE-SPLIT.md`）：不做。** 首屏 JS+CSS 10.65MB raw/2.78MB gz，其中 Lake 内核≈90%（浏览器读笔记必需）；web bundle 已无 Electron-only 依赖（7 类主进程依赖 0 import，251 chunk 无 electron 运行时）；可剪 <5KB 源码≈<0.5KB gz（<0.02%），成本却是第三条构建链 + 发布包 +20.4MB gz。

---

## 4. 与审计结论的关系

| 审计项 | 原结论 | 现结论 |
|---|---|---|
| 01 P-04 | 删除或只读化 | **保留并完善**（本计划） |
| 02 D-1 | 建议删（安全维度赞成） | **不删**；SEC-07 升为 P1 必做 |
| 02 SEC-04/05 | 可随删除消失 | **保留后必须修**（资产 token 全请求强制、CSP 端口收窄） |
| 07 v4 RFC | 与同步内核无关 | 浏览器端只消费 IPC/HTTP，不触碰 v4 语义 |

---

## 5. 风险与开放问题

1. **CSP 端口收窄**需与 `webApiServer` 端口可配置（`LAKE_WEB_PORT`）一致：构建期注入端口常量，或 CSP 放行 `127.0.0.1:19880` 固定值（当前默认端口）。
2. **深链 + localStorage 会话**：浏览器端与 Electron 共用同一 `localStorage` 键会互相覆盖；方案是浏览器端用 `sessionStorage`（P1-2），但要处理"浏览器 + Electron 同时开着同一份数据"的写冲突（当前已存在，非本次新增）。
3. **导出下载的鉴权**：`GET /download` 带 token 会进浏览器历史；用一次性 URL 或 `POST /api/export` 返回 blob 更稳。
4. **是否允许浏览器端写操作**：用户用途是"读"，但保留写可避免两套 UI；建议保留（与桌面同一份数据），危险动作靠 capability 挡。