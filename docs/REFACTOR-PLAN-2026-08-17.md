# 代码重构分批计划

- 制定日期：2026-08-17
- 当前原则：先低风险、可回滚、每批独立验证；不改变已定稿的本地优先、同步冲突、删除/恢复语义。

## 已完成批次

### Batch 0：审计基线与安全收口

- 清除当前源码中的共享 S3 AK/SK。
- 开发 seed 改为环境变量注入，缺失时保持本地模式。
- 依赖审计切换到公共 registry 后可执行；当前剩余 5 个中等级传递依赖告警，均来自 drawnix/Lake 的 mermaid 链，暂无自动修复。
- 验证：tsc、220 tests、build。

### Batch 1：渲染层低风险拆分

- 从 `App.tsx` 抽取 `DesktopStatusBar`。
- 收窄 `QuickNotesWorkspace` effect 依赖，改善 props 变量命名。
- 保持 state ownership、回调签名和 DOM class 不变。
- 验证：tsc、220 tests、build。

### Batch 2：IPC 注册模块拆分

- 新增 `electron/ipc/registrar.ts`：集中来源校验和类型安全注册。
- 新增：
  - `registerNotes.ts`
  - `registerHistory.ts`
  - `registerSync.ts`
  - `registerQuickNotes.ts`
- `electron/main.ts` 只负责依赖组装，不再承载全部 IPC channel 实现。
- 保持 channel 名称、参数顺序、权限检查、同步队列和返回值不变。
- 验证：tsc、220 tests、build。

## 待执行批次（需按批测试）

> 当前桌面端核心业务已基本稳定，后续主要投入移动端；Store 是桌面/移动共用的核心边界，因此建议先完成低风险的存储边界整理，再进入移动端高峰开发。完整领域拆分必须小批次进行，不追求一次性重写。

### Batch 3：Store 只读层类型化与纯函数抽取（低到中风险，已完成）

已完成范围：

- 为 SQLite row 定义明确类型（前一批已完成，本批继续收窄）。
- 新增 `electron/storeUtils.ts`，抽取资源引用、ISO 周、历史保留、文件名清洗和路径段校验等纯函数。
- 新增 `electron/storeQueries.ts`，抽取只读 `note digest` 查询。
- Store 对外继续从原路径 re-export 历史工具，保持现有调用方兼容。
- 新增 `electron/storeUtils.test.ts`，覆盖重复资源、非法文件名、路径穿越和重复时间戳边界。
- 未移动任何写事务、文件落盘顺序或同步状态机。

不做：

- 不改变事务边界。
- 不改变同步字段和删除/恢复状态机。
- 不改变文件落盘顺序。

验收：

- 原有测试与新增边界测试共 224 个全绿。
- 新增 row mapping / path validation 单测。
- 删除、恢复、purge、历史快照回归。

### Batch 4：Store 领域模块拆分（中高风险，按领域逐批执行）

#### Batch 4A：SearchRepository（已完成）

- 新增 `electron/searchRepository.ts`。
- 抽取 FTS 单条 upsert、全量索引重建、长查询 FTS、短查询标题 LIKE 回退。
- `Store.rebuildSearchIndex()` / `Store.searchNotes()` 保留为兼容 wrapper。
- SearchRepository 通过显式缓存回调依赖 Store，不反向访问 Store 私有字段。
- 未改变 FTS SQL、缓存生成时序和事务行为。
- 验证：Store + sync 定向回归 115 项，完整测试 224 项，tsc/build/diff 全绿。

#### Batch 4B：HistoryRepository + TrashRepository 只读层（已完成）

- 新增 `electron/historyRepository.ts`：历史列表、快照预览、历史统计。
- 新增 `electron/trashRepository.ts`：回收站列表、过期提醒查询。
- `Store` 保留 `listNoteHistory`、`previewHistorySnapshot`、`getHistoryStats`、`listTrash`、`listTrashReminder` wrapper。
- 恢复、删除、purge、清理等写操作仍在 Store，事务边界没有移动。
- 验证：存储/同步定向回归 135 项，完整测试 224 项，tsc/build/diff 全绿。

#### Batch 4C：AssetRepository 只读层（已完成）

- 新增 `electron/assetRepository.ts`。
- 抽取当前正文引用、历史快照引用、受保护资源集合、历史 noteId 列表和孤儿资源列表。
- Store 保留 `getProtectedRefs`、`getCurrentContentRefs`、`listNoteIdsWithHistory`、`listOrphanAssets` wrapper。
- 资源上传、孤儿清理、历史清理中的写操作仍在 Store，未改变事务/文件删除顺序。
- 验证：存储/同步定向回归 135 项，完整测试 224 项，tsc/build/diff 全绿。

#### Batch 4D-1：NoteQueries 只读层（已完成）

- 新增 `electron/noteQueries.ts`。
- 抽取树节点列表、笔记摘要、同步笔记、同步目录和 row mapping。
- `Store` 保留 `listTreeNodes`、`listNoteSummaries`、`listNotesForSync`、`listFoldersForSync` wrapper。
- `readTreeNode`、`readNote` 等现有写流程仍由 Store 控制；没有移动写事务、文件落盘或同步状态更新。
- 验证：存储/同步定向回归 135 项，完整测试 224 项，tsc/build/diff 全绿。

#### Batch 4D-2：NoteMetadataRepository（已完成）

- 新增 `electron/noteMetadataRepository.ts`。
- 抽取目录创建、重命名、自定义图标、移动、同级排序、锁定状态，以及远端 folder/lock 元数据写入。
- Store 保留公开 wrapper；IPC channel、返回值、错误语义和事务 SQL 顺序保持不变。
- 未移动正文文件、资源、历史快照、远程内容导入或 purge 写入。
- 验证：存储/同步定向回归 135 项，完整测试 224 项，tsc/build/diff 全绿。

#### Batch 4D-3A：共享图片纯函数（已完成）

- 新增 `electron/imageUtils.ts` 与 `electron/imageUtils.test.ts`。
- 抽取图片格式嗅探、扩展名 MIME 映射、PNG/JPEG/GIF/WebP 无解码尺寸读取。
- Store 和 QuickNotesStore 复用同一套格式嗅探；没有移动图片写盘、上传、远程下载或像素限制业务流程。
- 验证：资源/存储/同步定向回归 138 项，完整测试 227 项，tsc/build/diff 全绿。

#### Batch 4D-3B：正文/资源/远程导入（分批执行）

影响评估见 `docs/STORE-CONTENT-REFACTOR-IMPACT-2026-08-17.md`。4D-3B-1/2/3 已按小批次完成；后续不再继续拆分内容写入，除非移动端复用出现明确需求。

##### Batch 4D-3B-1：NoteContentRepository save（已完成）

- 新增 `electron/noteContentRepository.ts`。
- 抽取 `saveNote` 正文保存协调器；Store 公开 `saveNote` 保留兼容 wrapper。
- 严格保持 purged 隐式恢复、历史留档、SQLite transaction、正文原子写、FTS、orphan 对账、history dirty 的原顺序。
- 验证：保存/同步定向回归 134 项，完整测试 227 项，tsc/build/diff 全绿。

##### Batch 4D-3B-2：ResourceRepository（已完成）

- 新增 `electron/resourceRepository.ts`、`electron/storeTypes.ts`、`electron/storeLimits.ts`。
- 抽取图片上传、受控远程下载、重定向、SSRF、大小/像素限制和孤儿登记协调。
- Store 公开 `uploadResource` / `downloadRemoteResource` 保留兼容 wrapper；没有改变安全策略或返回值。
- 验证：资源/存储/同步定向回归 134 项，完整测试 227 项，tsc/build/diff 全绿。

##### Batch 4D-3B-3：RemoteImport（已完成）

- 新增 `electron/remoteImportRepository.ts`。
- 抽取远程 `.lake`/资源 staging、DB upsert、事务提交后的原子 rename、孤儿对账和缓存补齐。
- Store 保留 `importRemoteNote` wrapper；路径校验、临时文件清理、DB 写入字段和落盘顺序保持不变。
- 验证：远程导入/存储/同步定向回归 134 项，完整测试 227 项，tsc/build/diff 全绿。

##### Batch 4D-3C：普通笔记 Store 后续领域（暂缓）

Store 的主要边界已经完成低风险与中风险整理，当前约 1,785 行。后续桌面端优先进入维护状态，开发重心转向移动端；不再为了继续缩短文件行数而拆分跨领域写事务。

只有在移动端出现明确复用需求、测试隔离需求或维护痛点时，才重新评估普通笔记的下一领域。

## 移动端复用专项（2026-08-18，分批执行）

下一阶段不直接继续拆普通笔记 Store，优先整理 Quick Notes：

1. M1：小记纯模型/校验/序列化层（已完成，完整测试 232 项）；
2. M2：小记只读查询层（已完成，保留 Electron wrapper）；
3. M3：小记文件/图片 staging 层（需移动端真实文件 API 后再做）；
4. M4：图片共享策略与平台 adapter；
5. 历史/回收站先共享 DTO/service contract，不提前复用 Electron SQLite 实现。

完整评估：`docs/MOBILE-REUSE-ARCHITECTURE-ASSESSMENT-2026-08-18.md`。

候选模块：

- `NoteRepository`（先拆 Metadata，再评估 Content/Import）
- `HistoryRepository`
- `TrashRepository`
- `AssetRepository`（只读层已完成）
- `NoteRepository`（先拆 Metadata，再评估 Content/Import）
- `SearchRepository`（已完成）
- `HistoryRepository`（只读层已完成）
- `TrashRepository`（只读层已完成）

风险：

- 可能影响跨表事务、文件与数据库一致性、同步导入顺序。
- 必须每次只迁移一个领域，并在迁移后运行完整测试和多端同步场景。

### Batch 5：App 其余职责拆分（中风险，桌面维护为主）

候选模块：

- `useDocumentTabs`
- `useSyncFeedback`
- `useWorkspaceMenus`
- `DesktopTopBar`
- `DesktopStatusBar`（已完成）

约束：

- 不改变 state ownership，先抽无状态视图和低耦合 hook。
- 标签、保存队列、同步 Toast、窗口关闭流程必须分别做回归。

### Batch 6：资源服务器与 IPC 集成测试（低风险、高收益）

覆盖：

- CORS origin + asset token
- `/vendor/cdn` 路径穿越
- 普通笔记、小记、staging 路径边界
- 文件被删除或流读取失败
- base64 转换与 50MP 上限
- IPC 受信来源和参数错误

## 依赖升级策略

已验证的低风险更新：

- `@aws-sdk/client-s3`：3.1101.0 → 3.1111.0
- `vite`：8.1.5 → 8.2.1

两项已同步更新 `package.json` 版本范围和 `package-lock.json`：`@aws-sdk/client-s3` 使用 `^3.1111.0`，Vite 使用 `^8.2.1`；tsc、220 tests、build 已通过。

后续记录但暂缓：
- `@types/better-sqlite3` `7.6.13 → 9.6.0`：类型声明文件实际一致，约相隔 483.5 天，低风险单独批次即可；依赖升级暂缓。
- Electron、better-sqlite3、Lake 编辑器当前无稳定新版本可升级。
- `electron-builder`、`vite-plugin-electron`、React 19、Slate、TypeScript 7 和 Mermaid 传递依赖不得混批升级。

暂不自动升级：

- Electron
- React/React DOM
- better-sqlite3
- Lake 编辑器相关依赖
- Slate
- vite-plugin-electron

这些依赖涉及 ABI、编辑器运行时、React 生命周期或打包链，升级前单独出影响评估。
