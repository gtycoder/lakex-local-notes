# 23 · 发版前代码复核（core / electron / IPC / 剪贴板）

> **性质**：只读复核（不改代码）。基线 `c2d4962b..8f5e54b7`（63 commits / 234 文件，其中测试 64 个；复核时 HEAD 仍在移动，最后 4 个 commit 均为文档）。
> **复核人**：audit-core（teammate）／日期 261112。
> **范围**：`src/core/**`、`electron/**`、`src/lib/native.ts`、IPC/preload/webApi、`src/features/editor/clipboardHtml.ts`、`src/core/editor/**`。
> **结论**：无 P0/安全问题/凭据泄漏；发现 **1 个 P1 真缺陷 + 2 个 P2 真缺陷 + 若干风险/风格项**（见 §2）。建议发版前至少修 F-01，其余可排期。

## 1. 门禁实跑

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | ✅ 0 错误 |
| `git diff --check` | ✅ 0（无空白/EOF 问题） |
| `npx vitest run electron src/core src/features/editor`（347 文件面） | ⚠️ 两次跑分别 2 / 1 失败，均为 `electron/store.test.ts > cleanupHistory` 5s 超时；隔离单跑通过（1.7s） |
| `npx vitest run`（完整） | ✅ **917 文件（906 passed / 11 skipped）/ 5769 例（5757 passed / 12 skipped）0 失败**（86s） |

结论：功能面绿；scoped 跑的失败是并行负载下老用例超时抖动（F-17），不是本轮回归。

## 2. 发现清单（未修，按严重度排序）

### F-01【P1 · 真缺陷】位置赢家=本地时，远端 `trashedAt` / `deletedFromParentId` 会残留（位置与内容判据打架）
- 位置：`src/core/s3v3/plan/plan.ts:67-77`（`withPosition`），调用点 `:223`（apply-remote meta）、`:256`（标签 apply-remote）、`:390`（发布合成）。
- 判定：`withPosition` 先 `...entry` 再用 `...(pos.trashedAt ? … : {})` **只覆盖真值**；当位置赢家=本地且本地 `trashedAt=null`、远端条目带 `trashedAt/deletedFromParentId` 时，展开后的对象仍保留远端值。
- 影响：
  - `apply-remote` 把远端正文落到本地时，`meta.trashedAt` 仍是远端回收站时间 ⇒ `engineBridge.ts:236-237` 重建条目带 `trashedAt` ⇒ deviceStore 走 `deleteNote`（本地被重新移入回收站）；用户「恢复/移出回收站」被远端正文更新回滚。
  - 发布合成同样会写出**过期回收站字段**（位置赢家=本地但索引仍写远端 trashedAt），下一轮又按「远端 trashed」参与合并，可能出现两端反复互刷。
- 复现（纯数据）：base=note 在回收站（T0）；local=恢复为 active 且内容略改（T1，位置本地变、远端未变）；remote=仍 trashed 但正文更新（T2）⇒ 内容判定 download、位置判定 local 赢 ⇒ 命中本缺陷。
- 建议修法：`withPosition` 对 `trashedAt` / `deletedFromParentId` **显式写 null**（`trashedAt: pos.trashedAt ?? null`），并补 plan 级用例「位置本地赢 + 远端内容赢且远端 trashed ⇒ apply-remote meta / publish 条目均无 trashedAt」。

### F-02【P2 · 真缺陷】同步 apply 仍可移动/回收「日记本」（§3#25 固定不可变只守了 IPC 入口）
- 位置：`electron/noteMetadataRepository.ts:302-370`（`importRemoteFolder` / `applyRemoteFolderMeta` 只对 `space` 做单调闸，不锁 `parentId/trashedAt/nodeType`）；`electron/trashLifecycle.ts:52-62`（删除守卫只在本地删除入口）。
- 判定：远端（旧客户端/脏索引）把日记本的 `parentId` 改成别的本、或 `trashedAt` 置位，同步会原样落库 ⇒ 本地日记本被移出知识库根 / 进回收站，与「像回收站一样的固定笔记本」冲突。
- 建议：对 `space==='diary'` 的目录 apply 冻结 lifecycle/parent（或 plan 合并侧对 diary 目录位置强制 local 并重发布），并补「远端给日记本发 parent/trashed 也无效」测试。

### F-03【P2 · 真缺陷】日记→小记转换存在「报错但留下半成品」的窗口
- 位置：`electron/diaryQuickNoteConversion.ts:130-137`（只对 `deleteTreeNode` 失败做回滚）；`electron/quickNotes/savePipeline.ts:240-268`（`promoteImport` 在 `try` 之外，失败时 journal 停在 `db_committed`）；`:365-386`（`recoverImports` 下次启动会补做 promote）。
- 判定：`createQuickNoteFromContent` 在 DB 提交后、文件 promote 失败会抛错；转换层此时尚未进入「软删日记」的 try，因此不会调 `removeUnsyncedQuickNote`；下次启动 `recoverImports` 会把这条小记补完 ⇒ 用户看到「转换失败」，重启后小记却出现、日记仍 active（重复而不丢数据）。
- 建议：`createQuickNoteFromContent` 捕获 promote 异常时清理 row/journal（或返回「需恢复」状态），转换层 catch 后按 `hasQuickNote(id)` 回滚；补「promote 写失败注入」用例。

### F-04【P2 · 风险】`diary_to_quick_note` 未校验「目标确实是日记条目」
- 位置：`electron/diaryQuickNoteConversion.ts:84-91`（只校验 `kind==='doc'`）；IPC 暴露于 `electron/webApiServer.ts:120`。
- 判定：渲染层只在日记条目菜单调用；但 webApi/自动化可对**任意普通文档**调用，成功后会把原文软删进回收站（从树里消失）。当前无数据破坏按钮，但这是超出产品语义的可达路径。
- 建议：校验祖先链含 `space=diary` 的笔记本（core 已有 `diaryNotebooks`/`diaryEntries` 判据），或明确把该 IPC 定义为「通用文档→小记」并同步文档。

### F-05【P2 · 风险】「不支持反向移入日记本」只挡住 move，还存在其它可创建进日记空间的入口
- 位置：`electron/noteMetadataRepository.ts`（`createNoteIn*`/`createGroup` 无 diary 守卫）、`electron/noteMetadataRepository.ts:246-260`（`duplicate_notes` 走副本管线，不经过 move 守卫）。
- 判定：`create_note_in`/`create_usheet_in`/`create_group`/`duplicate_notes` 若带 diary 组为父（webApi 可达；UI 不可达），即可在日记空间新建内容，绕过 §3#25「只支持单篇移出」。
- 建议：在这些入口加 diary 目标守卫（或明确「新建进日记 = 不支持」并在 IPC 层拒绝）；补用例。

### F-06【P2 · 风险】转换的「缺失资产」检测会漏非 ASCII / 含空格文件名
- 位置：`electron/diaryQuickNoteConversion.ts:66-77`（`referencedAssetNames` 用 `[A-Za-z0-9._-]+`）。
- 判定：历史/导入资产若文件名含中文或空格，引用不会被扫到：既不会报缺失，也不会被复制；正文改写后仍是旧 `/<noteId>/...` 引用 ⇒ 小记里媒体静默失效、`droppedKinds` 为空。
- 建议：转换后若 `carriedBody` 仍含 `/<noteId>/`（原作用域残留）⇒ 报错或至少告警；缺失检测改为「扫描作用域前缀 + 反向比对 assets 清单」。

### F-07【风险】单篇 apply 失败的 kind 是「两处判据」
- 位置：`src/core/s3v3/state/deviceStore.ts:681-689`（产出 `code: "remote_incomplete"`）；消费端各自再映射：`electron/s3v3/desktopSync.ts:180-199`、`src/mobile/v3/sync.ts:67-80`。
- 判定：core 的 warning 结构里 code 是 `remote_incomplete`，两端再改写成 `apply_skipped`；新增任何直接消费 `code` 的路径会按「远端内容不完整」展示（文案错误）。catch 还会吞掉所有异常（含非暂态），失败篇每轮重试并重复进入 warning，无上限。
- 建议：core 直接产出 `apply_skipped`（`PlanWarning.code` union 可扩），消费端不再二次映射；补「warning 数量稳定/不重复」用例。

### F-08【风险】目录落库两处隐式改写
- 位置：`src/core/s3v3/state/deviceStore.ts:392-399`（notebook 带父 ⇒ 静默改写成 group，无 warning）；`:375-390`（`foldersParentsFirst` 递归 `depth > 64` 直接 return，该节点本轮不在 out 里，外层再次 visit 时才补 ⇒ 极深目录顺序可能父在子后、仍落根）。
- 判定：前者掩盖上游「目录 nodeType 丢失」的真因（本轮已修 `meta.kind→meta.nodeType`），但脏数据仍会被静默改类型并传播；后者是极端深度下的顺序兜底缺口。
- 建议：coercion 时 `warn` 并计数；`foldersParentsFirst` 改成拓扑排序（或超深时仍 push，仅不递归父）。

### F-09【风险 · 计数】清空/过期清理跳过日记本但计数包含跳过项
- 位置：`electron/trashLifecycle.ts:178-200`（`autoPurgeExpiredTrash` 返回 `rows.length`，含被跳过的日记本）；`:381-397`（`emptyTrash` 无返回值）。
- 判定：历史脏数据里日记本在回收站时，UI「已清理 N 项」会偏大（实际没清）。建议单独计数并在返回里区分 skipped。

### F-10【风险 · 语义边界】`restoreTrashItem` 用 `flattenedSubtreeIds` 恢复子树可能带回「更早单独删除」的子项
- 位置：`electron/trashLifecycle.ts:238-276`。
- 判定：子树集合 = parent 链 ∪ `deleted_from_parent_id + trashed_at`；若子项在父之前**单独**被删进回收站，恢复父时也会把它一并恢复（清 trashed_at）。这是「删除整棵子树」的合理近似，但未在文档/测试中写明；建议补一个「先删子、再删父、恢复父 ⇒ 子是否恢复」的用例固定语义。

### F-11【风格/风险 · 低】warning 合并只按文本交集去重，且把无结构日志一律归 `remote_incomplete`
- 位置：`src/core/syncWarningMerge.ts:25-36`。
- 判定：结构化 warning `message` 为空时（部分 PlanWarning 只有 id/kind）不会与一行式日志匹配 ⇒ UI 里同一件事出现两条；把「上传失败/锁冲突」等无结构日志统一归 remote_incomplete，文案可能误导。建议按 kind+id 去重、无 kind 的日志用中性 kind 或原文展示。

### F-12【风格 · 单一来源】两套「日记本不能当目标」过滤
- 位置：`src/core/diary.ts:390`（`moveTargetCandidates`，core）vs `src/features/aiWriting/aiWritingDocs.ts:66-71`（`selectableNotebooks`，features 内自己算 `diaryNotebooks`）。
- 判定：后者不复用 core 判据（只排 notebook 行、不排子树）；规则变化会漂移。建议 `selectableNotebooks` 改用 `moveTargetCandidates` 后过滤 notebook（或抽 core 公共谓词）。

### F-13【风格】注释/EOF 残留
- `electron/store.ts:745-750`：`readNoteBodyForConversion` 前残留「源笔记 note-assets…」旧 JSDoc，注释与函数不符（应删旧注释）。
- `electron/trashLifecycle.ts` 文件末尾无换行（diff 显示 `\ No newline at end of file`）。

### F-14【风险 · 低/已知】剪贴板原图尺寸的取不到场景
- 位置：`src/core/editor/imageDimensions.ts:20-23`（data URL 只接受「无参数纯 base64」；带 `;charset=`/URL-encoded 直接 null）、`:84-100`（JPEG 只扫头部 ~6KB，大 EXIF 可能取不到 SOF）；`src/features/editor/clipboardHtml.ts:235-243`（`blob:` 假设 blob=原图）。
- 判定：取不到时**省略 width/height**（符合 task-82 口径，不是缺陷）；但若 blob 实际是缩略预览，会写显示尺寸（当前代码路径下 blob 为待上传原文件，风险低）。建议在 `blob:` 分支加注释/尺寸来源断言。

### F-15【风险 · 低】回收站行接收同步正文后的 dirty 清理依赖 meta apply
- 位置：`electron/noteContentRepository.ts:62-96`（`saveSynced`/`allowTrashed`）与 `:130-150`（通用 save 尾部会写 title/`is_dirty=1`/updated_at）；`src/core/s3v3/state/deviceStore.ts:599`、`:634-650`（keepLocalTrash 的 meta 应用）。
- 判定：正文写入本身会标 dirty/bump updatedAt，正常路径由紧随的 `applyRemoteNoteMeta` 清 dirty；若该轮走 `lifecycleRace` 保护跳过 meta，回收站行可能保持 dirty（下一轮可能上传回收站内容）。建议补「回收站行接收正文 ⇒ dirty 最终清掉」用例或让 saveSynced 同步清 dirty。

### F-16【已知近似 · 非缺陷】位置两边都动时用内容 `updatedAt` LWW
- 位置：`src/core/s3v3/plan/positionMerge.ts:96-98`。协议无独立位置时间戳是已知近似，AGENTS §3#24 已声明；不新增 wire 字段。

### F-17【门禁观察 · 非缺陷】并行负载下 `cleanupHistory` 用例 5s 超时
- 位置：`electron/store.test.ts:938`（跑 105 份快照 + cleanup）。完整套/串行通过；scoped 并行跑两次分别 2/1 失败、隔离 1.7s 通过。建议该用例 timeout 调到 15s（或减少快照数），避免 CI 抖动。

## 3. 重点复核覆盖与「已核对无问题」的点

1. **S3 语义**：`positionMerge`（位置三件套独立合并/投影）、`mergeNoteLock`、wire `parentId` 归一（trashed ⇒ parentId=null）、F-01 两路边子树 purge/restore、S72 强制留档条件、F-01b 目录 purge（intents + 索引过滤 + 落库拒 trashed 副本）、H73 lifecycleRace（仅本地窗口内改生命周期才保护）、单篇 apply 降级（`onApplyWarning` + `apply_skipped`）、移动端远端 purge 保副本 —— 逻辑与既有测试对齐；**唯一缺口见 F-01**。
2. **日记不可变**：`space` 单调（plan `enforceDiarySpaceMonotone` + 落库 `diarySafeFolderSpace` 双侧）、删除/purge/emptyTrash/过期清理守卫、rename/icon/reorder/move 守卫、两个出口（转文档 move+rename；转小记 journal/回滚/缺资产/droppedKinds/非 doc 拒绝）——IPC 入口覆盖完整；绕过路径见 F-02/F-04/F-05/F-06。
3. **新 IPC `diary_to_quick_note`**：register/preload/webApi/native 三处 + parity 187 一致；移动端未误用（无对该通道的消费）；`moveTargetCandidates` 与 `selectableNotebooks` 重复见 F-12。
4. **剪贴板图片尺寸**：`imageDimensions` 解析 PNG/JPEG/GIF/WebP（含 VP8/VP8L/VP8X）并做宽度/长度防护；坏 data URL/短头/未知格式 → null（调用方省略尺寸）；不再写显示尺寸。风险点见 F-14。
5. **泄漏/脏东西扫描**（`git grep` 当前树 + 新增行扫描）：无 `__tmp`；新增代码无 `console.log/debug`（唯一 `console.log` 是既有 asset-server 启动日志）；无 `.only`/`it.skip`；无硬编码本机路径/凭据（仅测试 fixture 用 `example`/`/Users/x`）；`git diff --check` 干净；未见注释掉的整段代码。

## 4. 限制
- 本轮为静态复核 + 单机测试门禁：未跑真机/多端并发真实桶（由 19/22 号真实桶报告覆盖）；移动端代码不在本报告范围。
- 未对每一条历史审计结论重新实测；只核本轮 diff 涉及的语义与护栏。
