# 审计① 合并/计划/决策层 — 261124 只读审计报告

> 范围：src/core/s3v3Merge.ts、src/core/s3v3/plan/plan.ts、plan/positionMerge.ts、plan/types.ts、src/core/syncDecisions.ts（decideItem 实际在 src/core/s3v3Decision.ts，一并审计）、src/core/firstEncounter.ts、src/core/s3v3/state/deviceStoreMeta.test.ts、src/core/s3v3Core.test.ts。
> 判据：docs/SYNC-PROTOCOL.md §9/§9.5/§9.8/§10.3/§21 → AGENTS.md §3#2-5/#23-24 → RESILIENCE.md。
> 方法：逐行读判据与实现；对 5 个关键疑点用仓库外（/tmp/audit-verify）的临时 vitest 对拍脚本对真实代码实证（未写仓库任何文件；复现用例已写进各条「最小复现」，可直接转回归测试）。
> 纪律：只报「实现与协议不符 / 判据拿错输入 / 边界态丢数据」；协议设计（删除压编辑、墓碑权威、恢复唯一例外、冲突不合并、小记不备份）不算 bug。

## 一句话结论

**合并决策的"单维漂移"路径是对的，但三处「合成/映射拿错输入」会造成静默丢数据：① 本地元数据 + 远端锁同时变时发布条目与落库全量取远端 ⇒ 本地改名被丢（P1，已实证）；② firstEncounter 的 additive/local-wins 对目录没有改写层 ⇒ 「只增不删」会删掉本地目录结构（P1，已实证，比 §21 登记的「folders 已知近似」更糟）；③ 小记发布丢弃空 tagIds ⇒ 「删光标签」不可传播且平局 tie-break 把已删标签复活回两端（P1，已实证，文档侧同型 P0 修过、小记侧漏修）；另有一处目录发布缺 wire 投影归一（P2）。其余 8 种在场组合、位置/锁三件套投影、环检测兜底、trashOverride 链路逐项核实无问题。**

---

## 一、发现列表

### P1-1（模式①②）本地元数据更新 + 远端锁更新同时发生 ⇒ 本地改名/图标/排序被静默丢弃（发布与落库双双回滚）

**现象**：内容 hash 三方一致、本地改了标题（updatedAt 变新）、他端只改了编辑锁（lockedAt 变新、updatedAt 不动）时，本轮：
- 发布条目携带**远端旧标题**（本地改名不上云）；
- 同时生成 apply-remote（meta = 整条远端条目），落库按「远端即真值」重建行 ⇒ **本地改名在本地也被回滚**。

用户视角：改名后一同步就弹回旧名字，且云端也停在旧名字，无 warning。

**证据**：
- src/core/s3v3Merge.ts:219-229（"none" 分支）：

~~~ts
const metaDrift = localMetaNewer || remoteMetaNewer || localLockNewer || remoteLockNewer;
notes.push({ id, kind: "none",
  applyRemote: wouldCycle || remoteMetaNewer || remoteLockNewer || (cloudWinsMeta && metaDrift),   // ← remoteLockNewer 单独就置 true
  uploadLocal: !cloudWinsMeta && !wouldCycle && (localMetaNewer || (!remoteMetaNewer && localLockNewer)), // ← 本地元数据赢也置 true
  ... });
~~~

  混合场景下 applyRemote === uploadLocal === true。
- src/core/s3v3/plan/plan.ts:429（发布条目按"内容赢家"挑底稿）：

~~~ts
let picked = suspiciousBodyIds.has(p.id) ? p.remote : (p.applyRemote && p.remote ? p.remote : p.local ?? p.remote);
~~~

  applyRemote=true ⇒ 底稿 = 远端条目；后续合成块只补**位置/锁/标签**三维（plan.ts:431-481），**没有 title/sortOrder/icon/updatedAt 的 LWW 合成** ⇒ 远端旧标题原样发布。
- src/core/s3v3/commit/engineBridge.ts:232-259：「apply-remote = 远端条目就是真值：重建条目」（title/updatedAt 直接取 meta）⇒ 落库也回滚。
- 协议对照：SYNC-PROTOCOL §9.2「元数据（title/sortOrder/icon）按 updatedAt 后写胜」+ §9.8「发布条目按锁赢家组装……三者相互正交」——实现把"远端锁变了"扩大成"整条远端 meta 都该应用/发布"。

**影响面**：任何"一边加锁/解锁、另一边改名/改图标/改排序"的并发窗口（两端日常使用即可触发，不需要极端时序）。丢失的是元数据不是正文，但**静默、无历史留档**（title 变更不进历史快照）。
反向混合（本地锁赢 + 远端元数据赢）是对的：plan.ts:241-243 用锁赢家把本地锁补进 meta，plan.ts:447-456 发布侧同理——只有"本地元数据赢 + 远端锁赢"这一个方向漏了。

**最小复现（已实证，纯函数可直接断言）**：

~~~ts
base:   n1 { title:"T0", contentHash:H(a), updatedAt:t0 }
local:  n1 { title:"T1", contentHash:H(a), updatedAt:t2 }          // 本地改名
remote: n1 { title:"T0", contentHash:H(a), updatedAt:t0, isLocked:true, lockedAt:t3 }  // 他端加锁
planSync(...) → publish.lake.notes[0].title === "T0"（应为 "T1"）；
writes 里 apply-remote 的 meta.title === "T0"（应不带旧 title 或按字段合成）。
~~~

**建议修法**：把 "none" 分支的 applyRemote 拆成两个信号——「应用远端元数据」（remoteMetaNewer/cloudWinsMeta）与「应用远端锁」（remoteLockNewer）；后者只发 apply-lock（plan.ts:174-176 的独立写操作本就是为此存在，现被 !(p.applyRemote && r) 短路掉）。或在发布/apply 的 meta 合成处按字段 LWW：title/sortOrder/icon/updatedAt 取 updatedAt 赢家、锁取锁赢家、位置取位置赢家。附带补混合漂移回归测试。

### P1-2（模式③语义破坏）firstEncounter「只增不删 / 以本地为准」对目录没有改写层 ⇒ 本地目录被判"云端已删"删除（比 §21 已知近似更糟的变体）

**现象**：首次相遇弹窗（§21）下，目录合并分支**完全不消费 encounter 映射**（applyEncounterAction 只覆盖文档、applyQuickEncounterAction 只覆盖小记），目录直接走 smart 语义：
- **additive（"仅这一次：本机内容全部上传，本轮双向都不删"）**：本地有、云端无、基线有（bootstrap 迁入场景**每个目录都满足**）⇒ remote-purged-trash ⇒ remove-folder——**"只增不删"把本地目录删了**；其下文档按 additive 重传，父指向已消失的目录 ⇒ 结构毁灭、子文档挂进兜底笔记本。
- **local-wins（"本地全量上行覆盖云端；云端的删除一律不认；冲突本机胜"）**：同样命中 remote-purged-trash（云端的删除**被认了**）；双改目录且远端 updatedAt 更晚时判 download（**冲突本机胜没兑现**）。
- additive 的双改目录同理判 download（"冲突本机胜"未兑现）。

**证据**：
- src/core/s3v3Merge.ts:246-258（目录 l&&!r 分支）：

~~~ts
if (!b && !l.trashedAt) folders.push({ ... kind: "upload" ... });
else if (b && !l.trashedAt && l.updatedAt > b.updatedAt) folders.push({ ... kind: "upload" ... });
else folders.push({ id, kind: "remote-purged-trash", ... });   // ← additive/local-wins 也走这里
~~~

- src/core/s3v3Merge.ts:272-276（双改 LWW）：if (!wouldCycle && l.updatedAt > r.updatedAt && ctx.encounter !== "cloud-wins") upload else download ——只挡了 cloud-wins，没给 additive/local-wins 的"冲突本机胜"。
- src/core/firstEncounter.ts:108-127：applyEncounterAction(mode, action: ItemAction, ...) 只映射文档 ItemAction；目录循环（s3v3Merge.ts:237-278）无任何 ctx.encounter 改写（唯一消费点是 275 行的 cloud-wins 判断）。
- 对照 plan.ts:296-298 注释："目录映射无对应改写……**本地保留不丢数据**，§21 已知近似"——该登记只描述了 cloud-wins（抑制上行）；additive/local-wins 是**丢结构**，未登记。
- **已实证**：planLakeMerge(base 含 f1, local 含 f1(updatedAt 未变), remote 不含 f1, encounter="additive") → kind = remote-purged-trash（期望 upload）；encounter="local-wins" 同样；双改（远端 updatedAt 更晚）local-wins → download（期望 upload）。

**影响面**：便携包迁入（bootstrap 底稿）+ 配了非空桶 ⇒ 首次相遇正是 261124 P0 的用户场景。选"只增不删"的用户会丢掉全部云端没有的目录；若 deviceStore 的"目录缺失 → deleteTreeNode"（deviceStoreMeta.test.ts:247-296 路径）会级联子树，子文档可能连带进回收站 ⇒ 升级为 P0 级。**deleteTreeNode 级联语义待复现（归审计②核实 platformPort.deleteTreeNode 是删行还是级联）**；目录行可恢复性同源。

**最小复现（已实证）**：见上；E2E 版本 = 迁入便携包（含 2 个笔记本）→ S3 指到已有数据的桶 → 手动同步 → 弹窗选"只增不删" → 观察本地笔记本消失/子文档挂进未分类。

**建议修法**：给目录循环补 encounter 映射（或扩展 applyEncounterAction 出 folder 变体）：additive/local-wins 下 remote-purged-trash → upload（本地全量上行），双改 → upload（冲突本机胜）；cloud-wins 维持现状抑制上行。同步修订 SYNC-PROTOCOL §21.5 的"已知近似"登记（现在的"folders 无改写 = 不丢数据"表述不实）。

### P1-3（模式①）小记发布丢弃空 tagIds ⇒ 「删光标签」在 wire 上不可见，且平局 tie-break 把已删标签**复活回两端**

**现象**：小记删光最后一个标签（tagsUpdatedAt 推进、集合为空）后：
1. 发布条目**只写 tagsUpdatedAt、不写 tagIds: []**（plan.ts:522）；收件端 engineBridge.ts:272 对缺失字段是 COALESCE（保留旧 tagIds）⇒ **删除永不传播**；
2. 收件端下一轮把陈旧 tagIds 连同新版本号再发布回来，两端 tie-break「集合串字典序大者赢」⇒ **已删标签在两台设备上复活**（A 端 state/索引被回写 ["t1"]；若标签目录行已物理删则成悬空引用）。

这正是文档标签侧修过的 P0（"空集合也写 []，否则删光标签在 wire 上不可见"）——**修了文档侧、漏了小记侧**。

**证据**：
- src/core/s3v3/plan/plan.ts:519-524（小记发布合成）：...(tagIds?.length ? { tagIds: tagIds.toSorted() } : {}) ——空集合**省略字段**；对照 plan.ts:486-491（文档侧）：...(tagIds !== undefined ? { tagIds: tagIds.toSorted() } : {}) + 注释"P0：空集合也写 []"。
- src/core/s3v3/state/deviceStore.ts:186（quickEntryOf）：...(q.tagIds.length ? { tagIds: ... } : {}) ——本地世界也表达不了"空集合+版本"（同族，归审计②）。
- src/core/s3v3/commit/engineBridge.ts:272：...(meta.tagIds !== undefined ? { tagIds: meta.tagIds } : {}) ——缺字段 = 保留旧值。
- src/core/s3v3/state/deviceStoreMeta.test.ts:652-662："小记远端清空标签（空 tagIds + 新版本）⇒ 仍应用（否则清空不可见）"——apply 侧**明确在等 tagIds: [] 这个信号**，但发布侧从不产生它。
- 文档侧护栏与修复对照：src/core/s3v3/plan/planNoteTags.test.ts:80-88（"P0 本地删光最后一个标签 ⇒ 发布条目必须显式带 tagIds: []"）——小记侧无对应测试。
- **已实证**（三轮推演对真实 planSync 跑通）：A 删光标签（T2）→ 发布条目 = {..., "tagsUpdatedAt":"T2"} 无 tagIds；B（持 ["t1"]，收到 T2 后被 COALESCE 保留）→ 再发布 {tagIds:["t1"], tagsUpdatedAt:"T2"}；A 第三轮平局 tie-break 选远端 → A 发布并落回 ["t1"] ⇒ **复活**。

**影响面**：所有"小记删光标签"的跨端传播（部分删除不受影响，只有空集合不可表示）；伴随索引/状态里的悬空 tagIds（标签目录行已物理删除时）。
**待复现**：端到端两设备完整收敛走查（DB tag_links 行级是否最终清掉）——plan/状态层已实证，行级落库细节归审计②。

**最小复现（已实证）**：见上；单测版断言 plan.publish.quickNotes.items[0].tagIds 应为 []（现状 undefined）。

**建议修法**：与文档侧同口径——有版本就必须显式写 tagIds（空集合写 []）：...(tagIds !== undefined && (tagsUpdatedAt || tagIds.length) ? { tagIds: tagIds.toSorted() } : {})；quickEntryOf（deviceStore）同步保留空集合表达。补小记侧镜像测试（见 §四）。

### P2-1（模式①"脏 parent 上云"同族）目录发布缺「trashed ⇒ wire parent=null」归一：winner=same 时把本地回收站容器 id 发上云

**现象**：trashed 目录的位置三件套在**比较侧**经 positionOf 归一（trashed ⇒ parent=null），故 winner=same；但**发布合成**在 winner=same 时原样返回本地条目（parent = notebook-trash），违反 §10.3/task-61「wire 上 trashed 条目的 parentId 恒为 null；本地容器 id 不进 wire」。文档侧有兜底归一（plan.ts:485：if (picked.trashedAt) picked = {...picked, parentId: null}），**目录侧没有**。任何一次触发全量发布的轮次（别处变更/纯移动轮/purge 轮）都会把脏父带上云。

**证据**：
- src/core/s3v3/plan/plan.ts:527-546（目录发布 map）：winner=local/remote 才 withPosition（投影值 ✓）；winner=same 直接 return baseItem（原始 parentId）——与 plan.ts:484-485 的文档归一不对称。
- 本地世界的 trashed 目录确实带容器 id：src/core/s3v3/state/deviceStore.ts:236-243（toFolderEntry 原样映射 parent_id）+ deviceStore.ts:230-231（落库按 trashedAt 归到 TRASH_NOTEBOOK_ID）+ engineBridge.ts:78（cloud-deleted 副本 parent=TRASH_NOTEBOOK_ID）。
- positionMerge.ts:34-43 的投影只作用于比较/赢家位置，不覆盖 winner=same 的发布底稿。
- **已实证**：base/remote = trashed 目录（wire parent=null），local = 同状态（parent="notebook-trash"）+ 一篇新建文档迫使 indexChanged → publish.lake.folders[0].parentId === "notebook-trash"。

**影响面**：wire 卫生与协议不变量破坏（悬空父）。收件端当前不炸——resolveRemoteFolderParent（deviceStore.ts:230）先按 trashedAt 归回收站容器；但任何按 parent 做树校验/去重/迁移的消费方（含对拍、validate 扩展、他端旧版本）都会踩；且这是 261124 P0「脏 parent 上云」的直接同族（收件端改写 → 每轮必写的放大链路是否会被目录触发**待复现**，需在 resolveRemoteFolderParent 全链核对）。

**最小复现（已实证）**：见上；单测断言 trashed 目录发布条目 parentId === null 且 deletedFromParentId 保留原父。

**建议修法**：目录发布 map 末尾补与 plan.ts:485 同款归一（picked.trashedAt ⇒ parentId=null），或把 notes/folders 的"发布条目出口"收口成同一个函数（含 trashOverride 归一），消除两份手写归一。

### P3-1（模式②轻症）planStateOf 把同一份全量 intents 同时当 purgeIntents 与 folderPurgeIntents

**证据**：src/core/s3v3/commit/engineBridge.ts:33-47：purgeIntents: state.intents.map(i => i.noteId) 与 folderPurgeIntents: state.intents.map(i => i.noteId) 同源；文档/目录/小记三个循环（s3v3Merge.ts:162-171、241、338）各按 id 查同一集合。
**影响面**：当前靠 id 全局唯一（tree_nodes 单命名空间）掩护，行为正确；但判据输入不精确——若未来出现跨命名空间复用 id（固定 id 如 notebook-uncategorized 的 purge 意图会同时出现在三个集合里），会被 notes/quick 循环误匹配成"本地删除意图"。
**建议**：intents 记录带 kind/nodeType，投影时按类过滤；或在 planStateOf 注释把"id 唯一性是正确性前提"写成显式断言。

### P3-2 环检测告警借壳 remote_incomplete

**证据**：src/core/s3v3Merge.ts:143、148：cycle-parent 告警 code 用 "remote_incomplete" + detail 前缀。SYNC-PROTOCOL §8.5 结构化 warning kinds 无父环专属码。
**影响面**：诊断/SyncResult.warnings 按 kind 聚合会把父环归为"远端不完整"，排障误导；无数据损失。
**建议**：增 cycle_parent_rejected kind，或至少在 §8.5 登记该 detail 前缀。

### P3-3 enforceDiarySpaceMonotone 不区分被覆盖条目的 kind（有意行为 + 与 F-01b 排除规则相抵，缺护栏）

**证据**：src/core/s3v3Merge.ts:297-311 对**所有**目录计划条目做日记单调改写（含 remote-purged-trash / local-purge / local-delete），改写后 kind 变 upload/download ⇒ 逃过 plan.ts:530 的三类发布排除（F-01b"回收站副本永不 upload"）。
**判定**：对"日记本不可删除"（AGENTS §3#25）是**修复方向**（他端/脏数据把日记本弄没时重新发布/取回），注释亦明说"null/缺席 ⇒ 重发布"，**不算 bug**；但与 F-01b 排除的交互（日记本被对端 purge 后会被本端复活发布）没有任何测试覆盖；且 purge 意图 + 远端日记存在时会被翻成 download 复活（日记不可删裁决下该 purge 意图本不该存在，边角）。
**建议**：护栏钉住"日记目录 × remote-purged-trash/local-purge × 四个 encounter 模式"组合矩阵，明确哪些复活是有意的。

---

## 二、已核实无问题清单（点名查过什么、为何没问题）

1. **decideItem 的 8 种在场组合 vs §9.1/§9.3**（s3v3Decision.ts:29-61）：restorePending 优先（本地有内容才 restore-upload，无内容不空传）→ purge 意图（删除压编辑）→ 无基线四态（local/remote/双有 hash 判同/双无）→ 有基线四态（remote-purged-trash / download=按云端恢复 / none / 相对 base 的 hash 矩阵 remote-wins-keep-history）。逐条与 §9.1 对上；s3v3Core.test.ts:71-101 有对应用例（含 restore 优先、purge 压编辑）。
2. **positionOf 投影输入侧对称**：merge 的 base/local/remote 四处调用点（plan.ts:150-156、304-310、434-440、536-542）全部经 positionOf（trashed ⇒ parent=null）投影后再比较，与 wire 形态同口径；apply-position 写出的也是投影值（plan.ts:253-255 + positionFields）。输出侧唯一缺口已单列 P2-1（目录 winner=same 发布）；文档侧由 plan.ts:484-485 归一（含 261124 修的 trashOverride 原父顺序 deletedFromParentId → parent，meta 侧 plan.ts:247 与发布侧 plan.ts:484 两处一致）。
3. **环检测兜底值来源**（task 重点）：parentFix = localNotes.get(id)?.parentId ?? baseNotes.get(id)?.parentId ?? null（s3v3Merge.ts:142、147）——**保留本地/基线原父，不是兜底笔记本**；兜底笔记本只由适配器 resolveRemoteParent（deviceStore.ts:209-222）在"目录 → 文档 → 批量写作用域"三级都解析不到时惰性创建（261124 P0 的两条修复都在位）。safeRemote 改写传播到 plan 条目的 remote 字段 ⇒ apply/发布输入同源（s3v3Merge.ts:150-161）。idsWithCyclicAncestors（s3v3Merge.ts:97-120）正确标记环 + 入环子孙、O(n) 有界；远端注入环必然被父改写打断（各环成员的本地父全等于远端父时环本来就存在于本地，属本地数据损坏，不属本层）。
4. **trashOverride 链路无丢失**：s3v3Merge.ts:188、415 生成 → plan.ts:247（meta 归一：parent=null、trashedAt=now、原父入 deletedFromParentId）→ plan.ts:249（indexChanged）→ plan.ts:484（发布归一）→ 文档发布为 trashed 条目；小记 download-to-trash → plan.ts:354-358（quick-soft-delete + 发布缺席）+ engineBridge.ts:137-147（先物化行再软删，§21.4 语义）。keepLocalTrash（deviceStore.ts:645-648）是 apply 层从"本地当前行 vs 计划 meta"派生的守卫，不需要 plan 传递标记；plan→apply 的生命周期语义经 apply-remote meta（withPosition）/ apply-position / set-lifecycle 三路传递完整（落库细节归审计②）。
5. **编辑锁独立合并 mergeNoteLock vs §9.8**（positionMerge.ts:110-129）：四行语义全对（含"缺时间戳的解锁靠 base 变更检测能赢""tie 加锁优先"）；**单维**漂移的双向都正确——远端锁赢时 apply-lock 或 apply-remote 带锁（plan.ts:174-176），本地锁赢时 meta/发布合成补本地锁（plan.ts:241-243、447-456）；只有"本地元数据赢 × 远端锁赢"的混合方向出问题（P1-1）。s3v3Core.test.ts:111-122（C3）只测了单维漂移。
6. **发布排除与空发布防护**：publishExcluded（plan.ts:146）阻止 remote-purged-trash 的位置/锁/标签变化置 indexChanged（防代际空涨）；发布过滤三类（plan.ts:426、530）与 F-01b 一致；local-purge 必置 indexChanged（plan.ts:259-262）。
7. **小记决策分支**（planQuickNotesMerge，s3v3Merge.ts:327-428）：purge 意图 → 显式恢复优先于 purged 墓碑（338-351）→ 墓碑压制 → 新增/基线矩阵 → 软删 → 内容 LWW；261113 C1"远端 updatedAt 晚于基线 = 他端显式恢复让位"（356-366）符合 §11.4；无基线空底稿修正（376-387）与注释一致。**但这些分支在 s3v3Core.test.ts 只有 2 个用例（168-188），恢复/墓碑/让位分支零覆盖**（见 §三）。
8. **quick purge 的正文共享引用检查**（plan.ts:377-379）：删对象前查 local∪remote 引用，防删共享 hash 毁他条正文（261113 P1）✓；purge 前缀用单一来源 quickNotePurgePrefixes（plan.ts:382）✓。
9. **suspiciousBody（P1-4）**：可疑篇不上传、发布只用远端版本、远端没有则整条不进索引（plan.ts:177-190、427-429）✓；与 p.archiveLocal 不重复留档（plan.ts:234-235）✓。
10. **标签目录三方（§9.4）**：删除=缺席、quickTagRemoved（基线有/远端无 ⇒ 删本地，删除压编辑）、pendingTagDeletes 抑制、quickTagSettled 结算（plan.ts:392-420）✓；发布白名单不带 deletedAt（plan.test.ts:286）✓。注意这与 P1-3 不同层：目录 tags[] 删除传播正常，坏的是**条目 tagIds 关系**的空集合。
11. **isGoneNote / decidePurge**（syncDecisions.ts:64-83）：isGoneNote 四判据含 trashedAt（261114 修复在位）；decidePurge 幂等 skip（skip-already-purged 防每轮重放）✓。
12. **firstEncounter notes/quickNotes 映射完整性**（firstEncounter.ts:108-154）：四模式逐分支与 §21.2 对上；基线已知条目豁免（download → 普通下载补回，261124 事故回归）在位；小记 local-wins 的"安全兜底下载"与 §21.4/§21.5 登记的已知近似一致（绝不丢数据优先）；§21.5 两条已知近似（additive/local-wins 冲突不留远端历史快照、cloud-wins purge 意图本轮让位）如实存在且实现相符。**folders 无改写不是无害近似——见 P1-2**。
13. **位置 LWW tie-break**（positionMerge.ts:85-86）：local >= remote 相等取本地，与 §9.5 一致；同毫秒互刷的已知近似在 positionMerge.test.ts:136 登记 ✓。
14. **plan/types.ts 契约**：apply-position/apply-lock 的"只改位置/只改锁"语义、publishes 集合的存在理由（metadata-only 轮无 body PUT）、DeleteOp 只允许 user-purge（I0）均与协议一致；intentChanges 只产候选、清除归 Finalize（plan.ts:565-566）✓。

## 三、测试覆盖缺口（范围内两个测试文件）

- **src/core/s3v3Core.test.ts（189 行）**：planLakeMerge 覆盖 8 组合主干 + C3 单维锁 + C4 双环 + D4 目录恢复 + 目录四态；**缺口**：① planQuickNotesMerge 只有 2 例（168-188），恢复优先/墓碑压制/他端恢复让位（s3v3Merge.ts:338-366）零覆盖；② 混合漂移（P1-1）无用例（C3 只测单维）；③ encounter × 目录矩阵（P1-2）零覆盖；④ planSync 发布组装不在本文件（在 src/core/s3v3/plan/plan.test.ts 等），但那些文件同样没测 P1-1/P1-3/P2-1 三个场景（planNoteTags.test.ts:80 只钉了文档侧空集合）。
- **src/core/s3v3/state/deviceStoreMeta.test.ts（707 行）**：loadState 投影、H73-G1 双向、窗口守卫 P1-1/P1-2/P1-8、墓碑 LWW、标签批量 P2-E、深链保序覆盖良好；**缺口**：① 652 行"小记远端清空 ⇒ 仍应用"只测 apply 侧，**没有对称断言发布侧会产生 tagIds: []**（补上就能拦住 P1-3）；② 无"apply-remote 全量重建 vs 本地 title 更新"守卫（P1-1 的落库面）。

## 四、建议新增护栏（测试名 + 断言要点）

1. **planMixedDriftMetaLock.test.ts**（P1-1 回归）：
   - 断言 1：本地改名（updatedAt 新）× 他端加锁（lockedAt 新）⇒ 发布条目 title === 本地新标题、isLocked === true（锁取远端）；
   - 断言 2：writes 里不得出现携带旧 title 的 apply-remote（只允许 apply-lock 或字段合成后的 meta）；
   - 断言 3（反向不回归）：本地加锁 × 他端改名 ⇒ 发布 title = 远端新标题、锁 = 本地锁。
2. **firstEncounterFolders.test.ts**（P1-2 回归）：
   - additive ×（本地有/云端无/基线有）目录 ⇒ kind === "upload"（现为 remote-purged-trash）；
   - local-wins × 同上 ⇒ upload；local-wins/additive × 双改（远端 updatedAt 更晚）⇒ upload（冲突本机胜）；
   - cloud-wins 维持现状（不发布不上行）；smart 不变（有基线判真删）。
3. **planQuickNoteTags.test.ts**（P1-3 回归，镜像 planNoteTags.test.ts:80-90 两条）：
   - 本地删光最后一个标签（版本推进）⇒ 发布条目显式带 tagIds: [] + tagsUpdatedAt；
   - 对端收到 tagIds: [] + 新版本 ⇒ apply-remote 清空（engineBridge 重建后 tagIds 为空）；
   - 三轮收敛断言：A 删 → B 不回发旧集合 → A 不复活。
4. **planFolderWireProjection.test.ts**（P2-1 回归）：
   - trashed 目录（本地 parent=notebook-trash，base/remote parent=null）在 winner=same 全量发布中 ⇒ parentId === null、trashedAt/deletedFromParentId 保留；
   - 对拍断言：发布条目经 positionOf 投影后与比较输入同值（"比较与发布同口径"不变量，notes/folders 同测）。
5. **planQuickNotesMergeLifecycle.test.ts**（覆盖缺口①）：restorePending 优先于 purged 墓碑；purgedIds 墓碑压制；rr.updatedAt > bb.updatedAt 他端恢复让位（261113 C1）三例。
6. **（跨层，转审计②）quickEntryEmptyTagSet.test.ts**：quickEntryOf 对"空集合+版本"保留 tagIds: [] 表达；saveQuickNotes 对称应用。

---

## 五、自检（每条发现的文件:行）

- P1-1：s3v3Merge.ts:219-229 / plan.ts:429 / engineBridge.ts:232-259 ✓（已实证）
- P1-2：s3v3Merge.ts:246-258、272-276 / firstEncounter.ts:108-127 / plan.ts:296-298 ✓（已实证）
- P1-3：plan.ts:519-524（对照 486-491）/ deviceStore.ts:186 / engineBridge.ts:272 / deviceStoreMeta.test.ts:652-662 ✓（已实证）
- P2-1：plan.ts:527-546（对照 484-485）/ deviceStore.ts:230-243 / engineBridge.ts:78 ✓（已实证）
- P3-1：engineBridge.ts:33-47 ✓；P3-2：s3v3Merge.ts:143、148 ✓；P3-3：s3v3Merge.ts:297-311 ✓
- 未定论项均已标「待复现」：P1-2 的 deleteTreeNode 级联升级面、P1-3 的行级落库收敛、P2-1 的收件端改写放大链路。
- 未修改任何产品代码；实证脚本在 /tmp/audit-verify（仓库外），仓库内仅新增本报告。
