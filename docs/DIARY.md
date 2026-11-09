# 日记（Diary，桌面 + 移动 v1）

> 261109 立项。**数据 = 笔记本体系内的普通 Lake 文档；表现 = 顶层独立空间。**
> 只写我们自己的契约与决策；进度/分支/门禁计数看 `docs/HANDOFF.md`。

## 决策（用户 261109 定稿）

1. **存储完全依托笔记本体系（D2）**：日记 = 一个带标记的笔记本；**不新建数据空间、不新建表**。正文/历史快照/回收站/FTS/导出/备份/便携包全部复用文档那一套。
2. **表现 = 独立空间**：空间组第 4 项（文档 ⌘1 / 小记 ⌘2 / AI 写作 ⌘3 / **日记 ⌘4** / 标签），与文档目录树解耦。
3. **标题即日期** `YYYY-MM-DD`；层级 `日记 → 2026 → 11 → 2026-11-09`，**年/月两级分组自动创建**（group 节点，随 `folders[]` 同步）。
4. **没有旧端**：允许加 wire 字段，不为旧客户端写降级。
5. **两端都做**（桌面空间页 + 移动第 4 个 tab）。
6. **要搜索**（日记是文档 ⇒ 天然进 FTS；空间内给"搜日记"入口）。
7. **不打标**：日记文档不提供标签入口，不进标签空间聚合。
8. **v1 不做**：缺天提示、补写任意日期、月历视图、streak、提醒、心情/天气/位置字段。

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
diary_open_date(dateKey: string): Promise<{
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
4. **建完只展开到今天节点**，不刷新整棵树、不抢正文焦点。
5. **文档空间不显示日记本**（渲染层过滤 `withoutDiaryNotebook`），存储不改。
6. **移动端任何输入面仍只走 dock**；日记页只做"列表 + 写今天 + 搜索"，不新造输入面。

## 搜索

- 日记 = 文档 ⇒ 已在 FTS5 索引里，桌面 ⇧⌘F 与移动全库搜索天然命中（**验证即可，不新增索引**）。
- 日记空间提供"搜日记"入口：复用现有搜索 UI，范围过滤以 `space === "diary"` 的子树为准（v1 允许先复用全库搜索）。
- **不打标**：空间内不提供标签入口；标签空间不聚合日记。

## 不做（v1，别再立项）

缺天提示 / 补写任意日期 / 月历视图 / streak / 提醒 / 心情·天气·位置字段。
理由：§3#17 三问未过；月历还会与多维表月历撞「同一交互语义只有一套视觉」（`audit-lookalike.mjs`）。

## 护栏（必须有的测试）

1. `src/core/diary.test.ts`（已完成，22 例）：日期键严格性、闰年、本地日期不跨 UTC、分组、wire 显式写 null、多本取首、条目分类、幂等 plan、重复文档告警。
2. 存储片：`diary_open_date` 幂等（连点两次只有一篇）、事务回滚（建组失败不留半成品）、`space` 不进非笔记本节点。
3. wire 片：`folders[].space` 往返（发布写 null / 应用缺字段当非日记）、便携包与整库备份保留 `space`。
4. UI 片：文档空间树不含日记本；日记空间左栏年/月来自 `core.diary`，不在组件里重算。
5. 移动片：schema 版本门 +1 生效、第 4 tab 不破首页 5 槽构图、tab 切换不改 `switchTab` 既有语义。

## 来源（机制参考，不是抄实现）

思源 v3.8.4：路径模板 + IAL 标记 `custom-dailynote-YYYYMMDD`、先查后建的幂等、模板只在新建时套用（`kernel/model/file.go:1436`）。**它的坑不学**：中间路径段变成真文档 / 内核写死 `time.Now()` 无法补写 / 幂等键是标题路径 / 日记本只存在前端 localStorage。

## 实现落点（261109 交付）

| 层 | 文件 |
| --- | --- |
| 判据 | `src/core/diary.ts` + `diary.test.ts`（22 例） |
| wire | `src/core/s3v3/protocol/s3v3Index.ts`（`LakeFolderEntry.space` + 校验归一）、`plan/plan.ts`（发布映射） |
| 平台端口 | `src/core/s3v3/state/platformPort.ts`（`SyncFolderRow.space`）、`state/deviceStore.ts`（投影 + 变更判定） |
| 桌面存储 | `electron/diaryStore.ts`（单事务 ensure）、`electron/ipc/registerDiary.ts`、`electron/schemaInit.ts`（列 + ALTER）、`electron/noteQueries.ts`/`noteMetadataRepository.ts`（读写 space） |
| 桌面 UI | `src/features/diary/`（`DiaryWorkspace` / `diaryTree` 树过滤与 id 映射 / `diaryOpen` IPC 端口 / `diarySearch` / `diary.css`）、`App.tsx`（空间 + ⌘4 + 树过滤 + 搜索收窄）、`DesktopTopBar.tsx`、`styles/chrome.css` |
| 移动 | `src/mobile/diary/`（`diaryRepository` 单事务 ensure / `DiaryPage`）、`bridge/diary.ts`、`data/schema.ts`（v12）、`home/tabPager.ts`（4 tab）、`settings/SearchSheet.tsx`（`scopeNoteIds`） |
| 搜索 | 复用既有 FTS + `SearchPanel.scopeNoteIds` / `SearchSheet.scopeNoteIds`（纯显示层；**不新增索引**） |

**已知边界（v1）**：桌面与移动各自只有一份编辑器宿主（日记空间与资料库同篇互斥，见 `App.tsx` 的 `libraryTabs`）；⌘4 暂独立注册在 `App.tsx`（未并回 `useDesktopLifecycle` 的 ⌘1–3 表）；移动端关闭日记条目后落到「知识库」（沿用既有返回落点）。
