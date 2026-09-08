# 移动端 UI 全面审计 · 对齐思源（260908）

> 目标（用户原话）：移动端 UI 全方位对齐思源——**动效、手势、弹窗、图标**等；**第二层（工作区/编辑）要做到"几乎一模一样"**，
> 第一层（小记/知识库）参照思源风格；两端（桌面/移动）风格统一。
> 方法：① 读 `siyuan-master/app/src/assets/scss/main/_mobile.scss` + `assets/template/mobile/index.tpl` + `src/mobile/util/*` 取"口径"；
> ② 本机 Electron(Chromium) 390×844 harness + 裸 CDP 驱动真实移动 bundle 逐屏截图实测（见 §6）；③ 比对 `src/mobile/**` 代码。
> 约束：AGENTS §3 #14（思源版式语法、禁内联样式）、#16（打开文档守卫）、HANDOFF §2.1（横向 tab 用底部指示线）。

---

## 1. 思源的移动端口径（可核对的事实，含出处）

**骨架 DOM**（`app/src/assets/template/mobile/index.tpl`）：
`.mobile-safe-area` → `#mobileTopBar.toolbar.toolbar--border.mobile-topbar`（`input.toolbar__title#toolbarName` + `#toolbarSync`）
→ `#editor` / `#empty.b3-list--mobile` → `#sidebar.side-panel` / `#sidebarRight.side-panel--right`
（头 = `.toolbar--border` 里一排 `svg.toolbar__icon` 的 **dock 图标** + 末尾 `#iconRight/#iconLeft` 箭头关闭；体 = `.b3-list--mobile`）
→ `#menu.b3-menu.b3-menu--fullscreen`（主菜单）→ `#model.side-panel--all`（tab 列表：头 = `#iconMenu` + `.toolbar__text` + `#modelClose(iconCloseRound)`）
→ `#commonMenu.b3-menu`（浮层菜单）+ `#commonMenuScrim` → `#message.b3-snackbars`（提示）
→ `#status.status`（24px 进度条）→ `#mobileBottomBar.mobile-bottom-bar`（**纯图标 5 槽**）→ `#keyboardToolbar.keyboard`（编辑工具栏）→ `.side-mask`。

**度量与令牌**（`main/_mobile.scss:4-24`）：
`--mobile-topbar-height:48px`、`--mobile-breadcrumb-height:42px`、`--mobile-bottom-bar-height:48px`、`--mobile-status-height:24px`、
`--mobile-bottom-bar-gap:8px`、`--mobile-top-safe-area:env(safe-area-inset-top)`（Android 置 0）、
`--mobile-bar-translate-y/--mobile-bar-opacity`（键盘/滚动联动）、`body.mobile-keyboard--open` 时 `--mobile-bottom-bar-offset:0`。

**控件口径**：
| 件 | 思源 | 出处 |
|---|---|---|
| 图标按钮（栏内） | `.toolbar__button` 48×48，`svg` 20×20，`color:--b3-theme-on-surface`，`:active/:focus-visible` = `--b3-list-hover`，圆角 `--b3-border-radius` | `_mobile.scss:207-233` |
| 侧栏 dock 图标 | `.toolbar__icon` 18×18 + padding 11 + margin 2（=40 热区），激活 `toolbar__icon--active` | `_mobile.scss:306-330` |
| 列表行 | `.b3-list--mobile .b3-list-item`：**font-size 16 / line-height 40**，`__graphic` 18×18 + `margin-inline-end:8px`，`__action` 20×20，移动端 **hover 不给底色**（`:hover{background:transparent!important}`，只留 `:active`） | `_mobile.scss:66-143` |
| 计数徽章 | `.counter`：`--b3-theme-background-light` 底 + `--b3-border-radius` + 16px/24px | `_mobile.scss:145-156` |
| 底部胶囊栏 | 宽 `min(100%-32px, 48px*6)`、高 48、`.5px` 边框、`radius=高/2`、`box-shadow:--b3-point-shadow`；项 = **纯图标**（`aria-label`+`title`），`:active` = `--b3-list-hover` + `scale(.92)`，`transition: color/background/transform 80ms ease`；tab 计数用 `.toolbar__tabs-count`（18×18、1.25px 描边、radius 4） | `_mobile.scss:402-499` + `mobileBottomBar.ts:118-168` |
| 键盘/选区时 | 底部栏 `opacity:0 + translate3d(0,100%,0) + visibility:hidden`（**下滑隐藏**，不是直接消失） | `_mobile.scss:532-537` |
| 侧栏面板 | `.side-panel` 100vw、`z7`、`transform:translateX(±100vw)`、`transition:transform .15s cubic-bezier(0,0,.2,1)`；`.side-mask` `#000` `transition:opacity 150ms linear`；**跟手拖拽时加 `.side-panel--swiping`/`.side-mask--swiping` 关掉 transition** | `_mobile.scss:684-741` + `util/touchPanelGesture.ts` |
| 手势 | 横向滑动** anywhere**（非仅边缘）：轴锁定（阈值 `SIZE_DRAG_THRESHOLD`）→ 右滑开左栏/左滑开右栏；面板**跟手位移** + 遮罩透明度联动；支持反向（reversing）；释放阈值 `|dx| > innerWidth/3`；右滑同时可关全屏菜单；纵向滚动优先、横向可滚容器内不触发 | `util/touch.ts:235-340,470-600` |
| 长按 | 定时器 + 位移阈值（`SIZE_DRAG_THRESHOLD`）判定，命中后进入块选择/菜单 | `util/touch.ts:370-430` |
| 全屏菜单 | `.b3-menu--fullscreen`：`top:100%` + `transform` 上滑 `.15s cubic-bezier(0,0,.2,1)`；标题栏 48.5px（`#iconLeft` 返回 + 标题）；项 `line-height:36px` + `.5px` 分隔（`--b3-theme-background-light`）、**无圆角**；子菜单 = 整屏横向平移 `translateX(-100%)`；危险项 `.b3-menu__item--warning` = `--b3-theme-error` | `_mobile.scss:741-1163`、`component/_menu.scss:38-120` |
| 对话框 | `.b3-dialog`：scrim `--b3-mask-background` + `opacity 150ms linear`；容器 `scale(.8)→none` + `opacity 75ms / transform 150ms cubic-bezier(0,0,.2,1)`、`radius --b3-border-radius-b`、`--b3-dialog-shadow`、头 9px/24px 16px/500、体 padding 16/24、脚右对齐 | `component/_dialog.scss` |
| 提示条 | `.b3-snackbars` 固定右上（`right:30px; top:22px`）**横向滑入** `translate3d(calc(20vw+48px),0,0)→0`，`.15s`；错误项左侧加 ❗；容器 `--b3-tooltips-background` + `--b3-tooltips-shadow` | `component/_snackbar.scss` |
| 编辑工具栏 | `.keyboard`：`position:fixed;bottom:0;height:48px;background:--b3-theme-background;border-top:1px solid --b3-theme-surface-lighter`（**贴底直条，不是悬浮胶囊**） | `_mobile.scss:1166-1180` |
| 空状态 | `#empty.b3-list--mobile`：居中 `.b3-list-item`（宽 200px）当动作按钮 | `_mobile.scss:1316-1328` |
| 关键帧 | `fadeIn` / `zoomIn(scale .9→1)` / `bottom2Top(translateY(60px)→0)` / `rotate` | `util/_keyframes.scss` |

---

## 2. 现状：移动端有**两代**样式并存

| 世代 | 文件/类 | 令牌 | 用在哪 |
|---|---|---|---|
| 新（思源口径） | `mobile.css` 里 `.mobile-bottom-bar/.bottom-bar-btn`、`.side-panel/.side-mask`、`.mobile-model*`、`ln-tree-icon/ln-chevron`；`SettingsDrawer` 的 `.config-*/.b3-*` | `--b3-*` | 第二层骨架、设置页 |
| 旧（POC 自研） | `.mobile-drawer*`、`.mobile-sheet*`、`.mobile-toast`、`.mobile-dropdown*`、`.mobile-qcard`、`.mobile-nb-*`、`.mobile-fab*`、`.mobile-doc-row`、`.mobile-qn-*`、`.mobile-htab`、`.med-*` | `--lake-*` + 硬编码 rgba/hex | 第一层、全部弹层、编辑 dock |

⇒ 同一个"弹层"概念在移动端有 **4 种写法**（`.mobile-sheet` 底部卡片 / `.mobile-dropdown` 锚定浮层 / `.mobile-model` 底部 80% 面板 / `.side-panel` 全屏抽屉），
既不像思源，也和桌面（`overlays.css` 的 `ln-*` + `floating-dialog`）不一致。

---

## 3. 审计发现（P0=破坏一致性或明显 bug；P1=观感/手感不对齐；P2=收尾）

### A. 结构/信息架构
1. **P0 文档有两套壳**：`NotebookWorkspace`（第二层，有底部栏/抽屉/手势）与 `DocumentPage`（首页/搜索打开文档走这条：只有顶栏 4 图标 + 蓝底"完成"按钮，无底部栏、无抽屉、无边缘手势）。同一个文档两种形态 ⇒ 先统一：**所有打开文档入口都进第二层工作区**，`DocumentPage` 退化为工作区内的一个 pane。
2. **P1 侧栏头不是思源的 dock 图标行**：我们是 `side-panel-title` + `+` + `X`；思源是 `.toolbar--border` 一排 `.toolbar__icon`（文档树/书签/标签/收集箱）+ 末尾箭头关闭（左栏 `iconRight`、右栏 `iconLeft`）。
3. **P1 底部栏带中文标签**：思源是纯图标 5 槽（`aria-label`+`title`）。我们 4 槽图标+10px 标签，视觉密度与思源不同。
4. **P1 顶栏居中标题 + 返回箭头**：思源顶栏是**左对齐可编辑标题**（`input.toolbar__title`，17px）+ 右侧同步状态图标；返回靠系统返回键/右滑。我们的标题是笔记本名（不可点），编辑态标题又变成正文区第一行的 `input.mobile-title-input`（贴左无留白）⇒ 标题出现 3 处、口径不一。
5. **P2 死代码**：`notebook/NotebookPage.tsx` 组件无人渲染（只被 import 了类型）；`HomePage` 收到 `onCreateNote` 但从未使用（知识库页缺"新建文档"入口）。

### B. 弹层与对话框
6. **P0 用原生 `window.confirm`**：`MobileApp.tsx:264`（移入回收站）、`settings/TrashList.tsx:56`（彻底删除）。安卓上是**系统对话框**，与全局风格断裂，且无法定制危险操作样式。→ 换 `.b3-dialog` 口径的确认框（`--b3-theme-error` 强调 + scale-in）。
7. **P0 Toast 不是思源口径**：`.mobile-toast` = 居中黑色胶囊、无进出动效、无错误态。思源 = `.b3-snackbars` 右上滑入 + 错误 ❗。
8. **P1 长按菜单是"锚定小浮层"**：`NotebookWorkspace` 的 `ctxMenu` 用 `.mobile-dropdown`（跟随手指位置、`min-width:160`、圆角+阴影）。思源移动端长按/更多一律 **`.b3-menu--fullscreen` 上滑全屏菜单**（48.5px 标题栏 + 36px 行 + `.5px` 分隔 + 返回箭头）。
9. **P1 弹层动效语言 4 套**：`mobile-fade-in`（设置页 180ms）、`mobile-sheet-in`（280ms）、`mobile-drawer-in`（260ms）、`mobile-dropdown-in`（140ms）、`.side-panel`（150ms cubic-bezier(0,0,.2,1)）。思源只有三种：**面板 150ms cubic-bezier(0,0,.2,1)**、**dialog scale .8→1 / 150ms**、**snackbar 滑入 .15s**。
10. **P2 遮罩色不统一**：`.side-mask` 用 `#000`+opacity（思源同），但 `.mobile-sheet-mask/.mobile-model-mask/.mobile-drawer-mask` 用 `rgba(0,0,0,.4/.45)` 硬编码 → 应统一 `--b3-mask-background`。

### C. 手势
11. **P0 抽屉不跟手**：`useEdgeSwipe` 只在位移 >48px 时**触发一次开合**，面板从 `translateX(±100vw)` 直接跑 150ms 动画；思源是**手指拖动面板实时位移 + 遮罩透明度联动 + 可反向取消 + 释放阈值 `1/3 屏宽`**。手感差距最大的就是这里。
12. **P1 触发区口径不同**：我们限屏幕边缘 24px；思源是内容区任意横向滑动（轴锁定 + 横向可滚容器/输入区豁免）。
13. **P1 两个抽屉可同时打开**：底部栏按钮 `setSidebarOpen(v=>!v)` / `setOutlineOpen(v=>!v)` 互不排斥（实测 `.side-panel--left.on` 与 `--right.on` 同时存在，两层 100vw 面板叠在一起）。
14. **P1 打开的抽屉不能滑走关闭**：只能点遮罩；思源在面板内右滑即关。
15. **P2 无触感反馈**：长按/删除/切换 tab 均无 `navigator.vibrate`（安卓上思源长按有震动语义）。
16. **P2 长按判定各自实现**：`NotebookGrid`（600ms + `dataset.longPress`）、`NotebookWorkspace`（`startLongPress`）、`onContextMenu` 兜底 —— 三套；且 `NotebookGrid` 用 `draggable` 拖排（桌面语义），触屏上其实进的是"长按排序模式"。

### D. 图标
17. **P1 图标尺寸 5 档混用**：实测 `size={24|22|21|20|19|18|17|16|14}`；思源口径只有 **20（栏内）/18（列表 graphic、侧栏 dock）/16（按钮内）**。
18. **P1 图标热区不统一**：`.mobile-icon-btn` 44×44、`.bottom-bar-btn` 48 高、`.med-btn` 42 高、`.toolbar__button` 口径 48×48 ⇒ 统一 48（窄栏内 40）。
19. **P2 语义符号用文字代替图标**：编辑 dock 的 `Aa`/`B` 是文本；`完成` 是蓝底文字按钮（`.mobile-done-btn`）——思源是图标 + `aria-label`。
20. **P2 lucide 直挂 svg 的 className 坑**（HANDOFF §4）：`<X size={20} className="b3-list-item__action" />` 这类写法在 `.b3-list-item__graphic svg` 选择器下不命中，需 `<span class="b3-list-item__graphic">` 包一层（`SettingsDrawer` 已包，`NotebookWorkspace` 未包）。

### E. 动效
21. **P0 `.med-toolbar { transition: bottom .18s ease }` 仍在**：HANDOFF §8.8 明确"对正在 resize 的视口做 bottom 动画 = 把一帧错位放大成抖动，已删"。代码里没删 ⇒ 键盘收起时工具栏会跟着爬。
22. **P1 未用共享动效令牌**：`src/styles/motion-contract.css` 的 `--lake-motion-fast/standard/panel` + `--lake-ease-standard` 移动端一处没用；时长散落（80/90/120/140/150/180/200/240/260/280ms）。
23. **P1 reduced-motion 只覆盖 6 个类**：`.side-panel/.mobile-model/.med-panel/.mobile-dropdown/.bottom-bar-btn/.ln-chevron` 的动画/过渡未纳入 `@media (prefers-reduced-motion: reduce)`。
24. **P2 列表出现桌面 hover 语义**：`.mobile-dropdown-body .b3-list-item`、`.mobile-model-body .b3-list-item` 在触屏上保留 hover 底色（思源移动端显式 `:hover{background:transparent!important}`）。
25. **P2 滚动条裸露**：`.side-panel-body/.mobile-sheet-body/.mobile-doc-body/.med-panel` 未隐藏滚动条（思源移动端统一 `::-webkit-scrollbar{display:none}`）。

### F. 色彩/排版/深色
26. **P1 旧世代仍走 `--lake-*` + 硬编码**：`.med-btn:active{rgba(0,0,0,.06)}`、`.mobile-qn-img button{rgba(31,35,41,.65)}`、`.mobile-fab{box-shadow:rgba(53,117,240,.35)}`、`.mobile-toast{rgba(0,0,0,.78)}`、`.mobile-nb-cover{box-shadow}` 等，深色主题下会脏/糊。→ 全部改 `--b3-*`（`--b3-list-hover`、`--b3-mask-background`、`--b3-select-shadow`、`--b3-point-shadow`、`--b3-dialog-shadow`）。
27. **P1 列表行不符合思源密度**：`.side-panel-body .b3-list-item` 用 `padding:10px 0`（≈40px 高但字号 14），思源是 **font-size 16 / line-height 40**；`.mobile-doc-row` 14px padding（≈48 高）。
28. **P2 字号阶梯与桌面不一致**：移动端标题 16/17、正文 15、meta 12；思源 `--b3-font-size*` 有统一口径，且 `.protyle-font` 移动端 14px。
29. **P2 卡片阴影不是思源语言**：`.mobile-qcard/.mobile-nb-cover/.mobile-fab/.med-toolbar/.med-panel` 用自造 `box-shadow`；思源浮层用 `--b3-dialog-shadow/--b3-point-shadow/--b3-select-shadow`，列表/卡片用描边（`.mobile-tabs__item` = 1px `--b3-border-color` + `--b3-border-radius-b`）。

### G. 第一层（小记 / 知识库）
30. **P1 横向 tab 三处三样**：`.mobile-htab`（选中=加粗黑字，无指示线）/ 桌面 `.ln-tabs`（轨道 hairline + 主色字 + 2px 下划线，HANDOFF §2.1 定稿）/ `overlays.css` 的 `.seg`。→ 移动端首页 tab 收进 `.ln-tabs` 口径。
31. **P1 笔记本宫格 = 自创卡片**：3 列 3:4 白卡 + 蓝图标 + 阴影；思源是 `.b3-list-item` 行（图标 18 + 名称 + `.counter` 文档数 + 右箭头）。用户说第一层"参照思源风格" ⇒ 改成**列表行 + 计数**（保留长按排序，但排序态用思源的 `.b3-list-item__action` 手柄 + 全屏菜单确认）。
32. **P1 小记卡片 = 白卡 + 阴影 + 圆角 12**：思源没有这种卡（`#empty`/`.b3-list--mobile` 都是平铺行）。→ 平铺行：首图缩略 40×40 圆角 2、正文 1 行省略 + 时间 meta、`:active` 用 `--b3-list-hover`。
33. **P2 FAB 蓝圆 + 阴影**：思源移动端无 FAB（新建走底部栏 `newDoc` 槽或全屏菜单）。→ 底部栏加"新建"槽 + 长按弹"新建文档/新建知识库"全屏菜单；FAB 撤掉（或保留但改 `--b3-*` 描边胶囊）。
34. **P2 空状态只有一行灰字**：思源是居中的动作列表（可点）。→ `.b3-list--mobile` 空态 + 动作按钮（新建文档 / 从模板 / 同步）。

### H. 编辑器（第二层正文）
35. **P1 编辑工具栏是悬浮胶囊**：`.med-toolbar` `left/right:10px` + 圆角 14 + 阴影；思源 `.keyboard` 是**贴底 48px 直条 + 上边框**。
36. **P1 插入/字体面板是"覆盖键盘区"的圆角卡**：`.med-panel` 圆角 14 + `border .5px`；思源是贴底面板、`--b3-theme-background`、行内 `.toolbar__icon`。
37. **P2 正文无占位符**：空文档只剩光标；思源空块有"输入 / 唤起更多"占位（我们可用 Lake 的 placeholder 或自绘首行提示）。
38. **P2 标题输入贴左无留白**（实测截图）：与正文 14px 留白不齐。

---

## 4. 实施批次（每批：改动面 → 门禁 → 截图验收）

**实施状态（260908）**：B1 ✅ `7d6d676` · B2 ✅ 同提交 · B3 ✅ `b2bfaf5` · B4 ✅ `9816e0a` · B5 ✅ `92f2e23` · B6 ✅ `ad75a57`（贴底直条 + 标题只在顶栏）。
**未做（下一批）**：B7 = `SearchSheet`/`CreateNotebookSheet`/图标选择器/历史 sheet 收进 sheet 菜单语言 + 设置页改 `#model` 右滑；B8 = dock 文字图标化（`Aa`/`B`）、面包屑行（思源 `.protyle-breadcrumb` 42px）、空块占位符、`.mobile-sheet` 旧类清理；
**验证缺口** = B4 跟手手势/B2 触感/B6 键盘态需在安卓模拟器与真机复验（本机 Electron harness 已验证逻辑与像素）。

| 批次 | 内容（对应发现编号） | 主要文件 |
|---|---|---|
| **B1 令牌与度量统一**（低风险、纯 CSS） | 21,22,23,25,26,27,29,10,17,18：引入 `--mobile-*` 度量块 + 全量 `--b3-*` 化 + 图标/热区/密度统一 + reduced-motion 全覆盖 + 隐藏滚动条 + 删 `transition:bottom` | `mobile.css`、`editor-dock.css`、`mobile-theme.css` |
| **B2 弹层三件套**（思源口径） | 6,7,8,9,24：新增 `MobileMenu`（`.b3-menu--fullscreen`）、`ConfirmDialog`（`.b3-dialog`）、`Toasts`（`.b3-snackbars`）三个共享组件，替换 `window.confirm`/`.mobile-toast`/`.mobile-dropdown` 长按菜单/`.mobile-sheet` 系；统一进出动效为 150ms cubic-bezier(0,0,.2,1) | 新 `src/mobile/ui/*`、`MobileApp.tsx`、`NotebookWorkspace.tsx`、`TrashList.tsx`、`SearchSheet/CreateNotebookSheet/OutlineSheet/DocListSheet` |
| **B3 第二层骨架对齐** | 1,2,3,4,13,14：文档入口统一进工作区（废 `DocumentPage` 独立壳）；侧栏头改 dock 图标行 + 箭头关闭；底部栏纯图标 + `.toolbar__tabs-count` + 键盘/选区下滑隐藏；顶栏改左对齐标题 + 同步状态；左右面板互斥 | `MobileApp.tsx`、`NotebookWorkspace.tsx`、`DocumentPage.tsx`、`mobile.css` |
| **B4 手势引擎** | 11,12,15,16：实现思源 `touchPanelGesture` 口径的**跟手开合**（轴锁定、reversing、1/3 屏宽阈值、`--swiping` 关动画、遮罩联动）+ 统一长按 hook + 触感反馈；全屏面板右滑关闭 | 新 `src/mobile/usePanelDrag.ts`、`useLongPress.ts`，替换 `useEdgeSwipe` |
| **B5 第一层对齐** | 30,31,32,33,34,5：首页 tab 进 `.ln-tabs` 指示线口径；笔记本改列表行 + 计数；小记改平铺行；FAB → 底部栏"新建"槽 + 长按全屏菜单；空态动作列表；清理 `NotebookPage` 死代码与未用 prop | `HomePage.tsx`、`NotebookGrid.tsx`、`QuickNoteComposer.tsx`、`mobile.css` |
| **B6 编辑器 dock 与正文** | 35,36,37,38,19：`.keyboard` 贴底直条口径 + 面板贴底 + 图标化（去 `Aa`/`B` 文字）+ 标题进顶栏 + 空态占位 | `EditorDock.tsx`、`editor-dock.css`、`DocumentEditor.tsx` |

**验收口径**：每批跑 `tsc` + `vitest` + 双端 `vite build`；用 §6 harness 出 before/after 截图；B2/B3/B4 需在安卓模拟器（`scripts/emu-cdp.sh`）复验一次真实触摸手感（跟手拖拽、震动、IME）。
**红线**：不碰 `src/b3/siyuan/**` 之外的 vendored 组件语义（AGPL 署名保持）；`--b3-*` 令牌优先；不新增依赖；不动同步/数据层。

---

## 5. 顺手要修的文档漂移（与本审计同源）
- AGENTS §3 #14 末句"横向 tab 一律分段控件"与 HANDOFF §2.1"最终用底部指示线"冲突 ⇒ 以 HANDOFF（用户两轮反馈定稿）为准，改 AGENTS。
- AGENTS §7 #13"better-sqlite3 是 Electron ABI 编译，系统 Node 24 跑不了"与 README/§4"N-API 单二进制"冲突（Electron 43 升级后已作废）。
- HANDOFF §5 第 2 条仍推荐"§3.2 快照 gzip 异步化"（§3 已判定不做）。

## 6. 验证 harness（本会话实测可用）
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
node node_modules/vite/bin/vite.js -c vite.mobile.config.ts --host 127.0.0.1 --port 5173   # 移动 bundle dev（HMR）
./node_modules/.bin/electron --remote-debugging-port=9223 /tmp/lkm   # 390×844 壳（/tmp/lkm/main.cjs 加载 mobile.html）
node /tmp/lkm/cdp.mjs  --shot /tmp/lkm/x.png '<js>'   # 裸 CDP：求值 + 截图（Node 24 内置 WebSocket）
node /tmp/lkm/walk.mjs /tmp/lkm/steps.json            # 批量走查（click/clickText/eval + 逐屏截图）
```
要点：① 必须 `Emulation.setFocusEmulationEnabled{true}` + `Page.setWebLifecycleState{active}`，否则窗口被遮挡时 **rAF/transition 冻结**，截到"半开的面板"（本会话踩过，误判成布局 bug）；
② 截图用 `deviceScaleFactor:2, mobile:false`（`mobile:true` 会按 visual viewport 缩放，出现假的分栏）；
③ `window.lakeNative` 已暴露 createNote/syncNow/listTreeNodes 等 42 个端口，可直接造数据；
④ 该 harness 的 userData 是 `/tmp/lkm` 的 app 名（`lkm-harness`），**不碰 `lake-notes-dev` 正式开发数据**。
→ 建议：把 `main.cjs`/`cdp.mjs`/`walk.mjs` 收进 `scripts/mobile-ui-harness/`，作为移动端 UI 回归的固定工装（待用户点头）。
