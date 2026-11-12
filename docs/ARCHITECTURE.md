# 架构总览（现行事实）

> 本文只写**当前实现**，不写方案与历史。协议细节的唯一来源是 [`SYNC-PROTOCOL.md`](SYNC-PROTOCOL.md)；
> 长期红线看 [AGENTS.md](../AGENTS.md) §3；容错与自愈契约看 [`RESILIENCE.md`](RESILIENCE.md)；文档/脚本索引看 [`HANDOFF.md`](HANDOFF.md) §1。
> 261112 文档批重写：删除已作废的旧协议（V2 manifest）历史描述、不存在路径与真实桶名；新增模块归属判据与移动端索引。

## 一、进程结构

桌面 = **Electron 主进程 + 渲染进程**（壳层私有 origin `lakexlocalnotes://app`，dev 走 vite）：

```text
electron/（主进程）
├── main.ts                    窗口/生命周期/私有协议注册/asset server/应用菜单/IPC 装配
├── ipc/                       registrar.ts + register*.ts → **187 个通道**
├── store.ts + 各 repository    Lake 空间：元数据在 SQLite，正文在文件
│   ├── noteContentRepository / noteMetadataRepository / noteQueries / noteBodyHash
│   ├── trashRepository + trashLifecycle / historyRepository / historyLifecycle
│   ├── searchRepository / resourceRepository / assetRepository / fileMetadataReconcile
│   └── settingsRepository / secretCipher（密钥 fail-closed，绝不落明文）
├── quickNotes.ts              小记独立库（quick-notes/metadata.sqlite3）与 staging/转换
├── s3v3/                      S3 适配层：desktopSync / syncEngine / desktopStoreAdapter /
│                              desktopPlatformPort / fileDeviceStore / nodeFileDriver / ports / s3Remote
├── s3Store.ts                 S3 传输客户端与连接检查；syncEngineController.ts 同步编排入口
├── assetServer.ts             本机资源服务 127.0.0.1:19876（正文图/小记图/草稿图/?base64=1/CDN 镜像）
├── workspaceBackup.ts / portable/  备份与便携包（.zip.lln）
├── update/updateService.ts    更新中心（检查/下载/sha256 校验，不静默安装）
├── ai/                        AI 主进程侧：aiClient（唯一出网 SDK 调用）/ aiContentResolver / aiImages
└── logger.ts / diagnostics.ts / safeMode.ts / webApiServer.ts（浏览器端，仅 127.0.0.1）

electron/preload.cjs            原生 CJS，contextBridge 暴露 window.lakeNative
        ↓
渲染进程 src/
├── App.tsx（编排：标签页/空间切换/侧栏/状态栏/同步面板入口）
├── desktop/                   桌面壳：DesktopTopBar / DesktopOverlays / DesktopLibrary / useDesktopShell
├── hooks/                     保存/标签/同步/快捷键等编排 hook（useSavePipeline / useDocumentTabs / …）
├── components/app/            shell 级常驻面板与空间工作区（Sidebar / SearchPanel / SettingsPanel / …）
├── components/model/          跨域纯决策（settingsSearch / treeDrag / sidebarInteraction …）
├── components/ui/             跨域可视原语（Overlay / Select / SplitHandle / SplitPane / MarkdownView）
├── features/                  15 个特性域（editor / bitable / usheet / board / ink / quickNotes / ai / aiWriting / diary / tags / …）
├── lib/native.ts              IPC 类型门面（`window.lakeNative` 的唯一前端封装）
└── styles/                    设计系统（@layer + --lake-* 令牌 + kit.css 的 ln-* 原语）
```

移动端 = **Capacitor 8 壳 + 同一份 `src/core`**，UI/原语/端口全部自有（见 §五）。

**IPC 必须四面同改**：`electron/ipc/register*.ts`（registrar）↔ `electron/preload.cjs` ↔ `WEB_METHODS`（`electron/webApiServer.ts`，浏览器端复用同一批 handler）↔ `src/lib/native.ts`。
**187 个通道**由 `electron/ipc/ipcChannelParity.test.ts` 钉死（数量变化即红）；漏改任一面只在运行时表现为「不是函数」。

## 二、数据与存储

**本地是真相，S3 只是镜像**（AGENTS §3#1）。桌面开发数据目录 `~/Library/Application Support/lakex-local-notes-dev`，正式目录同名去 `-dev`（禁止触碰）。

```text
userData/
├── logs/lakex-local-notes.log
├── sync-v3/baseline.json.gz        设备同步基线（每篇 contentHash；绝不上传）
├── sync-v3/state.json              设备同步状态（删除意图/恢复标记/待补资产账本等）
└── workspace-default/
    ├── metadata.sqlite3            主库（WAL）：notes / tree_nodes / device_state / settings /
    │                               orphan_assets / deleted_notes / note_history / history_fallback_state /
    │                               s3_gc_log / ai_writing_conversations / ai_writing_messages
    ├── notes/{noteId}.lake         正文（kind=doc，Lake HTML 编码文本）
    ├── usheets/{noteId}.usheet.json 表格正文（Univer IWorkbookData，kind=usheet）
    ├── bitables/{noteId}.bitable.json 多维表正文（自研 record JSON，kind=bitable）
    ├── boards/{noteId}.board.json  画板正文（Drawnix/Plait 场景，kind=board）
    ├── inks/{noteId}.ink.json      手写板正文（inkDoc v4，kind=ink）
    ├── note-assets/{noteId}/{filename} 附件/图片（资产管线，filename 内容寻址）
    ├── history/{noteId}/*.body.gz  历史快照（L3 本地，不进 S3）
    └── quick-notes/                与 Lake 空间完全隔离：metadata.sqlite3 / items/{id}.qnote /
                                    assets/{id}/{filename} / staging/{draftId}/{filename}
```

- **正文永远在文件**（路径单一来源 `src/core/noteBodyPaths.ts`）；SQLite 只存元数据、hash、账本与派生缓存（`text_cache`/FTS 可重建）。
- 五种 kind 的落盘路径由 `notes.kind` 决定；**表格/多维表/画板/手写板正文不进 Lake HTML 解析器**，搜索文本各自派生。
- 小记库（桌面）另有 `quick_notes` / `quick_note_assets` / `quick_note_sync_base` / `quick_note_deleted` / `quick_note_conversions` / `quick_note_file_ops` / `tags` / `tag_links` / `tag_link_versions` / `device_state`；**标签域（目录 + 关系 + 版本）自 261107 起单一归属小记库**，文档标签关系也在其中（见 `TAG-SYSTEM-DESIGN.md`）。
- 密钥：桌面 S3/AI 密钥经 `secretCipher`（Electron safeStorage）加密落 `settings`，**不可用时 fail-closed 拒绝保存**；移动端走 Android Keystore（`SecureStorePlugin`/`SecretBox`），明文不进 WebView 存储。

移动端磁盘（App 私有 `Directory.Data`）：`notes/`、`usheets/`、`bitables/`、`boards/`、`quick-notes/items/`、`quick-notes/assets/`、`note-assets/`、`history/` 与 `databases/` 下的 Capacitor SQLite。正文/快照由原生 **BodyStore** 原子写（gzip 在原生），SQLite 只存元数据/账本/派生 `text_cache`+FTS。旧库「正文在 `notes.content`」升级时**整库重置一次**，不写兼容读取。

## 三、S3 v3 协议摘要（协议 v3 + v4 单实现编排）

> 单一来源 [`SYNC-PROTOCOL.md`](SYNC-PROTOCOL.md)；核心纯逻辑在 `src/core/s3v3/`（protocol / plan / commit / apply / state / quickPush），适配器在 `electron/s3v3/` 与 `src/mobile/v3/`。

**云端只有**：可变指针 + 不可变索引 + 每篇资产声明 + 内容寻址正文/附件。**没有墓碑对象、没有 manifest 链、没有全局资产清单**。

| 对象 | key | 可变性 |
| --- | --- | --- |
| 指针 | `meta/pointer.json`（v/epoch/generation/lake.commit/quickNotes.commit，约 200B） | 可变，唯一读入口 |
| Lake 索引 | `meta/index/{commit}.json` | 不可变（commit = sha256(规范序列化)） |
| 小记索引 | `quick-notes/meta/index/{commit}.json` | 不可变 |
| 资产声明 | `meta/assets/{noteId}/{declHash}.json` / `quick-notes/meta/assets/{id}/{declHash}.json` | 不可变 |
| 正文 | `objects/{noteId}-{contentHash}.lake` / `quick-notes/objects/{contentHash}.qnote` | 不可变（幂等） |
| 附件 | `assets/{noteId}/{filename}` / `quick-notes/assets/{quickNoteId}/{filename}` | 覆盖写（同名=同内容） |
| 发布锁 | `meta/lock.json` | 短暂可变 |

- **发布**：写索引 → 取锁 → 读回 pointer → 写 pointer（无 CAS，靠锁 + 读回 + generation 单调 + 重试）；零变更轮只读 pointer。
- **删除 = 缺席**：purge 清 `objects/{id}-`、`assets/{id}/`、`meta/assets/{id}/`；他端据本地基线 + 持久删除意图判定「云端已删」，副本留回收站并标「云端已删除·仅本地」。唯一类墓碑 = 小记索引的 `purged[]`（只存 id + 90 天窗口）。
- **位置字段独立合并（261112）**：`parentId`/`trashedAt`/`deletedFromParentId` 与内容正交，按云端基线做三方合并（本地动→本地赢并发布；远端动→`apply-position`；两边都动→`updatedAt` LWW + 相等取本地；无基线不判），判据单一来源 `src/core/s3v3/plan/positionMerge.ts`——见 `SYNC-PROTOCOL.md` §9.5。**回收站 = 特殊笔记本（删除 = 移动）**：trashed 条目 `parentId` 不承载树父语义，恢复位置只看 `deletedFromParentId`（§10.3）。
- **合并 = 三方**（base × local × remote）：恢复标记 → 本地删除意图 → 缺席/新增 → contentHash；云端已发布版本胜出，被覆盖版本先写历史快照。
- **写路径分层（261112）**：同步镜像是「字段应用」，不是用户保存。用户守卫（回收站/purged 拒写、保存版本守卫）只在用户入口或同步专用写路径上生效——正文走 `saveSynced`/`saveSyncedNote`、图标走 `applyRemoteNodeIcon`；**面向用户的策略守卫不得下沉到两端共用的底层写函数**（F04 事故），新增守卫必须声明调用方分类（用户/同步/导入/恢复/维护）。见 `SYNC-PROTOCOL.md` §9.6。
- **单篇 apply 失败 = warning + continue（261112）**：跳过该篇（不标 synced、不推进基线，下轮重试），汇入 `SyncResult.warnings`，不整轮失败（§9.7）。
- **资产 = 每篇声明差集**：上传只 PUT 声明缺失项、声明永远全量；下载按 size+sha256 差集；禁止逐对象 HEAD/GET 当存在性判据。
- **小记「保存并同步」= 单条快路径**（`src/core/s3v3/quickPush/pipeline.ts`）：只推当前一条、只更新本条基线、失败不写基线；回退整轮仅限指针/基线/代际不符等既定条件。
- 旧 `manifests/latest.json` 属 V2 遗留孤儿：**不读、不迁移、不删除**（深度清理按保留窗口当不可达对象回收）。

### 3.1 示例配置（占位，不是任何真实账号）

```text
Endpoint:    https://s3.<region>.<provider>.com     # 区域级地址；bucket 虚拟主机地址 + path-style 会 404
Region:      <region>
Bucket:      <your-bucket>
对象前缀:     <your-prefix>（空 = 桶根）
Path-style:  按 provider 决定（七牛需开启）
```
AK/SK 只存本机加密 settings；**不要把真实桶名/Endpoint/密钥写进文档、提交或截图**。

## 四、渲染层与模块归属判据

### 4.1 判据（新增文件先对号入座）

| 内容 | 归属 |
| --- | --- |
| 跨端纯逻辑（数据/协议/规则/算法） | `src/core/**`（禁 `node:`/electron/DOM/宿主 API） |
| 一级空间工作区 | `src/features/<域>/…Workspace.tsx`（小记为例外：桌面 `components/app/QuickNotesWorkspace`） |
| shell 级常驻面板（目录树/搜索/回收站/资源/设置） | `src/components/app/` |
| 跨域纯决策（可单测、无 JSX） | `src/components/model/` |
| 跨域可视原语（浮层/对话框/菜单/输入） | `src/components/ui/` |
| 横切能力（预览策略/只读状态/空间矩阵/资产档位） | 规划落点 = core 的能力层 + features 的 preview 域（**本批尚未创建**，R1 才落地；见 00 方案 §L1，不要提前写引用） |
| 移动端一切 UI/原语/端口 | `src/mobile/**`（不 import 桌面样式/组件，护栏 `mobileIndependence.test.ts`） |
| 主进程/宿主适配（仅一端可执行） | `electron/**` 或 `src/mobile/native/**`；跨端共享前提是不含宿主 API |

**布局/渲染条件、样式、几何不因「归属」搬家而变**；平台差异只能做成端口能力，不在共享层写 `if (platform)`。

### 4.2 桌面渲染层的两条硬边界

1. **内核 lazy 边界**：桌面入口不得静态 import `features/editor/lakeRuntime`；内核只经 React.lazy 边界进入（`EditorTab` / `TrashPanel` / `NoteInfoDialog` / `HistoryPanel` / `QuickNoteEditor` / `AiAnswerViewer` 等），预取走 `features/editor/kernelPrefetch.ts`。**能否新增边界以 `features/editor/desktopKernelLazy.test.ts` 为准**（它按源码文本钉边界，不写死「几个」），字节预算由 `scripts/check-arch.mjs`（桌面首屏 600KB）与 `scripts/check-bundle-budget.mjs`（app-js 307,200B）兜底。
2. **样式层序**：`@layer vendor, legacy, tokens, kit, shell, feature, overlay, a11y`；新样式写进对应层，不靠特异性/`!important` 取胜。令牌唯一来源 `src/styles/themes/*`，原语唯一来源 `src/styles/kit.css`（`ln-*`），浮层唯一来源 `src/components/ui/Overlay.tsx`。改样式必跑 `src/styles/cssLayers.test.ts` + `node scripts/ui-metrics.mjs`。

### 4.3 新增 kind 的警告

`src/core/noteKind.ts` 对未知/缺失 kind 一律 `normalizeNoteKind` 回退 **doc**。新增第 6 种 kind 时，旧端会把新正文当 Lake 文档导入并保存 = **毁正文级事故**。新增 kind 必须：① 同步两端 `NOTE_KINDS` 白名单与 S3 索引校验；② 逐条确认触点清单（护栏 = `src/features/editor/noteKindTouchpoints.test.ts`，261112 R0 新增，Q2）；③ 发布/读取/历史/导出/搜索全部回归。`notes.kind` 与索引 `kind` 是唯一落点，**不动 `tree_nodes.node_type`**。

## 五、移动端架构索引

移动端是**正式端**，不是桌面缩水版：自有 `mb-*` 原语、自有令牌（`src/mobile/theme/**`）、自有数据端口，只与桌面共享 `src/core` 纯逻辑与内核宿主。

| 关注点 | 单一来源 |
| --- | --- |
| 三层边界 / 互斥域（写域·维护域·高优先域 I1–I3）/ 跨端能力矩阵 / 数据同步约束 / 运行时硬约束 | [`MOBILE-TECH-STACK.md`](MOBILE-TECH-STACK.md) |
| 构建/安装/模拟器/CDP/门禁装置/点按口径/包名与数据/排障 | [`MOBILE-OPS.md`](MOBILE-OPS.md) |
| AI 页（资料集/预算/流式/历史/密钥通道） | [`MOBILE-AI.md`](MOBILE-AI.md) |
| 视觉与几何（44 Rule / 浮层四件 / 首页五格 Dock / 设置骨架） | [`MOBILE-DESIGN.md`](MOBILE-DESIGN.md) |
| 平板外壳（只更宽 + 树/大纲可悬浮固定） | [`PAD-ADAPTATION.md`](PAD-ADAPTATION.md) |
| Sheet 原语例外清单 | [`MOBILE-SHEET-EXCEPTIONS.md`](MOBILE-SHEET-EXCEPTIONS.md) |
| 同步协议 / 设备存储端口 | [`SYNC-PROTOCOL.md`](SYNC-PROTOCOL.md) / [`SYNC-DEVICE-CONTRACT.md`](SYNC-DEVICE-CONTRACT.md) |

结构一句话：`MobileApp.tsx`（路由/外壳/键盘与返回栈）→ `home/HomePage`（五格 Dock + 中央＋）与各空间页 → `bridge.ts` + `bridge/*`（域方法）→ `data/*`（SQLite 仓储）/ `v3/*`（S3 v3 适配）/ `native/*`（Capacitor 插件封装）→ Kotlin 插件（BodyStore / AssetSync / AssetServer / AiChat / SecureStore / PortablePackage / Update …）。**正文 = 文件**，SQLite 只做元数据/账本/派生索引；移动端 UI 与样式不得共享桌面（护栏 `mobileIndependence.test.ts`、`mobileLayers.test.ts`）。

## 六、关键文件索引（按目录）

| 目录/文件 | 职责 |
| --- | --- |
| `electron/main.ts` | 主进程装配：窗口/私有协议/asset server/菜单/IPC 注册 |
| `electron/ipc/registrar.ts` + `register*.ts` | IPC 注册与埋点；通道清单 = 四面契约之一 |
| `electron/store.ts` / `electron/quickNotes.ts` | Lake 与小记两个存储空间（隔离） |
| `electron/s3v3/desktopSync.ts` / `syncEngine.ts` / `desktopStoreAdapter.ts` / `desktopPlatformPort.ts` | S3 v3 桌面适配与同步编排 |
| `electron/assetServer.ts` | 本机资源 HTTP 服务（图片/附件/缩略/复制原图） |
| `electron/quickNoteConversion.ts` | 唯一跨空间「小记 → Lake」转换协调器 |
| `electron/settingsRepository.ts` / `electron/secretCipher.ts` | 设置与密钥（fail-closed） |
| `electron/trashRepository.ts` / `trashLifecycle.ts` / `historyRepository.ts` | 回收站与历史保留链 |
| `electron/workspaceBackup.ts` / `electron/portable/portableExport.ts` | 自动备份 / 便携包 |
| `electron/update/updateService.ts` | 更新中心（检查/下载/校验） |
| `electron/ai/aiClient.ts` / `aiContentResolver.ts` | 唯一出网 SDK 调用 / 跨 IPC 只传引用的正文解析 |
| `src/core/s3v3*/` | S3 协议/计划/发布/应用/状态/小记快路径（纯逻辑） |
| `src/core/s3v3Engine.ts` / `s3v3Decision.ts` / `s3v3Merge.ts` / `s3v3DeviceStore.ts` | 引擎、三方合并决策、单设备存储契约 |
| `src/core/noteKind.ts` / `syncDecisions.ts` / `cloudState.ts` / `maintenancePolicy.ts` | kind 归一、删除/恢复判据、云状态唯一判据、互斥域 |
| `src/core/{trashPolicy,tagAggregate,quickNoteTags,quickNoteQueries,dateFormat,assetUrl,noteBodyPaths,lakeDocForm,docBodySafety,repositoryCapabilities}.ts` | 跨端共享领域逻辑 |
| `src/core/{aiProviders,aiErrors,aiCorpus,aiNetwork}.ts` | AI 供应商/错误码/资料块/出网判据 |
| `src/features/editor/lakeRuntime.ts` / `LakeEditor.tsx` / `EditorTab.tsx` / `MultiTabEditor.tsx` | 内核宿主与多标签；`lakeTileRender.ts`（虚拟渲染）/ `lakeTocScrollFollow.ts`（大纲跟随）/ `selectionClipboard.ts`（复制剪切单一管线） |
| `src/features/quickNotes/*` | 小记预览快路径 + 内核只读兜底、写作卡、标签管理 |
| `src/features/{bitable,usheet,board,ink,ai,aiWriting,diary,tags}/*` | 各特性域（正文模型在 `src/core/<域>Doc.ts`） |
| `src/components/app/*` | Sidebar / SearchPanel / SettingsPanel / TrashPanel / AssetsBrowser / NoteDocPreview / QuickNotesWorkspace … |
| `src/components/ui/*` | Overlay / Select / SplitHandle / SplitPane / settingsPrimitives / MarkdownView（浮层与基础控件唯一来源） |
| `src/desktop/*` + `src/hooks/*` | 桌面壳与编排 hook（保存/标签/同步/生命周期） |
| `src/lib/native.ts` | `window.lakeNative` 唯一前端封装（IPC 第四面） |
| `src/styles/*` | `index.css`（层序入口）/ `tokens.css` / `kit.css` / `themes/` / `cssLayers.test.ts` |
| `src/mobile/{MobileApp.tsx,bridge.ts,home,notebook,settings,editor,data,v3,native,ui,theme,pad}` | 移动端外壳/端口/数据/插件/原语/令牌 |
| `android/app/src/main/java/com/lakexlocalnotes/android/*.kt` | 原生插件（BodyStore / AssetSync / AssetServer / AiChat / SecureStore / SecretBox …） |

## 七、改前先读（红线指引）

| 要改的东西 | 先读 |
| --- | --- |
| 任何代码/数据语义 | AGENTS.md §3（删除/恢复/资产/并发/样式/依赖准入红线） |
| 同步协议、索引、pointer、资产声明 | `SYNC-PROTOCOL.md`（改协议先看其 §19 护栏索引） |
| 设备端口/双端差异 | `SYNC-DEVICE-CONTRACT.md`（端口差异是登记项，不是待修 bug） |
| 启动/坏库/缺正文/降级 | `RESILIENCE.md`（新增失败面必须回填） |
| 内核 API/配置/命令 | AGENTS.md §2 三级检索 → `LAKEX-CONTRACT.md`（新观测回填） |
| 样式/几何/令牌 | [`DESIGN.md`](DESIGN.md) + AGENTS.md §3#14 + `scripts/css-audit/README.md` |
| 多维表视口/行窗口 | `BITABLE-VIEWPORT.md` |
| 表格（Univer）升级 | `USHEET-UPGRADE.md` playbook（`univerContract.test.ts`） |
| 手写板正文格式 | `INK-PAD.md`（inkDoc v4：读 1–4、写 4） |
| 标签语义 | `TAG-SYSTEM-DESIGN.md`（顺序设备本地 / 删除=缺席 / 禁墓碑） |
| 移动端任何 UI | `MOBILE-DESIGN.md` + `MOBILE-TECH-STACK.md` + `MOBILE-OPS.md`（设备门禁） |
| 发版/版本号 | `RELEASE.md`；版本单一来源 = `package.json` |
