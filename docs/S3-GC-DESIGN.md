# S3 存储与 GC 契约

> 当前实现：`electron/s3Store.ts`（传输）· `electron/s3Maintenance.ts`（keep 集、对账、深度清理、manifest prune）· `src/core/gcPolicy.ts` / `src/core/gcDecisions.ts`（纯策略）。
> 本地是唯一真相，S3 只是镜像；GC 最坏只丢云端冗余，随后可由本地重新上传自愈。

## 1. 对象与 Manifest
- Lake 正文：`objects/{noteId}-{contentHash}.lake`（内容寻址）。
- Lake 资产：`assets/{noteId}/{filename}`（文件名不可变，内容用 size+sha256 校验）。
- Lake Manifest：`version=2`（V1 可读用于升级；V2 正式支持 `kind="ink"`），`manifests/latest.json` 指向当前 commit。
- 历史 commit：`manifests/{commitId}.json`；保留 `MANIFEST_CHAIN_KEEP=3` 条 `prevCommitId` 链。
- 小记独立空间：`quick-notes/objects/*`、`quick-notes/assets/*`、`quick-notes/manifests/*`。

> ⚠️ **别把两个「历史」混起来**（261012 用户核对时问到，此处补一条名词区分）：
> · `manifests/{commitId}.json` = **清单的版本链**（在云端，保留 3 代）—— 用来做 GC 对账与回滚保护，**不是**文档历史；
> · `history/{noteId}/*.body.gz`（261019 前为 `*.lake.gz`）+ `note_history` 表 = **文档历史快照**，属 **L3 纯本机**（判据见 `docs/STORAGE-LAYERS.md`
>   §分层表与 FAQ）—— **不上传、不进 manifest**，每端独立；
> · 它与 S3 的唯一关系是本节 §2 第 4 条：**本机**历史引用到的资产（那些字节本就在 S3 上，属文档资产）
>   在 GC 时被 **best-effort 保护** —— 方向是「别删我引用的」，不是「把我的历史传上去」。

## 2. 权威 keep 集
云端对象可删当且仅当它不被任何在留引用闭包保护。Lake keep 集来源：
1. `manifests/latest.json`；
2. latest 清单中的 notes、folders、正文和 assets；
3. `prevCommitId` 链上保留的历史 manifest 及其引用；
4. 本机历史快照 `getProtectedRefs()` 引用的资源（best effort）。

小记 GC 使用独立 keep 集。共享函数 `buildGcKeepSet` 是唯一引用闭包实现，UI 诊断与真实删除必须共用。

## 3. 待回收与对账
- 同步发布新 manifest 后，旧正文/资源若不再被 latest 引用，登记到 `s3_gc_pending`。
- `runGcReconcile` 逐行处理 pending：
  - 已过窗口且不在 keep → 删除对象并清 pending；
  - 已过窗口但重新进入 keep → 清 pending，不删对象；
  - 窗口内或时间戳非法 → 保守保留。
- 手动对账可显式忽略保留窗口；自动对账遵守 `gcRetentionDays`。

## 4. 深度清理
`runDeepCleanup` 扫描 Lake 的全部 `objects/`、`assets/`、`manifests/`，差集删除：
- 不存在的 → 忽略；
- 在 keep 集 → 永不删；
- 不在 keep 集且已过窗口 → 删除并写 `s3_gc_log`；
- `dryRun` 只返回候选。

小记深度清理使用独立入口，不与 Lake 结果混算。

## 5. Manifest 裁剪
`pruneOldManifests` 采用滞后水位：文件数未超过 `2 + KEEP + SLACK` 时只做一次 list；超过后沿 `prevCommitId` 计算 keep 集并删除链外旧 commit。删除失败不阻断同步，下轮重试。

## 6. 安全红线
- 禁止逐对象 HEAD/GET 探测资产存在性；资产存在性以远端清单声明差集为准。
- `manifest.assets` 永远全量声明，不能只声明本次上传项。
- 禁止使用本机持久缓存推断云端对象仍存在。
- GC 只能删除“不在权威 keep 集”且满足窗口保护的对象。
- purge 必须无条件写墓碑（删除标记不可省略）；墓碑本体当前永久保留，payload 回收方案见 §7。
- `purged_at` 只是前缀删除工作标记。
- 所有 GC/深度清理共用串行维护队列，避免与同步并发互删。

## 7. 墓碑保留策略：SiYuan/dejavu 对照与推荐方案（261025 调研）

> 结论基于 2026-10-25 的本机 `siyuan-master` 与 `siyuan-note/dejavu` main 源码。本节只记录调研与方案，**本批不实现**。
> 一句话：SiYuan 用 Git-like 快照 + 三方合并 + 有界保留；我们用的是单文件 Manifest + 永久墓碑。删除传播是可靠的，但墓碑及其删除前内容没有退出机制。

### 7.1 SiYuan/dejavu 的做法

- **仓库结构**：`objects/` 存内容寻址的文件块，`indexes/` 存完整文件列表快照，`refs/latest` 指向当前快照，`refs/latest-sync` 指向本机上次同步的快照。见 dejavu `README.zh-CN.md` 与 `entity/index.go`。
- **删除不是墓碑**：每次同步生成一份新的完整 `Index`；文件被删除 = 新 Index 的 `Files` 列表里没有它。`Index` 结构没有 `deleted` 字段。
- **三方合并**：`base = latest-sync`、`local = 本地 latest Index`、`cloud = 云端 latest Index`。对每个路径判断 base/local/cloud 是否存在、内容是否变化，从而区分“对方删除 / 本机删除 / 双方修改”。核心在 dejavu `sync_merge.go` 的 `classifySyncFileVersions`、`decideSyncFile`、`decideConflictedSyncFile`。
- **冲突策略**：删除 vs 修改冲突时本地优先；未采用的版本进入数据历史（`ConflictDetail.HistoryFile`），不会变成永久墓碑。
- **云端互斥**：上传前 `tryLockCloud(DeviceID)` 拿云端锁，防止多设备并发覆盖同一份 `latest`（dejavu `sync.go`）。
- **有界回收**：本地按 `IndexRetentionDays` / 每日保留索引数 purge 未引用快照（本机 `kernel/model/repository.go` 的 `autoPurgeRepo`）；云端未引用快照按官方限制保留 30 天后自动清理。旧 Index 不再引用后，其文件块才进入 GC。
- **代价**：索引/对象/文件块模型、完整快照生成、三方合并、云端锁与历史清理，工程复杂度明显高于单 Manifest 模型。

### 7.2 本项目的现状

- 单文件可变 Manifest：`manifests/latest.json`；每篇文档按内容哈希对象化；删除写 `deleted_notes` 墓碑（`id/title/parent_id/sort_order/updated_at/deleted_at/node_type/published_at/purged_at`）。
- Manifest 中的 `deleted:true` 条目会永久保留：新 Manifest 继承远端条目，且注释明确“不得从 manifest 移除墓碑”；`markTombstonesPublished()` 只写 `published_at`，注释明确“墓碑本体永久保留（审计 #2）”。
- `pruneTombstones()` 的注释说“可安全剪除”，但**生产代码没有调用者**（仅测试），实际行为是永久保留。
- 本地没有“上次同步的完整存在性快照”：只有每篇文档的 `base_hash` / `quick_note_sync_base`。因此“远端清单少一个 ID”是歧义的，必须靠墓碑表达删除。
- GC keep 集把墓碑的内容引用也保护起来：`collectManifestRefs` 对 `deleted` 条目仍加入 `contentHash`；小记的 `buildQuickNotesKeepSet` 还保护墓碑图片。结果：删除传播可靠，但墓碑元数据和删除前正文/图片永久累积。
- Manifest 写入没有 CAS/云端锁；多设备同时整轮同步是“后写覆盖”，靠“推送后回核 / 下轮自愈”兜底。

### 7.3 差异与风险对照

| 维度 | SiYuan/dejavu | 本项目当前 | 风险 |
|---|---|---|---|
| 删除表达 | 新 Index 中缺席 | Manifest `deleted:true` 墓碑 | 墓碑单调增长 |
| 判定依据 | `latest-sync` 三方合并 | 每篇 hash 基线 + 墓碑 | 无基线就无法丢墓碑 |
| 删除前内容 | 旧 Index/文件块，按保留窗口回收 | 墓碑引用进入 keep 集，永久保护 | 正文/图片无法回收（最大头） |
| Manifest 并发 | 云端锁 | 无锁、后写覆盖 | 并发同步短暂丢条目，靠自愈 |
| 回收边界 | 本地保留策略 + 云端 30 天 | 无墓碑 GC | 存储单调增长 |
| 实现复杂度 | 高（Git-like 仓库） | 低（单文件清单） | 简单换来了保留缺口 |

### 7.4 推荐方案（按风险从低到高）

**P0 · 墓碑 payload 老化（建议先做，改动最小）**

- 目标：止住“删除前正文/图片永久占用 S3”，墓碑元数据继续保留，删除传播与防复活语义不变。
- 规则：墓碑 `deletedAt` 超过 `TOMBSTONE_PAYLOAD_RETENTION_DAYS`（建议 90 天，先做常量，后续再考虑设置项）后：
  - 文档墓碑：Manifest 条目保留 `deleted:true` / `deletedAt`，把 `contentHash` 改为占位符（与 purge 已无内容时的既有做法一致），`assets` 清空；不再上传删除前内容。
  - 小记墓碑：同样保留 `deleted:true` / `deletedAt`，`contentHash` 改占位符，`assets` 清空。
  - keep 集不再引用这些对象 → 过了 GC 窗口后由 `runDeepCleanup` / `runQuickNotesDeepCleanup` 回收。
- 影响：超过保留窗口后，其他设备**不能再恢复“删除前最新版”**，只能得到“已删除”；这是明确的产品取舍。
- 落点：`src/core/syncEngine.ts` 墓碑上传分支与 Manifest 组装；`src/core/quickNotesSyncEngine.ts` 墓碑分支；`electron/quickNotesSync.ts` 的 `buildQuickNotesKeepSet`；两端共用 core 纯函数 + 单测。
- 兼容：不改变 Manifest 版本、不改 `.qnote`、不动墓碑元数据；老客户端仍能读到 `deleted:true`。
- 验收：固定时钟单测（保留窗口边界、占位符/资产清空）、keep 集单测、双端同步回归、GC dry-run 候选包含旧墓碑正文对象。

**P1 · Manifest 条件写 / 云端锁（并发一致性）**

- 目标：消除多设备并发整轮同步的“后写覆盖”。
- 首选：发布 `latest` 时使用对象存储条件写（ETag / `If-Match`）；不支持时退回“lock 对象 + TTL + 设备 ID”，过期可抢占。
- 单条推送的 Manifest 写入也必须走同一互斥；现有“推送后回核”保留为兜底。
- 验收：A/B 两端并发同步，Manifest 不丢条目；锁过期/崩溃恢复用例。

**P2 · last-sync 快照 + 三方合并（长期，彻底方案）**

- 为每台设备保存上一次同步的完整索引（ID + 内容哈希 + 元数据），删除 = 新索引缺席；像 dejavu 一样做 base/local/cloud 三方合并。
- 有了可靠基线后，墓碑可以按保留窗口真正退场（甚至不再需要墓碑）；这是唯一能既防复活、又让墓碑元数据有界的方式。
- 代价：同步引擎级改造，桌面/Android 必须同批；需要迁移与兼容设计，不适合顺手做。

**标签墓碑**：没有 payload，只有几十字节元数据；在 P0/P1 阶段保持现状即可。若未来做 P2，标签目录可复用同一保留策略。

### 7.5 决策与待办

- 261025 用户决定：先把调研与方案写档，**后续再做优化**；本批不改同步协议。
- 清单规模（20MB 解压上限、条目瘦身、分片、指针）与墓碑退役最小充分条件的独立调研见 `docs/S3-MANIFEST-SCALE-RESEARCH.md`（261025，仅文档）。
- 待用户确认：墓碑 payload 保留窗口（建议 90 天）；是否接受窗口外无法恢复删除前内容；云端条件写/锁在你使用的 S3 服务上的支持情况。
- 在 P0 落地前，现行红线不变：purge 必须写墓碑，墓碑本体永久保留。
