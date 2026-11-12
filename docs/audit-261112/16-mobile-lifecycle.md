# 16 · 移动端生命周期语义等价性核查（回收站 / 位置 / 锁 / 单篇降级 / 回收站容器 id）

> **性质**：只读审计（不改产品代码）。本报告只依据**工作树**（HEAD `2d79f78f` + 并行批未提交改动）静态阅读 + 现有 conformance 用例。
> **未做**：未跑真实 S3、未跑设备、未运行「移动端 staged 路径」的合成用例（本报告把该路径标为**代码路径已核实 / 运行时后果待验证**）。
> **基线说明（重要）**：工作树当前含一批未提交的「桌面+移动生命周期修复」（`git status` 16 文件：`electron/{store,noteContentRepository,syncReconciliation,s3v3/*}`、`src/core/s3v3/{state,plan,commit}/*`、`src/mobile/v3/*`）。本报告对照的是**这批修复后的语义**；若该批被回退，本报告的「参照语义」栏需重新核对。
> **范围外**：真实 S3 往返（task-46）、Android 构建/设备（Lead 统一）、桌面 UI 文案逐条。

---

## 0. 方法

1. 逐方法读 `src/mobile/v3/{mobilePlatformPort,mobileDeviceStore,sync}.ts` 与桌面 `electron/{store,noteContentRepository,syncReconciliation}.ts`、`electron/s3v3/*`、core `src/core/s3v3/{state/deviceStore,plan/plan,plan/positionMerge,commit/engineBridge}.ts`。
2. 用现有共享 conformance 套件（`electron/s3v3/deviceConformance.ts`，移动端由 `src/mobile/v3/deviceConformance.mobile.test.ts` 实例化）核对**已覆盖**与**未覆盖**的场景。
3. 只记录「有 file:line 证据」的项；运行时推断单独标注「推断」。

---

## 1. 参照语义（桌面 + core 的当前实现）

| # | 语义 | 参照实现（file:line） |
| --- | --- | --- |
| R1 | 同步专用正文写入允许「已 trashed 行」接收正文；purged 仍拒绝，且两种拒绝文案不同 | `electron/store.ts` saveSyncedNote；`electron/noteContentRepository.ts:74-88`（`saveSynced`/allowTrashed；:84 purged 文案「不可恢复」，:87 trashed 文案） |
| R2 | 应用远端元数据：trashed 行由 `parentId === 回收站笔记本` 判据归一，并**全量写** title/parent/sort/updated_at/trashed_at/deleted_from | `electron/syncReconciliation.ts:123-158` |
| R3 | 本地在回收站 + 远端 active 编辑 ⇒ 正文/标题应用、**位置保留本地**、绝不隐式恢复（仅「基线 trashed→远端 active」或 restore_pending 例外） | `src/core/s3v3/state/deviceStore.ts:567-570`（keepLocalTrash/resolvedParentId）、`:614-643`（metaNote 固定本地生命周期）、`:617-621`（restore 例外） |
| R4 | 位置三件套**独立三方合并**；纯位置轮也发布（`apply-position`），发布条目按位置赢家组装 | `src/core/s3v3/plan/positionMerge.ts`；`src/core/s3v3/plan/plan.ts:66-77,131-147,180-194,329-356`；`src/core/s3v3/commit/engineBridge.ts:185-206` |
| R5 | 锁字段独立发布：本地 vs 基线做字段 diff（含 isLocked/lockedAt），contentHash 不变也发布 | `src/core/s3v3Engine.ts:729-742`；`engineBridge.ts:222-223`（apply-remote 携带锁）；`deviceStore.ts:645-647`（调用 applyRemoteEditLock） |
| R6 | 单篇 apply 失败降级：记 warning 后 continue，不抛整轮 | `deviceStore.ts:669-677`；桌面 `electron/s3v3/desktopSync.ts`（工作树 +diff）；移动 `src/mobile/v3/sync.ts:66-72` |
| R7 | 回收站容器 `notebook-trash` **不作为目录**发布；notes[].parentId 允许指向它（trashed 条目） | 桌面 `electron/store.ts:1413` 显式排除；协议 `docs/SYNC-PROTOCOL.md:218,317` |
| R8 | 云端已删除副本：DB 投影 `cloud_deleted` + 不上传 + 可恢复 | `deviceStore.ts` saveState 末尾 remotePurged→cloud_deleted；conformance「云端彻底删除」场景 |

---

## 2. 移动端写/应用路径逐条对照

| 路径 | 移动端实现（file:line） | 与参照的差异 | 结论 |
| --- | --- | --- | --- |
| `saveNote`（用户保存） | `src/mobile/bridge/notes.ts:88-100`；`data/noteRepository.ts:154-160` | trashed/purged 都拒绝（:93/:95），与桌面用户保存同语义 | **等价**（文案见 §4-N5） |
| `saveSyncedNote`（同步写正文） | `mobilePlatformPort.ts:131-147`（applySyncedBody）`:387-391` | SQL 无 trashed 守卫 ⇒ 回收站行可接收正文；不改 trashed/parent | **等价（legacy 路径）**；但移动端正常下载走 staged，见 N1 |
| `applyStagedBodyNote` | `mobilePlatformPort.ts:392-400` | `parent_id=COALESCE(note.parentId, parent_id)`；core 对 trashed 条目传 `parentId=notebook-trash`（`deviceStore.ts:570,590-591`）⇒ 移动端普通父列被写入容器 id | **不等价（N1，P1）** |
| `applyRemoteNoteMeta` | `mobilePlatformPort.ts:402-431` | 对 `note.trashedAt` 非空的行**整体跳过** title/parent/updated_at（:404-410）与 snapshot 同步（:427-430）；桌面全量写（R2） | **不等价（N3，P2）** |
| `applyRemoteEditLock` | `mobilePlatformPort.ts:433-438` | 与桌面同口径写 `is_locked/locked_at` | **数据层等价**（UI 缺锁，N4） |
| `deleteNote`（远端墓碑→回收站） | `mobilePlatformPort.ts:446-452` | 只 set `trashed_at`，不动 parent、**不写 deleted_from_parent_id** | 移动自身模型自洽；跨端恢复受影响（N2） |
| `restoreTrashItem`（远端恢复传播） | `mobilePlatformPort.ts:466-470` | 只清 `trashed_at`；父级由随后 `applyRemoteNoteMeta`（trashedAt=null）写回 | **等价** |
| 用户移入/移出回收站 | `data/noteRepository.ts:283`（单篇）、`data/trashRepository.ts:65,90`（批量/子树） | 只改 `trashed_at/updated_at`；**从不写 `deleted_from_parent_id`** | 见 N2 |
| 用户恢复 | `data/trashRepository.ts:247-248`（`COALESCE(deleted_from_parent_id, parent_id)` + `resolveRestoreParent` :187-215） | 依赖 parent 未被写成容器 id；一旦 N1 发生 ⇒ 回落兜底/日记本根 | **N1 的用户可见后果** |
| `moveTreeNode` | 同步路径**不使用**；目录移动在 core 里走 `importRemoteFolder/applyRemoteFolderMeta`（`mobilePlatformPort.ts` 目录段） | 无差异 | 等价（说明：同步不依赖移动端的 moveTreeNode） |
| 单篇 apply 失败 | `mobileDeviceStore.ts:104-116`（drainApplyWarnings）+ `v3/sync.ts:66-72` | 与桌面同结构（warningDetails） | **等价（R6）** |
| 回收站容器不外发（folders[]） | `mobilePlatformPort.ts:147-160`（SQL `id != notebook-trash`） | 与桌面 `store.ts:1413` 同口径 | **等价（R7）** |

---

## 3. 不等价清单（按优先级）

### N1【P1 · 代码路径已核实；运行时后果为推断】staged 正文应用把 `notebook-trash` 写进移动端普通父列
- 证据链：core 对「本地 trashed/keepLocalTrash」条目一律给端口传 `parentId=notebook-trash`（`src/core/s3v3/state/deviceStore.ts:570`），staged 分支把该 write 交给 `applyStagedBodyNote`（:590-591）；移动端该方法的 SQL 为 `parent_id=COALESCE(?, parent_id)`（`mobilePlatformPort.ts:392-400`），会把它写进 `notes.parent_id`。**同文件的 `importRemoteNote`（:362 注释 + `:366`）和 `applyRemoteNoteMeta`（:404 起）都刻意避免把该 id 当普通父**，只有 staged 方法漏了同一归一。
- 触发场景（P0 用例的移动端等价形态）：移动端用户把文档移入回收站（未同步）→ 他端编辑正文并发布 → 移动端同步（正文走 staged 下载）⇒ 本地回收站行 `parent_id` 变成 `notebook-trash`。
- 用户可见后果（推断，但有直接代码依据）：移动端恢复走 `COALESCE(deleted_from_parent_id, parent_id)`（`trashRepository.ts:247`）。移动端自己软删**不写 deleted_from_parent_id**（`noteRepository.ts:283`）⇒ 恢复目标 = `notebook-trash`；`resolveRestoreParent` 在 folders 里找不到它（移动端没有这个目录行）⇒ 回落到默认笔记本/日记本根（`trashRepository.ts:187-215`）⇒ **恢复后不回到原笔记本**。
- 次生风险：该行之后被 `listNotesSyncMeta` 当作普通 parent 读出（`mobilePlatformPort.ts:164-200`），在后续纯位置/字段变更轮可能把 `notebook-trash` 作为 `notes[].parentId` 发布（协议 §218 允许 trashed 条目如此，但移动端内部语义已坏）。
- 修法（建议）：在 `applyStagedBodyNote` 复用 `importRemoteNote` 的归一 —— `parentId = note.trashedAt ? (note.deletedFromParentId ?? null) : note.parentId`；或（更根本）移动端进入回收站时补 `deleted_from_parent_id`（见 N2），让恢复判据不依赖 `parent_id`。

### N2【P1 · 已核实】移动端从不写 `deleted_from_parent_id` ⇒ 跨端恢复位置丢失
- 证据：移动端软删只写 `trashed_at/updated_at/is_dirty`（`data/noteRepository.ts:283`、`data/trashRepository.ts:65,90`），全仓无 `deleted_from_parent_id=` 的写入（`portable/importPortable` 只做便携包导入映射）。
- 后果 A（推断）：移动端删除的文档发布后 wire 上无 `deletedFromParentId`；桌面应用远端元数据时 `deletedFrom = note.deletedFromParentId ?? null`（`electron/syncReconciliation.ts:127-128`）⇒ 桌面 `restoreTrashItem` 失去原父，恢复会落兜底/根。
- 后果 B（已核实语义）：移动端自身恢复依赖 `COALESCE(deleted_from_parent_id, parent_id)`，一旦 `parent_id` 被 N1 污染就直接丢位置；补 `deleted_from_parent_id` 可让恢复对 N1 免疫。
- 修法：移动端软删（单篇 + 批量/子树）补 `deleted_from_parent_id = COALESCE(deleted_from_parent_id, parent_id)`；恢复后清空；发布侧 `listNotesSyncMeta` 已带该列（`:187`）无需改 wire。

### N3【P2 · 已核实】`applyRemoteNoteMeta` 对 trashed 行整体跳过元数据（桌面全写）
- 证据：`mobilePlatformPort.ts:402-431` 两段都被 `if (!note.trashedAt && !locallyEdited)` 挡住；桌面 `syncReconciliation.ts:123-158` 无条件写 title/parent/sort/updated_at/trashed_at/deleted_from（仅 `expectedLocalUpdatedAt` 守卫）。
- 实际影响（推断）：trashed 行若「正文未变、仅远端改名/移动/改排序」，移动端不落库（移动 staged 路径只在正文变时由 applyStagedBodyNote 顺带写 title/updated_at）⇒ 标题/排序与桌面不一致；可能下一轮重复发布（未收敛）。
- 修法：trashed 行只跳过 **lifecycle 列**（trashed_at/deleted_from），title/sort/parent 按移动语义归一后照常应用。

### N4【P2 · 已核实】锁字段：数据层等价，但移动端没有锁语义消费面
- 等价部分：R5 全部在共享 core + 两端端口实现（conformance【场景 5】纯锁变更 LWW 双端跑，`electron/s3v3/deviceConformance.ts:597-630`）；移动端口读写 `is_locked/locked_at`（`mobilePlatformPort.ts:164-200,433-438`）。
- 不等价部分：移动端 `bridge.getNoteInfo` 硬编码 `isEditLocked: false`（`src/mobile/bridge/notes.ts:155`）；`src/mobile/**` 无任何 `isEditLocked` 消费/横幅/保存拦截；conformance 注释亦写明「移动端没有锁 UI」（`deviceConformance.ts:150`）。⇒ **桌面锁定的文档在移动端可编辑、可保存（不被拦）**。
- 需产品裁决：移动端补「锁 = 只读 + 横幅 + 保存拦截」，或登记为已知例外（登记时必须写进 AGENTS/HANDOFF，否则后续审计重复提）。

### N5【P2 · 已核实】保存拦截文案：移动与桌面不逐字一致，且移动缺「不可恢复」语义
| 场景 | 桌面（`electron/noteContentRepository.ts`） | 移动（`src/mobile/bridge/notes.ts`） |
| --- | --- | --- |
| trashed | :87「笔记已在回收站或已被删除，保存被拒绝；请先显式恢复」 | :93 同句 ✅ |
| purged | :84「笔记已被彻底删除（**不可恢复**），保存被拒绝；已删除条目不可复原」 | :95「笔记已被彻底删除，保存被拒绝」（缺「不可恢复」） |
- 影响：仅文案（行为都拒绝）；但移动端用户不知道 purged 不可恢复。建议对齐（单测可做**文案 parity** 断言，读两处源码比对）。

### N6【已等价，别重复立项】
- 回收站行接收远端正文（内容层）：桌面 `saveSyncedNote` / 移动 `saveSyncedNote→applySyncedBody`（`mobilePlatformPort.ts:131-147,387-391`）同语义；差异只在 N1 的父列与 N3 的元数据。
- keepLocalTrash / 位置独立合并 / 单篇降级：全在共享 core（R3/R4/R6），两端端口都实现了必需钩子。
- 回收站容器不进 folders：桌面 `store.ts:1413`、移动 `mobilePlatformPort.ts:147-160` ✅；notes[].parentId 指向容器是协议允许（`docs/SYNC-PROTOCOL.md:218,317`）——**该红线应表述为「容器不得作为目录发布、不得写进普通父列」**，建议文档写清，避免下一轮误判。
- 云端已删除副本：移动 `applyCloudDeletedProjection`（单事务 + 400 批）与 conformance「云端彻底删除」场景双端跑 ✅。

---

## 4. 移动端 UI 文案与拦截核查

| 面 | 现状（file:line） | 与桌面/语义一致性 |
| --- | --- | --- |
| 回收站列表徽标（云端已删除） | `src/mobile/settings/TrashList.tsx:98`「云端已删除（仅本地）」+ title 说明 | ✅ 与语义一致（不参与上传、可恢复） |
| 回收站文档预览横幅 | `src/mobile/trash/TrashPreviewPage.tsx:72`（云端已删除）+ `:76`（只读预览：编辑与保存会被拦截…恢复后可继续编辑） | ✅ Q04B 定稿语义；保存被拦靠「不挂可写宿主」实现，无静默 |
| 读取链只读 | 预览页 `LakeEditor interaction="preview"`（`TrashPreviewPage.tsx:88-96`） | ✅ 无卡片菜单/copy-cut；tap 图片预览保留 |
| 用户保存拦截 | `bridge/notes.ts:93/95`（见 N5） | ⚠️ 文案差异 |
| 只读锁横幅/拦截 | **不存在**（N4） | ❌ 不等价 |
| 小记只读预览档位 | 移动小记（quick note）在回收站只有列表行：恢复/彻底删除，无预览；回收站**文档**预览用统一预览档字号（`LAKE_PREVIEW_FONT_SIZE`，task-24） | 与桌面「小记可预览」能力差属 Q03/Q04 已裁决范围（本轮不重复立项） |

---

## 5. 建议补的 conformance 场景（**先只给清单，不抢 core 写域**）

> 落点统一优先 `electron/s3v3/deviceConformance.ts`（`defineDeviceContract`：规格共享，移动 harness 自动跑）；移动专属真值断言（直读 SQL）放 `src/mobile/v3/deviceConformance.mobile.test.ts` 末尾。

| ID | 场景 | 断言（至少） | 为什么现有用例抓不到 |
| --- | --- | --- | --- |
| C1 | **移动端本地已 trashed + 他端编辑**（staged 正文路径） | ①整轮不抛；②正文=B；③`noteParentId(n1)` 仍=删除前父（≠ `notebook-trash`）；④`restoreNote` 后 `noteParentId` 回到原父；⑤再跑两轮 parent 不变 | 现有 P0/task-44 只断言 trash 成员与正文，**不查 parent**；且未覆盖 staged 下载路径 |
| C2 | **跨端恢复位置**：A(移动) 删 → 同步 → B(桌面) 恢复 | ①B restore 后两端 `noteParentId` = 删除前父；②A 同步后回原父；③wire 上 trashed 条目带 `deletedFromParentId` | 现有场景只验证「能恢复/进回收站」，不验证恢复**位置**；需混合 harness（同一 MemoryRemote 上 mobile+desktop 两个 factory，现有 mobile test 只实例化 mobile） |
| C3 | **trashed 行仅元数据变化**（远端改名/改父/改排序，正文 hash 不变） | ①两端 title/parent 一致；②无正文 PUT（requests 计数）；③下一轮 `published=false`（不重复发布） | 现有用例都带正文变化；N3 的盲区正好是「只元数据」 |
| C4 | **单篇 apply 失败降级** | 注入某 id 的 `applyRemoteNoteMeta/applyStagedBodyNote` 抛错 → ①整轮成功；②`warningDetails` 含该 id；③下一轮重试成功（正文=B） | 现有 conformance 无故障注入用例；R6 只有代码没有护栏 |
| C5 | **回收站容器不外发** | ①云端 `folders[]` 不含 `notebook-trash`；②非 trashed 条目 `parentId !== notebook-trash`；③移动 DB `SELECT parent_id FROM notes WHERE trashed_at IS NOT NULL` ⊆ 原父集合 ∪ {null} | 现有用例只断言 folders/trashedAt，不断言 parent 列 |
| C6 | **移动端锁能力**（依赖 N4 裁决） | 若补锁：桌面锁 → 移动端只读 + 横幅 + 保存拒绝且文案明确；若登记例外：断言该差异被文档登记（防止再提） | 现有场景 5 只测数据层；移动无 UI 用例 |

---

## 6. 待验证 / 未覆盖（诚实边界）

1. **N1 的运行时后果未跑**：代码路径（core→port 调用 + SQL）已核实，但「恢复落兜底」是据此推断；建议先加 C1 用例（跑红即证实）。
2. **N2 的桌面恢复行为未跑**：桌面 `trashLifecycle.restoreTrashItem` 的父解析细节本轮只读到 syncReconciliation 落库口径；C2 用例会确认。
3. **工作树含未提交并行批**：本报告对照的是这批修复后的语义；若其被改写/回退，§1/§2 需复核（尤其 R2/R3/R5）。
4. 未审查 `src/mobile/v3/mobilePlatformPort` 的小记分支（quick-notes 回收站/云端已删除）与本任务 5 项之外的深层语义。
5. 未审 `bridge/sync.ts` 的 UI 汇报文案与 `SyncStatusPopover` 一致性（属桌面/UI 专项）。

## 7. 附：建议补测试清单（只清单）

1. conformance **C1/C2/C5**（最高优先：跨端恢复位置 + 容器 id；C1 大概率先红）。
2. `src/core/s3v3/state/deviceStoreMeta.test.ts`：staged trashed 行的 `resolvedParentId` 归一期望（现状红 ⇒ 修后转绿）。
3. `src/mobile/v3/mobilePlatformPort` 单测：`applyStagedBodyNote` 对 trashed note 的 parent 映射 = `deletedFromParentId ?? 原父`（与 `importRemoteNote` 同口径）。
4. 文案 parity：移动 `bridge/notes.ts:93/95` 与桌面 `noteContentRepository.ts:84/87` 逐字断言（读源码）。
5. conformance **C4**（故障注入降级）。
6. 若 N4 裁决补锁：移动只读横幅 + 保存拦截 render 测试。
