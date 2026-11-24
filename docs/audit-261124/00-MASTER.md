# 00-MASTER — 261124 S3 同步与数据流程全面审计（汇总卷）

> 五条并发审计流的汇总：①[合并决策](01-merge-decisions.md) ②[应用落库](02-apply-persistence.md) ③[发布协议](03-publish-protocol.md) ④[生命周期与写守卫](04-lifecycle-guards.md) ⑤[迁移基线](05-migration-baseline.md)。
> 方法：只读审计 + 各流独立实证（/tmp 临时测试或代码链互证）；主卷对 7 条最重发现二次抽验（全部成立、0 虚报）。
> 背景：261124 P0（文档做父被改挂兜底本）已修复（efb30d4c），本轮是它的全面复查 —— 五流均按其 4 个同族模式排查：①改写值当真值 ②判据拿错输入 ③标记挪用 ④读写可见性。

## 一、总判

- **发布世界本身是干净的**（plan.publish 全部由三方合并赢家合成，无「DB 读回再发布」通道）—— 但**发布结果回写本地行**的半条通道（engineBridge published 分支）不接收失败/守卫信息，是③P1-1/P1-2 的根。
- 问题集中在五个面：**失败边界**（上传/下载/IO 失败的处理把合并结局翻转或静默回滚）、**恢复收尾**（restore_pending/dfp/FTS 两端不一致）、**两形态混用**（wire 形态 vs 行形态裸比较）、**首次相遇目录面**（改写层只接了文档）、**物理删除边界**（pull-all 对未同步小记违「绝不物删」红线）。
- 261124 P0 修复本体、keepLocalTrash、位置/锁正交合并、级联集合口径、写守卫分层等 40+ 项核实无问题（各分册「已核实」节）。
- 发现合计 **9×P1、~12×P2、~21×P3**（含 6 条「待复现」）；无新增 P0（B1 若证实级联则升级，见裁决点）。

## 二、修复批次（按「丢数据风险 × 触发概率」排序）

### Batch A —— 丢数据/静默回滚路径（建议立即修，出 v1.6.1）

| # | 级别 | 问题 | 触发条件 | 主证据 | 分册 |
|---|---|---|---|---|---|
| A1 | P1 | **未同步小记被物理删除**（行+正文+图片，违 §21「绝不物删」红线）：pull-all 的 state 重建丢本地独有小记 → 清扫走 discardQuickNote | 换机/坏库「从云端恢复」+ 本机有从未同步的小记 | pullRound.ts:73-77 → deviceStore.ts:569-571 → mobilePlatformPort.ts:679-688 | ② |
| A2 | P1 | **备份恢复回滚误删活小记库**：回滚判据用 currentQuickNotesDbPath 而隔离判据是 restoreQuickNotes && …；备份无小记库时换位失败 ⇒ 未隔离的活库被 rmSync，且文案报「原库未变」 | 桌面「从整库备份恢复」中途失败（磁盘满/校验失败） | workspaceRestoreFromBackup.ts:244-247（主卷已抽验） | ⑤ |
| A3 | P1 | **缺正文/瞬时读失败 → 收敛删除**：loadState 对 stat/read 失败丢行（FileDriver 吞 IO 错）→ saveState 收敛把行**连子树**拖进回收站（桌面级联），移动还误打「云端已删除」 | 任意一轮同步期间文件系统瞬时抖动 / 正文缺失 | deviceStore.ts:282-300,786-795；store.ts:605-625；nodeFileDriver.ts:8-31 | ② |
| A4 | P1 | **deleted_from_parent_id 跨端丢失链**：移动删除不写 dfp → wire 无原父 → 桌面覆盖 dfp=null → 恢复静默换家、purge 漏删子树、每轮重写 | 移动端删文档 → 桌面恢复/purge | mobilePlatformPort.ts:481-487,504-508；syncReconciliation.ts:126-140；positionMerge.ts:34-43 | ②④ |
| A5 | P1 | **移动小记保存误清 restore_pending**：ON CONFLICT 写 restore_pending_at=NULL（桌面保留）⇒ 恢复后未同步前编辑保存 = 丢掉 local-wins 唯一盾，被 quick-soft-delete/回滚 | 手机恢复小记 → 同步前编辑保存 | quickNotesRepository.ts:252-256（主卷已抽验） | ④ |
| A6 | P1 | **改名 × 他端加锁同时发生 ⇒ 改名双丢**：none 分支同置 applyRemote&&uploadLocal，发布取 p.remote（无 title LWW）+ apply 按远端 meta 重建 | 本地改名 + 他端加锁并发 | s3v3Merge.ts:219-229 → plan.ts:429 → engineBridge.ts:232-259（主卷已抽验） | ① |
| A7 | P1 | **上传失败回退条目写回本地行**：published 分支不接收 failedUploads ⇒ 元数据编辑（改名/移动/图标/锁）静默回滚且不再重试（正文能重试，其它字段丢） | 任意发布轮里一篇正文/资产上传失败 | buildPublishIndex.ts:44-47；engineBridge.ts:183-206；syncReconciliation.ts:123-147 | ③ |
| A8 | P1 | **发布轮下载失败无视 bodyFailed** ⇒ 行 hash 保持败者旧值、基线推进 ⇒ 下轮反向覆盖云端赢家，赢家正文还被 GC 删；applyPlan GET 异常连非发布分支都盖不住 | 拉取轮里一篇下载失败（网络抖动） | engineBridge.ts:235 vs 183-206；s3v3Engine.ts:640-676；applyPlan.ts:120-125 | ③ |
| A9 | P1 | **mobileToDesktopMapping 文档父断链（P0 复发通道）**：note 换新树 uuid 但子级 parent_id/dfp 不改写 ⇒ 手机文档下子文档导入桌面断链、删父漏级联；用户再拖动 ⇒ 树 uuid 发布成 parentId ⇒ 他端回落兜底 + 脏 parent 每轮上云 | 手机便携包 → 桌面导入（带文档做父的子文档） | mobileToDesktopMapping.ts:224-232 | ⑤ |

### Batch B —— 正确性/传播缺陷（随下一批修，逐条带回归）

| # | 级别 | 问题 | 备注 |
|---|---|---|---|
| B1 | P1（待定级） | **firstEncounter 目录无改写层**（①⑤双流独立确认）：只增不删/以本地为准时本地独有目录仍判 remote-purged-trash 收进回收站；local-wins 下基线认识的远端目录走 local-delete 发布缺席。folders 循环还不用 localPurgeIntent（基线在场即当删除意图） | §21.2「本轮双向都不删」被违反；**若 deleteTreeNode 对目录删除级联子树则升 P0（裁决点 2）** |
| B2 | P1 | **小记空 tagIds 不发布**：删光标签不传播，tie-break 两轮后复活回两端（文档侧 261105 修过、小记漏修） | plan.ts:519-524 |
| B3 | P1 | **首相遇「下载落小记回收站」失效**：清扫遍历过期快照 + quickDeletes 信封不回读 ⇒ 远端小记永久留在活跃列表 | deviceStore.ts:471,550-557,330 |
| B4 | P2 | **桌面级联恢复缺 restore_pending + 不清 cloud_deleted**：远端已 purge 场景下恢复被下轮回滚；④F1 | trashLifecycle.ts:259 vs 284-290 |
| B5 | P2 | **wire/行两形态裸 diff ⇒ 回收站条目每轮全量重发布**：fieldChangedIds 比 b.parentId(null) vs n.parentId(notebook-trash)（主卷已抽验）；同时污染 restoresIds | s3v3Engine.ts:824-834 |
| B6 | P2 | **桌面级联覆写已 trashed 后代的 trashed_at/updated_at**（缺 trashed_at IS NULL 条件）⇒ 删除时刻/过期钟被改写、updatedAt 人为推新可能压他端恢复（待复现） | ④F3 |
| B7 | P2 | **桌面恢复只回填根 FTS**（删除删整树、恢复只补根）⇒ 子文档恢复后搜不到（待复现） | ④F4 |
| B8 | P2 | 恢复收尾杂项：移动 COALESCE 丢「显式 null 根层」变更；仅 updated_at 变不落库每轮重放；remotePurged 收敛 hasNote 误清 folder id；移动 deleteTreeNode 硬删 vs 桌面软删级联；icon 显式清除被投影丢成 undefined；移动恢复不清 folders dfp；noteContentRepository 拒写判据不对称；移动 trashNote 无外层事务（违 §3#9） | ②④ |
| B9 | P2 | **便携包恢复丢 restore_pending_at**（桌面→移动映射硬编码 null）+ 合成失败残留旧基线 + Batch4-A 只换两库不换 sync-v3（待复现） | ④F9 ⑤P2-x |

### Batch C —— P3 清理 + 护栏

- P3 合计约 21 条（①3 / ②6 / ③9 / ④5 / ⑤4）：含 planStateOf intents 双投、环告警借壳 remote_incomplete、validateLakeIndex 目录重复 id 不拒、quick 校验弱于 lake、commitPlan 读回不比 epoch、quickPush 漏比 quickNotesCommit / 丢 targetKey 盖章、移动 deleteMany 吞错、unchanged 轮跳过 plan.deletes、deepCleanup 无锁 + retentionDays≤0、恢复隔离目录秒级撞名、stampTargetKey 短键自匹配、MobileV3Baseline 缺 targetKey 等 —— 逐条见各分册。
- **护栏测试**：5 流共提 40+ 条（每条附断言要点）。优先 8 条：`commitFailedUploadKeepsLocalMeta` / `downloadFailureInPublishedRound` / `pullRoundKeepsUnsyncedQuick`（A1）/ `rollbackKeepsUntouchedQuickDb`（A2）/ `dfpRoundTripKeepsOriginalParent`（A4）/ `quickSaveKeepsRestorePending`（A5）/ `planMixedDriftMetaLock`（A6）/ `firstEncounterFolderMapping`（B1）。

## 三、交叉去重

- B1 = ①P1-2 + ⑤P1-2 双流独立发现（合并保留）；④F9 与 ⑤ 便携包段同主题（并入 B9）；②P1-2 的 dfp 链与 ④F5/F3 同族（并入 A4/B6）；③P1-1/P1-2 的落库半边与 ② 范围重叠（以③证据链为准、②互引）；⑤P2-1 与 261124 P0 同族（A9，P0 复发通道）。
- 各分册「已核实无问题」共 56 项：重点包括发布输入=合并结果、位置/锁正交合并、环检测兜底值正确（本地父??基线父??null，非兜底本）、trashOverride 链路、缺正文四层防护不发空正文、写守卫分层无新增违例、isGoneNote 全入口含 trashedAt、级联集合口径两端一致、bootstrap fail-safe 方向、导入清账本无残留意图、测试串库探针证实 testSetup 每用例重置。

## 四、给用户的裁决点

1. **Batch A 是否立即修**（推荐：是 —— A1/A2/A3 是真丢数据路径，A5 让恢复形同虚设；走 v1.6.1）。
2. **B1 定级**：目录删除在桌面是否级联子树（deleteTreeNode 对 folder）——级联 ⇒ 升 P0 立修；不级联 ⇒ P1 随 Batch B。
3. **修复顺序**：推荐「护栏先行」——每条修复同批带回归测试（护栏清单已备好），A 批 9 条可拆 2~3 个提交批。
4. **真机复现优先级**（可选）：A1（换机/恢复流程）与 A3（文件抖动）的复现成本较高，若你要「先真机证实再修」请指定顺序；纯代码证据已足以支持修复。