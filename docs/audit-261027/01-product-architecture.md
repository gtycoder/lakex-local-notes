# 01 · 产品功能层与总体架构审计（由外到内）

> 审计对象：`lakex-local-notes`（Electron 桌面 + Capacitor Android + 可选浏览器端）。
> 审计基线：`master @ 41def9f0` + 工作树在途改动（21:29 采样 49 项 / dirty hash `36f367f6…`；**21:33 已增至 54 项**，含另一个会话新增的 `src/mobile/native/deviceProfile.ts` 等）。
> **代码在审计期间仍在被其他会话修改** ⇒ 本文证据以「文件 + 符号」为准，行号仅作定位参考。
> 本轮为只读审计：未改任何代码；证据来自 read/grep、`tsc --noEmit`、全量 `vitest`（442 文件 / 2792 passed / 11 skipped，78.7s）、文件度量。

---

## 0. 结论摘要（按严重度）

| # | 结论 | 层级 | 严重度 |
|---|---|---|---|
| **0** | **【P0】全量重拉会永久删除「本地独有」文档，并把它刚写入的历史快照一起删掉**（`pullAll` 整体替换状态 → 桌面 `saveState` 对不在新状态的行走 `deleteNote+purgeTrashItem` → 删 `note_history` 与 `history/`）。触发门槛 = `baseline.json.gz` 丢失/损坏。违背「本地是真相」红线与 `S3-REDESIGN` §15.1，详见 `05-sync-data.md` SD-01。 | 数据/同步 | **P0** |
| 1 | **同步内核是一个 1895 行单体 + 9 个「账本」字段的补丁集合**：决策、IO、上传调度、发布、重试混在 `incrementalSync`（约 500 行）里；每个线上问题都新增一个持久账本字段。这是 v3 冲刺留下的最大架构债。 | 架构 | **P1** |
| 2 | **双端「同一语义写两遍 + 对账测试兜底」**：同步设备存储桌面 481 行 / 移动 809 行、conformance 496 行；仓储层还有一张 30+ 条的 `repositoryCapabilities` 人工对账表。根因是契约过宽 + 无共享实现，不是测试不够。 | 架构 | **P1** |
| 3 | **方法面三处镜像**：preload 143 个方法 / web shim 137 / IPC 133 通道，靠 `ipcChannelParity` 与 `webApiServer.test` 卡漂移；协议无版本/能力协商。 | 架构 | **P1** |
| 4 | **浏览器端（webApiServer）是一整套第二前端 + 全量写 API**（opt-in、仅 127.0.0.1、header token）。对单人产品价值未验证，却带来 26KB 服务 + 14KB 测试 + 设置页 + 6 个 IPC + CORS 特例的长期维护与攻击面。建议删除或只读化。 | 产品/安全 | **P1** |
| 5 | **移动端存在一批「明知做不到却仍然展示」的入口**：表格 ⋯ 面板 15+ 项置灰、画图插入 5 项置灰、dock disabled 项、回收站非 doc 不可预览。应改为「可执行才展示」。 | 产品 | **P1** |
| 6 | **能力矩阵缺单一来源**：`kind !== "doc"` 这类判断散落在各入口；移动端完全没有「缺正文 / 缺小记」恢复入口（桌面有完整资源页）——产品待裁决②挂起，但架构上缺少让两端差异显式的载体。 | 产品/架构 | **P1** |
| 7 | **同步进度的契约是 V2 遗留**：IPC `SyncProgress.phase` 仍是 connect/download/upload/manifest/quick-notes/done 六态，v3 的 12 个阶段由 `desktopSync.ts:82` 手工塞进旧枚举；移动端则直接用 v3 阶段。两端两套进度词汇。 | 产品/架构 | P2 |
| 8 | **领域层输出展示文案**：`src/core/s3v3Engine.ts` 直接 `warn("缺正文: "+id)`，主进程拼「v3：下载正文…」进 `SyncProgress.message`，UI 原样渲染。核心逻辑与展示耦合。 | 架构 | P2 |
| 9 | **文档与门禁口径已漂移**：`docs/ARCHITECTURE.md` 仍写 Manifest V2 / latest.json（v3 已无 manifest 链）；HANDOFF 基线落后 2 个提交；README「vitest ≈20s」实测 78s（`perf.integration` 进默认门禁）。 | 工程 | P2 |
| 10 | **要保住的资产**：`src/core` 运行时零 `node:` 导入（分层是真的）、`planLakeMerge`/`planQuickNotesMerge` 已把「合并决策」做成纯函数、端口注入 + conformance 的思路正确、2792 例测试是不变量而非 UI 快照。重构必须保这三样。 | 架构 | — |

**一句话**：v3 把「协议」做对了，把「编排」做肿了；现在最该做的不是再加功能，而是把**同步内核从「补丁账本」重写成「收敛计算」**（详见 `06-redesign.md`）。

---

## 1. 分层模型与审查方法

由外到内五层，本文覆盖 L0/L2 并给出跨层汇总；L1/L3/L4 见子文档：

| 层 | 内容 | 归属文档 |
|---|---|---|
| L0 产品/功能 | 能力矩阵、入口可达性、半成品、删除优先级 | 本文 §2 |
| L1 交互/信息架构 | 桌面 shell / 移动 shell、状态机、键盘/IME、设计系统 | `03-desktop.md` / `04-mobile.md` |
| L2 架构/数据 | 进程、端口、同步内核、数据模型、IPC | 本文 §3 + `05-sync-data.md` |
| L3 代码/工程 | 巨型组件、死代码、测试结构、门禁、文档 | `03`/`04`/`05` + 本文 §4 |
| L4 安全 | 信任边界、路径、机密、协议、供应链 | `02-security.md` |

方法：① 度量（行数/文件数/通道数/镜像数）；② 抽样读关键路径（syncOnce / incrementalSync / preload / webApiServer / SyncStatusPopover）；③ 对比「已定稿决策」避免重复上报；④ 只写有证据的结论。

---

## 2. L0 产品功能层

### 2.1 能力矩阵（草案，按证据归纳）

| 能力 | 桌面 | 移动 | 证据/备注 |
|---|---|---|---|
| 富文本（Lake） | 完整 | 完整（编辑面 = 底部 dock） | mobile/editor/* |
| 表格（usheet） | 完整 + 完整工具条 | 可编辑但工具条大量置灰 | `usheetChromeModel.ts` |
| 多维表（bitable） | 完整（Grid 行窗口） | 查看 + 部分字段编辑 | `mobile/bitable/mobileBitableEdit.ts` |
| 画板（board） | 完整 | **能插能看、不能编辑**（HANDOFF §3#18 已定性） | — |
| 手写板（ink） | 完整 | 支持 | — |
| 小记 | 完整（时间线/标签/转换） | 完整（时间线/标签；**标签管理页未做**） | HANDOFF §3#26 |
| 回收站 | 完整（doc 预览） | 有，但**非 doc 不可预览** | `TrashPreviewPage.tsx:78` |
| 缺正文/缺小记恢复 | 资源页完整（三分类 + 行内动作） | **无入口** | grep 移动端无 missingBody 入口 |
| 历史快照 | 完整 | 有，非 doc 预览「暂不支持」 | `NoteInfoSheet.tsx` |
| AI | 完整（选区/顶栏/块菜单） | 完整（原生通道） | `MOBILE-AI.md` |
| 全局搜索 | 有（⌘K，含小记独立 FTS） | 有（首页胶囊 + 小记合并） | — |
| 同步可见性 | 瞬时 toast + 状态浮窗（旧六态词汇） | 常驻进度条 + 设置卡（v3 阶段） | §2.2 P-03 |
| 浏览器端 | 可选开启（第二前端，全量 API） | — | `webApiServer.ts` |

### 2.2 功能层问题

#### P-01 [P1] 半成品入口「展示但不能用」应直接删除
- **证据**：移动表格 **32 项面板里 10 项置灰**（`src/mobile/usheet/usheetChromeModel.ts:49-56/169-182/201-209`：单元格图片/手写签名/附件/图表/批注/数据验证/分列/表单视图/图表视图/条件格式；HANDOFF §0 记的「29 项 / 7 置灰」已过期，见 `04-mobile.md` MOB-10）；其中 4 条 toast 分支是**不可达死代码**（`MobileUsheetViewer.tsx:391-426`，disabled 按钮不触发 onClick）。画图插入 5 项置灰（HANDOFF §3#18）。工作区非文档类型提示「该类型暂不支持在移动端查看」（`NotebookWorkspace.tsx:727`）。
- **影响**：用户每点一次都是一次负反馈；置灰项还拉长 ⋯ 面板（29 项，22 可点 + 7 置灰）——这是「为功能服务」的典型残留：先摆位置、以后再实现。
- **建议**：① 激进：**只渲染可执行项**，能力清单由代码单一来源生成（见 P-02）；② 保守：保留置灰但统一为「一行说明 + 不再逐个 toast」。
- **成本**：S（移动 UI 层）。

#### P-02 [P1] 能力矩阵缺单一来源，两端差异靠散落判断
- **证据**：`TrashPreviewPage.tsx:78`、`NotebookWorkspace.tsx:397/667/683/692`、`NoteInfoSheet.tsx` 各自按 `kind` 分支；移动端无「缺正文 / 缺小记」入口（`04-mobile.md` MOB-16 已逐条核对）；桌面有 `AssetsBrowser` + `missingBody` 判据（`src/core/missingBody.ts`）。项目已有 `src/core/repositoryCapabilities.ts`，但它是**函数存在性对账表**（30+ 行 note 解释签名差异），不是产品能力矩阵。
- **影响**：同一能力在三处（桌面 / 移动 / 回收站预览）各写一遍，新增 kind 或新端必然漏；用户看到的「能不能用」取决于入口实现，而非产品决策。
- **建议**：① 激进：新增 `core/platformCapabilities.ts`（数据表：能力 × 端 × kind × 入口），UI 全部从它派生，缺省即不渲染；② 保守：至少把「缺正文/缺小记」入口在移动端补齐（产品裁决②）。
- **成本**：M。

#### P-03 [P2] 同步进度词汇两端分裂、契约过期
- **证据**：`src/lib/types.ts:259` 仍为 V2 六态；`electron/s3v3/desktopSync.ts:82` 用 `PHASE_PROGRESS` 把 v3 的 load-state/read-index/bodies/apply/publish-* 手工映射回旧枚举；移动端 `src/mobile/sync/syncProgressStore.ts` 直接消费 v3 阶段。桌面进度条百分比只覆盖传输阶段，发布/锁/索引阶段恒为旧词汇。
- **影响**：用户在桌前看到的是"下载远端变更 60%"，实际可能在发布锁或应用阶段；移动端文案更准确 → 两端口径不一致。属于「功能设计」而非纯代码问题。
- **建议**：进度契约升级为 v3 阶段（或更好的：由 `06` 的 Plan 直接给出 total），桌面/移动共用同一描述器（现在移动有一份 `describeSyncProgress`，桌面是另一份）。**成本 S，但需先定契约**。

#### P-04 [P1] 浏览器端：**保留并完善**（用户 261028 裁决，原建议"删除/只读化"作废）
- **证据**：`electron/webApiServer.ts`（26KB）暴露 `WEB_METHODS` **135** 个方法（含 saveNote/deleteNote/aiChat 等写能力），静态服务 dist/，token 走 header；`registerWeb.ts` 提供开关；设置页「浏览器端」开关；默认关、纯内存态、每次启动重置；已有 `/__events` SSE 推送（非轮询）。
- **用户裁决（261028）**：**保留浏览器端**——真实用途是「在浏览器里分屏读笔记」；**仅桌面端**（移动端不需要浏览器端）。方向改为「学习思源完善浏览器端」，不删除。
- **现状缺口**（完善目标，详见 `11-browser-end-plan.md`；**分屏由浏览器自带，不需要我们做深链/多窗口**）：
  ① 宿主能力语义粗：只有 `browserClient/nativeDialog` 两个标志，导出/备份/打开文件夹等按散落判断，报错文案不统一（思源用 9 个 capability 推导 + 编译期剪裁）；
  ② token 下发面（SEC-07）：`/__native.js` 对非浏览器客户端可伪造 `Sec-Fetch-Site: none` 拿全量 token；
  ③ 导出/下载依赖 Electron `showSaveDialog`，浏览器端没有等价下载端点（思源 `?download=true`）；
  ④ 双 bundle 未分离：dist 同一份给 Electron 与浏览器，Electron-only 依赖未按目标剪裁（思源 `#if !BROWSER`）。
- **建议**：按 `11-browser-end-plan.md` 分 P0（安全收口）/P1（深链+多窗口分屏）/P2（capability 矩阵+下载端点）/P3（bundle 分离）推进；**不删除、不移动端化**。
- **成本**：P0 S / P1 M / P2 M / P3 L。

#### P-05 [P2] 「删除/恢复」语义对用户过重，入口分散
- **证据**：产品概念有 6 个：软删（回收站）→ 墓碑（purge）→ 云端缺席（删除压编辑）→ cloud-deleted 本地副本 → restore_pending 恢复标记 → 90 天自动清理；入口分散在桌面回收站、桌面资源页（缺正文）、历史面板、移动回收站；移动端回收站只预览 doc。
- **影响**：这是本项目最独特的语义，也是最容易让用户"不敢点"的地方；v3 又把「云端已删除·仅本地」徽标加进来，进一步加深认知负担。
- **建议**：收敛为**两条用户可见状态**：「回收站（可恢复）」与「已彻底删除（不可恢复）」，cloud-deleted 作为回收站内的标签；README/设置里只教这两个词。文档层的 6 个概念保留给开发者。
- **成本**：S（文案/入口），M（若合并数据态）。

#### P-06 [P2] 文档与门禁口径漂移（影响接手成本）
- **证据**：`docs/ARCHITECTURE.md` §4.4/§5 仍描述 Manifest V2 + `manifests/latest.json`；HANDOFF §0 基线 `08345db5` 而 HEAD=`41def9f0`；README:134「≈20s」实测 78.7s（`perf.integration.test.ts` 单例 78s）；AGENTS 45KB/64KB 预算。
- **建议**：把「门禁耗时/测试计数/基线 commit」从 README/AGENTS 移到脚本输出的 `docs/HANDOFF.md`（本来就规定易过期事实进 HANDOFF）；ARCHITECTURE 增加「v3 现状」节或重写 §4.4/§5。
- **成本**：S。

---

## 3. L2 架构层

### 3.1 现状（进程/依赖方向）

```
Electron main                     Renderer (React)
├── electron/store.ts             ├── src/App.tsx（855 行）+ hooks + controller
├── electron/s3v3/desktopSync     ├── src/features/**（5 种编辑器宿主）
├── src/core/s3v3Engine.ts  ←──── ├── src/lib/native.ts（143 方法）
│   （1895 行，55 方法）           └── src/mobile/**（Capacitor，自有 UI 层）
├── electron/ipc/**（133 通道）        ↑
├── electron/webApiServer（137 方法镜像）│
└── android/（Kotlin 插件 9 个）─────────┘

共享方向：UI → core（纯领域）；core 不依赖 node/electron ✅
数据方向：本地 SQLite+文件 = 真相；S3 = 镜像（pointer + 不可变索引）
```

### 3.2 要保住的三样资产
1. **core 纯净**：`src/core` 运行时无 `node:` 导入（仅测试有），移动端与 desktop 共用同一套决策/协议代码。
2. **决策已部分纯函数化**：`planLakeMerge` / `planQuickNotesMerge` / `s3v3Decision` / `s3v3Intent` 都不做 IO——这是 `06-redesign`「Plan」的现成地基。
3. **不变量测试**：2792 例里大量是「零变更只读 pointer」「改 5 篇资产 GET=0」「删除=缺席」这类行为锁，而不是快照。

### 3.3 架构问题

#### A-01 [P1] 同步内核单体：决策 + IO + 调度 + 发布混在一个方法里
- **证据**：`src/core/s3v3Engine.ts` 1895 行 / 55 个方法；`incrementalSync`（764→1280 前）约 500 行，内部依次做：意图让位判定、远端 purge 解析、快照/恢复合并、正文预取流水线、声明预取、逐条 apply、上传、发布。注释自述「P0-1 全局有界流水线」是 261026 为性能后加的（说明原结构没有流水线位置）。
- **影响**：任何阶段改动都可能影响其他阶段；dry-run / 预览 / 单测必须起引擎；「为什么这轮不上传」难以回答。`06` 的核心论据。
- **成本**：L（但可分阶段，见 06 §9）。

#### A-02 [P1] 「账本堆叠」：`DeviceState` 9 个可选数组
- **证据**：`src/core/s3v3DeviceStore.ts:19-43`：`lake/quickNotes/folders/intents/pending/remotePurged/restorePending/quickDeletes/quickPurges/quickPurgeTimes/archived/pendingAssets`。另有 manifest 时代的 3 张死账本仍在被读（`sync_base` / `declared_assets` / `deleted_notes.published_at`，见 `05` SD-03/SD-04）；`archived` 是空壳（引擎从不写，SD-01 的备份区设计因此落空）。`pendingAssets` 注释：「与 state 同一引用；适配器持久化，失败记账、成功销账」；`s3v3Engine.ts:764` 注释：「上一轮失败的附件先补（普通增量轮不会重新调度资产，不补就永久缺失）」→ 说明这是**为了补一个调度缺口**而新增的账本。
- **影响**：账本之间语义重叠（pending vs intents vs remotePurged），新人无法从代码推出「某篇文档现在到底处于什么状态」。56 行注释解释 10 个字段，已经说明问题。
- **建议**：单一意图日志 + 由 (本地, 基线, 远端索引) 推导的状态；详见 `06 §4`。

#### A-03 [P1] 双端实现重复 + 对账测试补偿
- **证据**：`electron/s3v3/desktopStoreAdapter.ts` 481 行、`src/mobile/v3/mobileDeviceStore.ts` 809 行，都实现同一 `S3v3DeviceStore`（30+ 方法，含 lake/quick 两套空间）；`electron/s3v3/deviceConformance.ts` 496 行专门断言两端一致。同型补偿还有 `src/core/repositoryCapabilities.ts`（30+ 条 note 解释两端签名差异）。
- **影响**：语义漂移（移动端曾缺 `archiveQuickNote`、usheet normalize 未接）不是偶发，是结构必然；每加一个能力要写 3 遍（桌面/移动/对账）。
- **建议**：`06 §6` 的单实现 DeviceStore（SQL 驱动端口）。

#### A-04 [P1] 方法面三处镜像，无协议协商
- **证据**：IPC 通道 **135**（`ipcChannelParity.test.ts:90-92` 同时断言 registrar / preload invoke 通道 / `WEB_METHODS` 三者都是 135）；preload 顶层 **143** 键 = 135 invoke + 5 个 `on*` 订阅 + `rendererReady/assetPort/assetToken` 3 个常量；web shim 覆盖全部 135 个 invoke 方法（含写操作，无只读子集）——即「浏览器端不是只读镜像」。`WEB_METHODS` 是手写映射表，靠两个测试卡漂移。
- **影响**：新增 IPC 需同步 3 处 + 2 个测试；删除一处即漂移。浏览器端删除后自动降为 2 处（仍建议收敛为「一份 channel 清单 + 自动生成 preload」）。
- **成本**：M。

#### A-05 [P1] 编辑器宿主：5 kind × 2 端的 open/save/normalize 分叉
- **证据**：usheet 的「打开=只读」三件套（`UniverSheetEditor.tsx:75/277/340` 三处 `normalizeUsheetWorkbook`）只在桌面；HANDOFF 明示「移动端 usheet 保存路径尚未接同一 helper」。回收站预览只支持 doc（`TrashPreviewPage.tsx:78`）。
- **影响**：同一语义（打开不写盘）两端不同实现，回归靠人记；新 kind 成本高。
- **建议**：宿主层定义统一 `DocumentHost` 契约（open/mount/capture/normalize/commit），5 种 kind 各自实现，两端共用编排；移动端只换渲染壳。成本 M/L。

#### A-06 [P2] 巨型组件（可维护性）
`BitableEditor.tsx` 2072 行、`lakeRuntime.ts` 1752、`QuickNotesWorkspace.tsx` 1457、`Sidebar.tsx` 1212、`EditorTab.tsx` 1114、`SettingsPanel.tsx` 1071、`settingsSearch` 71 项。建议按「容器/视图/领域操作」三拆，优先 BitableEditor 与 lakeRuntime（详见 03）。

#### A-07 [P2] 领域层输出 UI 文案
`s3v3Engine` 的 `warn("缺正文: "+id)`、`desktopSync` 的「v3：下载正文…」进 `SyncProgress.message`。建议 core 只产出结构化事件（kind + 参数），文案在 UI 层。

#### A-08 [P2] 门禁失真
全量 vitest 78s 中 `electron/s3v3/perf.integration.test.ts` 占 78s（500/2000/5000 三档）。建议：perf 拆出默认门禁（env 门控），日常仍 20s 级。

---

## 4. 跨层「删除 / 合并」候选清单

> 原则：删除必须不损能力。每条给证据与风险；与子文档交叉验证后再执行。

| # | 候选 | 证据 | 收益 | 风险/前置 | 建议 |
|---|---|---|---|---|---|
| D-01 | 浏览器端整套（`webApiServer` + shim + `registerWeb` + 设置项 + CORS 特例 + 6 IPC） | 26KB 服务 / 14KB 测试 / `assetServer.ts:221` 特例 / `SettingsPanel.tsx:815`；shim 覆盖 135 个方法（含写） | 少一个前端 + 135 方法镜像 + 本机 HTTP 面 | 若有人真用会丢能力；需用户确认 | 删除（或只读化） |
| D-02 | 移动表格 ⋯ 面板置灰 15+ 项、画图插入 5 项、dock disabled 项 | `usheetChromeModel.ts`、HANDOFF §3#18、`EditorDock.tsx:496` | 入口更短、负反馈消失 | 需同步截图基线 | 删除（仅 UI） |
| D-03 | 旧 V2 进度枚举与人肉映射（`PHASE_PROGRESS`） | `desktopSync.ts:82`、`types.ts:259` | 两端一套词汇 | 依赖 06 的 progress 契约 | 随 v4 替换 |
| D-04 | `repositoryCapabilities` 对账表 | 30+ note 解释签名差异 | 少一张维护表 | 需先有共享实现（A-03） | 随 DeviceStore 单实现删除 |
| D-05 | 移动端与桌面重复的 URL/令牌/同步启动逻辑（如有） | 待 04 交叉验证 | — | — | 待定 |
| D-06 | 旧 manifest 兼容工具 / `sync_state` / `declared_assets` 等 v2/v3 过渡字段 | 待 05 验证「是否仍被读写」 | 数据模型更小 | 必须先确认无读取点（AGENTS §3#7 允许删旧数据，但不允许静默丢在用数据） | 待定 |

---

## 5. 分层重构路线（激进 / 保守）

| 阶段 | 内容 | 依赖 | 门禁 |
|---|---|---|---|
| 0 止血 | 安全审计 P0 修复；删除 D-01/D-02；文档口径纠偏 | 无 | tsc + vitest + 移动 6 态 |
| 1 抽 Plan | 把 sync 的「决策 + IO 清单」抽成纯函数 `planSync`，与现引擎 dry-run 对拍（差异率 0 再切） | 06 §3 | 对拍脚本 + 现有同步测试 |
| 2 消账本 | pendingAssets/intents/pending/remotePurged… 收敛为 IntentLog + 推导 | 1 | 不变量测试矩阵 |
| 3 单实现 | DeviceStore 只写一次（SQL 驱动端口）；删 conformance / repositoryCapabilities | 2 | conformance 原用例改为单实现测试 |
| 4 性能 | 按篇增量索引、对象分档并发、确定性进度 | 1 | perf 门槛（首拉/增量/零变更） |
| 5 UX | 同步台账（plan 可视化）+ 进度契约统一 | 4 | 桌面/移动截图 + 真机 |

---

## 5.5 与子文档的交叉引用（已核对）

| 本文结论 | 子文档证据 |
|---|---|
| P-01 半成品入口 | `04-mobile.md` MOB-10（32 项/10 置灰 + 4 死分支，HANDOFF 计数过期） |
| P-02 能力矩阵 | `04-mobile.md` MOB-16（移动无资源页/标签管理/导出） |
| P-04 浏览器端 | `02-security.md` SEC-07（`/__native.js` token 可被非浏览器客户端拿取）、D-1 |
| **P0 数据安全** | `05-sync-data.md` SD-01（完整证据链与触发条件） |
| A-03 双端重复 | `05-sync-data.md`（适配器/账本明细）、`04-mobile.md` MOB-05/07 |
| A-05 宿主分叉 | `04-mobile.md` MOB-05（usheet 未 normalize）、MOB-06（purge 不清资产） |
| 移动端状态机 | `04-mobile.md` MOB-01/02/03（返回栈洞、10 个浮层 state、分页器定时器） |

## 6. 子文档索引

- `02-security.md`：信任边界 / 路径 / 机密 / 协议 / 供应链
- `03-desktop.md`：桌面组件、状态、设计系统、性能、死代码
- `04-mobile.md`：移动端状态机、导航、IME、性能、原生
- `05-sync-data.md`：v3 协议/状态机/账本/性能/测试债（`06` 的素材）
- `06-redesign.md`：**收敛式同步内核 v4**（第一性原理重设计）