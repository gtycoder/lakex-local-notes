# 日记（Diary，桌面 + 移动 v1）

> 261109 立项。**数据 = 笔记本体系内的普通 Lake 文档；表现 = 顶层独立空间。**
> 只写我们自己的契约与决策；进度/分支/门禁计数看 `docs/HANDOFF.md`。

## 决策（用户 261109 定稿）

1. **存储完全依托笔记本体系（D2）**：日记 = 一个带标记的笔记本；**不新建数据空间、不新建表**。正文/历史快照/回收站/FTS/导出/备份/便携包全部复用文档那一套。
2. **表现 = 独立空间**：空间组第 3 项（文档 ⌘1 / 小记 ⌘2 / **日记 ⌘3** / AI 写作 ⌘4 / 标签 ⌘5），与文档目录树解耦。
3. **标题即日期** `YYYY-MM-DD`（**只能是日期，改名入口直接拒绝**）；层级 `日记 → 2026 → 11 → 2026-11-09`，**年/月两级分组自动创建**（group 节点，随 `folders[]` 同步）。
4. **一天允许多篇**（261109 六改）：加号 = 今天新建、日历 = 选任意日期新建（两者都走 `mode:"new"`，**永远新建**）；默认打开走 `mode:"open"`（当天最新/没有就建）。同日多篇按 `createdAt` 倒序、行内显示时刻区分。**移动端 v1 只做 open 语义**（首页 ＋→日记 = 默认今天、幂等打开；不提供选日期/多篇入口，bridge 也只收 dateKey）——属桌面能力差异，不是遗漏。
5. **UI 细节（261109 七改）**：左栏**可拖**（复用 `SplitPane` + `SplitHandle`，宽度设备本地记忆）；日记本名字前就是**笔记本图标**（默认图标兜底），点它 = 复用笔记本那套 `NodeIconPicker` 换图标；「按日期新建」= **应用内月历**（kit 的 `.ln-calendar*`，与多维表日期字段同一原语）→ 选完再弹确认，不用系统 date picker。
6. **空间 tab 各自独立**：`OpenTab.space` 标记归属，日记 tab 条只列 `space === "diary"`，文档空间反过来；切空间时活动标签回落到该空间。
7. **没有旧端**：允许加 wire 字段，不为旧客户端写降级。
8. **两端都做**（桌面空间页 + 移动第 4 个 tab）。
9. **要搜索**（日记是文档 ⇒ 天然进 FTS；空间内给"搜日记"入口）。
10. **不打标**：日记文档不提供标签入口，不进标签空间聚合。
11. **v1 不做**：缺天提示、补写任意日期、月历视图、streak、提醒、心情/天气/位置字段。

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

1. **`space` 必须显式写**：非日记写 `null`（不是省略字段），否则"取消日记标记"在 wire 上不可见、两端互刷（同 `tagIds` 空集合必须写 `[]` 的教训）。
2. **读取容错**：未知 `space` 值 → 当非日记；多个 `space="diary"` → 取第一个并告警，**不自动修复**。
3. **失败分级**：日期键非法 = 拒绝并明确报错；正文模板失败 = 只告警、空文档保留。
4. **建完只展开/选中今天节点，不抢正文焦点**。注意：主进程/数据层新建的 笔记本/年组/月组/文档 只有**重读一次树**才可见（现有实现：`refreshTree()` 之后 `openNote`），这是数据新鲜度的要求，不是「刷整棵树的观感」——**要避免的是**滚动跳动、抢焦点、其它空间重建。
5. **文档空间不显示日记本**（渲染层过滤 `withoutDiaryNotebook`），存储不改。
6. **移动端任何输入面仍只走 dock**；日记页只做"列表 + 写今天 + 新建（今天/任意日期）+ 搜索"，不新造输入面。
7. **"打开" vs "新建" 一律由 mode 表达**（两端口径一致）：`open` = 幂等（当天已有就开最新一篇）、`new` = 永远新建；**判断在哪天有没有文档由 core 的 plan 做**（`planDiaryOpen` / `planDiaryCreate`），UI 只传 mode，不自己判。
8. **排序 = 日期倒序，同日按真实"创建时间"倒序**（用户 261110 定稿选 B）：分组（年/月）与日期倒序不变；同一天多篇必须用**创建时间**，**不许用修改时间**（编辑旧的一条会把它顶乱）。移动端 schema **v13** 起 `notes.created_at` 持久化真实创建时间（老行迁移回填 = `updated_at`；wire 不带文档创建时间 ⇒ 从桌面同步来的第一次落地按 `updatedAt` 记一次、之后不再变）；行内「写于」= 创建时间。
    **同一判据也要用于目录树**（261110 二次确认：「这里才是真正的笔记本里的排序」）：移动端工作区「文档树」抽屉里日记本子树同样按 年/月 倒序 + 日期倒序 + 同日创建时间倒序（`core.compareDiarySiblings` + `buildNotebookTreeIndex({ diaryRootId })`）；**只改显示，不改 `sort_order`/不做落库迁移**（其它笔记本仍按 sort_order）。
    **日记子树禁用长按拖拽排序**（261110 用户定稿；桌面端本来也没有拖拽排序）：顺序既由时间决定，拖拽就没有可表达的结果 ⇒ 直接不响应。判据 = `treeDragEnabled(space)`（`src/mobile/notebook/useTreeDrag.ts`），工作区把 `notebook.space` 传进 `useTreeDrag.enabled`；护栏 `treeDragDisabled.test.ts`。多选/行内 ⋮/＋ 不受影响。

## 转为文档（261109）

日记条目右键 →「转为文档…」→ 选一本**文档空间的笔记本** → 该条落到那本笔记本下，成为普通文档。

- **语义 = 移动**（同一个 note id 换父节点）：正文、历史快照、回收站、标签关系、S3 索引全都跟着走，**不复制、不改格式**（日记本来就是 Lake 文档，没有"格式转换"这回事）。
- 移出后自然从日记时间线消失（`diaryEntries` 只扫日记本子树）；想恢复成日记 = 再把它移回日记本（标题仍匹配 `YYYY-MM-DD` 就重新计入）。
- 判据单一来源：`core.diaryConvertTargets()`（可承接的容器 = 根层笔记本，**排除日记本**；不含分组）+ `core.planDiaryConvert()`（校验条目确实是日记、目标合法）。UI 与写入路径都先问 core，不另写一套。
- 两端入口：桌面条目**右键菜单**（`Menu` + `usePopoverPosition`）；移动端条目行的操作入口（`MobileSheetMenu`）→ 目标选择复用两端已有的「移动目标」选择器（桌面 `MoveTargetTreeDialog` / 移动 `MoveTargetTreeSheet`）。
- **不做**：不自动清理搬空后的年/月分组（空分组无害，清理由用户或以后统一做）；不提供"转回日记"的专用动作（移回去即可）。

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
  5. 已「转为小记」（源已软删）⇒ 同 2/3 ⇒ **恢复回日记空间**。
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
