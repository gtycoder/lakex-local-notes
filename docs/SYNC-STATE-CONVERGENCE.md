# SYNC-STATE-CONVERGENCE.md — E3-1 / E2-4 / Del-6 执行设计（261029）

> 目标：把「本地同步状态」从 9 本账收敛为 1 本意图日志（E3-1），删掉 manifest 时代死账本（Del-6），再把双端各写一遍的 DeviceStore 收敛为一份实现（E2-4/E4）。
> **不改 wire 协议**：pointer / 不可变索引 / 每篇资产声明 / 内容寻址对象布局全部不变（协议仍 v3，内核 v4）。
> 裁决前提：账本收敛**断代、不双写**（用户 261028）；旧客户端读不了新本地 state，靠最低版本门/升级提示。

## 0.1 执行状态（261029 更新）

| 阶段 | 状态 | 证据 |
|---|---|---|
| Del-6 sync_base | ✅ 已删 | 桌面+移动 schema/读写/测试全清；「可云恢复」判据 = remoteNoteIds（v3 事实）；诊断改读 v3 baseline；拉回正文不再 setBaseHash |
| Del-6 declared_assets | ✅ 已删 | 桌面已删（261029 早批）+ 移动死 DDL 删除 |
| Del-6 published_at | ✅ 已删（261029，task-22） | 逐行 published_at → **单一水线**（device_state）：`tombstones_published_at`（Lake 库）/ `quick_tombstones_published_at`（小记库新建同形 device_state 表）；pending 判据 = `deleted_at > 水线`；首次升级水线 = `COALESCE(MAX(published_at),'0')` 后 DROP COLUMN；desktopSync 成功后写水线（替代 markTombstonesPublished）；**移动 schema v10 也已删列**（deleted_notes.published_at + markTombstonesPublished/桥方法/契约面同步移除，MOBILE_SCHEMA_VERSION=10 含 DROP COLUMN 迁移） |
| E3-1 phase1 | ✅ 完成 | src/core/s3v3/state/intentLogState.ts（v2 信封 + 单向迁移）；桌面/移动适配器 save 只写信封、load 摊回；引擎读写未改；11 个新用例 |
| E3-1 phase2a | ✅ 完成（261029） | **持久化收敛到 1 本类型化 IntentLog（v3 records）**：toPersistedState 摊平 9 字段 → records、fromPersistedState 投影回 DeviceState（引擎 0 改动）；v1/v2 单向迁移、未知 kind 丢弃+warning、断代门只读 v3；baseline 不信封化；桌面/移动适配器接线；13 例迁移/round-trip 测试 |
| E3-1 phase2b | ⛔ 复核后**不做**（261029） | 原本要做「引擎直接消费 records + 物理删 DeviceState 8 个旧字段」；实测成本/收益复核后判为**不做**（净收益≈0、风险最大项），证据见 §1.3c。**其价值残项已做**：cloud-deleted 失效判据单点 `state/cloudDeleted.ts` + 账本⇄records 穷尽性 tsc 护栏（§1.3c 末） |
| E2-4/E4 phase A | ✅ 完成（261029） | 共享 `FileDriver` + `createFileBackedAssetIo`（9 个资产 IO 方法，含 SEC-13a 白名单/tmp 过滤/延迟删目录钩子）+ `mergeSyncMarkers`；桌面 8 个资产方法薄壳化（−50 行）；顺带修 persistSyncMarkers 信封化丢标记 bug |
| E2-4/E4 phase B | ✅ 完成（261029） | 冻结 PlatformDataPort（28 方法）；core `createDeviceStoreMeta` 收 loadState/saveState/saveFolders/saveQuickNotes 编排；桌面薄壳 515→187 行（对拍 455 passed 前后一致）；移动资产 IO 接共享实现（capacitorAssetFileDriver，8 方法委托）；桌面真实 S3 冒烟：首传 ↑1 / 1.82s、零变更 1.69s、改 1 篇 ↑1 / 672ms |

| E2-4/E4 phase C-1 | ✅ 完成（261029） | 移动读端口 28 方法（notes/folders/quick/tags/deleted_notes）+ createMobileBodyFileDriver（kind 感知伪路径 + stat 缓存）；写侧 22 方法显式 phase C-2 占位；core 行字段承载移动差异（cloudDeleted/assetsHash/listQuickPurges 独立端口/标签 order 兼容，无 if(platform)）；移动 loadState 切 meta.loadState()，删除旧 ~110 行；conformance.mobile 21 例全绿 |
| E2-4/E4 phase C-2a | ✅ 完成（261029） | PlatformDataPort 3 钩子（begin/flushWriteBatch、moveStagedBodyFiles、applyCloudDeletedProjection，全部可选，桌面不实现=旧逐行语义）+ staged 正文契约（importRemoteNote(content=null,{staged})/applyStagedBodyNote/stagedBodies.has）；桌面不变对拍 61 文件/459 passed |
| E2-4/E4 phase C-3a | ✅ 完成（261029） | 第 4 处漂移下沉 core：saveQuickNotes quick-missing 三态（purge / cloud-delete（cloudDeleted 或 baseline 曾发布）/ physical-delete（从未同步 + 平台实现 discardQuickNote））；桌面不实现 discardQuickNote ⇒ 回落软删 = 迁移前行为（无 if(platform)）；端口仅 +QuickNoteSyncRow.deletedAt + 可选 discardQuickNote；桌面回归 61 文件/459 不变 |
| E2-4/E4 phase C-3b-1 | ✅ 完成（261029） | 第 5 处漂移：core deleteNote 被两处复用（桌面都软删；移动「远端墓碑→回收站」vs「state 缺失→写墓碑+删行/正文」）⇒ 新增可选 purgeLocalNote 端口（收敛删除分支优先用它，否则回落 deleteNote；桌面不实现=语义不变）；移动端口已实现。桌面 61/459 不变，合并 89/575 |
| E2-4/E4 phase C-3b-2 | ✅ 完成（261029） | 移动 26 写方法 + 3 钩子（批窗口 executeSet / staging move / cloud_deleted 投影事务）；mobileDeviceStore 698→398 行、旧 saveState ~280 行删除，saveState 委托 meta.saveState()；A/B：2000 篇首拉 49.0→36.8ms、增量 18.1→19.8ms、SQL 2011→2013、原生 executeSet 均 1 次；conformance.mobile 21/21、mobileCloudDeleted/remParity/historySnapshot 全绿 |
| E2-4/E4 phase C-3c | ✅ 完成（261029） | conformance 从双端对拍改单实现契约（defineDeviceContract）；单跑 21 it + mixed 3 it；删 desktop 双跑与 __baselineOldStore；契约文档改「共享实现+端口差异」矩阵 |
| E2-4/E4 收尾 | ✅ 完成（261029） | 移动端口补齐 locked_at（listNotesSyncMeta 读/applyRemoteEditLock+importRemoteNote 写）；conformance 场景 5 改断言「纯锁变更按 locked_at LWW 传播、两端时间戳一致」；唯一剩余缺口关闭 |

## 0. 版本口径

| 层 | 版本 | 变更 |
|---|---|---|
| wire / pointer 协议 | v3（`S3V3_POINTER_VERSION=3`） | **不变** |
| 同步内核（编排） | v4（plan→apply→commit→finalize） | 已切换，唯一实现 |
| 本地持久化 state | v1（现 DeviceState 9 字段）→ **v2 信封** | 本设计；断代 |

## 1. E3-1 账本收敛

### 1.1 现状（9 个可选账本，`src/core/s3v3DeviceStore.ts: DeviceState`）

| 字段 | 语义 | 归属 |
|---|---|---|
| `intents` | 本地删除意图（删除=缺席的跨轮记忆） | 意图 |
| `pending` | 提交后待执行的远端对象删除队列 | 意图的执行阶段 |
| `remotePurged` | 远端已删、本地保留副本（「云端已删除·仅本地」） | 云端事实投影 |
| `restorePending` | 显式恢复标记（唯一提前例外） | 意图 |
| `quickDeletes` | 小记软删/墓碑 | 意图 |
| `quickPurges` / `quickPurgeTimes` | 小记不可恢复删除 + 时间 | 意图 + 时间 |
| `bodyRecoveryPending` | 缺正文恢复事件队列 | 事件队列 |
| `pendingAssets` | 附件失败重试队列 | 事件队列 |

### 1.2 phase1（本批）：**持久化只留一份信封（version 2）**

- 新增 `src/core/s3v3/state/intentLogState.ts`：
  - `DEVICE_STATE_VERSION = 2`；
  - `IntentLogStateV2 = { version: 2, intents, pending, quick: { deletes, purges, purgeTimes }, restore: { pending }, cloudDeleted: { ids }, recovery: { bodyPending, assetRetries } }`；
  - `toPersistedState(DeviceState) → IntentLogStateV2`、`fromPersistedState(raw) → { state: 非索引字段, migrated }`、`migratePersisted(raw)`。
- 适配器（桌面 `desktopStoreAdapter`、移动 `mobileDeviceStore`）`saveState` 只写信封；`loadState` 还原完整 `DeviceState`；**baseline 不动**（同轮另一文件/表）。
- **引擎对 DeviceState 字段的读写一行不改**：phase1 是「持久化形状」收敛，不改变行为。
- 旧格式（无 `version` 的 DeviceState JSON）加载时逐字段搬进信封并报 `migrated`；未知/损坏 → null（由适配器决定重建/报错）。
- 旧客户端读到 v2 信封会字段缺失 ⇒ 必须由发布门禁保证「同版本」：本地 state 写入时记录 `version`，旧端启动/同步失败时提示升级（断代成本，已接受）。

### 1.3 phase2（后续）：真正 1 本意图日志 + 推导

- 把 `cloudDeleted`（remotePurged）改为由 `baseline.lake` 与本地索引差集推导（不再是持久账本，只在 UI 需要时计算/缓存）；
- `pending`/`bodyRecoveryPending`/`pendingAssets` 改为「plan 的输入/输出」：失败即下一轮同一 transfer 的幂等重试，不再跨轮记队列；
- `quickDeletes/quickPurges` 收入 `intents`（带 kind/space/时间）；
- 引擎删除对旧字段的写入，`engineBridge` 只做推导映射；
- 旧字段物理删除（`DeviceState` 只留 `lake/quickNotes/folders + intentLog`），断代门已就位。


### 1.3b phase2 具体设计（261029 补充，待 C-3b/c 完成后实施）

**形态**：持久化只留 `IntentLogStateV3 { version:3, records: IntentRecord[], assets, hashCache }`，`records` 是**一条类型化日志**（取代 9 个数组）：

| kind | 语义 | 由谁写 | 加载时投影到 |
|---|---|---|---|
| delete | 删除意图（noteId,targetEpoch,targetGeneration） | 引擎 settle 前 | state.intents |
| restore | 显式恢复标记 | 用户恢复 | state.restorePending |
| quick-delete | 小记软删/墓碑 | plan/engine | state.quickDeletes |
| quick-purge | 小记不可恢复删除 + at | plan/engine | state.quickPurges/quickPurgeTimes |
| cloud-deleted | 远端已删、本地保留副本（事实） | 引擎 pull/finalize | state.remotePurged |
| pending-delete | 提交后待删远端对象 keys | commit 阶段 | state.pending |
| body-recovery | 缺正文恢复事件队列 | 打开/体检 | state.bodyRecoveryPending |
| asset-retry | 附件失败重试条目 | applyAssets 失败 | state.pendingAssets |

**兼容**：phase2a 只改「适配器 ↔ 磁盘」——load 把 records 投影回现有 DeviceState 字段（引擎一行不改）；save 把字段摊平成 records。phase2b（引擎直接消费 records + 删旧字段）**261029 复核后不做**，理由与替代见 §1.3c。

**断代门**：version 3；v2 信封加载时单向迁移（9 数组 → records）；旧客户端读不了 v3。未知 kind 记录丢弃并记 warning（不崩）。

**测试**：每种 kind 的 round-trip/排序/时间戳；v2→v3 迁移逐字段等价；未知 kind/损坏输入；断代门。

### 1.3c phase2b 成本/收益复核（261029 裁决：**不做**）

结论：**全量 phase2b 不做**（按 AGENTS §3#17：收益只停在「代码更整洁」⇒ 不做）。实测证据：

| 维度 | 实测（261029） |
|---|---|
| 改动面 | 9 本账在**非测试代码** 188 处引用 / 17 个文件（`src/core/s3v3/**`、`s3v3Engine.ts`、两端适配器、`electron/store.ts`、`electron/quickNotes.ts`、移动 `data/schema.ts` + `v3StateRepository`） |
| 账本不是纯持久化形状 | 9 本里 **6 本每次 loadState 都由 DB 行重新推导**：`listQuickDeleted`、`listQuickPurges`、`listRestorePendingNoteIds/QuickNoteIds`、`listPurgedTombstones`、`cloud_deleted` 列、`listBodyRecoveryPending`。这些端口读**无论如何都得留**，phase2b 只换内存载体 |
| 写侧不减 | `saveState` 仍要写 DB 投影（`cloud_deleted` / `restore_pending_at` / `deleted_notes`）**加**信封两份，phase2b 一处都删不掉 |
| 引擎侧已隔离 | 字段级映射已全在 `engineBridge.ts`（207 行纯函数：planWorldOf/planStateOf/intentLogOf/mergeRoundIntoState/finalizeRemotePurged），本来只有一处；phase2b 只把「数组 → 记录数组」换形状 ⇒ LOC 中性偏负 |
| 风险 | 动的是同步正确性热路径；9 本账各有独立生命周期（墓碑/恢复/待删/重试），收敛成一条 records 需新增分组/索引 helper，回归面 = 全量 conformance + 引擎定向 + 双端设备 |

⇒ 净收益 ≈ 0、风险与工程量最大的一步，**结案不做**（不是「以后再做」）。

**保留的残项（本次已做，价值在判据而不在形状）**：
1. **「云端已删除·仅本地」失效判据单点**：新增 `src/core/s3v3/state/cloudDeleted.ts` 的 `settleCloudDeleted`
   （三态 = 显式恢复 / 远端同 id 再现 / 本地已彻底删除）。此前**引擎** `finalizeRemotePurged` 与**适配器投影**
   `createDeviceStoreMeta.loadState`（移动 DB `cloud_deleted` 兜底）各写一份，注释里写着「与引擎同口径」——
   引擎加第 4 种原因而适配器没跟上 = 徽标永久挂死 + 每轮空转。现两层同调一函数（引擎传 `remotelyPresent`、
   适配器传 `locallyPurged`）；测试：`cloudDeleted.test.ts` 7 例 + `engineBridge.test.ts`（顺序保持 / 无变化返回同一对象）
   + `deviceStoreMeta.test.ts`（DB 投影与信封标记合并后失效）。
2. **账本⇄records 穷尽性护栏**：`intentLogState.test.ts` 以 `{[K in keyof Required<DeviceLedger>]: …}` 声明每个账本的
   非空样本并逐个 save→load 往返 ⇒ 之后新增/改名 DeviceState 账本字段却没接线，**tsc 直接失败**（自证：临时加
   `__probeLedger` ⇒ `TS2741 Property '__probeLedger' is missing`，随后还原）。顺带修一处不对称：`toPersistedState`
   的 quick-purge 改 **purges ∪ purgeTimes** 并集（与 v2→v3 迁移同口径），否则「只有时间表」的旧信封 / 引擎剪枝残留
   会在下一轮 save 静默丢时间戳。

**Del-6 published_at 已替换（261029，task-22，不依赖 phase2b）**：不再需要逐行账本 ——
- **单一水线**：`device_state.tombstones_published_at`（Lake 库）+ `device_state.quick_tombstones_published_at`
  （小记库新建同形 device_state 表，桌面两库各自持有；键名即「上次成功同步完成时间」）；
- **判据**：`待同步墓碑 = deleted_at > 水线`（`getSyncPendingSummary` / `pendingSignature` /
  `hasLocalPendingNotes` / `QuickNotesStore.getPendingSyncSummary` 四处统一）；
- **写入**：`desktopSync` 成功分支写两个水线（替代旧的逐行 `markTombstonesPublished`）；
- **迁移**：首次升级水线 = `COALESCE(MAX(published_at),'0')`（未发布旧行 deleted_at 晚于它 ⇒ 仍 pending），
  随后 `ALTER TABLE ... DROP COLUMN published_at`（SQLite ≥3.35；Electron 44 / better-sqlite3 13 均满足）；
- **语义保持**：本地 purge 后到下次成功同步前计入待同步、成功后清零；学习型墓碑 deleted_at 是云端旧时间，
  成功轮写水线后自然不计入；墓碑本体永久保留（供 LWW 与防复活）。

### 1.4 迁移规则（v1 → v2，phase1）

| v1 字段 | v2 位置 | 备注 |
|---|---|---|
| `intents` | `intents` | 原样 |
| `pending` | `pending` | 原样 |
| `remotePurged` | `cloudDeleted.ids` | 原样（phase2 改推导） |
| `restorePending` | `restore.pending` | 原样 |
| `quickDeletes` | `quick.deletes` | 原样 |
| `quickPurges` | `quick.purges` | 原样 |
| `quickPurgeTimes` | `quick.purgeTimes` | 原样 |
| `bodyRecoveryPending` | `recovery.bodyPending` | 原样 |
| `pendingAssets` | `recovery.assetRetries` | 原样 |
| `lake/quickNotes/folders` | 仍随 DeviceState 传（信封外） | 索引是每轮真值，不做迁移字段 |

### 1.5 验收

- 单测：旧→新迁移、字段级 round-trip 无损、损坏/未知版本、断代门；
- 两适配器：save→load 等字节/等价；旧 state 文件加载后 migrated=true；
- conformance（两端各 21 it）+ engine 定向测试、`electron/store` 相关测试全绿；
- 全量 vitest + check:core + 设备零变更轮（GET=1）。

## 2. Del-6 死账本

| 账本 | 现状 | 处置 |
|---|---|---|
| `declared_assets` | 桌面已删（261029） | 零残留确认 |
| `sync_base` | 仅 3 处活引用：从云端拉回正文的 `setBaseHash`、`listMissingBodies` 的 legacy OR、diagnostics 的 hash 自查 | ①「可云恢复」只留 `remoteNoteIds`（v3 事实）；②拉回正文不再写 sync_base（不改变合并语义；如需基线一致，更新 v3 baseline 或明确不写）；③diagnostics 改读 v3 baseline/或只查文件存在；④删表 + 方法 + 测试；旧库空表不迁移 |
| `deleted_notes.published_at` / `quick_note_deleted.published_at` | **两端已删（261029）**：桌面 task-22 改单一水线；移动 schema v10 删 `deleted_notes.published_at`（DDL 去掉 + 旧库 DROP COLUMN 迁移）、删 `localStorePort.markTombstonesPublished`/bridge 方法/契约面登记，pending 判据不再逐行记账 | ✅ 完成（桌面 + 移动） |

**验收**：生产代码 grep `sync_base` = 0；两端 `published_at` = 0（桌面 + 移动 schema v10）；旧库打开不崩（迁移测试：
`electron/store.test.ts` 旧 DDL 回填水线 + 删列、`electron/quickNotes.test.ts` 小记库同款）；相关测试绿。

## 3. E2-4 / E4-1/E4-2 单实现 DeviceStore

### 3.1 现状

- 桌面 `electron/s3v3/desktopStoreAdapter.ts`（~481 行）+ 移动 `src/mobile/v3/mobileDeviceStore.ts`（~809 行）实现同一 `S3v3DeviceStore` 端口 30+ 方法；
- `electron/s3v3/deviceConformance.ts`（~496 行）专门对账两端行为；
- 漂移清单见 `docs/SYNC-DEVICE-CONTRACT.md §5`（锁字段、批量删、deferAssets、gzip 元信息、状态读取、回收站父、小记冲突副本、物理删除历史）。

### 3.2 目标布局

```text
src/core/s3v3/state/
  deviceStore.ts      # 唯一实现：DeviceState ↔ 行/文件，30+ 端口方法全部在这里
  schema.ts           # 唯一 schema（表/列/索引）
  ports.ts            # SqlDriver { all/get/run/exec/execBatch/tx } + FileDriver { read/write/remove/list/stat }
electron/s3v3/desktopStoreAdapter.ts  # 只做 better-sqlite3 + fs 驱动装配（~80 行）
src/mobile/v3/mobileDeviceStore.ts    # 只做 Capacitor SQLite + Filesystem 驱动装配（~80 行）
```

- 共享层不 import electron/node；驱动全部异步接口（桌面同步实现用 Promise 包装）；
- 平台差异 **只允许** 走驱动端口：资产原生路径/流式、body staging、缓存生命周期；共享层不得 `if (isMobile)`；
- conformance 从「双端对账」改为「单实现契约测试」（同输入同输出 + 驱动故障注入）。

### 3.2b 现实拆解（261029 现状勘测）

- 桌面适配器的数据源不是裸 SQL，而是既有 `Store`（notes/tree/history 表 + 大量旧列）与 `QuickNotesStore`；移动端是 `noteRepository` / `historyRepository` / `assetFs` / `noteBodies` 等仓库。两边的**元数据 schema 并不相同**（桌面 legacy 列多、移动是独立精简 schema）。
- 因此「一份 schema」如果字面执行，等于先把桌面元数据 schema 迁到移动形状（或反向），风险和收益不成比例，且会触碰 AGENTS 的「不为旧数据写兼容」边界（可重建则重置，但桌面主库不能随手重置）。
- **推荐分阶段**（写入 RFC §3.2 的目标不变，但先得到可验证的单一编排）：
  1. **共享持久化层**（E3-1 phase1，本批）：state/baseline 的信封与迁移只写一份；
  2. **共享编排层**：把 30+ 个 `S3v3DeviceStore` 方法的**决策/映射**收进 `src/core/s3v3/state/deviceStore.ts`，平台侧只实现窄的 `PlatformDataPort`（notes/folders/assets/history/body 的 CRUD，约 20 方法）+ `SqlDriver`；**conformance 改契约测试**；
  3. **schema 统一**（可选/后续）：若收益明确（如桌面启动慢/迁移痛点）再把桌面元数据表迁到统一 schema，否则保留驱动差异并在契约里钉住行为。
- 这样 E2-4 的净收益（少一份 30+ 方法实现、少 496 行对账、行为只有一处）在前两步就能拿到，且每步可独立回滚。

### 3.3 迁移顺序

1. 抽 `SqlDriver`/`FileDriver` + 共享实现（内存驱动单测覆盖 30+ 方法）；
2. 桌面切换（better-sqlite3）：跑 electron s3v3 conformance/engine/store 定向测试 + 真实 S3 冒烟（临时前缀）；
3. 移动切换（Capacitor）：跑 mobile v3/data 定向 + 设备 6 态 + 零变更轮；
4. 旧适配器保留一版（回滚面），grep 零引用后删除；`deviceConformance.ts` 改契约测试；
5. 全量门禁 + 真实双端/混版演练。

### 3.4 风险与回滚

- 风险：移动冷启动/DB 打开成本、原生桥错误语义、body staging、附件原生路径；桌面 better-sqlite3 事务形状；
- 回滚：每端切换是独立一步，旧适配器保留一版；baseline/state 文件格式不变（phase1 已断代），回滚只换代码；
- 不做磁盘双写（用户裁决）；失败点回退到旧适配器，数据不需要迁移。

## 4. 顺序与验证

```
Del-6（小）→ E3-1 phase1（信封+迁移，不动引擎）→ E3-1 phase2（真推导/删字段）→ E2-4 共享实现（桌面→移动→删旧适配器）
```

每步门禁：tsc 0 / check:core 0 / 定向 vitest + 全量（里程碑）/ git diff --check；设备：移动 6 态 + 零变更轮 GET=1；真实 S3：临时前缀首传/空跑/改 10 篇/恢复，结束后清理。
