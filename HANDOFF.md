# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接（261008 → 261007）

> 写给完全没有上下文的新会话。接手顺序 **README → HANDOFF → AGENTS**。**本节只保留最新 1–2 批（261008 / 261007）**；更早的 dated handoff 已删除，只在 git 历史可查（`git log -p --follow HANDOFF.md`）。文中提到的「专项文档」= 已删除的 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`。**真正的待办看 §3，长期坑看 §4，移动端看 §8。**
>
> **下一会话焦点：无指定项** —— 从 §3 取（261008 最近两批：① 表格暗色模式 + 文档分屏 + 表格图标/换行/粘贴归属；② **云端对齐批**：字体统一 / 右键精简 / 颜色入口重做 / 小数位± + 导出修复 + 云端对齐调研）。**唯一已知遗留** = 多标签切换时内核工具条 1~4 帧绘制空帧，见 §3#9（诊断与可行方向已写全，别重复试提层类改动）。

### 261008 续 · 大表格粘贴 A+B 兜底（已交付）

- **A 护栏**：粘贴的 HTML 表格 **> 500 行或 > 3000 格**时**不发生给内核**（`document` 捕获阶段 `preventDefault + stopImmediatePropagation`，见 `clipboardHtml.ts`），改为弹明确提示；**剪贴板内容保留、绝不静默丢弃**（AGENTS §3#16）。
- **B 兜底**：提示里一键「**存为表格文档**」= 解析该表格 → `createSheetIn` 建表格文档写入 → 在光标所在块之后插入一张「**文档引用**」卡（复用 R2 的 `lake-note-ref`，`insertAtPosition` + `text/html`，落点用捕获的内核模型选区）。
- **落点**：`src/features/editor/tablePasteGuard.ts`（阈值/计数/解析成 sheet 正文/卡片 HTML/事件通道）· `TablePasteGuardDialog.tsx`（提示 + 一键）· `clipboardHtml.ts`（拦截接线）· `App.tsx`（挂载 + 注入 parentId）。
- **真实端实测**（隔离实例 + CDP，5500 行 × 6 列 / 1.5MB HTML）：同步阻塞 **30,743ms → 2ms**（wall 48ms）；文档未被塞进表格（`ne-table-hole: 0`，DOM 仅 +18 = 对话框）；提示文案含 `5500 行 / 33000 个单元格` 与「已阻止本次粘贴，剪贴板内容保持原样」；点「存为表格文档」后**库里新增 1 篇表格文档**且宿主正文出现 `<card name="customBlock" customName="lake-note-ref" value="data:{"$name":"lake-note-ref","noteId":…">` ✓。
- 门禁：tsc ✓ · vitest **1772 passed / 16 skipped** ✓（新增 7 条：`tablePasteGuard.test.ts` 5 条纯逻辑 + 2 条接线护栏）· ui-metrics ✓ · check:core ✓ · 双端构建 ✓ · `git diff --check` ✓。
### 261008 续 · 「文档引用」卡（R2）

- **用户诉求**：在文档里"插入同目录的表格"。调研结论（§2 三级检索 + bundle 排查）：**内核没有现成卡**——云端那张「插入可访问的语雀内容」（`/yq`）是**拉语雀线上内容**、本地无解析通道；`mention` 在本构建的分组里**被注释掉**；`localDoc` 是「本地文档（上传文件）」卡。⇒ 只能自建，按官方**配置式自定义卡片**做了 **「文档引用」卡**（R2）。
- **能力**：`/`（实际入口是工具栏「+」面板）里的 **文档引用（/doc）** → 插入**区块引用卡** → 选择同库任意文档（**文档 / 表格 / 多维表 / 画板**都一样，只存引用元数据、不内嵌渲染）→ 点击标题打开对应标签页；目标被删/进回收站/purge → **「文档已删除」失效占位**。
- **落点**：`src/features/editor/noteRef.ts`（纯逻辑：`lake-note://<id>` 约定、解析、宿主注册表、`isGoneNote` 失效判据、斜杠接线，可单测）+ `noteRefCard.tsx`（React 卡 + 选文档浮层，复用 kit/`Overlay` 原语）+ `noteRefCard.css`（新文件，已登记 cssLayers 基线 28）+ `lakeRuntime.ts`（`registerNoteRefCard(mergedOptions)` 必须在 `prepareCustomCards` 之前；斜杠项加进「小工具」组）+ `App.tsx`（`setNoteRefHost({ listNotes, openNote })` 注入宿主：卡片在内核 React 树里，拿不到应用 context）。
- **契约与坑已回填** [docs/LAKEX-CONTRACT.md](docs/LAKEX-CONTRACT.md) **§5.23**（字段契约、`custom-${name}` 命名与分组 items 必需、「小工具」组 name 重名只能按 title 找、工具栏面板才是可靠入口、面板内部滚动要先 scrollIntoView、`.lake` 序列化形态、React 实例共享但无 context）。
- **真实端验收**（隔离实例 + CDP 全链路）：面板里出现 `/doc 文档引用` ✓ → 插入后显示"选择文档…" ✓ → 浮层列出 3 篇、选中「被引用表格」✓ → 卡片显示 `被引用表格 表格 换` ✓ → **点标题打开表格标签页且 `sheetOpen:true`** ✓ → 落盘 `<card name="customBlock" customName="lake-note-ref" value="data:…lake-note://<sheetId>…">` ✓。
- **261008 二改（用户要求「完全复刻内核链接那套」）——最终形态**：卡片 = 类型图标 + 展示名（正文用内核 `.ne-link` 类渲染，样式与链接同源）；
  **点击卡片**在下方出**白底动作条**（访问 / 编辑 / 复制 / 取消链接）；点「编辑」出**锚定在卡片旁**的编辑浮层（**文本** / **链接** 两字段 + **确定**，复刻内核链接编辑，**不是全局弹窗**）；「取消链接」= 清引用、保留展示名并渲染成纯文本；阅读态只给读操作。
  · 落点：`noteRefCard.tsx`（卡片 + 三个浮层）· `noteRefCardActions.css`（**只留本处布局**：图标行间距 + 编辑字段「标签在上」）· 基线 13 → **7**。
  · **三条根因（别再往"加覆盖"方向想）**：① 浮层曾用 `surfaceClassName` **覆盖**表面类 ⇒ `.ln-menu` 的白底/阴影被替掉（"透明、点不到"）⇒ 改用 `className`（**追加**）；
  ② 新建的 CSS **忘了在组件里 import** ⇒ 规则根本没进包（AGENTS §14 写明的坑）⇒ 补 import；③ **动作条用错原语**：`.ln-menu` 是"竖向菜单"（自带 `flex-direction: column`）
  ⇒ 换 **`Popover`**（中性表面），本处只写 `display:flex; gap`，**不再写任何 flex 覆盖**。
- 门禁：tsc ✓ · vitest **1773 passed / 16 skipped** ✓（`noteRef.test.ts` 8 条 + `tablePasteGuard.test.ts` 7 条纯逻辑/护栏）· ui-metrics ✓ · check:core ✓ · 双端构建 ✓ · `git diff --check` ✓。
### 261008 续 · 表格（编辑态一致性 / 默认字号 / 缩放 / 行高性能）+ 大表粘贴压测

- **编辑态与展示态不一致（用户报「编辑时字号大、行高/换行对不上」）—— 真因是字体族，不是字号**：
  粘贴进来的数据几乎每格都显式带 `ff: 0`（**数字 = 内核 `fontarray` 下标**，而 `fontarray[0] = "Times New Roman"`）
  ⇒ **画布按 Times New Roman 渲染**，而编辑框（CSS 定死 MiSans 13px）与我们的行高估算（`estimateWrappedRowHeight` 用 MiSans）
  完全是两套字体 ⇒ 观感不同 + 换行点不同 ⇒ 行高也对不上。修：新增 `needsGlobalFont()`，把 `null` / 旧多族串 /
  **数字或数字串**三类 `ff` 一律归一化成 `MiSans`（加载时 `withCellDefaults` + 首可见 `setCellFormat` 两处）。
  **实测**：造 `ff:0` 的表 → 打开保存后落盘 `ff: "MiSans"`（120/120）。
- **「表格默认字号加1」此前完全没生效**：数据里每格都显式 `fs: 10`，只改内核 `defaultFontSize` 影响不到它们。
  修：新增 `needsDefaultFontSize()`（`LEGACY_DEFAULT_FONT_SIZE = 10`）→ 归一化成 `SHEET_DEFAULT_FONT_SIZE`(11pt)。
  **实测**：`fs: 10 → 11`（90/90）。
- **默认缩放回 100%**：`DEFAULT_SHEET_ZOOM` 1.1 → 1；并把**旧默认 1.1 视为"没自定义过"**（`LEGACY_DEFAULT_ZOOM`），
  否则本机记忆里的 1.1 会一直生效、改默认值等于没改。实测新表 `100%`。
- **编辑框按单元格 `vt` 垂直对齐（内核补丁）**：`getStyleByCell` 其实把 `vt` 映射到**编辑框容器**的 `align-items`，
  但子元素 `.luckysheet-cell-input` 是 `height:100%` 撑满 ⇒ 对齐永远失效、编辑态恒顶部（用户报「展示底对齐、一编辑变顶对齐」）。
  补丁把对齐落到真正承载文本的子元素（`display:flex; flex-direction:column; justify-content:<vt 映射>`），与画布
  `normalizedCellAttr(cell,"vt")` 同口径。**⚠️ 必须同时打 `dist/index.esm.js` 与 `dist/index.js`**（vite 用前者）。
- **行高重算性能（用户报「拖列宽卡好几秒」）**：`estimateWrappedRowHeight` 原来**每格 createElement+getContext**
  ⇒ 表格66（5453 行 / 32718 格）一趟 **2530ms**（getContext 占 578ms）。改为模块级共享离屏 canvas + `measureText` 缓存
  （32718 格 4~17ms，≈150×）；端到端同一动作 **1434ms → 119ms**。另把**全表重算的静默窗口**放到 400ms（拖列宽停手后只跑一次）、
  并修「全表请求被后续选区请求降级」的老 bug；`AUTOSAVE_DEBOUNCE_MS` 800 → 1500。
- **大表格粘进「文档」会把窗口卡死（用户 261008）→ 是内核问题，A+B 待办见 §3#16**：脚本
  [scripts/table-paste-stress.mjs](scripts/table-paste-stress.mjs) 可复现量化（5500 行 = 同步阻塞 **30.7s** / 269k DOM 节点）。
- 门禁：tsc ✓ · vitest **1757 passed / 16 skipped** ✓ · ui-metrics（字号字面量 0 / 颜色 0 / `!important` 9）✓ ·
  check:core ✓ · 双端构建 ✓ · `git diff --check` ✓。
- **本批踩的三个坑**（写进 §4）：① 补丁替换漏结尾逗号 ⇒ 包语法错误 ⇒ 构建失败，而**只看 `tail -1` 会误判成功**（那是 main 进程输出）；
  ② `@fortune-sheet/react` 的 vite 入口是 `module=dist/index.esm.js`，只打 CJS 等于没改；③ 生成的补丁文件里"行内容恰为一个空格"
  被 `git diff --check` 判为行尾空白 ⇒ 按既有先例在 `.gitattributes` 给 `patches/*.patch` 关掉该项。

### 261008 续 · 云端对齐批（`e78c4bd` 字体+导出 / `4c3473e` 表格）

- **字体全量统一（用户「彻底检查一遍」）**：把两个第三方样式里**所有** font-family 值（44 种）抽出来逐条定性 ——
  UI 文本一律接 `--lake-font-family`、等宽接 `-mono`；抓出并修掉**我们自己**写死的一处（小记写作区）；
  表格单元格 canvas 从「多族串被内核当**单一族名** ⇒ 实际渲染 Helvetica Neue」改成单族名 `MiSans`，旧值打开即归一化。
  **护栏** [fontUnification.test.ts](src/styles/fonts/fontUnification.test.ts)：44 种栈必须登记 / 接管 marker 必须在 / 我们自己的 CSS 不许出现字体字面量。机制与坑见 [TROUBLESHOOTING §O](docs/TROUBLESHOOTING.md)。
- **导出页不再引用应用令牌**：`wrapHtmlPage` 里 `var(--lake-radius-2xs)` 等三条在独立页面无定义 ⇒ 引用块竖线直接消失；
  改 light 主题字面值 + 护栏「导出页不得出现任何 `var(--`」。
- **表格右键精简**：去掉 排序/筛选 4 项 + 插入链接 + 隐藏·显示行列（内核 `hide-row`/`hide-column` **各渲染两行**）；
  顺手删掉内核**不渲染**的死键（`delete-cell`/`chart`/`data`/`cell-format` —— 内核默认清单里就带死键）；标签菜单去掉「向左移/向右移」。
  口径见 [TROUBLESHOOTING §P](docs/TROUBLESHOOTING.md)（哪些 key 真会渲染、别把死键写进清单）。
- **颜色入口重做**（用户报「选完颜色展示错乱」+「标签更改颜色点不动」）：改成**宿主自绘**两个按钮 ——
  图标 = 云端字形（[sheetColorIcons.tsx](src/features/sheet/sheetColorIcons.tsx) 由 `scripts/sheet-color-icons.py` 生成；
  **包装组 `scale(0.09375)` 必须真的包住子元素**，写成自闭合就是空图标）· 色条按当前格颜色 · **分体交互**（点图标=上次颜色 / 点三角=选色盘）·
  记忆复用「最近使用」桶；三处入口共用 [components/ColorPalette.tsx](src/components/ColorPalette.tsx)（从多维表上提，bitableCells 继续 re-export）；
  标签颜色走补丁新增的 `setSheetColor` + `hooks.onSheetTabColor`；**浮层一律用坐标锚点**（右键菜单项点完会卸载，否则选色盘贴左上角）。见 [TROUBLESHOOTING §Q](docs/TROUBLESHOOTING.md)。
- **小数位 ± 自建**：内核这版 `number-decrease/increase` 是死键（只有图标、渲染器没分支）⇒ 自建两个 custom item +
  `adjustDecimals()`（只认纯数字格式；General 增位 → `0.0`；日期/文本不动），单测 10 条。
- **云端对齐调研**：见 §3#15（Edge 实机走查云端表格的编辑态 + 阅读态，逐条列出差距与优先级）。
- 门禁：tsc ✓ · vitest **1745 passed / 16 skipped** ✓ · ui-metrics（hex=0/rgb=0/`!important`=9/未定义令牌=0）✓ ·
  check:core ✓ · 双端构建 ✓ · bundle budget ✓ · `sheet-icons --check` 0 待改 ✓ · `git diff --check` ✓（补丁重建后做过「反向+正向应用 → 逐字节一致」复验）。


### 261008 三次反馈 · 表格「第一遍 Cmd+V 丢」结案 + 自动行高实测

- **粘贴（用户 261008：「第一遍 cmd+v 没生效、第二遍才好」「闪烁了一下没有内容」）—— 已结案**：真因 = `@fortune-sheet/core`
  的 `selectionCache` 是**模块级单例**（所有 Workbook 共用），而 react 侧 `onPaste` 是**每份挂载的 Workbook 各在 `document`
  上挂一个**监听、判据只看 `document.activeElement.className === "fortune-sheet-overlay"` ⇒ **多标签常驻挂载时，隐藏的那份
  表格也命中判据**，抢先把 `isPasteAction` 消费掉、把剪贴板内容写进**它自己**那张表；活动表格这一遍 `handlePaste` 空转，
  但 react 侧的**插行是另一条 state 更新、不看这个标志** ⇒ 行被撑开、内容为空（= 用户看到的"闪烁一下没内容"）；第二遍
  之所以好，是隐藏实例第一遍后 data 变了 → `useEffect` 重挂监听 → 它排到最后。
  **修法（只动 react 补丁一处）**：判据加 `workbookContainer.current?.contains(document.activeElement)`（限定在本实例容器内）。
  **同轮撤回两处错误尝试**：① core 里放宽为 `if (selectionCache.isPasteAction || e.clipboardData || window.clipboardData)`
  —— 那会让**每个挂载实例各自粘一遍**（隐藏表格也被写入）；② 把插行并进同一次 `setContextWithProduce` —— 单实例路径本来就
  按序 flush（一次 Cmd+V 就能落 300 行），合并**不解决**问题，只是多一处与上游的偏离。
  **实证（隔离实例，300 行 HTML 表格 → 空表、一次 Cmd+V）**：修前 活动表 `row 300 / celldata 0`（丢）+ 隐藏表
  `celldata 1500`（被写入）；修后 活动表 `row 300 / rowlen 300 / celldata 1500`、隐藏表 `celldata 0`（不动）；单标签场景
  两版都正常。**复现三要素（缺一不复现）**：≥2 份挂载的表格实例（两个表格标签页）+ 剪贴板带 `text/html` 的 `<table>`
  （纯文本时内核 `trs=0`、走不到插行分支）+ 焦点在目标表的 overlay。机制/复现姿势见 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §N。
- **右键「自动行高」实测**：菜单项在（`复制/粘贴/插入行/行高px/自动行高/…`），refit 生效 —— 手动把第 1 行设成 300px
  （`rowlen[0]=300, customHeight={"0":1}`）→ 点「自动行高」→ `rowlen[0]=117`（= 长 URL 换行后的真实高度）。⚠️ 已知余量：
  内核没有清 `customHeight` 的公开 API，标记会留着 ⇒ 之后「只涨不缩」的自动触发仍跳过该行，直到列宽变化或再点一次
  （要彻底恢复自动得往 config 删这个键，独立小项，见 §N）。
- **护栏**：`sheetEditorMount.test.ts` 新增一条（react 补丁必须含 `contains(document.activeElement)`，且 core 补丁不得再出现
  `isPasteAction || e.clipboardData`）；`AGENTS.md` 新增长期口径「内核里的模块级单例状态 × 多实例挂载会串台」。
- 门禁：tsc ✓ · vitest **1731 passed / 16 skipped** ✓ · ui-metrics（hex=0/rgb=0/`!important`=9）✓ · check:core ✓ ·
  sheet-icons `--check` 0 待改 ✓ · `git diff --check` ✓ · 双端构建 ✓；补丁做「干净包重打 → 与 node_modules 逐字节一致」复验 ✓
  （core 仅 `tb` 缺省 `"2"`；react = 云端图标 + 右键菜单图标 + 内核级只读 + 粘贴归属）。

### 261008 续 · 表格图标换云端 lakex + 右键菜单图标 + 选中色/把手回归 + 移动端三修

- **用户四条现场反馈的收口**（全部"只改样式、不动功能"）：
  · **表格选中色**：258380d 把 `.luckysheet-cell-selected` 的**填充**也换成了主题色 `--lake-accent-tint`，暖色主题（accent 本身是橙）下选区整片发橙。按既有口径（`themes/base.css` 里 `--lake-select-bg` 的注释：**填充固定、边框主题色**）改回 `--lake-select-bg`，边框仍留 `--lake-accent`。三主题实测填充恒为 `rgba(63,95,160,.16)`。
  · **冻结把手 / 改列宽抓手 / 冻结拖拽线退回内核默认**（用户 261008 定稿）：这三样是**拖拽把手、不是选中语义**，258380d 把它们染成 `--lake-accent`，暖色下网格左上角挂两条橙角标 ⇒ 删掉那两条规则，用内核默认（把手 `#ddd`、拖拽线 `#ccc`、改宽线 `#0188fb`，后两者本来就只在悬停/拖拽时显现）。**别再改回主题色**（AGENTS §3#14 已入档）。
  · **工具栏/右键图标换成云端 lakex 表格的图标**（用户 261008 定稿）：先做过一版 **lucide 线性图标**，被用户否掉（「很丑而且不直观」）——**用户要的"内核"指 lakex Lake 内核**（与云端表格同一套产品），不是 FortuneSheet 那套 Excel 血统。最终做法：云端表格工具栏用的是**阿里 iconfont 项目 `lake-icon`（font_943843）**，把用得到的**字形轮廓**抽成 `scripts/sheet-icons.cloud.json`（24 网格、Y 已翻转、纯 path）写进 vendored sprite；云端没字形的（**文字颜色 / 背景色**）用**云端内联 SVG**；**边框族**用**云端的 svg 资源**；两边都没有的**保持内核原样**。共覆盖 **76/102** 个 symbol，其余 26 个保留内核原样（清单与坑见 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §M）。图标盒仍是 18px（= 云端实测 14.5px 墨迹高度）、下拉箭头 12px。
  · **右键菜单补图标位**：内核 `Menu` 只渲染文案 ⇒ 补丁给 `Menu` 注入「图标 + 文案」，容器两处 `map` 外挂装饰器（`cloneElement` 补 `menuKey`）；**不动条目、不加"快捷键提示"**（我们的键位与语雀不同，写上去就是编造）。菜单右侧 `7em` 留白（原本给子菜单箭头）收到 18px ⇒ 宽度 269 → 196px。
  · **对齐 / 换行族逐项校正（用户 261008 现场比对）**：① **对齐用的不是字体的 `align-*`**（那是"框+竖条"样式）而是 **`left/center/right` + `top/middle/bottom` + `justify`**（≡ 样式，= 云端工具栏 `lake-icon-left/-middle` 那一族）⇒ 外层按钮与下拉项同时校正；② **下拉项要「图标在前、文案在后」**（云端如此，内核默认 `space-between` 把文案顶左、图标甩最右）⇒ 一行 CSS（`.fortune-toolbar-combo-popup .fortune-toolbar-menu-line` 的 `row-reverse`）改排布、不动 DOM。
  · **表格「自动换行」四条一起收口（用户 261008 报）**：① **根因**：内核只在 `updateCell`（**单格编辑提交**）那条路上算行高，且要求该列宽 **或** 该行高**从未被显式设置过**；**粘贴、改列宽、打开已有文档都不走那条路**。② **内核默认 `tb` 是 `"0"`（截断）**，与本产品默认（自动换行）不符 ⇒ 粘贴进来的单元格**既不换行、也不被内核自适应认到**。**已改内核补丁**：`normalizedCellAttr` 里 `tb` 缺省 = `"2"`（`tr` 仍 `"0"`）—— 粘贴/新写入**立即换行**。③ **行高自适应** = `SheetEditor.syncAutoRowHeights(rows)`（只涨不缩；缺省 tb 当自动换行；用户手动调过的行按 `customHeight` 跳过），触发点 = 单格提交 / `onOp`（节流 160ms）/ **列宽变化 → 整表所有有内容的行**（用户明确「需要全都算」，用列宽快照比对触发）/ 首次可见（吃老文档）。④ **右键新增「自动行高」**：走 `customToolbarItems` 的兜底渲染（该 key **不在** `TOOLBAR_ITEMS` 里 ⇒ 只出现在右键菜单），点它 = 整表重算；菜单图标用 sprite 的 `cm-move-vertical`。护栏见 `sheetEditorMount.test.ts`；机制见 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §N。
  · **选区「两边颜色不同」（用户 261008 报，附图为证）**：选区边框走 `--lake-accent`，但**行列头的「当前选区」指示线**是内核硬编码的 Luckysheet 蓝（`#0188fb`）⇒ 同一圈选区上/左边是蓝、下/右边是主题色。取色定位到 `fortune-col-header-selected` / `fortune-row-header-selected`（用户截图里蓝是 `#0088fb`、橙是暖色 accent `#d45500`）⇒ 连同"延长/移动选区"两个叠加框一起映射到 `--lake-accent`，**只改颜色、不动内核的宽度与位置**。
  · **右键菜单焦点环**：菜单项是 `div[tabindex]`，不在 `tokens.css` 那条 `:where(button, input, …)` 焦点规范里 ⇒ 内核 `focus()` 第一个菜单项时浏览器画**它自己的默认环**（深色下是橙色 `rgb(229,151,0)`，与主题无关）。收编到项目同一套 `--lake-focus-ring-*` + `--lake-accent`。
- **单一来源**：`scripts/sheet-icons.mjs`（映射表 + 生成器；幂等、`--check` 干跑）→ 改 node_modules → `PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" npx patch-package @fortune-sheet/react` 重建补丁。机制与三个坑见 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §M。
- **验收**：真实 Electron 三主题（浅/暖/深）；把**全部 101 个 symbol** 渲染成对照表逐个确认无空图；**全新安装复验**（移走包 → `npm install` → 补丁自动打上、菜单改造 + 只读改动都在）。
- 门禁：tsc ✓ · vitest **1729 passed / 16 skipped** ✓ · ui-metrics（hex=0 / rgb=0 / `!important`=9）✓ · check:core ✓ · `git diff --check` ✓ · cssLayers 基线 `sheetEditor.css` **150 → 147**（菜单图标 +13、把手退回 −3；理由写在该文件注释里）。
- **移动端三修**（明细见 §8）：表格/多维表/画板不再能被左滑拉出空的大纲面板；「更多 → 新建文档」建好不跳转（`NotebookWorkspace` 没响应 `initialNoteId` 变化）；`emu-cdp.sh` 改成按 App PID 取 WebView socket（旧 socket 残留时会连到死 socket、`/json/list` 恒空）。
- **状态**：本批已提交并推送 `origin/master`（`186ce93` 表格图标/换行/粘贴归属 + `eb5e2bc` 移动端三修；用户 261008 明确授权提交推送）。

- **261008 二次反馈的两改**：① **行高改为「可涨可缩」**（`refit`）：右键「自动行高」= 真·自适应 + 忽略 `customHeight`，列宽变化 = refit，其余自动触发仍只涨不缩 —— 用户「点了自动行高没生效」多半就是旧版只涨不缩（他们的行本来偏高）。② **第一遍 Cmd+V 整块丢（用户「要按两次 / 闪烁一下没内容」）已结案**：根因 = `@fortune-sheet/core` 的 `selectionCache` 是**模块级单例**，而每份挂载的 Workbook 各在 `document` 上挂一个 paste 监听、判据只看 `document.activeElement.className === "fortune-sheet-overlay"` ⇒ **多标签常驻挂载时隐藏的那份表格抢先把 `isPasteAction` 消费掉、把数据写进自己的表**；活动表格这一遍空转但**插行照样发生**（另一条 state 更新）⇒ 行被撑开、内容为空、第二遍才好（隐藏实例第一遍后重挂监听排到最后）。**修法只在 react 补丁**：判据加 `workbookContainer.current?.contains(document.activeElement)`，**core 回到内核原样**（曾试过的「core 放宽判据」会让每个挂载实例都粘一遍，已撤回；同期「把插行并进同一次 setContextWithProduce」也一并撤回 —— 单实例路径本就不复现）。护栏 `sheetEditorMount.test.ts`；机制/复现姿势/修前修后数据见 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §N。

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

### 261008 · 表格（FortuneSheet）暗色模式（§3#14 收口）

- **从「暗壳 + 白格」做到真暗**：§3#14 原「方案 A」只覆盖 DOM 外壳；本轮把 canvas 也纳入 —— 单元格区/行列头是同一个 `<canvas>` 画的（`.fortune-container` 的 CSS 白底被 `drawMain` 覆盖），网格线与正文默认色走模块级可变的 `defaultStyle`。
- **落点（全部展示层，零数据风险）**：
  · `patches/@fortune-sheet+core+1.0.4.patch`：新增 `defaultStyle.cellBgStyle/headerBgStyle` + `syncLakeSheetCanvasTheme()`（读 `--lake-bg-canvas`/`--lake-bg-subtle`/`--lake-text-1`/`--lake-border-1`），挂在 `updateContextWithCanvas`；`drawMain`/`nullCellRender`/`cellRender` 的写死底色、两处表头底色与字色、`normalizedCellAttr("fc")` 的黑字默认全部改读 `defaultStyle`。**不写正文 / S3 / 历史 / 撤销栈**。
  · `patches/@fortune-sheet+react+1.0.4.patch`：图标是 `<symbol>`+`<use>` shadow 树、文档 CSS 打不到 `fill` ⇒ 把 `SVGDefines` 里 11 个图标色值（186 处）改成 `currentColor`，由 `.fortune-toolbar-button { color: var(--lake-text-2) }` 驱动。
  · [sheetEditor.css](src/features/sheet/sheetEditor.css)：DOM 外壳（工具栏/浮层/工作表标签/选区/编辑框/遮罩/局部弹窗/输入框）映射到 `--lake-*`（第三方组件是「自有设计系统」的合法例外，几何沿用内核）；cssLayers 基线 64 → 133。
  · [SheetEditor.tsx](src/features/sheet/SheetEditor.tsx)：观察 `data-theme` + 首次可见后补发 `window.resize` 让 canvas 重绘。⚠️ **用 `setTimeout` 不用 rAF**（隐藏窗口里 rAF 不触发会漏同步 —— 实测踩到）。
- **验收（真实端 scheme 构建 + 隔离 userData）**：三主题热切换 canvas 采样 = light `#fff`/`#fafbfc`、warm `#fff`/`#faf9f7`、dark `#1e1f23`/`#232528`；网格线 dark `#2d2f34`；右键菜单/数字格式下拉/查找对话框/单元格输入框全暗；选区 = `--lake-accent` + `--lake-accent-tint`；**切换前后正文文件 sha256 不变**。
- 门禁：tsc ✓ · 全量 vitest **1720 passed / 16 skipped** ✓ · check:core 76-0 ✓ · ui-metrics（hex=0/rgb=0/`!important`=9/未定义=0）✓ · cssLayers+uiPrimitives ✓ · 双端构建 ✓ · `git diff --check` ✓。新增护栏 [sheetCanvasTheme.test.ts](src/features/sheet/sheetCanvasTheme.test.ts)（4 条）。机制与坑见 [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) §K。
- 顺手修 [check-bundle-budget.mjs](scripts/check-bundle-budget.mjs) 的两处漂移：① 画板分块目标由已不存在的 `drawnix-*.js` 改为实际懒加载分块 `DrawnixBoardCore-*.js`（260923 手拆 chunk 会破坏 @plait vendor 绑定，已删）；② 入口 `app-js`/`app-css` 改为从 `dist/index.html` 解析（原先 `index-*.js` 的 `find` 会挑到 ~11KB 辅助 chunk，真入口根本没被守）。修后实测：app-js gzip 1.84MB/2.9MB · drawnix gzip 232KB/1.4MB · app-css gzip 301KB/2MB，退出码 0。
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
- ⑥ **表格「当前工作表 + 缩放」改本机 + 修「选区误标脏」**（用户 261006 审计「只改展示不得触发 S3」的落地）：① `sheetsToBody` 新增 `LOCAL_SHEET_KEYS`，把 `status`（当前工作表）/`zoomRatio`（缩放）从正文剔除，改存 `lake-notes-v3.sheet-views.<noteId>`（新 `features/sheet/sheetViewStore.ts`）；打开时还原（多表显式 `activateSheet`）。② `SheetEditor.scheduleSave` 改为**先比正文再决定**：`bodyOf(latestRef) === lastSerializedRef` 时直接 return ⇒ 点选单元格 / 滚动这类 onChange 不再把文档推成「待保存」。真实端 CDP：点选单元格与点缩放（110%→120%→110%）全程状态栏 `仅本地`、正文 `len` 与字段不变、localStorage 视图已更新。明细见 git 历史。
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