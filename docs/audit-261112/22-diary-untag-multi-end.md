# 22 日记「取消标记」验收终止 + 移动端移除 + 单篇出口验证（261112）

> 用户裁决（261112）：**不做「取消日记标记」这个需求**——日记本就是日记本，固定不可变（AGENTS §3#25）。
> 本文三部分：**移除前现状记录**（原 task-81 ①②，不按「验收通过」解读）、**task-85 移动端移除**、**保留能力的设备验证**（单篇文档两个出口）。

## 0. 结论

| 项 | 结果 | 证据/说明 |
| --- | --- | --- |
| 原 task-81 日记标记/取消跨端传播 | **移除前现状记录**（非验收） | 见 §1：① 标记传播 PASS；② 取消传播在移除前确实成立（space→null、知识库出现、文档保留、两轮不抖）。功能已按裁决移除，此记录只作历史行为快照。 |
| task-85 移动端移除「取消日记标记（整本）」 | **完成（未 commit）** | 见 §2：DiaryPage 菜单/确认流、`bridge.clearDiaryMark`、`diaryRepository` unmark 写路径、`WRITE_OPS` 登记、相关测试与文案全删；`space` 读取/同步/知识库过滤保留。 |
| 出口 ①「转为文档」（单篇移出日记本） | **PASS** | 移动端 UI ⋯→转为文档…→普通笔记本；两端 parent/space 正确、正文不丢（见 §3.1）。 |
| 出口 ②「转为小记」 | **PASS（桌面 UI）** | 桌面右键日记条目→转为小记：创建小记（日期标题第一行）、日记原文入回收站（软删、`purged=false`）、可从回收站恢复、移动端同步可见（见 §3.2）。**移动端当前无「转为小记」入口**（仅桌面提供）。 |
| 反向移入（普通文档移入日记本） | **违反 §3#25，登记待修** | 移动端通用「移动」目标来自 `getHomeSnapshot()` 全部 notebook/group（`moveTargetsFromSnapshot` 未按 `space` 过滤）⇒ 列表含日记本（见 §4）。未实际执行反向移动（避免制造违规数据）。 |
| 日记本不可变（移动端） | **PASS** | 知识库不显示日记本；日记页无排序/视图/改名入口；⋯ 菜单只剩「转为文档…」「删除」（见 §4）。 |

## 1. 移除前现状记录（原 task-81 ①②；前缀 `audit-261112-diary-192559`，已清理）

装置：M1 = `emulator-5556` lake_gate，M2 = 独立 AVD（因 `emulator-5558` 被其他任务的 perf 压测占用：9337 上 `syncQuickNote` 在跑、S3 前缀 `perf-qp-192702`），D1 = 隔离桌面 9237；三端同桶同前缀。

- **① 标记日记 → 同步**：M1 `createNotebook({space:"diary"})` + 日记文档「2026-11-12」→ 同步（↑2）→ **M2/D1 日记空间出现**（M2「日记 1 篇 / 11 月 12 日 / 写于 19:26」；D1 日记空间列出「2026-11-12 / 验收日记本」）；**知识库均不显示该本**。PASS。
- **② 取消标记 → 同步**：M1 日记页 ⋯→「取消日记标记（整本）」→确认→同步；M2/D1 日记空间归 0、知识库出现「验收日记本 1 篇」、**原日记文档仍在**（数据级：`space=null` + 文档 parent 不变；M2 UI 复核「日记 0 篇 / 知识库含本」）；再两轮三端 `↑0 ↓0` 状态不变。PASS。
- 附带观测（功能已移除，记录备查）：桌面**增量**发布的新日记本（gen5 远端 `space="diary"`）在移动端拉取后 `space` 落成 `null`——`src/core/s3v3/commit/engineBridge.ts` 的 `applyFolders` 不回填 `space`（首拉路径不经过它，故初次同步正常）。随「取消标记」能力移除，此路径不再承载日记标记变更；如需保留增量标记语义应另立项。

## 2. task-85 移动端移除（代码，未 commit）

范围（只动 `src/mobile/**` + `WRITE_OPS` 登记）：

1. `src/mobile/diary/DiaryPage.tsx`：⋯ 菜单删「取消日记标记（整本）」项与确认流（余「转为文档…」「删除」），删 `BookX` 图标。
2. `src/mobile/bridge/diary.ts`：删 `clearDiaryMark`（与 `DiaryUnmarkResult` 引用）；保留 `diaryOpenDate`。
3. `src/mobile/diary/diaryRepository.ts`：删 `clearDiaryNotebookMark` 写路径与 `planDiaryUnmark` / `DiaryUnmarkResult`。
4. `src/core/maintenancePolicy.ts`：删 `WRITE_OPS` 的 `clearDiaryMark`；`maintenancePolicy.test.ts` 计数 45→44 / 100。**（audit-core 的 task-84 也在改 core 同名文件，若与他们的版本冲突以他们为准。）**
5. 测试/文案：`mobileDiaryWiring.test.ts` 删 ④ 段并新增「已移除」护栏（页面/bridge 不得再有 clearDiaryMark / 取消文案；仍须有 diaryOpenDate）；`diaryPage.render.test.tsx` 删 unmark mock/两用例；`diaryRepository.test.ts` 删 unmark describe；`mobileFolderSpaceSync.test.ts`/`mobilePlatformPort.ts` 注释中性化（space 显式写 null 的规则保留）。
- **保留**：`folders.space` 列/wire/读取/同步/知识库过滤、日记本创建、单篇出口（转为文档/转为小记）均不动。
- 门禁：`npx tsc --noEmit` 0；相关 vitest 7 文件 55 用例全绿；`git diff --check` 0。
- **移动快照未重烤**（UI 有变化，按 lead 要求等移除完成后统一烤）。

## 3. 单篇出口设备验证（M1 5556 + D1 隔离桌面 9237 + 真实桶前缀 `audit-261112-move-201107`，已清理）

装置：M1 建「验收日记本(space=diary)」+日记文档「2026-11-12」、「普通笔记本(space=null)」+普通文档「周报」→ 同步；D1 拉取后两端一致（`space=diary` / 文档 parent 正确）。

### 3.1 出口①「转为文档」（移动端 UI，PASS）
- 步骤：日记页 ⋯→「转为文档…」→ 目标列表 = **个人笔记 / 普通笔记本**（`core.diaryConvertTargets` 已排除日记本）→ 选「普通笔记本」→ 确认。
- 结果（移动端）：文档 2026-11-12 的 `parentId` 由日记本 → `普通笔记本`；正文长度 71 不变、标题不变；toast「已转为文档：《普通笔记本》」；日记本仍 `space=diary`。
- 同步后（D1）：`parentId=普通笔记本`、`space` 归属正确（文档本身 space=null，父为本）、正文长度 71 不变；两端再两轮 `↑0 ↓0` 状态稳定。

### 3.2 出口②「转为小记」（桌面 UI，PASS）
- 步骤：D1 日记空间右键条目「2026-11-13」→「转为小记」（菜单项确实存在：转为文档… / 转为小记 / 删除）。
- 结果（D1）：新建小记（`previewText=2026-11-13`，日期标题在第一行、正文接在其后）；**日记原文进回收站**：`listTrash` 行 `id=eedbeca2…`、`parentId=notebook-trash`、`purged=false`、`cloudDeleted=false`、`fromDiary=true`（软删，非 purge）；`restoreTrash` 后回到日记树（`parentId=1bb3ee68…` 日记月分组）⇒ **可恢复**。
- 同步：D1 ↑2（小记 + 日记软删）→ M1 拉取后小记出现在小记页（`getQuickNotePage` 含「2026-11-13」）、`listTrashed` 含原日记（cloudDeleted=false）；D1 恢复后再同步，M1 日记空间恢复显示「日记 1 篇 / 11 月 13 日 / 写于 20:20」（**注：恢复传播在 M1 上多花了一轮 `syncNow` 才可见，两轮都报 ↑0 ↓0，记录为观测**）。
- 提示文案（代码 `src/App.tsx`）：`已转为小记（图片 / 附件未搬运）；日记已移入回收站，可恢复`（本轮日记无图片/附件，故 `droppedMedia=false` 分支为「已转为小记；日记已移入回收站，可恢复」）。
- 已知限制照旧：图片/附件不搬运（明说）；**移动端当前没有「转为小记」入口**（仅桌面）。若要求移动端也提供，需另立项（不在 task-85 范围）。

## 4. 反向移入 + 移动端不可变现状

- **反向移入（普通文档 → 日记本）**：移动端通用「移动」入口的目标 = `moveTargetsFromSnapshot(getHomeSnapshot())`，只按 `nodeType` 过滤、**未按 `space` 过滤** ⇒ 目标列表包含「验收日记本」（实测：`[{个人笔记},{验收日记本 space=diary},{普通笔记本}]`）。与 AGENTS §3#25「日记本不作为移动目标 / 不支持反向移入」冲突 ⇒ **登记为待修**（未实际执行反向移动，避免制造违规数据）。修复面 = 移动端目标列表过滤 + 桌面侧同口径（audit-core task-84 范围）。
- **移动端不可变**：知识库树只显示「个人笔记/普通笔记本」，不显示日记本；日记页按钮仅 `搜索日记/按日期新建/今天新建/写今天`，**无排序/视图/改名/图标入口**；日记条目 ⋯ 菜单（移除后）仅 `转为文档… / 删除`。

## 5. 证据与清理

- 截图（`docs/audit-261112/evidence/diary-261112-task85/`）：`m1-diary-space.png`（M1 日记空间 1 篇）、`m1-knowledge-no-diary-notebook.png`（M1 知识库无日记本）、`d1-diary-space.png`（D1 日记空间）。
- 清理：前缀 `audit-261112-move-201107` `DELPREFIX` 删 **15** 对象、ListObjectsV2 **残留 0**；桌面 9237 按端口 PID kill（99934）；`emulator-5556` `pm clear`；临时脚本与临时截图删除（`.tmp-diary-* / .tmp-m85-* / .tmp-move-out / .tmp-d1-diario2qn`）；未重烤移动快照；未动正式数据。
- 早先 task-81 装置已清理（前缀 `audit-261112-diary-192559` 删 11 对象、残留 0；专 AVD 已删/关机；5558 未动）。

## 6. 门禁

- 移动端移除：`npx tsc --noEmit` 0；相关 vitest（diary/移动接线/maintenancePolicy/folderSpace）7 文件 55 例全绿；`git diff --check` 0。
- 只 commit 本目录文档 + 证据；`src/mobile/**` 等代码改动**未 commit**（等 lead 复核）。
