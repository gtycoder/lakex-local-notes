# SYNC-PROTOCOL.md — 同步协议 v3（唯一现行协议）

> 日期：2026-10-28 ｜ 协议版本：`S3V3_POINTER_VERSION = 3` ｜ 代码基线：`src/core/s3v3*.ts`（纯逻辑）+ `electron/s3v3/*`（桌面）+ `src/mobile/v3/*`（移动）
>
> **版本口径（261029 澄清）**：文件标题里的「v3」是 **wire/pointer 协议版本**（pointer 的 `v=3`、索引/声明/对象布局）；**同步内核是 v4**（四相 `plan → apply → commit → finalize`；编排层现状见 `docs/ARCHITECTURE.md` §3，本文 §13–§15 是它消费的协议面）。v4 的定义就是「**协议不变、只重写编排层**」，因此两者不冲突：不存在「S3 协议 v4」这回事，设备间仍按 v3 wire format 互通。
>
> **本文是同步协议的唯一现行口径**（替代已失效的 Manifest V2 全文）。设计理由与审计处置原在过程文档（`S3-REDESIGN` / `S3-GC-DESIGN` / `S3-MANIFEST-SCALE-RESEARCH` / `S3-V3-*`），**已按 SD-11（Del-9）物理删除**——需要历史时用 git 查，**不要再据此改代码**。
>
> 同理 `docs/audit-261027/`（安全审计 / 核心数据模型补审 / v4 RFC / 浏览器端计划）已于 261112 按用户裁决（Q16）删除；仍生效的结论已收编：内核断代与旧账本重置 → 本文 §15；正文层「打开=只读」与坏正文单一判据、安全/分发面裁决、浏览器端去留 → `docs/RESILIENCE.md` §9–§10。
>
> 每节都标注对应的代码符号；符号与本文冲突时，以代码 + 其护栏测试为准（§19）。

---

## 0. 一句话

云端只有 **一个约 200B 的可变指针** `meta/pointer.json`、**两个不可变索引**、**每篇一份不可变资产声明**，以及内容寻址的正文/附件对象；
没有 manifest 链、没有全局资产清单、没有永久墓碑。**本地是真相，S3 只是镜像**；**删除 = 云端索引里缺席**；**恢复是唯一显式例外**。

## 1. 不变量（改动前先读）

| # | 不变量 | 落点 |
|---|---|---|
| I0 | **云端胜出不得删除本地**：收敛只允许「应用远端 + 本地进回收站/留历史」，物理删除只由用户显式 purge 触发 | `pullAll`（`s3v3Engine.ts`） |
| I1 | **网络往返不得持有写域**：同步/GC/深度清理共用同一维护串行队列，但不得在同域嵌套 | `electron/main.ts · enqueueMaintenance`、`src/core/maintenancePolicy.ts` |
| I2 | 跨网络窗口的「读 → 标记/应用」必须靠「未变才标」守卫（内容 hash/updatedAt），不靠全局互斥 | 引擎各 apply 分支 + 适配器 `markQuickNoteSynced` |
| I3 | 删除=缺席：本地基线有条目、远端索引没有 ⇒ 视为他端已彻底删除（进回收站 + 只读副本） | `decideItem` / `planLakeMerge` |
| I4 | 恢复=唯一显式例外：`restorePending` 命中即 local-wins，上传 active 覆盖缺席 | `decideItem` 第 1 步 |
| I5 | 资产存在性 = **远端声明差集**；禁止逐对象 HEAD/GET 探活、禁止「本机记过=已上传」持久缓存 | `s3v3Index · buildAssetDeclaration`、引擎 `scheduleAssets` |
| I6 | 元数据对象才 gzip（按 key 判定，不按魔数）；正文/附件永不压缩 | `s3v3Keys · isGzipMetadataKey` |
| I7 | 设备基线（`baseline`）**绝不上传云端**：它只是本机「上次成功同步后的世界」 | `S3v3DeviceStore.saveBaseline` |

### 1.1 模块 ↔ 文档节对照（`src/core/s3v3*.ts`）

| 模块 | 主要符号 | 本文节 |
|---|---|---|
| `s3v3Keys.ts` | `S3V3_POINTER_KEY` / `indexKey` / `declarationKey` / `lakeBodyKey` / `assetKey` / `quickNoteBodyKey` / `quickNoteAssetKey` / `lakePurgePrefixes` / `quickNotePurgePrefixes` / `isGzipMetadataKey` / `assertSafeS3Key` / `assertSafeSegment` | §3 |
| `s3v3Types.ts` | `S3V3_POINTER_VERSION` / `S3V3_HASH_RE` / `S3V3_EPOCH_RE` / `S3v3Pointer` / `S3v3Baseline` / `validatePointer` / `CloudState` | §4 |
| `s3v3Pointer.ts` | `classifyCloudState` | §4 |
| `s3v3Index.ts` | `LakeIndex` / `QuickNotesIndex` / `canonicalJson` / `serializeLakeIndex` / `serializeQuickNotesIndex` / `indexHashOf` / `parse*Bytes` / `validate*` / `buildAssetDeclaration` / `serializeDeclaration` / `declarationHashOf` / `pruneQuickPurgedIds` / `S3V3_MAX_*` | §5 / §6 |
| `s3v3Engine.ts` | `S3v3SyncEngine`（`sync` / `pullAll` / `incrementalSync` / `initialUpload` / `pushQuickNote` / `deepCleanup` / `resetFromCloud`）、`S3v3SyncReport` / `S3v3Progress` / `S3v3DeepCleanupResult` / `S3v3SyncError` / `classifyS3v3Error` | §8 / §12 / §14 / §17 |
| `s3v3Merge.ts` | `planLakeMerge` / `planQuickNotesMerge` / `isRemoteDescendant` / `LakeNotePlan` / `QuickNotePlan` | §9 |
| `s3v3Decision.ts` | `decideItem` / `ItemAction` | §9.1 |
| `s3v3Gate.ts` | `gatePendingDelete` / `CurrentWorld` / `PendingDelete` | §13 |
| `s3v3Intent.ts` | `DeletionIntent` / `shouldClearDeletionIntent` | §10.1 |
| `s3v3DeviceStore.ts` | `DeviceState` / `DeviceBaseline` / `S3v3DeviceStore` / `PendingAssetRetry` | §15 |
| `s3v3Ports.ts` | `S3v3Remote` / `S3v3Settings` / `NativeGetStatus` | §16 |
| `s3v3Transfer.ts` / `s3v3Pool.ts` | `runTransferPipeline` / `runPoolSettled` / `runPool` | §8.5 |
| `s3v3AssetBackfill.ts` | `backfillV3Assets` / `AssetBackfillPort` | §8.2 |
| `s3v3Report.ts` | `S3v3DiagnosticReport` / `createS3v3PhaseCollector` / `buildS3v3DiagnosticReport` / `formatS3v3Diagnostics` | §8.6 |

## 2. 协议边界（单写者 + 无 CAS）

1. 单用户个人同步：S3 是本地镜像，本地是真相；镜像侧短暂不一致由下一轮自愈。
2. 发布**没有 If-Match/CAS**：用「发布锁 + 写后静置读回 + pointer 读回校验 + generation 单调」收敛（§12）。
3. 两个设备同时改同一篇：**云端已发布的那个版本胜出**（远端胜），本地被覆盖版本强制写历史快照（文档）或归档进小记回收站（小记，若设备支持），不静默丢。
4. 不支持多人协作/同一文档并发编辑；真要并发编辑必须重新评估 CAS 前提。
5. 「打开文档」不因同步/序列化差异写盘或标脏（见 AGENTS §4 编辑器只读契约）。

---

## 3. 对象布局

前缀由 S3 设置 `prefix` 决定（空 = 桶根）；下表是**相对 key**，单一来源 = `src/core/s3v3/protocol/s3v3Keys.ts`。

| 对象 | key | 可变性 | 说明 |
|---|---|---|---|
| 指针 | `meta/pointer.json` | **可变，无条件覆盖** | 唯一读入口；约 200B |
| Lake 索引 | `meta/index/{commit}.json` | 不可变（内容寻址） | commit = sha256(规范序列化) |
| 小记索引 | `quick-notes/meta/index/{commit}.json` | 不可变 | 同上 |
| Lake 资产声明 | `meta/assets/{noteId}/{declHash}.json` | 不可变 | 每篇一份「该文档云端在用集」全量快照 |
| 小记资产声明 | `quick-notes/meta/assets/{quickNoteId}/{declHash}.json` | 不可变 | 同上（图片元信息） |
| Lake 正文 | `objects/{noteId}-{contentHash}.lake` | 不可变（同 hash 幂等） | 内容寻址 |
| Lake 附件 | `assets/{noteId}/{filename}` | 覆盖写（同名 = 同内容） | filename 不可变；声明侧带 size+sha256 |
| 小记正文 | `quick-notes/objects/{contentHash}.qnote` | 不可变 | 只按 hash（跨小记去重） |
| 小记附件 | `quick-notes/assets/{quickNoteId}/{filename}` | 覆盖写 | 同上 |
| 发布锁 | `meta/lock.json` | 短暂可变 | 见 `s3v3Engine · LOCK_KEY`（本常量在引擎内，不在 keys 模块） |

**删除 = 对象缺席**：彻底删除某篇时会按前缀清 `objects/{id}-`、`assets/{id}/`、`meta/assets/{id}/`（`lakePurgePrefixes`）；
小记再额外按正文 hash 删对象、按 `quickNotePurgePrefixes` 清图片目录。没有墓碑对象。

**旧 manifest 对象**（`manifests/latest.json`、`quick-notes/manifests/latest.json`、commit 链）属于 V2 遗留孤儿：
v3 **不读、不迁移、不删除**。深度清理会把它们当普通不可达对象按保留窗口回收（§14）。

### 3.1 key 安全与 gzip 规则（`s3v3Keys.ts`）

- `assertSafeS3Key`：非空、≤1024、不以 `/` 开头、无 `//`、只允许 `[A-Za-z0-9._/-]`。
- `assertSafeSegment`：id/filename/hash 段不得含 `/`、不得是 `.`/`..`、只允许 `[A-Za-z0-9._-]`。
- **gzip 只用于元数据对象**：`isGzipMetadataKey(rel)` = 以 `meta/` 或 `quick-notes/meta/` 开头。
  传输端口按 **key** 决定解压/压缩，**绝不按「1f8b 魔数」**（P0 事故：恰好以 1f8b 开头的二进制附件会被误当 gzip）。

---

## 4. pointer（`s3v3Types.ts` + `s3v3Pointer.ts`）

```ts
interface S3v3Pointer {
  v: 3;                                   // S3V3_POINTER_VERSION
  epoch: string;                          // UUID（换桶/重置时重开纪元）
  generation: number;                     // 单调递增发布流水号；每次发布 +1
  lake: { commit: string };               // sha256 hex（64）
  quickNotes: { commit: string };
  createdAt: string;
  deviceId?: string;                      // 仅排障，不参与判定
}
```

- 校验：`validatePointer(raw)` 检查 v/epoch(UUID)/generation(安全非负整数)/两个 commit(sha256 hex)/createdAt；不合法 → `pointer-corrupt`。
- 读：`readPointer`（JSON 解析失败也归 `pointer-corrupt`）；**每轮同步第一件事**。
- 云端分类（`classifyCloudState`，判定顺序固定）：
  `no-baseline` → `pointer-corrupt`（无 pointer 但桶里已有 objects/meta/index 对象）/ `empty-cloud` →
  `epoch-mismatch` → `generation-rollback` → 同代不同 commit = `fork` → `ok`。
  - `no-baseline` + pointer：全量拉取建基线；`no-baseline` + 空桶：按 `onEmptyCloud`（`upload` / `stay`；未给则抛 `empty-cloud` 交 UI 询问）。
  - `epoch-mismatch` / `generation-rollback` / `fork`：`classifyS3v3Error` 归 `action-required`（需用户选择云端赢/本地赢；**不得静默全量重拉**）。
  - `pointer-corrupt`：`fatal`。唯一例外 = 无基线时端到端首传竞态：最多重试 `MAX_CLOUD_RACE_RETRIES = 2` 次（等对端写完 pointer）。

## 5. 索引（`s3v3Index.ts`）

### 5.1 `LakeIndex`

```ts
{ v: 3, space: "lake",
  notes: LakeNoteEntry[], folders: LakeFolderEntry[] }
LakeNoteEntry: { id, title, parentId, sortOrder, updatedAt, contentHash,
                 kind?, icon?, isLocked?, lockedAt?, isConflict?,
                 trashedAt?, deletedFromParentId?, assetsHash? }
LakeFolderEntry: { id, title, parentId, sortOrder, nodeType: "notebook"|"group",
                   icon, updatedAt, trashedAt?, deletedFromParentId? }
```

`folders` **必填**（含空数组）；文档/目录都不上传独立元数据对象，元数据只存在索引里。

### 5.2 `QuickNotesIndex`

```ts
{ v: 3, space: "quickNotes",
  items: QuickNoteEntry[],            // id/createdAt/updatedAt/contentHash/assetsHash?/tagIds?/tagsUpdatedAt?
  tags?: QuickNoteTagEntry[],         // 只含 active 标签（id/name/createdAt/updatedAt）：删除 = 缺席，索引不带墓碑
                                      // 硬上限 S3V3_MAX_TAGS=5000；旧索引残留的 deletedAt 读取时按白名单丢弃
  purged?: string[] }                 // 已彻底删除的小记 id（跨端传播「不可恢复删除」）
```

**`purged` 是唯一类墓碑结构，且有保留窗口（SD-09）**：

- 语义：只存 id、不携带正文/图片；表示「不可恢复删除」，与普通缺席（回收站软删）区分。
- 保留窗口 = `S3V3_QUICK_PURGE_RETENTION_DAYS = 90`（与回收站自动过期同口径），由 `pruneQuickPurgedIds(ids, quickPurgeTimes, now)` 裁剪：
  - 有 `purgedAt`（`state.quickPurgeTimes[id]`）且早于窗口 ⇒ 从发布索引与本地账本一起移除；
  - **缺失/非法时间 ⇒ 保守保留**（判不出年龄就不删）；
  - 引擎在每轮增量同步里为「首次见到」的 id（含从他端墓碑收到的）**补记当前时间**（写回 `quickPurgeTimes`），
    否则非 purge 发起端永远没有时间 ⇒ 发起端 90 天后移除墓碑时会被它们重新发布回云端（"保守保留"退化成无限复活）；
  - 删除=缺席语义不变（新设备本来就没有这些内容），窗口只决定「不可恢复删除」跨端传播多久。
- 三个发布点都走同一裁剪：增量轮合并、单条小记推送、初始化上传。见 §10.4。

### 5.3 规范序列化与 commit

- `canonicalJson`：对象 key 排序、`undefined` 字段省略；数组由各序列化函数先排序。
- `serializeLakeIndex` / `serializeQuickNotesIndex`：notes/items/folders/tags 按 id 升序，`purged` 按字典序。
- `indexHashOf(serialized) = sha256(serialized)` = **对象 key 与 pointer.commit 的唯一来源**。
- 读回时 `parseLakeIndexBytes` / `parseQuickNotesIndexBytes` 会重新规范序列化并算 commit；
  与 pointer 不符 ⇒ `index-hash-mismatch`（当前读路径还要求 `parsed.commit === commit`）。

### 5.4 上限与校验

| 项 | 上限/规则 |
|---|---|
| 索引对象 | ≤ 64MiB（`S3V3_MAX_INDEX_BYTES`） |
| Lake 文档条目 | ≤ 100,000（`S3V3_MAX_LAKE_NOTES`；超过后的下一步是按篇增量索引，不分片） |
| 目录条目 | ≤ 10,000 |
| 小记条目 | ≤ 20,000 |
| id | 安全段（同 `assertSafeSegment`），键内唯一 |
| contentHash / assetsHash / declHash | sha256 hex（64） |

## 6. 每篇资产声明（`buildAssetDeclaration` / `validateAssetDeclaration`）

```ts
AssetDeclaration = { assets: AssetDeclEntry[] }
AssetDeclEntry  = { filename, size, hash, mimeType?, width?, height? }   // 小记图片才有 mime/宽高
```

- 声明 = **该文档云端在用集的全量快照**（assets 按 filename 升序，序列化规范），`declHash = sha256(序列化)`，key 用它 ⇒ **不可变**。
- 索引条目的 `assetsHash` 指向声明；缺省 = 无资产。
- **上传侧**（`uploadAssets` / `uploadQuickAssets`）：
  - 本地清单优先用原生 `listAssetStats/listQuickAssetStats`（filename→size/hash，不读字节）；无此能力时读文件算 hash。
  - 远端声明已有的同 filename 直接复用其 size/hash（不读本地字节；依据：附件 filename 内容寻址，见 AGENTS §3#11）。
  - **永远全量**：本地有而远端声明没有的资产要 PUT；本地没有而远端声明有的，只有在「本地目录为空且有远端声明」时保留远端声明并 warn `asset_kept_remote`（绝不在没有本地证据时声明「这篇没附件」，否则下一轮待删会把云端附件全删）。
- **下载侧**（`scheduleAssets` + `flushAssetTasks`）：按声明做差集，本地已持「同名 + 同 size + 同 sha256」就跳过 GET；单对象失败只影响该对象并记入待补账本（§8.5）。
- 声明对象读取有进程内 LRU（`DECL_CACHE_LIMIT = 4096`，跨引擎共享，内容寻址安全）。

## 7. 内容寻址与完整性

| 对象 | 校验 |
|---|---|
| 正文 | key 含 contentHash；读回后 `sha256(bytes) === hash`，不符抛 `body-hash-mismatch` / `quick-body-hash-mismatch` |
| 附件 | 声明里有 size + sha256；下载按两者强校验，不符**不落盘**（宁可缺图，不可写坏） |
| 声明 | `declarationHashOf(decl) === declHash`，不符抛 `declaration-hash-mismatch` |
| 索引 | 重新规范序列化的 sha256 必须等于 pointer.commit |

内容寻址让「同内容重复 PUT」幂等无害：崩溃窗口（对象已写、pointer 未切）不会产生坏状态，下一轮重传/复用即可。

## 8. 同步主流程（`s3v3Engine.sync`）

### 8.1 入口

```
readPointer + loadState + loadBaseline → classifyCloudState
 ├─ no-baseline + pointer   → pullAll（只拉不推，建基线）
 ├─ no-baseline + 空桶      → initialUpload（onEmptyCloud=upload）/ 直接返回（stay）/ 抛 empty-cloud
 └─ 有基线                  → incrementalSync
```

- 整体重试：`MAX_PUBLISH_RETRIES = 6`（`PublishRetry` 指数退避 + 抖动）。
- 每轮结束（成功/异常/重试）都清正文缓存（`clearBodyCache`）。
- 单条小记推送 `pushQuickNote(id)` 是独立轻量路径（§12.3）。

### 8.2 全量拉取 `pullAll`

1. 并行取 lake/quick 两份索引；`archiveLocal` 时把**内容将被他端覆盖**的本地正文先写历史（hash 相同的不读不写）。
2. 收敛「本机有、云上没有」：软删进回收站（Lake 文档设 `trashedAt/deletedFromParentId/parentId=回收站`）+ 记入 `remotePurged`；正文/附件/历史保留、不上传。小记同理由适配器进小记回收站。**绝不物理删除**（I0）。
3. 本地内容复用：状态里的 contentHash 与远端一致 + 原生 stat 存在 ⇒ 不重下；否则批量读本地按 sha256 比对。
4. 正文按 `BODY_CHUNK = 100` 分块下载并**分块 saveState**（文档边下边可打开）；小记正文先下、等图片声明/资源就绪后再落库。
5. 资产：先并发取声明，再按全局流水线只补缺失/损坏字节；`deferAssets=true` 时本轮不搬媒体（打开/预览时由 `backfillV3Assets` 补拉）。
6. `saveBaseline` 写基线（含两份索引全文）。

### 8.3 增量轮 `incrementalSync`

```
retryPendingAssets（上轮失败附件先补）
→ 读远端索引（commit == 基线 commit 时直接用基线里的索引，省一次 GET）
→ resolveRemotePurged（标记失效三态）→ 小记他端恢复判定 → 三方合并（§9）
→ 预取正文/声明（全局有界流水线）→ 逐条应用远端 + 落盘正文 → 资产下载
→ 上传本地变更（正文只在 hash 变时 PUT）→ 计划待删
→ 无变更：只 saveState（标记可能已变），零发布、零锁
→ 有变更：saveState → 发布（§12）→ saveBaseline → 执行待删（§13）
```

- **零变更轮的成本** = 1 次 pointer GET（index 复用基线）+ 本地 state 落盘；不取锁、不写云端。
- 上传失败的笔记**不进本轮新索引**：回退远端旧条目（或移出），下轮重试；避免索引引用未落盘正文/声明。
- 正文只在 `plan.remote.contentHash !== hash` 时 PUT（锁/图标等元数据变更不重传正文）。
- 上传前本地正文缺失：先按远端同条目 contentHash 拉回（校验一致才落盘）；两边都没有 ⇒ warn + 跳过，**绝不上传空正文**。
- **单篇 apply 失败 = warning + continue**（不整轮失败；下一轮重试并汇入 `SyncResult.warnings`），见 §9.7。

### 8.4 初始化上传 `initialUpload`

本地非空、云端为空（用户确认后）：分批上传正文/声明/资产（`BODY_CHUNK` 一批 flush）→ 取锁 → 再确认 pointer 仍不存在 →
写两份索引 → 写 pointer（新 epoch，generation = 1）→ 读回校验 → saveState + saveBaseline。
缺正文的条目跳过初始化索引并 warn；`remotePurged` 的副本不上传；`purged` 按窗口裁剪（§5.2）。

### 8.5 阶段/进度/并发/内存

- `S3v3SyncReport`：`downloadedNotes / uploadedNotes / deletedObjects / published / generation / warnings / warningDetails / supersededNotes`。
- 结构化 warning kinds（定义 `src/core/sharedTypes.ts`，`src/lib/types.ts` re-export）：`remote_incomplete`、`asset_missing`、`local_body_missing`、`local_body_restored`、`asset_kept_remote`、`body_suspicious_external_change`、`asset_invalid_name`。
- `onPhase(phase, ms)` 阶段名（实测发出）：`load-state`、`read-index`、`merge`、`bodies`、`declarations`、`assets`、`apply`、`downloads`、`uploads`、`publish-save-state`、`publish-lock`、`publish-index`、`publish-pointer`、`publish-finalize`、`pending`、`total`（pullAll / initialUpload 另有 `save`、`upload`、`publish`）。
- `onProgress`：阶段 + done/total + bytesDone/bytesTotal（`metadata/bodies/declarations/assets/apply/uploads/finalize`）。
- 并发：上传 `DEFAULT_TRANSFER_CONCURRENCY = 12`（可配，clamp 1..32）、下载 `DEFAULT_DOWNLOAD_CONCURRENCY = 20`（clamp 1..32）；清理/声明并发 ≤8。
- 内存：正文缓存只服务当轮（512 条 / `MAX_DOC_BODY_BYTES` = 32MiB 上限，FIFO；批末/应用后/轮末释放）。
- 大对象：桌面无原生流式 ⇒ `getRange` 按 `largeAssetChunkBytes`（默认 8MB，2–8 片）并发下载后拼接校验；移动端优先原生 `getToFile`。
- 待补资产账本 `pendingAssets`：失败记账、成功销账；每轮开头重试；`attempts > 3` 丢弃、总条数 ≤500。

### 8.6 同步诊断（可观测性，SD-13）

`src/core/s3v3Report.ts`（纯逻辑，两端共用）：一轮同步结束（成功/失败）都构造 `S3v3DiagnosticReport`，含
`at / ok / durationMs / generation / published / uploaded / downloaded / deleted / conflicts / warningCount / warnings[] / phases[] / failed[] / error?`。
`phases` 由 `createS3v3PhaseCollector()` 汇总 `onPhase`（阶段耗时）与 `onProgress`（对象数/字节，多批累加），
`failed` 取结构化 warning 里带 `noteId/filename` 的条目（封顶 20），`formatS3v3Diagnostics()` 生成一键复制的纯文本。

- 落盘：桌面 `device_state.sync_v3_reports`（`Store.recordV3SyncReport` / `listV3SyncReports`，经既有 `get_sync_status` 通道带出，**不新增 IPC**）；
  移动 `device_state` 同键（`src/mobile/sync/syncDiagnosticsStore.ts`，localStorage 仅兜底）。
- 保留：最近 **3 轮**环形（`S3V3_DIAGNOSTIC_KEEP`），不参与同步、不上云。
- 入口：桌面「设置 → 云端与同步 → 同步诊断 → 复制同步诊断」；移动「设置 → 同步设置 → 同步诊断 → 复制同步诊断」。
- 诊断落盘失败绝不影响同步结果（try/catch 包裹）。

## 9. 合并决策（三方 base × local × remote）

纯逻辑：`s3v3Decision.decideItem` + `s3v3Merge.planLakeMerge / planQuickNotesMerge`。
位置字段（`parentId` / `trashedAt` / `deletedFromParentId`）不参与下面的内容判定，走 §9.5 独立三方合并。

### 9.1 单条顺序（文档）

1. `restorePending && 本地有内容` → `restore-upload`（local-wins）。
2. 本地彻底删除意图 + 本地无 + 远端有 → `local-purge-wins`（删除压编辑）。
3. 无基线：只有本地 → upload；只有远端 → download；两边有且 hash 不同 → 远端胜 + 本地留历史。
4. 有基线：本地有远端无 → `remote-purged-move-to-trash`（I3）；本地无远端有 → download（无删除意图 = 按云端恢复）。
5. 两端都在：相对基线只有本地变 → upload；只有远端变 → download；都变 → **远端胜 + 本地留历史**（先提交者胜）。

### 9.2 文档/目录的补充规则

- 元数据（title/sortOrder/icon）：内容一致时按 `updatedAt` 后写胜；**`parentId`/`trashedAt`/`deletedFromParentId` 走 §9.5 独立合并**；锁字段独立按 `lockedAt` 字符串 LWW（锁变更不 bump updatedAt）。
- 环检测（`isRemoteDescendant`）：本地新父在远端树中位于本节点之下 ⇒ 跟随远端断开（避免两端成环）。
- 目录：无独立对象；删除意图 + 远端存在 → local-purge；本地有远端无且「基线存在 + 本地不在回收站 + updatedAt 晚于基线」→ 视为显式恢复重新发布（D4），否则跟随进回收站。
- 父节点非法/缺失由**适配器**回落兜底笔记本（懒建「未分类」），合并层不做父集合闸门。

### 9.3 小记

顺序：本地 purge 意图 → 显式恢复（优先于 purged 墓碑）→ `purgedIds`（本地/远端墓碑）→ 基线/新增 → 本地软删（`quickDeletes`）→ 内容变更（远端胜时归档本地版本，设备不支持则不留副本）。

### 9.4 标签（删除 = 缺席，261105）

- **云端目录只含 active 标签**：删除标签 = 本机物理删行 + 清关联；索引里该 id 直接消失（**没有墓碑可传播**，否则 S3 列表会永久留条目）。
- **三方判定**：① 基线有 / 远端缺席 ⇒ 他端已删除 ⇒ 删本地（**删除压编辑**，本地改名也不上诉）；② 本机待删（`device_state.tag_deleted`，离线删过）⇒ 一律按已删处理，远端重发不复活；③ 其余按 id + `updatedAt` LWW。
- 条目标签关系 `tagIds/tagsUpdatedAt`（集合 + 关系版本）仍按较新一侧胜出；顺序是设备本地视图，不传播。
- 待删集合只在设备本地（不上传）；远端索引确认不含该 id 后结算，同名标签可重建。

### 9.5 位置字段的三方合并（261112）

内容（正文/标题/标签）与**位置**是两个正交维度。位置三件套 = `parentId` / `trashedAt` / `deletedFromParentId`（`undefined` 与 `null` 同义）。
判据单一来源 = `src/core/s3v3/plan/positionMerge.ts`（纯函数；plan 用于合成索引条目，deviceStore 用于决定是否保留本地位置）。

| 本地相对 base | 远端相对 base | 位置赢家 | 效果 |
|---|---|---|---|
| 变了 | 没变 | **本地** | 必须发布本地位置（`indexChanged = true`，**纯移动/纯移入回收站轮也要发布**）；同轮内容赢家是远端时，应用远端内容但位置取本地（不被内容判定回滚） |
| 没变 | 变了 | **远端** | 应用远端位置：写操作 `apply-position`（只改位置三件套，正文与 `contentHash` 不动），或随 `apply-remote` 的 meta 一起应用 |
| 都变了 | 都变了 | `updatedAt` LWW | 条目 `updatedAt` 字符串比较：`local >= remote` 取本地，否则取远端（**相等取本地**，确定性 tie-break） |
| 任一边缺席（无 base / 新增 / 删除） | — | 不判（`same`） | 沿用 §9.1 的内容/缺席判定，不对协议做无根据推断 |

- **与内容判定正交**：内容赢家仍按 §9.1/§9.2。内容赢家是远端（`download` / `remote-wins-history`）时**不得上传本地旧字节**——apply 先下载后上传，本地正文此时已是远端字节，上传必然 `hash-mismatch` 并把索引条目的位置回退成远端（纯移动轮被抹掉）；元数据仍由位置赢家 + `indexChanged` 发布。
- **发布条目按位置赢家组装**：内容取内容判定赢家，位置三件套取位置合并赢家（本地赢/远端赢都投影进发布条目）；这是「纯移动轮 / 回收站轮也能把位置发出去」的关键。
- **回收站也走这条路径**：移入回收站 = 位置三件套变化（§10.3），因此「A 删除、B 编辑正文」不会互相回滚。
- **已知近似（不新增 wire 字段的代价）**：wire 没有独立的位置时间/版本字段，两边都动时复用条目 `updatedAt`（内容时间）做 LWW ⇒
  ① 移动与正文编辑共用同一时间戳，无法独立排序；
  ② 两端在同一毫秒各改位置时「相等取本地」会让本轮各自保留本地一版（无独立时钟，后续某方 `updatedAt` 严格更新才收敛）；
  ③ 若要严格收敛，只能新增位置版本字段（协议变更，另行评审）——**不要**在 `updatedAt` 上打补丁。

### 9.6 同步专用写路径（写路径分层，261112）

**原则**：同步镜像是「内容/字段应用」，不是用户保存。用户语义（回收站/purged 拒写、保存版本守卫、需显式恢复）服务**用户入口**；把这类守卫下沉到两端共用的底层写函数会误伤同步——F04 事故：本地回收站行接收他端正文时被用户守卫拒绝 ⇒ 整轮 `syncNow` 抛错 ⇒ 设备永久卡死。

| 字段/动作 | 用户入口（带用户策略守卫） | 同步专用写（镜像） |
|---|---|---|
| 正文/标题/派生缓存 | `noteContentRepository.save()`：`trashed_at` / `is_purged` 拒写 + `baseHash` 保存版本守卫 | `saveSynced()`：`allowTrashed`（不改 `trashed_at` / `parent_id`），**purged 仍拒** → `Store.saveSyncedNote` → `PlatformDataPort.saveSyncedNote?`（可选端口；缺省 core 回落 `saveNote`） |
| 节点图标 | `noteMetadataRepository.setNodeIcon()`：`assertNodeWritable`（回收站/purged 拒） | `applyRemoteNodeIcon()`：只写 `tree_nodes.icon`；允许回收站行，purged 仍拒；**不动** `updated_at`/`is_dirty`（镜像元数据由 `applyRemoteNoteMeta` 负责） |
| 编辑锁 / 元数据 | 用户入口（锁定/改名/移动）走各自守卫 | `applyRemoteEditLock` / `applyRemoteNoteMeta`（镜像写，不经用户入口） |

- **选择逻辑**：`deviceStore.saveState` 只在「新行导入（`importRemoteNote`）」与「回收站行接收正文（`cur.trashedAt !== null` → `saveSyncedNote`）」分叉；其余仍 `saveNote`。端口 `setNodeIcon` 只被同步 apply 使用 ⇒ 实现走镜像写（桌面 `noteMetadataRepository.applyRemoteNodeIcon`；移动端 `setNodeIcon` 端口只写 `notes.icon`，purged 行已物理删除 ⇒ UPDATE 0 行不抛错）。
- **红线**：面向用户的策略守卫**不得下沉到两端共用的底层写函数**（被 U/S/I/R/M 多方调用的 `save` / `move` / `setNodeIcon` / `saveNote` 一类）。守卫只放在**入口层**或**专用路径**。
- **新增写守卫必须声明调用方分类**：**用户（U）/ 同步（S）/ 导入（I）/ 恢复（R）/ 维护（M）**；在守卫注释与契约里写清哪类允许、哪类拒绝、哪类必须走专用路径。逐条越界审计与 G1–G18 判定见 `docs/audit-261112/13-write-guard-sweep.md` §2（真越界 G1 正文、G3 图标已修；其余 15 处为必要守卫）。

### 9.7 单篇 apply 失败 = warning + continue（261112）

- 落点：`src/core/s3v3/state/deviceStore.ts` 的 `saveState` 逐条应用循环。单篇应用抛错**不再** `throw new Error("saveState 失败(id)")`。
- 行为：记日志 + `onApplyWarning({ code: "remote_incomplete", space: "lake", id, title, detail })` + **继续下一篇**；该篇不标 synced、不推进基线 ⇒ 下一轮重新计划（**可重试的跳过，不是丢数据**）。
- 汇总：适配器队列 `drainApplyWarnings()`（桌面 `DesktopStoreDevice` / 移动 `MobileDeviceStore`）→ 桌面 `syncWithV3` 并入 `SyncResult.warnings`、移动并入 `report.warningDetails`，结构统一为 `{ kind: "remote_incomplete", noteId, title, message: detail }`；UI（状态栏 SyncStatusPopover / 同步诊断）复用既有 warning 展示。
- **边界**：只降级「单篇应用」阶段；批量提交/文件系统整体失败（如 `executeSet`、`rename`）仍在循环外 ⇒ 整轮失败。与 §17「单对象失败不炸整轮」同一口径。
- 结构单一来源：`SyncWarning` / `SyncWarningKind` 在 `src/core/sharedTypes.ts`（`src/lib/types.ts` re-export）；kinds 见 §8.5。

## 10. 删除 = 缺席

### 10.1 本地彻底删除（purge）

- 写**持久删除意图** `intents`（`DeletionIntent`：targetEpoch/targetGeneration/purgedAt?），清本地索引条目/正文/附件。
- 意图清除条件唯一（`shouldClearDeletionIntent`）：显式恢复；或看到**更高 generation** 且该 id 明确不在索引里。发布成功本身不清除（`bumpIntentsAfterPublish` 只把 generation 钉到本轮），防迟到覆盖。
- 删除意图未发布前，本端发布索引时该 id 缺席；旧对象不可达后由 §14 `deepCleanup` 列举差集兜底清理（v4 起不再生成新的待删计划，见 §13）。

### 10.2 他端判定缺席（I3）

- 基线有条目、远端索引没有：`remote-purged-trash` → 本地副本进回收站并记入 `remotePurged`；正文/附件/历史保留，**不参与合并、不上传、不复活**。
- `remotePurged` 失效三态（`resolveRemotePurged`）：显式恢复；远端同 id 复活（revived，跟随远端下载、本地陈旧副本作废）；本地把该副本也彻底删除（标记作废）。
- 本地编辑过再遇到他端删除：Lake 强制留历史快照；小记不备份（随记语义）。

### 10.3 回收站 = 特殊笔记本（删除 = 移动；261112 定稿）

- **删除 = 移动**：移入回收站是**位置变更**，不是内容删除——索引保留条目并写 `trashedAt`（进入回收站时间）+ `deletedFromParentId`（删除前父，恢复位置）；正文/附件/历史不删，**不写墓碑**。
- **`trashedAt` 是唯一权威标记**：`parentId` 在 trashed 条目上**不承载树父语义**（可能是本地容器 id，也可能是原父）。消费方必须按 `trashedAt` 判回收站、恢复位置只看 `deletedFromParentId`；**不得**依据 trashed 条目的 `parentId` 做树遍历/父校验/恢复。
- **本地容器 id `notebook-trash`**（单一来源 `src/core/syncDecisions.ts`）：**不进 wire 的 `folders[]`**（两端发布都排除），也不作为对外 parent 语义。两端本地表示当前不同：桌面 `notes.parent_id` 历史实现指向该容器（原父记在 `deleted_from_parent_id`）；移动端不写该 id（保留原父 + `trashed_at` + `deleted_from_parent_id`）。**新代码不得依赖该 id 的 parent 语义**（只允许作为本地容器判据：目录排除/回收站列表等）。
- **收件端（261112 P0）**：本地已在回收站 + 远端 active 编辑 ⇒ 应用内容/标题/图标等字段，**保留本地回收站、不隐式恢复**；唯二恢复例外 = 云端基线本身是 trashed 条目（他端显式恢复已传播）或本机 `restorePending`（§11）。丢弃「远端 active 就恢复」的旧实现。
- **purge = 缺席**：彻底删除 = 索引条目消失 + 前缀清理（`objects/{id}-`、`assets/{id}/`、`meta/assets/{id}/`）；Lake 没有墓碑对象可传播（小记另有 `purged[]`，§10.4）。
- 回收站自动过期（`trashAutoPurgeDays`，默认 90 天）到点 purge；`cloud_deleted`（仅本地）副本**不豁免**。被动收到的删除（他端）≠ 本端主动删除：副本只读、可恢复、不参与 S3，唯一例外是显式恢复。

### 10.4 小记 `purged` 的差异

- 小记是唯一带「墓碑式标记」的空间：`QuickNotesIndex.purged` 传播不可恢复删除；Lake 文档没有对应结构。
- 保留窗口 90 天（§5.2）：超窗从云端索引与 `state.quickPurges/quickPurgeTimes` 一起移除，**这是有意的有界化**；
  接收端首次见到墓碑时补记时间（否则会被没有时间的端无限重新发布，窗口在集群里永远不生效）；
  删除=缺席不变——新设备从未持有过内容，迟到设备拿着很旧的基线也不会「复活」（内容本来就不在索引里）。
- 小记没有历史快照；冲突副本靠 `archiveQuickNote`（归档为一条新小记，纯本地、恢复后是新小记）。

## 11. 恢复 = 唯一显式例外

1. 用户从回收站恢复 → 本端写 `restorePending`（**唯一提前例外**）。
2. 合并第一步 local-wins：上传 active 覆盖远端缺席/墓碑（`decideItem` 第 1 步、`planQuickNotesMerge` 恢复优先于 `purgedIds`）。
3. 恢复标记必须在 `markSynced` / `markQuickNoteSynced` / `saveState` 时清除（**残留 ⇒ 墓碑永胜失效**）；
   单条小记推送这类不走整轮 saveState 的路径用 `persistSyncMarkers` 落盘清除后的标记。
4. 远端恢复（他端先恢复）：
   - Lake 删除意图让位：远端同 id 条目 `updatedAt > intent.purgedAt` ⇒ 视为他端显式恢复，本端删除意图让位。
   - 小记：远端出现同 id 且 `updatedAt > quickPurgeTimes[id]` ⇒ 本端 purged 墓碑作废、跟随下载；
     只有「远端恢复时间晚于本地 purge 时间」才算恢复，避免把本端尚未发布的 purge 直接让位掉。
5. 目录：恢复后 `updatedAt` 晚于基线且不在回收站 ⇒ 重新发布（否则下一轮又被打回回收站）。

## 12. 发布协议

### 12.1 锁（无 CAS 的自建锁）

```
meta/lock.json = { deviceId, time, ttl }
LOCK_TTL_MS = 120_000 ｜ LOCK_SETTLE_MS = 40 ｜ LOCK_DEADLINE_MS = 15_000（可配 lockWaitMs）
```

`acquireLock`：读锁 → 持有者是他端且未过期 ⇒ 截止前带抖动重试（60–300ms）；否则写自己的锁 → 静置 40ms → 读回确认仍属于自己。
`assertLockOwned`：写 pointer 前再确认一次（防静置后又被抢）。`releaseLock`：只删自己的锁。拿不到锁 → `lock-busy`（retryable）。

### 12.2 有变更发布（incrementalSync）

1. 先 `saveState`（含本轮 planned pending）——崩溃也不会丢待删。
2. `acquireLock` → 读回 pointer，若他人已改（epoch/generation/commit 任一不同）→ `PublishRetry`。
3. 写**变更侧**索引（内容寻址；未变的一侧不重写）。
4. `assertLockOwned` → 写 pointer（generation + 1；未变一侧 commit 沿用旧值）→ **读回校验**（generation + 双方 commit）。
   任一不符 → `PublishRetry`（回到 1 重来，最多 6 次）。
5. `saveState(finalState)` → `saveBaseline` → 执行待删（§13）；**清理失败只降级 warning**，不把已成功的发布报成失败。
6. 释放锁（finally）。

### 12.3 单条小记推送（「保存并同步」快路径，261110 / 独立管线 261111）

用户语义：这是**唯一**用户主动发起的 S3 同步特例，只推当前这一条小记、必须最快；
不处理其他待同步、不拉数据、**不等在途整轮同步**。

**实现 = 独立管线** `src/core/s3v3/quickPush/`（261111 从 `S3v3SyncEngine` 剥离）：
- `pipeline.ts` 是唯一实现；`S3v3SyncEngine.pushQuickNote` 是薄委托，桌面 `pushQuickNoteWithV3` /
  移动 `runMobileV3PushQuickNote` **直接调用** `runQuickPush`（不再为一次推送构造整轮引擎）。
- 窄接口 `types.ts`：remote 只给 get/put/deleteMany（+可选 putFromFile）；device 只给
  loadBaseline / 单条同步行（loadQuickPushState）/ 读正文 / 资产清点 / markQuickNoteSynced /
  saveBaseline / persistSyncMarkers；不暴露 lake 索引、plan/apply、意图账本、GC。
- 门与互斥：桌面 `serializedQuickPush` 高优先门（不排 `enqueueMaintenance`、不等 `v3Gate`）；
  移动 `runPriority("syncQuickNote")`；判据 `PRIORITY_OPS.syncQuickNote`。

**请求序列（成功、无资产）— 11 次**（旧实现 13 次）：
1. 取锁：GET owner → PUT lock →（静置 40ms）→ GET owner（2 GET + 1 PUT）
2. **锁内只读一次 pointer**（与 baseline 做 epoch/generation/lakeCommit 判定 + CAS 基线）（1 GET）
3. 与 quick-notes 索引 GET **并行** PUT 本条正文（内容寻址）（1 GET + 1 PUT）
4. 需要时 GET 远程声明 + 上传新增资产/声明（有资产才有；本地 0 资产不读声明）
5. PUT 新 quick 索引（1 PUT）
6. 写 pointer 前 GET 校验仍持锁（1 GET）
7. PUT pointer（generation+1，lake 不动）（1 PUT）
8. 读回校验 pointer（1 GET）
9. finally 释放锁：**距取锁成功 < TTL-5s 时直接 DELETE**（省掉 owner GET）；超出余量才保守 GET+校验（1 DELETE）

**重复点（内容 / 元数据 / 资产声明都没变）**：只读 1 次 pointer（确认云端仍停在 baseline 那一代）就返回
`unchanged` —— **不取锁、不读索引、0 上传、0 发布、generation 不涨**。

**本地读**：优先平台**单行查询**（`getQuickNoteSyncRow`，桌面/移动已实现；只读这一条小记行 + 标签关系），
端口缺失/异常回退整份 `loadState`；不再为单条推送重建整个世界。

**只 upsert 这一条**：items 其余条目、tags、purged（按保留窗口）逐字段保持云端原样；
成功后 `markQuickNoteSynced`（I2）+ baseline（lake 原样、quick 只更新本条）+ markers；失败不写基线、不标同步。

**回退条件（`full-sync`，不静默降级，且已释放锁）**：云端无 pointer / 本机无 baseline /
baseline 与 pointer 不同代（epoch·generation·lakeCommit）/ 远端 quick 索引里该条 `purged` 且无显式恢复标记。
回退由调用方执行一次整轮（走同步入口，含 v3Gate）。

**证据（LOGGING §8）**：一行 `[perf] sync.push-single <ms>ms id=… status=… req="requests=… get=… put=…" phases="push-pointer=…,…"`。

### 12.4 读回失败/并发

- `publish-conflict`（重试超限）与 `lock-busy` 都是 retryable；UI 可自动重试。
- 首轮并发首传竞态（pointer 还没写、对象已在云端）→ 无基线时最多重试 2 次；有基线时视为真损坏（`pointer-corrupt`）。

## 13. 待删队列与执行门禁（`s3v3Gate.ts` / `s3v3/commit/executePending.ts`）

- 计划：**v4 起不再生成新的待删计划**（原 `s3v3Gc` 规划器已在 `03ef3fb3` 收口时删除）。设备状态里可能残留历史 `pending` 队列，按本节日志门禁逐轮消费；新产生的不可达对象（正文换 hash、旧声明版本、从声明移除的附件、被 purge 的前缀、被替换的旧索引）由 §14 `deepCleanup` 列举差集清理。
- 类型（`PlannedDelete.kind` → `PendingDelete.kind`）：`body`、`asset`、`declaration`、`purge-prefix`、`index`，以及小记对应的 `quick-note-*`。
- 执行门禁 `gatePendingDelete(item, world)`：**仍被当前世界引用就跳过并出队**（宁可不删，不可误删）：
  - 正文：条目不存在 → 删；当前索引仍引用同 hash → 保留。
  - 附件：条目不存在 → 删；**无声明/声明与索引不一致 → 保守跳过**；声明仍含该 filename → 保留。
  - 声明：条目不存在 → 删；索引仍引用同 declHash → 保留。
  - purge 前缀：条目仍在索引 → 保留。
  - 索引：pointer 仍指向它 → 保留。
- 执行：先 `deleteByPrefix`（前缀类）再 `deleteMany`（键类），一次成功即清空 pending；任一步抛错 → 保留仍满足门禁的项，下轮重试，warning。
- 清理与发布分离：pointer 已发布后的清理失败**不得**回滚/报失败（SD-05）。

## 14. GC 保留窗口（`deepCleanup`）

手动/周期间接清理**不可达对象**（崩溃/半途失败留下的孤儿），不进入日常同步；只读指针/索引/声明算 keep 集，再列举对象做差集。

keep 集：

1. `meta/pointer.json`、`meta/lock.json`、当前两份索引；
2. 所有条目的正文 key；所有声明的 key 与声明内列出的附件 key；
3. `extraKeep`（平台注入：桌面 = 本机历史快照引用的 `assets/{noteId}/{filename}`，移动 = `historyRepository.historyAssetRefs`）；
4. **上一版索引保护**：每个空间额外保留「未被当前 pointer 引用、lastModified 最新」的 1 个 index（给还在读旧索引的他端留容错）。

扫描前缀：`objects/`、`assets/`、`meta/index/`、`meta/assets/`、`quick-notes/objects/`、`quick-notes/assets/`、`quick-notes/meta/`。

删除判定：

- `retentionDays` 默认 **7 天**（可配；≤0 = 立即到期，只保留显式 keep）；
- `lastModified > cutoff` ⇒ 窗口内，保留（`skippedRecent`）；
- provider 未返回 `lastModified` ⇒ 无法判龄，**保守保留**（`ageUnknown`）；
- `dryRun` 只返回候选，不删对象、不动本地 pending；真删后只摘除「目标确实被删」的 pending 项。

> **两个窗口别混**：`deepCleanup.retentionDays`（对象保留，默认 7 天）≠ 小记 `purged` 传播窗口（90 天）≠ 回收站自动过期（`trashAutoPurgeDays`，默认 90 天）。

## 15. 设备存储契约（`s3v3DeviceStore.ts`）

```ts
S3v3DeviceStore: init / loadState / saveState / loadBaseline / saveBaseline
  + 正文读写删/历史（readBody writeBody deleteBody writeHistory archiveBody）
  + 资产（listAssets readAsset writeAsset deleteAssetsDir，小记同构）
  + 可选加速/原生端口：readBodies? statBodies? readQuickBodies? statQuickBodies?
    listAssetStats? listQuickAssetStats? assetNativePath? assetNativePathFor?
    markQuickNoteSynced? persistSyncMarkers? archiveQuickNote?
```

`DeviceState`（跨轮账本，全部设备本地、绝不上云）：

| 字段 | 语义 |
|---|---|
| `lake` / `quickNotes` / `folders` | 本地索引视图 + 仅本地回收站副本 |
| `intents` | 持久删除意图（§10.1） |
| `pending` | 待删对象队列（§13） |
| `remotePurged` | 「云端已删除·仅本地」id（§10.2） |
| `restorePending` | 显式恢复标记（§11；同步成功后清除） |
| `quickDeletes` | 本地软删/待传播的小记 id |
| `quickPurges` / `quickPurgeTimes` | 小记不可恢复删除墓碑与时间（90 天窗口依据） |
| `pendingAssets` | 上轮失败附件的重试账本（§8.5） |

基线 `DeviceBaseline` = `{ epoch, generation, lakeCommit, quickNotesCommit, lake, quickNotes }`：
桌面落 `<storeRoot>/sync-v3/baseline.json.gz`（gzip level 1），移动落 `sync_v3_state` 单行 JSON。
state sidecar：桌面 `<storeRoot>/sync-v3/state.json`；移动同表 `sync_v3_state`。基线丢失 ⇒ 走 `no-baseline`（pullAll），**不是**删除。

**状态应用是「镜像写」而非用户保存**（261112）：正文/图标走 §9.6 的同步专用写路径；单篇应用失败按 §9.7 降级为 warning + continue（不整轮失败）。位置三件套的应用见 §9.5（`apply-position`）。

**断代（Q23，261112 用户裁决 B：删除 v1/v2 迁移）**：state 信封（`src/core/s3v3/state/intentLogState.ts`）只认 v3，形状变更**不做双写过渡、不写旧字段兼容**。读到 v1/v2 旧信封（或无 version 的旧 sidecar）⇒ **账本重置**（records 置空 + 一条可读 warning，不阻断同步）；只**抢救保留**资产投影与 hashCache（丢掉资产投影会把「未下载」误判成「删光附件」→ 云端误 GC；丢掉 hashCache 要全库重算 sha256）。基线独立于信封（桌面 `baseline.json.gz` / 移动同 JSON 的 `baseline` 字段），重置账本**不丢基线**。

## 16. 双端能力矩阵

### 16.1 Remote 端口（`S3v3Remote`）

| 能力 | 桌面 `electron/s3v3/s3Remote.ts` | 移动 `src/mobile/v3/s3v3Remote.ts` | 说明 |
|---|---|---|---|
| get / put / list / deleteMany / deleteByPrefix | ✅ | ✅ | 必选端口 |
| `getRange`（分片下载） | ✅ | ❌ | 桌面大附件 2–8 片并发；移动走原生整对象 |
| `getToFile`（原生流式下载 + 原生校验） | ❌ | ✅ | 字节不过 JS 桥 |
| `putFromFile`（原生流式上传） | ❌ | ✅（工厂注入） | 桌面无本地原生路径，走字节 |
| gzip | 仅元数据 key | 仅元数据 key | 端口按 key 判定（I6） |
| 超时 | 30s 元数据 / 120s GET·PUT | 30s / 120s（与桌面显式对齐） | |
| 重试 | maxAttempts 3 | SDK 默认 3 | 等价 |
| 连通性检查 | ListObjectsV2 | ListObjectsV2 | 七牛 HeadBucket 对存在的桶也 404 |
| 404 判定 | `isNoSuchKey`（NoSuchKey/NotFound/含 404） | 同（core 纯函数） | |
| key 安全 | `assertSafeS3Key` | 同（core 纯函数） | |
| endpoint/region 规范化 | `normalizeEndpoint` / `validateS3Settings`（强制 https，localhost 例外） | 同源 | |
| forcePathStyle | 取设置 | 固定 false（只支持虚拟托管；D2 定稿） | |

### 16.2 Device 端口（`S3v3DeviceStore` 可选能力）

| 能力 | 桌面 `DesktopStoreDevice` | 移动 `MobileDeviceStore` | 引擎回退 |
|---|---|---|---|
| `readBodies` / `statBodies` | ❌ | ✅ | 逐篇 readBody / 读内容比 hash |
| `listAssetStats` / `listQuickAssetStats` | ❌ | ✅（原生 size/hash） | 读字节现算 |
| `assetNativePath` / `assetNativePathFor` | ❌ | ✅ | 字节路径 |
| `markQuickNoteSynced` | ✅ | ✅ | 整表 saveState |
| `persistSyncMarkers` | ✅ | ✅ | 下轮整轮 saveState 清理 |
| `archiveQuickNote` | ✅ | ✅ | 历史快照兜底（小记无历史 ⇒ 不留副本） |
| 历史快照 | `createHistorySnapshot` | `historyRepository.createHistorySnapshot`（小记跳过） | — |

### 16.3 一致性口径

- 并发上限只在 core 给（单一来源），两端不得各调一套。
- 两端协议面等价性由 `electron/s3v3/deviceConformance*.test.ts` + `src/mobile/v3/deviceConformance.mobile.test.ts` 对拍。
- 差异只允许出现在「传输实现」（原生流式/分片）与「设备存储投影」（SQLite/文件），**判定逻辑必须在 `src/core/s3v3*.ts` 里只写一遍**。

## 17. 错误码与失败语义

| code | 含义 | 分类（`classifyS3v3Error`） |
|---|---|---|
| `lock-busy` / `publish-conflict` / `cloud-changed` | 并发发布冲突/锁占用 | retryable |
| `empty-cloud` / `epoch-mismatch` / `generation-rollback` / `fork` | 需用户选择云端赢/本地赢 | action-required |
| `pointer-corrupt` | pointer 缺失/非法（且有对象）或损坏 | fatal |
| `index-missing` / `index-hash-mismatch` | 索引对象缺失/与 pointer 不符 | retryable（网络/半失败） |
| `body-hash-mismatch` / `quick-body-hash-mismatch` / `declaration-hash-mismatch` | 内容/声明损坏 | retryable（下轮重传） |
| `quick-body-missing` / `upload-failed` | 本地小记正文缺失/上传失败 | retryable |
| 其余未知/网络错误 | — | retryable |

失败语义：

- **单对象失败不炸整轮**：warn + 继续；受影响条目跳过并保留下轮重试意图。
- **单篇 apply 失败 = warning + continue**（§9.7）：不标 synced、不推进基线 ⇒ 下轮重试；并汇入 `SyncResult.warnings`（桌面）/ `report.warningDetails`（移动）。
- 发布成功后清理失败 → warning，不报失败（SD-05）。
- 上传失败笔记不进新索引（回退远端旧条目）。
- 正文下载失败但本地已有 ⇒ 保留本地条目；本地也没有 ⇒ 保留远端条目（不得把「对象暂时缺失」变成永久删除）。

## 18. 已知上限 / 明确不做的事

1. **无 CAS**：锁 + 读回只能降低双写窗口，理论上仍有极小概率双方都以为发布成功（先后静置读回）；个人单用户 + 重试可接受。
2. `MAX_PUBLISH_RETRIES = 6`、锁截止 15s：极端拥塞下同步会失败退避（retryable），不退化为破坏性操作。
3. 索引上限 10 万文档/2 万小记；超过 2 万文档的下一步是**按篇增量索引（v3.1）**，不是分片。
4. `pullAll` 是「元数据对账 + 内容复用」，不是「删除本地」；本地独有内容只能由用户显式 purge（I0）。
5. 不做旧 manifest 迁移/清理/兼容（旧对象是孤儿，交给深度清理窗口）。
6. 不做多人协作、不做同一文档并发编辑合并（远端胜 + 本地留历史）。

## 19. 护栏测试索引（改协议先看这些）

| 主题 | 测试 |
|---|---|
| 协议核心（索引/声明/指针/合并/GC 计划） | `src/core/s3v3Core.test.ts`、`s3v3Protocol.test.ts` |
| 三方合并/恢复/删除意图 | `src/core/s3v3Merge`（经 core 测试）、`s3v3RemotePurged.test.ts` |
| 小记 `purged` 保留窗口（SD-09） | `src/core/s3v3QuickPurgeWindow.test.ts` |
| 同步诊断报告（SD-13） | `src/core/s3v3Report.test.ts`、`electron/store.test.ts`（环形落盘） |
| 全量重拉不得删本地（I0） | `electron/s3v3/pullAllSafety.test.ts` |
| 空跑轮零发布/零写 | `electron/s3v3/idlePublishRegression.test.ts`、`electron/s3v3/perf.integration.test.ts` |
| 缺正文/缺附件（不覆盖本地、不上传空正文） | `electron/s3v3/missingBody.test.ts`、`src/core/s3v3AssetLossGuard.test.ts`、`s3v3DeferAssets.test.ts` |
| 待删门禁/清理 | `electron/s3v3/deepCleanupWindow.test.ts`、`src/core/s3v3/commit/executePending.test.ts` |
| 双端一致性 | 单实现契约 `src/mobile/v3/deviceConformance.mobile.test.ts`（21 it）+ 跨端混合 `electron/s3v3/deviceConformance.mixed.test.ts`（3 it）+ `parity.test.ts` |
| 单条小记推送/标记落盘 | `electron/s3v3/quickPushSingle.test.ts`、`markerPersist.test.ts`、`src/mobile/v3/remParity.test.ts` |
| 「保存并同步」快路径（独立管线/最短链/轻量状态/高优先域） | `src/core/s3v3/quickPush/pipeline.test.ts`（请求序列/回退/别端变更）、`pipeline.parity.test.ts`（与旧实现逐字节对拍）、`electron/s3v3/quickPushFastPath.test.ts`、`src/mobile/v3/quickPushFastPath.test.ts`、`electron/quickNotePushPriority.test.ts` |
| 传输端口护栏（key/gzip/404/客户端单例） | `src/mobile/native/s3PortGuards.test.ts` |
| 位置字段独立合并 / 回收站位置传播（261112） | `electron/s3v3/trashRemoteDivergence.test.ts`、`electron/s3v3/deviceConformance.mixed.test.ts`（回收站位置必须传播）、`src/core/s3v3/state/deviceStoreMeta.test.ts` |
| 同步专用写路径（回收站行接收正文/图标，用户入口守卫不放宽） | `electron/noteContentRepository.test.ts`（F04）、`electron/s3v3/remoteIconWrite.test.ts`、`electron/s3v3/deviceConformance.mixed.test.ts` |
| 单篇 apply 失败降级（warning + continue） | `src/core/s3v3/state/deviceStoreMeta.test.ts`、`electron/s3v3/deviceConformance.mixed.test.ts` |

## 20. 变更记录

- **2026-11-12**：位置字段（`parentId`/`trashedAt`/`deletedFromParentId`）独立三方合并（§9.5，纯移动轮 `indexChanged`、`apply-position` 写、内容赢家是远端时不上传旧字节）；同步专用写路径与写守卫分层红线（§9.6：`saveSynced`/`saveSyncedNote`/`applyRemoteNodeIcon`，用户守卫不下沉）；回收站 = 特殊笔记本（§10.3：删除 = 移动、`trashedAt` 权威、`notebook-trash` 不进 wire/不作为对外 parent 语义、收件端不隐式恢复）；单篇 apply 失败 = warning + continue 并汇入 `SyncResult.warnings`（§9.7）。
- **2026-11-10**：「保存并同步」快路径（261110）：桌面改走高优先门（不再排维护队列/不等整轮）；
  单条推送加 `loadQuickPushState` 轻量状态（不重建世界）、内容寻址去重 PUT、remote/client 缓存、
  请求数与分段耗时 [perf] 证据；回退条件与基线口径见 §12.3。
- **2026-10-28**：本文件重写为 v3 唯一协议（SD-11）。删除 Manifest V2 全文（对象布局/ManifestNote/V1-V2 升级/墓碑链 CAS/传输对拍旧版）；
  新增：pointer/不可变索引/每篇声明/内容寻址/锁与读回/GC 保留窗口/双端能力矩阵/删除=缺席/恢复唯一例外；
  小记 `purged` 加 90 天保留窗口（SD-09）；同步诊断报告落 `device_state`（SD-13）。
- **2026-10-20**：Manifest V2（`kind=ink`）——已失效，见各过程文档顶部横幅与 git 历史。
