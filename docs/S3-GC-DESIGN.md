# S3 存储读写 + 删除（GC）设计 — 完整实现规格（v4）

> 状态：**v4 定稿（已纳入外部 AI 评审 + 用户最终确认）**——2026-08-13 用户确认全部开放项（§13.4）：窗口默认 7 天可配、purge 立即删 + 二次确认、回收站自动清空默认关闭且不静默自动化、历史分层纳入（小改动）、附件下一期；外部评审意见已回应合入（§16）；历史模块联立分析见 §18。**已实现（v4.1，实现口径见 §19 与新增 §6.8；2026-08-15 状态更新，原“暂不实现”为设计定稿时的快照措辞）。**
> 目标：把 S3 从"只增不删"改为"当前状态镜像 + 可控冗余窗口"，存储有上限、误删可找回、恢复可靠；配套小记回收站。
> 关联：依赖已完成的数据安全三件套（回收站 `f51379b`、历史 `34797b3`、P0-1 冲突判定 `fbef270`）。
> 分支：`feat/s3-storage-rw-delete`（自 `fix/locked-viewer-text-cache` 切出）。
> 参考：思源 dejavu 引擎（§12）；第三方附件同步方案评审（§13）；外部 AI 评审回应（§16）。

---

## 1. 背景与目标

**核心原则（v4 新增）：S3 只是镜像，本地才是唯一真相。** 所有"删除"删的都是云端冗余：被删除对象必在某设备本地有副本、或在其他设备本地有副本可重传自愈。"误删可找回"由 **本地 + 回收站 + 历史快照** 兜底，不依赖 S3 保留。这是 v4 所有安全论证的基石——GC 的任何缺陷最坏退化为"云端冗余丢失 + 下次同步自愈"，不会导致当前数据丢失。

**现状（已核实）**：S3 只增不删（正文对象内容寻址、旧对象永不删；附件从正文移除后远端永不删；manifest commit 无限累积；小记同样）。图片资源**已是每文档每图独立**（`imageOutput` 每次插入生成唯一文件名）。唯一共享的是正文对象 `objects/{hash}.lake`。⚠️ 现有缺陷：被历史引用的资源当前会被上传 S3（与"历史仅本地"冲突）；恢复后同步会撤销恢复（§5.2）。

**目标（用户确认 + v4 修订）**：
1. S3 存"当前生效正文+附件" + **可控冗余窗口**（删除不立即执行，保留 N 天，定期低频对账）。
2. 历史快照**正文**仅本地、不上 S3；但**历史引用的资源**在云端保留到"本设备本地历史不再引用 + 窗口到期"（B1：本设备最佳努力，非跨设备全局承诺）。
3. 快照恢复 = 本地操作，标记待上传，下次同步完成 S3 增减。
4. 每文档每图片/每正文对象**绝对独立**，接受极低概率冗余。
5. 小记一并纳入，新增小记回收站（无历史快照）。

---

## 2. 决策记录（v4 定稿）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 正文对象键空间 | **`objects/{noteId}-{contentHash}.lake`**（扁平、不可变、可从 manifest 推导、可按 noteId 前缀删除）。 |
| D2 | 删除时机 | 软删除（回收站）：本地/远端/S3 都不动，仅 manifest 墓碑。**purge 彻底删除**：本地立即物理删；S3 由下一次同步**先写本设备 manifest（deleted:true）→ 再按 `objects/{noteId}-` / `assets/{noteId}/` 前缀立即删（不进窗口）**（§6.6）。**UI 必须二次确认**（明确提示同时删除本地与云端数据、云端删除不可撤销），不可一键静默执行。 |
| D3 | GC 安全与频率 | 标记回收 + 保留窗口 + 定期低频对账；窗口天数 `gcRetentionDays`（默认 7）与对账周期 `gcIntervalHours`（默认 24）settings 可改；**删除安全由构造保证**（差集删除 + 年龄保护 + 镜像语义），云端锁仅咨询性。 |
| D4 | manifest 保留 | `latest.json` + **最近 3 份 commit**（manifest 带 `prevCommitId` 链，沿链保留，无需列表排序）。 |
| D5 | 小记 | 纳入；新增小记回收站；同步/GC 同规则（无历史引用保护）；deferred tombstone 纳入保留集（§6.5）。 |
| D6 | 存储服务商 | 七牛 S3 兼容：`ListObjectsV2`/`DeleteObject`/`DeleteObjects` 均支持；列表接口不支持 `encoding-type`；**PUT 不支持原子/条件写**（官方文档明示），键全 ASCII 并在运行时校验。 |
| D7 | 恢复与同步 | 恢复 = 本地写回 + `sync_state='local'`（notes + tree_nodes 双表）待上传（§5.2）；远端增减由下次同步对账完成。 |
| D8 | 同步流程顺序 | 咨询锁（失败不阻断）→ 读 manifest → 下载（自愈）→ 上传（先对象/资源、后 manifest）→ 标记回收（并撤销重新引用的键）→ 解锁；定期对账另跑。 |
| R1 | Cache-Control | 普通对象带 `no-cache`；**`latest.json` 类清单用 `no-store`**；前置条件：manifests/ 前缀不挂 CDN 缓存。 |
| R2 | 云端锁 | `lock-sync` 对象：deviceID+时间戳，65s 超时、30s 刷新。**咨询性锁**：七牛无原子条件写，锁只用于减少争用；真正安全由"年龄保护 + 差集删除 + 本地为真相"保证；**本机进程内 sync/GC 必须互斥（串行队列）**。 |
| R3 | 深度清理 | 设置面板"深度清理"：全局 sweep。**与同步共用咨询锁 + 年轻对象保护（LastModified < 安全年龄不删）+ 全命名空间保留集 + dry-run 预览 + 审计日志**（§6.7）。 |
| B1 | 历史引用保护 | 被本设备任意历史快照引用的资源：**云端保留**（不进入待回收），直到本设备历史不再引用；之后进入窗口。**本设备最佳努力，非跨设备全局承诺**；反向操作：重新被引用时从 pending 撤销（§6.4）。 |
| B2 | 待回收清单 | 本地 `s3_gc_pending` 表记录"待删键 + 标记时间"；**删除时以"与权威引用集的差集"重算为准，pending 仅作提示/审计**（§6.5）。 |

---

## 3. 键空间（v4）

```
manifests/latest.json                          # 当前清单（恒保留，no-store）
manifests/{commitId}.json                      # 保留最近 3 份（prevCommitId 链），更老进待回收
objects/{noteId}-{contentHash}.lake            # 每笔记当前正文对象（不可变、独立）
assets/{noteId}/{filename}                     # 每笔记附件（不变，已独立）
lock-sync                                      # 云端同步锁（临时，咨询性）
manifests/latest.v3-backup.json                # 迁移前 v3 清单备份（回滚用；保留窗口 7 天内有效，过期由 GC 回收，§9.5）
quick-notes/manifests/latest.json              # 小记清单（no-store）
quick-notes/manifests/{commitId}.json          # 小记 commit（v4 新增，现仅 latest.json；同链保留最近 3 份）
quick-notes/objects/{itemId}-{contentHash}.qnote   # 小记正文对象（独立，每小记每内容一份）
quick-notes/assets/{itemId}/{filename}         # 小记附件
```

旧格式 `objects/{64hex}.lake`、`quick-notes/objects/{64hex}.qnote`（内容寻址共享键）由迁移后自动进 pending + GC 回收（§9）。

---

## 4. Manifest v4

```ts
interface ManifestNote {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; contentHash: string; isConflict: boolean;
  isLocked?: boolean; lockedAt?: string | null; icon?: string | null;
  assets: { filename: string; size: number; hash: string }[];
  deleted?: boolean;
  deletedAt?: string;
}
interface Manifest {
  version: 4; workspaceId: string; commitId: string;
  prevCommitId: string | null;                 // 上一份 commitId（本设备上次写入的 commit）
  createdAt: string; notes: ManifestNote[];
}
```

- 无 objectKey（键由 `{id}-{contentHash}` 推导）；无 purged（S3 删除只看本设备本地标记）。
- 下载路径：`objects/{rn.id}-{rn.contentHash}.lake`。
- **`prevCommitId`**：用于"最近 3 份"保留与 GC 保留集计算——`latest → prev → prev.prev` 沿链遍历 O(3)，无需全量下载/列表排序（解决 P1-3）；断链孤儿 commit（并发覆盖产生）由年龄保护兜底，保留窗口后回收。
- 小记 manifest 同步升级 v1 → v2，增加 `prevCommitId`，同规则保留最近 3 份。

---

## 5. 本地语义修正（两处现有 bug/缺陷）

### 5.1 历史引用资源的上传/保留策略
- **上传资格**：仅当前正文引用（`extractAssetRefs(当前 .lake)` ∩ 磁盘存在）→ 上传 S3。历史引用资源**不上传**（若已在云端则保留，见 B1）。
- **本地保留**：当前正文引用 ∪ 历史引用（不删，防恢复裂图）——维持现状。
- **云端保留**（B1）：历史引用的资源不进入待回收；当本设备历史清理到不再引用时，进入待回收窗口。

### 5.2 恢复后同步会撤销恢复（bug，v4 补全）
`restoreHistory` 改为：
1. 写回 .lake / 更新缓存 / 恢复前留档（不变）；
2. **不再 setBaseHash(恢复版)、不再 setLastUploadedHash(恢复版)、不再 markSynced**；
3. 设 `notes.sync_state='local'` **且 `tree_nodes.sync_state='local'`**（与全库双表成对更新模式一致，避免侧边栏圆点误显示 synced）；
4. base/lastUploaded 保持恢复前值。

**上传成功后收尾**（在 syncNow 上传阶段，对本次上传的笔记统一执行）：`setLastUploadedHash(新hash)` → 写 manifest → `setBaseHash(新hash)` + notes/tree_nodes 双表 `markSynced`。

**边界说明**：正常流程 base 与 lastUploadedHash 每次同步成对更新（`sync.ts` 对每个笔记 `setLastUploadedHash`、结束时 `setBaseHash+markSynced`），不会出现持久不一致；即使存在瞬态不一致（mid-sync 崩溃残留），P0-1 四个分支对 base/L 是否相等不敏感，判定依然正确：
- 远端 == 本机最后上传 → 本地为准上传覆盖；
- 远端 != 本机最后上传 → 接受远端，恢复版已入历史（恢复前留档）。

---

## 6. 同步流程（v4）

### 6.1 ① 咨询锁 + 读 manifest
- 抢锁/续期/释放同 v2（`lock-sync`，deviceID+时间戳，65s/30s）；**失败仅告警，不阻断**（咨询性）。
- **本机进程内互斥**：同一时刻只有一个 sync/GC 在执行（串行队列），这是并发安全的第一道、也是必须的一道闸。
- 读 `manifests/latest.json`（no-store）→ 校验版本/结构。

### 6.2 ② 下载阶段（含自愈）
同 v2：下载 `objects/{noteId}-{contentHash}.lake` 与 assets，size/hash 校验；缺对象且本地有 → 本机重传自愈；否则中止。

### 6.3 ③ 上传阶段（先对象/资源，后 manifest）
- 每 active 笔记：hash=sha256(正文)；对象键=`objects/{noteId}-{hash}.lake`；远端同 hash 跳过；上传对象 → 上传 assets（仅当前正文引用集）；manifest 条目含 assets。
- 墓碑：软删除 → `deleted:true`；彻底删除 → `deleted:true`（S3 前缀删除见 6.6）。
- 写 `manifests/{commitId}.json`（含 `prevCommitId`）+ `latest.json`（no-store）；沿 prevCommitId 链超 3 份的 commit 进待回收。

### 6.4 ④ 标记回收（不立即删，含撤销）
**前置：重读一次 latest.json**（防并发覆盖）。计算"本次不再被引用"的键，**写入本地 `s3_gc_pending` 表**；**同时 `DELETE FROM s3_gc_pending WHERE key ∈ 本次新引用集`**（P0-1 撤销：被重新引用的键立即解除待回收）：

| 目标 | 判定 | 处理 |
|---|---|---|
| 旧正文对象 | 上版 manifest 该笔记 contentHash ≠ 新 manifest contentHash | 进待回收 |
| 被移除的附件 | `assets/{noteId}/{filename}` 不在新 manifest 该笔记 assets 列表 | 若本设备历史仍引用 → **保留（B1）**；否则进待回收 |
| 已彻底删除笔记数据 | 本地 `deleted_notes.purged_at` 非空 | **立即删**（§6.6，purge 语义） |
| 软删除笔记数据 | purged_at 为空 | 不删（保留） |
| 旧 commit manifest | prevCommitId 链超最近 3 份 | 进待回收 |
| 小记旧对象/被移除附件/超链 commit | 同规则（无历史引用保护，D5） | 进待回收 |

### 6.5 ⑤ 定期低频对账（GC 执行器，差集模型）
- 触发：每日定时（复用 main.ts 现有清理巡检）+ 同步时若距上次对账 > 周期 + 手动"深度清理"。
- 动作：
  1. 计算**权威引用集 keep** = 最新 Lake manifest 引用 ∪ prevCommitId 链（最近 3 份 commit）引用 ∪ 本设备本地历史 refs 引用 ∪ 小记 latest + 其 commit 链引用 ∪ deferred tombstone 远端条目所引用的一切键；
  2. 取 `s3_gc_pending` 中 `marked_at` 超窗口（默认 7 天）的键作为候选；
  3. **只删 `候选 − keep` 中仍存在的键**（重新被引用的键即使 pending 里残留也不删——双保险）；
  4. `delete`/`deleteMany`（批量 ≤1000），404 视为成功；失败保留下轮重试；成功后移除 pending 记录并写审计日志。
- 不需要下载任何正文展开引用：manifest 即引用集合（优于思源 dejavu 的 refs 遍历）。

### 6.6 purge 彻底删除（D2，立即删）
- 触发：purgeTrashItem/emptyTrash 写入 `deleted_notes.purged_at` 后，本设备下次同步执行。
- **二次确认（用户要求）**：purge 动作必须弹窗确认，文案明确同时删除本地与云端、云端删除不可撤销；空回收站同。
- 顺序：**先写本设备 manifest（deleted:true，§6.3 上传阶段）→ 再 `deletePrefix('objects/{noteId}-')` → 再 `deletePrefix('assets/{noteId}/')`（§6.4 标记阶段立即执行）**。先让云端知道删除，再删数据，其他设备读到墓碑前不会引用已删对象。
- 幂等：重复执行前缀删除，404 视为成功。
- 并发竞争（其他设备正上传该 note）：下载自愈（本地有副本重传）+ P0-1 覆盖；S3 仅镜像，不产生数据丢失。
- 其他设备回收站保留该笔记（其本地数据不删），恢复后重传。

### 6.7 深度清理（R3，手动 + 迁移兜底）
- 入口：设置面板"深度清理"；支持 **dry-run 预览模式**（只列不删，展示将删键数/体积/命中原因）。
- 规则：
  1. 全量 `ListObjectsV2`（Lake + 小记 + manifests 前缀）；
  2. 保留集 = §6.5 的 keep 全集（含小记与 deferred tombstone）；
  3. **年龄保护：只删 LastModified 早于安全年龄的对象**（安全年龄 = 保留窗口，默认 7 天）——并发"对象已传、latest 未写"的年轻对象天然受保护，即使无锁也不误删；
  4. 删除写审计日志（action/原因/commitId/设备/时间）。
- 兼做：旧格式键回收兜底、崩溃孤儿清理、purge 残留兜底。

### 6.8 立即对账 vs 深度清理（实现口径，2026-08-15 补充）

设置面板「云端回收（S3 GC）」的三个入口与实现对应如下，其中**“立即对账”与“深度清理”是两个不同层级的删除执行器，不等价、互为配合**：

| 入口 | 实现 | 范围 | 判龄依据 | 能否删“孤儿” |
| --- | --- | --- | --- | --- |
| 立即对账 | `runGcReconcile` | 仅 Lake（`objects/` `assets/` `manifests/` 的**已标记**键） | 本地 `s3_gc_pending.marked_at` | 否（只处理已标记键的差集） |
| 深度清理预览 | `runDeepCleanup(dryRun=true)` + 小记 dry-run | Lake + 小记，**全量枚举** | 云端 `LastModified` | 是 |
| 执行深度清理 | `runDeepCleanup(false)` + `runQuickNotesDeepCleanup` | Lake + 小记，**全量枚举** | 云端 `LastModified` | 是 |

要点：

- **标记发生在日常同步**：上传阶段把被替换的旧正文/旧资源 `addS3GcPending`（被重新引用时撤销），对账/深度清理只负责“执行删除”，不负责标记。
- **对账 = 增量差集**：只删“已标记 ∧ 超窗口 ∧ ∉ 权威引用集”的键，看不到从未被标记过的对象。
- **深度清理 = 全量兜底**：枚举 Lake 三个子空间 + `quick-notes/` 全部对象，能清孤儿（历史遗留、旧格式 `objects/{64hex}.lake` 迁移残留、其他设备产物、异常中断残留），并额外保留 `manifests/latest.json` + 最近 3 份 commit 文件。
- **集合关系：深度清理 ⊇ 立即对账**。对“已正确标记 + 超窗 + 确实冗余”的对象两者结果一致；但整体不等价——深度清理多删小记冗余与孤儿对象。两者配合：定期对账做增量，深度清理做全量兜底。
- **已知差异（实现观察）**：24h 定期对账（main.ts `setInterval`，`gcIntervalHours`）只跑 Lake 的 `runGcReconcile`，**小记（`quick-notes/`）没有定期对账**，其冗余只能靠手动“执行深度清理”回收。当前小记量小影响有限，如需小记定期清理可另行评估。

---

## 7. 本地新增表/字段

```sql
-- 待回收清单（提示/审计；删除依据 = §6.5 差集重算）
CREATE TABLE IF NOT EXISTS s3_gc_pending (
  key       TEXT PRIMARY KEY,   -- 相对键，如 objects/{noteId}-{oldHash}.lake
  marked_at TEXT NOT NULL       -- 标记时间（ISO），窗口 = 保留天数
);

-- 区分软删/彻底删
ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT;  -- 非空 = 已彻底删除

-- 删除审计日志（destructive 操作可追溯）
CREATE TABLE IF NOT EXISTS s3_gc_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  action    TEXT NOT NULL,      -- mark / delete / dry-run / purge
  key       TEXT NOT NULL,
  reason    TEXT NOT NULL,      -- retention / purge / migration / deep-clean / crash-orphan
  commit_id TEXT,
  device_id TEXT,
  ok        INTEGER NOT NULL
);
```

**settings 新增键（UI 可改，仿历史保留策略配置）**：
- `gcRetentionDays`：保留窗口天数，**默认 7（用户确认）**，UI 可改（0 = 最短保留 0 天，**下次对账时删除，最迟不超过一个对账周期**；UI 文案如实描述，不写"立即删"）。
- `gcIntervalHours`：定期对账周期小时数，默认 24。
- `trashAutoPurgeDays`：**回收站自动清空（用户确认：默认 0=关闭 + 配置项）**。**语义：不静默自动化**——涉及本地+远端联动删除，即便开启也只生成"回收站有 N 天前的条目可清理"提醒，实际删除**始终由用户手动触发 + 二次确认**（绝不自动执行）。
- `historyTier*`（见 §18.4）：历史分层保留设置项（近 24h 全留 / 每日×7 天 / 每周×30 天 / 硬上限 100 份）。
- SettingsPanel 增加"数据保留"区域：历史（份数/天数/分层）、S3（窗口/对账周期/待回收键数/深度清理 dry-run/审计日志）、回收站（自动清空提醒天数）。

---

## 8. ObjectStore 扩展

```ts
class ObjectStore {
  test(): Promise<void>;
  getOptional(key: string): Promise<Buffer | null>;
  put(key, bytes, contentType, opts?: { cacheControl?: "no-cache" | "no-store" }): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; lastModified: string }>>;  // ListObjectsV2 + ContinuationToken 分页，不用 EncodingType
  delete(key: string): Promise<void>;             // DeleteObject；NoSuchKey 视为成功
  deleteMany(keys: string[]): Promise<void>;      // DeleteObjects，≤1000/批；容错 404；部分失败保留下轮
}
```

- 默认 `no-cache`；`latest.json` 类清单传 `no-store`。
- **键构造统一 ASCII 校验**（`/^[A-Za-z0-9._-]+$/`，fail fast），防未来非 ASCII 键导致 ListObjectsV2 编码不一致（P2-5）。
- `list` 返回 LastModified（深度清理年龄保护用）。

---

## 9. 迁移方案（单用户可接受，v4 修订）

1. manifest v3 → v4（版本校验拒绝旧客户端；**写 v4 latest 前先备份 `manifests/latest.v3-backup.json`**）。
2. 首次 v4 同步：全部笔记按新寻址重传 → 新 manifest 全量引用新键。
3. **旧格式键自动进 pending**（`objects/{64hex}.lake`、`quick-notes/objects/{64hex}.qnote` 按构造必不被 v4 manifest 引用）→ 走正常保留窗口 GC，**不依赖手动深度清理**（解决 P1-5）。
4. 小记旧共享键安全性：v4 采用 `{itemId}-{hash}` 独立键后，旧共享键成为孤儿 → 同第 3 步自动回收。
5. **回滚**：本地数据不动；手动恢复 `latest.v3-backup.json` + 删除 v4 新增键 + 旧客户端重新同步（重新上传）。v4 manifest 写成功后旧客户端会拒绝同步，回滚为运维操作，文档化。**回滚窗口 = 保留窗口（默认 7 天）**：窗口内旧格式对象与备份受年龄保护未被删，可回滚；窗口过后旧对象/备份被 GC/深度清理回收，回滚不可行（旧客户端需从本地数据重新上传）。
6. `sync_base`/`last_uploaded_hash` 语义不变。

---

## 10. 风险与防护

| 风险 | 防护 |
|---|---|
| 并发覆盖 GC 删错（场景 B） | 年龄保护（年轻对象不删）+ 差集删除 + 咨询锁 + 下载自愈；S3 仅镜像，本地为真相 |
| 崩溃窗口孤儿（场景 A） | 年轻对象保护 + 深度清理兜底（安全年龄后） |
| 误删唯一副本 | 不可能：只删"重读后仍不在引用集"的键；被引用对象必在某设备本地有副本（本地为真相） |
| pending 残留误删重新引用的键（P0-1） | §6.4 同步阶段主动撤销 + §6.5 删除前差集重算（双保险） |
| 深度清理误删小记/转换中数据 | 保留集含全部命名空间（Lake + 小记 + deferred tombstone）；年轻对象保护 |
| 软删除被误当彻底删除 | purge 只看本设备 `purged_at` 本地标记 |
| 历史恢复裂图 | B1（本设备最佳努力）：历史引用资源云端保留到历史不再引用 + 窗口 |
| GC 删除失败 | 待回收记录保留下轮重试；404 视为成功；审计日志记录失败 |
| 历史/孤儿上传 S3 | §5.1 上传资格仅当前正文引用 |
| CDN 缓存旧 manifest | latest.json 用 no-store；前置条件：manifests/ 前缀不挂 CDN |
| bucket 版本控制干扰 | **前置条件：必须关闭 bucket versioning**（否则 DeleteObject 只写 delete marker，对象不释放） |
| 非 ASCII 键 | §8 键构造 ASCII 校验 fail fast |

---

## 11. 测试清单

**单测**：
- ObjectStore：list 分页/LastModified、delete/deleteMany 批量与 404、no-cache/no-store、ASCII 校验。
- 咨询锁：获取/超时/续期/释放/失败不阻断。
- 编辑 → 旧对象进待回收；**重新引用 → pending 撤销（P0-1）**。
- 移除附件 → 历史引用保留 / 无引用进待回收；**删除前差集重算剔除重新引用的键**。
- 对账超窗批量删；窗口内不删。
- **深度清理：dry-run 预览、年轻对象保护、全命名空间保留集（小记/deferred tombstone）、审计日志**。
- purge 顺序（先 manifest 后前缀删）+ 幂等。
- 恢复 + 同步（§5.2）：双表 sync_state、上传成功后收尾、base≠L 瞬态边界。
- 历史引用不上传（§5.1）。
- prevCommitId 链保留（超 3 份进待回收；断链孤儿年龄保护）。
- 迁移：旧键自动进 pending + v3 备份回滚。
- 回收站自动清空提醒（仅提醒+手动确认，M9）；历史分层保留判定（M8，keepOrDrop 纯函数）。
- 小记回收站 + 小记 GC（含 deferred tombstone 保留）。

**回归**：`npm test -- --run`、`tsc --noEmit`、`vite build`、`git diff --check`；CDP 端到端（同步键集合核对、恢复→同步、purge→同步、窗口对账、深度清理 dry-run/执行、小记回收站）。

---

## 12. 思源 dejavu 对比（结论不变，锁/缓存行更新）

| 维度 | 思源 dejavu | 本设计 |
|---|---|---|
| 云端保留 | retention 窗口内全历史快照 | 当前镜像 + 待回收窗口（默认 7 天） |
| 对象命名 | `objects/{hash[:2]}/{hash}` 内容寻址 | `objects/{noteId}-{contentHash}.lake` |
| 存储粒度 | chunk 级去重 | 文件级独立（接受冗余） |
| 删除传播 | 无墓碑，index diff + 3 路合并 | 墓碑（deleted）显式传播；purge 仅本设备删 |
| GC | 手动/策略 mark-sweep（refs 为根，需下载文件展开引用） | 差集对账（manifest+历史 refs 即引用集合，零展开）+ 年龄保护 |
| 并发 | 云端锁（65s/30s） | 咨询锁 + 安全由构造保证（年龄保护/差集/镜像语义） |
| 缓存 | no-cache | no-cache（普通对象）/ no-store（latest 清单） |
| 冲突 | 3 路合并 + 冲突文档 | P0-1 last_uploaded_hash 判定 |
| 本地历史 | 文档副本（无资源引用清单） | note_history（带 refs_json，支撑 B1 云端保留联动） |

**采纳**：no-cache/no-store、咨询锁思想、深度清理、保留窗口思想、恢复前留档。
**不采纳**：chunk 去重、云端整库快照历史、3 路合并、block 级合并（理由见 §13/§14）。

---

## 13. 第三方附件方案评审（借鉴/不借鉴）

### 13.1 借鉴（纳入 v4）
| 点 | 落法 |
|---|---|
| 孤儿 7 天宽限期 | 即 v4 的"保留窗口"（B2），已采纳 |
| 恢复前快照 | 已有（restoreHistory 恢复前强制留档） |
| 快照分层保留思想（近密远疏） | **已纳入本期（M8，§18.4）**：近 24h 全留 / 每日×7 天 / 每周×30 天 / 硬上限 100 份 |
| 待回收清单 + 定期 GC | 即 `s3_gc_pending`（提示/审计）+ 差集对账（B2） |
| 懒下载（大文件按需） | 列为**附件功能前置项**：附件引入大文件后，>5MB 懒下载 + 打开文档预取 |
| 分片上传 + 断点续传 | 列为**附件功能前置项**：附件引入大文件后（当前图片上限 25MB 单 PUT 够用） |
| 缩略图本地生成、可重建、不上传 | 列为可选（当前无缩略图需求） |
| 资产元数据（宽高/时长） | 可选增强 |
| EXIF 剥离 | 可选隐私项 |
| 存储分级（STANDARD_IA/GLACIER） | 不写代码：七牛 bucket 生命周期规则即可，列为可选项 |
| 资产统计面板 | 可选（设置面板可加） |

### 13.2 不借鉴（理由）
| 点 | 不采纳理由 |
|---|---|
| **CAS 全局去重（文本+资产统一池）** | 与 D1"每文档每图独立、接受冗余"直接冲突；去重需引用计数，删除复杂度上升 |
| **Block 级对比/合并 + 向量时钟** | 见 §14（git 式精细对比问答） |
| **asset:// UUID 引用** | 需改 lake 序列化与编辑器集成，侵入大；现 filename 引用 + `extractAssetRefs` 已工作 |
| **manifest 条件写入（ETag If-Match）** | **七牛官方文档已确认 PUT 不支持原子/条件写**，彻底排除；咨询锁 + 差集删除已覆盖并发，更通用 |
| **操作日志逐操作回放（撤销）** | 与同步/GC 无关，单独功能；列为可选未来项 |
| **统一快照层（云端 snapshots/）** | 与"云端仅当前+窗口"冲突 |

### 13.3 该方案遗漏而我们已有的点
- 墓碑防复活（deleted 传播）；P0-1 冲突判定（last_uploaded_hash）；本地历史 refs_json（支撑 B1 云端保留联动）；回收站（软删/恢复/purge）；锁定态缓存；FTS。

### 13.4 开放项（v4 已全部确认）
1. 保留窗口默认 **7 天**（UI 可改）——**已确认**。
2. purge 彻底删除：**立即删 + 二次确认提醒**——**已确认**（§6.6）。
3. **回收站自动清空（trashAutoPurgeDays）**：默认关闭 + 配置项；**不静默自动化，仅提醒、始终手动触发 + 二次确认**——**已确认**。
4. 本地历史分层保留：**已评估为小改动（§18.4，~80-150 行），纳入本期**（与 S3 模块解耦，可并行）。
5. 附件功能（懒下载/分片续传/缩略图）作为**下一期**前置项——**已确认本期不做**。

---

## 14. 关于"git 式精细行/块对比"（用户提问回答）

**结论：不建议为同步引入 block/行级对比，也不需要把 lake 改成"格式化形式"来配合 git diff。** 理由：
1. 我们的同步只比较**整文档 hash**，不需要文本 diff——diff 只有在"需要合并同一文档的两份不同修改"时才需要，而我们用 P0-1（本机传→本地覆盖；他人改→接受远端+入历史）处理，单用户场景下冲突极少且永不丢数据。
2. block 级合并是思源需要的（它的数据模型就是块、支持多设备并发编辑同一文档）；我们是单用户本地优先、S3 只做镜像，并发编辑同一文档是低频场景，P0-1 + 历史兜底已经安全。
3. 把 lake（HTML blob）拆成 block 并做合并，需要解析/序列化往返，lake 内核兼容风险高、测试量大，收益极低。
4. "格式化 lake 便于 git diff"只对**调试/可视化变更**有意义，对同步/GC 无价值；真要看差异，用现有"历史快照预览"即可。
5. 若未来真要降低冲突概率，正道是 CRDT（Yjs 类）或块级结构化存储——那是另一个大工程，与本期无关。

---

## 15. 里程碑（实现顺序，v4 更新）

| M | 内容 | 验证 |
|---|---|---|
| M1 | ObjectStore 扩展（list/delete/deleteMany + no-cache/no-store + ASCII 校验）+ 咨询锁 + 单测 | 单测 |
| M2 | manifest v4（含 prevCommitId）+ syncNow 四段（含标记回收/撤销）+ 单测 | 单测 + tsc |
| M3 | 本地语义修正：历史不上传（§5.1）+ 恢复 bug 双表（§5.2）+ 单测 | 单测 |
| M4 | purge 标记（deleted_notes.purged_at）+ 先 manifest 后前缀删 + 单测 | 单测 |
| M5 | `s3_gc_pending` + 差集对账（窗口 7 天）+ 历史引用保护（B1）+ `s3_gc_log` + 单测 | 单测 |
| M6 | 小记回收站（软删/恢复/彻底删）+ 小记同步 GC（含 deferred tombstone）+ 单测 | 单测 + CDP |
| M7 | 深度清理（dry-run + 年龄保护 + 全命名空间保留集 + 审计）+ 迁移自动回收 + 全量回归 | 全量 |
| M8 | 历史分层保留（§18.4，与 S3 解耦的小增强，可并行） | 单测 + 回归 |
| M9 | 回收站自动清空提醒（trashAutoPurgeDays，仅提醒+手动确认，不自动化） | 单测 |

---

## 16. 外部 AI 评审回应（v3 → v4 修订记录）

> 评审结论：方向（manifest 为根 + 标记回收 + 保留窗口）正确，但 v3 在并发一致性、引用撤销、跨空间 GC、墓碑生命周期上有缺陷，不能直接进入实现。
> **逐条核对结论：问题清单基本全部成立；但 P0-3/P0-4 的修复手段在七牛不可行（官方文档确认 PUT 无原子/条件写），P1-2 对 manifest 的判断有误；并补充"S3 只是镜像、本地才是真相"作为全局安全基石。**

| 评审点 | 结论 | v4 处置 |
|---|---|---|
| P0-1 `s3_gc_pending` 无撤销/重校验 | ✅ 成立（最关键） | §6.4 同步阶段主动撤销被重新引用的键；§6.5 删除前差集重算（pending − 权威引用集）；双保险 |
| P0-2 深度清理无锁 + 漏 quick-notes | ✅ 成立 | §6.7 全命名空间保留集（Lake + 小记 + deferred tombstone）+ 年轻对象保护 + 咨询锁 |
| P0-3 云端锁非互斥 | ✅ 问题成立；❌ 修法（条件写）不可行 | 七牛 PUT **不支持原子/条件写**。改为咨询锁 + 安全由构造保证（年龄保护 + 差集删除 + 本地为真相） |
| P0-4 manifest 非原子写 | ✅ 问题成立；❌ 修法（rename）不可行 | 七牛无原子 rename。改年轻对象保护：崩溃窗口对象不删；残留由深度清理兜底；崩溃恢复以 latest 为准 |
| P1-1 quick-notes 忽略 deferred tombstone / 键迁移 | ✅ 成立 | §6.5 保留集含小记 latest/commit 链 + deferred tombstone；§9 小记旧共享键自动回收 |
| P1-2 墓碑生命周期 | ⚠️ 部分成立 | manifest 已由 D4 限界（latest+3），"manifest 无限增长"不成立；软删对象累积是 D2 用户决策。补：§7 显式化墓碑永久保留决策 + 可选"回收站自动清空" |
| P1-3 最近 3 份排序 | ✅ 成立 | §4 `prevCommitId` 链，沿链保留 O(3)，无需列表排序/全量下载（优于评审建议） |
| P1-4 B1 历史保护仅单设备成立 | ✅ 成立 | §1/B1 改为"本设备最佳努力保护"；删除只删镜像，其他设备本地副本不受影响 |
| P1-5 迁移依赖手动深度清理 | ✅ 成立 | §9 迁移后旧键自动进 pending + v3 manifest 备份 + 回滚说明 |
| P1-6 恢复语义不完整 | ⚠️ 部分成立 | tree_nodes 仅 UI 指示层（同步决策只读 notes）；已补双表置 local + 上传成功收尾 + base≠L 边界说明 |
| P2-1 no-cache 不能保证最新 | ✅ 成立 | latest.json 改 no-store + 前置条件不挂 CDN |
| P2-2 缺 dry-run 与审计 | ✅ 成立 | §6.7 dry-run 预览 + §7 `s3_gc_log` 审计表 |
| P2-3 bucket 版本控制/生命周期 | ✅ 成立 | §10 前置条件：必须关闭 bucket versioning |
| P2-4 gcRetentionDays=0 语义 | ✅ 成立 | §7 文案改为"最短保留 0 天 = 下次对账删除（最迟一个周期）"，与 purge 立即删区分 |
| P2-5 键 ASCII 假设无防护 | ✅ 成立 | §8 键构造 ASCII 校验 fail fast |

---

## 17. 实现复杂度评估

**结论：实现复杂度中等偏低。评审意见"长链路"主要是正确性论证，不是实现体量；v4 修订（差集模型 + prevCommitId 链）反而简化了实现。**

| M | 内容 | 预估代码量 | 难点 |
|---|---|---|---|
| M1 | ObjectStore 扩展 + 咨询锁 | ~150-250 行 + 单测 | 低 |
| M2 | manifest v4 + syncNow 四段（含标记回收/撤销） | ~200-300 行 | 中 |
| M3 | 本地语义修正 | ~40-60 行 | 低 |
| M4 | purge 标记 + 前缀立即删 | ~50-80 行 | 低 |
| M5 | GC 差集对账 + 历史引用集 + 审计 | ~150-250 行 | 中 |
| M6 | 小记回收站 + 小记 GC | ~100-150 行 | 中 |
| M7 | 深度清理（dry-run + 年龄保护 + 审计） | ~120-180 行 | 中 |

**合计约 800-1300 行 TS + 单测**（M1-M7），分布在 3-4 个文件，按里程碑逐步实现、每步回归，风险可控。M8（历史分层）与 M9（回收站提醒）为附加小任务，另计约 100-200 行，不在上述估算内。

真正需要小心的只有三处：
1. **差集计算正确性**（含全命名空间）——纯集合运算，mock S3 下确定性可测。
2. **删除与同步的并发窗口**——由"年龄保护 + 镜像语义"兜底，**不需要实现真正的分布式锁**（七牛也不支持）。
3. **测试覆盖并发场景**——内存 mock S3 补 ListObjectsV2/DeleteObject/DeleteObjects 命令即可，均为确定性测试。

**不增加复杂度的理由**：
- 咨询锁几十行（Get/Put 时间戳对象），无条件写依赖。
- 差集模型不需要引用计数、不需要撤销状态机——删除时重算即可。
- `prevCommitId` 链让"保留 3 份"与保留集计算变成 O(3) 链遍历。
- 深度清理与定期对账共用同一套"保留集 + 年龄"规则，一份代码两个入口。
- 对比：思源 dejavu 的 mark-sweep 需下载文件展开引用（refs 遍历），我们 manifest 即引用集合，零展开，实现与运行都更轻。


---

## 18. 与历史模块（HISTORY-DESIGN.md）的联立分析

> 用户要求：两大功能（历史快照 / S3 同步删除）单独设计，应联立综合评判共通性与优化空间。
> 结论：**两者本质上是同一个模式在两层各实例化一次——「引用集差集 GC」（mark-and-sweep by reference sets）。** 联立后发现 1 处跨文档不一致（必须修）、3 处可共用构件、4 项联合优化。

### 18.1 共通性（同一模式 × 两层）

| 维度 | 历史模块（本地磁盘层） | S3 GC（云端层） |
|---|---|---|
| 判定公式 | present(文件) − (当前正文 refs ∪ 历史 refs) = 孤儿 → 物理删 | present(bucket 键) − (manifest ∪ commit 链 ∪ 历史 refs ∪ 小记 refs ∪ deferred tombstone) = 垃圾 → 删 |
| 保留策略 | 份数 100 + 30 天兜底（v4 起可分层） | 保留窗口 7 天 + 年龄保护 |
| 删除时机 | 软删保留 / purge 级联物理删 | 软删不动 / purge 前缀立即删 |
| 先看再删 | 历史面板孤儿预览 + 单删/全删 | 深度清理 dry-run 预览 + 审计日志 |
| 触发 | 惰性（创建快照后）+ 定时（cleanupTimer） | 定时对账 + 惰性（同步后）+ 手动 |
| 引用源 | `extractAssetRefs` / refs_json | 同源（manifest 即引用集合，历史 refs 复用 refs_json） |

### 18.2 联立发现的问题

1. **跨文档不一致（必须修，否则按 HISTORY-DESIGN 原文实现会复现 bug）**：HISTORY-DESIGN §10 写「恢复后 `sync_base` 重置到恢复版 hash + markSynced」，与 S3-GC v4 §5.2（保持 base/lastUploaded、`sync_state='local'`、双表）**矛盾**。其 §2 决策表本身是 P0-1 语义（last_uploaded_hash 判定），§10 是旧表述残留。→ **已同步修订 HISTORY-DESIGN §10**。
2. **引用集计算三处重复**：`detectOrphans`（当前正文引用）、`listNoteOrphans`（当前+历史 refs 实时派生）、S3 GC keep 集（当前+历史+manifest）都在做「给定 noteId 求引用集」。→ 提取唯一公共函数 `getProtectedRefs(noteId)` = 当前正文 ∪ 历史 refs，三处复用，防漂移。
3. **purge 级联需保持单条流水线**：`purgeTrashItem` 已做本地级联（.lake + note-assets + history + DB + 墓碑，store.ts）；S3 模块加云端级联（§6.6）。两模块必须共用同一个「彻底删除」事件钩子，否则历史/云端的软硬删语义会漂移（当前一致，需保持）。→ 统一为 `purgeNote(noteId)` 流水线：本地立即 + `purged_at` 标记 + 下次同步云端前缀删。

### 18.3 联合优化

1. **统一维护调度**：main.ts 现有历史清理定时器；S3 对账、回收站提醒、启动兜底各自要定时。合并为单一「维护任务调度」（各自间隔，一次启动），避免 timer 散落。
2. **设置面板「数据保留」分区统一**：历史（份数/天数/分层）+ S3（窗口/对账周期）+ 回收站（提醒天数）同一区块，概念对齐（都是「保留窗口」）。
3. **恢复事件成为两模块共识点**：restore = 本地写回 + 引用集变化 + 同步待上传；历史模块负责留档与 refs，S3 模块负责云端对账。定义清晰的「恢复事件」接口，两模块挂接，避免各自实现。
4. **共用「先看再删」交互范式**：历史孤儿预览 ≈ S3 dry-run 预览，UI 组件与确认弹窗复用。

### 18.4 历史分层保留（用户确认纳入，改动量评估）

- **现状**：`cleanupHistory()` 用一条 SQL 选「超 maxSnapshots 份的最旧 + 超 retentionDays」（store.ts）。
- **改法**：把「保留判定」抽成纯函数 `keepOrDrop(createdAtList, cfg)`——**近 24h 全留 / 每日×7 天 / 每周×30 天 / 硬上限 100 份**，替换现有 SQL 选择逻辑；删除后孤儿重算（`cleanupUnreferencedAssetsForNote`）不变。
- **代码量**：核心 ~80-150 行 + settings 键（`historyTierRecentHours`/`historyTierDailyDays`/`historyTierWeeklyDays`）+ SettingsPanel 控件 + 单测。**改动小**。
- **风险**：中等偏低——改的是已上线清理逻辑，需回归「删快照→孤儿重算」链路；分层判定纯函数易测。
- **与 S3 的关联**：历史 refs 是 S3 keep 集的一部分，分层只影响「哪些快照保留」，不改变 refs 集合的求法（保留的快照的 refs 照常并入）。**与 S3 模块解耦，可并行开发。**

### 18.5 不建议联立的

- 云端历史分层（思源整库快照思想）——与「云端仅当前 + 窗口」冲突，已排除。
- 两模块存储格式统一/去重——历史本地 gzip、云端独立文件，无必要。
- 历史快照上云——用户明确历史仅本地。

---

## 19. 最终评审结论（v4.1 实现口径）

> 2026-08-13 二次外部评审 + 用户确认后定稿。**前提：个人笔记、无并发、无生产数据。**

### 19.1 基于前提划掉的设计项（不实现）

| 划掉项 | 说明 |
|---|---|
| 旧格式键迁移自动回收 | 无生产数据；旧对象由用户手动删除，不在本期实现自动迁移回收 |
| purge 前缀删除的并发竞态处理 | 无同时恢复/同时编辑场景，不再为并发自愈设计额外逻辑 |
| prevCommitId 并发分叉（DAG） | 单设备串行写入，永远是单链 |
| v3 备份 / 回滚窗口 | 无线上数据，不做 `latest.v3-backup.json` 与 7 天回滚承诺 |

### 19.2 最终必修清单（实现前逐项对照）

| # | 问题 | 实现口径 |
|---|---|---|
| P0-1 | 回收站恢复会被远端墓碑再次删除 | 下载阶段遇 `deleted:true` 且本地为 active 时，不再无条件 `deleteTreeNode`；本地有改动/`sync_state='local'` 则本地为准，上传阶段写回 active 并清除墓碑 |
| P0-2 | keep 集缩减不驱动 pending（历史清理/M8、commit 链淘汰） | 历史删除/清理/分层淘汰与 commit 链淘汰后，把失去保护的键写入 `s3_gc_pending`；对账只删 `pending − keep` |
| P0-3 | 深度清理保留集未显式包含 manifest 文件 | keep 分两层：元数据 keep（latest/commit 文件）与数据 keep（引用展开）；深度清理显式保留元数据 keep |
| P1 | lastUploadedHash 在 manifest 写成功前更新 | 改为 manifest 写成功后再 setLastUploadedHash/setBaseHash，语义 = 已发布 hash |
| P1 | 墓碑永久保留使 latest.json 条目无界 | 本期明确接受 tombstone 永久保留；文档记录该上界仅针对对象，不对 manifest 条目数 |
| P1 | 崩溃孤儿/从未引用对象不自动回收 | 定期对账增加全量 list 兜底（带年龄保护），或明确接受手动深度清理 |
| P1 | deletePrefix 未定义 | ObjectStore 增加 `deletePrefix(prefix)`：list 分页 + deleteMany 分批 + 404 容错 |
| P1 | 审计日志 / 设置面板 IPC 契约未定义 | 补齐 `s3_gc_log` 查询 IPC 与三处桥（main/preload/native） |

### 19.3 并发与锁的最终口径

- **云端咨询锁：不做。** 七牛无条件写，且无并发场景；保留只会增加网络请求与失效分支。
- **本机进程内串行队列：必须做。** 同步、定期对账、手动深度清理共用同一队列，同一时刻只跑一个。
- **年龄保护保留**，仅作为深度清理与崩溃窗口的保险，不是核心安全防线。

### 19.4 里程碑调整

- M0（前置）：修复回收站恢复 vs 远端墓碑（P0-1）。
- M1–M7 按 §15 执行，其中：
  - M4 使用 `deletePrefix`（不再做并发自愈分析）；
  - M5 增加“keep 缩减 → pending”与“全量 list 兜底”；
  - M7 深度清理 keep 集分层，不做 v3 备份回滚。
- M8（历史分层）、M9（回收站提醒）保持独立，按需并行。
