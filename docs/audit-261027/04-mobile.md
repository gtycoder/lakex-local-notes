# 04 移动端审计（src/mobile/** + android/**）

> 审计时间：2026-10-27 21:29–21:45（Asia/Shanghai），只读审计，未改动任何源码/配置。
> **基线**：HEAD = `41def9f0`（261027 18:24）；**工作树同时在被其它会话修改**（21:29 有 49 个改动，21:33 已 54 个，`dist-mobile` 于 21:31 被并行会话重构建）。下文每条证据标注「HEAD 基线」或「工作树在途」，并记录读取时间；行号只作定位参考，函数/符号名才是判据。
> 本文不重复已定稿决策；已登记者明确标注出处。

## 0. 结论摘要（按严重度）

> **261028 晚注**：本节是审计当时（2026-10-27）的结论快照，**不代表当前状态**；逐条当前状态以文末「修复状态（261028）」表 + `13-audit-status.md` 为准（本文状态表已按工作树代码对齐）。

1. **返回键语义有洞（P1）**：工作区的目录抽屉 / 大纲 / 标签页全屏列表 / 图标面板 / 历史面板 / 文档属性，以及首页的「添加标签」面板都**没有注册返回栈**，按返回键会直接退出工作区（触发整轮保存 + 转场）或**直接退出 App**（`useBackHandler.ts:43-51` + `NotebookWorkspace.tsx` 内 `pushBackHandler` 计数为 0）。
2. **工作区浮层状态机是 10 个独立 useState 手写互斥（P1）**：`sidebarOpen / outlineOpen / findOpen / tabsOpen / notebookSwitchOpen / createOpen / createParent / menuFor / infoFor / iconFor / historyFor`，互斥只在 `openSidebar/openOutline` 两处手写，`setTabsOpen/setNotebookSwitchOpen` 不收其它面板（`NotebookWorkspace.tsx:120-135`）。
3. **首页 tab 分页器是事件顺序驱动的命令式状态机（P1）**：程序化滚动用 600ms 定时器压回写、`commitByScrollRef` 单次 flag、`interactingRef`、四份 ref 镜像（tab/tabIndex/onTabChange/press），共 6 个 `useEffect`（`HomePage.tsx:178-267, 310-346, 493-511`）。
4. **移动端文档关闭了内核虚拟渲染，代价是全量 DOM（P1）**：`DocumentEditor` 恒传 `disableVirtualRendering: true`（`DocumentEditor.tsx:185`），原因写在 `mobileFind.ts:5-7`——自研 DOM 查找需要整篇在 DOM 里。桌面同一份文档走内核 `virtualRendering`（`lakeRuntime.ts:417-427, 883-895`）。
5. **usheet 保存不接 `normalizeUsheetWorkbook`（P1，AGENTS §4 已登记「尚未接同一 helper」）**：移动端 `capture()` 直接 `usheetToBody(book.save())`（`MobileUsheetViewer.tsx:199-214`），桌面三处调 normalize（`UniverSheetEditor.tsx:75/277/340`）⇒ 同一份表格两端写出的方言可能不同，混合使用会互相改 hash。
6. **`purgeTreeItem` 不删 `note-assets/`（P1，`docs/MOBILE-TECH-STACK.md:204` 已登记「已知」）**：彻底删除只删正文/历史文件（`trashRepository.ts:199-252`），图片/附件留在 App 私有目录，直到用户手动跑「清理未引用资源」。
7. **表格编辑面复制了一套 `useEditSurface`（P1）**：`MobileUsheetViewer` 自带 5 个面板 state + 3 个定时器（1800/1800/240ms）与文档编辑面的 `useEditSurface`（closing/closingHold/panelHeight/2500ms 兜底）**两套实现**（`MobileUsheetViewer.tsx:111-119, 237-273` vs `useEditSurface.ts:79-151`）。
8. **两个设置项在移动端是「写而不读」（P2）**：`maxAttachmentBytes`（`SettingsDrawer.tsx:201-208` 可调，`bridge/context.ts:84` 用固定 100MiB 常量）、`cleanupIntervalHours`/`retentionDays`（桌面有定时器 `electron/main.ts:666-673`，移动端无任何调度，`cleanupHistory` 只有桥方法没有入口）。
9. **表格 ⋯ 面板 10 个置灰占位 + 至少 4 处不可达 toast 分支**（`usheetChromeModel.ts:49-56/169-182/201-209` + `MobileUsheetViewer.tsx:391-426`）：HANDOFF §0 待用户裁决①，本文只给删除方案不重复论证。
10. **首屏预算无护栏**：当前构建入口 221KB raw / 69KB gzip + 入口 CSS 436KB raw / 138KB gzip + 20 条 `modulepreload`（528KB raw），而 §7#18 记录的目标值是 12 条 preload；`check:bundle` 不含 preload 数/CSS 体积断言（P2）。

## 1. 现状盘点

### 1.1 范围与规模（读取于 21:31，`find`/`wc` 实测）

| 项 | 数字 |
| --- | --- |
| `src/mobile` 文件 | 322（270 `.ts` / 52 `.tsx` / 20 `.css`） |
| 总行数 | **42,041**（非测试 30,160 + 测试约 11,900） |
| 测试文件 | **141**（全仓 453 的 31%） |
| 目录行数（含测试） | data 5,916 · usheet 5,166 · 根 4,549 · editor 3,485 · native 3,055 · notebook 2,866 · home 2,741 · ai 2,495 · v3 1,955 · settings 1,697 · bitable 1,573 · bridge 1,525 · ui 1,514 · hooks 1,377 |
| 最大文件 | `mobile.css` 1,253 · `HomePage.tsx` 958 · `NotebookWorkspace.tsx` 954 · `MobileUsheetViewer.tsx` 837 · `v3/mobileDeviceStore.ts` 809 · `EditorDock.tsx` 723 · `usheet-chrome.css` 636 · `SettingsDrawer.tsx` 589 · `MobileApp.tsx` 584 |
| CSS | 20 文件 / 4,114 行；`!important` 共 **14** 处（edit-surface-kernel.css 7、dark 2、base 2、mobile.css 2、kit 1）≈ 19 条棘轮内 |
| Kotlin | 13 文件 / 2,879 行（AssetSync 558 · AssetServer 529 · AiChat 414 · BodyStore 317 · OpenFile 252 · MainActivity 221） |
| 桥 | `bridge.ts` 仅 39 行组合，8 个域文件共 1,525 行、约 103 个方法；`lakeNativeContract` = 50 bridge + 2 附带 |

### 1.2 关键入口（读代码确认）

- 启动：`src/mobile/main.tsx` → `MobileApp`（`phase: booting|ready`）→ `bridge.init()`（开库 + schema + `reconcileIndex` + 小记元数据回填）→ `refreshAll`。
- 路由：只有两层 `{home tab} | {notebook id + initialNoteId + mode}`（`MobileApp.tsx:67-70`），工作区由 `useRouteTransition` 挂载/卸载，首页 keep-alive。
- 首页（958 行）：小记时间线与知识库，两条 tab 用**原生横向滚动 + scroll-snap** 手写分页器（`HomePage.tsx:166-267`）；小记 >24 条走 `@tanstack/react-virtual`（`QUICK_NOTE_VIRTUAL_THRESHOLD`）。
- 工作区（954 行）：目录抽屉（≥60 行走虚拟窗口，工作树在途新增 `NotebookTreeList`）· 标签页全屏列表 · 大纲抽屉 · 切换笔记本 · 新建菜单 · 行菜单 · 属性 · 图标 · 历史 = **8 个面板 + 5 种正文视图**（doc/board/ink/bitable/usheet，均懒加载）。
- 编辑面：`useEditSurface`（面板/键盘互斥的唯一 owner）+ `EditorDock`（723 行，插入两组 8+11 项、Aa 面板、「更多」4 行）。
- 表格：`MobileUsheetViewer` 837 行 + `usheetChromeModel` 265 行 + `usheet-chrome.css` 636 行 = 移动端最大单特性。
- 原生：Capacitor 插件 13 个（SQLite/BodyStore/AssetSync/AssetServer/SecureStore/SharedContent/OpenFile/PinShortcut/ShowKeyboard/Stylus/AI/SecretBox/AwsV4Signer）。

### 1.3 构建产物度量（`dist-mobile`，21:31 并行会话构建；非 HEAD 构建，仅供量级参考）

| 项 | 数值 |
| --- | --- |
| chunk 总数 / 目录体积 | 284 个 JS / 53MB |
| 入口 chunk | `mobile-BWBLUF6I.js` 221,290B raw / **69,467B gzip** |
| 入口 CSS | `mobile-3hBatwSW.css` 436,553B raw / **138,456B gzip** |
| `modulepreload` | **20 条**，合计 528,425B raw（其中 `bridge-*.js` 276KB、`client` 133KB、`activeEditor` 60KB） |
| 懒加载大块 | lakeRuntime 6.31MB · usheet 7.09MB · plantuml 6.39MB · DrawnixBoardCore/viz 1.4MB |
| 启动首屏字节（估算） | JS(raw) 约 750KB + CSS 436KB；gzip 约 230KB + 138KB |

### 1.4 门禁与探针（读 `scripts/mobile-audit/`）

- `check:mobilesnap` 6 态：`home-library / home-quicknotes / home-library-list / home-doc / settings / settings-appearance`（`mobile-snap.mjs:95-141`）。
- 走查 23 屏：`home-library · home-quicknotes · home-library-shelf · notebook-workspace · doc-0..4 · quicknote-editor · doc-outline · doc-note-info · doc-history · notebook-icon-sheet · settings · settings-{编辑器,外观,历史,资源管理,同步设置,清理缓存,回收站,关于}`（`scripts/css-audit/mobile-walkthrough.mjs:153-182`）。
- 几何/IME 装置：`edit-surface-invariants.mjs`、`keyboard-toggle.mjs`、`insert-panel-geometry.mjs`、`boot-timeline.mjs --no-idle`。
- **覆盖盲区（实测清单）**：23 屏里**没有** usheet 编辑/阅读、bitable、board、ink、AI 页、小记标签面板、搜索 Sheet、回收站预览、缺失正文面板。

### 1.5 本轮明确「不是问题」（已核对，避免重复上报）

- 长按只有一份计时器：目录行 `useLongPress`（`NotebookTreeList.tsx:103-106`），首页胶囊「按压上滑」是另一套手势语义且有纯函数 + 单测（`ui/createPress.ts` + `createPress.test.ts`），不算第二份长按。
- 内核/usheet/画板 三条重路径都走 `lazy`，入口无内核静态 import（护栏 `mobileLazyChunks.test.ts`，本次 6 条断言全在）。
- 两端共享的纯逻辑确实共享：搜索分词/摘要走 `src/core/search`（`data/searchIndex.ts:1`、`quickNotesSearch.ts:8`）、同步决策走 `core/s3v3*`、云状态 `core/cloudState`、维护域 `core/maintenancePolicy`。
- 文件级死代码极少：对 182 个非测试源文件做「全仓无文本引用」扫描，仅 `testSetup.ts`（vitest 用）与 `wasm-url.d.ts`（类型声明）命中。

## 2. 问题清单

### MOB-01 [P1] 返回键不关工作区/首页的浮层（抽屉、大纲、标签列表、图标、历史、属性、标签选择）

- 证据：
  - `src/mobile/hooks/useBackHandler.ts:38-51`（`useBackHandler` 的 listener）：顺序 = capture → `consumeBack()` → 新建库/搜索 Sheet → 设置抽屉 → `route.kind === notebook ? onBackFromNotebook()` → `onAppExit()`。
  - `src/mobile/ui/backStack.ts:10-21`：注册式返回栈；全仓 `pushBackHandler` 只出现在 `ConfirmDialog / CreateSheet / PickerSheet / MobileSheetMenu / HomePage(composer) / bitable 两个 sheet / AI 五个页面`（`grep -rn pushBackHandler src`，读取 21:32）。
  - `NotebookWorkspace.tsx`（954 行，读取 21:30）**0 处** `pushBackHandler`：目录抽屉 `<aside className="side-panel side-panel--left">`（:810）、大纲 `<OutlineSheet .../>`（:860）、标签页全屏 `mobile-model-mask`（:863-886）、`iconFor` 面板（:916-928）、`historyFor` 面板（:931-950）、`infoFor` 面板（:906-913）都没有登记。
  - `src/mobile/home/MobileQuickNoteTagSheet.tsx` **0 处** `pushBackHandler`（读取 21:38），而首页路由下 `useBackHandler` 走 `onAppExit`（`MobileApp.tsx:358-361` 传 `exitApp`）。
  - `src/mobile/settings/SettingsDrawer.tsx` 也没有：子页（`view !== "menu"`，:169-560）按返回键 = `drawerOpen` 分支关整个抽屉（`useBackHandler.ts:46-47`）。
- 影响：① 首页打开「添加标签」后按返回 = **退出 App**（标签选择丢失，非崩溃但用户体感是"闪退"）；② 工作区抽屉/大纲/标签列表打开时按返回 = 整轮 `flushAllTabs` + 出场转场回首页（用户以为只是关抽屉）；③ 设置子页返回直接回首页，回菜单要重新开设置。**数据不丢**（保存屏障在，`NotebookWorkspace.tsx:336-345`），丢的是导航预期。
- 建议：
  - ① 激进：为「浮层」建立唯一 owner——`useWorkspaceOverlays()` 单 reducer（`overlay: null | tree | outline | tabs | switch | create | menu | info | icon | history`）+ 在该 hook 内**统一**注册 `pushBackHandler`；首页的 `tagSheetFor/filterOpen/createOpen/...` 与 `SettingsDrawer.view` 同样各收敛成 `useOverlayStack`。删掉 6 处手写 scrim/sheet。
  - ② 保守：在 `NotebookWorkspace` 加**一条** `useEffect`：任一浮层打开时 `pushBackHandler(() => { 关最上层; return true; })`；`MobileQuickNoteTagSheet` 内加同款；`SettingsDrawer` 子页加 `pushBackHandler(() => { setView("menu"); return true; })`。
- 成本：S（保守 3 处，各约 15 行）/ M（激进，见 §4 Phase 1-2）。
- 状态：**新发现**（工作树与 HEAD 同）；设备可复现（`Input.dispatchKeyEvent` KEYCODE_BACK，见 §5）。

### MOB-02 [P1] 工作区浮层是 10 个独立 state，互斥只在两处手写

- 证据：`NotebookWorkspace.tsx:120-135`（`sidebarOpen / outlineOpen / findOpen / tabsOpen / notebookSwitchOpen / createOpen / createParent`）+ `:311-332`（`menuFor/infoFor/renamingId/iconFor/historyFor`，来自 `useNotebookTreeActions`）。互斥只有 `openSidebar`/`openOutline`（`:133-134`）；`setTabsOpen(true)`（:779）、`setNotebookSwitchOpen(true)`（:782）、`setCreateOpen(true)`（:831/:855）、`setIconFor`/`setHistoryFor` 都不收其它面板。另有 3 个 effect 只负责「打开任一浮层就把顶/底栏复位」（:173-175）。
- 影响：任意两个面板可同时存在（抽屉 + 全屏标签列表、图标面板 + 目录菜单），z-index 靠 `--mobile-z-*` 各自解释；新增一个面板要改 3 处（state、互斥、复位、返回、滚动锁定）。这是 MOB-01 的结构性原因。
- 建议：① 激进：单 reducer + `<OverlayHost>`（见 MOB-11）；② 保守：把「打开某面板」收成一个 `openOverlay(kind)`，内部先 `closeAll()` 再打开；`setXOpen(true)` 全部改走它（约 8 个调用点）。
- 成本：S（保守）/ M（激进）。
- 状态：**新发现**（HEAD 基线同在）。

### MOB-03 [P1] 首页 tab 分页器靠定时器/单次 flag 区分「程序化滚动」与「用户滚动」

- 证据：`HomePage.tsx:185-204`（`interactingRef / commitByScrollRef / programmaticRef / programmaticTimerRef`，600ms 定时器）；`:229-267`（scroll 监听里"过半就回写"+`commitByScrollRef=true`，`:209-214` 的 effect 再消费这个 flag）；`:270-279`（inert）；`:276-279`（写作时锁横滑）；`:444-511`（胶囊按压：window 挂 pointermove/up/cancel + 350ms `suppressTapRef`）；`:358-378`（搜索命中：双 rAF + `scrollIntoView` + 立刻消费 pending）。
- 影响：任何「滚动事件来源」判断都依赖时序（`programmaticRef` 被 600ms 兜底清除；`scrollend` 在 Android WebView 的支持与时机不定）；两个 ref 组合出错的表现是「点 tab 不滚/滚两次/标签与内容错位」，与 261019 用户反馈同类。回归只能靠设备（无 DOM 单测覆盖 HomePage）。
- 建议：① 激进：分页交给一个纯状态机（`tabPager.ts` 已有 `pagerScrollLeft/settledIndex/tabAt`，可扩成 `reducePager(state, event)`），DOM 侧只 `scrollTo`，事件进 reducer；或直接改成「只有 `scrollend` 回写 + `scroll-snap`」并删掉 600ms 定时器（风险：Android 老版本无 `scrollend`）。② 保守：把 4 个 ref 收成 1 个 `pagerRef = {mode:"idle"|"programmatic"|"user", at}`，用 `scrollend`+`touchend` 双出口复位，定时器仅作 fallback。
- 成本：S（保守）/ M（激进）。
- 状态：**新发现**（HEAD 基线同在）。

### MOB-04 [P1] 为自研查找关闭内核虚拟渲染：长文档全量 DOM

- 证据：`src/mobile/editor/DocumentEditor.tsx:185`（`prefs={{ ..., disableVirtualRendering: true }}`）与 `src/mobile/editor/mobileFind.ts:5-7`（「移动端文档编辑面开了 `disableVirtualRendering:true`（整篇正文都在 DOM 里）⇒ DOM 内查找是准确的」）；内核开关语义与实测背景在 `src/features/editor/lakeRuntime.ts:404-427, 883-895`（大文档 A/B：ON 首资产 2.0–2.3s / 36→2 个资产请求）。
- 影响：移动端任何长文档（几千块/上百图）打开即全量建 DOM + 全量水合卡片；桌面有 `virtualRendering` 抵消。这条是「自研功能 ↔ 内核能力」耦合：只要移动端还要 DOM 查找，就不能开虚拟渲染；反过来想开虚拟渲染就必须重做查找。
- 建议：① 激进：查找改走**非 DOM 路径**——内核 `editor.getDocument("text/plain")` 取文本建偏移索引，命中后用内核滚动/聚焦 API 定位，然后开 `virtualRendering`；A/B 用 `boot-timeline.mjs` + DOM 节点数自证。② 保守：保持现状，但在装置里补「长文档 DOM 节点数」探针，把当前值当基线只许降（先量化再决定）。
- 成本：L（激进，含内核能力核实）/ S（保守探针）。
- 状态：**新发现**（机制本身已定稿，见 AGENTS §4「移动端文档内查找 = 自研一套」；本条报的是它的**未登记代价**）。

### MOB-05 [P1] usheet 保存路径不接 `normalizeUsheetWorkbook`：两端写入方言不一致

- 证据：移动端 `MobileUsheetViewer.tsx:199-214`（`capture()` → `usheetToBody(state.book.save())`；基线 `last` 在 `:536` 同样由 round-trip 得到）；桌面三处 `normalizeUsheetWorkbook`（`src/features/usheet/UniverSheetEditor.tsx:75, 277, 340`），helper 在 `src/core/usheetDoc.ts:69`；AGENTS §4 已写「**移动端 usheet 保存路径尚未接同一 helper**」，护栏 `usheetOpenReadOnly.test.ts` 只覆盖桌面。
- 影响：移动端本地「打开→编辑→完成」不标脏（基线是 round-trip，`last` 一致），但**同一份 workbook 在两端序列化结果可能不同**（字段顺序/默认值/空表），移动端保存一次 ⇒ 桌面 hash 变、桌面再保存 ⇒ 移动端 hash 变 ⇒ **跨端来回上传**，且违反 AGENTS「打开 = 只读」的跨端形态。
- 建议：① 激进：`capture()` 与首次基线都走 `normalizeUsheetWorkbook(workbook)` 再 `usheetToBody`（与桌面同一函数），并把 `usheetOpenReadOnly.test.ts` 扩一条「移动端 capture 无真实改动时返回磁盘原文」；② 保守：只在 `capture()` 前 normalize 一次，基线同步改，补一条跨端 payload 逐字节对拍测试。
- 成本：S（两端各一处 + 1 测试）。
- 状态：**已登记**（AGENTS §4）。**建议升格为 P1 并排期**：这是「两端同一数据格式两套写法」，比 UI 债更贵。

### MOB-06 [P1] 彻底删除不清 `note-assets`（本地图片/附件残留）

- 证据：`src/mobile/data/trashRepository.ts:199-252`（`purgeTreeItem`：事务内删 `notes/folders/sync_base/note_history` + 写墓碑；事务外 `deleteNoteBodies`、`deleteHistorySnapshot`——**没有资产目录**）；资产落盘在 `src/mobile/native/assetFs.ts:14-17, 49-58`（`note-assets/{noteId}/{filename}`、`quick-notes/assets/{id}/{file}`）；`docs/MOBILE-TECH-STACK.md:204` 已记「移动端 `purgeTreeItem` 不清理 `note-assets/`（正文/历史会删；本机图片目录残留…）」。
- 影响：用户「彻底删除」后，图片/附件仍以明文留在 `/data/data/.../files/note-assets/<id>/`，只有手动进「设置 → 资源管理 → 清理未引用资源」才删；与 AGENTS §3#5/#15「彻底删除 = 零痕迹（本地回收站/历史除外）」的语义不符，属于隐私+存储双债。
- 建议：① 激进：`purgeTreeItem` 收集 noteIds 后由调用层（`bridge/notes.ts:326-331`）在事务外一并 `deleteAssetsDir(noteId)` + 小记 `deleteQuickAssetsDir`（`v3/mobileDeviceStore.ts:654, 690` 已有现成方法），并把「资产目录存在性」写进 `bridgePurge.test.ts`；② 保守：删除后立刻把该 noteId 的资产登记进孤儿表，让「清理未引用资源」下次启动自动清（保留现有 UI 语义）。
- 成本：S。
- 状态：**已登记为「已知」**（MOBILE-TECH-STACK:204）。**建议升格为 P1**：删除语义是 AGENTS 硬红线，不该长期以"已知"存在。

### MOB-07 [P1] 表格编辑面复制了第二套面板/键盘状态机

- 证据：`MobileUsheetViewer.tsx:111-119`（`dockPanel / renderedPanel / panelOpen / panelClosing / panelClosingHold / panelHeight / dockSub` 7 个 state + 2 个 timer ref）、`:253-294`（`finishPanelClose` / `closeDockPanel` 1800ms 兜底 / `openDockPanel` / `toggleDockPanel`）、`:237-250`（自己写的 `setImeSuppressed`，只处理 host 内元素）vs `src/mobile/editor/useEditSurface.ts:79-151`（`panelMode/panelHeight/closing/closingHold/renderedPanel` + `finishPanelClose` + 2500ms 兜底 + `applyImeSuppression` 处理**所有**可见 contenteditable）。
- 影响：两条状态机语义已分叉（1800 vs 2500 兜底；hold 条件不同；IME 抑制范围不同）；`edit-surface-invariants.mjs` 只覆盖文档编辑面，表格侧的「键盘⇄面板」只能靠人眼。任何 dock 几何修复要在两处各改一次（261023 已经历过「全盘参考/照抄」）。
- 建议：① 激进：把 `useEditSurface` 参数化（`scope: Element`、`minPanelHeight`、`panelDefault`），表格直接复用；删掉表格侧 7 个 state 与 2 个定时器；② 保守：把 `capturePanelHeight/dockKbOffset/bottomOccupation`（已共享，`editSurfaceModel.ts`）之外的**时序常量**抽成一份（`PANEL_CLOSE_FALLBACK_MS`、`CLOSING_HOLD_MS`），并给表格补一条快照屏。
- 成本：M（激进）/ S（保守）。
- 状态：**新发现**（两侧代码核对所得；HANDOFF 只写了「照文档 dock 的模型」）。

### MOB-08 [P1] 启动失败无出路；看门狗/崩溃重建无上限（工作树在途）

- 证据（工作树，读取 21:33；HEAD 只有前半）：
  - `MobileApp.tsx:449-450`：`if (phase === "booting") return <MobileHomeSkeleton/>; if (error) return <div className="poc-center poc-error">{error}</div>` —— 只有一行裸错误，**没有重试/清缓存/进设置**的出口；`bridge.init()` 抛错（开库/schema/迁移失败）即死路。
  - `android/.../MainActivity.kt`（21:30 修改）：`BOOT_WATCHDOG_MS=30_000` + `webView.reload()`；`onRenderProcessGone → runOnUiThread { recreate() }`（无 attempt 计数/无退避）。
  - JS 侧报到已补：`src/mobile/main.tsx:70-73` `window.lakeBoot?.ready?.()`（**21:30:49 之后才出现**；21:29-21:31 的读取里还没有——审计期间被并行会话补上）。
- 影响：① 看门狗与 JS 报到**必须同批合入**，只合原生侧 = 每次冷启动 30s 后必 reload 一次（正在写的正文最多丢最后 1s 防抖窗口，且会打断相机/选图流程）；② 若某文档稳定触发渲染进程 OOM，`recreate()` 无上限 ⇒ 「白屏→重建→白屏」循环，用户只能杀进程；③ 启动失败页没有恢复动作，等于要求用户卸载重装。
- 建议：① 激进：原生维护 `recreateAttempt`（10 分钟内 ≥2 次则不再 recreate，改为 finishAffinity + 提示），看门狗只在 `!bootReady && attempt==0` 时 reload；渲染层错误页给 3 个动作（重试 `bridge.init()` / 复制诊断 / 清派生缓存后重试，用现成 bridge 诊断端口）。② 保守：只加 JS 侧错误页的「重试」按钮 + 原生 recreate 计数（10 行内），看门狗维持一次性。
- 成本：S（保守）/ M（激进）。
- 状态：**新发现（工作树在途）**；**合入前必须成对检查**。

### MOB-09 [P2] 两个设置项在移动端「可改但无效」

- 证据：
  - 附件上限：`SettingsDrawer.tsx:201-208`（「附件大小上限」Picker，写入 `settings.maxAttachmentBytes`）；移动端读取方 **0 处**（`grep -rn maxAttachmentBytes src/mobile` 只命中 SettingsDrawer 自己）；实际上限来自 `bridge/context.ts:15, 84` 的固定 `MAX_ATTACHMENT_BYTES = 100MiB`（`core/storeLimits.ts:9`）。
  - 历史清理：`SettingsDrawer.tsx:296-307`（每文档快照上限/保留天数/自动快照间隔/定期清理间隔）；`snapshotIntervalMinutes` 有消费者（`MobileApp.tsx:213-223`，且只在挂载时读一次）；`cleanupIntervalHours`/`retentionDays` 只有 `historyRepository.ts:132-160` 的读写，**无调度**：`cleanupHistory` 全仓调用点只有 `bridge/notes.ts:198-203`（无 UI 调用）与 `lakeNativeContract` 调试清单；对照桌面 `electron/main.ts:666-673` 有 setInterval。
- 影响：① 用户把附件上限调到 200MiB 仍然 100MiB 被拒（文案与行为不符）；② 历史快照（gzip 文件）只受「每篇 maxSnapshots」约束，**从不按天清理**，长期使用磁盘无界增长（移动端存储敏感）。
- 建议：① 激进：删掉移动端的「附件大小上限」行（桌面才有真实链路），或让 `assertResourceBytes` 读设置；历史清理接入现有 `useAutoSync` 的空闲时机跑一次 `cleanupHistory`（按 `cleanupIntervalHours` 记账）。② 保守：两行都加「移动端暂不支持」置灰，先消除谎报，再排期接线。
- 成本：S。
- 状态：**新发现**（HEAD 与工作树同）。

### MOB-10 [P2] 表格面板 10 个置灰占位 + 4 处不可达分支

- 证据：`usheetChromeModel.ts:49-56`（插入 7 块里 5 个 `disabled`：单元格图片/手写签名/附件/图表/批注）、`:169-182`（数据 2 个：数据验证/分列；视图 2 个：表单/图表视图）、`:201-209`（更多 1 个：条件格式）——共 **10** 个占位；`SheetDockPanel.tsx:167-170, 353-355, 377-379, 413-420` 渲染 `disabled` + 「暂不支持」；而 `MobileUsheetViewer.tsx:391-392, 398, 402, 426` 仍保留对应 `showToast("移动端暂未支持：…")` 分支——disabled 按钮不会触发 onClick，**这 4 处是死分支**。
- 影响：用户看到 22 个可点 + 10 个"暂不支持"的混合面板（HANDOFF 记的是 29 项/7 置灰，**与实际代码不符**：现为 32 项/10 置灰）；死分支让后续接功能的人以为已经半接好了。
- 建议：① 激进：按用户裁决直接删（连同 `handleInsert/handleData/handleView/handleMore` 的 fallback toast 分支）；② 保守：保留置灰但把占位收敛到**一条**「更多能力」入口，删死分支与重复 toast。
- 成本：S。
- 状态：**已定待裁决**（HANDOFF §0 待裁决①「表格 ⋯ 面板逐项去留」）。本文只报「数量与 HANDOFF 不符」+「死分支」。

### MOB-11 [P2] 8 个浮层各写一套 scrim/sheet，5 个漏了返回栈/滚动锁定

- 证据：`grep -rln "mb-scrim|mb-sheet" src/mobile --include='*.tsx'` = 19 个文件；其中 `pushBackHandler` 计数：`MobileSheetMenu 2 / CreateSheet 2 / PickerSheet 2 / ConfirmDialog 2 / bitable 两个 2 / AI 五个 2`，而 `NoteInfoSheet 0 / SearchSheet 0 / CreateNotebookSheet 0 / MobileQuickNoteTagSheet 0 / NotebookWorkspace 0 / OutlineSheet 0 / DocListSheet 0`（读取 21:36）。
- 影响：新增一个面板要复制四件事（scrim、`data-prevent-swipe`、`useSwipeToClose`、返回栈），漏一件就是 MOB-01 那类洞；样式上 `.mb-sheet` / `.mb-sheet__head` / `.mb-sheet__body` 的几何也靠各自 class 拼接（`mobile.css` 里 `.mb-sheet` 系列与 `.mb-menusheet` 系列两套）。
- 建议：① 激进：新增 `ui/MobileSheet.tsx`（props: open/title/side/onClose/dismissible/footer），内部负责 scrim+swipe+backStack+焦点；迁移 8 处、删手写；② 保守：只给 `NoteInfoSheet/MobileQuickNoteTagSheet/CreateNotebookSheet/SettingsDrawer 子页` 补 `pushBackHandler`（MOB-01 保守版）。
- 成本：M（激进）/ S（保守）。
- 状态：**新发现**。

### MOB-12 [P2] 标签会话恢复靠「跳过首次写盘」的隐式协议 + 5 个 ref 镜像

- 证据：`useNotebookTabs.ts:162-171`（`firstPersistRef`：首次挂载不写 localStorage，**因为它跟另一个模块的恢复 effect 有先后约定**）；恢复逻辑在 `NotebookWorkspace.tsx:217-241`（读 `notebookTabsStorageKey` → `saved.slice(0,-1).forEach(openTab(..., {load:false}))` → 最后激活）；清档在工作树新增 `notebook/tabSessionCleanup.ts:17-25` + `main.tsx:48-50`（`clearTabsOnExit` 启动时清）；状态镜像：`tabsRef / activeIdRef / pendingIdsRef / tabEpochRef / previousTabIdsRef`（`useNotebookTabs.ts:47-51`）与 state 双写（`:58-59` 每次渲染覆盖）；`openTab` 在 `setTabs` updater 里调 `loadSettings()` 并做 LRU 淘汰（`:106-129`），`readTick` 是纯 force-render 计数器（`:45, 71, 94`），`freshId` 是 260ms 纯动画态（`:86`）。
- 影响：恢复行为依赖「组件挂载顺序 + 两处 effect 的提交顺序」（StrictMode 双挂载下尤其脆）；updater 内的 `loadSettings()` 有副作用（StrictMode 会调两次 updater）；「首挂不写」这类约定没有护栏测试（`tabRestore.test.ts` 是新加的，需覆盖"首挂不覆盖存档"）。
- 建议：① 激进：恢复逻辑搬进 `useNotebookTabs`（`restore(noteIds, activeId)` 一次 dispatch，内部读存档、不再依赖挂载顺序），持久化改成「变化即写 + 首挂用 `initialTabs` 作为初始 state」；删 `readTick/freshId`（fresh 动效改 CSS class 由 key 驱动）；② 保守：给「首挂不写」补一条测试，`loadSettings()` 提到 updater 外。
- 成本：M（激进）/ S（保守）。
- 状态：**新发现（工作树在途）**——恢复功能本身尚未合入，**建议在合入前按激进版重排**，否则这套隐式协议会永久固化。

### MOB-13 [P2] 注释/文档漂移（会误导下一个会话）

- 证据：
  - `HomePage.tsx:771-776`：「AI 只占位（用户定：先加图标，接入方案另行立项）」，但 `onOpenAi` 已接到 `MobileAiPage`（`MobileApp.tsx:528-532`）、AI 有 2,495 行代码与设置页配置——注释过期。
  - HANDOFF §0 待裁决① 写「29 项：22 可点 + 7 置灰」，实测 32 项/10 置灰（MOB-10）。
  - HANDOFF 261026 记「移动端适配器仍不落仅 `updatedAt` 变化的元数据」，但 `syncDbPort.ts:293-301` `applyRemoteNoteMeta` 已写 `updated_at`（261026 后已修，文档未回填）。
  - HANDOFF 261026「移动端云清理无 UI 入口（设置页未接按钮）」，实际 `SettingsDrawer.tsx:316-319` 已接 `cleanCloud`。
  - HANDOFF §0 下一会话焦点② 列「移动端文本格式缺口（H5/H6、缩进、行高、清除格式、格式刷）」，但 `EditorDock.tsx:452-476`「更多」面板已有缩进三项/行高 6 档/格式刷；缺的是 H5/H6 与清除格式（需逐项核对）。
- 影响：接手者会重复调研或误判「还没做」，浪费一轮；更危险的是把已修项当欠账重做（例如再写一遍 updatedAt 落库）。
- 建议：① 激进：把上述 5 条就地回填 HANDOFF（一行一条，标注日期）；② 保守：至少修 `HomePage.tsx` 注释 + 待裁决① 的计数。
- 成本：S。
- 状态：**新发现**（文档漂移）。

### MOB-14 [P2] 197 处空 catch（其中 78 处仅注释「忽略」）

- 证据：`grep -rn "catch {" src/mobile --include='*.ts' --include='*.tsx' | wc -l` = **197**；带 `catch { /* … */ }` 注释的 78（读取 21:36）。分布集中在交互层（`MobileUsheetViewer` 12 处、`HomePage` 8 处、`NotebookWorkspace` 6 处、`EditorDock` 若干）——多为「命令 no-op / 内核 API 不可用」的合理兜底。
- 影响：内核/Univer API 变化时静默失败（移动端最常见的"点了没反应"），且没有一条可观测信号；排障只能靠人复现。对比桌面有 `reportNativeActionError` 与日志分级（`docs/LOGGING.md`）。
- 建议：① 激进：交互层 catch 统一走 `reportMobileActionError(action, error)`（debug 级进日志、user 级 toast），只保留"可预期 no-op"白名单；② 保守：只给表格/编辑器命令路径加一次 `console.warn` 带操作名。
- 成本：M（激进）/ S（保守）。
- 状态：**新发现**（HEAD 基线同在；但 197 里大部分是刻意兜底，按 AGENTS §3#17 不建议全量清）。

### MOB-15 [P2] 首屏预算没有护栏：preload 20 条 / 入口 CSS 436KB

- 证据：`dist-mobile/index.html`（21:31）：20 条 `modulepreload` + 入口 `mobile-*.js` 221KB + `mobile-*.css` 436KB（`wc -c`）；AGENTS §7#18 记录的目标是「modulepreload 45 → 12」；`package.json` 的 `check:bundle` = `check-bundle-budget.mjs` + `audit-vendor-css.mjs`（是否含 preload 计数本次未读，需另核）。
- 影响：preload 数从 12 涨到 20 说明又有重依赖从入口可达（`bridge` 276KB 里可能含 `@aws-sdk` 静态引用），冷启动要多下约 300KB；CSS 436KB 未压缩解析在低端机上是一次明显的样式计算成本（10 万文档量级的列表首屏更要紧）。
- 建议：① 激进：把「入口 preload ≤12 / 入口 JS gzip ≤80KB / 入口 CSS gzip ≤120KB」写进 `check-bundle-budget.mjs`（当前值作基线，只许降）；`bridge` 域改按需 `import()`（S3/AWS 只在同步路径）；② 保守：先加一条只报警不阻断的 preload 计数报告，定位是哪次提交把 12 变 20。
- 成本：S（护栏）/ M（拆 bridge）。
- 状态：**新发现**（数字来自并行会话构建，需在 HEAD 构建上复核）。

### MOB-16 [P2] 入口缺失（均为已登记的产品待裁决项，不重复论证）

- 证据/出处：移动端**无资源页**（缺正文/缺小记恢复）——HANDOFF §0 待裁决②；**无小记标签管理页**——HANDOFF §3#26 + `grep -rn "标签管理" src/mobile` 0 命中（桌面在 `QuickNotesWorkspace.tsx:997, 1054`）；**无数据导出/导入**——HANDOFF §3#4；**无表格导出/CSV 导入入口**——HANDOFF（「移动端没有表格导出入口」）。
- 影响：手机端遇到「正文文件被系统清掉」只能干等桌面端；标签改名/合并只能在桌面做；换机/迁移只能靠 S3。
- 建议：① 激进：做一个**移动资源/维护页**（复用 `core/missingBody.ts` 的 `missingBodyRecovery/missingQuickNoteRecovery` 判据，列表 + 3 个动作），入口 = 设置 → 资源管理（已有页签位）；② 保守：先只做「缺正文」列表 + 「从云端拉回」，入口挂在资源管理底部。
- 成本：M。
- 状态：**已定待裁决**（HANDOFF §0 ②，勿重提优先级，仅作为重构路线的前置）。

### MOB-17 [P2] 设置子页返回语义 & 设置读取不订阅

- 证据：`SettingsDrawer.tsx:169-178`（子页只有左上返回按钮，无 backStack）；`MobileApp.tsx:213-223`（自动快照定时器在挂载时读一次 `getHistorySettings()`，之后改设置要重启才生效）；`SettingsDrawer.tsx:61`（`probePinShortcut` 与 state 声明挤在同一行，格式债）。
- 影响：见 MOB-01 ③；快照间隔改了不生效，用户会以为「设了 0 还在拍快照」（或反之）。
- 建议：① 激进：`SettingsDrawer` 的 `view` 进 §2 的统一 overlay 栈；快照定时器订阅 `subscribeSettings` 重挂；② 保守：子页加 `pushBackHandler`，快照 effect 依赖一个 `historySettingsVersion` state。
- 成本：S。
- 状态：**新发现**。

### MOB-18 [P2] 安全/原生提纲（深度给 02 安全审计，此处只列证据）

- `android/app/src/main/res/xml/network_security_config.xml:4-6`：`base-config cleartextTrafficPermitted="true"` —— **全局**放行明文（注释说"开发版"，但配置进的是 release 包）；`capacitor.config.ts:13-16` `androidScheme: "http", cleartext: true`。合理范围其实只有 `http://127.0.0.1:19876`（AssetServer）与页面自身 origin。
- `AndroidManifest.xml:21, 50-61`：`MainActivity exported=true`（LAUNCHER 必需）+ `QuickNoteAlias exported=true`（自定义 scheme `lakexlocalnotes://quick-note`，**任何 App 都能拉起**并将内容写进小记草稿；当前只校验 URL 形状，见 `native/quickNoteShortcut.ts:108-117`）。
- `MainActivity` 新增 4 个 `addJavascriptInterface`（`lakeInsets/lakeDevice/lakeBoot/lakeSystemBars`）：只读标量，风险低；但 `AssetServer` 的 token 只在带 `Origin` 的 CORS 请求上校验（`AssetServer.kt:419-432`），本机其它 App 可直连 127.0.0.1:19876。
- `android/app/build.gradle:20-25`：release `minifyEnabled false`、无 `signingConfig`；`variables.gradle` targetSdk 36（强制 edge-to-edge，与工作树 `windowSoftInputMode=adjustResize` 需成对验证）。
- `file_paths.xml` 只暴露 `note-assets/`（FileProvider exported=false），`allowBackup=false` —— 这两项是干净的。
- 状态：**新发现（提纲）**；深度/定级请 02 安全审计裁定。

## 3. 删除/合并清单（可安全去除或合并，逐条给证据与风险）

| # | 对象 | 证据 | 风险 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | 表格 10 个置灰占位中的 5 个「插入」块（单元格图片/手写签名/附件/图表/批注） | `usheetChromeModel.ts:49-56` | 用户可能期望"置灰=将来会有" | 待裁决① → 建议合并成 1 个「更多能力」入口 |
| 2 | 同上：数据 2 + 视图 2 + 更多 1 | `usheetChromeModel.ts:169-209` | 同上 | 同上 |
| 3 | `MobileUsheetViewer` 的 4 处不可达 toast 分支 | `MobileUsheetViewer.tsx:391-392, 398, 402, 426` | 无（disabled 按钮不触发） | 直接删 |
| 4 | `NotebookWorkspace` 里重复三元（两个分支完全相同） | `NotebookWorkspace.tsx:576-578` | 无 | 直接删 |
| 5 | `runSync` 的陈旧依赖 `openTab`；`openDockPanel` 的未用依赖 `keyboardOpen` | `NotebookWorkspace.tsx:389`；`MobileUsheetViewer.tsx:289` | 无 | 直接删 |
| 6 | 移动端「附件大小上限」设置行（或接线） | `SettingsDrawer.tsx:201-208` 无消费者 | 用户已配的值仍在 localStorage | 先置灰，接线或删 |
| 7 | 移动端「定期清理间隔/保留天数」两行（或接调度） | `SettingsDrawer.tsx:299-307`，无调度 | 同上 | 接 `cleanupHistory` 空闲调度 |
| 8 | `bridge/notes.ts` 的 `cleanupHistory` 若长期无 UI 消费者 | `bridge/notes.ts:198-203` | `lakeNativeContract` 调试契约会缺一项 | 保留但加注释"仅供诊断/待接 UI" |
| 9 | 首页胶囊「AI 占位」注释 | `HomePage.tsx:771-776` | 无 | 改注释 |
| 10 | `poc-*` 遗留类名（`poc-center poc-error`） | `MobileApp.tsx:450` | 样式仍被 mobile.css 使用 | 改名（低优先，随错误页重构一起） |
| 11 | 5 处手写 sheet 骨架（icon/history/info/tag/createNotebook） | MOB-11 证据 | 迁移期可能改视觉 | 合并进 `MobileSheet`，走 `check:mobilesnap` 对拍 |
| 12 | 表格编辑面 7 个 state + 2 定时器（复制品） | MOB-07 | 需设备验证面板开合 | 复用 `useEditSurface` 后删 |

**不建议删**（已核对，避免误伤）：`mobile/board/MobileBoardViewer`（独立画板文档仍需只读/简单编辑）、`mobile/ink/*`（手写板文档在用）、`MobileHomeSkeleton`（冷启动骨架，与真实首页同构，防止整屏跳）、`testSetup.ts`（vitest 基础设施）。
## 4. 重构路线（分阶段，标依赖与门禁）

> 原则：先止血（返回键 / 设置谎报 / 删除残留），再合并原语，最后才碰编辑面几何。**任何阶段都不改内核/vendor，不动 USHEET 依赖版本。**

- **Phase 0（合入前，0.5d）**：把工作树在途的 261027 批次**成对**合入并复验——`windowSoftInputMode=adjustResize` × `useKeyboard` 两模式、`lakeBoot.ready` × 看门狗、`__lakeSetNativeInsets` × tokens.css、`recreate()` × 崩溃计数。门禁：`npx tsc --noEmit` + `check:mobilesnap --states home-quicknotes,home-doc` + `keyboard-toggle.mjs` + `edit-surface-invariants.mjs`。**这是唯一必须设备跑的阶段**（真机 + 模拟器各一次）。
- **Phase 1（S，1d）**：返回键止血（MOB-01 保守版 + MOB-17 子页）。改动面：`NotebookWorkspace` 1 个 effect、`MobileQuickNoteTagSheet`、`SettingsDrawer`、`NoteInfoSheet`。门禁：新增 vitest（jsdom 下 mock `@capacitor/app` 的 backButton，断言「抽屉开→返回只关抽屉且路由不变」）+ `check:mobilesnap --states home-doc,settings`。
- **Phase 2（M，2d）**：浮层原语与状态机（MOB-02 + MOB-11）。落点：`ui/MobileSheet.tsx` + `notebook/useWorkspaceOverlays.ts`；迁移 8 处。门禁：`check:mobileui`（cssLayers + ui-metrics 基线只许降）+ 走查受影响 5 屏（`notebook-workspace / doc-note-info / doc-history / notebook-icon-sheet / settings-同步设置`）。
- **Phase 3（S，0.5d）**：数据正确性三连——MOB-05 usheet normalize、MOB-06 purge 清资产、MOB-09 设置谎报。门禁：`usheetOpenReadOnly.test.ts` 扩 2 例、`bridgePurge.test.ts` 扩 1 例、新增 `settingsUsage.test.ts`（每个设置项必须至少一个读取点，或显式登记为桌面专属）。
- **Phase 4（M，2d）**：性能量化与预算（MOB-15 + MOB-04 保守版）。落点：`check-bundle-budget.mjs` 加 preload/入口字节基线；`boot-timeline.mjs` 增加长文档 DOM 计数探针；用探针数据再决定是否做 Phase 6。
- **Phase 5（M，2d）**：表格编辑面复用 `useEditSurface`（MOB-07）+ 删除死分支（MOB-10 视裁决）。门禁：装置新增 usheet 编辑/面板 2 屏（当前 23 屏里没有），`edit-surface-invariants.mjs` 扩表格 scope。
- **Phase 6（L，可选，3-5d）**：MOB-04 激进版（非 DOM 查找 + 开虚拟渲染）或 MOB-03 激进版（分页器 reducer）。**前置条件**：Phase 4 的探针证明长文档/分页器确有可测问题；否则按 AGENTS §3#17 不做。

依赖：Phase 1/3 可并行（文件不重叠）；Phase 2 必须先于 Phase 5（表格 sheet 迁移依赖 MobileSheet 原语）；Phase 6 依赖 Phase 4 的数据。

## 5. 度量与复测方法（以后怎么证明改好了）

### 5.1 已有门禁（每阶段必跑）

```bash
npx tsc --noEmit && npx vitest run && git diff --check          # 每次改动
npm run check:mobileui                                          # 改样式/新增面板
node scripts/mobile-audit/check-mobile-snap.mjs --states home-quicknotes,home-doc   # 动外壳/面板
bash scripts/emu-cdp.sh 9336 && node scripts/css-audit/drive.mjs 9336 scripts/css-audit/mobile-walkthrough.mjs   # 走查屏
node scripts/mobile-audit/keyboard-toggle.mjs && node scripts/mobile-audit/edit-surface-invariants.mjs   # 动编辑面
node scripts/mobile-audit/boot-timeline.mjs --no-idle           # 动入口/懒加载
```

设备前置：专用 AVD `lake_gate`（emulator-5556 / CDP 9336）+ 固定夹具（5 文档 + 4 小记），重灌夹具后先重烤基线（`--from <warm>.json --write-baseline`，别用 `--states` 覆盖）。

### 5.2 新增判据（缺一门禁就等于没改）

| 结论 | 复测手段（可执行） |
| --- | --- |
| MOB-01/02/11 返回键与浮层 | 新走查屏 `workspace-drawer / workspace-outline / workspace-tabs / qn-tag-sheet`：打开浮层 → `Input.dispatchKeyEvent(key=KEYCODE_BACK)` → 断言「浮层 `.on` 消失 / `.mb-menusheet` 卸载」且 `.mobile-workspace` 仍在 DOM、`location` 未变；首页标签面板 → 断言 App 未退出（`adb shell pidof` 仍在） |
| MOB-03 分页器 | 走查加一屏 `home-pager`：点 tab → 读 `scrollLeft` 与 `.mobile-htab.active`；连续 10 次快速点 tab + 1 次手势横滑，断言最终 tab 与 `scrollLeft/clientWidth` 四舍五入一致（0 次错位） |
| MOB-04 长文档 | 新探针 `long-doc-dom.mjs`：注入一篇 500 块/200 图文档 → 量 `document.querySelectorAll('*').length`、`Page.metrics()`（JSHeap/节点数）、首屏资产请求数；开/关 `disableVirtualRendering` 做 A/B，两组都记录（基线只许降） |
| MOB-05 usheet 方言 | 单测：同一 workbook 在桌面与移动两条序列化路径上 `usheetToBody` 输出**逐字节相同**（对拍走 `docs/USHEET-UPGRADE.md` playbook 的静态护栏） |
| MOB-06 purge | 设备脚本：`adb shell run-as com.lakexlocalnotes.android ls files/note-assets/<id>` 在 purge 前后对比，期望「目录不存在」；同时 `bridgePurge.test.ts` 断言 `deleteAssetsDir` 被调 |
| MOB-09 设置谎报 | 新护栏 `src/mobile/settings/settingsUsage.test.ts`：解析 `lib/settings.ts` 的 `AppSettings` 键 → 每个键必须在 `src/mobile/**`（或显式桌面专属清单）有读取点，否则失败（与桌面 `settingsSearch.test.ts` 同构） |
| MOB-15 首屏预算 | `check-bundle-budget.mjs` 加三条断言：入口 `modulepreload` 数 ≤12、入口 JS gzip ≤80KB、入口 CSS gzip ≤120KB（当前 20 / 69KB / 138KB ⇒ CSS 先降 18KB 或抬基线并写明） |
| MOB-12 标签恢复 | `tabRestore.test.ts` 补三例：首挂不覆盖存档、恢复 8 标签顺序稳定、`clearTabsOnExit` 时清档后恢复为空 |

### 5.3 不能在本机实测、需设备/真机的项（明确标注）

| 项 | 原因 | 替代判据 |
| --- | --- | --- |
| 冷启动秒数（当前 HEAD 构建） | 禁跑构建；`dist-mobile` 是并行会话 21:31 的产物 | 以 `boot-timeline.mjs` 在 HEAD 构建上复测；文档记录的目标值 533ms（AGENTS §7#18）只作参照 |
| 首拉 600 篇 / 2 万文档阈值 | 需真机 + 真实桶 | 沿用 HANDOFF 261027 数字（600 篇 9.7s）并注明非本次实测 |
| 长文档 DOM/内存 | 需设备 + 造数据 | 见 5.2 的 `long-doc-dom.mjs` 方案（待实现） |
| 键盘/IME 几何（adjustResize × edge-to-edge） | 需真机（模拟器恒 adjustResize） | `keyboard-toggle.mjs` + `edit-surface-invariants.mjs`，且必须记录机型与 ROM |
| 返回键/浮层交互 | 需 Capacitor 插件（Web 预览无 backButton） | 只能设备（CDP `Input.dispatchKeyEvent`）或 jsdom mock |

## 附：审计期间观测到的并行改动（供 lead 判断合入顺序）

- 21:29 工作树 49 个改动 → 21:33 54 个（`git status --porcelain | wc -l`）；`src/mobile` 占 27 项。
- 21:30:49 `src/mobile/main.tsx` 新增 `lakeBoot.ready()`（此前读取里没有，见 MOB-08）；21:30:12 `MainActivity.kt` 加入看门狗/insets/tablet/recreate。
- 21:31 `dist-mobile` 被并行会话重建（`index.html` 与 assets 时间戳一致）。
- 本轮**未**修改任何源码/配置/依赖；唯一写入 = 本文件。



---

## 修复状态（261028，见 `08-ab-execution.md`）

> 261028 晚复核：**删除原表前半的批量「未做」行**（与后半逐条 ✅ 自相矛盾）；逐条按工作树代码判定。
> 采样 = 2026-10-28 21:15–21:30（Asia/Shanghai）；完整对账见 `13-audit-status.md` §1。

| 条目 | 状态 | 证据（文件 : 符号）与残余 |
|---|---|---|
| MOB-01 | ✅ 已修 | 工作区 9 类浮层 + 首页标签面板 + 设置子页登记返回栈；`src/mobile/hooks/useBackHandler.ts` 浮层栈提到 capture 前（08 §1） |
| MOB-02 | ✅ 已修（第六轮） | `useWorkspaceOverlays` 单 owner（open 即互斥、载荷随值、返回栈按 kind）；`NotebookWorkspace` 派生渲染；`treeActions` 只留数据动作 |
| MOB-03 | ✅ 已修（第七轮） | `home/tabPager.reducePager`（7 事件纯函数）+ `useTabPager` DOM 层；删 4 份镜像 ref 与 600ms 定时器（无 scrollend 老机留单次兜底）；reducer 9 例 |
| MOB-04 | ✅ 已修（261029：查找接内核 + 虚拟渲染开启） | 移动端查找改「内核优先」：`editor._$commandUnderlay._renderer.getService({value:'ISearchService'})` → `onSearch` → `count`/`jumpTo`（与桌面工具栏查找同源；取不到降级 DOM）。因此编辑态**打开内核虚拟渲染**（`disableVirtualRendering:false`）并接真实 `scrollNode`（getter 取 `.mobile-doc-body`）。A/B（lake_gate，500 块/200 图）：编辑节点 **5552→2197**、进编辑墙钟 **5117→2102ms**（TaskDuration 3351→342ms）；只读/打开耗时不变。设备复验：查找 **1/300**（内核红/黄高亮）、`jumpTo(299)` 滚动生效、编辑态输入真实写入正文、滚动后卡片按需水合（4/4 img loaded）、`edit-surface-invariants.mjs` 全 ok；6 态快照 0 差异 |
| MOB-05 | ✅ 已修 | `src/mobile/usheet/MobileUsheetViewer.tsx`：L37 import、L253 capture、L514 挂载、L550 基线四处 `normalizeUsheetWorkbook`；护栏 `usheetOpenReadOnly`/`usheetDoc` 跨端逐字节相同；AGENTS §4 已同步 |
| MOB-06 | ✅ 已修 | purge 清 `note-assets/` / `quick-notes/assets/`（+5 例回归） |
| MOB-07 | ✅ 已修（第七轮） | `useEditSurface` 泛型+参数（默认=文档）；表格接同一 hook（注释点名 MOB-07），删 7 state+2 定时器；补齐面板⇄键盘互斥测试 |
| MOB-08 | ✅ 已修（第五轮） | 可处置错误页：重试 init / 复制诊断 / 清派生缓存后重试（复用现有桥，无新原生 API）；错误分支优先于骨架 |
| MOB-09 | ✅ 已修（第五轮） | 附件上限读 `loadSettings().maxAttachmentBytes`（夹 100MiB）；新增低频历史清理（`device_state` 记时，默认 24h、0=关，就绪/回前台触发，capture 跳过） |
| MOB-10 | 🚫 延期（用户裁决「保留待议」） | 用户 261028 裁决：表格置灰 10 项先保留、后续讨论（表格端优化原计划被 S3-v3 中断）；4 处不可达死分支可无视觉变化地单独删。**不是「未做」** |
| MOB-11 | ✅ 已收口（迁移 11 处 + 6 组例外登记） | `ui/MobileSheet` 原语；已迁移 NoteInfo/TagSheet/CreateNotebook/Search/工作区图标/历史/DocList/Outline（底部形态）/bitable 字段与记录/首页图标，共 **11 处**；剩余 6 组 / 8 文件（AI×3、CreateSheet、PickerSheet、MobileAiPage/ConfirmDialog/MobileSheetMenu）逐处判定「结构/语义不同 ⇒ 不迁」，理由登记 `docs/MOBILE-SHEET-EXCEPTIONS.md`（+ MOBILE-DESIGN 指针）；顺带修 `MobileAiPage` 附件 ActionSheet 缺 `pushBackHandler`（真实返回栈洞）+ 护栏 |
| MOB-12 | ✅ 已修（第五轮） | `useNotebookTabs.restore(ids,activeId,{enterEditor})` 一次 dispatch；首挂 initial state 读存档，删 `firstPersistRef`；`clearTabsOnExit` 语义不变 |
| MOB-13 | ✅ 已修（第八轮） | 注释漂移 4 处；`ARCHITECTURE.md`/`TROUBLESHOOTING.md` 过期描述更新（08 §16-5） |
| MOB-14 | ✅ 已销账（当前树口径） | **口径更新**：审计的 197 catch / 78 处「忽略」是 261027 数字；当前树 AST 实测 **279 catch / 空 catch 85→80**。本轮新接 `reportMobileActionError` 5 处（累计 **28 个上报点**；定义 `src/mobile/lib/reportMobileActionError.ts`），22 处「忽略」改成真实理由，**剩余 80 处全部带理由**；登记 `docs/MOBILE-EMPTY-CATCH-LEDGER.md` + 护栏 `src/mobile/lib/emptyCatchGuard.test.ts`（新空 catch 直接红） |
| MOB-15 | ✅ 已加（第五轮；261029 预算对齐） | `check-bundle-budget.mjs`：移动入口 preload≤**23**（按当前树实测；用户 261029 接受；目标仍 12）/JS gzip≤80KB/CSS≤138KB（目标 120KB）；本批 `SearchSheet` 改按需加载净 −1。**目标 12/120KB 未达**（登记为达标另项） |
| MOB-16 | 🚫 已裁决**不做**（261029 用户） | 移动资源页/标签管理/导出导入入口：用户裁决不做，不再跟踪（判据仍在 core `missingBody`，未来若要可复用） |
| MOB-17 | ✅ 已修（第八轮） | 历史设置保存后广播、自动快照按新间隔重挂（含竞态守卫）；设置子页返回栈复核通过 |
| MOB-18 | ➖ 已裁决：**并入 SEC、不单独跟**（261029 用户裁决） | 实质问题归 SEC-08（cleartext/mixed-content）与 SEC-09（JS 桥/data:blob:），由 02 的安全专项批次统一处置；本表不再单独跟踪 |
| MOB-04 为 DOM 查找关虚拟渲染 | ◐ 已量化（261029），暂不切换 | 设备 A/B：编辑态节点 5552→2202、进编辑 TaskDuration 3351→767ms（−77%）；但自研查找依赖全量 DOM ⇒ 先改查找再切。探针已修（`<ne-p>` 自定义元素口径 + 按可见入口导航） |