# 审计②：应用/落库层（deviceStore / platformPort×2 / applyPlan / pullRound 写路径）

> 只读审计，261124 P0 事故族（改写值当 diff 输入 / 判据拿错输入 / 状态标记挪用 / 读写可见性）专项复查。
> 判据来源：docs/SYNC-PROTOCOL.md §9.5/§9.6/§10.3/§21 → AGENTS.md §3#3/#5/#23/#24。
> 纪律：协议裁决（删除压编辑、墓碑权威、恢复唯一例外、冲突不合并、小记不备份）不算 bug；只报「实现与协议不符 / 判据输入错误 / 边界态丢数据」。不确定处标「待复现」。

## 一句话结论

落库层仍有 **4 个 P1 同类缺陷**：①「本地有云端没有」的未同步小记在全量重拉时被移动端**物理删除**（违反 pullRound 自己的「绝不物理删除」契约）；② `deleted_from_parent_id` 在「移动 deleteNote 不写 → wire 不带原父 → 桌面无条件覆盖成 null」的跨端链路上**丢失**，导致恢复静默换家、purge 漏删子树；③ 首次相遇「下载落小记回收站」因清扫遍历**过期快照**而失效，远端小记直接落进用户活跃列表；④ 缺正文/瞬时读失败的行会被 saveState 收敛分支**连子树一起静默拖进回收站**。另有 5 个 P2（COALESCE null 语义、updated_at-only 永不定居、remotePurged 判据漏 folders、移动端 deleteTreeNode 硬删、icon 清除不传播）和一批 P3 观察。核心机制（261124 的 parentScope、keepLocalTrash、基线判据）本身已核实无问题。

---

## 发现列表

### P1-1 「本地有云端没有」的未同步小记在移动端被物理删除（判据/契约冲突 + 边界态丢数据）

- **现象**：pullRound（全量重拉：resetFromCloud / 首次相遇）把「本地有、云端没有」的小记从世界里移除并标 remotePurged，saveQuickNotes 的 quick-missing 三态判定对「不在 baseline（从未同步过）」的行调 `discardQuickNote` = **物理删行 + 正文 + 图片、不留墓碑**。
- **证据**：
  - `src/core/s3v3/commit/pullRound.ts:5-7`（头部契约：「本地有、云端没有 ⇒ …软删进回收站…正文/附件/历史保留，**绝不物理删除**」）与 `pullRound.ts:73-77`（quick 侧只 `purged.add(q.id)`，条目不进 `trashedLocal` 等价物，`state.quickNotes = remote.quickNotes` 直接丢弃）；
  - `src/core/s3v3/state/deviceStore.ts:545-577` 三态判定，尤其 `deviceStore.ts:569-571`：`else if (!knownCloud && p.discardQuickNote) await p.discardQuickNote(cur.id);`，判据 `knownCloud = cur.cloudDeleted === true || baselineQuickIds.has(cur.id)`（`deviceStore.ts:483-485`）；
  - `src/mobile/v3/mobilePlatformPort.ts:679-688`（discardQuickNote：DELETE 行 + 删正文 + 删图片 + 清关系，注释自述「不留墓碑/不传删除」）；
  - `src/core/s3v3/state/platformPort.ts:253-255`（端口契约把这个破坏性语义文档化为「移动旧语义」）；
  - `src/mobile/v3/mobileDeviceStore.ts:175-176`（团队自认：「基线丢失 ⇒ 快路径硬失败，**绝不回退整轮 pull-all（会物理丢弃未同步小记）**」—— 危险已知，但只在 quickPush 回退路径堵了口，pullRound 本身没堵）。
- **影响面**：手机离线随手记的小记（尚未上传、不在 baseline）在用户执行「全量重拉/以云端为准」时**永久消失**（行+正文+图片）。桌面因不实现 discardQuickNote 回落软删+打标（`deviceStore.ts:549` 注释），两端行为分叉。与 SYNC-PROTOCOL §21「绝不物删」红线（`deviceStore.ts:554` 引用）直接冲突。
- **最小复现**：手机关同步记 2 条小记 → 设置里触发 resetFromCloud（或首次相遇选「以云端为准」）→ 小记列表为空，回收站也没有（桌面同场景进小记回收站+「仅本地」标）。
- **建议修法**：saveQuickNotes 的「state 缺失」分支对 pullRound 语义统一走「软删进小记回收站 + cloud_deleted」；`discardQuickNote` 仅保留给「本地自己判定的从未同步」窄场景或直接退役（§3#7：能删了重建就不留兼容）。
- **状态**：机制链已逐行核实；破坏性与契约冲突确凿。是否属「移动旧语义既定裁决」待产品裁决 —— 但 loadQuickPushSnapshot 的注释表明团队已把它当危险面。

### P1-2 `deleted_from_parent_id` 跨端链路丢失（判据输入错误 + COALESCE 语义不一致 → 恢复丢落点 / purge 漏删子树 / 每轮重写）

- **现象**：四段实现对 dfp 的 null 语义各不相同，串起来会把「删除前原父」在跨端同步中抹掉：
  1. **移动 deleteNote 不写 dfp**：`src/mobile/v3/mobilePlatformPort.ts:481-487` 远端墓碑→回收站只写 `trashed_at`（对照移动用户删除路径 trashNote/trashTreeItem 是写 dfp 的，见 `src/mobile/data/trashLifecycleColumns.test.ts:35-59` 的钉子）；
  2. **wire 投影不带原父**：`src/core/s3v3/plan/positionMerge.ts:34-43` positionOf 对 trashed 条目 `parentId → null`、`deletedFromParentId: entry.deletedFromParentId ?? null` —— 没有「移动端保留原父」的兜底回填（同一函数的注释 `positionMerge.ts:31` 明说「移动端保留原父」是已知形态）；
  3. **桌面无条件覆盖**：`electron/syncReconciliation.ts:126-140`（`deletedFrom = inTrash ? (note.deletedFromParentId ?? null) : null` 后 `UPDATE … deleted_from_parent_id=?` 直写）与 `electron/remoteImportRepository.ts:112-125`（ON CONFLICT DO UPDATE `deleted_from_parent_id=excluded.deleted_from_parent_id`）；而**同一文件**的 `syncReconciliation.ts:166`（applyRemoteMoveToTrash）却用 `COALESCE(deleted_from_parent_id,?)` 保留旧值 —— 一个文件两种 null 语义；
  4. **移动 restoreTrashItem 不清 dfp**：`mobilePlatformPort.ts:504-508` 只清 trashed_at ⇒ 恢复后的活跃行带着残留 dfp 进入下一次 positionOf（活跃条目 dfp≠null 与对端 null 永久分歧）。
- **影响面**：
  - 桌面行 dfp 被抹 null 后，`restoreTrashItem` 的原父解析取 `node.deleted_from_parent_id`（`electron/trashLifecycle.ts:218-218`）⇒ 恢复**静默换家到「未分类」**；且 `trashLifecycle.ts:218-221` 的 `parentId === null` 分支不置 `fellBack` ⇒ UI 的「恢复落点如实提示」（261124 事故的修复）在这个入口又失效；
  - purge 的两路边集合 `parent_id ∪ deleted_from_parent_id+trashed_at`（`trashLifecycle.ts:88-105`）dfp 边失效 ⇒ `trashLifecycle.ts:163` 注释预言的「子文档漏删、云端索引残留」；
  - 活跃行 dfp 残留（第 4 点）会让 `deviceStore.ts:738` 的 `effDeletedFrom !== cur.deletedFromParentId` **每轮为真** ⇒ 每轮 applyRemoteNoteMeta 一次、永不收敛（P0「每轮必写」同型）。
- **最小复现**：桌面把文档移入回收站（dfp=原父）→ 手机同步跟随墓碑（deleteNote 不写 dfp）→ 手机再发布（positionOf 丢原父，wire dfp=null）→ 桌面拉回后查 `notes.deleted_from_parent_id` 变 NULL → 恢复该文档落到「未分类」而不是原笔记本。
- **建议修法**：① positionOf 对 trashed 条目补 `deletedFromParentId ?? entry.parentId`（移动端保留原父形态归一）；② 桌面两处 dfp 写入改 COALESCE 保留（incoming null = 未知，不是显式清除）；③ 移动 deleteNote 补 `deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id)`（对齐其 purgeLocalNote `mobilePlatformPort.ts:495-503` 的写法）、restoreTrashItem 清 dfp。
- **状态**：四处代码逐行核实；端到端时序待真机复现。

### P1-3 首次相遇「下载落小记回收站」失效：清扫遍历过期快照 + quickDeletes 账本不回读（读写可见性，P0 同族）

- **现象**：`quick-soft-delete + apply-remote` 同轮到达的「下载落小记回收站」条目（SYNC-PROTOCOL §21 local-wins：下载内容 + 落回收站 + 发布缺席）实际落在**活跃列表**：
  1. `saveQuickNotes` 先跑 wanted 物化循环（`deviceStore.ts:494-536`，importRemoteQuickNote 建的是 **active 行**，两端皆然）；
  2. quickDeletes 清扫循环遍历的是 `saveQuickNotes` 开头的 `current` 快照（`deviceStore.ts:471`）—— **本轮新建的行不在快照里**，`deviceStore.ts:557` 的 `quickDeletes.includes(cur.id)` 分支永远够不到它；
  3. 下一轮救不回来：loadState 的 `quickDeletes` 只从 DB 重建（`deviceStore.ts:330` `listQuickDeleted()`，行没有 deleted_at ⇒ 不含该 id），信封里持久化的 quick-delete 记录（`intentLogState.ts:115` 写、`:251` ledgerOf 可读）**在 loadState 中被丢弃不合并**；而 trashOverride 只在 encounter 轮产生（`s3v3Merge.ts:413-418`），之后不再补判。
- **证据**：`src/core/s3v3/state/deviceStore.ts:471` / `:494-536` / `:550-557`；`src/core/s3v3/commit/engineBridge.ts:137-147`（quickTrashDownloads 判据注释「再由清扫的 quickDeletes 分支软删进回收站」—— 设计预期落空）；`src/core/s3v3/plan/plan.ts:354-357`（trashOverride → quick-soft-delete + 发布缺席）；`src/core/s3v3/state/intentLogState.ts:115,251` vs `deviceStore.ts:330`。
- **影响面**：用户选「以本地为准」后，对端的小记**直接出现在本端活跃小记列表**（应进小记回收站、不打扰用户）；条目此后以 active 身份参与世界（不发布、但可见可编辑），语义与 §21 及 `plan.ts:355` 注释（「下载内容 + 落小记回收站 + 发布缺席（绝不物删）」）不符。
- **最小复现**：A、B 两设备；B 有 1 条小记并同步；A 首次相遇选「以本地为准」→ A 完成同步后小记列表出现 B 的小记（预期：只在小记回收站）。
- **建议修法**：物化循环后重读一次 quick 行集合再清扫（或清扫循环并入「本轮物化 id」）；或者干脆在物化时直接带软删落点（importRemoteQuickNote 增加 deletedAt 参数），并让 loadState 把信封 quickDeletes 与 DB 列表取并集（对齐 intents/restorePending 的既有口径 `deviceStore.ts:337,350`）。

### P1-4 缺正文/瞬时读失败的行被 saveState 收敛分支静默拖进回收站（连子树级联）

- **现象**：桌面 listNotesSyncMeta 恒回空 contentHash（`electron/store.ts:605-625` 的 `'' AS content_hash`）⇒ loadState 对每行做 stat/read 补算 hash；`stat` 为 null 或 `read` 返回 null 就 `continue` 丢行（`deviceStore.ts:282-300`）。而 FileDriver **吞掉一切 IO 错误**（`electron/s3v3/nodeFileDriver.ts:8-31` read/stat catch→null；移动 `mobilePlatformPort.ts:709-727` readPath 同样 catch→null）⇒ 瞬时读失败与「文件真没了」不可区分。丢掉的行在 `saveState` 收敛循环（`deviceStore.ts:786-795`）里命中「行在、本轮世界没有」⇒ 桌面 `deleteNote` = **deleteTreeNode 级联软删整棵子树**（`electron/store.ts:1455-1457` → `trashLifecycle.deleteTreeNode`），移动端 `purgeLocalNote` = 软删 + 误打「云端已删除·仅本地」标（`mobilePlatformPort.ts:495-503`，状态标记挪用：本地缺正文被标成「云端删除」）。
- **补充证据**：`bodyRecoveryPending` 队列只由体检喂（`electron/store.ts:1789-1799`「正常同步不扫描」），且 `deviceStore.ts:583` 的 markBodyRecoveryPending **不拦收敛循环** —— 「缺正文」产品语义（AGENTS §4：只读面板 + 资源页可恢复，绝不静默丢弃）与收敛删除相撞。
- **影响面**：① 手动删了 .lake 文件（AGENTS §4 明说支持的场景）且云端无该条（从未上传/已被他端 purge）⇒ 该文档**连同其子文档树**静默进回收站，资源页「缺正文」入口同时失效；② 瞬时 IO 抖动（EMFILE/EACCES 等）在同步窗口内发生同样触发。云端有该条时走恢复路径（`deviceStore.ts:680-683`）无恙。
- **最小复现**：本地新建一篇带子文档的文档（未上传）→ 删掉它的 .lake 文件 → 触发一次成功同步 → 文档树里整棵消失（回收站可见）。
- **建议修法**：收敛循环跳过「行在但正文缺」的行（或 loadState 对这类行保留条目并置 bodyRecoveryPending，让云端恢复/资源页接管）；FileDriver 层区分 ENOENT 与其它错误（其它错误抛出 = 整轮失败，宁可不写不可错删）。

### P2-5 移动端 COALESCE(?, parent_id) 把「显式 null（根层）」当「保留旧值」—— 位置合并赢家为根层时变更丢失

- **证据**：`src/mobile/v3/mobilePlatformPort.ts:413-422`（applyStagedBodyNote：`parent_id=COALESCE(?, parent_id)`，且 `snap` 更新 `if (parentId !== null) snap.parent_id = parentId` —— null 赢家双重丢）、`:441-446`（applyRemoteNoteMeta 活跃行同一 COALESCE）。对比桌面 `syncReconciliation.ts:138-140` 直写 `parent_id=?`，null 可正常落库。
- **影响面**：位置三方合并赢家是「显式 null（根层）」（如 P1-2 链路制造出的 parent=null 条目、或远端把条目移到根）时，移动端行 parent 保持旧值 ⇒ 行与 state/发布面永久分歧，metaDiffers 每轮为真重写。触发前提是 active+parentId=null 条目（正常 UI 造不出，主要由 P1-2/坏数据/旧索引产生）。
- **最小复现**：构造 active 且 parentId=null 的索引条目同步到手机 → 查 `notes.parent_id` 仍为旧父。**待复现**（依赖 P1-2 或脏数据先制造 null 父）。
- **建议修法**：端口接收 `parentId: string | null | undefined`，undefined=未声明走 COALESCE、null=显式根层直写（与 icon 的三态语义对齐）。

### P2-6 移动端 applyRemoteNoteMeta 对「仅 updated_at 变」的条目不落库 ⇒ metaDiffers 永真、每轮重放 apply-remote

- **证据**：`mobilePlatformPort.ts:441-454`：写库条件只有 `titleChanged`（title/parent 变）与 `metaChanged`（icon/锁/sort 变）；**仅 updated_at 不同**（如远端「改了又改回」、纯时间戳漂移、tags-only 更新带新 updatedAt）两条件皆假 ⇒ 一条 SQL 都不发。而 `deviceStore.ts:730-732` metaDiffers 含 `n.updatedAt !== cur.updatedAt` ⇒ 每轮调 applyRemoteNoteMeta；下一轮 `s3v3Merge.ts:388-390` 的 none 分支 `remoteMetaNewer = rr.updatedAt > ll.updatedAt`（ll 来自行、永不前进）⇒ 再发 apply-remote。桌面 `syncReconciliation.ts:138-140` 无条件写 updated_at ⇒ 收敛，两端分叉。
- **影响面**：受影响条目每轮重放一次 apply-remote（计划/网络放大），state 与行 updatedAt 永不一致（后续 markSynced/快照守卫的判据输入也被污染）。
- **最小复现**：A 端改标题再改回（updatedAt 前进、字段回到原值）→ 同步到手机 → 此后每轮同步日志都出现该条 apply-remote。**待复现**（需构造 updated_at-only 差异）。
- **建议修法**：applyRemoteNoteMeta 无条件对齐 `updated_at`（或把 updated_at-only 差异并进写库条件）。

### P2-7 saveState 的 remotePurged 收敛判据拿错输入：hasNote 不含 folders ⇒ 目录「仅本地」副本标记被误清

- **证据**：`deviceStore.ts:804-809`：`for (const id of state.remotePurged ?? []) if (await p.hasNote(id)) remotePurged.push(id)` —— hasNote 契约是文档/小记（`platformPort.ts:158`；移动实现含 quick_notes 但**不含 folders**，`mobilePlatformPort.ts:320-327`，同文件 hasTreeNode 才查 folders）。folder id 因此每轮被从信封 remotePurged 清掉；移动端 `applyCloudDeletedProjection`（`mobilePlatformPort.ts:356-371`）先全清 cloud_deleted 再按（已滤掉 folder 的）列表重标 ⇒ 目录副本的「云端已删除·仅本地」徽标一轮内消失。随后该副本被 plan 的 remote-purged-trash → remove-folder（`s3v3Merge.ts:250-257`、`plan.ts:318`、`engineBridge.ts:163`）送进收敛删除 —— 移动端是硬删（见 P2-8）。
- **影响面**：对端 purge 目录后，本端应保留的「可恢复回收站副本」徽标/标记丢失并最终被删（子文档 parent 悬空 → 下一轮被 resolveRemoteParent 改写到「未分类」，P0 同型）。
- **最小复现**：A purge 一个含文档的分组 → B 同步 → B 连续跑两轮同步，查 `folders.cloud_deleted` 与回收站副本。**待复现**。
- **建议修法**：判据改 `hasNote(id) || hasTreeNode(id)`（或端口给 `hasAnyNode`）。

### P2-8 移动端 deleteTreeNode = 硬删行，与桌面（软删+级联）语义相反 —— saveFolders 收敛 / remove-folder / pullRound 丢目录三处都踩

- **证据**：`mobilePlatformPort.ts:539-541`（`DELETE FROM folders WHERE id=?`）vs `desktopPlatformPort.ts:150-152` → `electron/trashLifecycle.ts:130-180`（软删进回收站 + 子树级联）。端口契约只写「删除目录树节点」未定义软/硬（`platformPort.ts:226-227`）。调用点：`deviceStore.ts:454-458`（saveFolders 收敛「本轮 state 没有」的目录）、`engineBridge.ts:158-163`（remove-folder）、pullRound 后本地独有目录从世界消失（`pullRound.ts:126` `folders: remote.lake.folders`）。
- **影响面**：移动端「对端已删/重拉后本地独有」的目录**行直接消失**（名称/图标/层级不可恢复），违背 AGENTS §3#5「被他端判定缺失的本地副本保留在回收站」；其子文档 parent_id 悬空，下一轮被 `resolveRemoteParent`（`deviceStore.ts:209-222`）改写到「未分类」。桌面同场景软删进回收站（deleteTreeNode 对已在回收站的行幂等返回，`trashLifecycle.ts:134-135`）。
- **最小复现**：手机离线建分组+文档 → resetFromCloud → 分组行消失、文档跑到「未分类」（桌面：整棵在回收站可恢复）。**待复现**。
- **建议修法**：移动端 deleteTreeNode 对齐桌面软删语义（trashed_at + dfp + 可恢复），或端口拆 `softDeleteTreeNode` / `hardDeleteTreeNode` 由 core 显式选择。

### P2-9 icon「显式清除」跨端不传播：loadState 投影把 null icon 丢成 undefined

- **证据**：`deviceStore.ts:304`：`...(n.icon !== null && n.icon !== undefined ? { icon: n.icon } : {})` —— 行 icon=null（用户清除了图标）在 state 里变成「字段缺失」⇒ 发布面无 icon 字段；收端 `syncReconciliation.ts:141-149` 的语义是「undefined=未声明保留本地图标，null=显式清除」—— 但没有任何发布路径能产生 null（投影已丢）。
- **影响面**：A 清除图标后 B 永远保留旧图标，两端永久分叉；B 若因 metaNewer 反向应用也不会清 A…（A 的清除被 B 的旧图标回填：B 发布带 icon 的条目、A 的 metaDiffers `deviceStore.ts:739` 命中 ⇒ 图标「删了又回来」）。
- **最小复现**：A 删文档图标 → 同步 → B 仍有图标 → 再同步 → A 图标复活。**待复现**。
- **建议修法**：投影保留 `icon: null` 并让发布显式写 null（对齐 tagIds「空集合也显式写」的先例，`plan.ts:480-482`）；或协议改「absent=清除」（需评审）。

### P3-10 keepLocalTrash 的 metaNote.parentId 固定写 TRASH ⇒ 级联软删子文档被扁平化为回收站根（已知、有缓解）

- **证据**：`deviceStore.ts:648`（resolvedParentId = keepLocalTrash 时恒 TRASH_NOTEBOOK_ID，而非 `cur.parentId`）+`:725-727`；桌面 `syncReconciliation.ts:126` 以 parentId===TRASH 判 inTrash。后果：级联软删的子文档（parent=原父、trashed_at 有值）被改写 parent=回收站根。
- **缓解核实**：purge/restore 两侧都显式覆盖「被同步扁平化」形态（`trashLifecycle.ts:88-105` 两路边集合；`:270-289` 恢复时 `COALESCE(deleted_from_parent_id,parent_id)` 归位），不丢数据。残余问题：回收站面板把扁平化子文档显示为独立根；keepLocalTrash 首轮有一次 parent 改写（改写值参与一次 diff，随后收敛）。
- **建议**：keepLocalTrash 时 parent 用 `cur.parentId`（真正「位置归本地」），可顺带消掉扁平化。P3。

### P3-11 saveState 正文应用的「未变才应用」判据是死代码

- **证据**：`deviceStore.ts:665`：`const contentChanged = staged || (content !== null && sha256Hex(...) !== curHash);` —— `content !== null` 蕴含 `staged === true`（`:636-638`）⇒ 第二个析取项恒不可达，`contentChanged ≡ staged`。同步窗口内用户编辑的正文会被 staged 远端正文直接覆盖（archiveLocal 只归档的是快照版本）。
- **影响**：I2「未变才应用」在正文落库面缺一层；触发需「窗口内编辑 + 远端同轮改」竞态。**待复现**。
- **建议**：以 `previous` 的 contentHash 判「本地自快照未变」再覆盖，否则留下一轮三方合并。

### P3-12 移动批窗口异常路径会静默丢已排队语句

- **证据**：`mobilePlatformPort.ts:339-348`（`beginWriteBatch` 重置 `batch` 对象、`flushWriteBatch` 才提交）；`deviceStore.ts:783-784` moveStagedBodyFiles 在 flush 之前，若它或循环外代码抛错 ⇒ flush 不执行、正文已搬，下一轮 beginWriteBatch 把旧 `batch` 直接覆盖（已排队行写入无声消失）。
- **建议**：beginWriteBatch 时若旧 batch 非空则告警/先 flush；flush 移到 moveStagedBodyFiles 之前或用 try/finally。P3。

### P3-13 loadState 的 remotePurged 排序不对称

- **证据**：`deviceStore.ts:380`：`remotePurged: hasDbProjection ? [...purged].toSorted() : [...purged]` —— 只有 DB 投影时排序；信封字节稳定性随输入顺序漂移（无语义影响，诊断噪声）。P3。

### P3-14 移动端 hasNote 含 quick_notes ⇒ 小记 id 可被判为合法父文档

- **证据**：`mobilePlatformPort.ts:320-323`（hasNote = notes ∪ quick_notes），`deviceStore.ts:211-212` resolveRemoteParent 用 hasNote 认「文档当父」。坏数据（parent 指向小记 id）会被放行为合法父。P3（纵深防御）。

### P3-15 目录没有 keepLocalTrash：本地回收站目录可被远端 LWW 隐式恢复（与文档侧裁决不一致）

- **证据**：`deviceStore.ts:421-459` saveFolders 无「本地回收站 + 远端 active」保护；`noteMetadataRepository.ts` applyRemoteFolderMeta（`electron/noteMetadataRepository.ts:390-412`）按 parentId 判 inTrash 直写 trashed_at（仅日记本有 keepDiaryPlacement 保护）。文档侧同场景被 keepLocalTrash（`deviceStore.ts:641-646`，261112 裁决「绝不因远端 active 隐式恢复」）挡住。按 §9.5「两边都动 → updatedAt LWW」目录行为协议内，但与文档侧裁决不对称：同一次「A 删、B 移动」竞态，文档留在回收站、目录复活。P3（语义一致性问题，需裁决哪侧是对的）。

---

## 已核实无问题清单

1. **261124 P0 修复本体**：`resolveRemoteParent`（`deviceStore.ts:209-222`）「目录 → 文档 → parentScope → 兜底」链正确；`resolveRemoteFolderParent`（`:225-234`）trashed 归 TRASH 先于 notebook 判定；parentScope 在任何落库前构建（`:586-589`）；`foldersParentsFirst`/`notesParentsFirst`（`:393-418`/`:613-626`）父先子后 + 防环深度上限。逐条核对了批窗口内其余「读自己写入」点：applyRemoteNoteMeta 的 updated_at SELECT（`mobilePlatformPort.ts:428`）只在 expected 有值时影响判据，而该路径的行必然已存在；applySyncedBody 的 doc_kind SELECT 同理；setNodeIcon 有 importedIds 防重（`:476`）—— 除 P2-6/P3-12 外未见同类。
2. **keepLocalTrash 判据输入正确**：`deviceStore.ts:628-633` 显式用**云端基线** `baselineTrashedIds`（不是 previous/state），P0「拿改写后快照当基线」的教训已吸收；例外条件（基线本就 trashed / restore_pending）与 AGENTS §3#4 一致。
3. **metaDiffers 的 eff 字段已与落库值对齐**：`deviceStore.ts:728-739` keepLocalTrash 时 effTrashedAt/effDeletedFrom 取 cur 的生命周期值，diff 输入 = 将写入值，不再有「改写值喂 diff ⇒ 每轮必写」（残余仅 P3-10 的一次性 parent 扁平化）。
4. **pullRound trashedLocal 归一与增量轮同口径**：`pullRound.ts:69`（trashedAt 保留原值 ?? now、dfp ?? 原 parent、parent=TRASH）与 `engineBridge.ts:77-79` applyCloudDeleted 同形状；文档侧「本地有云端没有」两轮语义一致。
5. **loadState 投影无 wire/本地语义混用**：行保持本地语义（桌面容器/移动原父），wire 归一只在 positionOf 单点（`positionMerge.ts:28-43` task-61 注释），saveState 落库再还原（`deviceStore.ts:648`）。口径闭环。
6. **previous 快照在生产路径不缺**：`s3v3Engine.ts:624/751/796/1006` 均传（1006 传 `state, state`，自比较无害）；`fileDeviceStore` 是测试/CLI 专用（`electron/s3v3/fileDeviceStore.ts:7` 注释）。previous 缺失时 meta 守卫退化为无条件写（`deviceStore.ts:744`）—— 仅单测直调受影响，已在 P3-11 关联记录。
7. **applyPlan 数据安全不变量齐**（`applyPlan.ts:66-172`）：缺正文不上传 + failedUploads 回退远端旧版本（`:130-135`）、下载 hash 不符不落盘（`:109-113`）、坏字节不写、删除只执行 user-purge、deferUserPurgeDeletes 先发布后清理。
8. **applyAssets 声明护栏齐**（`applyAssets.ts`）：声明永远全量、空资产不写空声明、本地空+云端非空 ⇒ 保留远端声明+自愈下载（`:182-195`）、附件上传不齐 ⇒ 不写新声明 + 索引回退（`:277-296`）、非法文件名跳过并结构化告警、资产读不出整条失败（`:165-171`）。
9. **saveQuickNotes 墓碑时间比较正确**：softDeletedDuringRound/purgedDuringRound 的时间戳 LWW + restoring 例外（`deviceStore.ts:497-505`）；已软删行不重打时间戳（`:552`）；quick-soft-delete 一律软删不走 discard（`:553-561`）—— **前提是行在 current 快照里**（P1-3 是唯一漏点）。
10. **tagIds 空集合显式发布闭环**：loadState 投影丢空 tagIds（`deviceStore.ts:310`）由发布侧补偿（`plan.ts:480-482` 有版本必写 tagIds `[]`）；`remoteHasTagField` 判据（`plan.ts:267`）能区分「旧索引无字段」与「显式清空」；关系 LWW 胜者合成独立于内容（`plan.ts:459-482`）。
11. **mergeRoundIntoState 状态合成**：published 分支把本轮 cloud-deleted 副本并回（`engineBridge.ts:185-197`，261113 P1 #2 修复仍在位）；bodyFailed 不写索引 hash（`:234-235`）；apply-position/apply-lock 只改对应字段（`:215-230`）；apply-remote 重建而非叠加（`:239-259`）。
12. **移动端缺正文不上传**：readBody→null ⇒ local_body_missing ⇒ commit 回退（`applyPlan.ts:130-135` + `mobileDeviceStore.ts:249-256`）；「hash 相同不下载」的 statBody 缺省是 pullRound 文档化的已知近似（`pullRound.ts:7-9`）。
13. **saveFolders 的 changed 判据**（`deviceStore.ts:442-447`）覆盖 title/parent/sort/icon/space/updatedAt；trashed 差异由 parent 归 TRASH 兜住（`resolveRemoteFolderParent:230-231`）；notebook-with-parent 兜底转 group 并显式告警（`:424-433`）。

---

## 建议新增护栏（测试名 + 断言要点）

| 测试名 | 断言要点 |
| --- | --- |
| `deviceStore.pullRoundUnsyncedQuickKept.test` | pullRound 世界不含「本地未同步小记」时跑 saveState：行仍在（软删 deleted_at 非空 + cloud_deleted），断言绝不调用 discardQuickNote（两端端口 mock 各跑一遍） |
| `deviceStore.trashDfpRoundTrip.test` | 桌面 deleteTreeNode → 移动端应用同 trashed 条目 → 再同步回桌面：两端 `deleted_from_parent_id` 均为原父；桌面 restoreTrashItem 落点 = 原父（fellBack=false） |
| `deviceStore.downloadToTrashMaterialize.test` | quick-soft-delete + apply-remote 同轮：saveState 结束后该小记行 `deleted_at` 非空（活跃列表不含）；再跑一轮 loadState→saveState 仍保持软删 |
| `deviceStore.missingBodyNotConverged.test` | 行在、正文文件缺失/读抛错：saveState 后行未被 deleteNote/purgeLocalNote（除非带 purge 意图/remotePurged）；子树兄弟行 trashed_at 仍为 NULL |
| `mobilePlatformPort.metaUpdatedAtOnly.test` | applyRemoteNoteMeta 仅 updated_at 不同：落库后行 updated_at 前进（收敛）；连续两轮无重复写 |
| `mobilePlatformPort.explicitNullParent.test` | 位置赢家 parentId=null（活跃）：行 parent_id 落 null；undefined 输入才走保留 |
| `deviceStore.remotePurgedFolderKept.test` | folder id 在 remotePurged：saveState 后信封 remotePurged 仍含它、folders.cloud_deleted=1（hasNote||hasTreeNode 语义） |
| `mobilePlatformPort.deleteTreeNodeSoft.test` | saveFolders 收敛删除目录后：行保留（软删可恢复），断言不出现物理 DELETE；桌面/移动行为对拍 |
| `deviceStore.iconClearPropagation.test` | 行 icon=null → 发布条目携带显式 null → 对端落库后 icon 清除（或钉死现状并写明协议限制） |
| `mobilePlatformPort.batchFlushOnAbort.test` | 批窗口内抛错：已排队语句不静默丢失（重试/告警），staged 正文与行状态一致 |

（以上均为建议，本次审计未改任何产品代码。）
