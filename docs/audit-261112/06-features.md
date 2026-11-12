# 06 · 特性域审计（编辑器运行时 / 多维表 / 表格 / 画板 / 手写板 / AI / 日记 / 搜索 / 导入 / 附件 / 小记 / 标签）

> 审计员：`audit-features`（只读）· 日期：2026-11-12 · 仓库 HEAD：`8cc65e06`（`git status` 干净，单 worktree）
> 唯一写入 = 本文件。**未安装依赖、未跑构建、未跑 vitest、未启动 App/设备、未触碰任何数据目录。**
> 证据标记：**[核实]** = 本次读过源码 / 跑过只读脚本计数；**[推断]** = 由结构推理、未运行时验证。

---

## 0. 方法与范围

### 0.1 范围
- 主：`src/features/**`（375 个 .ts/.tsx/.css；非测试 .ts/.tsx = **35,492 行**，测试文件 **144** 个）。
- 关联：`src/lib/**`、`src/hooks/**`、`src/components/model/**`、`src/components/ui/**`（仅"特性如何被接线"这一面）、`src/components/app/**`（作为特性容器时）。
- 契约文档按需核对：`docs/AI-WRITING.md` / `docs/DIARY.md` / `docs/INK-PAD.md` / `docs/USHEET-UPGRADE.md` / `docs/BITABLE-VIEWPORT.md` / `docs/TAG-SYSTEM-DESIGN.md`，以及与本文最相关的 `AGENTS.md §3 §4`、`docs/ARCHITECTURE.md`、`docs/HANDOFF.md §0–§3`。
- 红线基线：`AGENTS.md` §3（尤其 #7 不做旧数据兼容、#14 单一视觉与几何、#17 拒绝迎合式找需求、#18 不清 vendor、#19 多维表条件求值单一来源、#21 门禁分层、#22 依赖准入）。

### 0.2 本次用到的只读手段（可复现）
| 手段 | 用途 | 备注 |
| --- | --- | --- |
| `find/wc -l` on `src/features` `src/components/model` | 文件数 / LOC / 测试数 | 数字见 §1.1 |
| 自写 Node 脚本：静态 import 图 + Tarjan SCC | 找模块级循环依赖 | 扫 `src` 全量 **849** 个非测试 .ts/.tsx，**SCC = 0** |
| 自写 Node 脚本：跨域 import 边 | feature→feature 依赖方向 | 47 条语句 / 20 条边（附录 A） |
| 自写 Node 脚本：导出符号反向引用 | 死导出候选 | 23 个符号（§2 F-08） |
| `grep` 计数 | kind 分派点、重复原语、注释漂移 | 每条 finding 内附口径 |
| `git log --since=2026-10-01 --name-only` | 高 churn 文件排序（拆分优先级） | 区间内共 1178 个提交 |

### 0.3 未覆盖 / 本报告不下结论的面
- **运行时行为未验证**（不启动 App）：所有"性能/闪屏/交互时序"结论均为读码 + 既有 HANDOFF 实测记录的引用，不重新实测。
- **未逐文件通读**：`BitableEditor(2111)` / `InkPad(1907)` / `lakeRuntime(1699)` / `bitableCells(1361)` 只做结构级分段抽样（导出表 / hooks 计数 / 段注释），未逐行 review 内部正确性。
- 样式与令牌层（`.bt-input` 这类特征内类名是否构成第二范式）只作跨域线索记录（附录 B），判定权归样式审计。
- 移动端 `src/mobile/**` 只在与桌面共享模块的接缝处引用（`InkPad`/`QuickNotePreview`/`NotePaneHost` 的 kind 链）；移动端自身不评分。
- 主进程 / `src/core` 的数据正确性不在本文（有 05-core-electron 报告）；本文只引用 `core/noteKind.ts`、`core/noteBodyPaths.ts`、`core/bitableDoc.ts` 等作为"单一来源是否被遵守"的判据来源。

---

## 1. 事实地图

### 1.1 总量
| 项 | 值 | 口径 |
| --- | --- | --- |
| `src/features/**` 文件 | 375 | .ts/.tsx/.css |
| 非测试 .ts/.tsx 行数 | 35,492 | `find … | xargs cat | wc -l` |
| 测试文件 | 144（全仓 872） | 16.5% |
| 域 LOC 前六 | editor 16,270 / bitable 10,130 / ink 8,950 / aiWriting 3,792 / quickNotes 2,757 / board 2,457 | 含测试与 css |
| 最大单文件 | `BitableEditor.tsx` 2111、`InkPad.tsx` 1907、`core/bitableDoc.ts` 2419、`lakeRuntime.ts` 1699、`bitableCells.tsx` 1361、`EditorTab.tsx` 1106 | 非测试 |

### 1.2 每个特性域：入口 / 容器 / 状态 / 持久化 / 依赖

> "容器" = 承载该域 UI 与接线的那一层；"状态" = 该域自有状态方案；"持久化" = 该域的真相落点（设备本地视图单列）。

| 域 | 入口（谁打开） | 容器（主接线文件） | 状态方案 | 持久化 | 依赖方向（实测） |
| --- | --- | --- | --- | --- | --- |
| **doc 编辑器** | 目录/搜索/恢复会话 → `MultiTabEditor` lazy `EditorTab` | `features/editor/EditorTab.tsx`(1106) + `lakeRuntime.ts`(1699) | 23×`useRef` + 7×`useEffect`，无 reducer/context | `notes/{id}.lake` + `history/{id}/*` | → outline、attachment、ai（叶子）、lakeRuntime |
| **usheet（Univer）** | 同上，`tab.kind==="usheet"` | `features/usheet/UniverSheetEditor.tsx`(689) + `usheetKernelContract.ts`(186) | readOnlyRef/实例 ref；`usheetActiveSheet` 内存登记 | `usheets/{id}.usheet.json` | → editor（`editorHost`/`resourceUpload`） |
| **bitable** | 同上（视图/筛选/填色另有单一来源规则 AGENTS §3#19） | `BitableEditor.tsx`(2111) + `bitableCells.tsx`(1361) + 12 个视图/面板文件 + `core/bitableDoc.ts`(2419) | **51×`useState`** + 48×`useCallback` + 14 ref（单组件） | `bitables/{id}.bitable.json`；导航 `localStorage …bitable-nav.<id>` | → editor、attachment |
| **board（Drawnix）** | 同上 | `BoardEditor.tsx`(578) + `boardValueCoalescer`/`boardViewStore`/`boardExport` | readOnly 收口 + 每帧合并器 | `boards/{id}.board.json`；视口 = 设备本地 | → editor、`lib/ai`（画板 AI） |
| **ink 手写板** | 同上 | **共享** `InkPad.tsx`(1907) + 两适配层 `DesktopInkPad.tsx`(109) / mobile `MobileInkPad` | 26×`useState`/36×`useRef`/50×`useCallback`（单组件） | `inks/{id}.ink.json`（v4 写、1|2|3 读）；当前页 = 设备本地 `inkNav` | → editor（`editorHost` 契约）、board（`boardInputDiagnostics`） |
| **AI 助手** | 选区浮栏 / 块手柄 / 顶栏「更多」/ slash 卡片 / 全局 `AiAssistantHost` | `AiAssistantDialog.tsx`(520) + `useAiConversation`(233) + `aiAssistantSession`(108，模块级 store) | 模块级 store + `useSyncExternalStore`；作用域 = 空间 + 活动文档 | 无落库（对话仅内存）；开关 `localStorage …ai.enabled` | ↔ editor（`activeEditor`/`editorRegistry`/常量） |
| **AI 写作** | 一级空间（⌘4）lazy `AiWritingWorkspace` | `AiWritingWorkspace`(294) + `useAiWriting`(338) + 12 个组件 | `useAiWriting` 单控制器（props 下传） | 主进程 `aiWriting*` IPC（DB）；置顶 = localStorage | → ai、import、editor（lazy `AiAnswerViewer`→lakeRuntime） |
| **日记** | 一级空间（⌘3）lazy `DiaryWorkspace` | `DiaryWorkspace.tsx`(505) + `diaryOpen/diaryTree/diarySearch` | 控制器 + `useOutline` 复用 | 普通 Lake 文档（标题 = 日期）+ `folders[].space` | → editor（lazy EditorTab） |
| **小记** | 一级空间（⌘2）；长按图标 capture | `components/app/QuickNotesWorkspace.tsx`(**1317**) + `features/quickNotes/*`(8 文件) | 单组件 state + `detailCache` 预热 | `quick-notes/metadata.sqlite3` + `items/*.qnote` | → editor（`lakeRuntime`/`mediaCardRouting`/`selectionClipboard`/`imagePreview`） |
| **标签** | 一级空间（⌘5）lazy `TagsWorkspace` | `TagsWorkspace.tsx`(655) + `tagsModel/tagsLayout/tagsWorkspaceState` | 纯逻辑模块 + 组件 state | 小记标签库（目录 + 关系）；顺序 = 设备本地 | → quickNotes（`TagPreviewBody` lazy） |
| **搜索** | ⌘K / 顶栏 | `components/app/SearchPanel.tsx`(315) + `features/search/*`(3) + `core` FTS | 组件 state；最近搜索 localStorage | 复用 FTS，不新增索引 | → diary（`filterDiarySearchHits`） |
| **大纲** | 右侧栏（doc 编辑态/锁定态） | `OutlineController.ts`(412) + `registry.ts`(52，模块级) + `useOutline`(220) | 模块级 registry + `useSyncExternalStore` | 无（纯派生） | → editor（`lakeRuntime` 的类型/桥） |
| **导入** | 目录右键 / 拖入 / 移动分享 | `markdownImportPipeline`(423) + `htmlImportPipeline`(150) + `fileImportBatch`(130) | 纯管线 + 注入 host | 落对应 kind 正文 | → editor（`await import lakeRuntime` 正确） |
| **附件** | 编辑器/多维表/小记内 | `attachmentPreviewController`(248，模块级 pub/sub) + `AttachmentPreview`(123) + `openAssetEntry`(56) | 模块级单例 | `note-assets/{noteId}/` | ← editor / bitable 调用 |
| **目录置顶** | 侧栏 | `features/sidebar/pinnedTree.ts`(103) | 模块级 store + Event 广播 | localStorage（设备本地） | 被 `Sidebar`/`SidebarPinnedSection` 消费 |

**读法**：14 个域里只有 **3 处**不是"组件内 state + 纯逻辑模块"，而是模块级 store（AI 会话 / 大纲 registry / 附件预览）。全仓 `src/features`、`src/hooks`、`src/lib`、`src/components/model` 里 **没有任何 `createContext`**（grep 无命中）——状态统一由 `App.tsx`(1445) 持有、props 下传。见 §2 的 F-06 判读与 §4。

### 1.3 编辑器 5 种 kind：注册与分派是否单一来源

**结论：`kind` 的"类型/路径/白名单"是单一来源；`kind` 的"语义分派"不是。** 挂载分派只有一个 ternary 链，但每个横切关注点各自 if/else，新增第 6 种 kind 需要改 10+ 处且**静默降级为 doc**（`core/noteKind.ts:7-9` 自己写明：降级 = 把画板 JSON 当 Lake 文档导入并保存 = 毁正文）。

已核实的单一来源（**不要动**）：
- 类型/白名单：`src/core/noteKind.ts:12` `NoteKind`、`:14` `NOTE_KINDS`、`:19` `normalizeNoteKind`。
- 磁盘布局：`src/core/noteBodyPaths.ts:13` `NOTE_BODY_DIR`、`:22` `NOTE_BODY_EXT`、`:31` `noteBodyRelativePath`（kind→目录/扩展名唯一表）。
- 宿主 props 词表：`features/editor/editorHost.ts:31` `EditorHostProps`（visible/focused/pane/readOnly/onChange/onDirty/onCapture），5 个宿主全部 extends（`DesktopInkPad.tsx:24`、`UniverSheetEditor.tsx:166`、`BitableEditor.tsx:120`、`BoardEditor.tsx:52`、`EditorTab` 以 `Omit` 接入）。
- 预览层：`components/app/HistorySnapshotPreview.tsx:23-27` 按 kind lazy 取 4 个非 doc 预览器；`components/app/HistoryPanel.tsx:27-28` 预热。
- 挂载分派：`features/editor/MultiTabEditor.tsx:679/693/711/725/739-759`（5 分支 + 各自 `EditorErrorBoundary`）；lazy 边界 `:18/:22/:24/:26/:28`。
- `readOnly` 注入：`MultiTabEditor.tsx:687/701/719/733/746` 全部 = `lockedNoteIds.has(id) || tab.deleted`（一致）[核实]。

不一致（分派点统计口径：`grep -cE 'switch \(kind\)|kind === "(doc|usheet|bitable|board|ink)"'`）[核实]：
- **31 个非测试文件 / 77 处** kind 分支：`App.tsx`、`core/{historyPreview,docBaseline,coldStartNote,docBodySafety,tagAggregate,lakeBodyRewrite,noteSearchText,s3v3/state/deviceStore}.ts`、`features/editor/{MultiTabEditor,noteRef}`、`components/{ui/ExportSubmenuItem,app/{HistorySnapshotPreview,syncConflicts,HistoryPanel,NoteInfoDialog,AssetsBrowser,treeIcons}}`、`hooks/{saveConflictCopy,useTreeActions}`、`features/tags/*`、`mobile/**` 9 文件。
- **15 个文件重抄 kind 字面量联合**（唯一来源已存在却不用 `import type { NoteKind }`）：`core/missingBody.ts:18`、`core/coldStartNote.ts:12`、`core/sharedTypes.ts:111`、`features/tags/tagsModel.ts:86`、`features/tags/TagPreviewBody.tsx:20`、`features/editor/MultiTabEditor.tsx:46`、`desktop/desktopTypes.ts:49`、`desktop/DesktopOverlays.tsx:55`、`components/app/DesktopStatusBar.tsx:15`、`mobile/trash/TrashPreviewPage.tsx:25`、`mobile/notebook/useWorkspaceActions.ts:45/93/211`、`hooks/saveConflictCopy.ts:10`、`hooks/desktopDerivedState.ts:77`、`lib/types.ts:41`、`lib/native.ts:40/271`。
- **5 条并行 if 链**（同一 kind 在 5 个"数据面"各自分支）：`core/docBodySafety.ts:98/105`、`core/docBaseline.ts:40`、`core/noteSearchText.ts:26`、`core/historyPreview.ts:38`、`core/coldStartNote.ts:12`。
- 桌面另有**第二套 kind 预览分派**（历史快照）：`HistorySnapshotPreview.tsx:141-147`，与挂载分派是不同语义（预览 vs 编辑），可接受，但"新增 kind 要记得它也有一份"目前没有护栏。

> 判定：这不是"必须建注册表"的问题。运行期注册表在 5 种固定 kind、且每 kind 宿主是不同第三方内核的现实下属于 §3#17 的过度设计。真问题是**编译期护栏缺失**：新增 kind 不会编译失败，只会静默走 doc 分支。方案见 §3.2。

### 1.4 已核实的正面事实（避免重复立项）
1. **静态环 = 0**：`src` 849 个非测试文件、Tarjan SCC 全量扫描 0 个 size>1 的强连通分量 [核实]。feature 之间存在双向边（`editor↔ai`、`editor↔quickNotes`），但互相只依赖对方的**叶子模块**（`activeEditor.ts`(27)、`editorRegistry.ts`(20)、`aiAssistantSession.ts`、`quickNoteToolbarWidgets.ts` 为无回边叶子），无运行时循环初始化风险。
2. **内核 lazy 边界纪律仍在**：`desktopKernelLazy.test.ts` 覆盖 MultiTab/App/Overlays/QuickNoteComposer/AI 写作/Sidebar/SearchPanel；静态 import `lakeRuntime` 的非 lazy 位置都是 `import type`（如 `diary/DiaryWorkspace.tsx:29`）[核实]。
3. **`lib/native` 直连是既定设计**：25 个 feature 文件直接 `import { native } from "../../lib/native"`；`scripts/check-arch.mjs` 的 import 方向规则只禁止 `features→desktop`、`mobile→electron/desktop`、`core→外部`，且 `KNOWN_IMPORT_VIOLATIONS = {}`（零违规）[核实]。**不要**改成 ports/adapter 层（§3#17）。
4. **浮层/确认/浮动窗已收敛**：`createPortal` 只允许 `Overlay` + 3 个白名单（`src/styles/uiPrimitives.test.ts:30-45`）；确认框统一 `hooks/useConfirm`（8 处调用）；浮动窗统一 `components/hooks/useFloatingDialog` + `DialogResizeHandles`（SettingsPanel/HistoryPanel/TrashPanel/AI 写作两弹窗）[核实]。
5. **AI 出网只有一个闸门**：`src/lib/ai.ts` `runAiChat` 内判 `loadAiEnabled()`；4 个调用方（AI 助手 / AI 写作 / 多维表 AI 字段 / 画板 AI）全走它 [核实]。关闭 = 任何路径不出网这条没被绕过。

---

## 2. 问题清单

> 分级口径：P0 = 发布阻断 / 数据风险；P1 = 发布前应处理（成本可控、收益明确）；P2 = 发布前可不做但应登记（或顺手低成本修）。
> **本次未发现 P0。** 理由：所有写路径（`onDirty`/`onChange`/capture/保存）都有"打开=只读"护栏与对应 `*OpenReadOnly` 测试（usheet/ink/board 各一份）；`readOnly` 在 5 个宿主一致注入；坏正文在 4 个非 doc 宿主都有只读面板（`UniverSheetEditor.tsx:660`、`BitableEditor.tsx:1123`、`BoardEditor.tsx:550`、`InkPad.tsx:1430-1433`）；AI/同步出网有唯一闸门。这是"宁可少报"的结论，不等于这些面不存在时序类问题（本报告无运行时证据）。

### P1

#### F-01 巨型文件 + 高 churn 叠加，成为发布后最高成本的改动面
**现象**：单文件承担多种职责，且是最近改动最频繁的文件——改一行要在 1700–2100 行里 review，回归面与 review 面积同比放大。

| 文件 | 行数 | 结构证据 | 近 40 天提交数 [核实] |
| --- | --- | --- | --- |
| `features/ink/InkPad.tsx` | 1907 | 单组件 209→1907（≈1698 行）；26 `useState`/36 `useRef`/50 `useCallback` | **40** |
| `features/editor/MultiTabEditor.tsx` | 831 | 标签栏 + 拖拽 + 分屏 + 上下文菜单 + 5 kind 挂载 + 空态 | **28** |
| `features/ai/AiAssistantDialog.tsx` | 520 | 对话 UI + 作用域跟踪 + 拖拽/缩放几何 + 请求 | **26** |
| `features/editor/selectionToolbar/SelectionToolbar.tsx` | 992 | 浮栏 + 图片/AI/链接/颜色多套子面板 | **24** |
| `features/bitable/BitableEditor.tsx` | 2111 | 单组件 133→≈1790 + `FieldEditorModal` 1803–2111；51 `useState`/48 `useCallback`/15 `useEffect` | **23** |
| `core/bitableDoc.ts` | 2419 | **172 个导出**；11 个 `// ----` 段（508/537/614/853/990/1193/1456/1551/1618/1672/1814） | — |
| `features/editor/lakeRuntime.ts` | 1699 | `createLakeDocument` 775–1188（414 行）+ 20 个模块级副作用安装器 | **18** |
| `features/bitable/bitableCells.tsx` | 1361 | 14 个导出（字段类型选择/附件/日期/关系/AI/单元格编辑器…） | **18** |

**代价**：① 每次触碰都要重跑该类目全部护栏，单批成本高；② 其中 3 个是"改一行动内核时序"的位置（InkPad 落笔/保存、lakeRuntime 实例化、SelectionToolbar 与内核选区交互），拆错比不拆更危险；③ 开源后新贡献者最先打开的就是这些文件。
**收益**：把"能单测的部分"从"必须起内核/Univer"里剥出来（见 §3.1）。
**结论**：P1，但**只按 §3.1 的批次做纯搬移**，不做行为重写；是否在本轮发布前做交用户裁决（§5 U-1）。

#### F-02 新增第 6 种 kind 没有编译期护栏，且静默降级为 doc（毁正文级别）
**现象**：`NoteKind` 单一来源存在，但 15 个文件重抄字面量联合、31 个文件 77 处分派；`normalizeNoteKind` 对未知值一律回落 `doc`（`core/noteKind.ts:19`），注释自己写明后果：*"旧端把画板 JSON 当 Lake 文档导入并保存 = 毁正文"*（`:7-9`）。
**代价**：现在加 kind 不会红任何门禁；漏改的每一处都是"UI 与真实语义不符"或"按 doc 处理非 doc 正文"。发生在开源后的外部 PR 上，代价是数据。
**收益**：不需要运行时注册表，只要 ① 全部改 `import type { NoteKind }`（删 15 处重抄）；② 一条"kind 触点清单"静态护栏。成本约半天，零运行期开销。落点见 §3.2。

### P2

#### F-03 AI 助手"作用域"只认 doc 宿主：表格/多维表/画板/手写板 4 种 kind 共享同一个会话作用域
**现象**：`aiAssistantSession.ts:25` 的作用域选择器是 `.lake-editor-tab[data-active="true"]` —— 只有 doc 宿主有 `.lake-editor-tab`（`EditorTab.tsx:1015/1020`）。另 4 个宿主根节点分别是 `.sheet-editor usheet-editor`（`UniverSheetEditor.tsx:655`）、`.bitable-editor`（`BitableEditor.tsx:1059`）、`.board-editor`（`BoardEditor.tsx:545`）、`.ink-pad`（`InkPad.tsx:1441`），都带 `data-active` 但**都没有 `data-note-id`**。
**后果**（[核实] 选择器/属性 + [推断] 运行时表现）：
1. `readAiScope()` 在这 4 种文档里返回 `"library::"`（noteId 为空）⇒ 同一空间下所有表格/多维表/画板/手写板**共用一份 AI 会话**，与 `aiAssistantSession.ts:5-6` 写的"在 B 打开是 B 自己的新会话"相反。
2. `AiAssistantDialog.tsx:159-162` 的"文档/tab 被关掉 ⇒ 这份跟着丢弃"判据先 `if (!noteId) return;` ⇒ 对这 4 种 kind **永不生效**：钉住的 AI 面板在关掉该表格后仍留着，且仍指向已关闭文档的请求上下文。
3. 判定活动文档出现了第二套选择器（`.lake-editor-tab[data-active]` vs `activeEditor.ts:18` 的 `[data-active="true"]`），与 AGENTS §3#14"同一个交互语义只有一套"精神不符。
**代价**：AI 面板"身份串台"（用户以为是当前表格的对话，实际是上一张表的）+ 关文档后残留。数据无损，但属"入口割裂/规则不一致"，正是发布前要收的交互语义。
**修法**：§3.3（不引注册表：让宿主统一带 `data-note-id`，作用域判据复用 `activeEditorHost()` 的同一属性族，一处改 4 个宿主）。

#### F-04 「保存并同步」失败原因文案与实现分叉（注释还停在旧口径）
**现象链**（全部 [核实]）：
1. 实现已是单条快路径：`core/s3v3/quickPush/pipeline.ts:253` `runQuickPush`，理由集 = `no-cloud | no-baseline | cloud-changed | remote-deleted`（`core/s3v3/quickPush/types.ts:43-46`）。
2. 适配层把除 `remote-deleted` 外的理由一律折叠成 **`no-remote-manifest`**：`electron/s3v3/desktopSync.ts:283-291`。
3. UI 对 `no-remote-manifest` 的唯一文案是"**云端还没有小记数据**，已改为执行一次完整同步"：`components/app/QuickNotesWorkspace.tsx:548-553`。
4. 但 `no-baseline`（云端有数据、本机无基线）与 `cloud-changed`（他端刚写过索引）都会走到同一句 ⇒ **user-facing 事实错误**。
5. 同一函数上的注释仍写"v3 起不再有单条推送实现，改为整轮兜底（旧 core/quickNotePush 已删除）"（`QuickNotesWorkspace.tsx:540`），与 AGENTS §4（261110 定稿：独立管线 `runQuickPush`，"唯一自同步特例"）直接冲突；`core/quickNoteSyncTypes.ts:12/15` 的类型注释也仍是"现走 v3 整轮同步兜底"。
**代价**：用户点「保存并同步」看到"云端还没有小记数据"而其实云端有 —— 会误判为数据丢失；开源后这是最容易被截图传播的那类文案。
**修法**：§3.4（只改映射与文案，不动协议）。

#### F-05 长按手势出现第 3 份实现（`InkPagesPanel`），违反"全仓唯一"
**证据**：`src/lib/longPressTimer.ts:1-6` 明确"**全仓唯一**的按住→到点/移动取消/清理实现"，两个消费者 = `features/editor/longPress.ts`（桌面 450ms/10px）与 `mobile/ui/useLongPress.ts`（350ms/10px + 震动）。而 `features/ink/InkPagesPanel.tsx:121-172` 自己写了 `pressRef` + `window.setTimeout(300)` + 8px 位移取消 + `suppressClickRef`（再叠一份 click 吞灭），语义与共享核心逐条重合。
**代价**：三处阈值/吞 click 行为各自演化；AGENTS §7#20"长按过的那次吞掉随后 click"这条不变式在这里靠手写维持（当前实现看起来正确，但无护栏钉住）。
**修法**：§3.5（换成 `createLongPressTimer({ ms: 300, moveCancelPx: 8 })` + 指针事件接线，行为不变；补一条测试）。

#### F-06 一级空间工作区位置不一致（小记/知识库/搜索/回收站在 `components/app`，其余在 `features/`）
**证据**：五个一级空间里，日记 `features/diary/DiaryWorkspace.tsx`(505)、AI 写作 `features/aiWriting/AiWritingWorkspace.tsx`(294)、标签 `features/tags/TagsWorkspace.tsx`(655)；而**小记**在 `components/app/QuickNotesWorkspace.tsx`(**1317**)、**知识库**在 `components/app/Sidebar.tsx`(**1857**)、搜索/回收站/资源在 `components/app/{SearchPanel,TrashPanel,AssetsBrowser}.tsx`。`features/sidebar/` 只有 `pinnedTree.ts`(103)。
**代价**：新贡献者按"features = 特性"找不到小记；`features/quickNotes` 里只有编辑器/预览零件，容器在别处，而 `ARCHITECTURE` 没有这条判据。
**修法**：§3.6 —— **不搬大文件**，只在 `docs/ARCHITECTURE.md` 写清判据；QuickNotesWorkspace 的迁移交用户裁决（§5 U-2）。

#### F-07 文档/注释漂移（开源前会被外部读者当成事实）
逐条 [核实]：
| 位置 | 现状 | 事实 |
| --- | --- | --- |
| `docs/ARCHITECTURE.md:21-24`、§五 | "Manifest V2 同步编排 / quickNotes Manifest v1 / manifest 链" | 已是 S3 v3（文件头 `:3` 自己加了过期警示，正文未改） |
| `docs/ARCHITECTURE.md:53` | 引用 `src/features/editor/BoardCard.tsx` | **该文件不存在**（画板卡已由 `lakeRuntime` 的 customCard 注册） |
| `docs/ARCHITECTURE.md:52` | 虚拟渲染/TOC 跟随/卡片水合/工具栏 hover 桥全归 `lakeRuntime` | 已抽出 `lakeTileRender`/`lakeTocScrollFollow`/`lakePerfSubscription`/`lakeAudioCardRetry`/`lakeKatexInjection` 5 个文件（DT-07） |
| `features/editor/activeEditor.ts:16` | "可能是 doc/sheet/bitable/board 任意一种" | 漏了 ink（5 种） |
| `features/ink/InkPad.tsx:212` | "（core/inkNav.ts）" | 实际 = `features/ink/inkNav.ts`（`core/inkNav.ts` 不存在） |
| `features/quickNotes/QuickNotesWorkspace.tsx:540` | "整轮同步兜底" | 单条快路径（见 F-04） |
| `core/quickNoteSyncTypes.ts:12,15` | "现走 v3 整轮同步兜底" | 同上 |
| `core/bitableDoc.ts:1462` | "主进程 ai_chat 入参上限（electron/ipc/registerAi.ts）" | `registerAi.ts` 里无此上限；实际 `core/aiChatMessages.ts:12` `AI_MAX_TOTAL_CHARS=200_000`（本处另有 `BITABLE_AI_MAX_CHARS=190000`，与 `aiPrompts.ts:67` 的 `AI_DOCUMENT_MAX_CHARS=60_000` 三个预算并存，注释称"同口径"） |
| `AGENTS.md` §4 | "内核只经 **5 个** React.lazy 边界" | 实际 ≥7：`App.tsx:53/65/70/72/77`、`DesktopOverlays.tsx:14-15`、`QuickNotePreview.tsx:26`、`AiMessageView.tsx:20`、`DiaryWorkspace.tsx:35`、`HistorySnapshotPreview.tsx:23-27` |
**代价**：即将开源，这份文档是外部读者对架构的第一手事实来源；错路径/错模块名会直接变成错误 PR。
**修法**：§3.6（纯文档批，无代码风险）。

#### F-08 未使用导出 23 个（低优先，不单独立项）
自写脚本对 `src/features` 非测试文件的每个 export 做全仓（含测试）反向引用扫描，零引用者：
`ai/aiPrompts.AI_DOCUMENT_MAX_CHARS`、`aiWriting/convertAiMarkdown.{AI_MARKDOWN_RETRY_DELAY_MS,browserVisibility}`、`editor/aiAssistantCard.AI_ASSISTANT_SLASH_GROUP_TITLE`、`editor/clipboardHtml.plainTextFromRange`、`editor/editorCommands.PARAGRAPH_STYLES`、`editor/lockedTextCard.{LOCKED_TEXT_MAIN_SEARCH,lockedTextCardConfig}`、`editor/selectionToolbar/aiResultOps.{SELECTABLE_BLOCKS,blockSetOf}`、`editor/selectionToolbar/linkEditor.restoreLinkTarget`、`editor/selectionToolbar/selectionImages.SELECTION_IMAGE_SELECTOR`、`import/markdownImportPipeline.{MARKDOWN_RENDER_TIMEOUT_MS,normalizeImportPath}`、`ink/history.INK_UNDO_MAX_CHARS`、`ink/inkImageImport.INK_THUMB_WIDTH`、`ink/inkNav.{INK_NAV_KEY_PREFIX,inkNavKey,clearInkNavPage}`、`ink/inkPageTexts.{INK_TEXT_FONT_SIZE_MIN,INK_TEXT_FONT_SIZE_MAX}`、`ink/pdfImport.IMPORT_COMMIT_BATCH`、`quickNotes/quickNotePreviewParser.readBlockStyle`、`quickNotes/quickNoteToolbarWidgets.openEmojiPicker`、`search/searchScope.TAG_SEARCH_LIMIT`、`search/tagSearchIndex.{tagSearchAvailable,normalizeTagSearchIndex}`、`sidebar/pinnedTree.subscribePinnedTree`、`tags/tagsLayout.TAG_HANDLE_WIDTH`、`usheet/usheetCrosshair.USHEET_CROSSHAIR_COMMANDS`。
**判定**：多数只是"内部用到却写了 export"（导出面虚胖），不是死模块。按 §3#17 不单独立项；**顺手改到时删**，其中 `tagSearchIndex` 两枚与 `subscribePinnedTree`、`clearInkNavPage` 优先（连语义都无人消费）。

#### F-09 `editor` → `ai` 唯一的"组件模块级"耦合是为了一个常量
**证据**：`features/editor/selectionToolbar/SelectionToolbar.tsx:30` `import { AI_DIALOG_GAP } from "../../ai/AiAssistantDialog"` —— 只取一个布局常量，却把 editor 的编译图接到 520 行 AI Dialog 模块上（该模块已在入口 chunk，不产生重复下载，但让"editor 不依赖 ai 组件"这条界限失去可判性）。
**修法**：常量搬到 `features/ai/aiLayout.ts`（或并入 `hooks/topMenuPosition.ts` 同族），两处 import 改路径。1 个文件、2 行，零行为变化。

### 2.c 跨特性重复模式盘点（按任务要求的 14 类）
| 交互语义 | 现状 | 判定 |
| --- | --- | --- |
| 浮层/对话框 | `components/ui/Overlay`（Dialog/Menu/Popover/Submenu）+ `uiPrimitives.test.ts` 白名单 | **已单一来源**，不要动 |
| 浮动窗（可拖/8 向缩放/尺寸本地记忆） | `useFloatingDialog` + `DialogResizeHandles`，5 处复用 | **已单一来源** |
| 确认 | `hooks/useConfirm`（8 处） | **已单一来源** |
| 抽屉 | 桌面无通用抽屉原语；多维表记录详情是特征内 `BitableRecordDrawer`(108)，移动端另有 Sheet | 不上收（桌面上只有 1 处，建原语 = §3#17 过度设计） |
| 选择器 | `components/ui/Select`（9 处调用）；字段类型/关系记录/页签等**领域选择器**留在特征内 | 正确，领域语义不合并 |
| 搜索输入/筛选行 | `components/ui/DockFilterBar`（Sidebar + 大纲）；多维表/小记/AI 写作各自有领域筛选 | 不上收（筛选模型不同；`components/model/dockFilterModel` 已是纯决策来源） |
| 多选/批量操作 | 桌面只有 `Sidebar` 有多选批量栏；小记/回收站/资源页均无 | **不要提前抽**（只有 1 个消费者） |
| 拖拽排序 | 标签栏（MultiTabEditor）、目录树（`components/model/treeDrag`）、多维表字段/视图、手写板页缩略图（`InkPagesPanel`）、AI 写作置顶 | 各带领域语义（AGENTS §3#22 已裁定不引 dnd-kit）→ 只收敛**手势计时**，不收敛 drag 模型 |
| 长按 | **3 份**：`lib/longPressTimer`（唯一来源）+ 2 个消费者 + `InkPagesPanel` 第 3 份 | **F-05 需修** |
| 附件/标签 | `AttachmentChipList` + `FileKindIcon`/`fileKindOf()`；标签库唯一来源 = 小记标签库 | **已单一来源** |
| AI 入口 | 选区浮栏 / 块手柄 / 顶栏「更多」/ slash 卡 / 一级空间 / 多维表 AI 字段 / 画板 AI；出网闸门唯一 | 已收敛；作用域判据见 F-03 |
| 错误提示 | `reportNativeActionError`（native 失败）+ 特征内 banner（`ink-invalid-banner` / `tab-gone-banner` / `empty-workspace-hint`） | 三层语义不同（native 动作 / 正文不可解析 / 文档已删除），**不上收** |
| 空态 | `.empty-workspace*` 只在编辑器侧（MultiTabEditor 2 处 + EditorErrorBoundary）；其余空间自带文案 | 本轮不处理（无视觉不一致证据） |
| 只读/锁定 | 5 宿主同注入；坏正文面板 4 处 + ink 内部 1 处 | 已一致 |

---

## 3. 方案

### 3.1 巨型文件拆分（按"纯搬移、零行为变化"设计）

> 原则：① 先抽**无 React、无 DOM** 的纯逻辑（可单测、可对拍），再抽 React 子组件；② 每次只动一个文件、一次提交，跑该类目护栏；③ 不改导出名（拆出后原文件保留 re-export 屏障，等调用方迁完再删）；④ 不整体重写。

**(a) `core/bitableDoc.ts` 2419 → 8 个模块（最安全，先做）**
```
core/bitable/                  (保持"条件求值单一来源"不变，仍是同一份实现)
├─ types.ts       字段/记录/视图/筛选/填色/排序/分组 类型 + 常量（现 1–507 段）
├─ values.ts      formatBitableNumber/Date、rating/progress、值展示与搜索（853–1192）
├─ filter.ts      BitableFilter* + filterOperatorsFor + evaluateFilterNode（AGENTS §3#19 唯一实现）
├─ fill.ts        条件填色规则与颜色
├─ sortGroup.ts   排序/分组规则（358–410）
├─ views.ts       看板/画册/日历/视图求值（1551–2419，纯函数）
├─ relations.ts   双向关联（1193–1455）
└─ ai.ts          AI 字段提示词与上限（1456–1550）
index.ts 仅 re-export（迁移期），调用方按 3 批迁走后删除
```
护栏：`core/bitableDoc.test.ts`(1502) 原样不动即等价性证明；`bitableViewportGeometry`/`BitableVirtualBody` 测试覆盖窗口不变；每模块 `git diff --stat` 断言"只有搬移"。
顺序：types → values → sortGroup → views → relations → ai → filter/fill（filter/fill 最后做，因 §3#19 明确其单一来源地位，要单独 review）。

**(b) `features/bitable/BitableEditor.tsx` 2111 → 容器 + 6 个 hook/子组件**
```
BitableEditor.tsx          编排/渲染（目标 ≤550）
useBitableTables.ts        表 CRUD + 拖拽排序 + 重命名（现 425 段）
useBitableViews.ts         视图 CRUD/切换/配置 + 导航 store 接线（453/725 段）
useBitableFields.ts        字段 CRUD/类型转换/必填/默认值（488 段）
useBitableRecords.ts       记录 CRUD/选择/批量/行窗口绑定（583 段）
useBitableImport.ts        CSV 导入（597 段）
components/FieldEditorModal.tsx   现 1803–2111 原样搬出（已独立）
components/BitableChromeMenu.tsx  右上角菜单（1208 段，含锁定/导出）
```
护栏：`bitableEditorMount.test.ts` / `BitableEditor.behavior.test.ts@@ / `bitableViewportGeometry.test.ts@@ + `npm run check:bitablesnap`（3 态，夹具自建自删；按 §3#21 只跑这 3 态）。

**(c) `features/ink/InkPad.tsx` 1907 → 控制器 + 渲染子组件（**最危险，最后做**）**
```
InkPad.tsx                     组合根 + 指针事件状态机（目标 ≤700）
useInkDocState.ts              正文解析/脏标记/防抖保存/capture/等价判据
useInkHistory.ts               页级撤销/重做补丁栈
useInkPageOps.ts               建页/删页/排序/页签(note)/页面图片/文字块
useInkPdfImport.ts             图片页/PDF 页导入的 UI 态（编排已在 pdfImport.ts：进度/取消/清理）
components/InkCanvas.tsx       画布 + 静态笔迹层 + 命中/选中
components/InkToolbarDesktop.tsx  底栏/工具条（现 1500 段以后）
```
护栏：`inkPadWiring.test.ts`(549)、`inkOpenReadOnly.test.ts`、`inkSharedCssParity.test.ts`（给共享 CSS 加规则必须同步移动端副本）、`inkPerfStats`，以及**设备级**（按 §3#21 只跑受影响屏）。**必须先补**"落笔→500ms 防抖→保存"的纯逻辑测试——现在这条只有源码文本断言（`inkOpenReadOnly.test.ts` 读文件断言），否则不拆。

**(d) `features/editor/lakeRuntime.ts` 1699 → 实例化骨架 + 6 个内核补丁模块（中风险，收益高）**
```
lakeRuntime.ts            createLakeDocument/destroy + 桥接类型（目标 ≤500）
kernelConfig.ts           VIRTUAL_RENDERING/工具栏/prefs 合并 + deepMerge + customCards 注册
kernelBookmarkDegrade.ts  bookmark→链接降级（现 639–750）
kernelCardHydration.ts    水合/新卡自动打开/可见卡水合（1222–1437）
kernelToolbarBridge.ts    卡片浮栏 hover 桥（1438–1556）
kernelTocSidebar.ts       findNativeTocSidebar/refreshTocSidebar（1557–1699）
kernelImageThumb.ts       onBeforeRenderImage 缩略钩子（764–775 邻域）
```
关键：**保持"只经既有 lazy 边界进内核"不变**（同一 chunk 内搬移，不改 import 方向）；`desktopKernelLazy.test.ts` 与 `check-arch` 首屏预算照跑。建议放在 (a)(b) 之后，因为它被 `outline/quickNotes/aiWriting` 直接 import，搬移会同时触碰多条链（虽都是 type/值导出，风险低）。

**(e) `MultiTabEditor`(831) / `SelectionToolbar`(992) / `AiAssistantDialog`(520)**：都已是"组件 + 若干纯函数"，拆分收益低于 (a)–(d)。只做一件：把 `SelectionToolbar` 的子面板（图片/AI/链接/颜色）按现有目录再分层（`selectionToolbar/panels/*`），因为它近 40 天改了 24 次。**列 P2，不排进本轮。**

**总顺序（收益/风险比）**：(a) → (b) → (d) → (c)。每批独立提交，批间不夹带功能改动。

### 3.2 kind 编译期护栏（F-02）
1. **删重抄**：15 个文件改 `import type { NoteKind } from "../../core/noteKind.js"`（`lib/native.ts` 两处、`hooks/*`、`mobile/*` 同批）。零行为变化，`tsc --noEmit` 即证明。
2. **新增护栏测试** `src/features/editor/noteKindTouchpoints.test.ts`：声明"kind 触点表"（31 个文件 + 每文件期望命中数），`NOTE_KINDS` 变化或某个触点被删/新增时失败，提示"新增 kind 必须逐条确认这些面"。**只锁"该看的清单"，不锁实现方式**，避免变成新的架构约束。
3. **不给 `normalizeNoteKind` 加兼容/迁移**（§3#7）：保持"未知→doc"现状，但把 `core/noteKind.ts:7-9` 的警告同时写进 `ARCHITECTURE`（外部贡献者看得到）。

### 3.3 AI 作用域（F-03）
- 落点 1：4 个非 doc 宿主根节点补 `data-note-id={noteId}`（`UniverSheetEditor.tsx:655`、`BitableEditor.tsx:1059`、`BoardEditor.tsx:545`、`InkPad.tsx:1441`；InkPad 的 `noteId` 由适配层已有）。
- 落点 2：`aiAssistantSession.ts:25` 的 `SCOPE_EDITOR_SELECTOR` 从 `.lake-editor-tab[data-active="true"]` 改为 `[data-active="true"][data-note-id]`（与 `activeEditor.ts:18` 同一判据族，仍只看显式属性；不引第二套选择器）。
- 落点 3：`AiAssistantDialog.tsx:160` 的"文档是否还活着"查询改为 `[data-note-id]`（不再限 `.lake-editor-tab`）。
- 护栏：新增 `aiAssistantScope.test.ts`（纯函数测 `readAiScope` 识别 + 源码断言 4 个宿主都带 `data-note-id`）。**不写设备测试**（DOM 属性可由单测覆盖）。

### 3.4 「保存并同步」文案（F-04）
- `QuickNotePushOutcome` 的 `full-sync.reason` 扩到与 pipeline 同集（`no-cloud | no-baseline | cloud-changed | remote-deleted`，`core/quickNoteSyncTypes.ts:15`），适配层不再折叠（`desktopSync.ts:290`）。
- UI 按 4 个理由给 4 句（"云端还没有小记数据 / 本机还没有这条的同步基线 / 云端刚被其他设备改过 / 这条已在其他设备删除"），**仍是同一句"已改为执行一次完整同步"的前缀**。
- 同步修掉 `QuickNotesWorkspace.tsx:540` 与 `quickNoteSyncTypes.ts:12` 的过期注释。
- 护栏：`quickNoteSyncGate.test.ts`（已有）加 4 条理由→文案映射断言；不改协议、不改 pipeline。

### 3.5 长按（F-05）
`InkPagesPanel` 的 300ms 进入拖拽改为 `createLongPressTimer({ ms: 300, moveCancelPx: 8, onFire })`，事件仍是 `pointerdown/move/up`（timer 与事件类型无关）；点击吞灭用 `consumeClickSuppression()`。抽出后 `InkPagesPanel` 少 3 个 ref 与一段 window 监听。护栏：`inkPagesPanel.render.test.tsx`（已有）加"长按触发后随后的 click 不跳页 / 8px 内移动取消"两条。

### 3.6 文档与位置（F-06 / F-07）
- `docs/ARCHITECTURE.md`：重写 §二 文件索引（改成"每个 feature 目录一行 + 职责一句话"，指向目录而不是单文件，避免再次过期）；§五 换 S3 v3 一句话 + 链接 `SYNC-PROTOCOL.md`；删 `BoardCard.tsx` / Manifest V2 / `quickNotesSync` 等已不存在或已替换条目。
- 新增"模块归属判据"小节：**一级空间工作区 → `src/features/<域>/<域>Workspace.tsx`；shell 级常驻面板（目录树/搜索/回收站/资源/设置）→ `src/components/app/`；跨域纯决策 → `src/components/model/`；跨域可视原语 → `src/components/ui/`**。
- 单文件级注释修正（F-07 表 5 条，无代码变化）。
- `QuickNotesWorkspace` 是否搬：见 §5 U-2，**默认不搬**（1317 行文件移动会打断 blame，收益只是导航一致性；判据文档化即可）。

### 3.7 迁移批次与门禁（自包含执行表）
| 批次 | 内容 | 落点 | 必跑 |
| --- | --- | --- | --- |
| B1 | F-07 文档/注释 + F-02 的 15 处改 `NoteKind` | `docs/ARCHITECTURE.md`、15 文件 | `npx tsc --noEmit` + `git diff --check`（纯类型/文档） |
| B2 | F-02 触点护栏测试 | 新 `noteKindTouchpoints.test.ts` | 该测试 + tsc |
| B3 | F-03 AI 作用域 | 4 宿主 + 2 判据文件 + 测试 | tsc + `aiAssistantDialog.test.ts`/`selectionToolbar.wiring.test.ts` + 手点 1 次（表格内开 AI、关表格看面板消失） |
| B4 | F-04 小记同步文案 | `quickNoteSyncTypes`/`desktopSync`/`QuickNotesWorkspace` | tsc + `quickNoteSyncGate.test.ts`/`quickPushFastPath.test.ts` |
| B5 | F-05 长按 + F-09 常量 | `InkPagesPanel`、`aiLayout` | tsc + ink 渲染测试 |
| B6+ | 拆 `bitableDoc` → `BitableEditor` → `lakeRuntime` → `InkPad` | §3.1 | 每批该类目全测 + `check:bitablesnap`(3 态)/样式层围栏；InkPad 必跑设备装置 |

### 3.8 需要新增的护栏（全部静态/单测，不新增依赖）
1. `noteKindTouchpoints.test.ts`（kind 触点清单）。
2. `aiAssistantScope.test.ts`（作用域判据 + 4 宿主 `data-note-id`）。
3. `quickNoteSyncGate.test.ts` 扩 4 条理由映射。
4. `inkPagesPanel.render.test.tsx` 扩 2 条长按语义。
5. `bitableDoc` 拆分期间加一条"导出符号表不变"断言（`import * as m` 的 key 白名单），防止搬移时顺手改名/漏导出。

---

## 4. 明确不做项（附拒绝理由）

| 不做 | 理由 |
| --- | --- |
| 引入运行期"编辑器 kind 注册表/插件系统" | 5 种 kind 固定且宿主是不同第三方内核；注册表只带来间接层与动态解析成本，§3#17（过度设计信号第一条）。F-02 用 type import + 清单护栏即可 |
| 给 feature 之间加 DI/ports-adapter/事件总线 | 静态环 = 0、import 违规 = 0；现存双向边都是叶子模块。改造收益 = 代码更整洁，成本 = 所有调用点 + 新抽象（§3#17 ②③） |
| 引入状态管理库 / 大面积改 Context | 现状无 context、props 下传；Zustand 已在 §3#22 明确不引。`MultiTabEditor` 33 个 props 确实多，但"下传"是这个壳层的既有契约，重构成 store 属大改，且会破坏 keep-alive 时序 |
| 把 `Sidebar`/`SearchPanel`/`TrashPanel`/`AssetsBrowser` 搬进 `features/` | 它们服务多个特性且是 shell 级面板；搬动只改路径、不改可测性（F-06 用文档判据解决） |
| 抽通用"多选/批量操作/抽屉/空态"原语 | 每类当前只有 1 个消费者（§2.c）；提前抽象 = §3#17 |
| 整体重写 `InkPad`/`BitableEditor` | 红线：不在没有测试护栏时做大规模架构重写；两者分别是 40/23 次提交的热点，重写风险远大于搬移 |
| 清理 vendor / 内核死代码、升级 usheet/内核 | AGENTS §3#18、§2（内核 pin、Univer 只走 playbook） |
| 为旧 kind/旧正文加兼容/迁移 | §3#7；`normalizeNoteKind` 回落 doc 是**故意**行为，只补文档警告 |
| 统一三个 AI 字符预算（60k/190k/200k） | 三者语义不同（"附全文"上限 / 命令上下文 / 主进程总预算）；真正要修的是 `core/bitableDoc.ts:1462` 的错误文件引用注释，已并入 F-07 |
| 给 `bt-input` 之类的特征内类名做改名 | 属样式审计判定面（附录 B 线索），本文不越界 |

---

## 5. 需用户裁决

**U-1（最重要）· 本轮发布前是否执行 §3.1 的巨型文件拆分？**
- 投「做」的理由：InkPad 40 次 / MultiTab 28 次 / BitableEditor 23 次提交（近 40 天），发布后改动只会更多；拆出的纯逻辑（bitableDoc 8 模块、BitableEditor 6 hook）能把回归面从"起内核/起 Univer"降到单测。
- 投「不做」的理由：AGENTS §2 明确"不在没有测试护栏时做大规模架构重写"；InkPad/Univer 类文件搬移会打断 blame，且要设备级复验。
- 我的建议：**只做 (a) `core/bitableDoc.ts` 与 (b) `BitableEditor`**（纯搬移 + 已有 1502 行单测/行为测试兜底），(c)`InkPad` 与 (d)`lakeRuntime` 推到发布后。若你只想要"零风险"，则全部推迟，本报告 §3.1 即为可执行工单。

**U-2 · `QuickNotesWorkspace`(1317) 是否搬进 `features/quickNotes/`？**
- 搬：与其他 4 个一级空间一致；成本 = 1 次 `git mv` + 约 5 处 import 改动 + 打断该文件 blame，收益是导航一致性。
- 不搬：按 §3#17 收益只停在"代码更整齐"。**我建议不搬，改在 ARCHITECTURE 写判据**（§3.6）。

**U-3 · AGENTS §4 的"5 个 lazy 边界"要不要更新为实际清单（≥7）？**
AGENTS 有 64KB 指令预算约束（§3 抬头），加内容要等量删。我倾向**只改数字 + 指向 `desktopKernelLazy.test.ts`**（那份测试才是真清单），不展开列表。

**U-4 · F-04 的 4 句文案由谁定稿？**
「云端还没有小记数据 / 本机还没有同步基线 / 云端刚被其他设备改过 / 这条已在其他设备删除」——面向用户的语义，需要你按小记"随手记"的语气拍板（尤其"本机没有基线"是否要暴露给普通用户）。

---

## 附录 A · 跨域 import 边（47 条语句 / 20 条边，静态环 = 0）
```
editor -> ai (8)           editor -> attachment (6)   ai -> editor (5)
quickNotes -> editor (5)   aiWriting -> ai (3)        bitable -> editor (3)
board -> editor (2)        editor -> outline (2)      usheet -> editor (2)
aiWriting -> editor (1)    aiWriting -> import (1)    attachment -> editor (1)
bitable -> attachment (1)  diary -> editor (1)        editor -> quickNotes (1)
import -> editor (1)       ink -> editor (1)          ink -> board (1)
outline -> editor (1)      tags -> quickNotes (1)
```
判读：`editor` 是事实上的"平台层"（被 9 个域依赖）；它反向依赖 `ai/outline/attachment/quickNotes` 也都是叶子（store/常量/类型/纯函数）。**不需要动方向，但 ARCHITECTURE 应把"editor 可被所有域依赖、但只能依赖对方的叶子模块"写成判据**，否则下一个人很可能写出 `editor → ai/Components` 的真环。

## 附录 B · 跨域线索（只记录，不深挖）
1. `features/bitable/*.css` 有自有的 `.bt-input`（`bitableEditor.css:306-327`，6 条规则），而同一 feature 的 `BitableFilterEditor.tsx:155`/`BitableRelationPicker.tsx:171` 用 `ln-input__field` —— 是否构成"第二输入范式"，交给 `scripts/css-audit/audit-lookalike.mjs` + 样式审计判定；本文未跑该脚本（会写 `.css-audit/` 产物，超出只读范围）。
2. `features/bitable/bitableCells.tsx` 的 `AttachmentChipList`（`:277`）是共享附件原语却放在 bitable 目录 —— 若 bitable 之外也有消费者，它应在 `components/ui/`；需确认（本文未做全量调用点确认）。
3. `core/bitableDoc.ts`(2419) 与 `core/bitableMutations.ts`(672) 在 `src/core`，不在 features 下 —— 拆分归 core 审计协调（本文 §3.1(a) 只给方案，执行需与 05-core-electron 报告合并排序）。
4. 移动端 `NotePaneHost.tsx:93` 另有一份 kind 挂载链 —— 与桌面 `MultiTabEditor:679-759` 同构但独立（两端 UI 不共享是既定设计），kind 护栏（§3.2）应同时覆盖它。
5. `features/aiWriting/convertAiMarkdown.ts:23` 依赖 `import/markdownImportPipeline` —— 语义上是"AI 生成 Markdown 复用导入管线"，方向正确，无需处理。

## 附录 C · 未覆盖清单（供下一轮接手）
- `EditorTab.tsx`(1106) 内部时序：锁/解锁实例重建、滚动恢复、tileRendering 联动 —— 只做结构级阅读，未逐 effect 审。
- `selectionToolbar/*`（992 + 257 + 若干）与内核选区交互的边界条件。
- `features/bitable` 的 12 个视图文件逐个功能核对（本次只核对了编辑器主体与视图求值的单一来源声明）。
- 各域**性能实测**（大表 10 万行、长文档 2000 段、107 图文档）—— 只引用 HANDOFF 既有实测。
- 移动端特性接线（`src/mobile/notebook`、`src/mobile/bitable` 等）只看了与桌面共享的 kind 链。
