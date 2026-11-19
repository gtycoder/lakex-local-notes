# 移动端 UI 平滑度审计：布局稳定性 / 转场跳变专项（261119）

> 角色：**只读审计员**（不改产品代码）；唯一产出 = 本文。代码证据为准（模拟器 CDP 9335/9336 未运行、无 adb 设备 ⇒ 本轮无实测几何，全部结论以源码 file:line 佐证，复验方法逐条给出）。
> 用户点单：「UI 剧烈变化的问题比较多……要做到像苹果的 UI 和页面设计一样丝滑，不能出现这种剧烈变化和抖动换位的页面变化」。
> 范围：`src/mobile/**` 全部表面（布局稳定性 / 转场平滑度）；对照 `AGENTS.md` §3#14 观感红线、`docs/MOBILE-DESIGN.md`、`docs/MOBILE-TOP-CHROME-REFACTOR.md`（topChrome 契约）。
> 已知现场 1/2/3 已有修复流在做（见 §4 边界）——本文**只登记引用与根因链**，不重复设计细节；本审计的价值 = §2 新发现。

---

## 1. 结论摘要

1. **「常驻元素换位」的根子是「同一语义的 chrome 在不同状态由不同高度的元素接管」**。topChrome 契约（B0–B2）已把**已登记**表面管住（8 页 20+ 表面 0 违规），但契约护栏 `topChromeContract.test.ts` 只扫 `SURFACE_MARKERS` 里 9 个类名 token——**不带这些 token 的顶部表面自动漏网**（已知现场 2 的 `mbt-page-bar` 就是这么漏的）。本轮又扫出同类漏网/潜伏面：`.mb-menusheet__submenu`（整屏子菜单贴 `top:0`、无安全区消费、未登记）。
2. **「打开/切换时剧烈变化」集中在三类机制**：
   - **条件插入正文流**（元素出现/消失直接重排整页）：文档内查找条 `.mb-find` 是本轮最大的新发现（P1）；
   - **两套几何互相替换**（进入多选态、视图切换）：多维表头部 98px ↔ 多选栏 48px 瞬时换位（P2，落在 task-3 写范围，登记交接）；
   - **异步内容到达改高**（骨架/纯文本 → 富内容/内核兜底）：小记列表预热窗（8 条）之外的卡片正文到达换高、内核兜底换渲染，虚拟列表跟着重排（P2）。
3. **转场基建本身是健康的**：路由层 `is-settled` 撤 transform/will-change（mobile.css:941-947 + `useRouteTransition.test.ts` 护栏）、keep-alive pane 保滚动（NotePaneHost R2）、阅读⇄编辑滚动钳位恢复（`editor/scrollPosition.ts`）、键盘 store 单例 + 每帧合并（`useKeyboard.ts`）、Sheet 入场/下拉关闭/键盘钉住（`MobileSheet` + `useKeyboardStableSheet`）都符合红线，**不要再动**。
4. **共享元素转场（FLIP）只覆盖了 2 条链**（小记卡→写作卡、置顶文档卡→工作区，`HomePage.tsx:410-446` 的 `morphCardToRect`/`.mb-morph-card`）；知识库笔记本卡、日记条目、标签详情行、文档列表行 → 工作区仍是「整页瞬移 + 路由层位移」双轨。按修复哲学③，补齐时**复用同一份 morph 先例**，不新造第二套。
5. **严重度分布**：P1×2（1 新 1 登记）、P2×7（5 新 2 登记边界）、无 P0。所有新发现都有明确落点与护栏归属，且**全部落在 4 个在修流写范围之外或已显式登记交接**（§4）。

---

## 2. 逐条发现

> 严重度口径：**P0** = 数据/崩溃级；**P1** = 主路径高频、用户点单直指的剧烈跳变/覆盖系统栏；**P2** = 次要路径/低频/潜伏/微跳。
> 「修复方向」都按丝滑准则（§3）的优先级：先消灭几何跳变，再谈过渡，最后才是共享元素。

### F-A【新·P1】文档内查找条：条件插入正文流，开/关瞬间整篇正文下压/回弹

- **表面**：工作区 Lake 文档 → 顶栏右上「查找」→ `.mb-find` 查找条（手机/平板同一实现）。
- **症状**：打开查找，整篇正文瞬间下压一个查找条高（≈48–56px），阅读位置跟着跳；关闭再弹回。没有任何过渡，属于用户点单里的「抖动换位」。
- **根因假设**：`src/mobile/editor/DocumentEditor.tsx:196` 把 `{findOpen && <MobileFindBar …/>}` 渲染在 `.mobile-doc-body` **之前的正文流里**；`.mb-find` 是普通 flex 行（`src/mobile/editor/mobile-find.css:4`），而 `.mobile-doc-body` 是 `height: 100%`（`src/mobile/mobile.css:607`）⇒ 插入即整页重排、底部还被裁掉同等高度。
- **修复方向**（准则①：消灭几何跳变）：查找条改为**覆盖式**（absolute/fixed 锚在工作区顶栏下沿，正文不动），或与顶栏同高常驻占位（不推荐——空占位也是浪费）。落点：`DocumentEditor.tsx` 的挂载位置 + `mobile-find.css` 加定位；命中高亮跳转（`n/m`）不必改。若坚持在流内，则必须走准则②的位移入场（高度 0→H 用 `--mobile-duration-panel`/`--mobile-ease-out`），但这只是次优。
- **验证法**：设备录屏开/关查找各一次，正文首行 y 坐标应纹丝不动；`check:mobilesnap` 跑文档态；查找条出现时编辑 dock / 胶囊几何不位移（fixed 包含块不被新增 transform 祖先破坏）。

### F-B【新·P2】小记列表：预热窗之外的卡片「纯文本 → 富预览」换高，虚拟列表跟着抖

- **表面**：首页「小记」时间线（虚拟化列表）。
- **症状**：向深处滚动时，视口内卡片从 `previewText` 纯文本块换成富预览（标题/加粗/图片卡）→ 卡片高度变化 → 下方卡片位移（「抖动换位」的滚动版）。
- **根因假设**：卡片正文靠 IntersectionObserver 懒读（`src/mobile/home/HomePage.tsx:1205`），到达前渲染 `<div className="qn-card__text">{previewText…}</div>`（`HomePage.tsx:1333`），到达后换 `<QuickNotePreview body=…>`（`HomePage.tsx:1319-1322`）；列表虚拟化 `estimateSize: () => 168` 但实测高度随内容变（`HomePage.tsx` quickVirtualizer 段）。首屏 8 条已有预热（`core/quickNoteDetailPrewarm`）**只救了第一屏**，预热窗外必现。内核兜底换渲染同理（见 F-C）。
- **修复方向**（准则① + 虚拟列表口径）：给卡片预览一个**恒定占位几何**（预览区固定高度/最大高度 + `overflow: hidden`，与 `imageBox.ts` 比例盒同一思路），或把预热口径从「一屏 8 条」改为「滚动前再预热 N 条」（注意 AGENTS 明示**不要**按虚拟窗口 24 预热——单条正文可达 660KB，取 8~12 为宜，先测内存）。落点：`HomePage.tsx` 卡片渲染 + `useQuickNoteListModel.ts:36` 合并处；预热判据仍走 `quickNotePrewarmIds` 单一来源。
- **验证法**：模拟器滚动小记列表 3 屏，逐帧对比卡片 y 坐标（或录屏慢放）；`check:perfmobile` longtask 对比。

### F-C【新·P2】小记卡内核兜底：Suspense 先画快路径、内核到达后整体换渲染，卡内再跳一次

- **表面**：含自研解析器不支持块（表格/画板/自定义卡）的小记卡。
- **症状**：卡片先画快路径（unsupported 标签片），0.3–0.9s 后内核只读视图落地整体替换，卡片高度再变一次；随后 `ResizeObserver` 判溢出又可能把 220px 折叠态套上（`QuickNotePreview.tsx:181-192`）——一次滚动里两连跳。
- **根因假设**：`src/features/quickNotes/QuickNotePreview.tsx:198-203` 的 `<Suspense fallback={<Nodes …/>}>` 用**异构**内容当 fallback；内核 chunk 懒加载（同文件 :26）注定晚到。
- **修复方向**：fallback 与最终内容**同构等高**（fallback 就渲染折叠高度 220px 的占位块，内核到达后不改外框），或内核到达时保留折叠高度、展开交给用户。逻辑共享组件（`src/features/quickNotes`）改动需两端同看（桌面也用）。
- **验证法**：构造含不支持块的小记，录屏看卡片外框高度曲线应为单阶；桌面端回归同条卡片。

### F-D【新·P2】多维表进入/退出多选态：98px 两行头部 ↔ 48px 多选栏瞬时换位

- **表面**：多维表网格/卡片/看板长按进入批量选择。
- **症状**：进入多选瞬间整个网格上跳 ≈50px（退出再跳回）——「换位」的教科书样本。
- **根因假设**：`src/mobile/bitable/MobileBitableViewer.tsx:695-699` `selection.active ? <SelectionTopBar …/> : <header className="mbt-header">` 两元素互换；`.mbt-header` = row1 48 + gap 2 + row2 40 + margin 8 ≈ 98px（`mobileBitable.css:285-303`），`.mb-sel-topbar` min-height = 48 + inset（`mobile.css:518`）。
- **修复方向**（准则①：两态同源几何）：多选时**保留 mbt-header 的行位**（在 row1/row2 位置原地替换内容，或给 SelectionTopBar 外面套 98px 的同高槽），视觉换、几何不换。落点 = `MobileBitableViewer.tsx` 挂载处（**在 task-3/5 写范围内 ⇒ 登记交接，见 §4**）。
- **验证法**：`npm run check:bitablesnap` 两态对比网格首行 y；设备录屏长按进入/取消选择。
- **旁证（同型微跳）**：首页多选态 `SelectionTopBar`（48）换掉首页顶栏（compact 44，`HomePage.tsx:760-770`）≈4px 微跳，同修法（同高槽）可顺带。首页不属于在修流写范围（task-1 只收 capture 相关）。

### F-E【新·P2】重依赖文档首次打开：EmptyState 文字页 → 带 chrome 的查看器，整页重排

- **表面**：首次打开 表格/多维表/手写板 文档（分包懒加载）。
- **症状**：先画「正在加载表格/多维表/手写板…」空态文字，模块到达后整个查看器（顶栏行/工具条/画布）替换进来 ⇒ 页面高度、顶部元素位置全变。
- **根因假设**：`src/mobile/notebook/NotePaneHost.tsx:106-131` 的 Suspense fallback 是 `<DelayedLoading><EmptyState>正在加载…</EmptyState></DelayedLoading>`——`DelayedLoading` 只防了闪现，没防**换构**。
- **修复方向**（准则① + 冷启动骨架先例）：fallback 换成与查看器**同构骨架**（参照 `.mb-skel`「结构与真实同构、尺寸同源、填充不跳动」与 `mb-composer-skeleton` 的 261022 先例）：表格/多维表骨架 = 头部两行 + 网格线框。落点：`NotePaneHost.tsx` 三处 fallback + `mobile.css` 骨架类（与 mb-skel 同族）。
- **验证法**：冷启动后直接点开表格/多维表/手写板各录一次屏，顶部 chrome 位置应单次到位；`check:mobilesnap` 对应态。

### F-F【新·P2】`.mobile-settings-preview` 全屏预览层瞬时出现/消失（无入场）

- **表面**：设置→回收站→点文档预览、回收站文档只读预览（Q04B）。
- **症状**：全屏层 `position: fixed; inset: 0` 一帧盖上/一帧消失，整页「瞬移」；返回时同样直切。
- **根因假设**：`src/mobile/mobile.css:589` 容器无任何 transition/animation；挂载点 `MobileApp.tsx:958-959` 与 `settings/SettingsDrawer.tsx:831-832` 条件渲染即到位。
- **修复方向**（准则②：允许的入场位移）：给容器加 250ms `--mobile-duration-panel`/`--mobile-ease-out` 的**淡入+微位移**入场（退出可直切，AGENTS 允许返回直切先例），并在 reduced-motion 名单**登记**（`mobile.css` 名单 + `mobileLayers.test.ts` 声明数只许降——新增声明需同批找等量删除或 lead 收口）。层内 `TrashPreviewPage` 的 topChrome（overlay）已合规，不动。
- **验证法**：设备录屏开/关预览；reduced-motion 开启时零动画。

### F-G【新·P2（潜伏）】菜单 Sheet 整屏子菜单贴 `top:0`，一旦启用即覆盖状态栏

- **表面**：`.mb-menusheet__submenu`（可下钻菜单的子层，整屏横向平移）。
- **症状**（潜伏）：子菜单是 `position: fixed; top: 0; bottom: 0` 的整屏层，顶部标题/首项直接贴屏幕顶 ⇒ 刘海/状态栏设备上会被系统时钟压住——与已知现场 2 同型（「覆盖系统栏」）。
- **根因假设**：`src/mobile/floating.css:201-207`（`top: 0`、无 `--mobile-top-safe-area`/`--mb-chrome-inset-top` 消费）；渲染点 `src/mobile/ui/MobileSheetMenu.tsx:94`；`topChromeContract.test.ts` 的 `SURFACE_MARKERS` 不含该 token ⇒ 护栏看不见它。**现状**：全仓 `MobileSheetItem.children` 暂无调用方传值 ⇒ 路径当前不可达，属**潜伏**（规则活在产物里，谁加个下钻就中招）。
- **修复方向**（准则① + topChrome 契约）：子菜单容器/标题按 `data-mb-topbar data-edge="overlay"` 登记（`SURFACE_MARKERS` 补 `mb-menusheet__submenu` 或其标题 token，护栏随之钉住）；或最小改 = 容器 `padding-top: var(--mb-chrome-inset-top)` 并入允许清单（不推荐，等于又开一个旁路）。顺手把「子菜单标题」纳入 `.mb-menusheet__title` 既有形态即可，不新造视觉。
- **验证法**：`top-chrome-geometry.mjs`（9335/9336）加该表面探针；或临时塞一个 children 的菜单在模拟器点开看标题与状态栏关系。

### F-H【新·P2（低）】小记卡「展开/收起」maxHeight 瞬时切换，卡下内容直跳

- **表面**：超长小记卡底部「展开/收起」。
- **症状**：点展开，卡片从 220px 瞬时长到全文高，下方列表直跳（收起同理）。
- **根因假设**：`src/features/quickNotes/QuickNotePreview.tsx:190-196` `style={collapsed ? { maxHeight: COLLAPSED_MAX_PX } : undefined}` 无过渡（属「结构展开」类，MOBILE-DESIGN Motion 允许做过渡）。
- **修复方向**（准则②）：展开/收起走 `--mobile-duration-panel`/`--mobile-ease-out` 的高度过渡（结构展开语义，非装饰）；reduced-motion 名单登记。若嫌动高度不值当，**保持现状也可接受**——它是用户显式操作、非导航跳变，优先级最低。
- **验证法**：录屏对比；`mobileLayers.test.ts` 棘轮同批收口。

### R-1【登记·在修 task-5】多维表只读行详情页：跳变 + 覆盖状态栏（已知现场 2）

- **症状**：打开「记录 N」整页剧烈变化，右上「编辑/只读」压在系统时钟上。
- **根因链（审计补证，供修复流参考，不重复设计）**：
  1. `MobileBitableViewer.tsx:210` `onFullscreenRef.current?.(detailId !== null)` → `useWorkspaceChrome.ts:85` `chromeHiddenNow` → 顶栏走 `.mobile-topbar--auto-hidden`（`mobile.css:75-77`，height 归零**带 250ms 过渡**）+ 胶囊隐藏；
  2. `.mbt-page`（`mobileBitable.css:584-591`，absolute inset:0）**无过渡瞬时挂载**（`MobileBitableViewer.tsx:917-918` 条件渲染）——顶栏在塌、页面已满屏，两者时序错位就是「剧烈变化」；
  3. `.mbt-page-bar`（`MobileBitableRecordPage.tsx:37` / `mobileBitable.css:592-599`）**未声明 data-mb-topbar/data-edge** ⇒ 不消费安全区、护栏不覆盖（漏网机制见 §1.1）。
- **顺带登记（同页、task-5 验收语义可覆盖）**：翻页器 `setDetailId`（`MobileBitableViewer.tsx:920-930`）换记录是内容瞬时替换——若修复流做「父页面内展开」，翻页同走该转场即可，不必单列。
- **验证法**：task-5 已给（topChromeContract 登记新表面 + 安全区正确 + 开/返回无跳变）。

### R-2【登记·在修 task-3】多维表 表格↔表单 视图切换跳动（已知现场 1）

- **症状**：「数据表 1」标题与视图 tab 行位置/缩进随视图变、表格贴边、计数被裁。
- **根因线索（只登记）**：`mobileBitableHeaderModel`（`bitable/mobileBitableHeader.ts`）按 `isFormView` 收起 row1 三按钮 + `.mobile-bitable.mbt-is-form` 切换容器 padding（`mobileBitable.css:482-484` 表单态 padding:0、头部另行补内距）⇒ 两视图 chrome/内距不同源。修复要求已写进 task-3（顶部恒定、两视图边距一致、计数不裁）。
- **附议（审计观点，落地仍归 task-3）**：修法请按准则①「两视图同源几何」——row1/row2 高度与左右内距在两视图取同一变量，只换按钮集合，不换槽位。

### R-3【登记·在修 task-3】表单文本框失焦后拖滑杆反复弹键盘/焦点回弹（已知现场 3）

- 不重复设计；审计只补一句边界观察：这属「键盘/焦点几何突变」类，修复判据建议钉「blur 后非文本控件交互不得触发 focus()」的单测（与 `dismissKeyboard.test.ts`/`keyboardSheetAudit.test.ts` 同族），防回归。

### X-1【已排除/健康面，防止误报】

- **路由转场层**：transform/will-change 仅转场期挂、`is-settled` 撤除（`mobile.css:941-947`、`useRouteTransition.ts:34-41`）+ 护栏 `useRouteTransition.test.ts:39-51` ✓；
- **胶囊显隐/面板开合**：`capsuleVisibility.ts` 阶段冻结 + 编辑态过渡 none + `dockPanelPhase.ts` 单一来源 ✓；
- **键盘几何**：`useKeyboard` 单例 store + 每帧合并 resize（`useKeyboard.ts:76`）+ `useEditSurface` `--mb-app-h` 单一 owner + `useKeyboardStableSheet` 钉住 Sheet ✓；已知现场 3 是焦点问题不是这套几何的问题；
- **keep-alive 滚动**：pane 常驻 DOM 保 scrollTop（`NotePaneHost.tsx` R2 注释）、阅读⇄编辑滚动钳位恢复（`editor/scrollPosition.ts`）✓；
- **图片到达长高**：`src/lib/imageBox.ts` 比例盒（小记卡封面 `HomePage.tsx:1248-1249`）+ 画册封面固定 108px（`mobileBitable.css:772`）✓；仅老数据缺宽高时不写盒（`imageBox.ts` 明示）——那是 F-B 的子情形，不单列；
- **Sheet 高度**：`.mb-sheet` 固定 50dvh/72dvh 档（`floating.css:41,99`），内容增减不改面板高度 ✓；
- **topChrome 已登记表面**：25 处 `data-mb-topbar` 声明齐全、`top-chrome-geometry.mjs` 8/8 页 0 违规 ✓（漏的只是没进 `SURFACE_MARKERS` 的类名，见 F-G/R-1）。

---

## 3. 丝滑准则（后续所有移动端改动自查清单）

> 来源：AGENTS §3#14 观感红线 + MOBILE-DESIGN Motion（261029/261118 归一）+ 本次修复哲学。**「丝滑」≠ 加动画**；正解优先级从上往下：

1. **① 消灭几何跳变（永远先做这层）**
   - **chrome 恒定**：同一语义的常驻元素（顶栏/表头/tab 行/工具条）在任何状态切换（视图切换、进详情、进多选、只读⇄编辑、键盘开合）里**位置与高度不变**；只能换内容，不能换槽位/缩进。做不到就「页面在父页面内展开」（子页不整屏瞬移、不动父页 chrome）。
   - **两视图同源几何**：切换视图/模式的两套 UI，其容器内距、行高、左右缘取**同一组变量**（多维表表格↔表单、阅读⇄编辑、列表↔卡片同理）。
   - **条件元素不进正文流**：会显示/隐藏的辅助条（查找条、横幅、提示）一律 overlay 或常驻占位，禁止「出现即重排整页」。
   - **异步内容不改外框**：骨架/占位与最终内容同构同高（`.mb-skel`/`mb-composer-skeleton` 先例）；图片走比例盒（`imageBox.ts`）；虚拟列表的可变高卡片给恒定占位几何。
2. **② 必要的入场/位移过渡，只走既有令牌**
   - 时长 `--mobile-duration-panel`（250ms）、曲线 `--mobile-ease-out`（cubic-bezier(.22,1,.36,1)），移动端唯一入场曲线；只做**入场与位移**（含「结构展开」），不做 hover/颜色/背景/边框过渡（瞬时）。
   - `prefers-reduced-motion` 下全部关闭——**新增过渡必须同步登记 reduced-motion 名单**（`mobile.css`/`floating.css` 各一份；新增声明与 `mobileLayers.test.ts` 棘轮同批收口）。
3. **③ 共享元素/FLIP 只用 `.mb-morph-card` 先例**
   - 列表→详情想消除「整页瞬移」，复用 `HomePage.tsx` `morphCardToRect`（克隆按来源矩形浮起 → 目标矩形 → 淡出；只动几何+opacity；reduced-motion 跳过）；**不引新动画库、不写第二套 FLIP**。返回可直切（AGENTS 已有先例）。
4. **topChrome 契约是硬约束**
   - 任何新的顶部/整屏表面必须声明 `data-mb-topbar` + `data-edge`（viewport/overlay/nested/sheet；消费内容高再加 `data-size`），并**同步把类名 token 补进 `topChromeContract.test.ts` 的 `SURFACE_MARKERS`**——不进清单 = 护栏永远看不见（R-1/F-G 的教训）；业务 CSS 不直接写 `--mobile-top-safe-area`/44px/52px。
5. **转场层纪律**
   - `will-change`/常驻 `transform` 只许存在于转场期间，播完 `is-settled` 撤除（fixed 包含块回到视口）；新增会位移的壳层先确认没有依赖视口的 fixed 子元素。
   - 键盘态不写 `--mb-app-h` 字面量；resize 按帧合并已有 `useKeyboard`，**不要**为动画引入 rAF 相位门控（红线）。
6. **禁止清单（原样保留）**：给 hover/颜色加过渡；引入新动画库（Motion 等）；rAF 相位门控；为「丝滑」把瞬时反馈改成动画；在业务组件写第二套 sheet/toast/对话框。
7. **验收口径**：动了几何就跑 `check:mobilesnap`（只跑受影响态）+ 设备录屏逐帧看「切换前后常驻元素 y 坐标」；动外壳/动胶囊/动转场加跑 `check:windowsweep`；topChrome 相关跑 `top-chrome-geometry.mjs`。判定标准就一条：**切换前后同一常驻元素的几何差 = 0**（或在显式转场的关键帧里）。

---

## 4. 与 4 个在修流的边界（登记不重复做）

| 修复流（task） | 写范围 | 与本审计的边界 |
| --- | --- | --- |
| **bitable** · task-3（选项改色 / 视图切换不跳动 / 表单焦点） | `src/mobile/bitable/**` | R-2（视图切换跳动）、R-3（表单焦点）**只登记**，设计归 task-3。**新发现 F-D（多选态 98↔48 换位）也落在其写范围内** ⇒ 本审计不修，建议 lead 把 F-D 挂给 bitable 流顺带（同属「头部几何恒定」）或立后续小项；若 task-3 改 `mbt-header` 几何，F-D 的同高槽方案一起定。 |
| **bitable** · task-5（记录详情页跳变 + 覆盖状态栏） | `src/mobile/bitable/**` | R-1 **只登记**（根因链已给）；其验收「打开/返回无剧烈跳变」建议把**翻页器换记录的瞬时替换**一并覆盖（R-1 顺带登记）。F-D 若 task-5 顺带做也可，两者同文件。 |
| **tags-untag** · task-4（标签详情 × 换长按菜单） | `src/mobile/tags/**`（+ quick-notes.css `.tag-quick-card` 限类） | 交互改造非跳变类；本审计**未对标签详情行提任何改动**。唯一交叠提醒：task-4 弹出的「动作菜单」请走既有 `MobileSheetMenu`（注意 F-G 潜伏项：**别用 children 下钻**，或先修 F-G）。 |
| **qn-exit** · task-1（速记 capture 返回链） | `ui/backStack.ts`、`ui/dismissKeyboard.ts`、`hooks/useBackHandler.ts`、`MobileApp.tsx`、`home/**`（capture 相关） | 返回/键盘语义修复，非布局跳变。F-B/F-C（小记列表卡片）在 `home/**` 与 `features/quickNotes`，**不在 task-1 的 capture 限定范围内**，不冲突；但若 task-1 动 `HomePage.tsx` capture 段，注意别顺手改卡片渲染。 |
| **camera** · task-2（拍照调系统相机） | `editor/EditorDock*`、`ai/**`、`native/**`、`bridge/**`、`android/**` | 功能修复，与跳变无关；F-A（查找条）落点 `DocumentEditor.tsx`/`mobile-find.css` **不在**其写范围，无冲突。 |

**归属建议（不在修流写范围内的新发现，谁来接）**：
- F-A（查找条，P1）：`editor/DocumentEditor.tsx` + `editor/mobile-find.css` —— 无在修流占用，建议立新小项（半小时级：改 overlay + 录屏验证）。
- F-B/F-C（小记列表）：`home/` 列表渲染 + `features/quickNotes/`（**两端共享逻辑，改动需桌面同看**）—— 建议合一个小项做「预览恒定占位」。
- F-E（懒加载骨架）：`notebook/NotePaneHost.tsx` + `mobile.css` —— 独立小项（三处 fallback 换同构骨架）。
- F-F（预览层入场）/`F-H`（展开过渡）：动效类小改，注意 reduced-motion 名单 + mobileLayers 棘轮须同批；可与 F-A 合并成一个「入场/覆盖」小项。
- F-G（子菜单安全区，潜伏）：`floating.css` + `MobileSheetMenu.tsx` + `topChromeContract.test.ts` SURFACE_MARKERS —— 建议随任意 topChrome 相关批次带上（成本极低，防下钻菜单上线即中招）。

## 5. 本轮审计覆盖说明

- 已扫：`src/mobile/**` 全部 header/toolbar/topbar 形态 JSX（35+ 表面）、CSS fixed/sticky 定位点（40+）、`--mobile-top-safe-area` 全部消费点（4 处 + 喂值通道）、路由转场/FLIP/will-change、键盘/面板/capsule 状态机、6 种多维表视图 + usheet + 分页器、虚拟列表（2 处）、图片比例盒、Sheet 族（MobileSheet/PickerSheet/MobileSheetMenu/ActionSheet）、设置/回收站/预览/AI/手写板/画板外壳。
- 未能实测：开发模拟器 CDP 9335/9336 无响应、`adb devices` 为空 ⇒ F-A/F-B 的像素级佐证留给修复流用录屏/探针补（验证法已逐条给）。
