# 日记（Diary，桌面 + 移动 v1）

> 261109 立项。**数据 = 笔记本体系内的普通 Lake 文档；表现 = 顶层独立空间。**
> 只写我们自己的契约与决策；进度/分支/门禁计数看 `docs/HANDOFF.md`。

## 决策（用户 261109 定稿）

1. **存储完全依托笔记本体系（D2）**：日记 = 一个带标记的笔记本；**不新建数据空间、不新建表**。正文/历史快照/回收站/FTS/导出/备份/便携包全部复用文档那一套。
2. **表现 = 独立空间**：空间组第 3 项（文档 ⌘1 / 小记 ⌘2 / **日记 ⌘3** / AI 写作 ⌘4 / 标签 ⌘5），与文档目录树解耦。
3. **标题即日期** `YYYY-MM-DD`（**只能是日期，改名入口直接拒绝**）；层级 `日记 → 2026 → 11 → 2026-11-09`，**年/月两级分组自动创建**（group 节点，随 `folders[]` 同步）。
4. **一天允许多篇**（261109 六改）：加号 = 今天新建、日历 = 选任意日期新建（两者都走 `mode:"new"`，**永远新建**）；默认打开走 `mode:"open"`（当天最新/没有就建）。同日多篇按 `createdAt` 倒序、行内显示时刻区分。**移动端自 261110 起与桌面同能力**：日记页「写今天」= `mode:"open"` 幂等，右上角 ＋ = 今天新建、日历 = 任意日期新建（都走 `mode:"new"`）；bridge 接受 `dateKey + mode`。
5. **UI 细节（261109 七改；261113 图标/改名开放）**：左栏**可拖**（复用 `SplitPane` + `SplitHandle`，宽度设备本地记忆）；日记本名字前按节点图标显示（261113 起**允许换图标**：日记空间页头 ⋯ →「设置图标」；默认仍是笔记本图标）；「按日期新建」= **应用内月历**（kit 的 `.ln-calendar*`，与多维表日期字段同一原语）→ 选完再弹确认，不用系统 date picker。
6. **空间 tab 各自独立**：`OpenTab.space` 标记归属，日记 tab 条只列 `space === "diary"`，文档空间反过来；切空间时活动标签回落到该空间。
7. **没有旧端**：允许加 wire 字段，不为旧客户端写降级。
8. **两端都做**（桌面空间页 + 移动第 4 个 tab）。
9. **要搜索**（日记是文档 ⇒ 天然进 FTS；空间内给"搜日记"入口）。
10. **不打标**：日记文档不提供标签入口，不进标签空间聚合。
11. **v1 不做**：缺天提示、补写任意日期、月历视图、streak、提醒、心情/天气/位置字段。
12. **不做「取消日记标记」（261112 用户裁决）**：日记本 = 带 `space` 标记的笔记本，**就是日记本，不可取消标记、也不可删除**；跨空间只允许**单篇条目**两个出口：**转为文档**（移到知识库其他笔记本）/ **转为小记**（正文与媒体**移动**到小记空间，无副本）；**不支持把普通文档移入日记本**——日记本不作为移动目标、也不在知识库树里显示（`core.diaryConvertTargets` 明确排除日记本）；正文/历史/回收站/索引跟随。整本转换没有入口，也不计划（§3#17）。

## 日记本不可变（261112 用户裁决）

日记本 = **像回收站一样的固定特殊笔记本**：由系统创建、由 `folders[].space === "diary"` 标记，**不可取消、不可删除**。四条铁律：

1. **不可取消标记**：没有「取消日记标记（整本）」的 IPC / UI / 写路径；`space` 只允许 `null → diary` **单调升级**，**禁止 `diary → null`**（发布、导入、远端应用、恢复一律拒绝；读取容错仍把未知值当非日记——那只是读，不是写）。
2. **不可删除**：日记本节点（含整本级联 / 批量删除 / purge）必须拒绝并给明确提示；不提供「删除日记本」入口。历史脏数据里已被软删的日记本按「删除与恢复」既有路径处理，不做自动修复。
3. **不可删除 / 排序 / 作为移动目标；改名与换图标已开放（261113 用户裁决）**：日记本在知识库树里不可见；**改名/换图标入口 = 日记空间自己的页头 ⋯**（桌面左栏头 / Android 日记页头，只给「重命名 / 设置图标」两项）；内容顺序是**固定派生顺序**（年 → 月 → 日期），不提供排序 / 重排，`sort_order` **不可由用户编辑**；**改名 / 换图标仅限日记本节点本身** —— 日记子树里的年/月分组与日记条目仍然拒绝（底层通用改名/图标 IPC 对非本体子树必须拒绝）。普通文档不能移入日记本；移动目标选择器与 `moveTreeNode` 一类写入口都按本约束校验。
4. **跨空间只允许单篇条目的两个出口**（底层都是普通文档 / 普通笔记本，UI 只控制样式与能力）：**转为文档** = 换父移动（同一个 note id），正文 / 历史 / 回收站 / 标签关系 / S3 索引跟随，不复制、不改格式、**不删**；**转为小记 = 移动（261113 用户裁决）** = 新小记 id + 正文除 `/<noteId>/` → `/quick-notes/<id>/` 作用域改写外零改写 + 资产目录整体移动（原目录不留副本），随后 Lake 侧原稿**物理移除**（不进回收站，历史快照一并删除）⇒ **无副本、不可恢复**，入口先二次确认。**卡片零剥离**（同一内核正文原样承载）；**非 doc 类型整篇拒绝**。**不支持反向移入**；整本转换没有入口，也不计划。

**为什么不能开口子（取消 / 删除 / 排序都会退化）**：编年空间的成立条件 = **固定容器 + 固定顺序**（年 → 月 → 日期由时间派生）。一旦允许取消（`diary → null`）：

- 日记空间就退化成「知识库的一个视图」——时间线、年/月两级组、「写今天」的幂等容器（固定日记本 → 年 → 月 → 文档）都失去固定锚点；
- `space` 是 wire 上的**显式字段**（非日记写 `null`）：一台取消、一台保留 ⇒ 归属两端来回翻转、互刷，且没有判定赢家的位置（它不属于位置三件套）；
- 回收站 / 历史 / 「日记来源」判据（`trashDiaryOrigin` 沿 `deleted_from_parent_id` 回溯到 `space="diary"` 的笔记本）会失去锚点，恢复落点不可预期；
- **排序**同理：`sort_order` 一旦成为用户可编辑状态，编年序列就不再由时间派生，日记退化成普通笔记本（与知识库没有区别），两端还会因排序写入顺序不同而互刷；
- **删除**日记本 = 整个编年空间消失（容器、年/月组、时间线锚点一起没了），历史/恢复语义无处落，且没有重建入口。

**这条是产品红线**：改动需**用户裁决**，并同步本文件与 `AGENTS.md` §3#25。

## 分层与单一来源

| 层 | 位置 | 职责 | 归属 |
| --- | --- | --- | --- |
| 判据（纯函数） | `src/core/diary.ts` | 日期键、年/月分组、幂等 plan、条目分类与时间线分组 | **已完成** |
| wire | `LakeFolderEntry.space?: "diary" \| null` | 日记本标记（**不复用 `kind`**：`TreeNode.kind` 已被文档类型占用） | 存储片 |
| 平台端口 | `SyncFolderRow.space` | 两端统一行形状 | 存储片 |
| 本地列 | `tree_nodes.space` | 桌面表 + 移动表（`MOBILE_SCHEMA_VERSION` +1） | 存储片 |
| 桌面存储 | `electron/diaryStore.ts`（新）+ `noteMetadataRepository` | 建本/建组/建文档，**单事务** | 存储片 |
| IPC | `diary_open_date` | 幂等打开某天；详见下 | 存储片 |
| 桌面 UI | `src/features/diary/**` | 空间页、左栏年/月、主区复用 `EditorTab` | UI 片 |
| 移动 | `src/mobile/diary/**` | 第 4 个 tab、列表、搜索入口 | 移动片 |

## IPC 契约（跨片约定，先落名再实现）

```ts
// preload → renderer；三处同步改：electron/main.ts(handle) + preload.cjs + src/lib/native.ts(类型)
// mode 省略 = "open"（幂等）；"new" = 永远新建一篇（261110；一天允许多篇）
diary_open_date(dateKey: string, mode?: "open" | "new"): Promise<{
  noteId: string;
  created: boolean;      // 本次是否新建了文档
  notebookId: string;
  duplicates: string[];  // 同名重复文档（历史脏数据），只告警不删除
}>
```

- **主进程重新 plan**，不信任渲染层传的 nodeId（防 TOCTOU）。
- 整个 ensure（笔记本 → 年组 → 月组 → 文档）在**一个事务**里；并发由写域串行保证，连点只产生一篇。
- 渲染层需要的列表/树继续走既有 `list_tree_nodes`（`TreeNode` 已加 `space`），**不新增列表 IPC**。

## 数据流

```
renderer: list_tree_nodes（含 space）
  → core.diary.diaryEntries(时间线) / planDiaryOpen(是否要新建的展示)
  → 需要新建时 IPC diary_open_date(dateKey)
     → 主进程 ensureDiaryNotebook(space="diary") → ensureGroup(年) → ensureGroup(月) → insertNote(title=dateKey)
  → 返回 noteId → 打开（复用 EditorTab）
```

## 硬规则

1. **`space` 必须显式写**：日记本写 `diary`、非日记写 `null`（不是省略字段），否则 wire 上不可见、两端互刷（同 `tagIds` 空集合必须写 `[]` 的教训）。
2. **读取容错**：未知 `space` 值 → 当非日记；多个 `space="diary"` → 取第一个并告警，**不自动修复**。
3. **失败分级**：日期键非法 = 拒绝并明确报错；正文模板失败 = 只告警、空文档保留。
4. **建完只展开/选中今天节点，不抢正文焦点**。注意：主进程/数据层新建的 笔记本/年组/月组/文档 只有**重读一次树**才可见（现有实现：`refreshTree()` 之后 `openNote`），这是数据新鲜度的要求，不是「刷整棵树的观感」——**要避免的是**滚动跳动、抢焦点、其它空间重建。
5. **文档空间不显示日记本**（渲染层过滤 `withoutDiaryNotebook`），存储不改。
6. **移动端任何输入面仍只走 dock**；日记页只做"列表 + 写今天 + 新建（今天/任意日期）+ 搜索"，不新造输入面。
7. **"打开" vs "新建" 一律由 mode 表达**（两端口径一致）：`open` = 幂等（当天已有就开最新一篇）、`new` = 永远新建；**判断在哪天有没有文档由 core 的 plan 做**（`planDiaryOpen` / `planDiaryCreate`），UI 只传 mode，不自己判。
8. **排序 = 日期倒序，同日按真实"创建时间"倒序**（用户 261110 定稿选 B）：分组（年/月）与日期倒序不变；同一天多篇必须用**创建时间**，**不许用修改时间**（编辑旧的一条会把它顶乱）。移动端 schema **v13** 起 `notes.created_at` 持久化真实创建时间（老行迁移回填 = `updated_at`；wire 不带文档创建时间 ⇒ 从桌面同步来的第一次落地按 `updatedAt` 记一次、之后不再变）；行内「写于」= 创建时间。
    **同一判据也要用于目录树**（261110 二次确认：「这里才是真正的笔记本里的排序」）：移动端工作区「文档树」抽屉里日记本子树同样按 年/月 倒序 + 日期倒序 + 同日创建时间倒序（`core.compareDiarySiblings` + `buildNotebookTreeIndex({ diaryRootId })`）；**只改显示，不改 `sort_order`/不做落库迁移**（其它笔记本仍按 sort_order）。
    **日记子树禁用长按拖拽排序，也不提供排序 / 重排入口**（261110 用户定稿 + 261112 不可变裁决；桌面端本来也没有拖拽排序）：顺序既由时间派生，拖拽 / 排序就没有可表达的结果 ⇒ 直接不响应；`sort_order` 不可由用户编辑；判据 = `treeDragEnabled(space)`（`src/mobile/notebook/useTreeDrag.ts`），工作区把 `notebook.space` 传进 `useTreeDrag.enabled`；护栏 `treeDragDisabled.test.ts`。多选/行内 ⋮/＋ 不受影响。

9. **日记本不可取消标记、不可删除、不可排序；改名/换图标仅限日记本本身（261112 裁决 + 261113 放开）**：日记本 = 带 `space` 标记的固定笔记本，顺序固定编年派生（见「日记本不可变」）；没有「整本转普通 / 取消标记」入口（也不计划）；跨空间只允许**单篇条目**两个出口（「转为文档」移动 / 「转为小记」正文与媒体**移动**到小记空间、无副本；见下节）；**不支持把普通文档移入日记本**——日记本不作为移动目标、也不在树里显示。

## 转为文档 / 转为小记（261109）

日记条目有**两个单篇出口**（桌面条目**右键**、移动端条目 **⋯** 都有，同名同语义）：

**①「转为文档…」= 移动**：共享弹窗里只选**知识库（笔记本）**这一层（**不选分组、不出现日记本**）、标题默认日期键但可改；确认后**先 move 再 rename**（日记条目不接受改名），失败一律可见 → 该条落到目标笔记本末尾、成为普通文档（同一 note，不复制、不删）。
**②「转为小记」= 移动（261113 用户裁决）**：把这篇日记的 Lake 正文与图片/附件**移到**小记空间 —— 新小记 id（不沿用 id 是因 v3 的删除意图/云端已删除标记按 id 跨空间共享）、正文除 `/<noteId>/` → `/quick-notes/<id>/` 作用域改写外零改写、资产目录**整体改名移动**（原目录不留副本）；随后 Lake 侧原稿**物理移除**（不进回收站；原文档历史快照一并删除）⇒ **无副本、不可恢复**，两端入口都先二次确认。**卡片零剥离**（同一内核正文原样承载，没有白名单/`droppedKinds`）；同步侧只写删除意图（`deleted_notes`，元数据、不是副本）。

> **跨空间只允许这两个单篇出口**（261112 用户裁决）：日记本就是日记本，**没有「取消整本日记标记」**入口；两个出口都**不支持反向移入**（日记本不是移动目标、也不在树里显示）。「转为文档」正文/历史/回收站/索引跟随；「转为小记」**原样承载 Lake 正文并把图片/附件一起移动**（不做卡片剥离、不复制副本）；**非 doc 类型（表格/多维表/画板/手写板）整篇拒绝**（提示先转为文档）。

- **「转为文档」语义 = 移动**（同一个 note id 换父节点）：正文、历史快照、回收站、标签关系、S3 索引全都跟着走，**不复制、不改格式、不删**（日记本来就是 Lake 文档，没有「格式转换」这回事）；「转为小记」则是**跨空间移动**（见下条，新 id + 零复制，无副本）。
- 移出后自然从日记时间线消失（`diaryEntries` 只扫日记本子树）；**移出后不会自动变回日记**——日记本不是移动目标，普通文档无法移入（想继续写日记，用日记空间的「写今天 / ＋」新建）。
- 判据单一来源：`core.moveTargetCandidates()` 先剔掉日记子树（261112 日记本不作移动目标），桌面再 `.filter(nodeType === "notebook")` ⇒ **只到知识库（笔记本）这一层，不出分组、不出日记本**；移动端仍用 `core.diaryConvertTargets()`（根层笔记本、排除日记本）。两端都再经 `core.planDiaryConvert()` 校验条目确实是日记、目标合法。UI 与写入路径都先问 core，不另写一套。
- 入口：桌面条目**右键菜单**两项（「转为文档…」= `Menu` + `usePopoverPosition`；「转为小记」）；移动端条目行 ⋯（`MobileSheetMenu`）**同一组两项**（261113 task-106 补齐「转为小记」）。
- **桌面「转为文档」弹窗 = 与 AI 写作「生成文档」同一个共享实现**（261112 task-91 用户裁决）：`src/components/app/PublishDocDialog.tsx`（浮动窗、样式 `styles/app/dialogs.css` 的 `.publish-doc*`）。只选知识库（笔记本）这一层、**不选分组、不出现日记本**、**标题默认日期键但可改**；确认后先 `move` 再 `rename`（日记条目不接受改名，AGENTS §3#25），失败一律可见（移动失败不动标题；改名失败明说「已移出、但改名失败」），随后刷新目录树。移动端目标选择仍用 `MoveTargetTreeSheet`。
- **「转为小记」实现口径（261113 用户裁决 = 移动，两端同语义）**：桌面 `electron/diaryQuickNoteConversion.ts` / 移动 `src/mobile/diary/diaryToQuickNote.ts` ——
  1. **类型门**：`kind !== "doc"` 直接拒绝（表格/多维表/画板/手写板正文不是 Lake 文本，提示先转为文档）；
  2. **正文零改写（除作用域）**：`rewriteQuickNoteAssetScope` 把 `/<noteId>/` 改成 `/quick-notes/<newId>/`（原样 / 单编码 / 双编码三层）；**不做任何卡片剥离**（无白名单、无 `droppedKinds`、无 `stripUnsupportedCards`）；
  3. **资产 = 目录整体移动**：`moveAssetDirectorySync`（桌面 rename，跨盘才 copy+delete）/ `assetFs.moveNoteAssetsDirToQuickNoteFs`（移动端原生 copyAssetDir + 删源）⇒ **源目录不留副本**；正文未引用的残留文件也一起走（不留在已消失的原文目录）；
  4. **原子落库**：桌面 `quickNotes.adoptMovedNoteAsQuickNote`（journal + 小记行/资产声明 + 目录移动 + 搜索索引）/ 移动 `saveQuickNoteContent`（保留原创建/更新时间）→ 成功后才 `removeNoteForQuickNoteMove` / `purgeTreeItem` **物理移除** Lake 侧（notes/tree_nodes/正文/history/FTS；写删除意图 `deleted_notes` 防止下一轮同步被云端拉回）；失败回滚：**先移回资产目录**，成功才删小记行，绝不为删干净丢唯一字节副本；
  5. **正文引用的资产文件缺失 ⇒ 整篇拒绝**（不产生指向不存在文件的半成品；原稿与其它资产原样保留）；
  6. **提示文案**：`diaryToQuickNoteNotice(result)` →「已转为小记（含图片/附件）；原日记已移出日记本，无副本、不可恢复」，有历史快照被删时明说「原文档历史快照已删除」；纯文本镜像 = 标题 + 正文纯文本（预览/搜索/降级显示）。
- **两端入口都要二次确认**（不可恢复）：桌面条目右键「转为小记」→ `useConfirm`（危险色，正文写明无副本/历史删除）；移动端条目 ⋯ → `confirmMobile` 同文案。
- **目标选择器支持调用点文案**：261110 给移动目标树加了 `title` / `confirmLabel` / `description` 可选参数（普通移动仍用默认「移动到… / 移动到此处」，render 测试锁默认值不回归）；261112 起桌面转文档改用共享 `PublishDocDialog`，传 `heading="转为文档"` / `confirmLabel="转为文档"` / 自己的 `description`，AI 写作「生成文档」用默认口径。
- **不做**：不自动清理搬空后的年/月分组（空分组无害，清理由用户或以后统一做）；不提供「转回日记」的专用动作（见上：日记本不是移动目标，无法移入）。

## 搜索

- 日记 = 文档 ⇒ 已在 FTS5 索引里，桌面 ⇧⌘F 与移动全库搜索天然命中（**验证即可，不新增索引**）。
- 日记空间提供"搜日记"入口：复用现有搜索 UI，范围过滤以 `space === "diary"` 的子树为准（v1 允许先复用全库搜索）。
- **不打标**：空间内不提供标签入口；标签空间不聚合日记。

## 不做（v1，别再立项）

缺天提示 / **月历浏览视图**（注：261110 加的「日历」入口只用于**选一个日期去新建**，不是翻看/管理月历，两者别混为一谈）/ streak / 提醒 / 心情·天气·位置字段。
理由：§3#17 三问未过；月历还会与多维表月历撞「同一交互语义只有一套视觉」（`audit-lookalike.mjs`）。

## 护栏（必须有的测试）

1. `src/core/diary.test.ts`（已完成，22 例）：日期键严格性、闰年、本地日期不跨 UTC、分组、wire 显式写 null、多本取首、条目分类、幂等 plan、重复文档告警。
2. 存储片：`diary_open_date` 幂等（连点两次只有一篇）、事务回滚（建组失败不留半成品）、`space` 不进非笔记本节点。
3. wire 片：`folders[].space` 往返（发布写 null / 应用缺字段当非日记）、便携包与整库备份保留 `space`。
4. UI 片：文档空间树不含日记本；日记空间左栏年/月来自 `core.diary`，不在组件里重算。
5. 移动片：schema 版本门 +1 生效、第 4 tab 不破首页 5 槽构图、tab 切换不改 `switchTab` 既有语义。
6. **新建语义（261110）**：`diaryPage.render.test.tsx`（＋ = `mode:"new"`、日历选任意日期 = `new`、主按钮 = `open`、连点只发一次）+ `diaryRepository.test.ts`（`new` 恒新建 / `open` 幂等 / 月组已存在时新篇落月组而不是日记本根）。
7. **默认空间（261110）**：`components/model/defaultSpace.test.ts`（桌面：默认文档、非法值回落、键前缀不进 AppSettings、三处接线）+ `settings/defaultSpace.test.ts`（移动：默认小记、非法回落、删除即回落默认、不进 S3）；桌面还有 `settingsSearch.test.ts` / `settingsGroups.test.ts` 同步项。
8. **返回落点（261110）**：`mobileDiaryWiring.test.ts`（仅日记来源记 tab，关闭回日记页签；其它入口仍回知识库；来源用完即清）。

## 来源（机制参考，不是抄实现）

思源 v3.8.4：路径模板 + IAL 标记 `custom-dailynote-YYYYMMDD`、先查后建的幂等、模板只在新建时套用（`kernel/model/file.go:1436`）。**它的坑不学**：中间路径段变成真文档 / 内核写死 `time.Now()` 无法补写 / 幂等键是标题路径 / 日记本只存在前端 localStorage。

## 实现落点（261109 交付）

| 层 | 文件 |
| --- | --- |
| 判据 | `src/core/diary.ts` + `diary.test.ts`（22 例） |
| wire | `src/core/s3v3/protocol/s3v3Index.ts`（`LakeFolderEntry.space` + 校验归一）、`plan/plan.ts`（发布映射） |
| 平台端口 | `src/core/s3v3/state/platformPort.ts`（`SyncFolderRow.space`）、`state/deviceStore.ts`（投影 + 变更判定） |
| 桌面存储 | `electron/diaryStore.ts`（单事务 ensure）、`electron/ipc/registerDiary.ts`、`electron/schemaInit.ts`（列 + ALTER）、`electron/noteQueries.ts`/`noteMetadataRepository.ts`（读写 space） |
| 桌面 UI | `src/features/diary/`（`DiaryWorkspace` / `diaryTree` 树过滤与 id 映射 / `diaryOpen` IPC 端口 / `diarySearch` / `diary.css`）、`App.tsx`（空间挂载 + 树过滤 + 搜索收窄；⌘3 在 `useDesktopLifecycle` 的 ⌘1–5 表里）、`DesktopTopBar.tsx`、`styles/chrome.css` |
| 移动 | `src/mobile/diary/`（`diaryRepository` 单事务 ensure + `mode` / `DiaryPage`）、`bridge/diary.ts`、`ui/MonthCalendar.tsx` + `ui/monthCalendar.css`（月历原语）、`data/schema.ts`（v12）、`home/tabPager.ts`（4 tab）、`settings/SearchSheet.tsx`（`scopeNoteIds`）、`settings/defaultSpace.ts` |
| 默认空间（261110） | 桌面 `src/components/model/defaultSpace.ts` + `SettingsPanel`「启动」组 + `desktop/useDesktopShell.ts` 初值；移动 `src/mobile/settings/defaultSpace.ts` + `SettingsDrawer`「常规」行 + `MobileApp` 初始 route |
| 搜索 | 复用既有 FTS + `SearchPanel.scopeNoteIds` / `SearchSheet.scopeNoteIds`（纯显示层；**不新增索引**） |

**已知边界**：桌面与移动各自只有一份编辑器宿主（日记空间与知识库同篇互斥，见 `App.tsx` 的 `libraryTabs`）。**移动端返回落点已修（261110）**：从日记条目进工作区后，返回（页面返回 / 安卓返回键两条都走 `useRouteTransition.onClosed`）回「日记」页签；其余入口（首页/搜索/置顶/笔记本）仍回「知识库」。

## 删除与恢复（261110）

- **删除** = 移入回收站（软删，可恢复）；两端入口：日记条目右键 / 移动端条目 ⋯ →「删除」，走**既有**删除确认与 `deleteTreeNode`，不新造删除路径。
- **恢复 = 原路返回**（用户定稿原则：**没转换就"从哪来回哪去"**）：
  1. 原父（年/月分组）还活着 ⇒ 原位返回（既有行为）；
  2. 原父被删/也在回收站、且来源是日记本 ⇒ **按标题日期把 `年 → 月` 分组补回来**再放进去（桌面 `ensureDiaryGroupsForRestore` / 移动 `ensureDiaryRestoreGroup`）；
  3. 标题不是日期（异常数据）⇒ 回日记本根（时间线仍按标题派生，不受影响）；
  4. 普通文档且原父不可用 ⇒ 既有回落（活跃笔记本），不受影响；
  5. 已「转为小记」的源文档**已被物理移除、不可恢复**（只有目标小记存在；要找回只能靠本机备份/便携包或云端历史，不在回收站）。
- **来源判据单一来源** `electron/trashDiaryOrigin.ts`（移动同义实现）：沿 `deleted_from_parent_id → parent_id` 回溯，**只认 `space="diary"` 的笔记本，绝不看标题**（标题写成日期的普通文档不得被当成日记）。
- **回收站徽标**：文档行显示「日记」（桌面 `.badge` / 移动 `.mb-tag`），来源同上。
- 已知边界（P2）：日记本自身也在回收站时，恢复单条日记无法落回日记空间（会走既有回落），应先恢复日记本。

## 交互补充（261110）

- 一天多篇：**＋ = 今天新建**、**日历 = 选日期新建**（应用内月历；桌面 = kit `.ln-calendar*` + `CalendarPanel`，移动 = 共享原语 `src/mobile/ui/MonthCalendar.tsx`，`.mbt-calendar-*` 已收编为 `.mb-calendar-*`，多维表日期 Sheet / 日历视图 / 日记共用一份）；新建是 `mode:"new"`，**写今天 / 移动端 ＋→日记** 是 `mode:"open"`（当天已有就开最新）。
- **两端口头三个入口，左→右 = 搜索 / 日历 / ＋**（261110 用户点单；＋ 永远最右）。桌面顺序护栏见 `DiaryWorkspace.render.test.tsx`，移动见 `diaryPage.render.test.tsx`。
- **移动日记页版式（261110 v2）**：玻璃页头 + 白卡分组（今日卡 / 年段卡）+ 行内 ⋯；行主区是**真按钮** `button.mb-set-item__main`（`kit.css` 有对应 reset —— 移动端没有全局 button reset，别再用 div 代按钮）。
- **「默认空间」（261110，两端各一份，仅本机）**：启动落在哪个一级空间。桌面 5 个空间、默认「文档」，键 `lakex-local-notes-v3.default-space`（`src/components/model/defaultSpace.ts`）+ 设置 → 常规 → 启动；移动 4 个 tab、默认「小记」，键 `lakex-local-notes-mobile.default-space`（`src/mobile/settings/defaultSpace.ts`）+ 设置 → 常规。**不进 S3 / wire / 同步**，两端可以不同；值非法/未设置一律回落默认。
- **标题只能是日期**：改名入口对日记条目直接拒绝（`core.isDiaryEntryNode`）。
- **独立 tab**：`OpenTab.space` 标记；缺字段的旧 tab 按「当前树里是不是日记条目」回落分流；日记 tab 条有自己的关闭全部 / ▾ 切换器 / 右键菜单（复用 `TabContextMenu`：关闭族 + 钉住，钉住置顶且免批量关闭）。
- **tab 上限按空间独立**（261110 用户定稿）：文档与日记各算各的（各 ≤ 设置值，上限 16），开 7 个日记 tab 不占文档的额度；**日记 tab 不进会话**（退出/重开后不自动恢复，文档空间仍按「退出时关闭全部标签」设置决定）。
- **左栏可拖**：`SplitPane` + `SplitHandle`（宽度设备本地 `split.diary-rail`；最小 200）。**注意 flex 子项必须 `min-width:0`**，否则内容会把宽度顶住、拖拽看起来"完全无效"。
