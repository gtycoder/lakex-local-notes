# 05 同步与数据层审计（S3 v3 内核 · 设备存储 · 账本 · GC）

> **基线**：`master @ 41def9f0`。本轮只读审计，未改任何代码。
> **读取窗口**：21:29–21:41（Asia/Shanghai）。两次 `git status` 采样（21:29、21:37）**均未列出本范围文件**（`src/core/s3v3*`、`electron/s3v3/*`、`src/mobile/v3/*`、`src/mobile/sync/*`、`electron/store.ts`、`electron/quickNotes.ts`、`src/mobile/data/schema.ts`），在途改动集中在移动 UI/壳层（`src/mobile/notebook/*`、`DocumentEditor.tsx` 等），**不影响本文证据**；行号 = HEAD 41def9f0 内容。按 lead 要求，每条证据同时给「文件 + 符号名」，行号只作定位参考。
> **范围**：协议/状态机（pointer→index→declaration→object）、baseline/intents/restore_pending/deferAssets/staging/marker persist/待补资产账本、三方合并与不变量、性能模型、SQLite 双套 schema、GC/深清理、跨端重复实现、失败模式与可观测性、测试债务。
> **不重复上报**：`docs/S3-V3-CODE-REVIEW.md`（锁非强互斥 P0-1、发布串行 P0-2、适配器全量 loadState P1-2 等）已在档，本文只标注「已记录」并补新证据。
> **分工**：本文是证据层；重设计见 `06-redesign.md`，汇总口径由 lead 定。

---

## 0. 结论摘要（按严重度）

> **261028 晚注**：本节是审计当时（2026-10-27）的结论快照，**不代表当前状态**；逐条当前状态以文末「修复状态（261028）」表 + `13-audit-status.md` 为准（本文状态表已按工作树代码对齐）。

| # | 结论 | 严重度 |
|---|---|---|
| 1 | **全量重拉会永久删除「本地独有」文档，并把它刚写入的历史快照一起删掉**：`pullAll` 用远端索引整体替换本地状态，桌面适配器 `saveState` 对不在新状态里的行调 `deleteNote + purgeTrashItem`（后者删 `note_history` 与 `history/` 目录）。这直接违背已批复的 `S3-REDESIGN.md` §15.1「云端赢 ≠ 删本地 / 进备份区」，而 `DeviceState.archived` 只是空壳字段。触发门槛低到「`sync-v3/baseline.json.gz` 丢失或损坏」。 | **P0** |
| 2 | **两个「恢复/换云」入口是断头路**：`resetFromCloud()` 无任何调用方（`epoch-mismatch/rollback/fork` 被分类为 `action-required`，但产品里没有这个 action）；缺正文面板的「可云恢复」判据读 `sync_base`——v3 从不写该表 ⇒ 桌面文档永远被判「仅历史/无备份」。 | **P1** |
| 3 | **待同步计数永久挂起**：v3 不再调用 `markTombstonesPublished`，`deleted_notes.published_at` 永远为 NULL，`getSyncPendingSummary().documents` 把每一次历史 purge 都算作待上传；状态栏/启动摘要因此长期非零。 | **P1** |
| 4 | **内存模型按「本轮字节总量」线性增长**：引擎 `bodyCache` 无界且从不清（增量轮是 prefetch→apply 的必需，首拉轮是纯浪费）；`buildAndUploadAll` 把全库正文攒进 `uploadOps` 后才 flush；桌面远端没有 `getObjectToFile`，资产以 20 并发整对象读进 JS 堆。移动端 staging 只修了「写」，没修「读」。 | **P1** |
| 5 | **发布成功可以被报成失败**：pointer 已写、baseline 已存之后才执行 `executePending`，它取声明失败会 `throw`，整轮 `sync()` 以异常返回 ⇒ 云端已更新、UI 报失败、移动端还留下「同步中断」标记。 | **P1** |
| 6 | **双端设备适配器把 15+ 条同步语义各写一遍，已出现实质漂移**（`lockedAt` 恒 null、`deleteMany` 批量 vs 12 并发、`deferAssets` 默认值、全量重拉处置：桌面物理 purge + 删历史 vs 移动保留历史）。conformance 只覆盖 4 类行为，治不了漂移。 | **P1** |
| 7 | **空跑轮仍是 O(N) 全量写**：每轮无条件 `saveState`+`saveBaseline`（gzip 全索引 + 2 万行 `markNotesSynced` 双 UPDATE），并重复加载 baseline（适配器内 + 引擎各一次；移动端每轮 4 次全量 state 读）。实测 2k/5k 文档空跑 199–217ms，与「零写入」不符。 | P2 |
| 8 | **协议/数据层契约文档整体失效**：`SYNC-PROTOCOL.md` 仍是 Manifest V2（墓碑、commit 链、`manifest.assets`），`STORAGE-LAYERS.md` §4/§5 描述已废弃对象与死表，`S3-GC-DESIGN.md` 自称历史但仍被交叉引用；「三处同改」清单指向死类型。新会话按文档改代码必然改错层。 | P2 |
| 9 | **门禁里塞着一个零断言的 benchmark，且唯一 2 万文档基准是坏的**：`perf.integration` 占每次全量 vitest 的 45–68s 却只断言数组长度；`perf.big.integration` 仍 INSERT 已删除的 `sync_state` 列（env 关闭 ⇒ 永不执行，开启即失败）。 | P2 |
| 10 | **要保住的资产**：删除=缺席 + 显式恢复例外 + 先提交者胜 + 本地强制留档、资产声明全量差集（禁 HEAD/禁本机缓存）、内容寻址幂等、`planLakeMerge/planQuickNotesMerge` 纯函数化、端口注入 + conformance、`s3v3Gate` 的「宁可不删不可误删」。这些是重写的**不变量基线**，不是可选项。 | — |

---

## 1. 现状盘点

### 1.1 模块与入口

| 层 | 文件 | 行数 | 职责 |
|---|---|---|---|
| 协议纯逻辑 | `src/core/s3v3Engine.ts` | **1895** | 编排：状态机、三方合并调用、上传/下载调度、发布锁、待删门禁、深清理、单条推送 |
| | `s3v3Merge.ts` / `s3v3Decision.ts` / `s3v3Gate.ts` / `s3v3Gc.ts` / `s3v3Intent.ts` / `s3v3Pointer.ts` | 259/61/119/97/44/19 | 纯决策（唯一真正被两端复用的部分） |
| | `s3v3Index.ts` / `s3v3Keys.ts` / `s3v3Types.ts` / `s3v3Ports.ts` / `s3v3DeviceStore.ts` | 225/86/61/43/111 | 编解码、key 布局、校验、端口契约 |
| | `s3v3Transfer.ts` / `s3v3Pool.ts` / `s3v3AssetBackfill.ts` | 73/45/140 | 全局有界流水线、并发池、按需补拉 |
| 桌面 | `electron/s3v3/desktopStoreAdapter.ts` | 481 | Store → 设备端口（saveState 投影、C5 父兜底、hashCache、cloud_deleted 投影） |
| | `electron/s3v3/desktopSync.ts` / `s3Remote.ts` | 201/134 | 编排入口、S3 传输（Node SDK） |
| | `electron/s3v3/deviceConformance.ts` | 496 | **测试用 harness（非 .test 后缀、放在生产目录）** |
| 移动 | `src/mobile/v3/mobileDeviceStore.ts` | **809** | SQLite + BodyStore → 设备端口（staging、批量导入、cloud_deleted 投影、标签关系） |
| | `src/mobile/v3/s3v3Remote.ts` / `sync.ts` | 153/98 | Capacitor S3 端口（含原生流式钩子）、编排入口 |
| | `src/mobile/bridge/sync.ts` | 422 | 移动同步对外 API（syncNow / 补拉资产 / 单条推送 / 深清理 / 状态） |
| 数据层 | `electron/store.ts` / `electron/quickNotes.ts` / `electron/trashLifecycle.ts` / `electron/schemaInit.ts` | 1609/1212/~450/200 | 桌面元数据、小记库、回收站/purge、schema |
| | `src/mobile/data/*.ts`（23 文件） / `src/mobile/native/*.ts`（24） | 4285/2061 | 移动仓储、正文/资产原生端口、v3 状态 |
| | `src/mobile/data/schema.ts` | 378 | 移动 schema v9（28+ 条 DDL、版本门） |
| 遗留幽灵 | `electron/syncReconciliation.ts` / `syncAdapters.ts` / `src/core/syncAssets.ts` / `gcDecisions.ts` / `manifestTypes.ts` / `syncEngineTypes.ts` / `syncDecisions.ts` / `electron/s3Store.ts` | 506/245/183/~40/80/189/162/239 | manifest 时代的账本/适配器/类型，**多数已无生产调用方**（见 §3） |

### 1.2 度量

- **本范围生产代码**：34 文件 / **6,127 行**；**测试 58 文件 / 5,694 行**（测试:生产 ≈ 0.93:1）。全仓测试文件 **453**，本范围占 **12.8%**。
- 最大单体：`s3v3Engine.ts` 1895（`incrementalSync` 单方法 **764–1278 行 ≈ 515 行**）；`mobileDeviceStore.ts` 809；`desktopStoreAdapter.ts` 481。
- `DeviceState` 跨轮账本 **9 个可选数组/字段**（intents / pending / remotePurged / restorePending / quickDeletes / quickPurges / quickPurgeTimes / archived / pendingAssets）+ 3 个持久化载体（桌面 `sync-v3/state.json`、`baseline.json.gz`；移动 `sync_v3_state` 单行 JSON）。
- **实测（本机 21:33 门禁内）**：同步层 39 文件 201 例 **59.19s**（其中 `perf.integration` 45.6s、`concurrency.integration` 58.8s）；单跑 `perf.integration` **68.1s**。`docs/S3-V3-DATA-PERF.md` 的 20k/50k 数字**无当前可执行来源**（见 SD-12）。
- **性能阶段实测（`electron/s3v3/perf.integration.test.ts`，假 S3，本机 21:33 一轮）**：

| 文档数 | 首传 | 空跑 | 改 10 篇 | 空跑阶段（load-state/pending） | 改 10 篇阶段（load-state / save-state / lock / index / finalize / pending） |
|---|---|---|---|---|---|
| 500 | 502ms | 114ms | 296ms | 81 / 26ms | 127 / 36 / 42 / 7 / 31 / 25ms |
| 2,000 | 863–2726ms | 151–199ms | 259–336ms | 104–149 / 44–46ms | 91–159 / 43–53 / 41 / 8 / 41–38 / 30ms |
| 5,000 | 1,559–2,174ms | 215–217ms | 402–405ms | 131–133 / 78ms | 126 / 92–93 / 42–43 / 11 / 63–65 / 60–61ms |

> 同一台机两次运行的首传差异最大 **3.2×**（500 篇 502ms vs 文档记的 181ms；2,000 篇 863ms vs 2,726ms）⇒ **文档里的性能数字不可复跑、也不进门禁**（SD-12）。

### 1.3 正确性不变量：代码在哪、靠什么保证、哪里是隐式的

| 不变量 | 实现位置（符号） | 判定 |
|---|---|---|
| 删除 = 缺席 | `decideItem`（`basePresent && !remotePresent → remote-purged-move-to-trash`）；`planLakeMerge` 拒绝上传本地缺席墓碑 | 显式，纯函数，有测试 |
| 墓碑/回收站分离 | 回收站条目是索引里的正常条目（`trashedAt`）；只有小记有 `purged` id 数组 | 显式；**但 `trashLifecycle.purgeTrashItem` 注释仍写「墓碑上云（deleted:true）」，与实现不符** |
| 恢复 local-wins | `s3v3Merge` 第 1 顺序 `restorePending`；引擎 `resolveRemotePurged` 清标记；`markNotesSynced` 清 `restore_pending_at` | 显式，但**三个清理入口**（整轮 `saveState`、`persistSyncMarkers`、适配器 loadState 并集）靠注释维持一致 |
| 冲突先提交者为真 | `decideItem` 两端都变 → `remote-wins-keep-history` + `archiveLocal`（引擎 `archiveBody`/`archiveQuickNote`） | 显式；小记走 `archiveQuickNote` 端口，移动端**产品定稿不留副本** ⇒ 语义分叉 |
| 资产声明全量 | `uploadAssets` 以**本地全量扫描**构造声明；只在「本地目录为空且有远端声明」时保留远端（`asset_kept_remote`） | 显式但**是补丁**：把「本地空」当异常而不是事实（见 SD-02/§6） |
| 上传失败轮不进索引 | `WorkingSet.failUpload` + `newLakeDecls/prevDecls.delete` | 显式，7 处重复样板 ⇒ 易漏（B14 类） |
| 待删执行门禁 | `gatePendingDelete`（声明缺失保守跳过） | 显式、纯函数；但执行点 `executePending` 抛错会破坏「发布成功」语义（SD-05） |
| 删除意图有界 | `shouldClearDeletionIntent`（更高 generation 且索引不含 id） | 显式；**`shouldRepublishPurge` 未被调用**（迟到覆盖靠 intent 在 merge 第 2 顺序隐含压制，功能达成但机制名存实亡） |
| 基线不上云 | 桌面 `sync-v3/baseline.json.gz`；移动 `sync_v3_state.baseline` | 显式 |
| 双端一致 | `deviceConformance.ts`（15+15 场景）+ `deviceConformance.mixed` | **只覆盖 4 类行为**（首传/空跑/双设备/双端编辑），不覆盖资产、删除意图、恢复、全量重拉 |

---

## 2. 问题清单

### SD-01 [P0] 全量重拉 = 静默永久删除本地独有文档（连历史快照一起）
- **证据**
  - `src/core/s3v3Engine.ts · syncOnce`：`if (!baseline) return await this.pullAll(pointer, state, report, true, …)`（L506-507）；`pullAll` 把 `newState.lake/quickNotes` 直接设为远端索引（L562-572），**不含任何本地独有条目**，随后 `device.saveState(newState)`（L650/655/670/689）。
  - `electron/s3v3/desktopStoreAdapter.ts · saveState`：`for (const cur of current.values()) if (!wanted.has(cur.id)) { this.store.deleteNote(cur.id); this.store.purgeTrashItem(cur.id); }`（L261-265）。
  - `electron/trashLifecycle.ts · purgeTrashItem`：写 `purged_at` 墓碑（L229-232）、`DELETE FROM note_history WHERE note_id=?`（L236）、`filesToRemove.push(historyNoteDirFor(...))`（L246）⇒ **物理删除历史快照**。
  - 引擎在替换前确实「留档」：`pullAll` 对远端不存在的本地条目 `readLocalBody → device.archiveBody`（L541-561），桌面 `archiveBody → createHistorySnapshot`（`desktopStoreAdapter.ts` L386）——**但紧接着的 `purgeTrashItem` 又把这份快照删掉**。
  - 设计已批复但未实现：`docs/S3-REDESIGN.md` §15.1 L553-567「**云端赢 ≠ 删本地**……本地多出来的数据不自动上传、不静默删除，而是进入『本地备份区』」「文件不移动、不复制，DB 打 `archived` 标记 + 备份区列表；同步与 GC 必须排除 archived 行」。
  - `DeviceState.archived` 只存在于类型与 sidecar 往返（`s3v3DeviceStore.ts` L40、`desktopStoreAdapter.ts` L66/80/161、`mobileDeviceStore.ts` L192 恒 `[]`），**引擎从不写入**。
- **影响**：① 用户 `sync-v3/baseline.json.gz` 损坏/被清理/换机导入旧 sidecar ⇒ 下一次同步把「云端没有」的本地文档**永久删除**（正文、附件目录、历史全没），无二次确认、无备份区、无导入入口；② 新设备首同步会「删掉」本地种子笔记本/欢迎笔记（无害，但证明机制在跑）；③ 这是「本地是真相」红线（AGENTS §3#1）的唯一硬违背点。
- **建议**：① 激进：`saveState` 只允许「应用」；不在新世界里的行一律 **标记 `archived` + 保留文件**，删除只由显式用户动作（purge）触发；引擎的 `pullAll` 改成「仅元数据对账」，禁止在无用户确认的路径上调 `purgeTrashItem`；把 `archived` 做成真实备份区（列表 + 逐篇「导入为新文档」）。② 保守：先删掉 `saveState` 里的 `purgeTrashItem`（只软删），并给 `pullAll` 加「必须有 baseline 或用户显式确认」前置；冲突面最小、立刻止住不可恢复删除。
- **成本**：M（①）/ S（②）
- **状态**：新发现（设计 §15.1 已定，实现缺失 = 功能债，不是待裁决项）

### SD-02 [P1] 内存模型按「本轮字节总量」线性增长（bodyCache / uploadOps / 无流式资产）
- **证据**
  - `s3v3Engine.ts`：`private readonly bodyCache = new Map<string, Uint8Array>()`（L225），`getBody` 无条件 `this.bodyCache.set(...)`（L476-485），**全类无 clear/delete 调用**。
  - `pullAll` 的 `downloadBodies` 逐篇 `getBody → writeBody`（L620-638）⇒ 首拉/续传把**每一篇正文常驻 JS 堆**（分块 `BODY_CHUNK=100` 只限制落库节奏，不限制内存）。
  - `buildAndUploadAll`（初始化上传）把所有正文/声明 push 进 `this.uploadOps`（L1408-1446），**全部累积后**才 `flushUploadOps`（L1446）⇒ 2 万文档首传 = 全库正文在内存里排队。
  - 桌面远端无流式下载：`electron/s3v3/s3Remote.ts` 只实现 `get/getRange/put/list/deleteMany/deleteByPrefix`，无 `getToFile`；`flushAssetTasks` 走 `remote.get` 整对象（L1694），并发 `downloadConcurrency=20`（L43/1665）⇒ 20 × 最大 25MB 附件同时在堆里。
  - 移动端 staging 只修了写路径：`mobileDeviceStore.ts` `stagedBodyIds`（L55）注释明确「不在 JS 内存里攒字节」，但引擎侧 `bodyCache` 仍留一份同内容（`writeBody` 写 staging 文件，`getBody` 缓存字节）。
- **影响**：2 万文档（正文平均 20KB）首拉 ≈ 400MB 常驻 + 20 并发附件峰值；移动端 WebView 堆更紧（HANDOFF 记录的 1852 篇 OOM 只解决了写侧）。这也是「1.6GB 首拉 20–70min」之外的真实失败风险。
- **建议**：① 激进：传输端口全面流式化（桌面补 `getObjectToFile`/Range 直写；`putFromFile` 已存在），`bodyCache` 降级为「prefetch→apply 之间的一批」，批末清空；`flushUploadOps` 改分批 flush。② 保守：`pullAll` 不写 `bodyCache`（直接 `get→write`），`buildAndUploadAll` 每 N 篇 flush 一次。
- **成本**：M
- **状态**：新发现（与 HANDOFF 261027「staging 正文修复 OOM」互补，不是重复项）

### SD-03 [P1] 两个「恢复/换云」显式入口缺失：resetFromCloud 死代码 + 缺正文「可云恢复」判据用死表
- **证据**
  - `s3v3Engine.ts · resetFromCloud`（L1889-1894）**全仓无调用方**（grep 仅定义处）；`classifyS3v3Error` 把 `epoch-mismatch / generation-rollback / fork` 归为 `action-required`（L87），但 `desktopSync.ts` / 移动 `syncNow` 没有任何 UI 或 IPC 承接这个 action ⇒ 用户只看到错误文案（`syncOnce` L524-527）。
  - 桌面缺正文面板：`electron/store.ts · listMissingBodies` 用 `(SELECT 1 FROM sync_base …) AS has_sync_base`（L1199）并据此 `missingBodyRecovery({cloudConfigured, hasSyncBase, historyCount})`（L1210-1221）；`sync_base` **唯一生产写者是已死的 `electron/syncAdapters.ts:132`（setBaseHash）** 与 legacy `syncEngineController.ts:165`，v3 路径只写 `is_dirty`/`baseline.json.gz` ⇒ `hasSyncBase` 恒 false ⇒ `recovery` 落到 `history` 或 `none`（`src/core/missingBody.ts:36`）。
  - 对照：小记侧 `quick_note_sync_base` 仍由 `quickNotes.markSyncedIfUnchanged` 写入（`electron/quickNotes.ts` L1027+），所以**文档判错、小记判对**——同一面板两套账本。
- **影响**：① 换桶/恢复备份/云端重置后同步永久失败，唯一出路是「删库重装」——而重装后第一次同步就踩 SD-01；② 资源页把「其实能从云端拉回」的缺正文文档标成「仅历史/无备份」，用户不会去点那个入口（数据恢复可发现性）。
- **建议**：① 激进：把「云端状态异常」做成一等公民：`SyncStatusPopover` 给「云端赢（备份本地→重拉）/ 本地赢（重新初始化 epoch）」二选一，接 `resetFromCloud` + §15.1 备份区；`hasSyncBase` 改成读 v3 事实（sidecar/baseline 是否有该 id，或直接探 pointer→索引）。② 保守：先修 `hasSyncBase`（改判据或 v3 发布后回写 `sync_base`），并给 `epoch-mismatch` 明确 IPC 文案 + 手动「全量重拉」钩子（前提 SD-01 已修）。
- **成本**：M（①）/ S（②）
- **状态**：新发现

### SD-04 [P1] 待同步计数永久挂起（published_at 记账在 v3 无人写）
- **证据**
  - `electron/syncReconciliation.ts · getSyncPendingSummary`：`documents = pendingDocs + tombstones`，`tombstones = COUNT(*) FROM deleted_notes WHERE published_at IS NULL`（L389-405）；`pendingSignature` 同样把 `tombs` 计入指纹（L382-387）。
  - `published_at` 的写入只有 `markTombstonesPublished`（`syncReconciliation.ts:315` / `store.ts:1529`），**生产侧无调用方**（仅 `electron/syncAdapters.ts:216` 与移动 legacy `syncDbPort.ts:283`，v3 都不走）；`electron/trashLifecycle.ts · purgeTrashItem` 显式以 `published_at=NULL` 插入（L228-232）。
  - 消费方：`electron/main.ts:514-517`（签名 diff + 摘要广播）、`electron/ipc/registerSync.ts:198`、`src/hooks/useBootstrap.ts:48`（启动摘要）。
- **影响**：用户只要彻底删除过一篇文档，状态栏/启动的「待同步 N 篇」就**永远**挂着，且随 purge 数量单调增长；真正待同步时无法区分（噪声掩盖信号）。小记侧同构问题（`quick_note_deleted.published_at` 的 `markTombstonesPublished` 仅 legacy 调用）。
- **建议**：① 激进：`pending` 单一来源 = `is_dirty`（文档/目录）+ 小记 dirty/墓碑 ready 位，删掉 `published_at` 记账与两个 legacy API；② 保守：v3 发布成功后按本轮 purged ids 批量写 `published_at`（一处调用即可）。
- **成本**：S
- **状态**：新发现

### SD-05 [P1] 发布成功被报成失败（executePending 抛错越过已成功的提交）
- **证据**
  - `incrementalSync`：写 pointer → `readPointer` 读回校验（L1255-1258）→ `saveState(finalState)`/`saveBaseline`（L1268-1269）→ **之后**才 `await this.executePending(...)`（L1271）。
  - `executePending`：声明并发取，`const firstError = errors[0]?.error; if (firstError) throw firstError;`（L1327-1338）。
  - `sync()` 只吞 `PublishRetry`（L286-303）⇒ 该错误直接抛给调用方；`desktopSync.ts` 记录 `[v3][error]` 并 `throw`（L146-151）；移动 `bridge/sync.ts · syncNow` 写 `syncStatus {ok:false}` 且**不清 `sync_interrupted_at`**（L405-409 + `syncResumeMarker`），下次进入无条件补同步。
- **影响**：弱网/单对象 5xx 下「云端已更新、本地已记基线、UI 报失败」⇒ 用户重试/换端排查；移动端还会多跑一轮整同步。观测上把「清理阶段失败」与「发布失败」混为一谈（分类只在 code 上，pending 阶段没有自有 code）。
- **建议**：① 激进：把「发布」与「清理」拆成两笔事务语义，清理失败只降级为 warning + pending 下轮重试（`deletedObjects` 如实为 0），并在 `S3v3SyncReport` 里区分 `published` 与 `cleaned`；② 保守：`executePending` 的声明错误不再抛，改为逐项保留 pending。
- **成本**：S
- **状态**：新发现

### SD-06 [P1] 双端语义两写 + 已发生的漂移
- **证据（同一语义的两份实现）**

| 语义 | 桌面（`desktopStoreAdapter`） | 移动（`mobileDeviceStore`） | 漂移证据 |
|---|---|---|---|
| C5 非法父兜底 | `resolveRemoteParent` L446-461（懒建兜底笔记本 + `protectedFolderIds`） | `resolveSyncNoteParent` + `parentCache`（saveState L211-219/236） | 回收站父语义不同（桌面 `TRASH_NOTEBOOK_ID`，移动 `trashed_at`） |
| 锁字段 | `isLocked/lockedAt` 原样落库（L107/190/245-247） | `isLocked: !!r.is_locked`，**`lockedAt: null` 恒空**（L120） | 键编辑锁的字段级 LWW 在移动端永远「无时间戳」⇒ 混合使用隔轮抖动（HANDOFF 261026 已列风险②，**至今未修**） |
| 物理删除 | `deleteNote` + `purgeTrashItem`（连带删历史） | `purgeTreeItem` 同样 `DELETE FROM note_history`（`trashRepository.ts:224/247`） | **已对齐**（原记「不删历史」已过期，见 `SYNC-DEVICE-CONTRACT` §5-8） |
| `deleteMany` | 12 并发单 DELETE（`s3Remote.ts:114-126`，注释：七牛批量 API 更慢） | `DeleteObjects` 批量 1000（`s3v3Remote.ts:115-123`） | 同一 provider 上一边被判为慢路径 |
| `deferAssets` 默认 | 仅设置项，默认 false（`desktopSync.ts:133`） | 新设备**自动 true 并固化**（`deferAssetsDefault.ts:29-36`） | 新桌面设备首拉全量，新移动设备不拉 |
| gzip PUT 元信息 | 只加 `ContentEncoding`（`s3Remote.ts:83-92`） | 额外加 `ContentType`（`s3v3Remote.ts:96-99`） | 对象元数据不一致 |
| 小记冲突副本 | `quickNotes.archiveLocalToTrash`（回收站新 id） | `mobileDeviceStore.archiveQuickNote`（新 UUID + 复制正文/图片/标签 + `ready_to_sync=0`） | **已对齐**（实现各写一份，见 `SYNC-DEVICE-CONTRACT` §5-7） |
| 状态读取成本 | 每轮 `loadState` 全表 SQL + hashCache | 每轮 4 次 `loadV3State`（loadState/baseline/saveState/saveBaseline 各一次，每次全量解析 baseline JSON） | 同一概念两种代价模型 |

- **影响**：每加一条同步语义必须改两处 + conformance；真实用户就是「桌面↔移动混合使用」，漂移会以「隔轮 +1 generation / 空发布 / 锁不传播」的形式缓慢出现（P1 空发布抖动修过一次，同类还会有）。conformance 496 行只覆盖 4 类行为，**没有能力矩阵测试**（哪些端口可选、缺失时退化行为是什么）。
- **建议**：① 激进：把 15 条语义从适配器抽成 core 纯函数/模板方法（`applyPlan(plan, tx)` 由端提供 8 个原语：upsertRow/deleteRow/readBody/writeBody/listAssets/...），适配器只剩 IO；② 保守：把上表每一行写进 `s3v3DeviceStore.ts` 的契约注释 + conformance 增加 6 个场景（锁、恢复、purge、全量重拉、deferAssets、声明保留）。
- **成本**：L（①）/ M（②）
- **状态**：新发现（「双端两写」本身 `01` 已列 P1，本条补**具体漂移证据**）。**261028 晚对账**：v4 四相内核已把「决策/编排」收成单一实现（`08` §59，`08` 旧 v3 双实现物理删除）；本表剩下的**适配器字段级**差异按 `docs/SYNC-DEVICE-CONTRACT.md` §5 逐条判定 = 仍漂移 1（编辑锁 `lockedAt`）/ 有意保留 4 / 已对齐 3。**结论不再写在本表**（本表只是审计当时的证据快照），以契约文件为准。

### SD-07 [P2] 空跑/无变更轮仍是 O(N) 全量写，且 baseline 被重复加载
- **证据**
  - 无发布路径（`!needPublish`）仍执行 `device.saveState(newState)` + `device.saveBaseline({...})`（`s3v3Engine.ts:1210-1228`）。
  - 桌面 `saveBaseline` = gzip 全索引写盘 + `store.markNotesSynced(allIds)`（两批 UPDATE，20k 行）（`desktopStoreAdapter.ts:365-369`）；`saveState` 还要重写 sidecar（含 O(N) 的 `hashCache`，L63-72）并扫一遍 `listNotesSyncMeta`（L171）。
  - baseline 被加载两次：适配器 `loadState` 内部 `const baseline = await this.loadBaseline()`（L138）与引擎 `syncOnce` 的 `device.loadBaseline()`（L500）；移动端每次 `loadV3State` 都反序列化整份 baseline（`mobileDeviceStore.ts:93/198/478/482`）。
  - 实测：空跑轮 `load-state` 81–149ms、`pending` 段（含上述 saveState+saveBaseline）26–78ms（§1.2 表）。
- **影响**：开/关 App 各一次自动同步（AGENTS §4）都会付这笔；2 万文档按文档外推 ≈ 0.8–1s/空跑轮，且是纯写放大（SSD 写 + gzip CPU）。移动端 4 次全量 state 读是首拉 profile 里已知的慢点。
- **建议**：① 激进：引入「提交号不变 + dirty 集为空 ⇒ 整轮零写」的短路（baseline 只在 `lakeCommit/quickNotesCommit` 变化时写）；把 `loadState` 的 baseline 作为返回值传给引擎，删掉重复加载。② 保守：只在 `quickCommit` 变化时重写 quick 半边；`markNotesSynced` 改成 `WHERE is_dirty=1 AND id IN …`。
- **成本**：M
- **状态**：部分已记录（`docs/S3-V3-DATA-PERF.md` §4 把「适配器增量 load-state」列为「到第二瓶颈再做」= **已定延后**，勿重提 loadState 全量扫描；但「**空跑也全量写 baseline / 重复加载**」不在其列，属新发现）

### SD-08 [P2] 发布锁/重试族的已知上限 + 容量测试把失败固化成期望
- **证据**：锁 TTL 120s 无续期（`s3v3Engine.ts:46/1387`）、静置 40ms + 双读（L1373-1394）、时钟取自对端 `Date.now()`（L1380）；`MAX_PUBLISH_RETRIES=6` 整轮重放（L52/278-303）；`MAX_CLOUD_RACE_RETRIES=2` 专治「首次并发首传」（L53-56/293-301）。
  `electron/s3v3/concurrency.integration.test.ts`「并发发布容量」：`expect(28 端 errors.length).toBeGreaterThanOrEqual(3)` + `retry: 2` + 300s（L83-104）——**把「28 端必然发布冲突」写进断言**；20 端实测 0~2 错误、不进断言。
- **影响**：这是「无 CAS provider」的**已定分支**（`S3-REDESIGN` §6.6/§6.7、`S3-V3-CODE-REVIEW` P0-1/P0-2）⇒ **不重提改锁**；但门禁层面它把缺陷固化为「预期」，容量回归只能靠人读 `CONC-CAP` 日志；`retry:2` 让偶发失败被自动掩盖。
- **建议**：① 激进：容量测试只对 6/12 端做硬断言（errors 必须为空），20/28 端移出手动脚本并输出可对比 JSON —— 让门禁只锁「已承诺的能力」；② 保守：保留现状但把 `retry: 2` 去掉（失败即红，避免掩盖），并在测试输出里写入 `expected≤2 errors @20 端` 的说明。**不要**再为锁加大重试或放弃 intent（S3-REDESIGN §6.6 已定）。
- **成本**：S
- **状态**：机制已定不做（S3-REDESIGN §6.6 分支 2 / S3-V3-CODE-REVIEW P0-1）；**测试固化这一条是新发现**

### SD-09 [P2] 小记 purged 数组无界增长
- **证据**：`QuickNotesIndex.purged`（`s3v3Index.ts:88-95`）；`incrementalSync` 只做「并集 + 过滤 restore」，**从不裁剪**（`s3v3Engine.ts:818-821`）；`deepCleanup` 只清对象不碰索引（L1809-1886）；`state.quickPurges/quickPurgeTimes` 同步增长（L1186-1194、L1240）。
- **影响**：索引体积随「历史 purged 数量」单调增长（2 万小记 × 每条一次 purge）；每轮 merge 都要在该数组上过滤（O(P)）；与「零痕迹/精简索引」目标相悖。
- **建议**：① 激进：改 `purged: [{id, at}]` 并设保留窗口（如 90 天，与回收站一致），或按「设备基线里没有 + 从未出现」推断，删掉该数组；② 保守：保留数组但加「超过 N 条按最旧裁剪」的运维路径 + 注释。
- **成本**：S（②）/ M（①）
- **状态**：新发现（需产品口径：裁剪后「迟到设备」可能复活已 purge 小记，方向与删除=缺席一致）

### SD-10 [P2] 死参数/死代码在热路径上
- **证据**
  - `validParents`：引擎每轮建 6 个集合（`s3v3Engine.ts:807-816`，O(N) 插入）并传入 `planLakeMerge`；`s3v3Merge.ts` 只在接口里声明（L12），**函数体从未读**（grep 仅这两处）。注释却声称「环检测（C4）只在远端父可解释时成立」⇒ 读者会以为有护栏。
  - `s3v3Intent.ts`：`isDeletionIntentActive`（L34）与 `shouldRepublishPurge`（L42）**无调用方**。
  - `s3v3Engine.ts · executePending`：`state.pending = state.pending;`（L1356）空语句。
- **影响**：热路径 O(N) 空转 + 误导后续维护（尤其 `validParents` 的注释会让人相信环检测有父集合闸门）。
- **建议**：① 激进：删 `validParents`（连同引擎 6 个循环、`LakeMergeContext.validParents` 字段）与两个未用导出，并把 `planLakeMerge` 的环检测注释改正（现在会让人误以为有父集合闸门）；若确实需要闸门，在 merge 内实现并补测试。② 保守：至少把未读参数改成注释说明「由适配器承担」，避免下一个人再传一遍。
- **成本**：S
- **状态**：新发现

### SD-11 [P2] 协议/数据层文档整体失效（含「三处同改」清单）
- **证据**
  - `docs/SYNC-PROTOCOL.md`：标题即「同步协议（Manifest V2）」；§2 对象布局仍是 `manifests/latest.json` + commit 链（L26-46）；§3 schema 是 `ManifestNote/ManifestFolder`（L61-98）；§4 全篇墓碑/链 CAS；§7 传输对拍表。以上均与 v3（pointer + 不可变索引 + 每篇声明，无墓碑无链）无关，**且未标注为历史**。
  - `docs/STORAGE-LAYERS.md`：§0 铁律 1「镜像层字段三处同改：`manifestTypes.ts` + 两端 build/apply + `SYNC-PROTOCOL.md`」（L11）；§4 S3 布局（L98-109）是 manifest 时代；§5 把 `sync_base`/`declared_assets` 列为 L2 真源（L123-127）——v3 对文档已不再写这两张表。
  - `docs/S3-GC-DESIGN.md`：开头已声明「261026 v3 转正后本文描述的 manifest 链 / 永久墓碑 / keep 集 GC 已不适用」（L3），但仍被 `STORAGE-LAYERS`/AGENTS 引用为「GC 契约」。
  - `docs/S3-V3-STATUS.md` L22 仍写「`src/core/s3v3Migration*`」——该文件已删（`ls src/core | grep migrat` 为空）。
  - `electron/trashLifecycle.ts` L205-207 注释「墓碑上云（deleted:true）防其他端被动复活」——v3 已无墓碑。
- **影响**：任何按文档改同步层的会话都会**改到死类型/死表**；审计本身也会被旧文档误导（本轮已踩到一次：STORAGE-LAYERS 的 L2 表清单）。AGENTS §2 明确「已完成的研究/计划/审计直接删」。
- **建议**：① 激进：新写一篇 `SYNC-PROTOCOL.md`（v3 唯一协议：对象布局/pointer/索引/声明/不变量/锁与分片/GC 窗口/双端能力矩阵），其余 v3 过程文档与 Manifest V2 全文删除（git 可查）；`STORAGE-LAYERS` 只保留「分层归属」并重写 §4/§5。② 保守：给失效文档加顶部「已失效，见 X」横幅，并把三处同改清单替换为 v3 实际触点。
- **成本**：S（②）/ M（①）
- **状态**：新发现（`01` 也提到 ARCHITECTURE/HANDOFF 漂移，本条补协议文档与死表证据）

### SD-12 [P2] 测试债务：门禁成本、零断言 benchmark、坏掉的 2 万基准、固化的失败
- **证据**
  - **27 个测试文件各自复制假 remote**（`class MemoryRemote/CountingRemote/LatencyRemote/FakeRemote`，`grep -rln` 命中 27 个文件，含 `src/core`、`src/mobile/v3`）——`S3-V3-CODE-REVIEW` P3 已提，至今未做。
  - `perf.integration.test.ts`：唯一断言 `expect(out.length).toBe(SIZES.length)`（L53），阶段数据只 `console.log`（L51）；**占每次门禁 45–68s**。
  - `perf.big.integration.test.ts`：直接 `INSERT INTO notes(...,sync_state,...)`（L34）与 `tree_nodes(...,sync_state,...)`（L35），而 `electron/schemaInit.ts` **已删该列**（L161-166 `DROP COLUMN sync_state`）⇒ 设 `S3V3_PERF_BIG=1` 必失败；默认 env 关闭 ⇒ 2 万文档基准**常年不跑**（`S3-V3-DATA-PERF.md` 的 20k/50k 行无当前可执行来源）。
  - `concurrency.integration.test.ts`：容量断言把 28 端失败写成预期（SD-08）。
  - 8 个 `*.integration.test.ts` 恒 skip（需 `S3V3_IT=1`/真实凭证）；本次运行 `39 passed / 8 skipped / 201 tests / 59.19s`。
  - `deviceConformance.ts`（496 行）是**测试 harness 放在生产目录**，且被 `src/mobile/v3/deviceConformance.mobile.test.ts` 跨树 import（`src` → `electron`）。
- **影响**：日常门禁被一个有成本的「无断言基准」拖慢且不产出信号；唯一 2 万级基准是坏的（等于「目标量级」从未在当前 schema 上验证）；失败被 retry 掩盖；夹具重复让「改端口行为」需要改 27 处。
- **建议**：① 激进：删/重写 `perf.big`（按当前 schema 造数 + phase 上下界断言）；把 `perf.integration` 移出默认 include（改名 `.bench.ts` + 手动脚本），日常门禁只留 500/2000 两档 + 比值断言（相对基线 < 1.5×）；抽 `test/fakes/s3Remote.ts`；`deviceConformance.ts` 移到 `electron/s3v3/testing/` 并加 6 个场景。② 保守：给 `perf.integration` 加宽松上界断言（防再次 3× 退化），修 `perf.big` 的列名，其余排期。
- **成本**：M
- **状态**：部分已记录（夹具重复 = CODE-REVIEW P3；本条补「零断言/坏基准/固化失败」证据）

### SD-13 [P2] 可观测性：结构化报告没有落盘，错误分类只到 code
- **证据**：`S3v3SyncReport`（`s3v3Engine.ts:101-113`）只回内存给调用方；桌面把 warnings 逐条 `logScopes.sync.warn`（`desktopSync.ts:136/144`）后丢弃，移动把 `progress`/`warnings` 塞进设置页一次性展示（`bridge/sync.ts:395-403`）。阶段耗时只在 `ms>=1000` 时 warn（`desktopSync.ts:124`），不落 `device_state`；`classifyS3v3Error` 的 `retryable/action-required/fatal` 只用于一行日志（`desktopSync.ts:148`），UI 不消费。移动 `writeSyncStatus` 只有 `{at, ok, message}`。
- **影响**：用户报「同步慢/没上去」时只能拿到最后一条字符串；没有「上一轮 plan 摘要 / 对象计数 / 字节 / 阶段耗时 / 失败对象清单」可回溯（云端对象计数 20 万级时这是唯一可负担的诊断面）。
- **建议**：① 激进：`SyncPlan` 可导出（dry-run 文本 + JSON），最近 3 轮报告环形落盘（两端 `device_state`），设置页「同步诊断」一键复制；② 保守：把 `onPhase` 明细 + warning 数组写进 `device_state.last_sync_result`（键已存在，见 `syncReconciliation.recordSyncResult`）。
- **成本**：S（②）/ M（①）
- **状态**：新发现（`S3-V3-CODE-REVIEW` P2-2/P2-3 要求过「阶段耗时日志 + 错误分类」，部分已做但**未落盘、UI 不消费**）

---

## 3. 删除 / 合并清单（按「可安全去除」排序）

| # | 对象 | 证据 | 风险 / 前置 |
|---|---|---|---|
| 1 | `electron/syncAdapters.ts`（245 行） | 仅被 `electron/syncApplyGuard.test.ts`、`electron/store.test.ts` import；无生产调用方 | 删后同步删两个测试的对应断言 |
| 2 | `src/core/syncAssets.ts`（183 行） | `grep` 无任何（测试外的）import 方 | 直接删；`syncEngineTypes.ts` 的 `SyncReport` 若仅剩它用需一起收 |
| 3 | `src/core/gcDecisions.ts` + `syncUtils.collectManifestRefs` + `gcPolicy` 的 pending 诊断链路 | `buildGcKeepSet`/`gcDecisions` 仅测试引用；`s3_gc_pending` 在 v3 **无写入者**（`addS3GcPending`/`markGcPending` 无生产调用），但 `SettingsPanel.tsx:771` + IPC `list_s3_gc_pending` + `gcDiagnostics` 仍在展示 | 删表 + IPC + 设置页区块；保留 `s3_gc_log`（深清理真写） |
| 4 | `syncDecisions.ts` 的 7 个 legacy 决策函数（`decideFolderPurge/decideLocalTombstone/decideMetaApply/decideTombstoneYield/buildUploadEntry/buildTombstoneEntry/computeBookkeeping`） | 全部「无非测试引用」（grep） | 保留 `TRASH_NOTEBOOK_ID`、`isGoneNote`、`rowToLocalState`（`noteQueries` 仍用） |
| 5 | `syncReconciliation.ts` 中 `sync_base`/`declared_assets`/`tombstoneSignature`/`pruneTombstones`/`markTombstonesPublished` 等 ~15 个方法 + 桌面 schema 的两张表 | `sync_base` 写者只剩 `syncAdapters`（死）；`declared_assets` 同（`s3v3AssetBackfill.ts:11` 注释已说明 v3 不写） | 先修 SD-03 再删表；保留 `getSyncPendingSummary/pendingSignature/hasLocalPendingNotes/getSyncStatus/recordS3GcLog`（v3 在用） |
| 6 | `deleted_notes.published_at` + `markTombstonesPublished`（桌面/移动） | v3 无调用方（SD-04） | 与 SD-04 一起做：改判据后删列 |
| 7 | 引擎 `validParents` 构造（6 循环）+ `shouldRepublishPurge`/`isDeletionIntentActive` 导出 + `state.pending = state.pending` | SD-10 | 无 |
| 8 | `DeviceState.archived` 空壳（类型 + sidecar 往返 + 移动恒 `[]`） | 引擎从不写（SD-01） | 要么随 SD-01 实现备份区，要么删 |
| 9 | `electron/s3v3/deviceConformance.ts` 的目录位置 | 仅测试 import（含跨树 import） | 移到 `electron/s3v3/testing/`；不影响行为 |
| 10 | `electron/s3v3/perf.big.integration.test.ts` | 依赖已删列（SD-12） | 修或删 |
| 11 | `docs/SYNC-PROTOCOL.md`（Manifest V2 全文）、`S3-GC-DESIGN.md`、`S3-MANIFEST-SCALE-RESEARCH.md`、`S3-V3-{AB,BATCHING,CAPACITY,CODE-REVIEW,CONCURRENCY,IMPLEMENTATION-REPORT,MOBILE-*}` 等过程文档 | AGENTS §2「已完成的研究/计划/spike/审计直接删」；内容已被 v3 取代（SD-11） | 先落地新的 v3 协议文档再删；CODE-REVIEW 里未修项（锁/串行）迁进新文档的「已知上限」 |
| 12 | `electron/s3v3/{syncEngine,ports,deviceStore}.ts` 三个 2 行 re-export shim | 历史 import 路径 | 全仓改 import 后可删；收益小，可留 |
| 13 | `purged` 数组（小记）无界增长 | SD-09 | 非删除，需产品口径后裁剪 |

**合并清单**

1. 三套「云端已删·仅本地」标记（`remotePurged` / DB `cloud_deleted` 投影 / 小记回收站副本）应为**一个** tombstone 视图——当前 `resolveRemotePurged`（引擎）+ `applyNotesCloudDeleted`（桌面 Store）+ 移动 `saveState` 的全清再置位（L451-462）三处各自维护不变量，只靠注释对齐。
2. `pendingAssets` 账本可被「每轮按声明差集重算」取代（`06-redesign` 已给判断，本文补证据：它是**唯一**为「普通增量轮不重调度资产」而存在的持久状态，`retryPendingAssets` 注释自认这是对旧协议「每轮差集」的退步补偿）。
3. 两个 `loadState`/baseline 读取合并（SD-07）；移动端 4 次 `loadV3State` 合并为 1 次。

---

## 4. 重构路线（分阶段，标依赖与门禁）

| 阶段 | 内容 | 依赖 | 门禁 |
|---|---|---|---|
| **P0 止血**（不改协议、不动 UI） | ① `saveState` 去掉 `purgeTrashItem`（只软删）+ `pullAll` 加显式确认前置；② `hasSyncBase` 判据改 v3 事实；③ v3 发布后补写 `published_at`（或改计数口径）；④ `executePending` 失败降级 | 无 | 定向 vitest（s3v3*、missingBody、syncReconciliation 相关）+ 新增回归：删 baseline → sync → 本地独有文档仍在（软删）/历史仍在 |
| **P1 内存与流式** | 桌面补 `getObjectToFile`（或 Range 直写），`bodyCache` 批内生命周期，`buildAndUploadAll` 分批 flush | 无（端口已有可选 `getToFile`） | `perfPipeline` 并发峰值断言 + 新增「首拉驻留字节上界」单测（fake device 统计） |
| **P2 账本收敛** | 删 `sync_base/declared_assets/published_at` 与 legacy 决策函数；`archived` 实现或删；三套 cloud-deleted 标记合一 | P0 的 ②③ | `tsc --noEmit` 0 + 同步层 201 例全绿 + `mobileCloudDeleted`/`remParity`/`markerPersist` 回归 |
| **P3 双端语义下沉** | 15 条语义抽成 core 模板（`applyPlan`）+ 端只留 8 个原语；conformance 扩到 10 场景（含锁、恢复、purge、全量重拉、deferAssets） | P2 | conformance 双端 + 混合并发用例；移动端 `lockedAt` 补齐并传播 |
| **P4 性能与索引** | 空跑零写短路；baseline 单次加载；再评估 v3.1 按篇增量索引（**只在 5 万文档量级有证据时**） | P1 | `perf.integration` 改比值断言（500/2000）+ 2 万 `perf.big`（修好后手动跑）归档数字 |
| **P5 文档收口** | 新 `SYNC-PROTOCOL.md`（v3 唯一协议）+ 删过程文档 + `STORAGE-LAYERS` 重写 §4/§5 | P2/P3 落地后才写，避免再漂 | 无代码门禁；以「新协议文档 ↔ 代码符号」逐节对照 |

> 顺序理由：P0 是**不可恢复数据删除**；P1 是 OOM/首拉体验；P2/P3 是把「补丁账本」换成「可推导状态」的前置；P4 最后做，因为只有在 P2 收敛后性能优化才有稳定基线（否则测到的是补丁开销）。

---

## 5. 度量与复测方法

| 指标 | 现状（本机 21:33–21:41，HEAD 41def9f0，本范围无在途改动） | 复测方法 |
|---|---|---|
| 同步层测试规模 | 39 files passed / 8 skipped / **201 tests / 59.19s** | `npx vitest run electron/s3v3 src/core/s3v3Core.test.ts src/core/s3v3Protocol.test.ts src/mobile/v3 src/mobile/sync` |
| 门禁内 benchmark 成本 | `perf.integration` 45.6s（套内）/ 68.1s（单跑） | 单跑 `npx vitest run electron/s3v3/perf.integration.test.ts` |
| 空跑轮 | 500/2000/5000 = 114 / 151–199 / 215–217ms；`load-state` 81–149ms、`pending`(saveState+saveBaseline) 26–78ms | `S3V3_PERF_SIZES=500,2000,5000 npx vitest run electron/s3v3/perf.integration.test.ts`，读 `PERF` 日志 |
| 改 10 篇 | 500/2000/5000 = 296 / 259–336 / 402–405ms | 同上 |
| 首传 | 500/2000/5000 = 502 / 863–2726 / 1,559–2,174ms（方差 3.2×） | 同上 |
| 2 万文档 | **无当前可执行基准**（`perf.big` 坏，SD-12） | 修后 `S3V3_PERF_BIG=1 S3V3_PERF_BIG_DOCS=20000 npx vitest run electron/s3v3/perf.big.integration.test.ts` |
| 并发容量 | 12 端 ~5.4–5.7s/0 错；20 端 ~8.1–8.6s/0–2 错；28 端 ~10.6–11.4s/2–7 错 | `npx vitest run electron/s3v3/concurrency.integration.test.ts`（读 `CONC-CAP`） |
| 数据安全回归 | **缺** | **新增** `pullAllSafety.test.ts`：构造「本地独有 + 无 baseline」，断言不物理删、历史保留、有二次确认路径 |
| 双端漂移回归 | conformance 4 类 | 扩到「锁/恢复/purge/全量重拉/deferAssets/声明保留」6 类，desktop + mobile 都跑 |
| 账本一致性 | 无指标 | 新增诊断：`baseline.commit vs pointer`、`intents/pending/remotePurged/purged` 计数、`is_dirty 计数 + published_at NULL 计数`，落 `device_state` 并在设置页可见 |

**判据（改好了没有）**

1. 删除 `baseline.json.gz` 后一轮同步，本地独有文档仍可打开（软删/备份区），历史快照数不减。
2. 空跑轮在 2,000 文档下 < 80ms 且 **0 次 baseline 写**。
3. `perf.integration` 改成比值断言后，2× 退化能让门禁变红。
4. conformance 10 场景双端全绿且移动端 `lockedAt` 非空传播。
5. `grep sync_base|declared_assets|published_at` 在生产代码里只剩 0 处（或被明确的一处 v3 记账替代）。

---

## 6. 第一性原理重写素材（交 lead 汇总；完整设计见 `06-redesign.md`）

### 6.1 必须保留（不是设计选择，是产品语义）

1. **删除 = 缺席**：不引入墓碑/链；回收站条目是索引里的正常条目（`trashedAt`）。
2. **恢复是唯一显式例外**：`restorePending` → local-wins，成功发布后必须清标记（否则墓碑永胜/每轮重传）。
3. **先提交者胜 + 本地强制留档**：远端已发布版本胜，本地被覆盖版本先写历史（`archiveBody`/`archiveQuickNote`）。
4. **资产存在性 = 声明差集**：禁逐对象 HEAD/GET、禁「本机记过 = 已上传」的持久缓存、声明永远全量（AGENTS §3#11）。
5. **内容寻址 + 幂等写**：`objects/{id}-{hash}.lake`、`meta/assets/{id}/{declHash}.json`、`meta/index/{hash}.json`；重复 PUT 无害。
6. **指针最后写 + 读回 + 有限重试**（无 CAS provider 下的唯一正确性防线，`S3-REDESIGN` §6.2/§6.6）。
7. **设备基线不上云**；删除意图持久化，清除条件唯一（更高 generation 且索引不含该 id）。
8. **删除执行门禁**：仍被引用/无法确认 ⇒ 不删（`gatePendingDelete` 的保守分支）。
9. **本地是真相**：任何「云端赢」的操作**不得**静默删除本地数据（§15.1，当前实现违背 —— SD-01）。
10. **两端协议面等价**：端口可选能力必须显式降级（`getToFile/putFromFile/getRange/listAssetStats`…），用能力矩阵测试锁住。

### 6.2 应当消灭的概念（v3 的补丁遗产）

| 概念 | 现状证据 | 替代 |
|---|---|---|
| `sync_base` / `declared_assets` / `published_at` 三张表/列账本 | §3 清单 5/6 | 从 (本地, 基线, 远端) 推导，或并入唯一 ledger |
| `DeviceState` 的 9 本数组 | `s3v3DeviceStore.ts:19-43` | 1 本「意图日志」+ 1 个 baseline commit |
| 双 map（`local` + `index`）`WorkingSet` | `s3v3Engine.ts:195-209`（已收敛为 WorkingSet，但 `lakeLocal/stateNotes/quickState` 仍有 3 个派生副本 L806/1189-1199） | 单一 `World`，索引由 `toIndex()` 派生 |
| `bodyCache` / `uploadOps` 无界聚合 | SD-02 | 传输流水线自带背压，plan 只给引用不携带字节 |
| `pendingAssets` 账本 | `s3v3Engine.ts:1730-1767` | 每轮按声明差集重算（幂等） |
| `deferAssets` 作为「开关 + 分支」 | `pullAll` 里 3 处 `if (!deferAssets)`（L661/675） | 作为 **plan policy**：首拉 plan 不列资产 op，打开时再 plan 一次 |
| `archived` 空壳 / `resetFromCloud` 死入口 | SD-01/SD-03 | 一等公民的「云端赢/本地赢」+ 备份区 |
| `purged` id 数组（无界） | SD-09 | 带时间或推导 |
| 27 份假 remote 夹具 | SD-12 | 一份 `test/fakes` |

### 6.3 目标架构提纲（与 06 对齐，只列判断）

- **分层**：`Protocol`（keys/index/declaration/pointer 编解码 + 校验）→ `Reconciler`（`plan = f(local, base, remote, intents)` 纯函数）→ `Applier`（plan → 端事务，幂等）→ `Publisher`（index → pointer，锁/读回/重试）→ `Transfer`（对象级流水线，有背压、可流式）。
- **端口**（端只实现 IO）：`readWorld()`（元数据 + hash 清单）/ `applyPlan(plan)`（事务）/ `bodyIO` / `assetIO` / `ledger`（baseline + intents 原子写）/ `remote`（get/put/list/delete/流式）。
- **状态机**：`classify(pointer, baseline) → NoBaseline | Empty | Ok | EpochMismatch | Rollback | Fork`，**每个非 Ok 状态都要有 UI 可达的 action**（当前 6 个里 4 个没有）。
- **幂等提交**：commit = `(epoch, generation, lakeIndexHash, quickIndexHash)`；Applier 以 commit 为幂等键，重放无副作用；清理与发布分离（SD-05）。
- **性能模型**：稳态轮 **O(changed)**（dirty 集 + commit 相等短路），首拉 O(bytes) 但内存 **O(并发 × 单对象)**；索引体积 O(条目)，5 万以上才考虑按篇增量索引（v3.1，**需实测证据再立项**，勿提前做）。
- **验收**：① 数据安全（无 baseline 不删本地）；② 稳态零写（空跑 0 UPDATE / 0 PUT）；③ 双端 conformance 10 场景；④ 2 万文档基准可执行且进门禁（比值断言）；⑤ 诊断可导出（plan + 报告 + 账本计数）。

---

### 附：本轮证据来源

- **读码**：`src/core/s3v3*.ts`（15 文件）、`electron/s3v3/*.ts`（10）、`src/mobile/v3/*`、`src/mobile/sync/*`、`src/mobile/bridge/sync.ts`、`electron/{store,quickNotes,trashLifecycle,schemaInit,syncReconciliation,syncAdapters}.ts`、`src/mobile/data/schema.ts`、`docs/{SYNC-PROTOCOL,S3-GC-DESIGN,STORAGE-LAYERS,S3-REDESIGN,S3-V3-*}.md`。
- **命令**：`wc -l` / `find -name '*.test.ts'` / `grep -rn`（import 与调用方）/ `npx vitest run`（同步层 39 文件；`perf.integration` 单跑）。
- **未执行**：任何写操作、构建、Electron、gradle、`npm install`；未触碰正式数据目录（`~/Library/Application Support/lakex-local-notes*`）。
---

## 修复状态（261028，见 `08-ab-execution.md`）

> 261028 晚复核：状态以工作树代码为准；SD-03 补「261028 晚恢复入口」，SD-06 指向 `docs/SYNC-DEVICE-CONTRACT.md` §5 的逐条对账。
> 采样 = 2026-10-28 21:15–21:30（Asia/Shanghai）；完整对账见 `13-audit-status.md` §1。

| 条目 | 状态 | 证据（文件 : 符号）与残余 |
|---|---|---|
| **SD-01（P0）** | ✅ 已修（261028 细化） | 全量重拉时「本机有、云上没有」复用远端 purge 语义：软删进回收站 + cloud_deleted 标，正文/历史保留、不上传；显式恢复后重传。`electron/s3v3/pullAllSafety.test.ts` 锁行为（含恢复后重传）；`08` §10-4 |
| SD-02 | ✅ 已修（第五轮保守版） | `bodyCache` 批内生命周期 + 512 条/32MiB FIFO + 轮末/drop 清理；上传分批 flush；峰值测试（首拉 100 条后 0 驻留）。v4 §59 已删旧 bodyCache/assetTasks 字段 |
| SD-03 | ✅ 已修（最小版 **+ 261028 晚恢复入口**） | 「可云恢复」判据改用 v3 事实（`markRemoteNoteIds`）；**261028 晚补齐两个入口**：桌面 `epoch-mismatch` ⇒ 「云端是另一套数据」+ 直达 设置→同步→「从云端恢复」按钮（`12` §7.2）；移动 `syncDomain.restoreFromCloud` + 设置页入口（`12` §7.3）。残余：空基线+非空云端按用户裁决保持默认逻辑（`12` §5-3） |
| SD-04 | ✅ 已修 | 成功同步后批量 `markTombstonesPublished` |
| SD-05 | ✅ 已修 | 清理/待删执行失败降级 warning，不再把已成功的提交报成失败 |
| SD-06 | ✅ 保守版（第十轮 contract + **本轮 8 条对账**） | `docs/SYNC-DEVICE-CONTRACT.md`（端口矩阵 + 双端差异表 + conformance 10 场景）；`08` §59 v4 四相内核成为唯一同步实现（决策/编排不再两写）。**残余漂移逐条判定写在该文件 §5 的「261028 对账」列**：仍漂移 1（编辑锁 `lockedAt`）/ 有意保留 4 / 已对齐 3。彻底统一 = v4 E4 单实现 |
| SD-07 | ◐ 部分（第四轮保守版） | 零变更判据（pointer==baseline + 标记无变化）跳过 `saveBaseline`；**state 仍每轮全量落盘**（标记清理依赖），且桌面 `desktopStoreAdapter.loadState` 内部再调 `loadBaseline`（L141）= baseline 二次加载仍在 |
| SD-08 | ✅ 已修（第八轮） | 门禁只留 12 端硬断言 0 错、删 `retry:2`；20/28 端改手动 `s3v3-manual-capacity.mjs`；并发发布锁不再当失败（`publishLockWaitMs` 10s + `lock-busy` 20s 抖动退避，`12` §7.1） |
| SD-09 | ✅ 已修（第七轮） | 90 天窗口 `pruneQuickPurgedIds`；接收端首次见墓碑补记时间（防无限复活）；新增窗口测试 |
| SD-10 | ✅ 已修（第四轮） | 删 `validParents`（O(N) 构造）、未用 intent 导出、空语句 |
| SD-11 | ✅ 已修（261029） | `SYNC-PROTOCOL.md` 重写为 v3 唯一协议 + 模块对照表；**18 份过程文档已物理删除**（Del-9）：S3-V3-* 15 份 + S3-MANIFEST-SCALE-RESEARCH + S3-GC-DESIGN + S3-REDESIGN；删前全仓 grep，23 处引用改指 SYNC-PROTOCOL 或注明「过程文档已删，git 可查」；`docs/*.md` 51→33 |
| SD-12 | ✅ 已修（第八轮） | perf 默认 500/2000 + 基线 3.5× 上界/比值（`S3V3_PERF_STRICT` 收紧 1.8×）；5000/20000 移手动脚本；`perf.big` 改用 `is_dirty` 列；全量 vitest 由 ~47s 降到 ~24s（定向 perf 门禁 9s） |
| SD-13 | ✅ 已修（第七轮） | `core/s3v3Report` 环形最近 3 轮（阶段耗时/对象/字节/失败/warnings）落 `device_state.sync_v3_reports`，两端设置页「同步诊断」一键复制（复用 get_sync_status，无新 IPC） |
| SD-06 剩余漂移（移动 lockedAt/deleteMany/deferAssets 默认/gzip 元信息/状态读取/回收站父） | 记录待 v4 | 见 SYNC-DEVICE-CONTRACT §4 |