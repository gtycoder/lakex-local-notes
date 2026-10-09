# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接（261009 → 261008）

> 写给完全没有上下文的新会话。接手顺序 **README → HANDOFF → AGENTS**。**本节只保留最新 1–2 批（261009 / 261008）**；更早的 dated handoff 已删除，只在 git 历史可查（`git log -p --follow HANDOFF.md`）。文中提到的「专项文档」= 已删除的 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`。**真正的待办看 §3，长期坑看 §4，移动端看 §8。**
>
> **下一会话焦点（261009 续）**：usheet 已是唯一表格、旧表格已彻底清除，**本批已合并 master**（`25ab081`）。剩余待办：① 「开始」工具栏最终取舍（继续点名隐藏 / 定白名单 / 维持现状——把「更多」当缓冲）；② 公式栏收起方案（结论已并入本文件与代码注释；原记录文档随 spike 收尾删除，git 历史可查）；③ MiSans 桌面字体文件是否引入（用户 261009 暂缓）。**唯一已知遗留** = 多标签切换时内核工具条 1~4 帧绘制空帧，见 §3#9（诊断与可行方向已写全，别重复试提层类改动）。

### 261009 续 · 工具栏「收起 / 展开」+「开始」精简 + 右侧槽位 + 残留收尾 + 合并 master（已交付并合并）

- **工具栏「收起 / 展开」**：**不切 `ribbonType`**，保持 `classic`（工具行永远跟随**选中的大分类**），收起时只用宿主类藏掉**页签行** `[data-u-comp="ribbon-header-menu"]` ⇒ 双行 76px ↔ 单行 40px。按钮在工具行最右（24×24 / 圆角 4 / 图标色 `--lake-text-1`，与 Univer 工具按钮同规格；左侧 1px 分隔线成独立槽位），纵向位置由 `syncRibbonToggleTop` 量出工具行 top 写进 `--usheet-ribbon-toggle-top`（自动跟随；须扣 `host.clientTop` 的 1px 边框）。收起状态**设备本地记忆**（`lake-notes-v3.usheet.ribbon-collapsed`）。
- **关键实测（别再走弯路）**：Univer **没有**运行期"关公式栏 / 关页签"的公开 API（`formulaBar` 是创建时布尔；`setUIVisible('header-menu')` no-op；`updateMenuConfig({hidden:true})` 藏不掉页签）；原生 `simple`/`collapsed` 单行模式**会把工具重置回「开始」**；**`defaultEngine.resize()` 是 no-op**，必须用**渲染单元**的 `engine.resize()`（`IRenderManagerService.getRenderAll()`），否则收起后画布不跟（底部留空条）。CDP 依附窗口 `document.hidden` ⇒ `rAF` 不触发，重排触发用 `setTimeout`。
- **右侧槽位与「更多」**：Univer 的溢出判定读 `ribbon-toolbar` 的 **`contentRect.width`（不含 padding）** ⇒ `padding-right: 50px` 既让「更多」**更早出现并左移**，又给收起按钮让出槽位（不预留时实测「更多」占 gap 19–43、按钮占 9–33 ⇒ **重叠**）。
- **「开始」精简 5 项**：字体 / 粘贴 / 百分比 / 货币 / 快捷键面板，走公开 API `updateMenuConfig({ hidden: true })`。⚠️ **只列该位置专属的 id**：`sheet.command.paste` 同时挂在右键菜单（隐藏会连带干掉**右键粘贴**）⇒ 粘贴只藏 `sheet.menu.paste`。副作用：腾出的宽度会被原先挤在「更多」里的工具**自动补位**（缩小字体填充 / 文本旋转 / 合并单元格 / 常规 / 增加小数位）——要"真的变短"须继续点名或给「开始」定白名单（**待用户定**）。
- **依赖**：`@univerjs/engine-render` 显式声明并**锁 `1.0.3`**（＝ presets 的精确 pin；出现第二份会让 DI token 不一致 ⇒ 引擎重排**静默失效**）。
- **收尾**：旧表格残留全量复检并清零（见下条"残留审计"）；`master` 已 fast-forward 合并（`25ab081`）。spike 验证设施已按 AGENTS §2「已完成 spike 直接删」**全部删除**（`src/spike/`、`spike-univer.html`、`vite.spike.config.ts`、`scripts/spike-univer-cdp.mjs`、`scripts/usheet-stress.mjs`、`docs/UNIVER-SPIKE-261009.md`、`docs/USHEET-TOOLBAR-OPTIMIZATION.md`，连同 `.gitignore` 的 `/dist-spike`、`/spike-*.png`）；**移动端表格组件同步切换**——新增 `src/mobile/usheet/MobileUsheetViewer.tsx`（同一套 Univer 内核、只读、不挂工具条/公式栏、不保存；懒加载不进首屏，由 `mobileLazyChunks.test.ts` 卡住），接进 `NotebookWorkspace` 的 kind=usheet 分派。
- 门禁：tsc 0 · ui-metrics（未定义令牌 0）· cssLayers/uiPrimitives ✓ · vitest **209 文件 / 1698 用例** · check:core 75-0 · 双端构建 ✓ · `git diff --check` ✓。

### 261009 · usheet 转正为唯一表格 + 旧表格彻底移除（**已合并 master**：`25ab081`）

- **分支状态（261009）**：工作先落 `spike/univer-sheet`，工具栏工作落 `spike/univer-ribbon`；**两条分支均已 fast-forward 合并进 `master`**（用户 261009 指示"合并到 master"）⇒ master 现为 usheet 唯一表格版本，领先 `origin/master` 33 个提交（**尚未 push**）。
- **彻底移除旧 sheet**：删 `src/features/sheet/` 整目录、`core/sheetDoc.ts`/`sheetGeometry.ts`（+测试）、`mobile/sheet/MobileSheetViewer.tsx`、两个 `@fortune-sheet` 补丁、`scripts/sheet-icons.*`、`package.json` 的 `@fortune-sheet/react` 依赖；`NoteKind = doc|usheet|bitable|board`（旧 `sheet` 按 AGENTS §3#7 直接回退 doc，**无迁移**）。
- **UI**：状态栏 / 侧栏文案「表格（新）」→「表格」。
- **顺带**：大表格粘贴护栏「存为表格文档」改为产出 usheet 正文（`parseHtmlTableToUsheetBody` / `native.createUsheetIn`）。
- **门禁**：tsc 干净 · vitest **209 文件 / 1698 用例** · ui-metrics · check:core 75-0 · 双端构建 · `git diff --check`；应用侧冒烟：建表 → 开表 canvas 正常、状态栏「表格」、全页无「表格（新）」。
- **残留审计（合并前全量复检）**：依赖（`package.json`/`package-lock.json` 里 `@fortune-sheet` = 0、`node_modules/@fortune-sheet` 不存在）、`patches/` 只剩 `@plait+draw`、旧模块文件全不存在。**又清掉 3 处此前遗漏的残留**：① `electron/store.ts` 仍在**创建旧 `sheets/` 正文目录**（已删）；② `src/mobile/mobile.css` 里 **23 条零引用的旧表格只读视图样式 `.mst-*`**（已删，−127 行）；③ 旧 kind 的措辞全部中性化（`noteKind`/`syncDecisions.test`/`usheetDoc`/`boardDoc`/`noteQueries`/`historyRepository`/`mobile/noteRepository`，以及 STORAGE-LAYERS 与 LAKEX-CONTRACT 的 CSP 对比），`make-fixture` 的 `notes.sheet` key 改名 `notes.usheet`。`dist`/`dist-mobile`/Android assets 里的旧 `SheetEditor-*`/`MobileSheetViewer-*`/`sheetDoc-*` 产物已随重建清除。**现状：全仓 `git grep -i "fortune|luckysheet"` 只剩文档里的迁移记录与本批对比结论，代码 / 依赖 / 产物零残留。**
- **文档**：TROUBLESHOOTING 删旧表格章节 K/M/N/O/P/Q；HANDOFF 删旧表格 §0 小节与 §3 暗色任务书/补丁坑；AGENTS 删旧表格图标/换行/右键条目（保留通用「模块级单例串台」教训）。
- **遗留清理（261009 收尾已完成）**：spike 验证设施已全部删除（见上条"收尾"）。

### 261008 四改~十改 · 「文档引用」卡整体收口（浮层几何 / 悬停出条 / 点击访问 / 自绘图标+深色 / 插入即编辑 / 完整创建流程 / 取消链接转正文 / 复制资料库路径）（已交付并推送）

- **用户反馈（①② 几何 / ③④ 交互 / ⑤~⑩ 见下）**：① 动作浮窗要**贴近文字**，并按内核链接浮窗**复刻大小与间距**（原来明显偏小、偏紧）；② 编辑浮层也要贴文字，且做成**两个输入框**（照内核链接编辑器）；
  ③ 动作浮窗改为**鼠标移上来就出**（和链接一样，不再需要点一下打开）；④ **点击文字 = 直接打开被引用的文档**（点一下就是访问）。
- **③④ 的落地**：动作条从 `Popover`（点击开）换成 **`HoverPopover`**（锚点与表面**共享悬停区** + 开/关延时 120/160ms ⇒ 光标能移到条上点按钮）；
  标题文字挂 `onClick={openTarget}`（`role="link"` + Enter/Space 同义）⇒ 点击/回车**直接打开目标文档**（同一文档只有一个标签：已打开则激活它）。
  编辑/选择器打开期间 `onOpenChange(next && !editing && !picking)` **屏蔽**悬停弹出；不再挂原生 `title`（悬停已是动作条，再叠一个 `.ln-tip` 反而乱）。
  ⚠️ `HoverPopover` 的悬停监听**只在挂载时读一次** `anchorRef.current` ⇒ "取消链接/重新引用"会换掉锚点元素（链接态 ↔ 纯文本态），必须用 `key` 强制重挂，否则换态后悬停失效（见 §4）。
- **做法：不自造几何，直接复用内核类**（与选区浮栏同一姿势，样式来自 vendored lakex-doc.css）——
  动作条 `surfaceClassName="ne-card-toolbar"`（padding 6/12、条目 28×28、图标 16、间距 4、圆角 4）；
  编辑浮层 `surfaceClassName="ne-link-editor"`（365 宽 / padding 16·12 / 字段间距 16 / 字段名在上）+ 两个 `.ln-input` 输入框
  （「链接」是**只读输入框外观**，点击/回车打开文档选择器）+ `.ln-btn--secondary` 的「确定」（图4 那个描边钮）。
  **两者都必须带 `lakex-default-theme`**（portal 到 body 后已在编辑器树外，靠这个类才吃得到内核主题桥）。
- **顺带修两处真问题**：① 同一个回调 ref 挂在外层卡片 div 与标题 span **两层** ⇒ 锚点漂到卡片块、浮层比文字低 6~8px（现在只挂标题文字 + `gap: 2`）；
  ② 编辑里点「链接」弹出的选择器原先**没有锚点坐标**（会掉到视口左上角），现在锚在同一处。
- **真实端实测**（隔离 userData + `LAKE_RENDERER=scheme` + CDP 9234/9235，用开发库里那张真卡）：动作条 `padding 6px 12px` / `radius 4px` / 条目 28×28（间距 32）/ **上边距 2px** / 左缘 = 文字左缘（65）；
  编辑浮层 `365×223` / `padding 16px 12px` / `radius 5px` / 字段 `margin-bottom 16px` / 输入框 339 宽 / 「确定」在左侧；**暗色**下两浮层背景 `#1e1f23`、边框 `#2d2f34`（主题桥生效）。
  **交互实测**：`mouseenter` 标题 → 120ms 后条出现（4 项）；移出标题但**移入条上** → 保持打开；完全移开 → 关闭；**点标题 → 活动标签切到被引用文档** `eeeff8ed…`（原活动 `1b6b7362…`，不新建重复标签）。
- **⑤ 插入面板图标换成用户设计稿（261008 五改）**：新 [noteRefIcon.tsx](src/features/editor/noteRefIcon.tsx) —— 组件**只渲染一个 `<symbol id="icon-lake-note-ref" viewBox="0 0 72 72">`**（不画可见 svg），
  经 `appendNoteRefCard(config, card, NoteRefIconSymbol)` 挂进内核的 `{ config, icon }` 包装 → `lakeRuntime.ensureCustomCardIcons()` 收进隐藏 sprite；
  `NOTE_REF_CARD_META.slash.icon` 改指该**全限定 id**（面板按 `<use href="#<id>">` 直接解析，短名要过内核别名表、自绘图标查不到）。
  **实测**（隔离实例 + 面板里那一行）：图标盒 36×36 / radius 7、`div.ne-icon` font-size 36px、`<use href="#icon-lake-note-ref">`、`use` bbox 35×35、symbol 70×70（72 网格 ⇒ 0.5 缩放，描边 2→1px）。
- **⑥ 图标的深色重绘（261008 六改，用户"你看着处理"）**：同一份几何两套调色板 —— 变量定义在 [themes/base.css](src/styles/themes/base.css)（浅色=设计稿原值）与 [themes/dark.css](src/styles/themes/dark.css)（深色：底框 `#232528` / 文档面 `#2b2e34` / 描边 `#d7dae0` / 高亮线 `#7fb2ff` / 链接绿 `#2ed790`）。
  **机制（关键）**：`<use>` 的内容活在 **shadow 树**里 —— **选择器打不到、`var()` 也不能写在 presentation attribute（`fill="var(…)"`）里**，只有**继承**能进去 ⇒ 只能写成 `style={{ fill: "var(--lake-note-ref-icon-…)" }}`（本项目"禁内联样式"的唯一例外，理由写在 `noteRefIcon.tsx` 头注释）。
  护栏：`noteRef.test.ts` 断言组件里**没有颜色字面量**、且**每个用到的变量都在 base.css 定义、dark.css 逐一同名覆盖**（缺一个就是深色下透明/黑）。实测两套取值：浅 `#fff/#f6f6f2/#20ba77` · 深 `#232528/#2b2e34/#2ed790`，面板实拍两主题均正常。
- **⑦ 插入后直接打开编辑浮层（261008 七改，用户：「插入文档引用，直接打开编辑页面就行，还是类似链接」）**：与内核"插入链接后立刻弹链接编辑器"同口径 —— 从插入面板建卡后**自动弹出**同一套编辑浮层（文本 / 链接）。
  **判据（实测）**：内核给**刚插入**的卡挂 `ne-focused`；**打开既有文档时卡上没有这个类**（重启复现两次均无），而 `ne-focused` 本身是"**当前聚焦卡**"标记（点另一张卡会转移）⇒ 单独用它会在"聚焦卡被重渲染"时误弹。
  落地做法（`noteRefCard.tsx`）：空引用 + 编辑态时**轮询 ~1.4s（120ms×12）**找 `closest("ne-card").ne-focused`（插入时内核可能先把卡渲进**游离节点**再挂进文档，一次性判定会漏），
  并用**模块级 `WeakSet` 按 DOM 元素去重**（开过一次就不再开，重渲染不重复弹）。阅读态 / 已有引用不弹。
  **同时修**：打开即聚焦原本用 `autoFocus` 是**失效**的（首帧表面 `visibility:hidden`，`focus()` 被静默忽略）—— 编辑浮层改为等 `usePopoverPosition` 的 `placed` 再聚焦（**空引用落在「链接」、已有引用落在「文本」**，同内核链接编辑器的 defaultSelect 口径）；选择器搜索框同理改用下一帧聚焦。
  **实测**（隔离实例）：插入后 **T+200ms 浮层已开**、字段 `["文本","链接"]`、焦点 = 「链接」输入框；点它 → 选择器**锚在卡旁**（left 57 / 12 行）且**搜索框已聚焦**；**打开既含空卡的文档时浮层不弹**。
- **⑧ 完整创建流程（261008 八改，用户定稿）**：「插入 → **自动开编辑浮层** → 点「链接」**选文档** → **自动回填「文本」= 该文档标题** → 用户改完点「确定」→ 卡片**直接展示这段文本**」。
  · **选文档只回填、不落库**：`NoteRefEditPopover` 里选中的目标先存本地 `picked`（`refId/targetTitle/targetLabel` 都是"预览值"），**只有「确定」才 `update` 写卡**；
    回填规则 = 「文本为空 **或** 仍等于上次自动填的值」才覆盖（`autoFilledRef`）⇒ 用户改过的文本不会被下一次换文档冲掉；「确定」按钮的 disabled 也改看 `hasRef`（选完就能提交）。
  · **展示文本 = 卡里存的 `title`**（`value?.title || note?.title`），**不再用目标文档的实时标题** —— 否则"改文本"等于没改（显示永远被目标标题覆写）。旧卡/未填文本才回落实时标题。
  · 编辑器里的焦点走向与内核链接编辑器一致：**还没有引用 → 落在「链接」**；**选完文档回来 → 落在「文本」**（正好接着改展示名）。
  **实测**（隔离实例全链路）：插入 → 浮层开（焦点=链接）→ 选择器 13 行（焦点=搜索）→ 选「多维111」→ 浮层回来、`文本=多维111`、`链接=多维111 · 多维表`、**焦点=文本** → 改成「我改过的展示文本」→ 确定 → 浮层关、卡片显示**我改过的展示文本**（链接色）；
  落盘核对 `.lake`：`<card customName="lake-note-ref" value="data:{…"noteId":"a5fab08e…","title":"我改过的展示文本"…}">` ✓。
- **⑨ 取消链接 = 转为正文（261008 九改，用户：「点取消链接就直接转为正文就行，不用保留卡片样式」）**：不再把卡留在正文里（旧行为是"清引用、保留卡片形态的纯文本"）。
  落地 `unlinkCardToText(editor, cardEl, title)`（`noteRefCard.tsx`）—— **全走内核命令**：
  ① `execCommand("focusCard", cardId)` 把选区落到这张卡上（就是内核给新插入卡挂 `ne-focused` 的那条；**卡片 DOM 的 id 就是模型节点 id**，实测选区 start/end 的 `node.id` 与之一致）；
  ② `captureModelRange` → `positionAfterModelRange` 换算「该顶层块之后」的落点（模型里卡片外还包着一层洞节点，必须靠 `_parent` 上溯求顶层块）；
  ③ `insertAtPosition(落点, "text/html", <p>转义后的展示名</p>)`；④ `deleteCard(cardId)` 摘卡。
  ⚠️ **顺序不能反**（先删再算落点会得到 `indexOf = -1` ⇒ 文本跑到文档末尾）；⚠️ **自己 BFS 模型树找节点实测失败**（根节点的 `_children` 不适合外部遍历）⇒ 用内核的 `focusCard` 让它自己认。
  失败（拿不到内核能力）才回退旧的"保留卡片"路径，**绝不静默丢文本**。
  **实测**（隔离实例）：点「取消链接」后 `refs 1→0`、`ne-card 1→0`；落盘 `lake-note-ref` 卡数 **0**、原位置变成 `<p><span>展示名</span></p>` ✓。
- **⑩ 复制引用 = 复制目标文档的**资料库全路径**（261008 十改，用户定稿）**：不再复制只有本应用认识的 `lake-note://<id>`。
  中间改过一版"本机绝对路径"（`native.getNotePaths().lakePath`），用户最终拍板**回到资料库路径** ⇒ 定稿 = `笔记本/分组/文档`。
  `NoteRefHost` 新增**可选** `pathOf(noteId)`（签名允许同步/异步，调用方统一 `await`；可选是为了不破坏既有注入点/单测），App 注入 `treeNodePath(treeNodes, noteId)` 拼出的全路径。
  复制回退链：**资料库路径 → 展示名 → `lake-note://<id>`**（任何情况都不复制空串）。动作条文案 =「复制引用路径（目标文档在资料库里的全路径）」；
  路径只在**点击那一刻**取（树遍历不该进渲染期）。**实测**：复制得到 `个人笔记/表格55`，与树里该文档的真实路径一致 ✓。
- **回填** [docs/LAKEX-CONTRACT.md](docs/LAKEX-CONTRACT.md) **§5.24**（含一条纠偏：内核链接的 hover 菜单其实是**竖向** `.ne-ui-mode-menu-panel`，横向那条是卡片工具栏；以及"同一个 ref 别挂两层"）。
- 门禁：tsc ✓ · vitest **1777 passed / 16 skipped** ✓ · ui-metrics（hex=0 / rgb=0 / `!important`=9 / 字号字面量=0）✓ · check:core 76-0 ✓ · 双端构建 ✓ · `git diff --check` ✓。**已提交并推送** `origin/master`（`342e14e` 表格阈值 · `4fef01d` 引用卡 · `14fd144` 文档）。

### 261008 续 · 大表格粘贴 A+B 兜底（已交付）

- **A 护栏**：粘贴的 HTML 表格 **> 1000 行或 > 5000 格**时**不发生给内核**（阈值 261008 上调，见 §3#16 的边界实测）（`document` 捕获阶段 `preventDefault + stopImmediatePropagation`，见 `clipboardHtml.ts`），改为弹明确提示；**剪贴板内容保留、绝不静默丢弃**（AGENTS §3#16）。
- **B 兜底**：提示里一键「**存为表格文档**」= 解析该表格 → `createUsheetIn` 建表格文档写入 → 在光标所在块之后插入一张「**文档引用**」卡（复用 R2 的 `lake-note-ref`，`insertAtPosition` + `text/html`，落点用捕获的内核模型选区）。
- **阈值上调（261008，用户定稿）**：`500 行 / 3000 格` → **`1000 行 / 5000 格`**（`tablePasteGuard.ts` 的 `TABLE_PASTE_MAX_ROWS/CELLS`；单测钉死这两个口径值）。
  **边界实测**（隔离 userData + `LAKE_RENDERER=scheme` + CDP，合成 `paste` 事件，量 `dispatchEvent` 同步耗时）：**1000×5 = 5000 格 → 1.93s / DOM +2.65 万**；100×50 = 5000 格 → **1.41s**；旧上限 500×6 = 3000 格 → 0.79s；
  1001 行 / 6000 格两例被护栏拦下 → **0.5~0.7ms**（内核完全不接，对话框正确弹出并显示 1001 行 / 5005 个单元格）。
- **落点**：`src/features/editor/tablePasteGuard.ts`（阈值/计数/解析成 usheet 正文/卡片 HTML/事件通道）· `TablePasteGuardDialog.tsx`（提示 + 一键）· `clipboardHtml.ts`（拦截接线）· `App.tsx`（挂载 + 注入 parentId）。
- **真实端实测**（隔离实例 + CDP，5500 行 × 6 列 / 1.5MB HTML）：同步阻塞 **30,743ms → 2ms**（wall 48ms）；文档未被塞进表格（`ne-table-hole: 0`，DOM 仅 +18 = 对话框）；提示文案含 `5500 行 / 33000 个单元格` 与「已阻止本次粘贴，剪贴板内容保持原样」；点「存为表格文档」后**库里新增 1 篇表格文档**且宿主正文出现 `<card name="customBlock" customName="lake-note-ref" value="data:{"$name":"lake-note-ref","noteId":…">` ✓。
- 门禁：tsc ✓ · vitest **1772 passed / 16 skipped** ✓（新增 7 条：`tablePasteGuard.test.ts` 5 条纯逻辑 + 2 条接线护栏）· ui-metrics ✓ · check:core ✓ · 双端构建 ✓ · `git diff --check` ✓。
### 261008 续 · 「文档引用」卡（R2）

- **用户诉求**：在文档里"插入同目录的表格"。调研结论（§2 三级检索 + bundle 排查）：**内核没有现成卡**——云端那张「插入可访问的语雀内容」（`/yq`）是**拉语雀线上内容**、本地无解析通道；`mention` 在本构建的分组里**被注释掉**；`localDoc` 是「本地文档（上传文件）」卡。⇒ 只能自建，按官方**配置式自定义卡片**做了 **「文档引用」卡**（R2）。
- **能力**：`/`（实际入口是工具栏「+」面板）里的 **文档引用（/doc）** → 插入**区块引用卡** → 选择同库任意文档（**文档 / 表格 / 多维表 / 画板**都一样，只存引用元数据、不内嵌渲染）→ 点击标题打开对应标签页；目标被删/进回收站/purge → **「文档已删除」失效占位**。
- **落点**：`src/features/editor/noteRef.ts`（纯逻辑：`lake-note://<id>` 约定、解析、宿主注册表、`isGoneNote` 失效判据、斜杠接线，可单测）+ `noteRefCard.tsx`（React 卡 + 选文档浮层，复用 kit/`Overlay` 原语）+ `noteRefCard.css`（新文件，已登记 cssLayers 基线 28）+ `lakeRuntime.ts`（`registerNoteRefCard(mergedOptions)` 必须在 `prepareCustomCards` 之前；斜杠项加进「小工具」组）+ `App.tsx`（`setNoteRefHost({ listNotes, openNote })` 注入宿主：卡片在内核 React 树里，拿不到应用 context）。
- **契约与坑已回填** [docs/LAKEX-CONTRACT.md](docs/LAKEX-CONTRACT.md) **§5.23**（字段契约、`custom-${name}` 命名与分组 items 必需、「小工具」组 name 重名只能按 title 找、工具栏面板才是可靠入口、面板内部滚动要先 scrollIntoView、`.lake` 序列化形态、React 实例共享但无 context）。
- **真实端验收**（隔离实例 + CDP 全链路）：面板里出现 `/doc 文档引用` ✓ → 插入后显示"选择文档…" ✓ → 浮层列出 3 篇、选中「被引用表格」✓ → 卡片显示 `被引用表格 表格 换` ✓ → **点标题打开表格标签页且 `sheetOpen:true`** ✓ → 落盘 `<card name="customBlock" customName="lake-note-ref" value="data:…lake-note://<sheetId>…">` ✓。
- **261008 二改（用户要求「模仿内核链接的样式」）**：卡片改成「类型图标 + 展示名（主色/hover 下划线）」，**悬停出浮层**，四个动作与内核链接一致 ——
  **访问 / 编辑（弹窗改「展示名称」+「换文档」）/ 复制（`lake-note://<id>` 写剪贴板）/ 取消链接（清引用、保留展示名并渲染成纯文本）**；
  浮层走 `Overlay` 的 `HoverPopover`（共享悬停区 + 开/关延时）、定位走 `usePopoverPosition`、动作按钮复用 `.ln-iconbtn--compact` + lucide 图标；
  阅读态（viewer）不给写操作。新增样式文件 `noteRefCardActions.css`（横向图标行 + 编辑弹窗字段，已登记 cssLayers 基线 13）。
  > **二次修正（用户 261008）**：① 悬停浮层"根本点不到" ⇒ **改成点击打开**（`Overlay` 的 `Menu`，定位仍 `usePopoverPosition`）；
  > ② 样式要"直接复刻链接" ⇒ 正文改用**内核自己的 `.ne-link` 类**渲染（同源样式）；③ **不要全局弹窗** ⇒ 「编辑」从 `Dialog` 改成**锚定浮层** `Popover`（字段沿用本卡类，零新增 CSS），选文档也改成锚定浮层。
  > ⚠️ **该交互的"真实端点按"仍未验收**：CDP 驱动在本会话反复卡在"工具栏「+」面板未打开"那一步（诊断：文档已开、按钮在、`panel:false / 菜单项 0`，是驱动/选择器问题，不是卡片代码；被遮挡窗口又无法驱动 `mouseMoved`）⇒ **请用户点一下确认**（点卡片出四个按钮 / 编辑是锚定小浮层 / 取消链接变纯文本）。
  > 另：内核链接编辑那几个类（`.ne-link-editor*`）在 bundle 里只有类名、**CSS 规则没定位到**（很可能是运行时注入），所以"像素级完全复刻"拿不到现成样式；当前是**复用内核 `.ne-link` 类 + 自有设计系统原语**，若要逐像素对齐需你给出参考截图细节。
- 门禁：tsc ✓ · vitest **1773 passed / 16 skipped** ✓（`noteRef.test.ts` 8 条 + `tablePasteGuard.test.ts` 7 条纯逻辑/护栏）· ui-metrics ✓ · check:core ✓ · 双端构建 ✓ · `git diff --check` ✓。
### 261008 · 文档分屏（左右两栏 · 方案 A）

- **决策（用户 261008）**：只做**左右两栏、最多两个、不同文档、临时不持久化**；入口在顶栏右上角（点开列出其余已打开标签）；右栏右上角一个细箭头菜单（取消分屏 / 左右互换）+ X；分隔条可拖（**最终形态 = 可拖浮动工具条 + 标签栏一个合并标签，见下两条；本条为最初决策**）。**同文档仍只能开一次**（`noteId` 是标签唯一键，多开会撞保存/捕获/版本/滚动记忆，见调研结论）。
- **状态**：[useWorkspaceState.ts](src/hooks/useWorkspaceState.ts) 新增 `splitPair: { left, right } | null`（临时 state，不落盘、不进 settings）；`activeNoteId` 语义不变 = **焦点栏**文档 ⇒ 面包屑/大纲/状态栏/`activeEditorHost` 等 119 处引用无需改。
- **渲染**：[MultiTabEditor.tsx](src/features/editor/MultiTabEditor.tsx) 分屏时 `.tab-panels` 变两列（`is-split`），宿主按 `data-pane` 分列；**`data-active` 仍全局唯一（焦点栏）**，右栏靠新增的 `data-pane-visible` 显示（隐藏判据仍归 [tabs.css](src/styles/app/tabs.css) 单一来源）。点进任一栏即切焦点（**点第三个标签 = 普通切换**；"替换分屏栏"已被后面的合并标签定稿删除）。四个宿主（doc/sheet/bitable/board）都加了 `focused`/`pane`。
- **分隔条**：抽出唯一实现 [SplitHandle.tsx](src/components/ui/SplitHandle.tsx)（[SplitPane.tsx](src/components/ui/SplitPane.tsx) 与分屏共用）；拖拽改走 window 监听 + try/catch `setPointerCapture`（合成鼠标无活动指针时 capture 会抛错并中止拖拽）。分屏宽度只活在内存。
- **入口/菜单**：[DesktopTopBar.tsx](src/desktop/DesktopTopBar.tsx) 的 `DesktopSplitButton`（未分屏点开选标签、已分屏点击取消）；右栏控件见 [splitView.css](src/features/editor/splitView.css)（**最终是浮动工具条，见下方一条**；早期"下移一个工具条高度"的贴角方案已废弃）。
- **验收**：真实端 CDP 走查 —— 入口菜单只列其余标签（排除当前）；进入分屏两栏 517/517、`data-pane` 正确、`data-active` 唯一；点非焦点栏切焦点；左右互换（焦点跟随文档、列位互换）；取消分屏；点第三标签替换焦点栏；合成 pointer 拖拽 517→697（`--split-left` 生效，无 localStorage 写入）。
- 门禁：tsc ✓ · 全量 vitest **1726 passed / 16 skipped** ✓ · check:core 76-0 ✓ · ui-metrics（hex=0/rgb=0/`!important`=9/未定义=0）✓ · cssLayers+uiPrimitives ✓ · check:bundle ✓ · 双端构建 ✓ · `git diff --check` ✓。新增护栏 [splitView.test.ts](src/features/editor/splitView.test.ts)（6 条）+ 更新 `activeEditor`/`boardEditorMount` 的 `data-active` 断言。
- **右栏控件 → 可拖浮动工具条（用户 261008 最终定稿）**：贴角 / 骑线方案已废弃 —— 它与每个编辑器自己的工具条冲突（文档只是"画到了面包屑那一行"才显得正常；非文档会被工具条盖住）。改为 **`.tab-split-controls` 浮动工具条**：浮在两栏之上（`z-index: --lake-z-editor-sticky`）、不属于任一栏 ⇒ **不会被任何编辑器 chrome 盖住**；`⋮⋮` 把手 + `⋯`（取消分屏 / 左右互换）+ `×`（两枚实心圆钮）；按住可在分栏容器内**拖到任意位置**（位置只存内存，分屏本身临时、不持久化）。默认停在右栏工具条下方。
- **分屏在标签栏 = 一个合并标签（用户 261008 定稿，Edge 式）**：分屏两页渲染成**一个** `.tab-split-tab`（两段标题 + 中间分隔线 + `Columns2` 分组图标 + **一个 ×**，`data-split-group`）。点它 = 回到分屏（`activeNoteId` 恢复到最后看的那栏，`splitFocusRef`），点其它标签 = 普通单栏切换（合并标签仍在、`splitPair` 保留）。`splitActive = splitPair && activeNoteId ∈ {left,right}` 才显示两栏 / 分隔条 / 浮动工具条。**已删除「点第三个标签替换分屏栏」**；合并标签的 × = 取消分屏（两个标签都保留，不做连带关闭）。分屏组期间禁用标签拖拽（合并标签不是单 noteId，顺序算不了）。⚠️ 合并标签要插在**标签栏**的 `tabs.map`（MultiTabEditor ~L390），不是 `.tab-panels` 的编辑器 `tabs.map`（~L504）—— 第一次插错地方，渲染进了面板里。
- **面包屑归属重构（用户 261008 定稿）**：面包屑从「pane 级全局一条」下沉为**文档宿主自己的一部分** —— [EditorTab.tsx](src/features/editor/EditorTab.tsx) 用**本文档自己的**大纲句柄（`getSelectedId`+`getNode` 上溯）自算标题路径、自导航、自滚动到顶 ⇒ 分屏时**每栏一条、随栏宽收缩、与文档联动**、不再看 `activeNoteId`、不再闪烁。`DesktopLibrary`/`MultiTabEditor` 删除全局 `breadcrumb`（App 的 `headingPath`/`navigateToHeading`/`activePathTitle` 随之删除，改传 `notePathTitle(noteId)`）。`.lake-editor-tab` 改 flex 纵向两段（面包屑 + 主体 `flex:1;min-height:0`）。**分屏下隐藏面包屑右端「更多」**（AI 只走浮窗、导出走目录树右键）；`useEditorTopVar` 改为只量 `activeEditorHost()` 内的面包屑+工具条。验收：两文档并排 = 2 条面包屑（各 629px = 半宽）、`more:false`；单栏 `more:true`（全宽 1258）；文档+表格 = 只有文档栏有面包屑；编辑器高度链正常（host 714 / wrap 638）。坑记入 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §L。
- **收尾修复（用户 261008 报「点分屏没效果」）**：`Menu` 是 portal 到 body 的，outside-dismiss 原先只在锚点容器（`[data-split-menu]`/`[data-split-controls]`）里判断 ⇒ 真实鼠标落在菜单项上的 `pointerdown` 先关菜单、`click` 落空。改为「锚点容器 + `menuRef.contains`」双判；合成 `pointerdown`+`click` 复验 split 成功。坑记入 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §L。

- **已提交/已推送（261008）**：`ce035e4`（master，28 文件），与 `origin/master` 同步。**唯一已知遗留** = 多标签切换时内核工具条 1~4 帧绘制空帧（见 §3#9）。

### 261007 · 文档精简 + 设置页版式收口 + AI 常用预置

- **文档精简**：删除多维表专项（4415 行）/ 填色调研 / 非多维表审计+证据 / UI 刷新计划 / 旧安卓·资源·浏览器·对拍文档 / 虚拟渲染试验 / 设计评审稿，共 14 个 tracked 文件（−6948 行），并修掉 README/AGENTS/代码注释里的悬空引用；HANDOFF §0 压到只保留最新 1–2 批。删除内容都在 git 历史。
- **设置页版式**（用户 261007 现场反馈「不要这么挤 / 短配置放一行 / S3 输入更长」）：[settingsPrimitives.tsx](src/components/settingsPrimitives.tsx) 的 `Field` 由「堆叠」改**单行**（标题/说明在左、控件在右；`config-item--stack`→`config-item--field`；控件列 54%、主列 `flex-basis:0` 防长说明把控件挤到下一行）；`feature.css`：行内边距 12→14、最小高 48→52、分组标题条 8→10、卡片间距 12→16、行内列间距 16px；输入/下拉铺满控件列（S3 输入实测 332→390px）。紧凑控件（开关/数字/段）仍走 `Item`。
- **修一个真 bug**：`Switch` 的按钮是设置行的**直接 flex 子项**（没走 `.config-item__ctl` 包裹），而 `.ln-switch` 只写了 `width:32px`、没写 `flex-shrink:0` ⇒ 说明一长开关就被压扁（「启用云同步」「启用浏览器端」「使用 Path-style URL」等都中招）。修在单一来源 [kit.css](src/styles/kit.css) 的 `.ln-switch { flex: 0 0 auto }`；顺带给 `.ln-select__value` 补 `text-overflow: ellipsis`。
- **同步配置收口**：「云端与同步」页顺序改为 **S3 对象存储 → 同步策略 → 云端回收（S3 GC）→ 备份与恢复**；`启用云同步` 加**真闸门**——只有 S3「测试连接」成功（会话内 `s3Verified`，改任一 S3 字段即失效）才能开启，且 `saveSyncCfg({enabled:true})` 兜底测试失败即中止（此前注释写「通过才开」、代码却照样写 `enabled`）。
- **AI 常用预置**：[aiProviders.ts](src/core/aiProviders.ts) 新增 通义千问（`dashscope.aliyuncs.com/compatible-mode/v1`）/ 智谱 GLM（`open.bigmodel.cn/api/paas/v4`）/ 小米 MiMo（`api.xiaomimimo.com/v1`）；三家**不开**思考强度/思考模式（参数形状与 DeepSeek 不同，避免 400）。
- **同步 warning 结构化**（backlog §3#1，本轮一并完成）：core 从「拼中文字符串 → 控制器正则反解」改为**直接产出结构化 `SyncWarning`**（`{kind, noteId?, title?, filename?, message}`；类型单一来源 [lib/types.ts](src/lib/types.ts)，`electron/syncTypes.ts` 改为 re-export）；`AssetMissingError` 结构化携带 `filename`；同步浮窗新增「被跳过」列表（复用冲突快照那块表面）并可**点击打开对应文档**。**同步语义不变**（仍是 B 方案：跳过受影响条目、不覆盖本地、下轮重试），只改报告契约。真实端 CDP：注入带 2 条 warnings 的 lastResult → 浮窗渲染 2 行、点击打开目标文档。移动端同步设置页展示同一列表（可点开文档），首页/笔记本同步 toast 附「N 项被跳过」；**Android 模拟器未实测**（告警态在模拟器里不易复现）。
- 门禁：tsc ✓ · 全量 vitest **1716 passed / 16 skipped** ✓ · check:core 76-0 ✓ · ui-metrics（hex=0/rgb=0/`!important`=9/未定义=0）✓ · 双端构建 ✓ · `git diff --check` ✓；快照重烤 7 个设置态（两次采集一致）。真实端 CDP 实测：单行版式、开关 32×19、S3 输入 332→390px、闸门禁用态、AI 下拉 6 项。

### 修复 · 261006 · 画板工具栏图标对齐 + 多维表展开浮窗适配边界

- 用户两条反馈。① **画板左侧竖排创建栏图标错位**：内核原生 `label.tool-icon` 里的隐藏 radio 占 15px 流内宽度、lakex 注入触发器未居中 ⇒ 三类工具项图标圆心分 57 / 50 / 42.5 三档。修在 `src/features/board/boardEditor.css`（内核例外覆盖，不手改 vendor）：radio 移出流 + 注入触发器居中 ⇒ 实测 11 项 centerX **全为 42**，真实点击切换 / 高亮正常。② **多维表单元格展开浮窗适配边界**：`ExpandPanel` 旧实现横向按占位宽 400 夹取，而实际宽度是「记住的尺寸」⇒ 越界（1258 视口 / 锚点 x≈1020 / 记忆 900 宽时旧实现溢出 ~490px）。改用**真实尺寸**定位 + 夹进视口 + 窗口 resize 重新适配（仍不因拖动 / 缩放重算定位）。
- ③ **多维表 AI 字段展开默认进「预览」**（用户 261006），Markdown 字段仍默认「编辑」：`MarkdownExpandPopover` 按 `field.type === "ai"` 决定初始态（只读仍恒为预览）。真实端 CDP：AI 字段面板打开即 `预览` 高亮、无 textarea、头部「重新生成」在。
- ④ **全应用「文本选中」统一为固定色 + hover 气泡改用同色**（用户 261006 报「文档是主色变浅，多维表/表格/输入框是固定深蓝」，随后定稿「固定色比较好；选中的边框已经是主题色，多主题色放一起不好看」）：① 根因是内核 antd 基底（编译进 `vendor/lakex-doc-react/dist/style.css`，import 在 legacy 层）里有一条裸 `::selection{background:#1890ff}`，只被内核 `.ne-engine ::selection` 覆盖 ⇒ 其它一律固定蓝；② 修法：把 `--lake-select-bg` 从三套主题收进 `themes/base.css`、定为**主题无关固定值** `rgba(63,95,160,.16)`（用户截图的 `#d8dde8` 就是它在 `#f5f5f5` 上的合成），再在未分层 `kernel-theme.css` 加全局 `::selection{background:var(--lake-select-bg);color:inherit}`（未分层普通声明压过 legacy 层，不需要 `!important`）；③ 用户追加「这种冒泡都改用选中色」：`--lake-tooltip-bg/-fg` 由深蓝 `#3f4868`/`#f8f9ff` 改为同色系的 `#d8dde8`/`#1f2329`（`.ln-tip` 与各处 hover 气泡同一令牌）。真实端实测三主题：`::selection` 恒 `rgba(63,95,160,.16)`、`.ln-tip` 恒 `#d8dde8` + `#1f2329`。**用户明确：这不是设计系统的例外，而是「选中 / 气泡」这一处的独立设计。**
- ⑤ **多维表导航改为「设备本地」**（用户 261006 选 C）：`activeTableId` / 每张表的 `activeViewId` 不再作为正文真相 —— `useBitableSession` 序列化时恒写「第一张表 / 第一个视图」（新增 `serializeBody`），切表 / 切视图只写 `localStorage`（`lake-notes-v3.bitable-nav.<noteId>`，见 `BitableEditor`；历史快照预览 `chrome=false` 不读写）。效果：**切表不落盘、不标脏、不进同步**；每台设备各自记住最后看的表 / 视图。真实端 CDP：切表后状态栏全程 `仅本地`、正文 `activeTableId` 不变、localStorage 导航已更新。
- ⑦ **目录行新增「＋」快捷新建**（用户 261006）：行内 `.tree-row-actions` 加「＋」（hover 显形、**在「⋯」右侧**），点击弹「新建子项」菜单（新建文档 / 表格 / 数据表 / 画板 / 分组）。五项动作抽成单一来源 `CreateChildItems`（`CREATE_CHILD_ITEMS`），右键菜单「新建」子菜单同一处引用；「＋」菜单锚在该按钮、定位走 `usePopoverPosition`（贴底翻转）。真实端 CDP：hover 表格行 → 点「＋」→ 五项菜单正常弹出、Esc 关闭、未新建任何文档。
- ⑧ **目录重命名改弹窗 + 重命名期间钉住目录栏**（用户 261006）：① 删除行内 `.tree-rename-input`，改成 `TreeRenameDialog`（`Dialog` + `.ln-dialog__head/body/actions` + kit 的 `.ln-input`/`.ln-input__field`；标题「重命名」、文本默认全选、Enter=确定、未改动时「确定」禁用；弹窗宽度 `min(460px, 92vw)`——比附件重命名的 420 宽一档，给长名字留横向空间，实测 460×134、输入框 426px）；② 新增 `useDesktopShell.holdSidebarExpanded(active)`（`sidebarHoldRef`，`hideSidebarPreview` 先看它）—— 重命名弹窗打开期间调用，**悬浮态下指针移到弹窗/遮罩上也不收起目录**，关闭后释放。真实端 CDP：右键行→重命名→弹窗（值=标题、全选、取消/确定）→ 指针移到弹窗上 1.5s 目录仍 `sidebar-floating`；Esc 取消后离开 → 回到 `sidebar-collapsed`。同时清掉死掉的 `.tree-rename-input` CSS。
- ⑨ **垂直几何整体收窄**（用户 261006「顶栏有点宽，上下收窄一点；面包屑和固定工具栏也缩小一下试试」）：几何是**单一来源两处** —— `src/styles/app/base.css` 的 `--topbar-height`（38→36→**34**，32 是 260923 试过的下限）与 `src/lib/layoutMetrics.ts` 的 `TOPBAR_HEIGHT`（`layoutMetrics.test.ts` 卡两者一致、红绿灯 y 必须整数）；另 `--breadcrumb-height` 30→**26**、`--editor-toolbar-height` 34→**30**。标签条按 `(顶栏 − 标签)/2 ±2px` 自动居中，面包屑/工具条按令牌高度 + flex 居中。工具条 30 的代价：内核两个 32px 的「正文/字号」下拉触发器（`.ant-dropdown-trigger`）与两个色彩按钮（`.ne-ui-toolbar-color-button`）在 `src/styles/app/editor.css` 压到 26px，否则裁切（内核覆盖例外，理由写在规则处）。实测：`.tab-bar` 34、标签中心 y=19 = 可见头区（34+4）中心；面包屑 26；工具条 30、条内最高元素 27。macOS 红绿灯 `y=(TOPBAR_HEIGHT+4−12)/2` = 13（**主进程值，需重启实例才生效**；面板宽度不受影响）。✅ `check:stylesnap` 已在**开发工作区的隔离副本**上重烤（用户 261006 授权）：42 态，**34 态 0 差异**、8 个窄窗态按脚本自带规则跳过。夹具与旧基线同构（每态恒 +28 元素 = 自上个基线以来新增的笔记），差异即本次几何收窄。⚠️ 重烤坑：首态 `plain:1315:light` 首捕易被残留浮层污染（本次 2944 vs 正常 2387）——**必须用第二轮干净快照**写该态（与上个基线同一坑）。
- ⑩ **设置 · 资源重做 + 删资产「登记漂移」修复 + 快照装置去不确定化**（用户 261006）：
  · **资源页 = 未引用资源浏览器**（新 `src/components/AssetsBrowser.tsx`，从 SettingsPanel 拆出；**布局复刻思源资产页，样式仍用自有设计系统**）：**单栏上下分区** —— 上半 = 操作 + 列表（吃满剩余高度、内容多了自己滚）：三个**互斥**大页签 **可删 / 历史保护 / 缺失**（去掉「全部」）+ 类型筛选 + 全选可删 + 「清理选中」（二次确认、无「一键全清」）+ 按文档分组、行内动作（复制路径 / 在文件夹中显示 / 删除）；下半 = 固定 **1/3 高**（内容区）的**纯预览**（只有图 / PDF / 视频 / 音频，不放文字与按钮）。预览**直连本地资源服务器**（图片 `?w=1024`、缩略图 `?w=128`、音视频与 PDF 原图），不再走 IPC+base64。另：设置左栏 208→**184**、资源页去掉搜索、「重建全文搜索索引」从「资源」挪到「日志」。
  · **删资产文件必须与撤 `orphan_assets` 登记成对**：`cleanNoteOrphans`（历史面板清理）与 `cleanupUnreferencedAssetsForNote`（历史保留清理后自动清）原先**只删文件不撤登记**，而保存时的正向对账 `detectOrphans` 按磁盘驱动、看不见这类行 ⇒ 永不自愈（资源页显示「文件缺失」，预览 404）。修：这两条路径同步撤登记；`detectOrphans` 补**反向对账**（登记在、磁盘不在 → 撤行，目录缺失也照样对账）；`deleteHistory` 改为先删文件再删行。`listRemovedAssets` 另增 `fileMissing`（比一次磁盘）作为「缺失」分类的依据。据此体检的 `orphanRowsFileMissing` 应恒为 0。测试 +3（store.test.ts 131）。
  · **快照装置去不确定化**：① 归一化「上次清理 {时间}」墙钟文本（否则 settings-data 三态随清理时间漂移）；② `pin()` 清 `lake-notes-v3.dialog-states`（弹窗持久几何会随夹具副本把"上一台机器拖到哪/拉多大"带进来 ⇒ 所有 settings 态整体位移）；③ `drive.mjs` 断线时 reject 在途请求（原先 exit 13「unsettled top-level await」把真因盖掉）。**跨实例世代**复跑 34 态 0 差异。
- ⑪ **「资源」从设置里提出来，成为与回收站同级的空间**（用户 261006「先不动设置弹窗，把设置-资源提到和回收站一级，套回收站样式」）：
  · 新增空间 `resources`（`DesktopWorkspace`）：**整套复用回收站空间** —— `.app-shell.resources-space-active`（藏目录/大纲/状态栏）+ `header.tab-bar` + 整页 `.resources-space-pane`（chrome.css，与 `.trash-space-pane` 同构）；分栏复用回收站的 `.history-split` 原语，**左 2/3 列表、右 1/3 纯预览**（用户定稿比例）。
  · 顶栏合一菜单重组（用户定稿）：上半「空间」= 资料库 ⌘1 / 小记 ⌘2；下半「工作空间」= 回收站 / 资源 / 偏好设置，**下半一律不给快捷键** ⇒ `useDesktopLifecycle` 里 **⌘3 的绑定与提示一并移除**（只剩 ⌘1/⌘2）。
  · 设置里「资源」分类**整项删除**（nav 项 / `SettingsCategory` / JSX / 设置搜索分类集），**设置弹窗本身没动**；随之删掉 `--fill` 铺满链（不再需要）。
  · 顺手修既有 bug：从菜单里选完空间**菜单不关**（遮着刚切过去的内容；回收站/小记/资源都中招）⇒ `onSwitchWorkspace` 里一并 `setWorkspaceMenuOpen(false)`。
  · 快照装置同步：新增 `nav.openSpace()`（按可见性找顶栏触发器 → 点同名菜单项 → 等壳类生效），`settings-assets` 态换成 **`resources:1315:light`**；顺带修掉 `openSettings/openSpace` 会取到**隐藏视图**里顶栏按钮的隐患（空间 keep-alive、每个空间各有一套顶栏 ⇒ 必须挑 `getBoundingClientRect().width > 0` 的那个）。
- ⑫ **快照装置：态自包含 ⇒ 重烤从"整轮 8 分钟"降到"单态 15 秒"**（用户 261006「按提速的方法做」）：
  · 实测验证：`settings:1315:light` / `resources:1315:light` **单采指纹与整轮全量逐字节一致** ⇒ 以后改哪个界面就只采/只检那几个态（`drive.mjs … stylesnap.mjs <tag> "<态名>"` + `check-stylesnap.mjs --states "<态名>"`，后者 15 秒）。
  · 补了两处装置缺陷：① **块拖动把手的 hover 过渡**漏在 `settle()` 之外（`settle` 只等 DOM/几何）⇒ `settings:1315:light` 连拍两份出现"元素数相同、指纹不同"的 11 条假差异，现在末态归位鼠标并等把手收干净；② `check-stylesnap.mjs` 带 `--states` 时会把"没采的态"报成差异 ⇒ 加作用域（未采态不在比较范围）。
  · 顺带：`stylesnap.mjs` **每态落盘**（原先收尾才写，采集在后段卡死就整轮白跑，本轮实测丢过一次）；`nav.openSettings/openSpace` 改为按**可见性**找顶栏触发器（空间 keep-alive，每个空间各有一套顶栏，原先会点到隐藏视图里的按钮）。
  · 流程写进 `scripts/css-audit/README.md`「快照重烤的快速路径」。
- ⑬ **三处收口（用户 261006 连发三条）**：
  · ① **资源空间的分类页签改用 kit 横向页签 `.ln-tabs`**（与回收站/历史面板同一原语：墨线 + 计数徽标），删掉之前那套 `.seg` 大药丸（`.seg` 只留给取值选择/图标开关，见 AGENTS §14）。
  · ② **破坏性按钮只有一种长相**：`.b3-button` 基座是**实心主色**，`.ft__error` 过去只改文字色 ⇒ 漏写 `--outline` 的两处（目录树删除确认、资源清理确认）渲染成"红字压实心底"看不清（用户截图报障）。现在 `.ft__error` 自带 `background: transparent`（漏写也不再走样），那两处也补上 `--outline`；全仓 7 处 `ft__error` 已复核一致。
  · ③ **回收站 / 历史版本 / 资源 三处左右结构都能拖**：新增 `src/components/ui/SplitPane.tsx`（**唯一实现**）——指针拖拽 + ←/→（Shift 大步、Home/End 到两端）+ 双击复位 + `role=separator` 键盘可达；宽度**设备本地**存 `lake-notes-v3.split.<key>`，没拖过则用各站点 CSS 默认（回收站/历史 320px、资源 66%）。把手视觉与交互并进 kit 的 `.ln-split-handle`，**资料库侧栏的把手也并到同一个类**（实测几何逐像素不变：10px 命中带 + 居中 2×48 药丸）。
  · 修一处真 bug：资源行勾选框原先外层 `span onClick` 与内层 `input onChange` **各 toggle 一次** ⇒ 一次点击净零（"勾不上"）；改为 `label` 包住（原生只切一次），外层只拦冒泡。
- ⑭ **四处在细化 + 夹具钉死**（用户 261006）：
  · 资源行**不再挂分类标签**（「未引用/历史保护/文件缺失」——三个页签已经分类了，标签纯占宽）。
  · **切分类/换类型 = 清空右侧预览并清勾选**（原先预览还停在上一个页签的文件；顺带避免"清理选中删到看不见的条目"）。
  · 资源空间 pane 补段落节奏（`gap: var(--lake-space-md)`：页签行 / 工具行 / 分栏之间不再贴死）。
  · **回收站/历史版本行间距 8 → 4px**（`.b3-list-item` 一行 6 个间隙 = 48px，时间就是被它挤掉的）+ 回收站行时间改为**到分钟**（`src/lib/formatTime.ts` 单一来源，历史快照仍带秒）⇒ 默认宽度下"文档 · 时间"和「N 天后清除」都完整可见。
  · **快照夹具钉死**：夹具是 dev 数据的实时副本 ⇒ 往回收站删/新建文档会让**所有态一起漂**（实测少 2 篇 = 每态 −40 元素、看着像 CSS 变了）。改为冻结在 `~/Library/Caches/lake-notes-css-audit/fixture` 反复复用；换夹具数据才需要整份重烤（流程见 `scripts/css-audit/README.md` 的「夹具必须钉住」）。
- ⑮ **三条（用户 261006）**：
  · **资源行首不再渲染缩略图**：只留 `FileKindIcon`（类型图标），行更窄、省掉每行一次图片请求。
  · **回收站预览按 kind 分流**（回归修复）：原先无论什么正文都塞给 doc viewer，表格/多维表/画板的内部 JSON 被原样吐出来（用户报"多维表预览又坏了"）。现在只有 `doc` 走 Lake viewer，其余走 **`HistorySnapshotPreview`**（与历史面板同一实现，只读编辑器）。
  · **回收站文档的资产进资源页**（用户："删了多维表，它的资源怎么没进资源菜单"）：孤儿登记里没有（保存时还被正文引用）、历史那一支又要求"当前正文不再引用"，而回收站文档的正文文件还在 ⇒ 两边都不覆盖。现在 `listRemovedAssets` 额外扫**回收站文档**的资产目录，以 **`status:"history"`（历史保护，只读不可删）** 列出——恢复后还要用，绝不能给删；这也补上了资源页说明里承诺的"文档在回收站时文件仍列出"。测试 +1（store.test 133）。另：用户实时删文档会让夹具变旧 ⇒ 本轮**刷新了冻结夹具**（现含 3 篇回收站文档）并整份重烤；首态又吃到「首捕污染」（2707 vs 干净 2354），用快速路径单采该态修回。
- ⑯ **快照夹具改成「合成夹具」**（用户 261006：「你每次跑数据太慢了，我不可能不改数据」）：
  · 旧夹具 = 开发数据的副本 ⇒ 用户每次增删文档，侧栏树行数就变 ⇒ **所有态一起漂**（实测少 2 篇 = 每态 −40 元素），
    每次都要整份重烤（8 分钟）。现在由 **`scripts/css-audit/make-fixture.mjs`** 走应用自己的 IPC **造**一份合成夹具
    （零真实数据、内容固定）：富文本文档（标题/列表/代码/表格/图片）+ 第二篇 + 表格 + 多维表 + 画板 +
    两篇**同名**回收站文档（守住「分组 key 不能只用 title」那条回归）+ 小记 2 篇 +
    四种资源（正文引用 / 只被历史引用 / 纯孤儿 / 登记在但文件已删 ⇒ 可删·历史保护·缺失都覆盖）。
  · 冻结在 `~/Library/Caches/lake-notes-css-audit/fixture`（416K，**不含真实数据**）；生成/冻结/重烤流程写进
    `scripts/css-audit/README.md` 的「夹具 = 合成夹具」。DB 冻结必须走 `sqlite3 .backup`（热拷会把 WAL 丢掉 ⇒ 表都读不到，本轮踩过一次）。
  · 从此：只有**换夹具**（改生成器 / 补覆盖面）才需要整份重烤；平时改 CSS 仍只烤单态（7 秒）。
- ⑰ **云同步状态判据单点化 + 关闭云同步 = 离线本地空间（桌面 + 移动端）**（用户 261006）：
  · 新增 `src/core/cloudState.ts`：`cloudStateOf` / `canTouchNetwork` / `isCloudActive` / `cloudStateHint`，双端共用；
    桌面所有联网入口（sync_now、S3 GC 三件套、恢复/预览补拉、自动同步与定期对账定时器）统一挂它，
    移动端 `bridge.ts` 同步实现（`getSyncSettings/saveSyncSettings` 落 localStorage + 同样的闸门）。
  · 「关闭云同步」语义变更：以前只是"不自动同步"（手动同步/恢复补拉仍出网），现在**等同未配置、一律不出网**。
  · **恢复不再等网络**（B 方案，双端）：恢复立刻生效（实测 2ms），缺失资源后台按需补拉 + 明确提示；
    顶栏状态灯/设置页禁用态与后端**同源**（`isCloudActive`）；关闭云同步**永远能关**（最后对齐降级 best-effort）。
  · 护栏：桌面 `syncDualAB`（远端工厂调用次数 = 0）+ 移动 `bridgeCloudState.test.ts`（引擎未被调用）；共 4 笔提交。
- 门禁全绿：tsc ✓ · vitest **1703 passed / 16 skipped** ✓ · check:core 75-0 ✓ · ui-metrics（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · cssLayers+uiPrimitives ✓ · 双端构建 ✓ · `git diff --check` ✓。真实端 CDP 实测：强制 900 宽面板 `right=1250`（视口 1258，8px 边距）。明细见专项文档 §11/§12/§13。已提交：`c361001`（修复批）· `0b60125`（目录栏 ＋/重命名弹窗）· `22def1f`（垂直几何）· `5397548`/`5ad4f64`（资源浏览器 + 基线）· `f6e2298`（删资产登记漂移）· `5c8f1e4`（快照装置）· 本轮设置微调与基线（后续提交）。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 44 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交；**260928 多维表批次已由用户明确授权「提交代码」（仅提交、未推送）**）。移动端另有铁律见 **§8.0**。

## 3. 待办与已知问题（上线后 backlog）

> 多维表专项已收口；以下是专项之外真正保留的低优先项。

1. ~~**同步 warning 结构化**~~ **已完成（261007）**：core 直接产出 `SyncWarning`（`{kind, noteId?, title?, filename?, message}`，单一来源 `src/lib/types.ts`），控制器不再正则反解；同步浮窗展示「被跳过」列表 + 点击打开文档；`AssetMissingError` 结构化携带 `filename`。**同步语义未变**（仅报告契约）。
2. ~~**画板 AI 助手**~~ **已完成（261003）**：接的就是内核 `ai.generate` 钩子，转主进程既有 AI 通道（Key 不出主进程、不新增 IPC），只读不给入口。见 git 历史。仍不做的是**文内文本绘图卡片**（`TextToDiagram`，内核那支绿色徽标无注入点）。
3. ~~**UI 低优先：设计词表继续裁剪**~~ **已完成（261007）**：全仓零引用令牌 17 → 裁掉 **5 个被取代的 `--lake-media-*`**（`surface`/`btn`/`btn-hover`/`on-faint`/`on-dim`，消费者实际用 `scrim`/`toolbar`/`on`/`on-soft`/`-hover-2`）；其余 12 个按口径保留（尺度 ramp：`space-giant`/`motion-instant`/`motion-slow`/`ease-emphasized`/`ease-exit`/`font-weight-bold`；层序阶梯：`z-base`/`z-sticky` + 被护栏/文档引用的 `z-block-handle`/`z-overlay-lightbox`/`z-scrim`/`z-toast`）。口径见 AGENTS §3#14 与 `themes/base.css`。画板 `Wt` 已修复（`6b901bb`）；目录树窗口化不做。
4. **移动端剩余**：真机验收、数据导出/导入、粘贴与资源 URL、长文档大纲跳转；详细步骤见 §8。
5. ~~**搜索整体重构**~~ **已完成**（`984ccbc` 统一 FTS5+unicode61+CJK 单字预分词+增量账本、`d5ed6c0` 移动端纯文本源+拉丁前缀+多命中定位、`4fea72b` 设置页重建索引、`820305b` 标题-only upsert 保正文索引）：桌面/移动共享 `src/core/search/`。**剩余为可选增强（非缺陷）**：移动端索引源改 `getDocument("text/plain")`；拉丁子串检索（加 3-gram 列）；小记搜索（二期）；命中定位仍是 DOM 启发式（lakex 无公开查找 API）。
6. **历史快照恢复为新文档**：用户已明确先不做；恢复入口仍只覆盖当前文档，恢复前自动留档。
7. **低优先数据/性能**：附件哈希缓存仅在真实痛感出现后立项；回收站惰性下载暂缓；Word/PDF 大附件与历史 `lakex-contract.d.ts` 按需处理。
8. **已知外观**：离线残余资源、移动端缩略图仅覆盖 png/jpg/jpeg（失败回退原图）、多维表附件旧数据的体积展示边界。
9. **多标签切换时内核工具条 1~4 帧绘制空帧（261008 记录，未修）**：非活动宿主用 `visibility: hidden` 隐藏 ⇒ 浏览器**丢弃其绘制图层**，切回来整棵子树重新栅格化，内核工具条（子树最重）最后画完。**实测口径**：`.ne-ui` 切换瞬间已是 `opacity:1 / visibility:visible / transition-duration:0s`（不是 CSS 淡入）；标签高亮与可见宿主同帧、`--lake-editor-top`/`.tab-panels` 顶边不跳（rAF 逐帧 0 错位）。**方案 2（宿主 `will-change: opacity`）实测无效、已撤**。可行方向 = 方案 1：非活动宿主改 `opacity: 0` + `inert` + `pointer-events: none`（不再丢层），代价是非活动编辑器保持绘制，需按 10 万文档量级评估。**别再无证据试提层类改动**。

10. **样式大统一（260930 审计，三批已完成；③⑤ 已记录、暂缓不做的理由见下）**：用户要求「找出散落各处的相同操作模式，做成正式原语统一起来」。
    **已完成**（详见 AGENTS §3#14 的单一来源清单与 git 历史）：
    ① **菜单项** `.ln-menu__item`（顶栏下拉 / 右键菜单 / ＋菜单 / 多维表列菜单，legacy 选择器一并收编，overlay −29 条）；
    ② **图标按钮** `.ln-iconbtn`（新增 `--compact` 22×22 / `--accent` 主色 hover 两个正式变体；目录栏 12 处 + 目录行动作 + 多维表 6 处，chrome −39 / bitableEditor −63 条）；
    ③ **单行省略** `.ln-ellipsis`（新工具类，27 个调用点；**flex/宽度属于布局、仍留业务规则**）；
    ④ **选中行** 三元组收编进 `.ln-row.is-selected`（页签溢出菜单行 / 设置左导航，overlay 菜单 hover 随①）；
    ⑤ **图片填满裁切** `.ln-imgfill`（4 处；顺带删掉死代码 `.mobile-qn-img` 3 条）；
    ⑥ **输入框** 关联选择器搜索框 → `.ln-input__field`；面板头（回收站/历史）合并；卡片标题随③收编。
    **明确暂缓（已记录，不做）**：
    - **顶栏 `.toolbar__item` 并进 `.ln-btn`**：两者只差 1px 高与 padding（26/8 vs 27/11），但**顶栏几何被 `--shell-*` 令牌、面包屑高度、窄窗 media 的多处让位规则引用** —— 动它必须连顶栏做逐屏截图对拍，收益（少 10 条声明）不抵回归风险。**接手姿势**：先跑 `scripts/css-audit/shotset.mjs` 钉住 27 屏基线，再改，再逐屏 diff。
    - **toast 三套合一**（`.ln-toast` kit / `.b3-snackbar` compat / `.mobile-toast` mobile-kit）：数值 90% 相同，但一头牵动移动端、另一头 toast 是**瞬时浮层**（隐藏窗口里 CSS `:hover`/动画不跑，没法像素对拍）。**接手姿势**：单独一批 + 模拟器/真机验证，别在桌面会话顺手改。
    - **`.protyle-breadcrumb__item` / `.quick-note-index-main`**：审计把它们和输入框归为相似，实为**可点击的文本条目**，收编前先定性（是「行」还是「输入框」）。
    **工具（已入库）**：`scripts/css-audit/audit-lookalike.mjs`（找「像原语却没复用」，260930 命中 29 → 16）、`scripts/css-audit/audit-primitives.mjs`（跨文件规则体重复族，46 → 39）。改完样式重跑对比即可；判定只认这两份数据 + 实机几何，不认「看着像」。

11. **多维表行虚拟化（AR04 已证瓶颈；用户 260930 决定暂不做，留待后续）**：真实 Electron 压测（scripts/bitable-stress.mjs）——目标 5000×20 打开 **12.42s / 84.8 万 DOM / 395MB 堆 / 首次点选 2.25s**；10000×20 = 24.8s/169 万/1.34GB；20000×50（100 万格）200s 内未渲染完成；50000×50 因**正文 32 MiB 上限**根本无法保存。结论：CPU 热点（AR-F5/F6）已消除，**DOM 全量渲染是瓶颈**，支持 5000 级规模需行虚拟化/渲染策略；立项前先定「5000×20 滚动/编辑目标 + 验收口径」。**用户 261007 确认：长期待办、暂不做。**

12. **非多维表审计遗留（260930 会话决定）**：
    - **F16 安卓整轮网络同步持本地写队列** → **记入正式项目待办**：先出真机/模拟器时延数据，再拆「sync/GC 维护互斥」与「短本地事务互斥」，网络阶段不占本地 DB 写锁；需单独立项 + 跨端 sync 对拍。
    - **S3 内核适配收口与实机性能** → **记入正式项目待办**：重试/观察限制到 host/card/session；卡水合/自愈/scroll 先测后删；跑前台长正文/代码/媒体/大纲/锁定回归。
    - **F12 安卓固定密钥** → **不做**：属设备安全（Android Keystore）范畴，本项目不承担设备安全职责。
    - **S1 DocumentSession / F13 / §6.1-#2** → **不做**（会话正确性已由 S0 + 捕获契约覆盖；后两者收益不足）。
    - **F08 双介质一致性** → 走 §8 **路线 A**（保持文件+DB、只修会话）；**A 不修 F08 跨介质窗口**（需 B/C）。A 的会话修复已完成。
    - **§6.1 剩余性能项**：已测量（脚本 opt-in，见 git 历史）。#4 **已修**（5c70b1c，收窄到实例 mount）；#5 未测到高频（不做）；#6 增量 ~6ms/次（暂不改）。


13. **AI 多轮对话记忆只保留最近 40 条（用户 261005 决定：先文档化、不做长期记忆）**：主进程 `electron/ai/aiChatMessages.ts` 的 `assertMessages` 只把**最近 40 条消息**发给供应商（更早的上下文丢弃；另有 `AI_MAX_TOTAL_CHARS=200000` 上限），面板关闭即清空、**无长期 / 跨会话记忆**，设置页「AI → 说明」已如实标注。若要长期记忆 / 摘要压缩 / 跨会话共享，需单独立项（涉及存储与成本，超出笔记软件当前范围）。
15. **表格（sheet）vs 云端 lake 语雀表格：体验对齐调研（261008，实机体验 Edge + 云端原文；按收益/代价排序）**
    > 体验地址：`https://todoo.yuque.com/ex813k/stock/kif3cv50apeg52za`（云端 edit 态 + 阅读态都走过一遍）。
    > 已在云端核实到的能力清单：工具栏 = 保存态/卡片 | 撤销重做 | 格式刷·清除格式 | **常规▾** | **小数位 ±** | 字号▾ | B I S U |
    > **字色▾ / 背景色▾（分体：点图标=上次颜色、点三角=选色盘）** | 边框▾ | 水平对齐▾ | 垂直对齐▾ | 换行 | 合并 | 筛选▾ | 排序▾ | 视图▾ | 更多（第二行平铺：链接 / 垂直对齐 / 换行 / 小数位 / 图片 / 保护 / 查找）；
    > **公式栏常驻（名称框 `C11` + 公式输入）**；单元格右键 = 剪切⌘X / 复制⌘C / 粘贴⌘V / **选择性粘贴** / 插入内容（子菜单：上下插行、左右插列）/ **删除第 N 行** / **删除第 E 列** / 清除 / **添加备注**；
    > 其余入口（更多/条件格式/公式库）：复选框、下拉列表、图片、链接⌘K、附件、备注、**图表**、公式（SUM/AVERAGE/COUNT/MAX/MIN + 数学·统计·财务·工程·逻辑·日期与时间·查找和引用·数据库·其他·全部）、
    > 数字格式（常规/文本/数字/百分比/货币/日期/时间/日期时间）、字号 12~48、对齐/溢出·切断·换行、升/降序、**条件格式（突出显示单元格/数据条/新建·管理·清除规则）**、
    > **冻结（至 N 行 / C 列 / 行列）**、**保护（所选行/列/单元格 + 管理保护范围）**。阅读态工具条 = 撤销重做·刷新 | 筛选▾ | 排序▾ | 视图 | 定位。
    - **P0（261008 已逐条处理完）**：① 公式栏 —— **用户决定保持隐藏、不做**（当初是他主动关的，`showFormulaBar={false}`）；
      ② **小数位 ± 已完成**（内核这版是死键 ⇒ 自建两个 custom item + `adjustDecimals`；`常规▾` 我们本来就有 = 工具栏「自动」下拉）；
      ③ 单元格右键三项**核查结论（都不做）**：剪切 —— ⌘X 内核**已支持**、但没有 `handleCut`（加条目得自实现「复制+清空」）；
      选择性粘贴 —— 内核**完全没有** `pasteSpecial`/`paste-special`（要做等于自建粘贴引擎）；添加备注 —— 内核「批注」下拉里**已有**插入/编辑/删除；
      ④ 删除项文案带目标 —— **已做后撤销（用户 261008）**，内核恢复原样。
    - **P1（中等代价，价值明确）**：⑤ **条件格式**（突出显示单元格 / 数据条 / 规则管理，内核 `conditionFormat` 已有）；⑥ **数据验证**（下拉列表 / 复选框，`dataVerification`）；⑦ 公式库完整版（Σ 按类别，现只有 5 个快捷函数）。
    - **P2（暂不做，需先立产品语义）**：⑧ **图表**（内核这版 react 单元格右键不认 `chart` key，要另做入口）；⑨ **表格内保护**（我们只有文档级锁定 `EditorTab.locked`，云端是行/列/单元格级保护，语义不同，要先定稿）；⑩ 分列 / 截图（低频）。
    - 对齐良好、无需改的：B/I/S/U、字号、字色/背景色（含**分体交互 + 记忆上次颜色**，刚对齐）、对齐/换行、边框、合并、筛选/排序（工具栏）、冻结、查找、格式刷/清除格式、自动行高、单元格图片、链接、批注、缩放、工作表标签菜单。
    - ⚠️ 改动口径不变：上述都要**先证真实价值**（AGENTS §3#17）；涉及内核能力的一律按 §2 三级检索（官方文档 → LAKEX-CONTRACT → vendor/补丁），别凭云端 UI 猜 API。

16. **大表格粘进「文档」会卡死（内核级，261008 用户实测；A+B 兜底，C 调研中）**：
    - **现象**：从本应用的「表格」文档复制 ~5500 行数据，粘进**文档** ⇒ 整个窗口卡死；用户实测**同一份内容在思源约 3s 完成**，
      而**云端语雀 Lake 同样卡死** ⇒ 判定为**闭源 lakex 内核的表格卡片问题**（不是我们这层能根治的）。
    - **本机实测**（[scripts/table-paste-stress.mjs](scripts/table-paste-stress.mjs)，合成 paste + 真实 text/html，等价真实粘贴）：

      | 粘贴内容（6 列） | 主线程**同步**阻塞 | DOM 节点 | 产物 |
      | --- | --- | --- | --- |
      | 1000 行 | 最大长任务 1,405ms | 43,400 | `ne-table-hole`（1001 行 / 6006 格） |
      | **5500 行** | **30.7s** | **269,108**（单个 render unit **225,612**） | `ne-table-hole`（5501 行 / 33,006 格） |

      5.5× 行数 → ~22× 时间（≈n^1.9，超线性）；CPU profile 34.6s 里 `value` 16.7s / `get` 5.9s / `e` 3.8s / **GC 2.8s**。
      我们的粘贴预处理（`clipboardHtml.ts` 的 `upgradePastedHtml`）只花 **146ms** ⇒ 不背锅。
      根因：**Lake 表格卡片整表全量渲染 DOM、没有虚拟化**，且粘贴在**一个同步任务**里建模型 + 渲染。
    - ✅ **A+B 已交付（261008）**：见 §0「大表格粘贴 A+B 兜底」——实测同步阻塞 **30,743ms → 2ms**，提示明确、剪贴板保留、一键存为表格文档并插入「文档引用」卡。以下为原始方案记录（保留作背景）。
    - **A（护栏，兜底方案）**：在 `clipboardHtml.ts`（本来就在处理每次 HTML 粘贴）量行列数/字节数，超阈值时不按表格卡片粘贴，
      并**明确提示**（"表格过大 N 行 × M 列，为避免卡死未直接粘贴；请改用表格文档或分批粘贴"）——**剪贴板内容保留、绝不静默丢弃**。
      阈值**已定稿为 ≤1000 行 / ≤5000 格**（用户 261008 上调；旧值 500/3000）。**边界实测**（隔离实例 + 合成 HTML，
      量的是 `dispatchEvent` 的同步耗时 = 主线程阻塞）：**1000 行 × 5 列 = 5000 格 → 1.93s / DOM +2.65 万**；
      100 行 × 50 列 = 5000 格 → 1.41s；旧上限 500 行 × 6 列（3000 格）→ 0.79s；**超限被护栏拦下时同步耗时 ≤1ms**（内核完全不接）。
    - **B（体验更好）**：超阈值时**自动落成「表格」文档**（表格侧性能已修好：共享 canvas + 400ms 静默窗口），
      文档里留引用/链接。需先定交互语义（落哪个笔记本、命名、是否跳转）。
    - **C（内核侧分批/异步粘贴）—— 261008 调研结论：本项目不做**（三条实证）：
      ① **既有的虚拟渲染帮不上**：文档级 `virtualRendering` 是**按 render unit（`ne-role="render-unit"`）**做虚拟化的
         （见 `src/components/BlockHoverHandle/BlockHoverHandle.tsx` 的判定），而一张粘贴进来的表格**整体就是单个 render unit**
         （实测一个 `ne-table-hole` = 225,612 个后代节点）⇒ 单测期内无法只渲染视口片段。
      ② **没有可用的增量插入口**：表格卡片的模型/渲染实现只在**闭源预构建 bundle** 里（`vendor/lakex-doc-react/src` 只有
         bookmark / imageToolbar 等少数插件源码），且 `.d.ts` 里没有 `insertTableRow`/`appendRow` 一类 API ⇒ 宿主侧
         「分 N 批往同一张卡里追加行、批间让出主线程」这条路**没有稳定接口**，只能反编译卡内部模型（高风险、随内核升级即失效）。
      ③ **上游同样卡**：用户实测同一内容在思源 ~3s、而**云端语雀 Lake 也卡死** ⇒ 是内核层面的已知限制，不是我们这层的实现问题。
      ⇒ 结论：**按 A+B 兜底**（护栏 + 大表自动落成「表格」文档），不改 vendor 的表格渲染。
    - **复现**：起隔离实例后 `SIZES=1000,5500 LAKE_CDP_PORT=9222 node scripts/table-paste-stress.mjs`（脚本头注释有完整启动命令）。

## 4. 关键坑（长期有效）

### 同步 / 数据
- **`purged_at` 不是永久墓碑**：前缀删除成功后会被 `markPurgeSynced()` 清空；永久判定看 `deleted_notes` 墓碑（folder 看 `node_type='folder'`）。
- **purge 必须无条件写墓碑**：`notes` 行缺失时从 `tree_nodes` 兜底；漏写会导致云端复活成不可见文档。
- **manifest.assets 永远全量声明**：上传差集只决定 PUT，不能裁剪声明；否则他端 GC 会误删在用资产。
- **资产存在性只看远端清单差集**，禁止逐对象 HEAD 和本机持久缓存；下载侧用实扫 size+sha256 判本地复用。
- **软删 = 移入回收站笔记本**；`deleted:true` 仅用于 purge 墓碑。混合两者会破坏恢复和删除传播。
- **任何打开文档入口先判 `isGoneNote()`**：回收站/已 purge 文档必须只读并显式提示，绝不允许静默丢保存。
- **静默丢弃用户输入是最坏失败**：拦截保存必须有可见原因和出口。
- **S3 并发峰值 ≤8**：正文 2×资源 4，不要为吞吐继续加。
- **Manifest V1 重置不是兼容模式**：只读写 `{1}`，所有端一起升级；旧 `sync.ts` 已删除。

### 渲染 / UI
- 浮层列布局的固定区用 `flex: 0 0 auto`，否则内容会被列表盖住。
- **表格行里的长文本会撑开 `table-layout: auto` 的列宽**（260929 实测）：多维表分组头是 `<tr>`，长分组值把**表头首列撑到 482px**、记录行仍 80px ⇒ thead/tbody 列错位（用户报的「错位」）。表格里要放"不该影响列宽"的内容，把它**移出流**（`.bt-group-inner` 绝对定位 `inset: 0`），列宽只交给表头/记录行决定；别用 flex/nowrap 直接写在 `<td>` 里。
- **浮层定位禁止用估算高度**（260929）：统一走 `src/hooks/usePopoverPosition.ts`（量真实尺寸 → 下方优先、贴底翻上方 → 夹进视口），垂直口径是 `topMenuPosition.ts` 的 `placeVertical`。历史多处按猜测高度夹 `innerHeight - N`（48/90/300…），贴底就被裁且不翻转；`Overlay` 原语只吃调用方给的 `style`，定位责任在调用点，**新增浮层必须走该 hook**。
- **多维表底栏（`.bt-stat-row`）上沿不是常数**（260929-UI2）：它贴的是**表格视口**底部，横向滚动条会吃掉内容盒高度（实测差 10px，列多时恒有）⇒ 把状态栏钉在它上沿**必须实测**，由 BitableEditor 写 `--lake-bitable-status-bottom`、`chrome.css` 消费（同 sheet 的 `--lake-sheet-status-w` 姿势）。在 CSS 里猜高度必然要么压住底栏、要么离得老远。**在隐藏窗口（CDP 依附）里不能用 `requestAnimationFrame` 做这种实测**：`document.hidden === true` 时 rAF 不触发（本轮踩过，变量永远写不进去）。
- **量这类「贴底栏」位置要取 `position: sticky` 的那个元素（`.bt-stat-row td`），不是它的 `<tr>`**（260929 修「一个数据表有状态栏、另一个没有」）：sticky 挂在 td 上，`<tr>` 仍是 static；内容纵向溢出时 `<tr>` 停在**内容底部（视口外）**，拿它算 `innerHeight - tr.top` 得负值（实测 -231px）把状态栏顶出屏幕；不溢出的空表恰好也贴底所以看着正常。
- 预览切换先 `img.decode()` 再替换，别 `setState(null)` 造成塌陷闪动。
- 改 CSS 先找单一来源和层序；不要靠继续加覆盖层解决。改后跑 `cssLayers` + `ui-metrics`。
- **`src/styles/cssLayers.test.ts` 的基线是硬上限（只许变小）**：`features/bitable/bitableEditor.css` 已顶满 **1081/1081**。新样式一律**新建文件**并登记 `FILES`+`BASELINE`，且**必须由使用它的组件 import**（漏 import 时元素在、样式空，很难发现）。
- `content-visibility`/`contain` 不要加到 Lake 引擎层。
- 内核/第三方 inline style 是唯一允许更高层覆盖或 `!important` 的例外，且要写理由。
- 多 tab keep-alive 下，CDP 查询必须过滤可见 tab（`.bitable-editor:not(.fn__none)`），否则会命中隐藏编辑器。
- **`HoverPopover` 的悬停监听只在「挂载时」读一次 `anchorRef.current`**（`Overlay.tsx` 的两个 effect 依赖里没有锚点元素）⇒ 锚点元素会在**不重挂**的情况下被换掉时（同一组件在"有链接 ↔ 纯文本"两种形态间切换），监听仍留在**已移除的旧节点**上，表现为"悬停再也不弹"。解法 = 让浮层在锚点变化时重挂（`key` 随形态/失效态变），**不要在组件外用 ref 硬改**。261008 引用卡踩到。
- **横向 tab 一律用 `kit.css` 的页签原语 `.ln-tabs`**（260929 用户在多方案对比里选定「B 墨线 + 计数徽标」：文字 + 选中项变强调色 + **与文字等宽**的 2px 下划线压住容器的 1px 分隔线；数量放 `.ln-tabs__count` 徽标；右侧动作放 `.ln-tabs__action`）。结构 = `.ln-tabs > .ln-tabs__track[role=tablist] > .ln-tabs__item[role=tab][aria-selected]`；**已全量落地**：关联选择器、回收站、历史面板、表单编辑·预览。`.seg` / `.seg__item` 只剩「取值选择 / 图标型开关」（设置页主题三选一、小记列表·卡片版式），**不要再拿它做横向 tab**。

### 多维表（自研）
- **图片预览范围 = 单个单元格**：两列图片就是两类，绝不跨列/跨行合并；表格/记录详情/表单/看板缩略图都只预览"本格"，画册只预览"封面字段该行那一格"。
- **磁盘名绝不外显、也绝不可编辑**：`uploadResource` 对图片只回**磁盘名**（main 侧忽略请求名）、对附件回**清洗后的原始文件名**；凡把响应 `filename` 当展示名的地方都会显示成 `17xxx_ab12cd34.png`。展示名必须用**用户原始文件名**，并有统一守卫（`bitableAttachments` / `buildAttachmentPreviewItem`：缺展示名或本身就是落盘名 → 中性文案）。
- **落盘名是随机唯一**（`buildAssetFilename` = 13 位毫秒 + 8 位随机 hex），全链路**无内容去重** ⇒ 同一张图上传两次必得两个文件，不会出现"多条引用共用一份文件、删一条把别人删没"。
- **系统时间字段（创建/修改时间）必须走记录级取值口径 `bitableFieldValue(record, field)`**：它们的值不在 `values` 里；筛选/排序/分组任何一处直接读 `record.values[field.id]` 都会得到 `undefined`（表现是"排序等于没排、筛选全空"）。展示走 `bitableFieldText`（到分钟）。
- **文档图片预览列表必须取正文**：编辑态开着虚拟渲染 + `cardLazyInit`，视口外卡片不在 DOM 里 ⇒ `querySelectorAll("img.ne-image")` 会少图、切不动；内核这个构建 `allowClickToMaximize`/`previewImgs` 不可用，列表用 `extractImagesFromContent`（正文解析）。
- **只读（锁定/回收站）必须封死所有写入口**：包括视图配置下拉、视图重命名、看板配置等"非单元格"的写入点（本轮修过泄漏）。
- **表格里的 `th` 默认是 `text-align: center`**（浏览器 UA 样式）：字段头靠 `.bt-th-inner { justify-content: flex-start }` 才左对齐；表尾「新增字段」那格 `.bt-th-add` 原先没有规则 ⇒ 加号被甩到**空白区正中央**（260930 用户报「不要总是居中」）。另外 `.bt-grid th { padding: 0 }` 是 (0,1,1)、裸类名 (0,1,0) **压不过** ⇒ 改这一格要写 `.bt-grid th.bt-th-add`。它同时是「吸收表格剩余宽度」的自动宽度格：**只对齐内容、别给固定宽度**（给了会把剩余宽度摊给数据列、把列宽撑开）。
- **不要用 `el.select()` 去「让用户直接覆盖输入」**（260930）：选项编辑给新行 `focus()+select()` 想省一次全选，结果屏幕上就是**一块系统蓝底**（用户：「为什么会有蓝色的底色」）。要「键入即新值」就让输入框**本身是空的**（默认名放 `placeholder`，保存时兜底），别用选区做交互暗示——选区是系统配色、不受我们的令牌控制，也没法只对它隐藏。`focusCell`（表格单元格键盘导航）仍保留 `select()`：那是网格里既有约定的「落到某格即覆盖」，与选项编辑不是同一个语义。
- **多维表列宽：`table-layout: auto` 下 `<col style="width">` 只是「至少这么宽」**（260930 用户：「所有的列都是根据内容长度算的左右宽度，我需要能自由设置」，附件 chip 实测把 180 撑到 413）。真正卡住列的是**每个格子的 `max-width`**（按列写行内 —— 宽度来自正文数据，CSS 无法按列取值；`<col>` 上的 max-width 被忽略，`contain: inline-size` 在 table cell 上同样无效）。改列宽相关的样式时**四处都要带**：表头 `th`、记录格 `td`、分组统计格、底栏统计格 —— 漏一处就被那处的长内容重新撑开。表尾「新增字段」那格是**吸收剩余宽度**的自动列，不要给它 max-width。
- **行高必须与内容无关**（260930 用户：「不能为了展示内容而自动扩大行高。例如日期缩短了就会导致换行，而行高变大」）：`td` 上的 `height` 只是最小值，**内容一折行行高就涨**（实测日期列 80px 时 36 → 48）。所以 `.bt-grid th/td` 统一 `white-space: nowrap`（永不折行），装不下由各自的 `text-overflow: ellipsis` / 裁切处理（日期/时间格在 `.bt-date-trigger > span` 上省略；文本格靠 `input` 的 `text-overflow: ellipsis`；chip/缩略图类没有省略号语义，就是裁切）。`overflow: hidden` 在 table cell 上**不裁剪**（Chrome），别指望它。
- **附件「文档类型图标」没有现成的内核图标可用**（260930 用户问「我们是否有对应的图标样式可以使用」——**没有**）：内核 sprite 实测 **325 个 symbol，无一个 file/pdf/doc/ppt 系**（只有 `icon-card-mention-doc`）；云端那套彩色「页」图标属于**语雀 App 自己的 sprite**，不在 kernel bundle 里（同 §2 的 `note-*` 图标问题）。⇒ 用**自己的图标库 lucide-react**（全站同一套线性图标）按类型分色，类型判定收敛到 `src/core/assetNaming.ts` 的 `fileKindOf()`（单一事实源，桌面/移动端共用），颜色新增 `--lake-file-*` 令牌（只在 `themes/base.css`，内容/品牌色不随主题分叉）。`hover 名称气泡 = kit 的 .ln-tip 表面 + usePopoverPosition 定位`（`position: fixed` ⇒ 不被 `.bt-grid-wrap` 的 overflow 裁掉）。**附件字段与图片字段就此分叉**：`attachment` = 类型图标（不显示名称/缩略图）、`image` = 缩略图（该字段的语义就是看图），分叉点是 `AttachmentCell` 的 `imageOnly`。

- **样式「收编到原语」时，必须把 feature 层里那份声明删掉**（260930 大统一踩到）：层序是 `@layer … kit, shell, feature, overlay …`，**kit 层低于 feature 层** —— 只在 JSX 挂上 `.ln-iconbtn`/`.ln-menu__item` 而不删掉 feature 文件里的同名视觉声明，旧的那份照样赢（同选择器比层序）。正确姿势 = 原语给「盒子/圆角/配色/状态」，feature 只留**本处特有**的布局（绝对定位、`visibility`、卡片上的白底药丸等）。
- **正文有 32 MiB 上限**（260930 压测实测）：saveNote 超过即 LAKE_IPC_CODE:INVALID_INPUT「正文不能超过 32 MiB」。因此 50000×50（250 万格）根本存不下去，不是渲染慢的问题。
- **网格是全量 DOM 渲染、无虚拟化**（260930 AR04 压测，真实 Electron）：DOM ≈ 8.5 个/格；目标 5000×20 打开 12.4s / 84.8 万节点 / 395MB 堆 / 首次点选 2.25s；10000×20 → 24.8s / 169 万 / 1.34GB；20000×50（100 万格）200s 内未渲染完。支持 5000 级规模前需要行虚拟化/渲染策略。压测工具 scripts/bitable-stress.mjs；CDP 依附窗口隐藏，量不到 FPS，只能量挂载/DOM/堆/交互延迟。

### 工程 / 环境
- Node 必须 24；better-sqlite3 是 Electron ABI，系统 Node 不能替代运行时。
- 改 `electron/**` 或 `src/core/**` 会触发 Electron 重启；验证前确认 CDP 端口连的是新实例。
- Vite dev server 必须长驻；`nohup` 起的进程会随会话回收。
- 杀 Electron 只按唯一 CDP 端口精确定位 PID；禁 `pkill -f Electron`、`killall`。
- DSH 宿主里启动仓库 Electron 要 `env -u ELECTRON_RUN_AS_NODE`；**跑 CDP 验收还必须加 `--no-sandbox`**（否则 Chromium sandbox 初始化报 `Operation not permitted`，连锁 NetworkService/GPU crashed，实例整体退出；userData/端口本就隔离）。
- 打包版写正式数据目录；试跑必须覆盖 `LAKE_USER_DATA`，发布 smoke 用独立端口。
- **scheme 模式验收前必须 `npx vite build`**（它服务 `dist/`，否则验收的是旧 bundle）。
- **CDP 依附的窗口是隐藏的**（`document.hidden === true`）⇒ `loading="lazy"` 图片不加载；验收图片要临时去掉该属性，别误判成产品 bug。
- **隐藏/被遮挡窗口里不要用「合成鼠标拖拽」做性能验收**（261008 实测教训）：`document.hidden === true` 时 Chromium 对 `Input.dispatchMouseEvent` 的 **`mouseMoved`** 要等到出帧才回包 ⇒ 连**非边界**位置的一次移动都要 ~5s（`mousePressed`/`mouseReleased` 只要 14~18ms）。用它量「拖列宽」会把 1.4s 的真实卡顿量成 46s 的假象。**正确姿势**：改用**同步动作**计价（例如右键列头 →「自动行高」会同步跑完整表重算，`Runtime.evaluate` 的往返时间 ≈ 该同步耗时），或直接在页面里微基准化目标函数。
- **要「仿照云端」时，优先读云端前端资源而不是一个个点 UI**（260929 用户提示，已实践）：`bsk evaluate` 里 fetch `performance.getEntriesByType('resource')` 找到 `gw.alipayobjects.com/**/lakex_table_yq.*.chunk.css|.async.js`（CORS 可读），配置表/样式规则直接 grep 就有（如统计项的 types 限制、占位 hover 规则）；点 UI 只用来交叉验证。
- **用户可能与测试实例共用同一个进程/窗口**（260929 用户明确交代）：我起的隔离实例（LAKE_USER_DATA=$TMPDIR/lake-accept + LAKE_RENDERER=scheme）用户会**直接在同一个窗口里看/操作** ⇒ **不要默认 kill 实例、不要 rm -rf 该 userData**（那是他正在看的数据）；只有用户明确说「清理/重建」时才收尾。同理，验证脚本不要顺手删掉自己建的测试笔记。
- **读落盘要轮询**：自动保存有防抖，改完立刻读会拿到旧值。
- **别用 `read` 的输出重写大文件（261008 连踩两次）**：`read` 对长行/大文件会**截断或省略**（实测 503 行的 HANDOFF 只读回 196 行）⇒ 拿它的输出 `write` 回去等于**静默删掉其余内容**。改大文件一律用 `edit` 定点替换；整份回滚用 `git show <commit>:<file> > <file>` 并**立刻 `wc -l` + `grep -c "^## "` 校验**。
- **新增 CSS 文件必须由使用它的组件 `import`（261008 踩过）**：只建文件 + 登记 `cssLayers` 的 `FILES/BASELINE` **不会**让规则进包 —— 漏 import 时"元素在、样式空"，而 `cssLayers`（只数声明）与 `ui-metrics`（只看令牌/颜色）**都照过**；判据只看**产物** `grep -o "\.某类[^}]*}" dist/assets/*.css`。
- **浮层选原语：`.ln-menu` 是"竖向菜单"，`.ln-popover` 才是中性表面（261008 踩过）**：横向动作条挂在 `Menu` 上会拿到 `flex-direction: column`；再写 `flex-direction: row` 压它是**加覆盖**（违背"改单一来源"）——正解是**换回 `Popover`**，本处只留自己的布局（间距）。
- **`Overlay` 的 `surfaceClassName` 是"覆盖"不是"追加"**（源码 `surfaceClassName ?? "ln-menu"`）：传它会把白底/边框/阴影一并替掉（浮层"透明、点不到"）；要加自己的类请用 `className`（源码是 `surfaceClass + " " + className`）。
- **AI 结果回写正文：绝不「纯文本重建原选区」，也不要用 `insertAtSelection` 折叠光标做块级插入**（261005）：只用 `insertAtPosition({id,offset}, "text/markdown", …)` 插新块，原块一个字节不动；`offset` 按模型 `_parent`/`_children` 算（DOM 的「某元素之后」映射少 1）。`applyModelRange` 一类模型选区命令必须走 `kernel.execCommand`（editor 层会抛且被 try/catch 静默吞掉）。详见 `docs/LAKEX-CONTRACT.md` §5.16。

### AI 多模态（261005-MM，长期有效）
- **附件内容跨 IPC 只传引用**（`{noteId, filename}`），字节读取 / 解析只在主进程（`electron/ai/aiContentResolver.ts`）：渲染层 CSP 读不了文件；base64 过 IPC 既翻倍内存又冲垮 20 万字符预算。附件**不落正文、不进 S3 / 同步**。
- **图片 / 文档块只能出现在 `user` 消息**（供应商对 system/assistant 带图直接 400），校验在 `electron/ai/aiChatMessages.ts`。
- **PDF 只能本地抽文本**（DeepSeek 的 file / Files API 只收图片）：`electron/ai/pdfText.ts`（unpdf）；扫描件无文字层 → 明确报错，不静默发空。**Office 与 AI 生图明确不做**。

## 5. 上线与后续建议
1. 多维表专项已收口；后续只从 §3 取项并单独立项，不要恢复已完成的研究/计划文档。
2. 改同步/GC 前先读 `AGENTS.md` 原则 11~13 + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`；写 Lake 正文前读 `docs/LAKE-CONTENT-WRITING.md`。
3. 编辑器/lakex 相关先按 AGENTS §2 的检索顺序查 vendor → 官方文档 → `LAKEX-CONTRACT.md` → 源码字典。
4. 上线收尾的真实环境验收仍待做：空库双端 V1 同步、Android 真机、发布说明（见 §8 与专项之外的 backlog）。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
node scripts/ui-metrics.mjs && npm run check:core && git diff --check
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# 多维表真实端压测（隔离 userData/CDP，跑完自清；见专项 §17.12）
STRESS_SIZES="5000x20,20000x50,50000x50" node scripts/bitable-stress.mjs
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
node scripts/lake-roundtrip-check.mjs --note <id>   # 对拍「这篇一打开会不会被内核改写」（只建临时文档，退出码 1=会被改写）
```
- **UI 实测姿势（本轮全程使用，推荐）**：
  ```bash
  # 1) 必须先构建（scheme 模式服务 dist/）
  npx vite build
  # 2) 隔离开一个实例（独立 userData / 资源端口 / CDP 端口）
  env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA="$TMPDIR/lake-x" \
    LAKE_ASSET_PORT=19890 ./node_modules/.bin/electron --disable-gpu --remote-debugging-port=9230 .
  # 3) 取 page target，用 Node 24 内置 WebSocket 直驱 Runtime.evaluate / Page.captureScreenshot
  curl -s http://127.0.0.1:9230/json/list
  ```
  详见 `docs/CODEX-GUIDE.md`。注意 §4 的三条坑（重建、可见元素、lazy 图片）。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8**。

## 7. 文档索引（`docs/` 按需查）
- **契约/规格（单一来源）**：`STORAGE-LAYERS.md`（存储分层 + 设备本地契约）· `SYNC-PROTOCOL.md`（同步协议 V1 重置）· `S3-GC-DESIGN.md`（存储/删除 GC）· `HISTORY-DESIGN.md`（历史快照）· `TRASH-NOTEBOOK-DESIGN.md`（回收站）· `QUICK-NOTES-SPEC.md`（小记）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md`（当前唯一移动端架构规格；旧 `ANDROID-TECH-SCHEME`/`ASSET-URL-MOBILE-PLAN` 已删）。
- **UI/工程规范**：`scripts/css-audit/README.md`（样式层）· `PANEL-CONTRACT.md`（面板几何/层序契约）· `UI-PRIMITIVES-PHASE1-260926.md`（浮层原语）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端速查（完整端）

- 正式端：Capacitor Android，包名 `com.lakenotes.mobile`；定位为完整端，桌面红线同样适用。
- 数据在模拟器 App 沙盒，不在 macOS 数据目录；开发可 `adb shell pm clear com.lakenotes.mobile` 重建。
- AVD：`lake_mobile`（Pixel 6 / API 36 / arm64）；SDK 在 `/opt/homebrew/share/android-commandlinetools`。
- Node 24；Android 脚本已内置 JAVA/SDK 环境。

### 常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts
bash scripts/android-build.sh --sync --install
bash scripts/emu-cdp.sh
bash scripts/emu-up.sh
bash scripts/mobile-preview.sh
```

### CDP / 编辑器
- App 重启后 WebView socket 会变化；重新 `adb forward` 后再连 `/json/list`。
- 活跃 Lake 实例暴露为 `window.__mobileEditor`；命令用 `renderer.execCommand`。
- 有效命令：`bold`、`unorderedList`、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style("p"/"h1"/"h2")`、`undo/redo`。
- 无效/易错命令：`insertUnorderedList`、`formatBlock`、`heading`、`strike`、`justify*`、`clearFormat`、`fontsize`。
- 工具栏按钮必须 `onMouseDown preventDefault`，否则抢焦点导致命令 no-op。
- 面板与 IME 必须用 visualViewport 实测状态互斥；不要跟内核异步重聚焦赛跑。
- 真机可能是 edge-to-edge，模拟器是 adjustResize，二者都要覆盖。

### 多维表只读（260929 补齐 + Android 模拟器验收）
- 单元格按字段类型给**只读控件**（不再是裸文本）：布尔=禁用复选框、链接=`<a target="_blank">`（外部 origin 走系统浏览器）、评分=5 星、进度=条+百分比、关联=目标记录主字段 chip、附件/图片=缩略图、单选/多选=色块；其余走 `bitableFieldText`（系统时间到分钟）。
- 非 grid 视图（看板/画册/日历/未知类型）仍走「明确提示 + 表格只读」，不空白、不改数据。
- **验收姿势**：`android-build.sh --sync --install` → `emu-up.sh --no-window` → `emu-cdp.sh 9335` → 连 `http://127.0.0.1:9335/json/list`（Node 内置 WebSocket 直驱 `Runtime.evaluate`）。
- **造数据**（模拟器是全新安装、库里 0 条）：DB = `databases/lake-notes-mobileSQLite.db`；`notes` 表写 `doc_kind='bitable'`、`content=<正文 JSON>`、`parent_id='notebook-personal'`（**必须挂到笔记本**，否则首页点开会提示「未找到该文档所属笔记本」）。改法：force-stop → `exec-out run-as … cat` 拉出 db/wal/shm → python sqlite3 写 + `PRAGMA wal_checkpoint(TRUNCATE)` → push 回 + 删 -wal/-shm → 重启 App。
- **点开笔记必须用真实点按**：首页最近文档是 `<button class="doc-card">`，CDP 里 `el.click()` **不触发**导航（页面不动），要用 `Input.dispatchMouseEvent` 在元素中心 mousePressed/Released。
- 已验收（模拟器 lake_mobile，Pixel 6 / API36）：`移动多维表`（全字段）断言 bool=[true,false] 且 disabled、链接 href/target 正确、评分星数=[4,2]、进度=60%/0%（条宽一致）、关联 chip=[目标A,目标B]/[目标B]、创建时间到分钟、只读徽标；`移动看板表` 显示「「看板视图」桌面已支持，移动端暂以表格只读展示。」

### 261008 续 · 本轮三修（移动端）

- **大纲手势按文档类型收敛**：表格 / 多维表 / 画板**没有大纲**，左滑不再拉出空面板 —— `usePanelDrag` 新增可选 `canOpen(side)`（只约束「打开」，已展开的仍可滑走关闭），判定走共享纯函数 `gestureCore.swipeTargetSide`；口径 = `(active.kind ?? "doc") === "doc"`（与顶栏「编辑」按钮同一条），切到无大纲类型时自动收起已展开的大纲抽屉，底栏「大纲」按钮同时置灰。**右滑开目录不受影响**。
- **「更多 → 新建文档」建好不跳转（真 bug）**：`NotebookWorkspace` 的组件 key 是 `notebookId`，同一笔记本内再指定文档**不会重挂载**，而「初次进入」那段 effect 有 `autoOpenedRef` 守卫 ⇒ 新的 `initialNoteId` 被忽略（现象：文档已进 DB、界面不动）。修法 = 加 `handledInitialRef`，在 `initialNoteId` 变化时显式 `openTab`（并按 `initialMode` 决定是否进编辑态）。
- **`emu-cdp.sh` 取错 WebView socket**：socket 名带的是**宿主进程 PID**，App 重启后旧 socket 仍挂在 `/proc/net/unix`，原来的 `tail -1` 会取到旧的 ⇒ `/json/list` 恒空、`check:mobilesnap` 直接报 `no page target`。改为优先按当前 App PID 精确取、取不到才回退，并在转发前 `forward --remove` 清旧映射。
- 门禁：`npm run check:mobilesnap` **6 态 0 差异**；桌面 tsc / vitest 全绿。

### 当前剩余验收
- V1 空库多端同步：创建/编辑/删除/恢复/GC。
- 真机：图片与附件、编辑保存、同步后图片加载、键盘安全区。
- 数据导出/导入、剪贴板粘贴、长文档大纲跳转。
- 缩略图目前仅 png/jpg/jpeg，失败会回退原图。
- ~~多维表只读控件（布尔/链接/评分/进度/关联/时间）~~ 260929 已在模拟器验收；真机复验仍可做。
