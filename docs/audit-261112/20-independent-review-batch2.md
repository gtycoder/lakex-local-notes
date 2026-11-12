# 20 · 独立复核（batch2）：S3 语义与门禁抽查

> 独立复核（**只读 + 只提交文档**）· 2026-11-12 · 基线 = **HEAD `d45e7c91`**（4 个修复提交：`20a066eb` / `20361880` / `e06eaf99` / `d45e7c91`），复核时 `git status` 干净。
> 原则：**不信汇报，只看代码 + 实跑**。结论分「真缺陷 / 风险 / 建议」三类；发现真缺陷只登记、不改代码（本轮**未发现 P0/P1 真缺陷**）。
> 实跑命令与结果见 §5；证据均为 file:line + 可复现命令。

---

## 0. 结论表

| # | 复核项 | 期望 | 实测 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | 两路边 purge/restore（F-01 收口） | purge 组 ⇒ 整棵子树（行/正文/资产前缀/墓碑）清；restore 组 ⇒ 子文档回原父；emptyTrash/autoPurge 不抛错 | 代码两路边集合 `UNION` 去重 + 逐节点 `deleted_from_parent_id`；S17b/S17c/S17d 实跑 PASS（含「扁平化后回收站根 ≥2」前置断言） | ✅ 通过 |
| 2 | 位置/锁合并边界 + wire 无 notebook-trash | 位置独立三方合并、纯移动轮发布；锁独立合并；wire 不出现 notebook-trash | positionMerge 判据与 plan 合成一致；P0-b/P0-c/P0-d/P2、L1–L5 实跑 PASS；P2 断言原始索引 `not.toContain("notebook-trash")` | ✅ 通过（边界见 R3） |
| 3 | 恢复历史不改生命周期（两端） | 恢复历史只写正文/缓存，不动 `trashed_at`/`parent_id`/`restore_pending_at` | 桌面 `historyLifecycle.ts:363-399` 只原子写正文 + 缓存 + `is_dirty/updated_at`；移动 `restoreHistory` 走恢复专用写；`restoreHistoryGuard.test.ts` 断言生命周期原样（实跑 PASS） | ✅ 通过 |
| 4 | readonlyReason / syncWarningText 真实消费 | 两端消费、无第二份手写文案 | `syncWarningText`：桌面浮层 + 移动设置页都消费 ✅；**`readonlyReason` 只有桌面消费**（MobileTabEditor），移动仍有 3 处手写只读文案（R1） | ⚠️ 部分（R1/R2） |
| 5 | 门禁实跑 | tsc / 指定 vitest / ui-metrics 全绿 | tsc **0 error**；`vitest run electron/s3v3 src/core/s3v3 src/mobile/v3` = **94 files / 491 tests passed（8 files/9 tests skipped 为集成件）**；ui-metrics 全项在基线 | ✅ 通过 |

---

## 1. 两路边 purge/restore（F-01）实测

### 1.1 代码判据（已核对）
- 两路边集合：`electron/trashLifecycle.ts:88-98` `flattenedSubtreeIds` —— `WITH RECURSIVE subtree(id) AS (SELECT ? UNION SELECT t.id ... ON t.parent_id = s.id OR (t.deleted_from_parent_id = s.id AND t.trashed_at IS NOT NULL))`：`UNION` 去重（环必然收敛）、`deleted_at IS NULL` 过滤。
- 删除（软删到回收站）逐节点记原始父：`trashLifecycle.ts:143-145` / `:151-153` `deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id)`（tree_nodes 与 notes 两表都写）。
- purge 用两路边集合：`trashLifecycle.ts:300` `const ids = this.flattenedSubtreeIds(id)`；每个 note 节点写 `deleted_notes` 墓碑（`:322-336`）、删正文/附件目录/历史、清搜索；folder 节点也写 folder 墓碑（`:339-343`）。
- restore 用同一集合并把扁平化子节点回原父：`:236-253` `parent_id=COALESCE(deleted_from_parent_id,parent_id)`。
- emptyTrash / autoPurgeExpiredTrash 对「已被前一个根连带删掉」的根幂等跳过：`:171-173` / `:359-368`（只吞 `AppError NotFound`，其它错误仍抛）。

### 1.2 实跑证据（独立复核新增的用例已提交在 `20a066eb`）
- **S17b 清空回收站（子树已被同步扁平化）**：先 `deleteTreeNode(group)` 再同步两轮让 apply 把 trashed 行 parent 归一成回收站容器；先断言 `trashRoots >= 2`（组 + 子文档都是根 = 真实扁平化形态），再 `expect(() => store.emptyTrash()).not.toThrow()`；随后断言无任何 `trashed_at` 节点、`deleted_notes` 里 **组（node_type=folder）与子文档（note）各一条 purged 墓碑**、云端索引不再含该文档。
- **S17c 恢复已被同步扁平化的组**：`restoreTrashItem(group)` 后断言组 `parent_id === 原笔记本`、子文档 `parent_id === 组 id`（不是 notebook-trash）；对端 B 首拉后位置一致。
- **S17d 自动过期 purge**：把 trashed_at 改成 2 天前 → `autoPurgeExpiredTrash(1)` 不抛错且清空。
- 命令/结果：`npx vitest run electron/s3v3/scenarioMatrix.test.ts electron/s3v3/trashRemoteDivergence.test.ts` → 全绿（见 §5）。

---

## 2. 位置/锁合并边界 + wire 无 notebook-trash

### 2.1 位置合并（已核对）
- 纯函数判据 `src/core/s3v3/plan/positionMerge.ts:100-126`：无基线（任一边缺席）⇒ `winner:"same"` 不判；仅本地变 ⇒ local；仅远端变 ⇒ remote；两边都变 ⇒ 条目 `updatedAt` LWW（**相等取本地**，确定性）。
- `positionOf`（`:42-52`）对 trashed 条目把 `parentId` 投影成 null（wire 口径），比较/发布同源。
- plan 合成一致性（`src/core/s3v3/plan/plan.ts:134-146, 360-372, 408-410`）：
  - 位置本地赢 ⇒ `indexChanged = true`（纯移动轮也会发布）；
  - 应用远端内容时，位置取位置赢家（本地赢 ⇒ 保留本地位置，不被内容 apply 回滚，`:199-206`）；
  - 发布条目按位置赢家组装，且 `if (picked.trashedAt) picked = { ...picked, parentId: null }`（wire 不携带本地回收站容器 id）；
  - 位置远端赢且本轮无 apply-remote ⇒ `apply-position` 只改位置（`:208-212`）。
- 边界（代码 + 实跑）：P0-b（移动 vs 他端编辑）、P0-c（首次上传无基线就带回收站位置）、P0-d（并发移动 LWW 同一赢家）、P2（wire 无 notebook-trash / 多轮不抖 / 恢复回原父）均 PASS。**R3 提醒**：两边都动且 updatedAt 相等时，两端各自视「local 赢」，**不是单轮同一赢家**；靠下一轮「一方 local==base ⇒ remote 赢」收敛（P0-d 已验证收敛）。建议在注释/单测里写明「相等 tie 保证收敛，不保证单轮同赢家」，避免被误读。

### 2.2 锁合并（已核对）
- `mergeNoteLock`（`positionMerge.ts:146-187`）：基线存在时先做「谁改了锁」判定（本地改/远端改/都改），都改才 lockedAt LWW；**相等且状态不同 ⇒ 加锁优先**（两端同选，确定性）；无基线 ⇒ 只按 lockedAt LWW。
- plan 合成：锁本地赢 ⇒ `indexChanged + publishedLakeIds.add`（不再只在内容一致分支，`plan.ts:147-155`）；锁远端赢 ⇒ `apply-lock`（不碰正文）；发布条目按锁赢家单独合成（`:373-382`）。
- 实跑：`electron/s3v3/lockPropagation.test.ts` L1–L5 PASS（含 L2「B 连续两轮编辑正文时 A 的锁仍能发布」、L5「锁 × 移入回收站/恢复不炸且各自 LWW 收敛」）。

### 2.3 wire 无 notebook-trash（实跑）
- `trashRemoteDivergence.test.ts` P2：发布条目 `parentId === null`、`deletedFromParentId === 原父`；**原始索引字符串 `not.toContain("notebook-trash")`**；`folders[]` 不含该 id；多轮后 `lakeCommit` 不变（不抖动）；恢复后发布 `parentId === 原父`、对端同步后也回原父。PASS。

---

## 3. 恢复历史版本 = 内容动作（两端）

- 桌面：`electron/historyLifecycle.ts:363-399` `restoreHistory` 只做 ①留档 ②解压 `atomicWrite(notePathFor)` ③重算 md/plain 缓存 ④`UPDATE notes SET is_dirty=1, updated_at=?` + `tree_nodes.is_dirty=1`；**没有任何 `trashed_at`/`parent_id`/`restore_pending_at` 写入**。
- 移动：`src/mobile/bridge/notes.ts:199-210` `restoreHistory` → `saveRestoredSnapshot`（`:45-51`）→ `noteRepository.saveRestoredNoteContent`（恢复专用写，先判墓碑）。护栏 `src/mobile/bridge/restoreHistoryGuard.test.ts`：
  - `:81-94` 目标在回收站 ⇒ 恢复成功且 `trashed_at` / `parent_id` / `restore_pending_at` **原样**；
  - `:143-153` 未在回收站 ⇒ 正文变、生命周期无关字段不变；
  - `:122-140` 已 purged/墓碑 ⇒ 明确报错「不可恢复」，不静默。
- 区分（不是缺陷）：`restoreSyncConflict`（同步记录恢复）测试 `:100-117` 断言目标会**离开回收站**——那是「同步记录恢复」这一显式恢复入口的既有语义（桌面同口径），与本条「恢复历史版本不改生命周期」是两个入口，勿混。
- 实跑：`npx vitest run src/mobile/bridge/restoreHistoryGuard.test.ts` PASS。

---

## 4. 单一来源的真实消费面

### 4.1 `core/syncWarningText.ts`（✅ 两端消费）
- 桌面：`src/components/app/SyncStatusPopover.tsx:17,251-301` 使用 `syncWarningSummary/SummaryText/Rows/Copy/Title`（摘要 + ≤5 行列表 + 另 N 条去诊断）。
- 移动：`src/mobile/settings/SettingsDrawer.tsx:11,525-545` 同来源渲染（需处理在前）。
- 残留手写（**风险 R2**，不是逐 kind 文案）：计数类短句仍在两处手写 —— `src/mobile/home/HomePage.tsx:513` 与 `src/mobile/notebook/useWorkspaceSync.ts:54` `"，N 项被跳过"`；`src/mobile/bridge/sync.ts:464` 的同步完成 message 也手写 `（N 项被跳过）`。它们与核心摘要（`syncWarningSummaryText`）格式不同，属第二份「计数摘要」。
- **kind 不一致（R2）**：桌面 apply 失败已改用新 kind `apply_skipped`（`electron/s3v3/desktopSync.ts:179-184`，`core/sharedTypes.ts:45`，文案 `syncWarningText.ts:58-61`「本篇本轮未应用」），**移动仍复用 `remote_incomplete`**（`src/mobile/v3/sync.ts:69`）⇒ 移动端该条会被显示为「远端内容不完整」（对本地写失败因果写反）；且移动无持久化（`syncStatusStore` 无 warnings）。= 已知待办 **task-67**（板上 pending），复核确认仍未做。

### 4.2 `core/capabilities/readonlyReason.ts`（⚠️ 只有桌面消费，R1）
- 桌面：`src/features/editor/MultiTabEditor.tsx:32,130,338-345,665-674` 用 `readonlyReasonOf` + `readonlyReasonCopy` 生成横幅标题/动作（trashed/cloud-deleted/locked/body-missing 四类）。
- 移动：`grep -rn readonlyReason src/mobile src/features` **只有桌面那处**；移动是自己的手写文案：
  - `src/mobile/notebook/NotePaneHost.tsx:54-58` 横幅「该文档已在桌面端锁定（只读）：可以阅读，不能编辑或保存…」；
  - `src/mobile/notebook/NotebookWorkspace.tsx:146-147` toast「文档已在桌面端锁定（只读），不能编辑；请先在桌面端解锁」；
  - `src/mobile/bridge/notes.ts:119-121` 保存拒绝「文档已锁定（只读），保存被拒绝；请先在桌面端解锁后再编辑」。
  与 core 表（`readonlyReason.ts:36-58`：locked.title「本文档已锁定（只读）」）措辞不同 ⇒ **第二份手写文案残留**，且未来改文案必然漂移。core 文件头自注「移动端将来可直接复用文案」，属**已知未接线**。

---

## 5. 门禁实跑（本轮）

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
# ① 类型
npx tsc --noEmit                                     # → 0 error（TSC_EXIT=0）
# ② 指定 vitest（S3 语义面）
npx vitest run electron/s3v3 src/core/s3v3 src/mobile/v3
#   → 94 files passed | 8 skipped；491 tests passed | 9 skipped（skip 为真实桶/S3 集成件）
# ③ 样式门禁
node scripts/ui-metrics.mjs
#   → 桌面颜色字面量 0/0、!important 9/9、移动 19/19、跨文件重复 45/45、被压死声明 0/0、var(--lake-*) 未定义 0
# ④ 本报告引用的重点用例（单独再跑一次）
npx vitest run src/mobile/bridge/restoreHistoryGuard.test.ts
npx vitest run electron/s3v3/scenarioMatrix.test.ts electron/s3v3/trashRemoteDivergence.test.ts electron/s3v3/lockPropagation.test.ts
#   → 6 files / 33 tests passed（含 S17b/c/d、P2、L1–L5、restoreHistory 生命周期不变）
```

---

## 6. 问题分类

### 6.1 真缺陷（P0/P1）— **本轮未发现**
- 两路边 purge/restore、wire 位置归一、锁/位置独立合并、恢复历史不改生命周期均有代码判据 + 实跑用例，未发现语义错误或整轮失败路径。

### 6.2 风险
- **R1（P2）readonlyReason 移动端未消费**：移动 3 处手写只读文案与 core 表措辞不一致（§4.2），跨端文案漂移风险；core 文件自注为「将来复用」。建议在移动接 core 表（与 task-67 同批或单开）。
- **R2（P2）apply warning kind 两端不一致 + 移动持久化缺**：桌面 `apply_skipped` vs 移动 `remote_incomplete`（§4.1）；移动「远端内容不完整」因果写反、重启丢列表。= **task-67** 已知待办，复核确认仍未落地。
- **R3（P3）positionMerge/lockMerge 缺独立单测**：无 `positionMerge.test.ts`；边界（无基线 / 两边都动 / 相等 tie）只由 wire 场景（P0-b/c/d、L1–L5、P2）间接覆盖。另外「两边都动且 updatedAt 相等」时两端各视 local 赢，**收敛依赖下一轮**（P0-d 已验证收敛）——建议代码注释/单测显式写明，避免被误读为单轮同赢家。

### 6.3 建议
- S1 移动接 `readonlyReason`（顺带把 cloud-deleted/trashed 文案对齐），与 task-67（warning 持久化 + kind 对齐）可同批做，一次改「移动端只读/同步提示单一来源」。
- S2 补 `src/core/s3v3/plan/positionMerge.test.ts` 表驱动单测：6 组输入（无 base / 仅 local / 仅 remote / 双动不同时间 / 双动相等 / trashed parent 投影）。
- S3 把移动两处手写「N 项被跳过」换成 `syncWarningSummaryText(syncWarningSummary(warnings))`（或明确保留为"简短 toast 文案"并在注释里写清与核心摘要的差异，避免下次被当重复）。
- S4（文档）`docs/audit-261112/14-s3-scenario-matrix.md` 的 S17 行建议补引 S17b/S17c/S17d（两路边/恢复/自动过期）作为回归证据（属文档回写，非本轮职责）。

---

## 7. 未覆盖 / 边界

- **未跑真实桶（B 档）**：本机未配 S3、不碰真实桶/正式数据；复核只覆盖 A 档内存远程与代码判据。
- **未起桌面/移动 App**：桌面 UI 渲染（浮层/横幅）与设备级表现未截图；第 4 项「消费面」按源码 grep + 单测断言判定。
- 未跑全量 vitest（本批按任务只跑指定目录）；未跑样式/设备装置（无视觉改动）。
- 结论基于 HEAD `d45e7c91`；若复核后又有修复提交，请以新 HEAD 为准。
