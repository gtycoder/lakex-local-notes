# 04 · 数据生命周期与写守卫审计（261124）

> 范围：trashLifecycle（桌面文档/小记）、移动 trashSubtree/trashRepository/quickNotesRepository、unloadGuard、syncDecisions.isGoneNote、electron/store.ts 写入口守卫、quickNoteModel、docs/RESILIENCE.md 交叉核对。
> 纪律：只读审计；每条发现带 文件:行 证据；不确定标「**待复现**」。协议设计（删除压编辑、墓碑权威、恢复唯一例外、冲突不合并、小记不备份）不计为 bug。

## 一句话结论

生命周期判据的「集合口径」（parent ∪ deleted_from_parent+trashed 两路边）两端已一致、purge/幽灵自愈判据输入正确，但**恢复（restore）路径的收尾状态两端不一致**：桌面级联恢复不给子树写恢复标记/不清 cloud_deleted/不回填 FTS，移动保存会误清恢复标记 —— 共 4 条 P2（恢复语义被同步回滚、标记被误清、级联改写已删行时间戳、恢复后搜索丢子树）+ 5 条 P3。

---

## 一、发现列表

### F1（P2）桌面级联恢复不给子树 notes 写 `restore_pending_at` ⇒ 远端已 purge 时子树恢复被下一轮同步静默回滚

- **现象**：从回收站恢复一个**带子文档的分组/笔记本**时，只有根节点自己的 note 行拿到恢复标记；随行恢复的子文档没有任何 local-wins 标记，也没有清 `cloud_deleted`。
- **证据**：
  - `electron/trashLifecycle.ts:259`（根）：`UPDATE notes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1,is_purged=0,restore_pending_at=? WHERE id=?` —— 根有 `restore_pending_at=?`；
  - `electron/trashLifecycle.ts:284-290`（子树）：`UPDATE notes SET parent_id=COALESCE(deleted_from_parent_id,parent_id),trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1 WHERE id IN (…) AND deleted_at IS NULL` —— **没有 restore_pending_at、没有 cloud_deleted=0**；
  - 对照移动端 `src/mobile/data/trashRepository.ts:249,285`：子树 notes 一律 `restore_pending_at=?`（且 `cloud_deleted=0`）。
  - 判定后果：`src/core/s3v3Decision.ts:50` `if (localPresent && !remotePresent) return "remote-purged-move-to-trash"` —— 恢复标记是唯一例外（:33 `restorePending && localPresent → restore-upload`）；小记侧同型见 `src/core/s3v3Merge.ts:342-350`（注释明写「显式恢复优先于 purge 墓碑」）。
- **影响面**：场景 = 「云端已删除·仅本地」的整树副本（他端 purge 过该树）在桌面被恢复：根（或分组）恢复成功并重传，**子文档下一轮被重新移回回收站**（remote-purged-move-to-trash，`src/core/s3v3Merge.ts:193-196`），用户看到「恢复了笔记本，里面的文档却又消失」；且子文档 `cloud_deleted=1` 不清、又无 restore_pending ⇒ `settleCloudDeleted`（`src/core/s3v3/state/cloudDeleted.ts:27-35` 三种失效情形都凑不齐）⇒ 「云端已删除·仅本地」徽标与 remotePurged 抑制长期残留。数据不丢（副本回回收站可再恢复），但用户动作被静默撤销、两端行为不一致。
- **最小复现思路**：A 端建分组 P + 文档 C，同步；B 端彻底删除 P（整树 purge）；A 端同步（P、C 变「云端已删除·仅本地」回收站副本）；A 端在回收站恢复 P → 检查 `notes.restore_pending_at`：P 若是 note 有标记、C 恒无；A 再同步一轮 → C 被判 remote-purged-move-to-trash 回到回收站（C 行 trashed_at 被重写）。移动同场景 C 不回退。
- **建议修法**：`restoreTrashItem` 级联段对 `subNoteIds` 同步写 `restore_pending_at=now`（与移动 `trashRepository.ts:249,285` 同口径），并在根/子树 UPDATE 里同时 `cloud_deleted=0`（对齐 `electron/syncReconciliation.ts:182` 的 applyRemoteRestore）。

### F2（P2）移动小记「保存」误清 `restore_pending_at`（桌面保留）⇒ 恢复后未同步前编辑保存 = 恢复语义丢失

- **现象**：移动端恢复小记 → 编辑 → 保存，保存语句把恢复标记清掉；桌面保存不清。
- **证据**：
  - `src/mobile/data/quickNotesRepository.ts:252-256`：`ON CONFLICT(id) DO UPDATE SET … deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1 …`（INSERT 分支的列值也是 NULL，:253-254）；
  - 桌面对照 `electron/quickNotes/savePipeline.ts:251-252`：`INSERT … ON CONFLICT(id) DO UPDATE SET …` 的更新列**不含 restore_pending_at**（保留标记），只清 `cloud_deleted=0`；
  - 恢复写标记：`src/mobile/data/quickNotesRepository.ts:373` / `electron/quickNotes/trashLifecycle.ts:130-131`；标记只应由 markSynced 清（`src/mobile/v3/mobileDeviceStore.ts:413`、`electron/quickNotes/index.ts:388-389`）与「重新删除」清（`quickNotesRepository.ts:356`）。
  - 判定后果：`src/core/s3v3Merge.ts:344-350`（restorePending 是压过 purge 墓碑的唯一盾）与 `plan/plan.ts:363-370`（`local-delete && l` → 有 purge 墓碑则 `quick-purge`（**不可恢复**）、否则 `quick-soft-delete`（推回回收站））。`s3v3RemotePurged.test.ts:124-131` 正是这面盾的护栏测试。
- **影响面**：恢复「云端已删除·仅本地」小记后、同步完成前用户编辑并保存（或点「保存并同步」，快路径 `quickPush/pipeline.ts:292` 同样看 `restore` 集合）⇒ 标记已清，下一轮同步按「远端删除权威」把这条小记**重新软删进回收站**（若本地 purge 账本含该 id 则直接 quick-purge 不可恢复），恢复+编辑被静默回滚；`cloud_deleted` 也没被保存清除（移动），标记再靠 `remotelyPresent` 才能 settle，循环成死结。桌面同流程正常。
- **最小复现思路**：移动端恢复一条「云端已删除·仅本地」小记（不开自动同步）→ 打开编辑改一个字保存 → 查 `quick_notes.restore_pending_at`（应仍非空、实测为 NULL）→ 触发同步 → 小记回到回收站。
- **建议修法**：`persistQuickNoteContent` 的 ON CONFLICT 更新集里**去掉 `restore_pending_at=NULL`**（与桌面 savePipeline 对齐）；同句顺手补 `cloud_deleted=0`（活跃写入即已重新拥有）。恢复标记的清除点收敛为 markSynced / 再删除 / purge 三处。

### F3（P2）桌面 `deleteTreeNode` 级联无条件覆写**已 trashed 后代**的 `trashed_at/updated_at`（移动有 `AND trashed_at IS NULL`）⇒ LWW 判据输入被改写

- **现象**：先单独删除子文档 C、后删除其父 P（或批量删除顺序为子→父）时，C 的回收站时间戳被覆写成 P 的删除时刻，`updated_at` 一并被 bump 到 now。
- **证据**：
  - `electron/trashLifecycle.ts:164-166`（tree_nodes）与 `:172-174`（notes）：`UPDATE … SET trashed_at=?,updated_at=?,is_dirty=1,deleted_from_parent_id=COALESCE(…) WHERE id IN (…) AND deleted_at IS NULL` —— **没有 `AND trashed_at IS NULL`**，已 trashed 后代也被重写；
  - 对照 `src/mobile/data/trashSubtree.ts:96,102`：`… WHERE id=? AND trashed_at IS NULL`（保留原删除时刻）；`src/mobile/data/trashRepository.ts:54` 同。
  - 与 AGENTS §3#5「对已 trashed 节点重复删除必须幂等（不改 parent）」的口径相悖（根节点有幂等早退 `trashLifecycle.ts:137-140`，后代没有）。
- **影响面**：① `trashed_at` 语义（进入回收站时刻 / 90 天自动过期钟 `autoPurgeExpiredTrash`，`trashLifecycle.ts:187-190`）被改写；② `updated_at` 是位置三方合并的 LWW 输入（AGENTS §3#24）——人为推新可能**压掉他端并发的恢复**（他端在 T2 恢复 C，本端 T3 级联重戳 ⇒ LWW 本端胜，他端恢复失效）（待复现）；③ `is_dirty=1` 无谓重发布已删条目，索引抖动。
- **最小复现思路**：删除子文档 C（记 trashed_at=T1）→ 再删除父 P → 查 C 行 trashed_at/updated_at（应保持 T1、实测变为 P 的删除时刻）。
- **建议修法**：两条级联 UPDATE 补 `AND trashed_at IS NULL`（与移动同口径）；已 trashed 后代仅在需要时补 `deleted_from_parent_id`（COALESCE 已满足）。

### F4（P2）桌面恢复只给根文档回填 FTS，子树文档恢复后搜不到（移动恢复后有 reconcileIndex）

- **现象**：删除时整棵子树移出搜索账本；恢复时只把根文档塞回索引，子树文档的搜索行不重建。
- **证据**：
  - 删：`electron/trashLifecycle.ts:178` `this.ctx.removeSearch(this.descendantNoteFileIds(id))`（整树下行）；
  - 恢复：`electron/trashLifecycle.ts:261-263` 只对**根**的 note_file_id `upsertSearch`；子树 notes 的 UPDATE 循环（`:284-290`）无任何 upsertSearch；`store.restoreTrashItem`（`electron/store.ts:1527-1529`）只是透传，`ipc/registerNotes.ts:348` 也无重建调用；
  - 移动对照：`src/mobile/bridge/notes.ts:445` 恢复后 `await reconcileIndex(d)`（全量派生索引重建）。
- **影响面**：恢复整个分组/笔记本后，子文档在全文搜索里查不到（直到逐篇编辑保存触发 upsertSearch 或用户手动「重建数据」`store.rebuildSearchIndex`）；删除/恢复不对称 = 派生索引静默缺行（RESILIENCE §1「派生数据可重建」原则下的可见性缺口）。**待复现**：需实测桌面搜索确实只读 FTS 账本、无惰性补建。
- **最小复现思路**：建 P + 子文档 C（能搜到）→ 删 P → 恢复 P → 搜 C 的正文词（预期搜不到，根 P 能搜到）。
- **建议修法**：`restoreTrashItem` 对 `subNoteIds` 批量按 `readNoteCaches` 补 `upsertSearch`（与根同口径），或恢复收尾调一次轻量索引 reconcile。

### F5（P3）移动恢复不删 folders 的 `deleted_from_parent_id`（notes 删、桌面两者都删）⇒ 再次删除时恢复落点可能被静默改写

- **证据**：`src/mobile/data/trashRepository.ts:255`（note 根分支恢复 folders）与 `:278`（folder 分支）：`UPDATE folders SET parent_id=COALESCE(deleted_from_parent_id,parent_id)|?, trashed_at=NULL, updated_at=?, is_dirty=1 WHERE id=?` —— **无 `deleted_from_parent_id=NULL`**；notes 分支有（`:243,249,285`）；桌面两处都有（`electron/trashLifecycle.ts:266,279`）。
- **影响面**：恢复后 folder 残留「原始父」旧值；再次删除时 `COALESCE(deleted_from_parent_id, parent_id)`（`trashSubtree.ts:96`）会取**陈旧**的 dfp ⇒ 第二次恢复落回最初的父（若期间用户把分组移动过新父，位置被静默改写到旧父）；`resolveRestoreParent` 有「父不在位则兜底」护栏（`trashRepository.ts:174-183`）⇒ 不悬空，但落点可能错。
- **最小复现思路**：F 建在 P1 下 → 删 F → 恢复 F → 把 F 移到 P2 → 再删 F → 恢复 F ⇒ 落点 P1（应为 P2）。
- **建议修法**：两处 folders UPDATE 补 `deleted_from_parent_id=NULL`。

### F6（P3）恢复路径 `cloud_deleted` 清除不完整（两端各缺一块）

- **证据**：
  - 桌面 `restoreTrashItem` 根与子树 UPDATE（`electron/trashLifecycle.ts:259,288`）都不清 `cloud_deleted`（notes 与 tree_nodes 两列，schema 见 `electron/schemaInit.ts:196-197`）；对照 `electron/syncReconciliation.ts:182-185`（applyRemoteRestore 清 0）与移动 `trashRepository.ts:243,249,285`（notes 清 0）。
  - 移动恢复不给 folders 清（`trashRepository.ts:278`），也不给 quick_notes 清（`quickNotesRepository.ts:373`）；桌面 quick 恢复清（`quickNotes/trashLifecycle.ts:130-131` INSERT 带 `cloud_deleted=0`）。
- **影响面**：恢复后「云端已删除（仅本地）」徽标/`readonlyReason.cloud-deleted`（`src/core/capabilities/readonlyReason.ts:74`、`src/core/noteInfo.ts:57-59`）残留到下一轮同步的 `applyNotesCloudDeleted`（`electron/store.ts:1877-1891`）才可能清；其中**根级单篇恢复**可由 restore_pending settle 自愈，**F1 的级联子树**（无标记）则长期挂死。folders 的 tree_nodes.cloud_deleted 更是 `applyNotesCloudDeleted` 按 `note_file_id=?` 清（`store.ts:1884-1885`）⇒ 目录行永远不被该函数清（桌面 listFoldersForSync 不投影该列，`noteQueries.ts:264-279`，故桌面目录无此列语义；移动 folders 有列 ⇒ 移动目录恢复后残留）。
- **建议修法**：与 F1 同一补丁：恢复即 `cloud_deleted=0`（notes/tree_nodes/folders/quick_notes 四处），失效判据仍保留 settleCloudDeleted 兜底。

### F7（P3）写守卫与读判据不对称：`noteContentRepository.save` 只看 `trashed_at`，`isGoneNote`/`assertNodeWritable` 还看 `parent=trash`

- **证据**：`electron/noteContentRepository.ts:76-88`（拒写判据 = `is_purged===1` 或 `trashed_at != null`）；`electron/noteMetadataRepository.ts:52-61`（assertNodeWritable = `parent_id===trash || trashed_at!=null || purged`）；`src/core/syncDecisions.ts:81-83`（isGoneNote 同样两者都看）。
- **影响面**：若存在「parent=notebook-trash 且 trashed_at=NULL」的行（可达面：`importRemoteFolder` 只在 `parentId===trash` 时写 trashed_at 且取 `folder.trashedAt ?? null`，`electron/noteMetadataRepository.ts:351-356`；`deleteTreeNode` 对这种行早退（`trashLifecycle.ts:136`）不会补齐标记），读侧判 gone（只读）而用户保存却放行。该行形态实际可达性**待复现**（wire 正常投影下 trashedAt 齐全）。
- **建议修法**：save 的拒写判据与 isGoneNote 对齐（补 `parent === TRASH_NOTEBOOK_ID`），或在 importRemoteFolder 把「parent=trash ⇒ trashed_at 至少给非空哨兵」写实。

### F8（P3）移动端 `trashNote` 路径多表写无事务（`executeBatchInTransaction` 的「已在事务内」前提被破坏）

- **证据**：
  - `src/mobile/data/trashSubtree.ts:106`：`trashSubtree` 无条件调 `executeBatchInTransaction`，而其实现是 `executeSet(statements, { transaction: false })`（`src/mobile/data/sqliteDb.ts:63-72`，注释明写「**已在事务内时使用**」）；
  - `src/mobile/data/noteRepository.ts:344-352` `trashNote` **不包 `d.transaction** 直接调 `trashSubtree`；对照 `trashRepository.trashTreeItem` 包了（`trashRepository.ts:33-38`）。bridge `runWrite` 只是并发写锁、不是 SQL 事务（`src/mobile/bridge/context.ts:184-187`）。
- **影响面**：`bridge.trashNote`（单文档删除，调用方：`bridge/notes.ts:379`、batchNotes:197、导入/分享回滚）在原生 executeSet 路径下**非原子**：批中途中断（桥异常/杀进程）留下「部分子树已 trashed、部分没有」的半软删状态，正是 261114 级联修复要消灭的悬空行形态。AGENTS §3#9「多表写必须事务」违例。**待复现**：需在设备上以故障注入验证。
- **建议修法**：`noteRepository.trashNote` 用 `d.transaction` 包住 `trashSubtree`（与 trashTreeItem 同），或让 `trashSubtree` 内部改用自带事务的 `executeBatch`（`sqliteDb.ts:53-61`）并给「谁负责事务」写死约定。

### F9（P3）便携包（桌面→移动）丢弃 `restore_pending_at` / `cloud_deleted`（移动→桌面方向保留）【与审计⑤交叉】

- **证据**：`src/mobile/portable/portableMapping.ts:263,295,316` 硬编码 `restore_pending_at: null`（同段 `cloud_deleted: 0`、`is_dirty: 0`）；反向 `electron/portable/mobileToDesktopMapping.ts:256` `restore_pending_at: asText(row.restore_pending_at)`、`importMobileSnapshot.ts:189-204` 原样带入。
- **影响面**：迁移时源机存在「已恢复未同步」的文档/小记，到新机后 local-wins 标记丢失 ⇒ 首轮同步按远端删除权威回退（同 F1/F2 机理）；「云端已删除·仅本地」副本迁移后丢失徽标/抑制位。是否被 bootstrap 合成基线语义兜住属于审计⑤（bootstrapBaseline）范围，此处只登记**两端映射不对称**。**待复现**。
- **建议修法**：portableMapping 带出 `restore_pending_at`（或迁移收尾统一「视为已同步」并在文档里明示该裁决）；与审计⑤结论对齐。

---

## 二、已核实无问题（点名查过什么、为何没问题）

1. **restore_pending_at 全仓读写点清点**（grep 全仓）：写入点仅 恢复（`trashLifecycle.ts:259`、`quickNotes/trashLifecycle.ts:130`、`trashRepository.ts:243/249/285`、`quickNotesRepository.ts:373`）；清除点仅 markSynced（`store.ts:1853/1866`、`syncReconciliation.ts:75/88`、`quickNotes/index.ts:388`、`mobileDeviceStore.ts:413/233`、`mobilePlatformPort.ts:592`）、再删除（`trashLifecycle.ts:147/173`、`trashSubtree.ts:102`、`trashRepository.ts:65`、`quickNotesRepository.ts:356`）、purge/远端 purge（`syncReconciliation.ts:201-204/242`、`mobilePlatformPort.ts:484/498/665/670`）。读取点仅同步投影（`store.ts:1900`、`syncReconciliation.ts:111`、`quickNotesQueries.ts:122`、`mobilePlatformPort.ts:292/296`、`mobileDeviceStore.ts:227`）。**除 F2/F9 外无当可见性开关/备份过滤/FTS 过滤的误用**。
2. **261124 可见性修复已到位**：移动小记列表 `quickNotesRepository.ts:131-137`（只看 deleted_at）、小记搜索 `quickNotesSearch.ts:57,90`、缺正文清册 `missingBodies.ts:194`；桌面小记可见性是**结构性**的（软删行离开 quick_notes 进 quick_note_deleted，`quickNotesQueries.ts:86-91` 无 restore 过滤）。
3. **缺正文不会发空正文上云**：桌面 `desktopStoreAdapter.readBody:163-174`（bodyMissing → null + 入恢复队列）、`readQuickBody:193-196`（ENOENT → null）；quickPush `pipeline.ts:345-346` null 即抛 `quick-body-missing`；整轮 `buildPublishIndex.ts:18,44-47` 把「正文缺失」归入 failedUploads ⇒ 回退远端旧条目/移出索引，绝不写空字节；`engineBridge.ts:234-235` bodyFailed 条目不认领索引 hash；`quickNotesQueries.listForSync:100-110` 缺正文行跳过。与 RESILIENCE「同步绝不上传空正文」一致。
4. **isGoneNote 打开入口覆盖（trashedAt 必传）**：桌面唯一 tab 构造器 `useTabLifecycle.ts:67-91`（`:83 deleted: isGoneNote(note)`）覆盖 openNote/restoreTabs，`useSyncRefresh.ts:103` 重算、`noteRef.ts:76-81` 同判据；移动 `MobileApp.tsx:823-829`（openNote → TrashPreviewPage 只读预览）、`:863-875`（**openDiaryEntry 已补判**，261112 审计 M1 缺口已修）、`useNotebookTabs.ts:161-175`、`useWorkspaceSession.ts:63-71` 均传 trashedAt；`noteRepository.noteGoneState:164-175` 回传 trashedAt。
5. **写守卫分层（AGENTS §3#23）复核无新增违例**：`assertNodeWritable`（`noteMetadataRepository.ts:52`）只挂 U 类入口（renameTreeNode:184 / setNodeIcon:203 / setNoteEditLocked:309）；同步端口走镜像写（`desktopPlatformPort.ts:122-127` → `applyRemoteEditLock`/`applyRemoteNodeIcon`，后者允许回收站行、purged 拒绝，`noteMetadataRepository.ts:223-236`）；正文用户守卫在 `noteContentRepository.save`、同步走 `saveSyncedNote → save(allowTrashed)`（`electron/store.ts:1015-1018`、`deviceStore.ts:677-678` 只对 trashed 行分叉）；移动用户守卫在 `noteRepository.saveNote:279-307`（含写入后二次守卫 + 回滚正文），同步走 `mobilePlatformPort.applySyncedBody`（不带用户守卫，允许回收站行收正文）。
6. **编辑锁守卫位置正确**：锁只在 UI/入口拦（桌面 `MultiTabEditor` readOnly+保存 return；移动 `NotePaneHost.tsx:86,96` 强制只读 + `useNotebookTabs.ts:201,225`），底层写函数不查 is_locked（同步必须能写锁定行，AGENTS §4 编辑锁条）；`applyRemoteEditLock` 为镜像写（`noteMetadataRepository.ts:318-321`），`setNoteEditLocked` 带用户守卫（:307-316）——分层与契约一致。
7. **软删保留正文/资源 vs purge 删文件**：桌面 `deleteSourceAndRemember(keepFiles=true)`（`quickNotes/trashLifecycle.ts:45-54,169-189`）/ `purgeQuickNote` 删 item+asset 目并留墓碑（:156-166）；移动 `deleteQuickNote` 只标 deleted_at（`quickNotesRepository.ts:355-357`）、`purgeQuickNote` 删正文+整份资产目录并写 purged_at 墓碑（:377-397）；`removeUnsyncedQuickNote` 仅用于未同步的转换回滚（`diaryQuickNoteConversion.ts:166,173`、`diaryToQuickNote.ts:143,155`），不产生云端复活面。
8. **purge 幽灵行/复活面**：`schemaInit.removeResurrectedAfterPurge:254-277` 判据 = 活跃行 + 有 deleted_notes 墓碑 +（welcome-note 或父节点不在位/已删/已 trashed），输入正确（父判定走 tree_nodes、含 note 类父）；墓碑保留 = 彻底删除语义；`seed()` 三条件（`:279-289+`）防复活；`rebuildRecoveredNotes` 也拒绝有墓碑 id（`store.ts:963-967`）。
9. **级联集合口径与 purge 幂等**：桌面 `flattenedSubtreeIds`（`trashLifecycle.ts:98-111`，parent 边 ∪ dfp+trashed 边 + UNION 去重 + deleted_at 过滤）与移动 `collectSubtree`（`trashSubtree.ts:32-79`，双边 + visited + 20 万上限）口径一致，delete/restore/purge 三处共用；purge 幂等：`emptyTrash`/`autoPurgeExpiredTrash` 对已连带删除的根按 NotFound 跳过（`:202-205,408-411`），移动 `purgeTreeItem` G5 事务内守卫 + `expiredBefore` 事务内重判（`trashRepository.ts:349-358`）不越过用户恢复；两端 purge 都写 folder+note 墓碑、清 orphan_assets/note_history。
10. **日记本不可删除**在 delete/autoPurge/emptyTrash/purge（桌面 `assertNotDiaryNotebook` + 两处 skip）与移动（`assertNotDiaryNotebook` + purge 返 false 不抛）都有；后台路径不抛错。
11. **unloadGuard**（`src/core/unloadGuard.ts:18-23`）判据 = `dirty && !deleted && !isSaveFailed`，deleted 由 isGoneNote 派生（`useTabLifecycle.ts:83`），gone 时同步清 dirty（HANDOFF §7#12b 口径）——无「恢复标记当开关」类误用。
12. **restore 落点回执**：桌面 `restoreTrashItem` 返回 `fellBack`（`trashLifecycle.ts:212-249,313`，含 SQL 三值逻辑显式允许 NULL 父的修复）；移动 `resolveRestoreParent` 同语义（`trashRepository.ts:163-198`，261124 同事故口径）——原位不可用都会如实报落点，无静默换家。

---

## 三、建议新增护栏（测试名 + 断言要点）

1. `electron/trashCascadeRestore.test.ts` — **F1**：删分组 P（含子文档 C）→ 造 C 的「云端已删除」态 → `restoreTrashItem(P)` ⇒ 断言 C 行 `restore_pending_at` 非空、`cloud_deleted=0`；再喂 `planLakeMerge`（base 有/远端无）断言 C 判 `restore-upload` 而非 `remote-purged-move-to-trash`。
2. `src/mobile/data/quickNoteRestorePending.test.ts` — **F2**：`restoreQuickNote` 后 `saveQuickNoteContent` ⇒ 断言 `restore_pending_at` **保持非空**、`cloud_deleted=0`；镜像补桌面断言（savePipeline 更新不清标记）。
3. `electron/trashCascadeIdempotent.test.ts` — **F3**：先删 C 后删 P ⇒ C 的 `trashed_at/updated_at` 保持第一次删除的值（对齐 `src/mobile/data/trashCascade.test.ts` 同断言）。
4. `electron/trashRestoreSearch.test.ts` — **F4**：删 P（含 C）→ 恢复 P ⇒ 断言 C 的 FTS 账本行恢复（与根同口径），或断言恢复收尾触发索引 reconcile。
5. `src/mobile/data/trashRestoreDfp.test.ts` — **F5**：恢复 folders 后 `deleted_from_parent_id IS NULL`；「移过位置再删再恢」落点 = 最新父。
6. `src/mobile/data/trashNoteAtomic.test.ts` — **F8**：注入 executeSet 中途失败 ⇒ 断言子树软删**全有或全无**（无半软删），并断言 `trashNote` 与 `trashTreeItem(note)` 两条入口行为一致。
7. 便携包回归（挂到审计⑤的迁移套件）— **F9**：源机「已恢复未同步」小记/文档经 portable 导入 ⇒ `restore_pending_at` 语义保留（或明示裁决为「迁移即已同步」并断言无回退）。

---

## 四、自检

- F1–F9 每条均给出 文件:行 与引用语句；影响推导链标注了判定函数（`s3v3Decision.ts:50`、`s3v3Merge.ts:344-350`、`plan.ts:363-370`、`cloudDeleted.ts:27-35`）。
- F1 的「子树被回滚」、F3 的「压掉他端恢复」、F4 的「搜不到」、F8 的「半软删」、F9 的「迁移回退」均标 **待复现**（静态推导 + 既有护栏测试语义佐证，未跑设备/未跑全量测试）。
- 未改动任何产品代码；本文件为唯一产出。
