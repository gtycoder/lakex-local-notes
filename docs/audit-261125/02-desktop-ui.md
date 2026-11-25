# 02-desktop-ui — src/{components,features,desktop,hooks,lib} + App.tsx 终审（只读审计，261125）

> 审计域：桌面渲染层 + 两端共享 lib（`src/components/**`、`src/features/**`、`src/desktop/**`、`src/App.tsx`、`src/hooks/**`、`src/lib/**`）。只读审计、只出方案；除本文件外未改任何代码。
> 编号 D-01 起。每条 file:line 均为本次实际读过核实；未能核实的显式标注「未核实/待复现」。样式违规只点名不展开（第 4 流负责）；`src/core/**`、`electron/**`、`src/mobile/**`、vendor 不在本域。

## 1. 概览

**范围与规模（实测）**：非测试 435 文件 / 69,075 行（components 99/13,129、features 250/43,228、desktop 9/1,100、hooks 34/3,586、lib 43/6,499、App.tsx 1,533）；含测试 783 文件 / 107,713 行。

**方法**：AGENTS + HANDOFF §1–§3 先读 → 既有审计吸收（`docs/audit-261112/02-preview-unification.md`、`03-desktop-ui-css.md`、`docs/audit-261124/00-MASTER.md`，已结案项不重开）→ 任务书 8 类抽提目标逐项 grep/读码对撞 → 大文件结构解析 → 兼容/legacy/旧键全量 grep → 死代码两轮扫描（模块级 + 导出级，含 type/re-export）→ 同名函数跨文件对撞。§3#17 三问逐条过筛：不值得做的进「明确不建议做」，收益只停在整洁的降级或不做。

**总体评价**：本域的「单一来源」纪律总体执行得好，且此前多轮审计的收口成果都还在位——浮层只走 `components/ui/Overlay.tsx`（`src/styles/uiPrimitives.test.ts:42-49` 门禁 + 5 处有意白名单）、确认/提示只走 `hooks/useConfirm.tsx`（无残留 window.confirm/alert）、预览浮层/只读 viewer 已收口（`features/preview/useReadOnlyKernelViewer.ts` + `previewAsset.ts`，261112 Phase 1 已落地）、打开文档 gone 判据单源（`hooks/useTabLifecycle.ts:67-91` 的 `openTabFromNote` 被 openNote/restoreTabs 共用 + `useSyncRefresh.ts:103` 重算 + `features/editor/noteRef.ts:76-81`）、保存管线单源（`hooks/savePipelineCore.ts`）、只读原因单源（`core/capabilities/readonlyReason`，`MultiTabEditor.tsx:335-345`）、导入导出分发单源（`components/ui/ExportSubmenuItem.tsx` + `hooks/useNoteActions.ts:123`；`features/import/*` 三条管线各司其职）。样式层违规仅见「浮层动态定位 inline style」一类（AGENTS §3#14 已允许），未见组件内静态 `style={{}}` 扩散（抽样核实，非全量）。

真问题集中在三处：① **编辑器宿主接线的复制/漂移风险**——复制/剪切在桌面 `EditorTab` 与共享桥 `selectionClipboard` 之间存在「文档声称单一、实际两套且 cut 删除口径已分叉」（D-01，含一处与 260917 已修 bug 同型的待复现风险）；上传自愈效果两份近乎逐字复制（D-02）；其余挂载块三宿主各写一遍且历史上已经漏挂过一次（D-03）。② **四个千行级组合根/组件待拆**（Sidebar 1685、App 1533、InkPad 1533、BitableEditor 1497 等），其中 InkPad/QN 预览瘦身是 HANDOFF 已登记方向（D-04~D-06、D-10~D-11）。③ **整洁度尾巴**——16 个零引用导出（含 2 个「兼容旧导出」shim）、14 个 ≥350 行文件无头注释、卡片 value 编解码 3 份、资产显示 URL 组合 4 份（D-07~D-09、D-12~D-13）。按三问筛后值得做 13 条：P2×6、P3×7；无 P0/P1 级「丢数据/卡死」缺陷（UI 层的保存守卫、gone 判据、写路径分层均核实合规）。

## 2. 方案清单

### D-01 · 复制/剪切双管线取证与 cut 删除口径统一（桌面 EditorTab vs 共享桥）
- **问题与证据**：
  - 契约与现实不符：AGENTS §4 写「复制/剪切 = 单一管线 `editor/selectionClipboard`……**不要**在任何编辑器里再写第二份 copy/cut 处理器」，护栏 `features/editor/selectionClipboard.test.ts:25-30` 也断言「文档编辑器挂的是共享桥，不再内联第二份 copy/cut 处理器」——但它只读 `LakeEditor.tsx`，**没测 EditorTab**（与 AGENTS §4 图片预览条目里记录过的「历史护栏读的是 LakeEditor.tsx，漏了 EditorTab」完全同型）。
  - 实际：桌面文档编辑器 `EditorTab.tsx:270-281`（copyHandler）、`:281-293`（pasteHandler）、`:295-313`（cutHandler）、`:472-473`（capture 挂载）是**独立的第二份实现**，对**任意**非折叠选区接管（无 `selectionHasImage` 判据）；共享桥 `selectionClipboard.ts:9-11`（文件头契约）明确只在选区含 `<img>` 时接管，理由是「无条件接管会丢 ne-clipboard 片段（表格/画板/思维导图粘回来会降级）」。桌面这条例外是**已知的**（`selectionClipboard.ts:146` 注释自认「文档编辑器 EditorTab 有自己的 copy 管线」），git 历史显示 copyHandler 自基线（b1b04f11）即有、共享桥是 c8bc5777 新建。
  - **cut 删除口径已经分叉**（这是本条的硬问题）：`editorCut.test.ts:17-27` 钉死 EditorTab 的删除必须走 `kernel.execCommand("delete")`（`EditorTab.tsx:290-291` 注释记录 260917 实测：`document.execCommand("delete")` 只删 DOM、内核模型不变，点块即被重绘回来），而共享桥 `selectionClipboard.ts:224` 的 cut 仍以 `document.execCommand("delete")` 为**唯一**删除路径 ⇒ 移动文档编辑器/小记写作卡「剪切含图选区」存在同型「删了又回来」风险（**待复现**，我没有移动设备实证）。
- **具体方案**：三步、每步独立可回退。① 先出语义对比表（接管判据 / 删除路径 / 表格接管 / 位图补写）并把「桌面全量接管是不是有意分化」交用户裁决——**不建议直接合并语义**（桌面全量接管可能是为外发微信/Word 的历史口径）；② 无论裁决结果，共享桥的 cut 删除改走内核命令：`attachSelectionClipboard` 增加可选的 `deleteSelection` 回调（EditorTab/LakeEditor/QuickNoteEditor 挂载时传「先 kernel 后 DOM 兜底」的同一实现，落点可复用 `EditorTab.tsx:308-310` 那三行），并给 `editorCut.test.ts` 同款源码级断言补到共享桥；③ 修正 `selectionClipboard.test.ts:25` 的措辞与 AGENTS §4，把「EditorTab 例外」写成显式契约，防后续审计反复提。
- **代价与风险**：①③ 零风险；② 改共享桥行为（移动端含图剪切的删除路径），需移动端装包点一次剪切 + 粘回（AGENTS §3#21）；若内核 delete 命令在写作卡实例不可达，保留 DOM 兜底即可。
- **优先级 P2**；涉及端：共享（selectionClipboard，两端）+ 桌面（EditorTab）。

### D-02 · 上传日志自愈/补拉效果两份近乎逐字复制 → 抽 `useUploadJournalRecovery`
- **问题与证据**：`EditorTab.tsx:123-158` 与 `LakeEditor.tsx:75-107` 是同一段效果（`subscribeUploadJournal` → error 按 `uploadRetryDelayForEntry` 退避补拉 → pending 跳过 → `hasUnresolvedImageTask` 判未解决 → 触发重建 tick → 清理定时器），差异仅 `deps`（`[noteId]` vs `[journalRecovery, mode, noteId]`）与一个局部变量。LakeEditor 侧注释自称「判据与桌面 EditorTab **完全同源**，避免两端对『什么时候自愈』有两套口径」——但它是一份**复制**，恰恰是漂移源（两处各 35 行，判据/退避预算改动要双改）。
- **具体方案**：抽 `features/editor/useUploadJournalRecovery.ts`：入参 `{ noteId, enabled, getLatestDocument, onNeedRebuild }`，返回挂载期 cleanup；两宿主替换为一行 hook 调用（rebuild tick 留在各宿主）。行为零变化。
- **代价与风险**：低。既有护栏 `uploadRecoveryWiring.test.ts` / `uploadRetryScheduler.test.ts` / `uploadCardRepair.test.ts` 直接覆盖；风险 = hook 依赖数组口径（把 enabled/mode 作为 hook 内部早退即可）。
- **优先级 P2**；涉及端：共享（桌面 EditorTab + 两端 LakeEditor）。

### D-03 · 编辑器宿主「交互面接线」三份 → 共享挂载清单函数（保守版）
- **问题与证据**：同一组 attach/detach 在三个宿主按同一顺序各写一遍：`createCardHoverResidueCleaner`（`EditorTab.tsx:901` / `LakeEditor.tsx:147`）、`upgradePastedHtml` 粘贴升级（`EditorTab.tsx:286` / `LakeEditor.tsx:131`）、`attachImagePreviewClick`（`EditorTab.tsx:909` / `LakeEditor.tsx:158` / `QuickNoteEditor.tsx:130`）、`attachFileCardClick`（`EditorTab.tsx:917` / `LakeEditor.tsx:178`）、`installMediaCardCategoryRouter`（`EditorTab.tsx:773` / `LakeEditor.tsx:227` / `QuickNoteEditor.tsx:145`）、`BookmarkToolbar` 挂载（`EditorTab.tsx:1162` / `LakeEditor.tsx:266`）。各宿主差异是**有意的参数**（桌面双击预览 vs 移动 tap、preview 档跳过菜单/复制、journalRecovery 开关、QuickNoteEditor 不挂 file 卡/菜单），但「差异 = 参数、挂载清单 = 同一份」的结构没有体现。漂移已有实证：图片预览历史护栏漏测 EditorTab（AGENTS §4 明文记录）、书签卡工具条「删挂载就又变没有菜单的死卡」（AGENTS §4）。
- **具体方案**：`features/editor/hostWiring.ts` 提供 `attachEditorHostSurface(host, opts) => detach`，opts 显式参数化全部差异（`tapToPreview` / `withCardMenu` / `withSelectionClipboard` / `withFileCard` / `attachmentPrefs` / `onError`），内部按现序挂载并返回统一 cleanup；三宿主改调用，**不改任何判据与文案**。同时把「三宿主挂载清单一致性」钉成文本护栏（扩展 `imagePreviewAttach.render.test.tsx` 的读取面到 EditorTab/QuickNoteEditor，别只测一个宿主）。**保守退路**（若评审认为搬家风险大于收益）：只做护栏扩展 + D-02，不搬代码。
- **代价与风险**：中。attach 顺序与 cleanup 顺序在个别宿主有语义（如 paste 在 capture 阶段、preventCardBlur 只在 LakeEditor）；逐宿主对照迁移、每步跑 `selectionClipboard.test`/`imagePreviewAttach.render.test`/`quickNotesView.test`（后者含源码文本断言，需同步改）。两端有意差异**只参数化不合并**。
- **优先级 P2**；涉及端：共享（三宿主所在 features）。

### D-04 · Sidebar.tsx 拆分续（1685 行；R2 已拆 7 个内部组件后的剩余主体）
- **问题与证据**：`components/app/Sidebar.tsx:162-1618` 单个 memo 组件约 1,450 行、30+ 个 useState（`:163-264` 连续 state 块）；域块混杂：批量选择/批量菜单/批量弹窗（`:229-258`）、导入（`:840-935` runImport/startImport/cancelMarkdownImport）、树拖拽（`:936` 起 beginTreeDrag 等）、置顶与「已收起」分区（`:240-246`）、创建/重命名（`:622-676`）。261112 R2 已把 ContextMenu/TreeRow/TreeRowFace/SidebarPinnedSection/SidebarCollapsedSection 等拆到 `components/app/sidebar/`（HANDOFF §0 261112 R2），方向已定、剩余主体未拆。
- **具体方案**：按「先 hook 后组件」拆三步，每步独立提交并跑 `sidebarRendering.test.ts` / `sidebarMultiSelect.render.test.tsx` / `sidebarNotebookDialog.render.test.tsx` / `sidebarCollapsed.render.test.tsx` / `sidebarMarkdownImport.render.test.tsx`：① `hooks/useSidebarImport.ts`（导入选文件→转换→进度/停止/结果四个 state + 三个动作）；② `hooks/useTreeSelectionBatch.ts`（selection/batchBusy/batchNotice/batchMenu + 批量动作）；③ `components/app/sidebar/TreeDragLayer.tsx` 或 `hooks/useTreeDrag.ts`（拖拽状态机 + ghost）。
- **代价与风险**：中（渲染回归面大，但有 5 个 render 测试文件护栏）；纯搬家不改行为；一次只拆一块。
- **优先级 P2**；涉及端：桌面。

### D-05 · App.tsx 组合根拆分（日记处理器 + 边缘悬停状态机）+ 补头注释
- **问题与证据**：`App.tsx:82` 起 `export function App()` 至 1533 行，无文件头注释；虽然已把大量逻辑放 hooks（useDesktopHandlers/useNoteActions/useTabLifecycle…），仍有三块内联域逻辑：日记空间 8 个处理器（`:617-701` handleDiaryWriteToday/ConvertEntry/CreateEntry/DeleteEntry/RenameNotebook/SetNotebookIcon/ToQuickNote/OpenSearch）、边缘悬停/预览状态机（`:833-890` cancelEdgePreview/showEdgeHandle/armEdgePreview/applyEdgeEffects/dispatchEdge + 定时器清理 effect）、新建文档弹窗与保存冲突块（`:704-737`、`:737-806`）。
- **具体方案**：抽 `hooks/useDiarySpaceHandlers.ts`（8 个 handleDiary*，注入 showNotice/native 调用面）与 `hooks/useEdgeReveal.ts`（边缘状态机 + timer 生命周期）；App.tsx 补 8-12 行头注释（组合根职责、各 hook 分工指针、本文件只留组合与布局）+ 给余下段落补齐 `// =====` 分区标记（现有 2 处如 `:110`、`:609` 可作样式）。
- **代价与风险**：低-中。日记处理器与 DiaryWorkspace props 强耦合，抽 hook 时 props 面不动；边缘状态机有 hover 时序（EDGE_HANDLE_DWELL_MS），搬家不改常量。
- **优先级 P2**；涉及端：桌面。

### D-06 · InkPad 结构拆分（Q19-10 续；来源 = HANDOFF §2 已登记）
- **问题与证据**：`features/ink/InkPad.tsx` 1,533 行、无头注释；HANDOFF §2「InkPad 结构拆分（Q19-10）未做：仅抽了 `inkPadModel` 纯逻辑 + 11 例行为测试；组合根 + 4 hook + 2 子组件拆分因 127 条文本护栏与 10 useState/45 useCallback 依赖网，留发布后按『先迁护栏 → 再抽 hook → 最后设备门禁』执行」。
- **具体方案**：照登记路线执行，不改行为：① 先把 127 条文本护栏迁到对新文件的断言（`inkPadWiring.test.ts` 等 551 行护栏文件是主要工作量）；② 再抽 4 hook（按 inkPadModel 的边界：笔/工具、页导航、贴图/文字块、历史）；③ 最后 2 子组件（页面条/底栏）；④ 交付跑 ink 全测 + `check:stylesnap` 受影响态（手写板属视觉层）。
- **代价与风险**：中-高（依赖网密集、护栏迁移是体力活）；但每步有 226+ 例 ink 测试兜底；发布后做。
- **优先级 P2**；涉及端：桌面（DesktopInkPad）+ 共享（inkPad.shared.css 类名集合护栏 `inkSharedCssParity.test.ts` 要同步核对）。

### D-07 · 内核卡片 value 编解码三份 → 收口 `core/fileCard`
- **问题与证据**：同一「card value = `data:{encodeURIComponent(JSON)}`」编解码有三份：`core/fileCard.ts:55-70`（`decodeCardValue`/`encodeCardValue`，权威实现，拒绝数组）、`features/editor/uploadCardRepair.ts:49-62`（私有同名副本，先剥 `data:` 再 decode）、`features/quickNotes/quickNotePreviewParser.ts:142-153`（私有副本，多容忍「裸 JSON」与数组）。三者语义有细微分叉（剥前缀顺序、数组/裸 JSON 容忍度）——这正是「同源多份、判据漂移」的典型起点。
- **具体方案**：`core/fileCard.decodeCardValue` 扩为 superset（容忍 `data:` 前缀任意位置、裸 JSON、数组按调用方需要保留开关或统一拒绝并给测试钉），两处私有副本删除改 import；用各自现有 fixture（uploadCardRepair.test / quickNotePreview.test / fileCard.test）对拍钉语义。
- **代价与风险**：低；跨到 core（01 流域），落点已在 core、只是收编调用方；风险 = 语义 superset 后「坏值回 null」口径变化（用三套 fixture 挡）。
- **优先级 P3**；涉及端：共享（core + 两个 features）。

### D-08 · 「本地资产显示 URL」组合 4 份 → `lib/assetPort` 单一 helper
- **问题与证据**：`localAssetHttpUrl + withAssetWidth + withAssetAccessToken` 的组合有 4 个私有版本：`components/app/NoteInfoDialog.tsx:91-95`（assetDisplaySrc，token 在 width 外层）、`components/app/AssetsBrowser.tsx:74-78`（assetDisplayUrl，token 在 width 内层——**两处组合顺序还不一致**）、`features/bitable/bitableAssetUrl.ts:13-17`、`features/aiWriting/aiWritingAttachments.ts:18-21`。bitable 版头注释自己点名「历史上拼了 4 处，顺序还各不相同」——bitable 收口了，另外两处漏网。二者经 `withAssetWidth` 的 query 保留语义都正确，但顺序敏感性就是隐患本体。
- **具体方案**：`lib/assetPort.ts`（已有 ASSET_PORT/withAssetAccessToken/assetThumbWidthForCss）增加 `localAssetDisplaySrc(noteId, filename, cssPx | null)` 单一组合；上述 4 处改调用。`features/preview/previewAsset.ts` 的 intent 模型（display/original/materialized）**不动**——语义不同不合并（B1 口径）。
- **代价与风险**：低；纯函数替换 + 现有 bitable/资源页 render 测试覆盖。
- **优先级 P3**；涉及端：共享。

### D-09 · import 双管线的队列/超时小工具两份 → `features/import/conversionQueue.ts`
- **问题与证据**：`features/import/htmlImportPipeline.ts:38-49` 与 `features/import/markdownImportPipeline.ts:344-363` 各有一份 `enqueueConversion` + `withTimeout`（后者多 inFlight 计数、超时文案不同「Word 转换超时」vs「Markdown 转换超时」——htmlImportPipeline 也用 `MarkdownImportError` 抛「Word 转换超时」，来源混同）。
- **具体方案**：抽 `features/import/conversionQueue.ts`（串行队列 + inFlight 计数 + `withTimeout(ms, label)` 文案入参），两管线改 import；顺带把错误类名/文案对齐（html 侧的超时文案改「Word 转换超时」保持不变，只是不再借 MarkdownImportError 的名字——若改类名有消费者依赖，保留类名只修注释）。
- **代价与风险**：低；两管线各有测试（markdownImportPipeline.test / markdownBatchImport.test）。
- **优先级 P3**；涉及端：桌面（导入仅桌面入口使用；移动端 share import 另线）。

### D-10 · MultiTabEditor 拆分（851 行 → TabStrip + 拖拽 hook）
- **问题与证据**：`features/editor/MultiTabEditor.tsx:139-851` 单组件混杂：标签切换器宽度拖拽（`:185-225`）、分屏几何（`:230-315`）、标签拖拽排序 FLIP（`:366-430` beginTabDrag/moveTabDrag + flipRects）、标签右键/批量 pin、MissingBodyPanel（`:120-138` 已独立）。只读横幅判据已单源（`:335-345`，261112 UI 审计 17 已收口）。
- **具体方案**：抽 `hooks/useTabStripDrag.ts`（拖拽状态机 + FLIP 动画）与 `components/app/…/TabStrip.tsx`（标签条渲染 + 切换器浮层），MultiTabEditor 只留宿主分派（5 个 lazy 编辑器）+ 分屏布局。
- **代价与风险**：中（tab 行为有多份 render 测试：multiTabHost.render.test / tabOrder.test / tabItemVisual.test / tabbarDivider.test）；纯搬家。
- **优先级 P3**；涉及端：桌面。

### D-11 · QuickNotePreview slot 代码出桌面首屏图（来源 = HANDOFF 261119 登记的瘦身方向）
- **问题与证据**：HANDOFF 261119 裁决记录「check-arch 桌面首屏超预算归因 = 共享组件 QuickNotePreview 的槽位/展开过渡（特征串 `7.5em`）……**组件拆分让 slot 代码出桌面图 = 登记在案的瘦身方向，再涨须重新论证**」；HANDOFF §3 另有「QuickNotePreview slot 代码出桌面图（261119 登记瘦身方向）」条目。当前桌面首屏余量仅 ~13KB（§2 门禁预算现状）。
- **具体方案**：把 slotFrame/展开过渡拆成独立子文件（如 `quickNotePreviewSlot.tsx`），使入口静态图 tree-shake 不到它；验证 `npm run check:arch` 数值下降后按流程收紧预算登记。**注意**：QuickNotePreview 本体是桌面小记卡要用的，只拆 slot/过渡部分，不改预览语义（`COLLAPSED_MAX_PX` 单一来源不动）。
- **代价与风险**：低-中（构建产物差异需重建后测量；HANDOFF §2 提醒「门禁一律先重建产物」）。
- **优先级 P3**；涉及端：桌面（体积）。

### D-12 · 零引用导出/旧导出 shim 清理（10 个值导出 + 6 个类型导出）
- **问题与证据**（两轮扫描：模块级 + 导出级，含 `export {}` 与 type；下述均「全仓零引用，含测试」，逐个 grep 核实）：
  - **兼容旧导出 shim（历史兼容，见 §4）**：`components/app/duplicateNotesFeedback.ts:39` `duplicateReasonSummary`（注释自认「兼容旧导出；实现已收口到 core」）、`components/app/batchNotesFeedback.ts:17` `batchNotesResultNoticeFor`（注释「桌面历史调用点仍用」——那些调用点已不存在）。
  - **旧路线遗留 API**：`features/editor/imageUploadTask.ts:301` `journalEntryForTask` 与 `features/editor/uploadCardRepair.ts:137` `hasJournalUploads`（注释都写「供 EditorTab 决定是否恢复」，实际恢复判据已走 `hasUnresolvedImageTask` 路线）。
  - **零引用功能导出**：`components/ui/ColorPalette.tsx:79` `lastUsedColor`（「点图标用上次色」功能已无调用方）、`features/ink/inkNav.ts:47` `clearInkNavPage`、`features/sidebar/pinnedTree.ts:92` `subscribePinnedTree`（连带 `emit()` 的 pub/sub 只发不订）、`lib/ai.ts:26` `listAiModels`（设置页直接调 `native.aiListModels`，`useSettingsPanelScope.tsx:136,178`）。
  - **测试助手零引用**：`lib/hiddenSpacesStore.ts:76` `resetHiddenSpacesCacheForTest`、`lib/releaseNotesText.ts:27` `resetReleaseNotesTextCache`。
  - **零引用类型导出**：`components/model/sidebarHoverMachine.ts` SidebarCorridorSelector、`features/bitable/bitableEditorModel.tsx` PatchView、`features/board/boardInputDiagnostics.ts:41` BoardStrokeDiag（「兼容旧名」别名）、`features/preview/types.ts` PreviewSource、`lib/log.ts` RendererLogLevel、`lib/types.ts` ImportedResource。
  - 另：`lib/formatTime.ts` 是 `core/dateFormat.formatDateTime` 的转发壳（仅 HistoryPanel/TrashPanel 两个消费者），同名函数还有两处 4 行私有包装（`components/app/RebuildDataBlock.tsx:34`、`SyncStatusPopover.tsx:52`）。
- **具体方案**：逐个确认后删除；`formatTime.ts` 两个消费者改直连 `core/dateFormat` 删壳（或留壳不动，见 §3）；`pinnedTree` 的 pub/sub 若确认无人订阅，连 `EVENT`/`emit` 一起删。删除是行为零风险（零引用），但**必须**跑全量 vitest + tsc 兜底。
- **代价与风险**：低；唯一注意点 = 动态字符串引用（已用全文 includes 扫描排除）。
- **优先级 P3**；涉及端：桌面 + 共享。

### D-13 · 大文件头注释/分区注释补全（14 个 ≥350 行文件首行即 import）
- **问题与证据**（实测脚本：首行非注释即判缺）：`components/app/Sidebar.tsx`(1685)、`features/ink/InkPad.tsx`(1533)、`App.tsx`(1533)、`features/editor/EditorTab.tsx`(1204)、`features/editor/MultiTabEditor.tsx`(851)、`features/quickNotes/QuickNotesWorkspace.tsx`(761)、`lib/native.ts`(695)、`features/ai/AiAssistantDialog.tsx`(661)、`features/editor/lakeRuntime.ts`(660)、`features/tags/TagsWorkspace.tsx`(654)、`components/app/TrashPanel.tsx`(542)、`features/editor/clipboardHtml.ts`(513)、`components/app/HistoryPanel.tsx`(429)、`features/editor/resourceUpload.ts`(387)、`components/app/SyncStatusPopover.tsx`(373)。**内部注释密度并不差**（App.tsx 46 处块注释、native.ts 132 处、Sidebar 67 处；内核契约/踩坑注释丰富）——缺的是**文件头「职责/边界/单一来源指针」**与组合根的分区导航。
- **具体方案**：每文件补 6-15 行头注释，模板 = 职责一句 / 边界（不做什么）/ 单一来源指针（如「浮层走 Overlay、确认走 useConfirm、gone 判据走 isGoneNote」）/ 已知坑指针（HANDOFF/LAKEX-CONTRACT 条目号）；App.tsx/Sidebar.tsx 另补 `// =====` 分区标记。纯注释零风险；可与 D-04~D-06 的拆分同批做（拆分后文件头注释一起落地）。
- **优先级 P3**；涉及端：桌面 + 共享。

## 3. 明确不建议做清单

1. **把 EditorTab 的「全量接管」直接并成共享桥的「含图才接管」**：桌面复制对外发（微信/Word）的历史口径可能就是全量物化，语义变更需用户裁决（D-01 只取证 + 统一删除口径，不动接管判据）。
2. **异步竞态统一抽象**（`BoardEditor.tsx:463`/`AiAssistantDialog.tsx:127`/`AiImagePicker.tsx:83`/`lockedTextCard.tsx:163` 的 cancelled 标志）：React 惯用法、四处语义各异，抽公共 hook 收益只停在整洁（§3#17）。
3. **`defaultStorage` 4 份合并**（aiWritingPins/OutlineController/recentSearches/tagsWorkspaceState，各 4 行）：同上；顺手在 D-12 里收编到 `lib/localStorageSafe` 可以，单独立项不值。
4. **体积格式化口径合并**：`lib/formatBytes`/`formatBytesCompact`/`core/noteInfo.formatNoteInfoSize`/`core/fileCard.formatFileSize`/`aiWritingAttachments.formatAttachmentBytes` 是 5 个**不同口径**，B1 已裁决「不同口径不合并、同一口径只留一份」（`core/noteInfo.ts:16-19` 注释钉死）；formatAttachmentBytes 的 B/KB/MB 自适应小数是第 5 种口径，不并。
5. **`colorMemory.rememberColor` 与 `ColorPalette.rememberColor` 合并**：前者是内核工具条「当前应用色」记忆（读写内核插件上下文，`colorMemory.ts:1-25`），后者是调色板「最近使用桶」（localStorage），名字同、语义不同。
6. **标签创建的 3 个 2 行包装**（`NoteTagRow.tsx:82-85` / `useQuickNoteList.ts:133-134` / `Sidebar.tsx:1345` 都调 `native.createQuickNoteTag`）：各带本地错误处理，抽公共函数只省 6 行。
7. **两套标签选择 UI 合并**（NoteTagDialog/NoteTagRow vs QuickNoteTagPicker vs BatchTagDialog）：弹窗/浮层/批量三形态是产品定稿差异，语义（normalize/create）已在 core 单源（`core/quickNoteTags`）。
8. **AI 助手 vs AI 写作输入卡合并**、**NoteInfoDialog vs NoteInfoSheet 合并**：两端/两面有意分化（AGENTS 明文 + `core/noteInfo.ts:1-10` 记录「形态差异是**有意的**」）。
9. **改 `lakex-local-notes-v1.settings` 键名或写键迁移**：键名是稳定标识不是兼容代码，改名 = 静默丢用户设置（违反 §3#7 精神：迁移代码比现状更糟）。
10. **`useSettingsPanelScope.tsx`（763 行）再拆**：已是 261112 R2「SettingsPanel 纯搬移」产物（文件头注释自述），再拆是整洁收益。
11. **删 `lib/fontTrial.ts`**：dev 控制台字体试用工具，`main.tsx:31` 仅 DEV 动态加载，注释/用途齐全。
12. **重开 261112 预览统一审计的 9 条「明确不做」**（万能 Preview 组件、跨端共享组件、删结构化摘要兜底、预览内编辑等）：结论仍成立，不再立项。
13. **为「手写 localStorage try/catch」（sidebar 三件套/inkNav）统一改走 `lib/localStorageSafe.writeLocalStorage`**：`collapsedNotebooks.ts:6` 注释明说「与 pinnedTree 同一套写法，刻意保持对称」，且 writeLocalStorage 会多打 console.warn（行为差异），收益 = 整洁。

## 4. 历史兼容代码清单

| # | 位置 | 类别 | 现状语义 | 能否按 §3#7 删 | 删的代价 |
|---|---|---|---|---|---|
| 1 | `components/app/duplicateNotesFeedback.ts:39` `duplicateReasonSummary` | ①真·历史兼容 | 「兼容旧导出」转发 core `duplicateNotesNotice` | **可删**（全仓零引用） | 零 |
| 2 | `components/app/batchNotesFeedback.ts:17` `batchNotesResultNoticeFor` | ①真·历史兼容 | 「桌面历史调用点仍用 ActionShape」的转发壳 | **可删**（调用点已不存在） | 零 |
| 3 | `features/editor/imageUploadTask.ts:301` + `uploadCardRepair.ts:137` | ①旧路线遗留 | 「供 EditorTab 决定是否恢复」的日志读取入口，恢复判据已改走 `hasUnresolvedImageTask` | **可删**（先确认无计划启用） | 零；删前过一遍 uploadRecoveryWiring 测试 |
| 4 | `features/board/boardInputDiagnostics.ts:41` `BoardStrokeDiag` | ③测试/工具旧名 | 类型别名「兼容旧名（画板侧读同一结构）」 | **可删**（零引用类型） | 零 |
| 5 | `features/ink/useInkDocState.ts:46` + `inkNav.ts:12` | ②协议/跨端读兼容 | inkDoc 读 1\|2\|3\|4 写 4；无本机页记录时回退 v1/v2 正文里的旧 `activePageId` | **不可删**（用户手写正文不可删了重建；AGENTS §4 ink 契约明文「读 1\|2\|3\|4」） | 删 = 旧手写板文档打开丢「当前页」 |
| 6 | `features/quickNotes/quickNotePreviewParser.ts:349` `restoreEscapedCards` | ②读容错（伴随未定位写入端） | 还原「被当文本粘进来」的实体化卡片标记（261121 动图粘贴现场；HANDOFF §3 写入端未定位） | **不可删**（现网正文已存在该形态） | 删 = 这些小记显示成一屏「超长链接」 |
| 7 | `features/editor/imagePreview.ts:113-128` | ②当前格式解析兜底 | 裸 `<img>` / value 即 URL 的图片卡旧形态兜底收集 | **不可删**（261112 审计已判定「属当前格式解析而非历史兼容」） | 删 = 部分正文预览缺图 |
| 8 | `features/editor/lakeTileRender.ts:47-49` | ②内核版本兼容 | 读 `editor._renderer` 的 legacy 访问器（新旧内核两形态取 renderer） | **不可删** | 删 = 内核小版本差异下 tileRender 失效 |
| 9 | `features/editor/kernelConfig.ts:112-113` | ②内核资源兼容 | editor.theme 最小兼容层 + slash.mainSearch 旧/新卡片配置双读 | **不可删** | 删 = 旧资源标识卡片不进插入面板 |
| 10 | `lib/es2024Fallback.ts` | ②运行时兼容 | 老 Android WebView 补 `toSorted/toReversed/Promise.withResolvers`（幂等） | **不可删** | 删 = minSdk 24 老 WebView 直接崩 |
| 11 | `lib/settings.ts:96-104`（`normalizeMaxOpenTabs` 等） | ②防御性归一 | 旧「不限(0)/24 档」与异常值夹到 1..16、字号归一到档位 | **不删**（clamp 非迁移；也防手改 localStorage） | 删 = 旧存档出现 0/24 标签档 |
| 12 | `features/editor/uploadJournal.ts:58,66-75` | ③工具持久化守卫 | 键名带 `.v1`；`isEntry` 结构守卫丢弃坏条目（非迁移） | **不删** | 删 = 坏条目崩读取 |
| 13 | `lib/types.ts` 等 6 个零引用类型导出 | ③类型旧名 | 历史 API 面残留 | **可删**（并入 D-12） | 零 |

**结论**：**可删 5 行（#1–#4、#13，共 11 个符号，另加 D-12 的转发壳 `lib/formatTime.ts`）/ 不可删 8 行（#5–#12）**。本域没有「为旧数据写的迁移代码」（`aiConversationTree.ts:13-22` 明文「旧格式读取直接给空会话，不写迁移」是合规样板）；settings/uploadJournal 的归一与结构守卫按 §3#7 判据（数据能否删了重建）不构成迁移负担。

## 5. 大文件与注释现状小结

**结构现状**（非测试 ≥350 行共 43 个文件；下表列 ≥600 或有问题的）：

| 文件 | 行数 | 头注释 | 现状与拆分指向 |
|---|---|---|---|
| components/app/Sidebar.tsx | 1685 | 缺 | 单组件 1450 行/30+ state；D-04（3 hook）；R2 已拆 sidebar/ 子组件 |
| features/ink/InkPad.tsx | 1533 | 缺 | D-06（HANDOFF Q19-10 续：迁护栏→4 hook→2 子组件） |
| App.tsx | 1533 | 缺 | D-05（useDiarySpaceHandlers + useEdgeReveal + 头/分区注释） |
| features/bitable/BitableEditor.tsx | 1497 | 有 | 多维表组合根；内部分区注释足；本轮不拆（先动 4 个更大） |
| lib/lakeEmojis.ts / emojiZhKeywords.ts | 1425/1188 | 有 | 数据表（表情/中文关键词），非逻辑堆积，不拆 |
| features/bitable/bitableCells.tsx | 1362 | 有 | 单元格控件集；若拆按「字段类型 × 浮层」分文件，P3 以后 |
| features/editor/EditorTab.tsx | 1204 | 缺 | D-01~D-03 收口接线后再考虑拆（scroll-anchor 恢复块是最大内联段） |
| features/editor/selectionToolbar/SelectionToolbar.tsx | 1062 | 有 | 三形态工具栏；K* 原子组件已内聚；本轮不拆 |
| features/editor/MultiTabEditor.tsx | 851 | 缺 | D-10 |
| features/usheet/UniverSheetEditor.tsx | 814 | 有 | usheet 契约触点密集（usheetKernelContract.ts 236 行已单列），不拆 |
| components/app/settings/useSettingsPanelScope.tsx | 763 | 有（搬移说明） | 不再拆（§3 第 10 条） |
| features/quickNotes/QuickNotesWorkspace.tsx | 761 | 缺 | 补头注释（D-13）；内部 33 处块注释已足 |
| components/app/AssetsBrowser.tsx | 715 | 有 | 健康 |
| lib/native.ts | 695 | 缺 | 132 处逐方法注释；补文件头（IPC 三处同步改的指针，AGENTS §7#6）；不拆（IPC 单一入口是契约） |
| lib/types.ts | 681 | 有 | CORE-10 已把共享类型下沉 core；余量为渲染层专属；不拆 |
| features/ai/AiAssistantDialog.tsx | 661 | 缺 | 补头注释；AI 助手域内聚 |
| features/editor/lakeRuntime.ts | 660 | 缺 | 补文件头（R2 已拆出 6 个 kernel 模块后的总入口）+ lazy 边界指针 |
| features/tags/TagsWorkspace.tsx | 654 | 缺 | 补头注释 |
| components/app/TrashPanel.tsx | 542 | 缺 | 补头注释（回收站预览口径指针） |
| features/editor/clipboardHtml.ts | 513 | 缺 | 补文件头（复制管线单一来源说明 → 与 D-01 契约同步） |

**注释补全方案** = D-13（模板见上）；**缺分区注释**的主要是 App.tsx/Sidebar.tsx 两个组合根（已有零散 `// =====` 标记 2-3 处，补齐到每个域块一行）。其余 ≥350 行文件（bitableCells/BitableFilterEditor/markdownImportPipeline/kernelConfig/Overlay/types 等 29 个）头注释齐全、契约指针清楚，不需要动。

**护栏与测试文件顺带观察**（不算方案）：`bitableEditorMount.test.ts` 1,321 行、`inkPadWiring.test.ts` 551 行是文本护栏集中地——D-06 迁护栏时的主要工作量；测试基建不需要拆。
