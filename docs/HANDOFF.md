# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留【最近约 10 个批次 + 当前基线 + 风险 + 真实待办】；更早的 dated 批次已删除，只在 git 历史可查（`git log -p --follow docs/HANDOFF.md`）。
> **261109 第三次重写**：397KB → ~25KB；五份旧发布说明合并为 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)，一批已完成的研究/审计/回归文档随之删除（git 可查）。文中旧 commit hash 仅是历史记录，`git show` 未必可达。
> **当前状态以 §1（基线）/ §2（风险）/ §3（待办）为准**；§0 的批次抬头保留当时的「已发布 / 已提交 / 待验收」口径，**不要据此判断今天是否已推送**。
> 移动端（Android）的构建 / 安装 / AVD / CDP / 门禁 / 点按口径 = [docs/MOBILE-OPS.md](MOBILE-OPS.md)；桌面会话不要改它，移动端会话不要改桌面文件。

## 0. 最新交接（261109）

> **顺序标注**：261109 各批次里写的「日记 ⌘4 / AI 写作 ⌘3」是**当时**的顺序；**261110 起改为 日记 ⌘3 / AI 写作 ⌘4**（另有标签 ⌘5）。旧批次不再改，以本行 + §1 为准。

### 261111 · 查漏补缺（review：编辑态标签行溢出 / 目录笔记本行占位高）
- **编辑态标签行并进动作行后的溢出**：多标签时原 `overflow: hidden` 会直接裁掉（用户既看不到也移不掉）⇒ 改 `overflow-x: auto` + **隐藏滚动条**（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），标签仍全部可达。
- **目录笔记本行占位高**：上一条跳动修复按文档行算（内容 23 ⇒ 占位 27），但笔记本行真实高 29 ⇒ 滚入视口仍会 27→29 跳 2px。补 `.tree-row.type-notebook { contain-intrinsic-size: auto 25px }`（25 + 上下内距 4 = 29）。
- **新增护栏**：`QuickNoteComposer.render.test.tsx` —— 写作卡（pane）的标签行必须在动作行**之外**（独立一行）；编辑态（inline）必须在动作行**之内且为第一个子元素**，并存在 `.quick-note-actions-spacer`（标签靠左、按钮靠右）。防以后又把两条版式合并/搬回去。
- 门禁：`tsc` 0；`cssLayers` `chrome.css` 530→**531** / `app/quick-notes.css` 690→**692**（写明理由）；全量 vitest 见 §1；`ui-metrics` / `git diff --check` 通过。
### 261111 · 小记编辑态：标签并进动作行 + 「保存并同步」支持编辑（核对结论）
- **布局**（用户点单「标签太贴边，放到取消/保存那一行的最左边」）：编辑既有小记（`variant="inline"`）时，标签行（`+ 添加标签` + 已选标签）从原来「独立一行贴卡片左下角」**并进动作行**：标签靠左、`quick-note-actions-spacer` 撑开、`取消 / 保存并同步 / 保存` 靠右，同在一行；写作卡（`variant="pane"`）保持标签独立一行不变。实测：动作行 742×40，标签 519→676、按钮组 1035→1237，同一 top。
- **「保存并同步」在编辑态是否支持编辑后出网？→ 支持，保留**：`saveDraftAndSync` = `saveDraft`（编辑走 `native.updateQuickNote`；**无改动不写库**但会回传 note id）→ `pushOneNote(id)` → `native.syncQuickNote(id)`（单条快路径 `engine.pushQuickNote`：pushed / unchanged「已是最新」/ 无远端清单回退整轮 / 不在本机 都有明确提示；失败文案「已保存到本机，同步失败：…」）。⇒ 它是「改完立刻出网」的唯一入口，**不删**。
- 门禁：`tsc` 0；`cssLayers` `app/quick-notes.css` 684→**690**（+6 = inline 标签容器与 spacer，写明理由）；全量 vitest 见 §1；`ui-metrics` / `git diff --check` 通过。
### 261111 · 渲染骨架 fallback + capture 预取 / 图片缩略 / 性能基线（用户点单）

- **桌面编辑器 fallback = 同构轻骨架**：`MultiTabEditor` / `QuickNoteComposer` 的「正在加载编辑器…」裸文字换 `EditorLoadingSkeleton`（document/composer 两变体；`role=status` + `aria-busy` + `.a11y-visually-hidden` 文案；纯静态无动画、不写死高度）；样式只进 `app/editor.css`（+43）+ a11y 通用隐藏类（+6）；lazy 边界/首屏预算未动。**桌面 42 态 stylesnap 未跑**（无夹具），点收：冷启首篇 / 切文档 / 小记写作卡 / 分屏。
- **移动 capture 首帧预取内核 chunk**：`main.tsx` 在 `initialCapture`（原生 `readLaunchUrlHint`）判定后、`createRoot` 前 `void loadQuickNoteComposer()`（同一 loader、不 await、普通启动不触发）⇒ 写作卡 chunk 与首帧并发起跑；只省 chunk 等待（几十 ms），内核首次实例化 0.3–0.9s 仍是地板。真机前后对比未做（见下）。
- **移动图片缩略（内存）**：列表卡正文内嵌图统一 `?w=1024` 离散缩略（资产服务本就支持 128/256/512/1024，与封面同档 ⇒ 同一照片不再原图解码、不再双份解码）；封面加比例盒 + `decoding=async`；逻辑收进 `quickNoteImage.ts` + 5 例单测。估算单张 4000×3000 照片解码 ~48MB → ~3MB。未做：写作卡/内核内图片、标签详情预览（同法可补）。
- **移动性能基线脚本（本地门禁，不进 CI）**：`scripts/mobile-audit/perf-baseline.mjs`（`npm run check:perfmobile`；`--record/--compare/--self-check`；冷启动→首页、capture 冷启→可输入、写作卡热开、键盘开合长任务、可选文档打开；基线 `.css-audit/perf/mobile-perf.json`，绑定设备/构建/视口）。`--self-check` 28 项通过；**真机 `--record` 未跑成**：冷启动 CDP page target 竞态导致页内标记注入失败（加导航重试仍复现，待修）。
- **键盘残余诊断（无代码改动）**：写作卡稳定轮 0–1 条长任务（≤66ms 接近地板）；文档编辑残余 3–5 条（320–550ms）簇在 IME 稳定后、伴随内核虚拟渲染/视口重算；无内核搜索框对照组掉帧画像相同 ⇒ 模拟器+WebView resize 地板，非我们 hook 重复 fit。未找到可安全修点，不硬改；建议真机复测。
- **快照/走查（task-21，先归因后重烤）**：手机 9 态元素数全不变（1909/1909/1914/2085/2042/1943/2035/1961/1963）、hash 全更新，**两轮 0 差异**；多维表 3 态同源归因后重烤、两轮 0 差异（2194/2160/2172）；**23 屏 23/23 ok**（10 屏 `escape:1` 为隐藏首页层既有可观测量，非本批）。基线已随本批提交。
- **门禁**：tsc 0；全量 vitest **862 文件（850 passed / 11 skipped）/ 5398 例**——唯一失败 `electron/s3v3/perf.integration` 的时延门禁在本机满负载下 flaky（孤立重跑通过，既有口径）；check:core 162/0；check:bundle+arch 通过（desktop 564,378/600,000、app-js 191,799/300,000；mobile 59,835 gz / 6 链接 / 347,990）；ui-metrics 0；diff-check 0。
- **未做/后续**：平板 9 态（需 lake_tab）、性能脚本冷启动采集修复、图片缩略第二步、桌面 42 态；并行会话仍在改 quick-notes 预览 ⇒ home-quicknotes 快照若再漂需补跑 `check:mobilesnap --port 9336`。

### 261111 · 小记：滚动闪屏 + 卡片点击抖动（用户点单）
- **点击/选中抖动**：删掉 `.quick-note-entry` 的 `transition: transform` 与 `:active { transform: scale(.98) }`（用户原话「点击或者选中小记的这个抖动」）。按压反馈只留在 kit 原语（`.ln-btn` / `.ln-iconbtn`）上 —— DESIGN Motion 的既有口径；整卡是内容面，缩放会把内容一起抖。`.editing` 的 `transform: none` 守卫**保留**（260920 真凶的护栏）。
- **滚动闪屏**：根因 = `QuickNoteKernelPreview` 原先「**离开视口即 destroyLakeEditor**、滚回来又 createLakeDocument」⇒ 向下/向上滚动时每跨过一条内核兜底卡片就重建一次实例，首帧是白的（用户 GIF 里 3 次闪屏）。改为**视口闩锁**：进入过一次即常驻，只在「卡片卸载 / 正文变化」时销毁。代价 = 已看过的卡片各留一个只读实例；列表 >24 条走窗口化，行卸载时实例随之释放（文件头 ② 已写明取舍）。
- 护栏（新增 2 条源码断言，防回归）：`quickNoteKernelFallback.test.ts` —— 必须有 `setRevealed(true)`、不许出现 `setRevealed(false)` / `setInView(`；`quickNotesView.test.ts` —— 不许再出现 `.quick-note-entry:active { transform: scale… }` 与卡片上的 `transition: transform`。
- 门禁：`tsc` 0；`cssLayers` `app/quick-notes.css` 686→**684**（删 2 声明）；全量 vitest 见 §1；`ui-metrics` / `git diff --check` 通过。
- **未做**：真屏录验证（本机隔离实例里卡片详情是懒加载 + 依赖窗口可见性，滚动录屏复现不稳定）⇒ 这两条以机制 + 护栏锁住；请用户在真实库上再扫一遍确认。
### 261111 · 小记卡片预览字号统一（用户报「都是 15px 为什么有的大有的小」）
- **根因 = 两条渲染路径字号没对齐**（实测，隔离实例 + 设备像素量 computed）：
  - 快路径（自研 DOM）：正文 `.quick-note-preview-paragraph` = **14**、h1 标题 = **20**（h2 18 / 其余 15.5）；
  - 内核兜底（`QuickNoteKernelPreview`）：`createLakeDocument` 的 `prefs.fontSize` 默认 **18** 写进挂载点内联 font-size ⇒ 内核正文 `ne-p` = **18**，而内核标题是 **em 倍数**（h1 = 2em ⇒ **28px**，行高 44.8）⇒ 同一屏里看着一大一小。
- **修（三处，单一来源）**：
  1. `QuickNoteKernelPreview` 传 `prefs.fontSize: 14` ⇒ 内核正文与快路径正文同档（实测 `NE-P` 14 / lh 23.52）；
  2. 快路径标题收档：h1 `bodyLg` 15.5 / h2+ `body` 14（此前 20 / 18 / 15.5，卡片里过大）；
  3. 内核兜底标题三层都要打（内核把字号写在自己元素上）：`ne-h1 / ne-heading-content / ne-text` 收 **15.5**、h2–h6 同一挂三层收 **14**、`ne-p` 行高对齐 1.68。落点 `app/quick-notes.css`（legacy 层且晚于内核样式导入 ⇒ 直接生效，无需 !important）。
- **实测（同一屏两张卡）**：快路径 p 14 / h1 15.5；内核兜底 p 14 / h1 15.5（原 18 / 28）——两条路径现在**同档**。
- **一致性收口（用户定稿口径：内核兜底只是「省内核开销」的实现细节，对外观感必须与快路径一致、不许出现异常）**：
  1. 藏掉内核阅读页自带的控件 **「返回文档」**（`.ne-ui-exit-max-view-btn`）——它会在卡片预览里露出来，是明显的异常；
  2. 块间距对齐卡片节奏：标题下 6 / 引用上下 6 / 列表缩进 22（与快路径 `.quick-note-preview-list` 同值）/ 表格下 10；
  3. 宽表格不再露横向滚动条（内核 table 最小宽 750 > 卡片宽，会画出一条灰色滚动条像渲染异常）——视觉隐藏，仍可触控横向查看。
- 实测（同屏两张卡，逐项量 computed）：`ne-h1 ne-text` 15.5 / `ne-p` 14（lh 23.52，与快路径逐像素一致）、引用 padding-left 10、列表 padding-left 22、「返回文档」`display: none`。
- 门禁：`tsc` 0；`cssLayers` `app/quick-notes.css` 674→**686**（+12，写明理由，dupGroups 6）；全量 vitest 见 §1；`ui-metrics` / `git diff --check` 通过。
### 261111 · 小记两处（保存后找不到 + 标签条「全部」）
- **「AI 写作保存到小记后找不到」根因**：`QuickNotesWorkspace` 是 keep-alive（空间切走仍挂载），列表**只在挂载时拉一次** ⇒ 在别处新增的小记（AI 写作保存、同步拉取、他端改动）切过来时列表还是旧的，读起来就像「没存上」。**保存本身是成功的**（`native.createQuickNote` 已落库）。
- **修**：新增「进入小记空间即刷新」effect（`visible` 变 true ⇒ `refreshItems(false)` + `refreshTags()`；两条本地 IPC，无 loading 闪烁）。实测：在知识库空间用 IPC 造一条小记 → 切回小记，列表 2 → **3**、`全部(2)` → **全部(3)**，无需重载。
- **标签条加「全部」**（用户点单「默认全部展示」）：`.quick-notes-tagbar` 最左新增 `全部(N)` chip（`N` = 全量条数），`tagFilter.kind === "all"` 时 `is-selected`；点它 = 清掉标签筛选。实测：点「待读(1)」筛出 1 条 → 点「全部(3)」回 3 条。
- 门禁：`tsc` 0；全量 vitest 见下（本次改动只 1 个组件文件，无 CSS 变化 ⇒ 无基线调整）；`ui-metrics` / `git diff --check` 通过。
### 261111 · AI 写作两处收口：停止按钮（颜色/错位）+ 提示词库条目加厚
- **停止按钮（用户报「错位，且颜色应该是红色」）**：① 颜色从 `ln-btn--secondary`（中性）改 **`ln-btn--danger`**（红字 + 40% 红框，DESIGN L5）；② 补 `height` + `justify-content: center` 把 26×26 固定成**正方形、图标居中**（此前只写了 width，图标被 5px gap 推偏 ⇒ 看起来错位）；③ 生成中**隐藏「↩ 发送」提示**（按钮已变成停止，还挂着发送提示会读成错位）。实测注入同 class 样本：26×26、`color: rgb(179,56,47)`、红框 40%。护栏 `AiComposer.prompt.render.test.tsx` +1 例（忙态 = danger / 非 secondary / 有 `aiw-send--stop` / 无 hint 元素）。
- **提示词库条目（用户报「太紧凑」）**：条目上下内距 0 → **8**（高度由两行文字撑开到 ≈46），菜单容器 `gap: 4`（条目之间留间隔），标题与说明之间 2 → 4。落点是 `.aiw-prompts` / `.aiw-prompts__item`（**只作用于这个气泡**，不动全仓共用的 `.ln-menu__item`）。
- 门禁：`tsc` 0；全量 vitest **860 文件（849 passed / 11 skipped）/ 5389 passed / 12 skipped / 0 failed**；`cssLayers` `aiWriting.css` → **350**（分两次 +2/+2 写明理由）；`ui-metrics`、`git diff --check` 通过。
### 261111 · AI 写作空态：建议 chip 加厚 + 场景扩充（用户点单）
- **加厚**：「点一点试试」的建议 chip 从 26（compact）→ **31** = `calc(var(--lake-ctl-h) + 4px)`，内距 `0 var(--lake-space-lg)`。落点是 `aiWriting.css` 的 `.aiw-suggest__chip`（**只在空态这一屏**；按钮原语的「两档」口径不动，避免又开第三档）。实测 31px。
- **场景扩充（用户定稿名单，别自己改顺序）**：`AI_WRITING_SUGGESTIONS.chat` 前 9 个 = 用户点名：**今日信息差 / 推荐一本新书 / 金融行业要闻 / 科技行业要闻 / 时政要闻 / 每天一个心理学知识 / 每天了解一段历史 / 今日新闻热榜 / AI最新进展**；其后 8 个是我扩展的、同样**不需要用户先提供上下文**的：一个冷知识 / 推荐一部电影 / 推荐一个思维模型 / 今天的复盘三问 / 一道逻辑谜题 / 写一首短诗 / 今日体育要闻 / 解释一个概念。
- **明确不要**「需要素材才能跑」的场景（用户点名删掉「把这段话写得更自然」：没有上下文写不了）。护栏测试 `aiWritingSuggestions.test.ts` 钉 4 件事：① 9 个用户项在且顺序不乱；② label ≤14 字、不重复、prompt 非空；③ 对话模式禁止出现「把这段话 / 改写下文 / 下面这段 / 粘贴」这类需要外部素材的措辞；④ 多文档模式每条 prompt 必须写明「只依据资料 / 不要编造 / 资料没写」，且 ≥6 条。
- 新闻类 prompt 都加了「无法确认时效就标注、不要编造具体数字与日期」的约束（AI 没有实时联网时的防编造口径）。
- 门禁：`tsc` 0；全量 vitest **859 文件（848 passed / 11 skipped）/ 5383 passed / 12 skipped / 0 failed**；`cssLayers` `aiWriting.css` 345→**346**；`ui-metrics`、`git diff --check` 通过。
### 261111 · 目录栏鼠标划过整列跳动（回归，已修）
- **现场**：鼠标扫过文档树行时整列上下跳（用户录屏）。
- **根因 1（本批厚度 review 引入）**：`--lake-ctl-h-sm` 22→26 连带目录行内动作钮（⋯ / ＋）从 22 变 26；`.note-row` 是 27px 行 + 上下各 2px 内距，而 `.tree-row-actions` 是 `display:none → flex` 的**hover 才显形** ⇒ 悬停时该行 27→30，划过整列每行都 +3/−3。
  - **修**：`.tree-row .tree-row-action { width: 22px; height: 22px }`，**必须落 shell 层 `chrome.css`** —— 放 `app/shell.css` 无效（那个文件在 `legacy` 层，压不过 `kit` 层的 `.ln-iconbtn--compact`）。行内 affordance 记为「内容区例外」，与「正文/编辑器内部不参与统一厚度」同口径。
- **根因 2（既有，顺带修）**：`.tree-row { content-visibility: auto; contain-intrinsic-size: auto 28px }` —— 视口外行的占位高 = 28+4 = **32**，真实行高 27 ⇒ 滚入视口时 32→27 跳 5px。改成 `auto 23px`（内容盒 23 + 内距 4 = 27）。
- **实测**（隔离实例 + CDP `Input.dispatchMouseEvent` 真鼠标逐行扫过 9 行，`PerformanceObserver('layout-shift')` 观察）：修复前 hover 行高 **30** vs 静止 27；修复后 静止 / 悬停 / 扫过后全部 **27（笔记本 29）**，行内动作钮实测 22，树相关 layout-shift **0 条**。
- 门禁：`tsc` 0；全量 vitest **859 文件（848 passed / 11 skipped）/ 5383 passed / 12 skipped / 0 failed**；`cssLayers` 基线 `chrome.css` 528→**530**（写明理由）；`ui-metrics`、`git diff --check` 通过。

### 261111 · 厚度 review：紧凑档 / 徽标 / chip 全站加厚（用户点单「选1 都加厚」）
- **起因**：用户发现 AI 写作的工具钮/气泡比设置页薄，怀疑「不是同一套原语」。核对结论：**确实是同一套原语、两档厚度在起作用** —— AI 写作工具钮/发送/建议气泡 = `.ln-btn--compact`(22)、文档 chip = `.ln-tag`(18)、筛选 chip = `.ln-chip`(24)；设置页 = `--lake-ctl-h-settings`(32) 管理档。所以是「档位差」不是两套实现。
- **改动（原语级，一处生效）**：`--lake-ctl-h-sm` **22 → 26**；`.ln-tag` **18 → 22**（内距 7 → 8）；`.ln-tag--status` **22 → 26**；`.ln-chip` 默认 **24 → 26**。标准档 27 / 管理档 32 **不动** ⇒ AI 写作与设置页的落差从 10px 收到 6px，全站「薄一档」观感消失。
- **实测（隔离实例 1431/9223）**：AI 写作 工具钮/发送/建议气泡 26、文档 chip 22、行尾 ⋯ 26、新会话主按钮 27、分段段高 27；`--lake-ctl-h-sm` computed = 26px。
- **影响面 / 必须重烤**：所有 compact 档几何 +4px（AI 写作、标签选择器、小记动作行、页签动作、`.ln-chip` 各屏…）；桌面 `check:stylesnap` **42 态计算值会变** ⇒ 发版前必须重烤（本机无桌面合成夹具，登记 §3）。移动端 `mb-*` 独立、**未动**。
- 门禁：`tsc` 0；全量 vitest **859 文件（848 passed / 11 skipped）/ 5380 passed / 12 skipped / 0 failed**；`ui-metrics`（颜色 0 / `!important` 9=清单 / 跨文件重复 103≤105）；`git diff --check` 0；`cssLayers` 声明数未变（只改值）。文档同步：`docs/DESIGN.md`（Buttons/Icon Buttons/chip/分段）、`AGENTS.md` §3#14 两档数值。

### 261111 · AI 写作历史记录菜单：改成与知识库目录右键**同款**（用户点单）
- **形式**（用户原话「用和知识库目录栏右键以及菜单一模一样的形式」）：`surfaceClassName="context-menu"`（覆盖 Menu 默认 `.ln-menu`）、每项 `ln-menu__item` + **15px lucide 图标** + `<span>`、分组用 `.context-menu-sep`、危险项走 `className="danger"`（红字，与目录右键「删除」同一 class）。三项 = 置顶/取消置顶（Pin/PinOff）· 重命名（Pencil）· 删除（Trash，分隔线之后）。
- **位置**（用户报「为什么局限在左侧分栏内」）：原来 `anchor` + `align:"end"` 会让菜单贴着左栏右缘、看起来被分栏"框住"。改成**触发点坐标** `usePopoverPosition({ at })`：点行尾 ⋯ = 按钮左下角，**右键行 = 指针位置**（新增 `onContextMenu` 入口，与目录右键同一交互）；视口翻转/夹取交给 hook。浮层本来 portal 到 body，`.aiw-side { overflow: hidden }` 裁不到它。
- **实测（隔离实例 1431/9223，先 `aiWritingCreate` 造两条会话）**：菜单 220×105，右缘 466 > 左栏右缘 288（已跨过分栏）；三项图标齐全、分隔线 1 条、删除项 class = danger；portal 落在 body。
- 测试：`AiWritingSidebar.render.test.tsx` +2 例（右键行打开同款菜单：表面/分隔线/danger 逐项断言；⋯ 菜单三项都带图标且不在 `.aiw-side` 内）；全量 vitest **859 文件（848 passed / 11 skipped）/ 5380 passed / 12 skipped / 0 failed**；`tsc` 0；`ui-metrics` / `git diff --check` 通过。

### 261111 · 多文档选择：笔记本文档改「右侧列」展开（用户点单）+ 构建/门禁
- **问题**：原来点笔记本是**内联**展开文档列表，会把下面的笔记本行往下挤（用户截图红框指的位置是右边空白）。
- **改法**：`AiDocPicker` 从单列改**两列**——左 `.aiw-picker__list`（快捷组 + 笔记本行，**布局稳定**）+ 右 `.aiw-picker__side`（当前本的文档列，头部 = 笔记本名 + 「N 篇」；每行复选框走原有 `onToggle`）。表面自身不再滚动，两列各自滚动；**关闭气泡即收起右列**（不记忆上次展开）。
- **定位**：宽度按展开态固定传给 `usePopoverPosition`（展开 560 / 收起 320）——右列一出现表面就变宽，hook 会重测并重新夹视口，避免贴右缘被裁。
- **实测（隔离实例 1431/9223）**：展开前后笔记本行 `top/left` 完全不变（562/445 ⇒ **内联挤压已消失**）；气泡 560×248、右列 224 宽贴右；点「个人笔记」右列出现「欢迎来到 LakexLocalNotes」并可勾选。
- 测试：新增 `AiDocPicker.render.test.tsx` 3 例（右列出现且不挤行 / 单篇 `onToggle` / 整本勾选 `onReplace`）；`aiWriting.css` 基线 321→**345**（+24 = 两列布局与右列头/标题，写明理由）。全量 vitest **859 文件（848 passed / 11 skipped）/ 5378 passed / 12 skipped / 0 failed**；`tsc` 0；`ui-metrics` 无新增违规；`git diff --check` 0。

### 261111 · 移动端底栏选中效果（参照小米商店，用户点单）+ 快照基线待重烤
- **选中项 = 浅色胶囊底**：`.mb-home-dock__item.is-active::before`（绝对定位、`inset: 6px 13px`、`border-radius: 999px`、`background: var(--lake-bg-selected)`，选中字/图标 = `--lake-fg-selected`）。**只加背景层**：五格几何、底栏高度（56）、FAB、手势热区都不动；`item` 加 `position: relative` + `isolation: isolate` 让胶囊只在本格内绘制。左右内缩 ≈ 格宽 1/6（参照图胶囊约占格宽 2/3）。
- 实测（`lake_mobile` / emulator-5554，装包后设备级截图）：选中格背景 `rgb(225,234,250)`（= accent tint）、圆角 999、inset 6/13；底栏高 56 / 格 82×56 **未变**；切到「标签」胶囊随之移动。
- 门禁：`tsc` 0；`mobileLayers` 基线 `mobile/mobile.css` 1672→**1682**（+10，写明理由）；全量 vitest 见 §1；`ui-metrics` 移动端 `!important` 19=基线、颜色字面量 0；`git diff --check` 0。
- ⚠️ **9 态设备快照基线需要重烤**：home-* 态的计算值指纹包含该格背景/字色 ⇒ 在 `lake_gate` 跑全量会红（元素数不变，只是指纹变）。已登记 §3。

### 261111 · AI 写作两项（提示词气泡位置 / 笔记本整本多选）+ 一处测试去日期绑定
- **提示词 / 选择文档气泡位置修复**（用户报「提示词弹窗位置错误」）：261110 曾把两处气泡的锚点改成**整张输入卡 + align:center**（当时为修「偏左」），结果是弹层飘在卡片中下方、和触发按钮对不上。现改回**锚到触发它的那个按钮**（`AiComposer` 传 `event.currentTarget`）并默认 `align:"start"`（左缘对齐按钮；下方放不下由 `usePopoverPosition` 翻到按钮上方）。实测：按钮 left 343 / 气泡 left 343、气泡顶 = 按钮底 + 6。
- **多文档选择：可整本勾选 + 多本同时选**（用户点单）：按笔记本区块的行首加**三态勾选框**（全选 / 半选 / 未选）——勾上 = 该笔记本下全部文档进资料集，可同时勾多个本（互不覆盖）；行按钮仍负责展开/收起逐篇勾选。逻辑单一来源 = `features/aiWriting/aiWritingDocs.ts` 的 `notebookSelectionState()` / `toggleNotebookRefs()`（已选全 ⇒ 只移除该本；未全选 ⇒ 补齐缺的那几篇，**半选点一下 = 补成整本**，与原生 checkbox 口径一致）；UI = `AiDocPicker`（`.aiw-picker__grouprow` + `.aiw-picker__check`）。实测：勾整本 → chip「1 篇文档」；取消其中一篇 → chip 清空、框回未选；再点 → 全选；再点 → 取消。
- **顺带修一处隔天必红的测试**：`AiWritingSidebar.render.test.tsx` 的分组用例把「今天/昨天」写成了固定日期（2026-11-10/11-09）⇒ 261111 早上跑就红（今天桶空）。改成**相对 now** 生成（now / now-1h / 昨天中午12点）。**写时间相关的用例不要写死日期。**
- 门禁：`npx tsc --noEmit` 0；全量 vitest **858 文件（847 passed / 11 skipped）/ 5375 passed / 12 skipped / 0 failed**；`ui-metrics` 无新增违规；`git diff --check` 0。`aiWriting.css` 新增 8 条（picker 勾选框布局）仍在基线 321 内，未改基线。

### 261110 · AI 助手四项（用户点单：tab 长度 / 钉住 / 每条重新生成 / AI 写作复制为 Lake）
- **多 tab 长度**：`.tab-title` 统一 `max-width: min(133px, 34vw)`（= 用户口径「原 200px 档的 2/3」）；窄窗 `34vw` 副本从 `src/styles/app/misc.css` 并入 `src/styles/app/tabs.css`（单处定义；misc.css 只留 `.current-note`，声明数不变）。超长标题省略、悬停 title 看全名。
- **AI 助手面板「钉住」**（左上角新入口 `.ai-dialog__head`，`ln-iconbtn` + `is-selected`）——用户三轮定稿后的**最终语义**：
  - 钉住 = 面板**拴在打开它的作用域**（空间 + 文档 tab）：切到别的页面先收起、**回来原样还在**（同一段对话、仍钉住、同落位）；在别的页面打开 AI 是**它自己的新会话**，互不影响；tab / 文档被关掉则这份**跟着丢弃**；
  - 未钉住的：切走即关闭（「挂起」只属于钉住的面板）；Esc / 关闭按钮随时关；钉住只挡「点面板外面」（在本文档里点正文不消失）。
  - 落点：会话模型从「全局单会话」改成**每作用域一份**（`features/ai/aiAssistantSession.ts`：`readAiScope` / `aiScopeNoteId` / sessions 数组 / `openAiAssistant` 同作用域替换）；`AiAssistantHost` 一次渲染全部会话；面板自己按 `scope` 判 `inScope`，切走时 **`return null` 不卸载**（`useAiConversation` 与钉住态因此都保留），切回重建 Popover 按当时几何落位；丢弃判据 = 该 `data-note-id` 的编辑器宿主已不在（属性 + 标签条 childList 观察，**不轮询、不读几何**）。
  - **不要再引入**：一改的「冻结矩形 + 视口级 fixed / 跨空间浮窗」（已整条撤回），以及二改的「切走就关闭」（会丢对话）。
- **文档 AI 面板「重新生成」下沉**：从底部按钮行移到**最后一条回答**的动作行（`ln-iconbtn` + 即时 hover 气泡，与 AI 写作操作条同款）；底部不再重复（同一语义只留一处）。`useAiConversation.regenerate` 语义未动（只重跑最后一轮）⇒ 历史回答不带该按钮。
- **AI 写作每条输出「复制为 Lake」**：`AiMessageView` 在「复制」旁加图标钮（lake 文字徽标、成功 1200ms 勾、`aria-label="复制为 Lake"`）；内核来源顺序 = `src/features/ai/aiLakeKernelRegistry.ts`（`AiAnswerViewer` 挂载即登记、卸载撤销）→ `editorInstanceAt(activeEditorMount())?.kernel` → 动态 import 建的屏外 1×1 viewer（模块级缓存；**禁止静态 import lakeRuntime**）；转换只走 `aiLakeClipboard.copyMarkdownAsLake`。
- **实测（隔离实例：`LAKE_DEV_PORT=1431` / CDP 9223 / 独立 userData + 独立资源端口；未动用户 1421/9222 实例）**：① tab 标题 computed `max-width: 133px`、超长省略；② B 文档钉住 + 草稿 → 切到欢迎 tab：**B 不显示**；切回 B：**面板 + 草稿 + 钉住态原样**；⌘2 切空间同理；③ 在欢迎 tab 另开一份（草稿各自独立）→ 两个 tab 各显示自己的草稿；④ 关掉 B 的 tab 再重开：B 是**全新面板**（草稿空、未钉住），A 的那份不受影响；⑤ 未钉住的面板切走即关（回来无面板）。
- 门禁：tsc 0；`src/features/ai` + `src/features/aiWriting` + `src/styles/cssLayers.test.ts` 全过；`ui-metrics`（颜色 0 / !important 9=清单 / 跨文件重复 103≤105）；`git diff --check` 0；`cssLayers` 基线 `app/tabs.css` 188→189、`ai/aiDialogParts.css` 87→91（均写明理由）。
- **改动文件**：`src/features/ai/{AiAssistantDialog,AiAssistantHost,aiAssistantSession,aiLakeKernelRegistry,aiLakeCopyAction}.*`、`src/features/aiWriting/{AiMessageView,AiWritingWorkspace,AiAnswerViewer}.*`、`src/styles/app/{tabs,misc}.css`、`src/features/ai/aiDialogParts.css`、`src/features/aiWriting/aiWriting.css`（+ 各自测试；基线见 `cssLayers.test.ts`）。
- **未做**：桌面 `check:stylesnap` 42 态（本机无合成夹具）；AI 写作的「复制为 Lake」真机点收（隔离实例造不出回答，只有单测 `AiMessageView.render.test.tsx` 5 例 + 代码路径核对）。
- **状态**：本批与并行会话（按钮第二批 / mb-btn）的改动同在未提交工作树。

### 261111 · 桌面冷启动首篇文档预热（用户反馈「刚打开软件就看到正在加载编辑器」）

- **现状与根因**：桌面启动必然自动打开一篇文档（恢复标签；没有则落 `lastOpenedNoteId`），EditorTab 的 lazy import 在挂载瞬间发起；旧 prefetch 要「就绪后 3s 的第一个空闲」才开始 ⇒ 预取永远慢于真实首篇挂载，等于没帮忙。prod 首篇 fallback ≈ 内核 chunk 下载+parse（本机 200–300ms）**是地板**。
- **改动**：`prefetchEditorKernelNow()`（立即/幂等/清空闲定时器）挂到 ①安全模式判据 `inactive` ②恢复标签计划确定 ③冷启动首篇候选确定（`useBootstrap`）④用户意图（目录文档行 `mouseenter`/`pointerdown`/Enter、搜索结果行 `mouseenter`/`focus`；不拦截事件、无全局监听）；空闲兜底 3s → 首帧后 500ms 首个空闲（timeout 1500）。
- **实测（隔离实例 prod，各 4 轮；未碰用户 1421/9222）**：场景 A（就绪后 500ms 点目录文档）fallback 171–444 → 181–437ms、mount 263–564 → 274–563ms；场景 B（恢复 2 标签，冷启动）fallback 208–304 → 260–364ms、mount 303–413 → 352–474ms ⇒ **差异在 ±50ms 噪声内（未改善也未回归）**。把预取提前到 App 模块求值：prod B 回退约 200ms（已否决并记录）。
- **门禁**：tsc 0；全量 vitest **859 文件（848 passed / 11 skipped）/ 5383 例 0 失败**；check:core 162/0；check:bundle+arch 通过（desktop 563,649/600,000、app-js 191,521/300,000）；ui-metrics 0；diff-check 0。
- **结论/后续（需用户裁决）**：预热**不能**再消除首篇 fallback；要再降只有 ①拆内核 chunk（大改，需 RFC）②改「启动自动打开文档」的产品语义（例如恢复标签为空时不自动开、或先画列表再开）。可选的「编辑器同构骨架 fallback」观感最好，但需新增 editor CSS + `cssLayers` 基线，且该文件正被并行会话改动，留到下一批。

### 261111 · 小记写作卡全屏 + 长按创建/键盘开合流畅性（用户点单）

- **点单**：小记改成占满屏幕；可点项随可用空间伸缩、键盘开合时始终可见可点；两条入口都要改（长按图标 capture / 正常新建）；并优化长按创建与键盘弹收卡顿。
- **布局（两条入口同一容器）**：新增 `.mobile-qn-screen`（状态栏安全区下 → 外壳底）；`.mobile-qn-composer` 去浮卡外距/圆角/阴影 → flex 撑满；正文唯一滚动、标签行/动作行 `flex:0`；动作行底距 = dock 占位（bar + gap + safe），永远落在 dock 上方；写作时隐藏首页顶栏（退出恢复）。删 `.mobile-qn-composer-wrap` / `.mobile-scroll--with-dock` / capture 淡入 3 条。
- **卡顿根因与改法**：① `--mb-app-h` 每次变化 cleanup remove→set（键盘动画十几轮）⇒ 同值直接 return、adjustResize 键盘态值==innerHeight 时不写、只在卸载清一次；② window/visualViewport resize 连发 ⇒ `useKeyboard` 按帧合并（每帧最多一次 emit）；③ `useCaretIntoView` 每个 resize 都读祖先几何 + smooth scroll ⇒ 120ms 合并、视口稳定后纠一次；④ capture 淡入与内核 mount 同帧竞争 ⇒ 删除；⑤ 已弹键盘时重复 `showNativeKeyboard` ⇒ 用 shellHeight 判据跳过；⑥ 浮卡阴影/圆角/双层滚动删除 ⇒ resize 期重绘与盒数下降。
- **设备实测（CDP longtask >50ms 个数/总时长）**：正常新建 5/775ms → **1/72ms**；capture 热启 6/1396ms → **4/787ms**（冷启仍有内核首次 mount ≈0.5s 长任务，非本批可消）；键盘收起 2/651ms → 0–4/≤326ms；键盘弹出 4/840ms → 1–4/271–312ms。键盘开/合两态 `elementFromPoint`：添加标签/取消/保存并同步/保存/dock 全可点；连续 14 行后光标仍在工具栏上方。
- **门禁**：tsc 0；全量 vitest **859 文件（848 passed / 11 skipped）/ 5380 例 0 失败**；check:core 162/0；check:bundle+arch 通过（mobile 59,713/6/347,868；desktop 563,628）；ui-metrics 0；diff-check 0；APK 已重装 `lake_mobile`。
- **未做**：9 态/23 屏设备快照（9 态无写作卡、不受影响；23 屏需覆盖两条入口 + 键盘开合，发版前补）；冷启 capture 无 A/B（旧包已覆盖）；返回键「先收键盘再退写作」未单独复测（走原 backHandler，未改）。

### 261111 · 小记快路径独立管线（不动整轮 S3，用户定稿）

- **定稿**：正常 S3 = 串起来的整轮链路；「只推当前这一条小记」单独一条小管线，只调用底层原语（remote get/put/delete、锁、索引序列化、pointer 校验、本地单行/基线），不进入整轮的 plan/apply/三方对比/lake 索引/意图账本。
- **实现**：`src/core/s3v3/quickPush/{pipeline,types}.ts` 唯一实现 `runQuickPush`；引擎 `pushQuickNote` 改**薄委托**；桌面 `pushQuickNoteWithV3` / 移动 `runMobileV3PushQuickNote` 直接调用；锁/错误原语上收 `protocol/{publishLock,syncErrors}.ts` 共用；新增平台端口 `getQuickNoteSyncRow`（单行读取，缺失回退整表）。
- **请求 13 → 11**（6 GET / 4 PUT / 1 DELETE）：进锁后单次读 pointer（省入口读）、释放锁 TTL 内直接 DELETE（省 owner GET）、正文 PUT 与 quick 索引 GET 并行；**保留**锁内 CAS、写 pointer 前 assert、写后读回。重复点 **2 → 1 次 GET**（0 上传、generation 不涨）。
- **对拍与护栏**：`quickPush/pipeline.parity.test.ts` 冻结旧实现逐字节一致（remote 全对象 base64 / 发布索引 / pointer / baseline 增量 / 返回值）；请求顺序 11 步断言；别端 items/tags/purged 原样保留；4 条回退条件锁已释放；not-found 零网络；无单行端口走回退。
- **整轮未受影响**：`electron/s3v3 + core/s3v3* + mobile/v3 + mobile/bridge` 105 文件 538 例全过（含 conformance/lock-contention/perf）；引擎只删 push 专用死状态（`uploadOps`/`report` 字段与 push 上传器），整轮 `sync/pull/apply/publish/GC` 未改。
- **真机 + 真实 S3**（前缀 `...quickpush-202611110943`，测后删 114 对象/前缀 0、设备配置恢复、整库恢复、凭据未落盘）：请求 11 与 fake 一致；**本次网络 RTT 偏高**（pointer 1.1–2.0s、publish 0.45–1.6s）⇒ 内部 2.7–6.0s、墙钟 4.9/9.0s，**慢在网络不在管线**（对照：任务 12 同日为 1.4s/0.84s）；云端每次只 +2 对象、`lake.commit` 全程不变；随后整轮 817ms `↑0↓0`（仅既有 tag 元数据再发布 +1 索引）。
- **门禁**：tsc 0；全量 vitest **858 文件（847 passed / 11 skipped）/ 5375 例 0 失败**；check:core 162/0；check:bundle+arch 通过（mobile 59,703/6/347,904；desktop 563,553）；ui-metrics 0；diff-check 0；APK 已重装 `lake_mobile`。
- **未做/后续**：重复点首次 `push-state` 约 1455ms（SQLite/原生桥多次调用；第二次 25ms）⇒ 可合并一次窄端口调用（本次未扩接口）；快捷 capture 冷启动本次未复测（任务 12 已验证同一代码路径）；改条件写替代锁才会再省 ~5 次往返（协议级，另立项）。

### 261110 · AI 写作 / 小记 五项（用户点单：标题可改 / 保存按钮同级 / 弹窗走内核渲染 / 时间线自适应宽度）
- **「复制为 Lake」= 公共能力**（回答「是否复用」并落档）：转换实现单一来源 = `features/ai/aiLakeClipboard.ts` 的 `copyMarkdownAsLake`（内核算剪贴板负载，文档 AI 弹窗与 AI 写作都用它）；取内核的公共入口 = `features/ai/aiLakeCopyAction.ts` 的 `copyMarkdownAsLakeFromAnywhere`（注册表 → 活动编辑器 → 屏外临时 viewer）。**不要**在 AI 写作里另写一套转换。
- **生成文档弹窗：标题可编辑**（`PublishDocDialog`）：默认取回答首行摘要，`ln-text-field` 可改；首焦点落在标题；空标题禁用「确认」；`onConfirm(notebookId, title)` 把用户输入带给 `publishDoc`（空串回落摘要）。
- **「保存到小记」不再强调**：`AiMessageView` 里从 `--primary` 改为与「生成文档」同级的 `--ghost`，并补图标（Feather = 小记空间图标）。
- **保存到小记弹窗改内核只读渲染**（用户：小记本身就挂 Lake 内核，弹窗应显示渲染态）：`SaveQuickNoteDialog` 去掉 markdown 源码 textarea，正文交给 `AiAnswerViewer`（lazy 内核 viewer；未就绪/失败用 `MarkdownView` 兜底），保存的仍是原始 Markdown（渲染只是展示层）；首焦点改到主操作。
- **小记时间线宽度自适应**（用户报「右侧小记展示不能左右滑、要自适应可视宽度」）：根因 = `.quick-notes-timeline` 是单列网格，**隐式 auto 轨道按最宽卡片（max-content）定宽** ⇒ 整列被撑出可视区、右侧被裁；改成 `grid-template-columns: minmax(0, 1fr)` + `.quick-note-entry { min-width: 0; overflow-wrap: anywhere }` + 内核兜底渲染容器 `min/max-width` 收口。
- **实测（隔离实例 1431/9223，A/B 同一处测量）**：造一条含 160 字符无空格串 + 长代码行的小记 ⇒ 修后 时间线 client 773 / scroll 773（溢出 0，卡片 743）；把轨道与卡片临时还原成旧行为 ⇒ scroll 1131 / 溢出 **358px**、卡片 1101。截图确认长串/长 URL/代码行都在卡片内换行。
- 门禁：tsc 0；`src/features/aiWriting` + `src/features/ai` + `cssLayers` 全过（`AiWritingDialogs.render.test` 补 2 例：标题可编辑传参、弹窗走渲染视图且保存原文）；`ui-metrics` 无新增违规；`cssLayers` 基线 `app/quick-notes.css` 667→674（写明理由）。
### 261110 · 首屏瘦身 + 小记「保存并同步」快路径（用户点单）

- **移动端首屏达标（隔离 worktree 实测，同 HEAD）**：entry-js 76,472B → **59,706B gz**（−22.0%）、modulepreload **39 → 6 条**、首屏资源图 393,716B → **347,838B**（−11.7%）；目标（60KB / ≤12 / 360KB）全部达标，`check-bundle-budget.mjs` 与 `check-arch.mjs` 已按目标收紧（12 条 / 60KB / 360KB；桌面 600KB 不变）。
- **做法**：① 非首屏必需移出静态图 —— 便携包编排、Markdown/PDF 分享导入、更新中心自动检查、粘贴拦截器（移入内核懒 chunk 模块求值，仍早于任何内核实例）、图标/表情选择器（含表情数据表）、原生调试契约/cachePort；② 3 个 `codeSplitting` 域块只合并「已在入口静态图里」的共享块（`includeDependenciesRecursively`），**绝不给内核/画板 vendor 分组**；③ `mobileLazyChunks.test.ts` 改为「禁 vendor + 组名白名单」。总产物未膨胀，内核/表格/Drawix 懒 chunk 尺寸不变。
- **小记「保存并同步」快路径**（用户定稿：唯一自同步特例、必须最快；**替换 261026 的「整轮兜底」口径**）：
  - 最短链 = 读 pointer → 读 quick-notes 索引（合并语义必需）→ 上传本条正文/资产 → 写新索引 → 写 pointer → **只更新本条基线**；**不拉 lake 索引、不处理其他待同步、不跑整轮 plan/apply**。
  - **桌面队列修正**：旧 `enqueueMaintenance`（与整轮同步/GC 同一串行队列 ⇒ 必等大同步）→ 新 `serializedQuickPush` 高优先门（只与其它单条推送串行；发布互斥仍靠 S3 锁 + pointer CAS/读回）。
  - **省请求/省本地**：重复点（内容未变）= 0 上传、0 发布、≈0–1ms；无资产时不再 GET 远端声明、同 `declHash` 不重复 PUT；`loadQuickPushState` 只读小记摘要（2000 文档真库实测旧 `loadState` 226ms → 新 1ms）。
  - **回退只限**：无 pointer / 无基线 / epoch·generation·lakeCommit 不符 / 远端 quick 索引该条 `purged` 且无恢复标记 ⇒ 整轮并如实回传 full-sync；失败不写基线、不标 synced。
  - 契约：`docs/SYNC-PROTOCOL.md` §12.3；埋点 `docs/LOGGING.md`；护栏 `quickPushFastPath.test.ts`（两端）、`quickNotePushPriority.test.ts`；AGENTS §4 已同步（含「不要排进 enqueueMaintenance」）。
- **门禁**：tsc 0；`check:bundle` / `check:arch` 通过（mobile 59,707/61,440、6/12、347,878/360,000；desktop 563,355/600,000）；`check:core` 158/0；`check:mobileui` 通过；ui-metrics 0；diff-check 0；全量 vitest = **855 文件（843 passed / 1 failed / 11 skipped）/ 5353 passed / 12 skipped**，唯一失败 = 并行会话在途 `aiAssistantDialog.test.ts`（非本批）。
- **设备**：APK 已装 `lake_mobile`，冷启动 + 知识库首屏正常；**未点收**：编辑器粘贴、小记 composer、分享导入、更新中心、图标/表情选择器、9 态/23 屏。
- **真实 S3 验证（已完成）**：独立测试前缀 `lakex-notes-dev3-fastpath-202611102111`（测后 110 对象删净、前缀剩 0；设备原「未配置」已恢复、凭据未落盘）。首次（无 pointer 回退整轮）**6657ms / 上传 26 条**；快路径第 2 条 **1421ms**（日志 1387ms；req=13：8 GET / 4 PUT / 1 DELETE；publish 721ms 为协议常量）；同条重复点 **239ms**（req=2 GET、0 上传、generation 不涨）；随后整轮 `syncNow` 870ms（↑0 ↓0，该条不重传）。数据已回写 `docs/SYNC-PROTOCOL.md` §12.3。
- **移动端两条「保存并同步」入口复核（261110 二测，真实 S3）**：路径 A 首页 FAB → 空白小记、路径 B 长按图标快捷 capture **共用同一 `QuickNoteComposer.save(true)` → `bridge.syncQuickNote`**（composer 全文件唯一出网同步、无 syncNow/runSync/v3 引擎直调；capture 的 onSaved/closeCapture 与 useAutoSync 均不触发整轮；整轮只挂首页云按钮）。实测：A 首点 **1577ms**（墙钟 1792ms，req=13）、重复 **126ms**；B 热 **843ms**/墙钟 1060ms、冷 **836ms**/墙钟 1025ms、重复 **97ms**；云端只 +2 对象（正文+索引）、`lake.commit` 不变；冷≈热 ⇒ **不做空闲预取**（无证据不加复杂度，按 §3#17）。随后整轮 817ms ↑0↓0 不重传。护栏 `quickNoteSyncEntrypoints.test.ts`（6 例）。

### 261110 · 接手批（AGENTS 精简 + 桌面按钮第二批 + 移动 mb-btn + 日记 v1 收尾）

- **AGENTS 精简（Lead）**：65,709B → **45,833B**（预算 65,536，留 ~20KB）。全部红线/机制保留；删过期数值（text-3 hex、测试计数、「6 态」、「Electron 44.3」等）并合并重复表述；补两条长期事实：**一级空间 = 知识库/小记/日记/AI 写作/标签（两端同名）**、**按钮 = kit 统一梯队（4 语义+危险+链接）**；§7 编号保持（21–24 与外部引用对齐）。
- **桌面按钮审计第二批（app 级 39 个）**：全部迁 `ln-*`；新增 kit 原语 `.ln-chip`（普通/选中/添加/排除/展示）、`.ln-check`（20×20 绿色勾选）、`.ln-iconbtn--danger`、`.ln-row__main--row`；feature CSS 合计 **−244 声明**（quick-notes 828→667、tags 217→195、noteTagRow 38→17、sidebarTagFilter 40→31、nodeIcon 95→78、dialog 242→231、document-status 94→83、kernel-theme 79→75），kit 645→708。`kernel-theme.css` 7 条旧类名补钉改指 ln-*（「内核未分层 button{color} 会吃掉语义色」的理由不变）。**视觉 delta（需点收）**：卡片动作钮 26→22、锁胶囊/筛选触发器变紧凑、属性面板标签 chip 约 +6px、节点图标页签 38→34 且选中加下划线、选中标签项变淡（disabled 口径）、删除图标常红、菜单行 28→27/字 13→14、chip-add 内距 8→9、移除钮 18→22、勾选框边框 1.5→0.5（DESIGN 红线）。
- **移动端 mb-btn 模型（用户定稿：借鉴桌面、自己实现，UI 两端独立）**：`--primary/--outlined/--secondary/--ghost + --danger/--danger-text + --link`、六态、`is-selected`；**触控几何一律沿用 44/36**（不对齐桌面 27/22）；`--settings` 23 处 → `--outlined`、`--settings--danger` → `--danger`、原纯红字 → `--danger-text`（0 视觉 delta）；ai.css 两条自绘 `.ai-btn` 视觉删掉回 kit L3；主题三钮去掉 mb-btn 叠用。**视觉 delta**：AI 页操作键由自绘胶囊→L3 中性框、基座/ghost 字色 text-1→text-2（略浅）。
- **日记 v1 收尾**：① 移动「知识库不含日记本」过滤抽 `src/mobile/notebook/libraryNotebooks.ts` + 测试；② 「标签空间不聚合日记」补测试（锁数据前提）；③ **取消日记标记端到端**（`core.planDiaryUnmark` 单一判据；桌面 `diaryStore.unmarkNotebook` 单条原子 UPDATE + IPC `diary_unmark`（通道 186→187）+ 日记 tab 改回文档空间；移动 `clearDiaryNotebookMark` + `bridge.diary.clearDiaryMark` + WRITE_OPS；幂等 `cleared:false`；**单向**，无回标入口）；④ 转文档目标选择器文案（`title`/`confirmLabel`/`description`，默认「移动到…/移动到此处」不回归）；⑤ 移动日记告警进「复制诊断信息」（`src/mobile/lib/diaryWarnLog.ts`，50 条设备本地，结构上不落正文/Key）。
- **门禁（261110 20:35 实测，提交 `09f41ba1`）**：tsc 0；vitest **852 文件（841 passed / 11 skipped）/ 5342 passed / 12 skipped / 0 failed**；ui-metrics 0（桌面 !important 9/9、移动 19/19、颜色 0、字号 0、跨文件重复 103≤105）；`check:core` 157 文件 / 0 违规；`check:mobileui` 通过；`git diff --check` 0。
- **未跑**：桌面 42 态 stylesnap（本机无夹具，且没有「日记空间」态）；移动 9 态快照（本批 DOM 未变，理论 0 diff）、23 屏走查、设备装包点收（`bash scripts/android-build.sh --sync --install` 待用户在 `lake_mobile` 验）。
- ⚠️ **提交时工作树还有另一会话的在途改动**（AI 助手「固定」/复制：`src/features/ai/**`、`features/aiWriting/**`、`styles/app/misc.css`、`styles/app/tabs.css`）。只 stage 了本批文件；共享的 `src/styles/cssLayers.test.ts` 用 index 分离（HEAD 版只含本批基线，对方的 aiDialogParts 87→91 / tabs 188→189 留在工作树未提交）。

### 261110 · 桌面一级空间改名「知识库」（两端同名，用户定稿）
- **点单**：移动端第 2 格叫「知识库」，桌面一级空间一直叫「文档」（更早叫「资料库」）⇒ 用户定：**桌面统一改「知识库」**。
- **落点（只改「空间名」）**：`desktop/DesktopTopBar.tsx` 的 `SPACE_META.library.label` 与空间菜单项、`components/model/defaultSpace.ts` 的「默认空间」选项、`settingsSearch` 关键词补「知识库」、空间称呼的注释/文档（`ARCHITECTURE` / `DIARY` / `desktopWorkspaceSlot`）。
- **不改**：`文档` 表示「一篇文档」的全部文案（回收站类型列、标签聚合的文档分组、附件预览、资源页 `doc` 过滤项、`noteRef` 的默认 kind label、空态「新建文档」）。**空间名与文档类型名是两个概念，别一起替换。**
- **护栏同步**：`defaultSpace.test` / `desktopTopBarLeading.render.test` / `tagsSpaceWiring.test` 三处断言改「知识库」（`tagsSpaceWiring` 那条测试标题也记了「资料库→文档→知识库」的沿革）。
- **门禁**：tsc 0；全量 vitest（计数见 §1）；`ui-metrics` / `git diff --check` 通过。**桌面 42 态快照未跑**（本机无桌面合成夹具缓存）→ 已登记 §3。
### 261110 · 移动端收口三件套：死 CSS 清理 / 装置迁移 / 三套快照基线重烤
- **死 CSS 清理**（`f0f5d6d3`）：`mobile.css` **1737 → 1672 声明**（dupGroups 10 → 8）、`pad/pad.css` 158 → 157，`mobileLayers` 基线按实测收紧。删的全是**零引用**规则：旧胶囊首页（`.mobile-block-quick` 整块 15 声明 / `.mobile-bottom-bar--home` / 两者 `is-revealed`·`is-armed` 态）、首页 `.mobile-home-tabs`（顶栏 + 窄屏 + 主体三条）、`.mobile-topbar-collapsed-title`、思源遗留（`.mobile-qcard` / `.mobile-drawer*` / `.mobile-fab` / `.mobile-sortbar` / `.mobile-chevron` / `.mobile-nb-row` / `.mobile-quick-row` / `.bottom-bar-*` / `.poc-error` / `.mobile-settings-form` 等）+ 深色档 `.secret-field` 成员。判据 = 全仓引用扫描（含 vendor bundle / scripts）+ `audit-dead-css.mjs` 复核；**保留** `.mobile-htab`（NodeIconPicker 的 Sheet 页签在用）与 `.toolbar__icon-deactivate`（内核命名空间，不能按引用数删）。
- **顺带修一个真 bug**：冷启动路由骨架 JSX 挂的是 `mb-route-skeleton__title/__line`，CSS 写的是 `.mobile-route-skeleton__*` ⇒ 这两条规则**从未命中**（骨架格尺寸全靠 `.mb-skel` 兜底）。CSS 改名为 `.mb-route-skeleton__*` 对齐。
- **装置迁移**（首页 `.mobile-htab` 行已被 Dock 取代，设备实测 `htab:0 / dock:5 / fab:1`）：11 个脚本选择器全部迁移 —— `snap-lib` / `mobile-snap` / `mobile-bitable-snap` / `window-sweep` / `mobile-walkthrough`（首页「新建」改 `.mb-home-fab`）/ `edit-surface-invariants` / `keyboard-toggle` / `long-doc-dom` / `boot-timeline` / `mobile-coldopen-breakdown` / `mobile-kernel-perf`。⚠️ **判「首页就绪」必须用 `.mb-home-dock__item`，不要用裸 `.mb-home-dock`**：冷启动骨架里也有空 Dock（只有 `.mb-skel`），裸容器会让 waitHome 假就绪。`window-sweep.mjs` 的 `LIB` 原本写死指向 master checkout 的绝对路径（改本 worktree 的 snap-lib 对它无效），已改相对 import。
- **手机 9 态重烤**（`lake_gate` + `pm clear` + `gate-fixture` + 合并后新包，CDP 9336）：逐态 delta **恰好 +17**（Dock nav 1 + 5 格×3 + FAB 1，可解释）⇒ 先暖态采样（`dock5-warm2`）确认 9/9 态两轮一致，再 `--from ... --write-baseline`，**连跑两轮 0 差异**。新基线：home-library **1909** / home-quicknotes **1909** / home-library-list **1914** / home-doc **2085** / settings **2042** / settings-appearance **1943** / settings-s3 **2035** / settings-backup **1961** / settings-about **1963**。
- **平板 9 态补烤**（`lake_tab`，`--viewport 1280x800`）：旧基线停在 11-08（`06b30676`）且只有 **6 态**（脚本已 9 态 ⇒ 缺 settings-s3/backup/about，门禁本来就必红）。本轮补齐：home 系 **+71**、settings **+82**（= 首页外壳与设置页自 11-08 起的累积改动，与手机侧「+17 本批 + 上一档 54」同源）；新基线 home-doc **2106**、其余同手机 9 态数值，**连跑两轮 0 差异**。
- **多维表 3 态重烤**：旧基线同样停在 11-08（`51a1db58`）⇒ 3/3 态**均匀 +71**、两轮一致；本轮没动 bitable 视图 DOM/样式，delta 全部来自首页外壳 ⇒ 重烤（form **2194** / table **2160** / card **2172**）。
- **23 屏走查**：冷启动后单独跑，**23/23 ok**（无 escape / clip 失败；`smallTap` 计数是既有可观测量，未恶化）。
- **文档口径**：`MOBILE-OPS` / `MOBILE-DESIGN` / `MOBILE-TECH-STACK` / `mobile-audit/README` / `check-mobile-snap` 等处的「6 态」统一改「9 态」，首页 DOM 速查改为 Dock + FAB。
- **筛选 chip 的跨所有权覆盖已收进原语**（`src/styles/primitives.test.ts` 门禁基线 = 0，本轮全量 vitest 抓到的唯一红）：原先 `mobile/quick-notes.css` 写了 4 条 `.qn-filter-bar > .mb-chip` / `.mb-chip.is-on .qn-num` / `.qn-filter-sheet__chips .mb-chip|.mb-empty`。改为原语能力 —— `kit.css` 的 `.mb-chip` 加 `min-width:0` + `max-width: var(--mb-chip-max, none)`、`.mb-chip-row > .mb-empty` 占满行；feature 侧只在自己的容器上设 `--mb-chip-max`（筛选条 `calc(100% - 96px)`、Sheet `46vw`），`.qn-num` 改单类 `color: inherit; opacity: .75`。默认 fallback 用 `none`（不是 `100%`）—— 否则所有既有 chip 的 computed `max-width` 变化，会让多维表表单态基线无谓漂移。`mobileLayers`：kit 608 → **611**、quick-notes 270 → **269**。
- **剩余**：桌面 `check:stylesnap` 42 态仍不跑（移动样式层独立 + 本机无合成夹具缓存，见 MOBILE-OPS §10）；`audit-dead-css` 桌面侧还剩 2 个候选（`.node-icon-picker__tab` / `.diary-split-handle`）留给桌面侧处理；~~移动「知识库」vs 桌面「文档」命名未统一~~ → **已定：桌面改「知识库」，两端同名（见上一条）**。
### 261110 · 按钮原语全站审计 + 迁移（第一批）
- **审计口径**：全仓桌面 `<button>` **682 个**（排除 mobile）；按「类名是否来自 `ln-*`/原语」分类：迁移前 **479 原语 / 268 非原语**。
- **本轮迁移**：① 菜单项统一补 `.ln-menu__item`（context-menu / card / tab / tree-selection / export / ink-export / outline 等，视觉不变——legacy 选择器本就与它同一规则）；② AI 写作：历史行主区改用新原语 **`.ln-row__main`**（kit 新增，收编行内可点主区各写一份的 button 复位）、思考块折叠行 / 空态建议 chip / 工具 / 发送 / 停止全部落 `ln-btn--compact`；③ 小记空间：工具钮/新建/文字动作/清空搜索落 `ln-iconbtn` / `ln-btn--ghost--compact`，删掉 quick-notes.css 里重复的 30px/悬停/下划线视觉。
- **迁移后**：**526 原语 / 156 非原语（77%）**；剩余全部是**专用编辑面**或 vendor/legacy 单一来源（见下），不是漏扫。
- **例外清单（不并入按钮阶梯，理由 = 几何/语义由该编辑面规格决定，状态视觉已一致）**：手写板 `InkPad` / `InkPagesPanel` / `InkPageStrip` / `InkTextSelectionControls` / `InkPageTab*` / `InkExportMenu` / `InkImageSelection` / `InkBackgroundSourceButtons`（62）；图片 Lightbox / 附件预览 / 编辑器卡片内按钮（`lockedTextCard` / `noteRefCard`）；编辑器页签与顶栏 chrome（`tab-item` / `toolbar__item`，单一来源 chrome.css）；目录行与行内动作（legacy compat.css 单一来源）；表格（Univer）与多维表条件 UI；`quick-note-tag`（标签色板）与 `qn-check`（checkbox 原语，不是按钮）。
- **后续（若继续收口）**：小记卡片/筛选弹窗/日记/标签空间等 app 级按钮约 40 个可再迁一轮，需逐屏视觉走查。
- 门禁：tsc 0；vitest **835 文件 / 5264 passed / 12 skipped / 0 failed**；ui-metrics（颜色 0 / 字号 0 / !important 9=清单）；primitives 0；cssLayers `kit.css` 630 → **645**（`.ln-row__main`）、`aiWriting.css` → **321**。
### 261110 · 桌面按钮原语定稿：4 语义 + 危险 + 链接（用户定稿，仿知乎层级）
- **层级**：L1 `--primary` 实心墨蓝（主操作）；L2 **`--outlined`（新）主题色框 + 主题色字**（常用）；L3 `--secondary` 中性框 + `text-2`（一般）；L4 `--ghost` 无框灰字（更次要/取消/工具）、**`--link`（新）无框主题色字**（跳转/引导）；L5 `--danger` 红字红框，配 `--ghost` / `--danger-text` = 纯红字。
- **尺寸只有两档**：默认 27（`--lake-ctl-h`）/ **`.ln-btn--compact` 22（新）**。
- **基座 = L4 口径**并补 hover（此前裸 `.ln-btn` 没有 hover ⇒ 表现为「点了没反应」）；六态（default/hover/active/focus-visible/is-selected/disabled）逐层统一，选中态三层合并成一条规则、只经 `--lake-bg-selected` / `--lake-fg-selected`。
- **收敛**：删除 `--settings`（43 处全部迁移到 `--outlined`，设置页按钮字色因此变为主题色——用户已知）；`--danger-text` 与 `--danger`+`--ghost` 合并为同一条「透明底红字」；`--outline` 本就 0 引用未新增。
- **内核未分层补钉**（`kernel-theme.css`）：内核注入 `button{color:inherit}` 会吃掉分层颜色 ⇒ 逐层补 `button.ln-btn*` 的 color（基础/primary/outlined/link/secondary/ghost/danger）。
- **文档与契约测试**：`docs/DESIGN.md` 的 Buttons 重写为层级表 + 六态；`motionContract` / `selectionTokens` / `splitPane` 三条断言按新结构更新（意图不变：按压走 kit instant、选中只走语义令牌、破坏性只有一种长相）。
- **视觉实测（隔离实例）**：设置·备份与恢复页 8 个 L2 按钮（`accent` 框 + `accent-text` 字）渲染正确、`--settings` 残留 0。
- 门禁：tsc 0；vitest **835 文件 / 5263 passed / 12 skipped / 0 failed**；ui-metrics（颜色 0 / 字号 0 / !important 9=清单）；primitives 跨所有权 0；cssLayers `kit.css` 613 → **630**（L2/L4b/danger 合并/selected 覆盖/compact，均写明理由）。
- **移动端 `mb-btn` 本轮不做**（用户定稿：先桌面；下一轮按同一模型对齐）。设置页若觉得「主题色字」太跳，可再加一档「框 + 次要字色」（用户预留）。
### 261110 · AI 写作二改：左栏 14px / 两栏可拖 / 搜索 + 置顶 / 气泡居中 / 思考块默认折叠
- **左栏字号 14px**：不给 kit 原语加覆盖（`.aiw-side .ln-row` 这类跨所有权选择器会被 `primitives.test.ts` 打红，基线 0）⇒ 行标题、搜索字段各用自己的类设字号（feature 层压 kit 层）。
- **两栏可拖（261110 真 bug + 修复）**：用户报「还是拖不动」——根因是上一轮把 `.aiw-handle`（`SplitHandle` 的定位类）当「零引用」删了：kit 的 `.ln-split-handle::before` 是**绝对定位**的 10px 命中带，没有 `position: relative` 锚点就落到初始包含块（视口左侧），鼠标抓不到。已恢复 `.aiw-handle { position: relative; flex: 0 0 0; width: 0; }`；**实测 CDP 真鼠标拖拽 288 → 371 并落盘** `split.ai-writing-side=371`。（教训：直接派发事件会绕过命中测试，验收必须走真实点击/拖拽。）
- **对话搜索 + 置顶（用户定稿；「指定」= 置顶，不做对话分组）**：左栏顶部 `ln-input--search` 按标题过滤（纯显示层）；置顶 = 设备本地 `lakex-local-notes-v3.aiwriting.pins`（有序 id，最新置顶在前，删除会话自动剪枝），列表顶部独立「置顶」段，行内 ⋯ 可置顶/取消置顶。判据在 core `splitPinnedConversations`。
- **气泡偏左根因与修正**：原锚点是输入卡左侧的**小按钮**且 `align:"start"` ⇒ 气泡从按钮左缘向右展开、看起来偏左。现改为**锚点 = 整张输入卡** + 新增 `usePopoverPosition` 的 `align:"center"`（`topMenuPosition.placePopoverPosition` 新增分支，start/end 原逻辑不动）⇒ 输入卡下方**居中**，放不下按既有规则翻上方仍居中。实测：输入卡中心 = 气泡中心（delta 0）。
- **分段控件加厚（原语级，261110 用户定稿）**：直接改 kit 的 `.ln-segment`（轨道 27-1 → 27+3、段高 22 → 27；settings 档随 `--lake-ctl-h-settings` 到 35）——**全站统一**（设置·主题、小记版式、AI 模式切换等），声明数不变、只改值，kit 基线仍 613；已实测 AI 写作 30/27、设置外观 35/32 无裁切。
- **两个弹窗升级为浮动窗（261110 用户定稿：原先太窄）**：`PublishDocDialog` / `SaveQuickNoteDialog` 改用 `useFloatingDialog`（标题栏拖动 + 8 向缩放 + 尺寸/位置设备本地记忆；默认 780×460 / 860×620，min 560×340 / 560×420），内容走 `ln-dialog__head/body/actions`、`ln-form__row`、`ln-text-field`、`ln-btn`；首焦点 = 主操作按钮 / 正文（不再落在右上关闭钮上）。实测：生成文档 780×460（拖右缘 → 920×460）、保存小记 860×620、textarea 501px 吃满。
- **新对话 = 重点按钮**：左栏「＋ 新对话」由 `ln-btn--secondary` 改 **`ln-btn--primary`**（用户点单：左栏唯一实心主操作）。
- **输入卡控件全部收口到按钮原语（261110 用户报「怎么都不一样」）**：工具钮（提示词/已选文档）= `ln-btn ln-btn--ghost ln-btn--compact`（激活用 `is-selected`）；发送 = `ln-btn--primary ln-btn--compact`；停止 = `ln-btn--secondary ln-btn--compact`（正方形）；空态建议 chip = **L3** `ln-btn--secondary ln-btn--compact` + 胶囊形；删除 `.aiw-tool/.aiw-send` 里的高度/内距覆盖（`aiWriting.css` 331 → **321**）。实测：工具/发送/建议 chip 全部 22px，类名只剩 ln-*。
- **思考块默认折叠（用户定稿；B 方案不做）**：只显示一行「已深度思考（用时 X 秒）」/流式「正在深度思考…」，点开才渲染思考正文（`AiThinkingBlock`，`aria-expanded` + 箭头旋转，状态切换瞬时）；没有思考输出不渲染该行。B 的「文档面 + 操作条贴卡右上」**不做**（示意图留 `docs/mockups/ai-writing-b.html` 作记录）。
- **C 口径澄清（未改代码）**：多文档模式里「选择文档」只是挂上下文，**不是发送**；正文在点发送时才读取，仍需用户点「发送」/⌘⏎。
- 门禁：tsc 0；vitest **834 文件 / 5260 passed / 12 skipped / 0 failed**；ui-metrics（颜色 0 / 字号 0 / !important 9=清单 9）；primitives 跨所有权 0；cssLayers `aiWriting.css` 基线 301 → **320**（左栏字号/搜索/图钉/分隔条定位恢复/思考块折叠，均有理由）。

### 261110 · AI 写作：提示词点击写入输入框 + 接入 ln-* 原语做风格统一
- **提示词库（用户定稿）**：点卡片 = 把完整提示词**直接写进输入框**（已有文字换行追加、不覆盖；同时清掉旧 chip；面板关闭、焦点回输入框末尾），不再挂 chip；旧会话存过 `promptText` 的仍显示 chip 且可移除。
- **审查抓到并已修**：`input.replace(/\s+$/,"")` 的 `\s` 在编辑时被字符串吃掉（AGENTS §7.21 同类坑）⇒ 变成 `/s+$/` 会误删尾部字母 s；已修为 `\s+`，并有 render 用例覆盖「已有文字追加」。
- **风格统一（用户定稿：先统一、不改结构/交互）**：AI 写作控件全部换 kit 原语 —— 新对话 `ln-btn--secondary`；历史行 `ln-row` + `ln-row__actions`；chip `ln-tag` + `ln-iconbtn--compact` 关闭钮；工具钮 `ln-btn--ghost`（激活 `ln-btn--secondary is-selected`）；发送/停止 `ln-btn--primary` / `ln-btn--secondary`；消息操作 `ln-iconbtn--compact` + `ln-btn`；弹窗行 `ln-form__row`。**提示词库由 3 列卡片改为菜单行列表**（`ln-menu__item`，宽 360，与全仓菜单同一身份）。
- **CSS**：`aiWriting.css` **446 → 301 声明**（删掉的全是「同一视觉又写一遍」的控件样式），`cssLayers.test.ts` 基线同步调小并写明理由；只留布局与独有语义件（思考块/气泡/头像/空态/门禁/横幅/建议 chip）。
- **验收（隔离实例：独立 userData + vite 1431 + CDP 9223；未动用户/另一会话的实例）**：截图核对 空态 / 提示词菜单 / 对话线程（思考块+答案+操作条）/ 文档选择气泡；实测点提示词 → 输入框 = 完整提示词（173 字）、chip 清除、菜单关闭、焦点在输入框。
- 门禁：tsc 0；vitest **831 文件 / 5248 passed / 12 skipped / 0 failed**；ui-metrics（颜色 0 / 字号 0 / !important 9=清单 9）；cssLayers 通过；diff-check 0。
- **遗留（下轮讨论改版时定）**：chip 按 `ln-tag` 口径（18px）比原 22 小一档；建议 chip/思考块/气泡/空态/门禁属独有语义暂未并入原语；`ui-metrics` 跨文件重复基线 105 未下调（脚本不在本次写范围）。
### 261110 · 桌面标签上限：按空间独立 + 上限 16 + 日记 tab 不恢复
- **用户报**：日记端开 7 个，文档这边就只能开 1 个（上限 8 被两个空间共用）。定稿三条：① 上限**按空间独立**（文档/日记各算各的）；② 设置里最大只能 **16**（不再有「不限」/24 档）；③ **日记 tab 退出/重开不自动恢复**，文档空间仍按「退出时关闭全部标签」设置。
- **实现**：`core/tabLimit` 增加 `space` 作用域（`TabLike.space` 缺省 library；`selectEvictionIds` / `trimTabsToLimit` 只在本空间计数与淘汰，不传 = 旧全量行为）；`useTabLifecycle.openNote` 把标签空间传给 evict/trim，`restoreTabs` 合并时两空间各自封顶。
- **上限 16**：`MAX_OPEN_TAB_OPTIONS = [4,6,8,12,16]` + `normalizeMaxOpenTabs`（load/save 都夹，旧 0/24 → 16）；两端设置 UI 同源（桌面 Select / 移动 PickerSheet），文案写明「每个空间独立、最多 16」。
- **日记 tab 不恢复**：会话只落文档空间 tab（`useTabSessionPersistence` 过滤 `space === "diary"`，活动 id 回落到最后一个文档标签）；恢复前再按 `isDiaryEntryNode(treeNodes, id)` 滤一次（兼容旧会话里已存的日记 id）。
- 门禁：tsc 0；vitest **830 文件 / 5245 passed / 12 skipped / 0 failed**（新增：按空间淘汰/截断、不传 space 的向后兼容、设置夹上限、日记 tab 不落盘）。
- **桌面实测（261110 15:30，隔离实例：独立 userData + 独立 vite 1431 + CDP 9223，不碰用户/另一会话的实例）**：
  ① 文档空间连开 9 篇 → 上限 8 生效（第 8 篇起淘汰最旧：T1/T2 被淘汰，T2–T9 在）；
  ② 日记空间连开 9 篇 → 日记 tab 8 个（10-09→10-02），**文档 8 个原样保留**（两空间合计 16 个 tab 同时存在）；
  ③ 整页 reload（≈重开）→ 恢复 8 个文档 tab、**日记 tab 0 个恢复**；会话文件只含 8 个文档 id；
  ④ 夹上限：localStorage 写 24 → 设置显示 **16 个**，下拉只剩 4/6/8/12/16；
  ⑤ `clearTabsOnExit=true` → 会话清空、文档 tab 不恢复（只剩冷启动兜底 1 篇）。
  实测后已恢复设置并清理隔离数据（1431/9223/19879 已释放，用户 1421 静态服务与 9222 实例未动）。

### 261110 · 日记排序修复（同日多篇 = 真实创建时间）
- **用户报**：移动端日记排序有问题 —— 同一天多篇的顺序会随"最后编辑"变化；口径确认 = **日期倒序 + 同日按创建时间倒序**（分组不变）。
- **根因**：移动端 `notes` 表**没有 created_at**，`diaryNodes` 拿 `updatedAt` 顶替 `createdAt` ⇒ core 的同日 `createdAt` 比较实际比的是修改时间；行内「写于」也跟着编辑漂移（桌面端有真实 created_at，所以只有移动端出问题）。
- **修法**：移动端 schema **v12 → v13** 给 `notes` 加 `created_at`（老行迁移回填 = `updated_at`）；`createNote` 写入、`listNotes` 摘要带出、`diaryNodes` 用真实创建时间、远端导入（`importRemoteNote`）按首次落地 `updatedAt` 记一次；core 排序逻辑不动（本来就是对的口径）。
- **追加（同日二次确认）**：**工作区「文档树」抽屉**里的日记子树也必须时间倒序（用户原话「这里才是真正的笔记本里的排序」）⇒ 新增 core `compareDiarySiblings`（分组在笔记前、年/月**按数值**倒序、笔记日期倒序、同日 createdAt 倒序）+ `buildNotebookTreeIndex(tree, { diaryRootId })` 只重排日记子树（其它笔记本仍按 `sortOrder`；**只改显示，不改存储/拖拽落库**）；`NotebookTreeItem` 带出 `createdAt`。
- 门禁：tsc 0；vitest **826 文件 / 5221 passed / 12 skipped / 0 failed**（新增 8 例：同日按 createdAt 排序、编辑不漂、v12→v13 回填、树内日记排序、非日记本不受影响、拖拽开关判据/接线/早退）。
- 设备实测：① 迁移后既有顺序不变 → 连建两篇（14:20/14:21）新在前 → **编辑 14:20 那篇并保存后仍停在 14:21 之下**、「写于」不漂；② **文档树抽屉**：`2026 → 11 → [2026-11-13、5×2026-11-10、2026-11-05] → 10 → [2026-10-01]`（年/月数值倒序、日期倒序）。
- **日记子树禁用长按拖拽**（261110 用户定稿，桌面端本来也没有）：`treeDragEnabled(space)` 判据 + `NotebookWorkspace` 把 `notebookSpace` 接进 `useTreeDrag.enabled`；禁用后长按不再起手（不挂 `nb-drag-active`、不建跟手浮层），多选 / 行内 ⋮ / ＋ 不受影响；护栏 `treeDragDisabled.test.ts`（判据 + 接线 + 早退）。

### 261110 · 日记二改（移动为主）+ 两端「默认空间」
- **移动「＋」改为永远新建**（用户报「点新建日记却进了已有编辑」）：移动端链路原本没有 mode ⇒ 新增 `bridge.diaryOpenDate(dateKey, mode)` → `ensureDiaryNote(d, dateKey, mode)`，`new` 走 `core.planDiaryCreate`（与桌面 `diaryStore.openDate` 同口径）、`open` 仍 `planDiaryOpen` 幂等；**主按钮「写今天/继续写今天」保持幂等 open**，＋/日历传 `new`；连点四层兜住（openingRef + disabled + 写域串行 + 单事务）。顺手修 data 层层级 bug：**月组已存在时新篇曾挂到日记本根**（现按 `plan.noteParentId` 落月组）。
- **移动日记页 v2 重排**（用户报「太原始」）：玻璃页头 + 白卡分组（今日卡 / 年段卡）+ 行内 ⋯；`diary.css` 9→4 条，零新增视觉语言。行主区改**真按钮** `button.mb-set-item__main`，kit 补 8 条 reset（移动端无全局 button reset）；界面文案去掉「·」分隔（DESIGN 红线）。
- **右上角三入口 = 搜索 / 日历 / ＋（左→右，两端一致）**：桌面只重排（`DiaryWorkspace.tsx`）；移动新增日历 + ＋。日历 = `MobileSheet` + **共享月历原语** `ui/MonthCalendar`（`core.calendarMonthDays`，42 格周一起始，已有日记打点），选中任意日期即 `mode:"new"`，一天可多篇；原多维表 `.mbt-calendar-*` 收编为 `.mb-calendar-*`（样式逐条照搬、只搬家改名），多维表日期 Sheet / 日历视图 / 日记共用一份（独立懒 chunk，不进首屏 CSS）。
- **知识库列表过滤回收站笔记本**（`n.id !== TRASH_NOTEBOOK_ID`，判据取 core，不写字面量；只过滤渲染）。
- **移动返回落点**：从日记条目进工作区后回「日记」页签（`workspaceOriginTabRef`；页面返回与安卓返回键都收敛到 `useRouteTransition.onClosed`），其余入口仍回知识库；首页下层 tab 取来源页，返回不闪知识库。
- **「默认空间」设置（两端，仅本机）**：桌面 → 设置·常规·启动，5 空间、默认文档、键 `lakex-local-notes-v3.default-space`（`components/model/defaultSpace.ts`，同步 `settingsSearch`）；移动 → 设置·常规，4 tab、默认小记、键 `lakex-local-notes-mobile.default-space`（`settings/defaultSpace.ts`）；**不进 S3/wire**，值非法/未设置回落默认；只影响启动，⌘1–5 / tab 切换不变。
- 门禁：tsc 0；vitest **825 文件 / 5225 passed / 12 skipped / 0 failed**；ui-metrics / check:core / check:mobileui / diff-check 通过；`mobile-entry-css` **140,166 / 141,312（余 1,146B）**；mobile-entry-js 75,623 / preload 39 条仍是既有红（§1）。
- **状态**：以上改动**未提交**（工作树 29 改 + 6 新增；AGENTS 另加一条长期规则「移动端改动 ⇒ 先装包再交付」，§3#21④）。
- 验收：**移动真机（lake_mobile / emulator-5556）逐条点验通过** —— ＋新建（2 篇同日、行内 HH:mm）／日历选 11-05 新建／返回回日记页签／知识库无回收站／默认空间改知识库并优雅退出重启生效（已恢复默认小记；dev AVD 留 2 条验证用日记）。
- **设备门禁（261110 补跑，lake_gate / emulator-5558 / CDP 9336）**：9 态快照**重烤基线**（差异 = 每态恒 +35 元素，逐条对拍确认全部来自常驻挂载的日记页新构成：今日卡 + 三入口 + 空态；旧 `.diary-write-today` 已删）→ 连跑两轮 **0 差异**；**23 屏走查 23/23 ok**（顺手修装置陈旧标签：`mobile-walkthrough.mjs` 的「编辑器 / 同步设置」→「常规 / 云端与同步」，261110 P1 设置改名后未同步）。
- **桌面实机点验（dev 9222，用户既有实例，只读式操作）**：日记空间头部按钮顺序 = 搜索 / 日期 / ＋（aria-label 实测）；设置·常规·启动组「默认空间」选项 = 文档/小记/日记/AI 写作/标签，选「日记」落盘 `lakex-local-notes-v3.default-space=diary`、面板值同步 → 已删键恢复默认文档。桌面 `check:stylesnap` 42 态仍需有夹具的机器补（无「日记空间」态）。

### 261110 · 正文字号 14 试调（空间菜单 / 日记 / AI 写作）
- 用户点单：空间切换触发器（只 `.toolbar__workspace`，顶栏其它按钮不动）、下拉项（`.ln-menu__item` 是共用原语 ⇒ **全仓菜单项一起**变 14）、日记与 AI 写作正文统一 14（页面标题仍 18 档）；目录栏未动。
- 护栏：`cssLayers` 基线 chrome.css 527→528（触发器新增一条 font-size，已写明理由）。
- 门禁：tsc 0；src/styles + diary + aiWriting + components/app = 59 文件 393 例；ui-metrics / diff-check 通过。**设备快照未重烤**（字号级变化，发版前必须）。

### 261110 · 保存守卫误报修复（顶栏角标莫名亮「1」的排查结论）
- 现场：顶栏同步角标常亮 1，但「本地空间」面板只写「当前仅本地」——记录区此前只在云端分支渲染。查账本 = 一条 `save_external_changed`（2026-11-26，10:00:37）；日志显示 10:00:36 有一次保存成功（168 字符），1s 后同一篇又被拦，diskHash 恰好是刚写入那版。
- 根因：保存成功后的 baseHash 刷新被 **revision 门控**跳过（期间有新编辑 ⇒ 不调 onOpenTabsApplied），但那次已写盘成功 ⇒ 下一笔拿旧基线，把「自己上一笔的写入」判成外部改动（记录 +1、角标常亮、误弹三选项）。
- 修复：`useSavePipeline` 新增 `onBaseHashRefreshed`（**与 revision 无关**，保存成功即刷）+ 任务执行时**重读** live baseHash（入队快照仍只用于正文/标题/revision，审计 F02 不变）；`noteContentRepository` 增加进程内「最近自写 hash」自愈（外部写入不可能命中；重启不保留）。
- 护栏：`useSavePipeline.baseHash.render.test.tsx`（2 例：revision 前进仍刷 baseHash、排队第二笔读到最新基线）+ `noteContentRepository.test.ts`（+2 例：自写竞态放行 / 外部写入仍拦）。
- UI：记录入口区块抽成一处、**两个分支共用**；摘要按 kind 聚合（远端覆盖本地 / 他端已删除 / 保存时磁盘被改）；新增「知道了」= ack（只清角标不删记录）。护栏 `syncConflicts.summary.test` + wiring 断言。

### 261110 · 正文变更广播（桌面窗口 + 浏览器端）
- 动机（用户实测）：浏览器端保存后，桌面端**已打开**的正文不刷新，关掉重开才对 ⇒ 已打开的要通知刷新、没打开的不读盘。
- 实现：`save_note` 写盘成功 → 主进程广播 `note-body-changed { noteId, contentHash, title, updatedAt }`（所有可信桌面窗口 + `webServerController` → 浏览器端 SSE）；冲突/拦截不广播。判据单一来源 `src/core/noteBodyBroadcast.ts`：未打开 ⇒ 不读盘；dirty ⇒ 不覆盖（交保存守卫）；hash 相同 ⇒ 跳过（自己的回声）。`useSyncRefresh` 收到后 readNote + 刷 baseHash + bump reloadKey。
- 三处同步：`preload.cjs` / `native.ts` / `webApiServer` shim（EVENT_NAMES + `onNoteBodyChanged`）。
- 护栏：`noteBodyBroadcast.test`（6 例）、`useSyncRefresh.test`（+4 例）、`webApiServer.test`（shim 断言）。
- 门禁：tsc 0；components/app + hooks + core + electron 相关 65 文件 433 例；ui-metrics / check:core / diff-check 通过。**全量 vitest 唯一红 = `electron/s3v3/perf.integration` 的既有时延门禁（本机负载下 899ms > 797ms，与本批无关）**。浏览器端 SSE 手工实测**未跑**（需开 web 服务后浏览器端与桌面端同开同一篇验证）。

### 261110 · UI 借 Astryx 语汇两批（设置页 / 对话框 / 空态 / 明细档）
- **起因与取舍**：评估 Meta Astryx（MIT、React 19+、预编译 CSS、150+ 组件）是否替换自有体系 —— **结论不引入**：① 它强制 React ≥19，而 vendored 内核包装层 peer 是 `react ^18`；② 自带一套 `--color-*` 令牌 + reset/astryx-base 层（会追加到我们 8 层之后、压过 kit/a11y）；③ 体积（astryx.css 40KB gz）撞已红的 entry 预算；④ 视觉是另一套产品语言，且 261006 已定稿「品类标准 / 布局冻结」。⇒ 改为**只借语汇**，全部落在自有 `--lake-*` / `ln-*`，零新依赖。
- **第一批**（`9c431b59` 之前的分支提交）：设置内容区 白→`--lake-bg-window`（白卡浮起来，与移动端「灰底 + 白卡」同构）；分组卡圆角 10→`--lake-radius-card`(12)；`.ln-dialog__actions` 加 0.5px 底栏分隔线。
- **第二批**：对话框内距统一 20 档；**对话框只有一套字阶**（标题 18 / 正文 14，删除 5 个「管理型弹窗」的分档覆盖与 `--lake-dialog-*` 变量）；空态三级层级升档（标题 14 / 说明 12 / 间距 6 / 图标统一 28）；行内元信息 11→12。
- **护栏同步**：`cssLayers` 基线按实测收紧（overlay 305→290、components 366→358）；`namePromptWiring.test` 契约改为「一套 18/14 + 无分档变量」。
- **门禁（master 合并后实测）**：tsc 0；全量 vitest **825 文件（814 passed / 11 skipped）/ 5216 passed / 12 skipped / 0 failed**；ui-metrics / check:core / check:mobileui / `git diff --check` 通过。
- **遗留**：桌面 `check:stylesnap` 42 态未跑（本机无合成夹具缓存，且当前无「日记空间」态）——本批动了设置页表面与对话框几何 ⇒ **下次有夹具的机器必须重烤/复核**。样机与 before/after 对照装置当时在本地分支 `spike/astryx-visual-prototype`（未推）；**该分支已于 261110 按用户「只留 master」删除**（提交 `9a8bd0e8` / `d358473f` / `550fc843` 仅存本机 reflog；结论已全部写在本文件与 DESIGN.md，代码不再需要）。

### 261110 · 移动端首页改版：底部五格 Dock + 中央悬浮＋（方案 A）
- **用户点单**（先讨论定方案 A，参照淘宝/京东底部五格）：5 个一级空间下沉到底部；三条硬要求：① 可左右滑动切换 ② 「＋」保留长按上滑速记 ③ **云同步始终可见、不收起**。
- **结构**：`HOME_TABS` 扩到 5（quick / library / diary / **ai** / tags），Dock 与分页 DOM 同源；AI = 第 4 格分页内嵌（`MobileAiPage embedded`，**不再全屏路由**；返回键回上一个非 AI 空间；会话 store 不变）；顶栏 = 设置 | 空间标题 | 排序/视图 + 搜索 + **云同步（最右、恒可见）**；Dock 五格（图标 + 10px 标签）+ 悬浮＋（52 圆、主色、位于 Dock 上方）；写作/多选态隐藏 Dock 与＋。
- **手势**：沿用 `ui/createPress.ts`（260ms 长按 + 36px 上滑），从旧胶囊搬到 FAB；⚠️ **FAB 必须 `touch-action:none`**（否则上滑被判成页面滚动 → pointercancel，速记永远不触发；设备实测踩到）。
- **冷启动骨架**同步成同构（标题 + 5 格 + ＋ 占位），数据到达不跳。
- **门禁**：tsc 0；`src/mobile` **292 文件 / 1465 例通过**；`check:mobileui` 通过；Android `--sync --install` 设备验证（`lake_mobile` / emulator-5556）。
- **设备实测**：Dock 点按切页（分页 scrollLeft 对齐）、横滑切页、FAB 短按开新建面板、长按浮出「继续上滑记小记」、云同步按钮在 小记/知识库/AI 均可见、AI 分页内嵌渲染。
- **遗留（261110 收口批已结）**：~~快照基线未重烤~~ → 手机/平板 9 态 + 多维表 3 态已重烤并两轮 0 差异、走查 23/23 ok（见上一条收口批）；~~旧胶囊首页死规则暂留~~ → 已删并收紧 mobileLayers 基线；移动「知识库」vs 桌面「文档」命名仍未统一（待用户定）。

### 261109 · 日记六改（独立 tab / 一天多篇 / 选日期 / 标题锁 / 选中态 / 转小记）
- **独立 tab**：`OpenTab.space`（`desktopTypes`/`MultiTabEditor.TabInfo`/`desktopDerivedState` 三处透传）；App 按空间分流 `libraryTabs` / `diaryTabs`，日记空间顶栏渲染自己的 tab 条（`aria-label="打开的日记"`），切空间时活动标签回落到该空间。
- **一天多篇**：`core.planDiaryCreate` + `diaryStore.openDate(dateKey, { mode })`（`open` 默认 / `new` 永远新建）+ IPC `diary_open_date(dateKey, mode)` + `native.diaryOpenDate(dateKey, mode)`；同日多篇不再当"重复文档"告警，`DiaryEntry.createdAt` 支撑同日按创建时间倒序。
- **UI**：日记左栏 **＋ = 今天新建**、**日历 = 选日期新建**（Menu + `input[type=date]`）；同日多篇行内显示 HH:mm；**选中态**与目录树同一套令牌（此前被 `background:transparent` 盖掉）。
- **标题锁**：`core.isDiaryEntryNode` 判据，`useTreeActions.renameTreeNode` 对日记条目直接拒绝（「日记标题就是日期，不能改」）。
- **转为小记**：右键 →「转为小记」；日期标题写入小记第一行 + 正文接后面；媒体卡片不搬运（toast 明说）；成功后日记移入回收站（软删可恢复）。
- 门禁：tsc 0；vitest **819 文件 / 5162 通过 / 12 skipped / 0 failed**；ui-metrics / check:mobileui / diff-check 通过；CSS 基线（diary.css 118→131、移动 mobile.css 1645）已登记实测理由。

### 261109 · 空间顺序与快捷键（用户定稿）
- 空间菜单顺序改为 **文档 ⌘1 · 小记 ⌘2 · 日记 ⌘3 · AI 写作 ⌘4 · 标签 ⌘5**（日记与 AI 写作换位；标签也进快捷键表）。
- **快捷键单一来源**：⌘1–5 全部收进 `src/hooks/useDesktopLifecycle.ts` 的一张 map；删掉 `App.tsx` 里单独注册的 ⌘4 监听（review 遗留项 ② 闭合）。护栏 `src/features/diary/diaryWorkspace.test.ts` ② 断言表内容 + App 不得再自注册。

### 261110 · 日记收尾（删除 / 原路恢复 / 徽标 / 弹层定位统一 / 保存守卫自愈）
- **日记删除**：桌面条目右键 + 移动端 ⋯ →「删除」，复用既有删除确认与 `deleteTreeNode`（软删进回收站）。
- **恢复 = 原路返回**（用户定稿：没转换就"从哪来回哪去"）：原父被删时，桌面 `trashLifecycle` / 移动 `resolveRestoreParent` 先认来源（`space="diary"` 的笔记本，**只看原始父链不看标题**），再**按标题日期补建 年/月 分组**后恢复；普通文档回落不变；已「转为小记」的软删也回日记空间。
- **回收站徽标**：「日记」（桌面 `.badge` / 移动 `.mb-tag`），来源判据与恢复同一份（`electron/trashDiaryOrigin.ts`）。
- **弹层定位统一**（用户点单）：所有模式都保证落在视口内 —— 下翻上、右翻左、四边夹取（`fitPopoverInViewport`）；`below-fixed` 补上方翻转（修「日记本换图标按钮在窗口底部 → 面板压成 1px 不可见」）；AI 贴选区弹窗仍是**不翻上**的显式例外。
- **保存守卫竞态自愈**：磁盘内容若**正好等于**我方要写的内容，则只当作 baseHash 陈旧（不弹「已被他处编辑」）；内容不同仍照常拦截。
- **更新中心**：手动检查**不自动下载**（两端），给「下载安装包 / 前往发布页」；网络失败给可操作原因 + 主进程日志。
- **移动端**：首页 ＋ 新建面板加「日记」（默认今天、幂等打开）；日记页 ⋯ 加「删除」；回收站行显示「日记」徽标。
- 门禁：tsc 0；vitest **822 文件 / 5184 通过 / 12 skipped / 0 failed**；ui-metrics / check:mobileui / check:arch（import 0） / diff-check 通过。CSS 基线登记：kit 613、diary 144、aiWriting 446。
- **未跑**：移动端设备门禁（首页 tab 4 个 + 顶栏栅格 + 新建面板变了，需在 `lake_gate` 重烤基线后双轮对拍 + 23 屏走查）；桌面 42 态。
- **推送前 review 修复（261110）**：① 移出 `.ai-writing-recon/` 59 文件 / 15MB 走查资产（`git rm -r --cached`，本地保留；**历史里仍有**，未做 history rewrite）；② 移动端日记标题锁（顶栏只读 + `NotebookWorkspace` 拦截 + `treeRepository.renameTreeNode` 数据层兜底）；③ tab 空间分流三处回归（搜索命中日记切空间、目标空间无 tab 时清 active、重启按上次活动 tab 回日记空间；`openNote` 给已存在 tab 补 `space`）；④ 保存守卫自愈：内容相同但**标题变了**不再静默丢弃（走正常写路径）；⑤ 恢复时日记年/月分组建在**事务内**；⑥ 移动回收站徽标查询从 N+1 收敛为一次 folders 读取 + 内存回溯。
- **仍待（review 遗留）**：`mobile-entry-css` 余量仅 **1,143B**（下批任意移动端 CSS 加行即破）；弹层定位统一后建议对「AI 贴选区 / NodeWidget 换图标（窗口底部）/ 多维表展开面板（屏幕右缘）」各做一次视觉走查。

### 261109 · 日记七改（月历原语上收 / 左栏可拖 / 日记本图标 / 标签条补全）
- **月历原语上收**：`.bt-date-*` 面板样式 → kit 的 `.ln-calendar*`，行为抽成 `components/ui/CalendarPanel`（多维表日期字段与日记「按日期新建」**同一实现**）；日记流程改为「点日历 → 应用内月历 → 选完 → 确认新建」，不再弹系统 date picker。
- **左栏可拖**：日记空间与 AI 写作空间都改用 `SplitPane`/`SplitHandle`（分隔条唯一实现；宽度存 `lakex-local-notes-v3.split.<key>`，设备本地）。
- **日记本图标前置**：名字前显示笔记本图标（默认图标兜底），点它直接复用 `NodeIconPicker`；移除原来独立的图片图标按钮。
- **日记标签条补全**：多于 1 个标签时出现「关闭全部」与「▾ 切换器」（菜单列标签，当前项高亮）。
- 门禁：tsc 0；vitest **820 文件 / 5164 通过 / 12 skipped / 0 failed**；ui-metrics / check:mobileui / check:arch（import 0） / diff-check 通过；CSS 基线登记 kit 576→613（月历原语）、diary 131→143、aiWriting 437→442。

### 261109 · 标签视觉小抽 + 白屏修复
- **白屏（开发版打不开）根因**：日记「空间切换回落」的 `useEffect` 被写在 `if (!workspace) return` **之后** ⇒ 首渲染少跑一个 hook ⇒ React「Hooks 顺序变化」⇒ 白屏。已移到早期 return 之前（判据改用 `openTabs`），并加护栏：effect 必须在早期 return 之前。
- **小抽**：新增 `src/features/editor/TabItemVisual.tsx`（纯展示：标题/图标/钉住/脏点/已删除徽标/关闭），文档标签与日记标签**同源**；拖拽/钉住/分屏/右键仍留在 `MultiTabEditor`（那是文档空间语义）。护栏 `tabItemVisual.test.ts`：日记侧不得自写 `.tab-title/.tab-close`，文档侧普通标签必须走视觉原子。
- 门禁：tsc 0；vitest **820 文件 / 5164 通过 / 12 skipped / 0 failed**；ui-metrics / check:mobileui / check:arch（import 违规 0） / diff-check 通过。

### 261109 · 更新中心两处修正（VPN 现场 ⇒ 可观测性 + 手动检查语义）
- **现场**：v1.0.5 桌面点「检查更新」显示裸的 `fetch failed`。实测：失败时三次都是 **~10.5s**（= undici 默认 10s 连接超时），清单本身正常（隔离实例 2.0s 拿到 `available 1.1.0`）；根因是**开着 VPN 时到 GitHub 的连接被黑洞**，关掉即恢复。**不是代码/清单问题**。
- **可观测性（此前为 0）**：`describeError` 现在把 `error.cause.code` 翻成可操作说明 + 保留原始码（如「连接 GitHub 超时 · 请检查代理 / VPN 后重试（UND_ERR_CONNECT_TIMEOUT）」），并在**检查失败时写主进程日志**（此前只有 `ipc.slow` 告警，现场无法复盘）。
- **手动检查不自动下载（用户定稿）**：`runCheck(wasAuto)` 的自动下载条件加 `wasAuto` —— 手动检查只停在「可用更新」，由用户点「下载安装包」或「前往发布页」（后者 = `manifest.releasePageUrl` = GitHub 最新 tag 页）。移动端 `checkForUpdates({manual})` 同口径（手动直接 return，不再走 `decideAutoDownload`）。规格已回填 [docs/UPDATE-CENTER.md](UPDATE-CENTER.md)。
- 门禁：tsc 0；vitest **819 文件 / 5155 通过 / 12 skipped / 0 failed**；ui-metrics、check:mobileui、diff-check 通过。**设备级未验**（手动检查→停在可用更新→点下载/前往发布页，建议下一次设备走查覆盖）。


### 261109 · 日记空间 v1（文档形态 + 独立空间；桌面 + 移动）
- **定稿（用户 261109）**：日记 = **文档空间里的一本笔记本**（不新建数据空间/不新建表，正文/历史/回收站/搜索/导出/备份全复用）；表现 = 顶层**独立空间**（桌面空间组第 4 项 **⌘4**，移动端首页第 4 个 tab）；**标题即日期 `YYYY-MM-DD`**；`年 → 月` 两级分组自动建；**要搜索、不打标**；v1 不做缺天提示/补写/月历/streak/提醒。规格 [docs/DIARY.md](DIARY.md)。
- **wire**：`folders[].space?: "diary" | null`（**不复用 `kind`** —— `TreeNode.kind` 是文档类型）；**发布显式写 null**（非日记不省略字段，同 `tagIds` 空集合教训）；两端 `tree_nodes.space` 列（移动 schema 11→12）。
- **桌面**：`electron/diaryStore.ts`（主进程**重新 plan** + **单事务**建本/年组/月组/文档 + 正文半成品回收 + 连点只一篇）、IPC `diary_open_date`（落 `electron/ipc/registerDiary.ts`，通道 185→**186**）、`src/features/diary/**`（空间页复用 `EditorTab`，左栏年月，空态「写今天」）、文档空间目录树**过滤掉日记本**、⌘4。
- **移动**：`src/mobile/diary/**`（`diaryRepository` 同款单事务 ensure + `DiaryPage`）、`bridge/diary.ts`（互斥域 `diaryOpenDate` 已登记进 `WRITE_OPS`）、首页 **第 4 个 tab**（只改 tab 行，不动 5 槽定稿构图；≤385px 收紧几何）、知识库/目录抽屉过滤日记本。
- **搜索**：日记是文档 ⇒ 天然在 FTS；空间内搜索 = 复用现有面板 + `scopeNoteIds` **纯显示层**收窄（**不新增索引**）。
- **转为文档（同日追加）**：日记条目右键（移动端条目操作入口）→「转为文档…」→ 选目标笔记本 → **移动**落地（同一 note，不复制）；判据 = `core.diaryConvertTargets/planDiaryConvert`，目标选择复用两端既有 `MoveTargetTreeDialog` / `MoveTargetTreeSheet`；不自动清理搬空的年/月分组。
- **门禁**：tsc 0；vitest **799 文件 / 5090 通过 / 11 skipped / 12 skipped / 0 failed**（含独立验证者补的 10 例：wire 往返 7 / 移动事务 3）；ui-metrics、check:core、check:mobileui、diff-check 通过。**设备级未跑**（移动 6 态/走查、桌面 stylesnap 还没有"日记态"）。
- **独立验证（片D，生产代码零改动）**：四条硬规则逐条自证通过（wire 显式写 null / 未知值当非日记 / 连点只一篇 / 事务回滚 / 桌面+移动树过滤）；另发现 **P1 已修**＝移动端便携包导入丢失 `space`（否则手机导入后日记本降级为普通本、再点「写今天」会建第二本）——修法 = `portableMapping` 行加 `space`（按 nodeType 归一）+ `importPortable` INSERT 加列 + 跨端搬运测试；同时补了移动端「多日记本告警」与 wire 侧 `space × nodeType` 互校。
- **并行注意（已合并）**：本批原在 worktree `lakex-local-notes-diary`（`feat/diary-space`，起点 `f3b2d0c3`），**不含** AI 写作（那是 `feat/ai-writing-space` 另一个 worktree）⇒ 合并时 `App.tsx` / `desktop/desktopTypes.ts` / `desktop/DesktopTopBar.tsx` 必冲突，按"两边空间项都保留"手工合。
### 261109 · AI 写作空间 v1（桌面新空间，⌘3）
- 需求：仿语雀 `/dashboard/ai`（真实登录态点测走查记录在仓库外 `.ai-writing-recon/`，**不入库**）；用户定稿：**只桌面**（移动端已有 AI 助手，不跨端）、会话**不进 S3**、**深度思考默认开且不提供关闭入口**、**生成文档只选到知识库（笔记本）**、模型用现有供应商配置。
- 交互：左栏「AI 写作 / ＋新对话 / 历史记录（今天·昨天·更早；… → 重命名行内输入、删除行内确认气泡）」；主区分段「对话写作 / 多文档推理」；提示词库 6 卡（点卡片 = 挂到输入卡 chip，不写正文）；多文档「快捷组（今天/近一周/近一月 × 文档/小记）+ 按笔记本勾选」，chip 显示「N 篇文档」；发送/停止/重新生成/复制；助手消息 =「已深度思考（用时 X 秒）」+ 思考块 + Markdown 答案（GFM 表格）+ 操作条（生成文档 / 保存到小记）。
- 数据：本地两表 `ai_writing_conversations` / `ai_writing_messages`（主库，**不进树/搜索/同步**）；IPC 9 个（通道 176→185）；渲染层 native 桥与主进程共用 `core/aiWriting` 的载荷类型。
- AI：推理内容贯通（`reasoning_content`/`reasoning` → `ai:stream { reasoning: true }` → 思考块）；供应商无思考输出则不显示；思考与正文都不进上下文。
- 生成文档：选知识库（笔记本）→ `convertAiMarkdown`（Markdown→Lake；仅 render-timeout 重建重试一次）→ `createNoteIn` + `saveNote`；保存到小记：纯文本镜像 + lake 正文。
- 本轮修的通用问题：① 窗口被遮挡时 rAF 不触发 ⇒ Markdown 转换队列永久挂住（`nextFrame` 加 250ms 兜底，超时能报错而不是锁死队列）；② SDK 在 abort 后可能**正常结束**流 ⇒ 停止标记丢失（收敛到 `aiWritingTurn`，stop 先置位再取消）。
- 真机/真实模型验证（dev，mimo）：单轮对话 + 思考块 + 停止（保留片段、标「已停止生成」）、多文档 11 篇资料总结、生成文档（lake 正文含标题/列表/引用/表格）、保存到小记（卡片预览为纯文本）、历史重命名/删除气泡、空间菜单与 ⌘3 切换。
- **v1.1 答案渲染对齐（261109，同分支）**：助手答案改为**内核只读 viewer**（`createLakeDocument(host,"viewer")` + `setDocument("text/markdown")`，内核原生解析）：任务清单/表格/引用/代码/行内与块级公式全部正确；流式期间仍用 MarkdownView，收尾后 pending→rich 切换（pending 期间 viewer 绝对定位隐藏，避免兜底与正文双份可见）；viewer 是 lazy 边界（内核 chunk 不进首屏，护栏 `desktopKernelLazy.test.ts`），进视口才建实例、同实例多次 setDocument。验证：真实模型输出（任务清单/两列表格/行内+块级公式/代码）在聊天里渲染正确、`生成文档` 落地为 `lake-list-task`+checkbox 卡 / `name="math"` 卡 / 表格。
- 未跑：桌面 42 态 / 移动端 6 态 / 23 屏走查（本批只新增桌面空间与消息内 viewer，选择器都限定在 `.ai-writing-active` / `.aiw`，未改既有几何；发版前按 AGENTS §3#21 补跑一次全量）。

### 261109 · 便携包（桌面 → 手机 一次性全量搬运）
- 需求：S3 首次全量同步贵；桌面导出单 zip（不含历史）→ 网盘/USB → 手机覆盖导入 → 之后 S3 只做增量。用户口径：覆盖；含回收站/小记/标签；排除历史快照；不加密；单包 **≤4GiB**（超限暂不支持分卷）；一次性 bootstrap；桌面仅在云同步已启用且上轮同步成功/无待同步时可用；手机导入不强制先配 S3。
- 桌面：`electron/portable/{zipStore,portableExport}.ts`（自研 store-only zip、VACUUM INTO 快照、白名单遍历）+ `electron/ipc/registerPortable.ts` + 设置页「备份与恢复 → 导出便携包」；IPC 通道 173→176。
- 手机：`PortablePackagePlugin.kt`（选包/解压/只读读桌面库/复制文件/回滚）+ `src/mobile/portable/*`（tree_nodes+notes→folders/notes、quick-notes→quick_notes/tags、baseline→sync_v3_state、FTS 重建、失败回滚）+ 设置页入口。
- 验证：桌面在隔离 userData 上真实导出通过（5.6MB / 96 entries / 14 文档 / 4 目录 / 3 小记 / 4 标签 / 75 资产，无 history/draft/logs）；手机真机导入通过（14 文档：6 doc/3 usheet/2 bitable/2 ink/1 board、5 目录含回收站、3 小记、4 标签、92 文件；打开 doc 与 bitable 正常，note_history=0、is_dirty=0、v3 baseline 已写入）。**踩坑已修**：store-only zip 原先用数据描述符，Java `ZipInputStream` 会读成空文件（真机报「便携包无效」）⇒ 改为本地头写 CRC/大小（每个文件读两遍），重导通过。
- 真机验证（大包 3.0GiB 合成数据：314 文档 + 165 资产 + 3 小记 + 4 标签；包 486 entries / 3,216,634,405 B，<4GiB）：导入成功，结果 314 文档 / 5 目录 / 3 小记 / 4 标签 / 482 文件（3065.2MB）。逐项核对：DB 行（notes/folders/quick_notes/tags/tag_links）与源完全一致、is_dirty 全 0、note_history 仅 1 条为导入后本机自动快照（非包内历史）、**482 个正文/资产文件 sha256 与源逐一相同**、165 个资产大小逐一相同（3,213,670,762 B）、手机 v3 baseline 与包内 baseline 完全相等（314/5/3/4，commits 一致）。S3 接续：src/core/s3v3Engine.ts 仅在无 baseline 时 full-sync；导入已写 baseline ⇒ 配好真实 S3 后走增量。该合成包用假 S3 基线，**不可用于真实 S3**；真实接续须从已同步的真实桌面导出。
- 门禁：tsc 0；vitest **783 files / 4993 passed / 12 skipped / 0 failed**（含 perf 集成偶发，重跑通过）；check:core / check:mobileui / diff-check 通过；Kotlin 离线编译通过。

### 261109 · 真实 S3 端到端验收（便携包 → 手机 → 增量同步）
- 真实七牛桶（Endpoint s3.cn-north-1.qiniucs.com / Region cn-north-1 / Bucket local-lake-hebei），测试前缀 **lakex-notes-dev3-portabletest2**（保留：98 对象 / 约 5.1MB，供复测；旧 ...portabletest 已删）。
- 桌面（隔离 userData，真实 dev 数据 14 文档 / 3 小记 / 75 资产）：首传 17 篇 + 92 对象、pending 0；导出便携包 5.6MB（baseline epoch 8cb91383、gen 1）。
- 手机：覆盖导入包成功（14 文档 / 5 目录 / 3 小记 / 4 标签 / 92 文件）；用桌面导出的迁移码导入 S3 配置；首次同步 **↑0 ↓0**，云端 pointer **仍为 generation 1**、commits 与包 baseline 完全一致（未发布新索引）；手机 baseline = 14 notes / 4 folders。
- 真机发现并修复：① 桌面同步成功后未清 folders.is_dirty ⇒ 待同步目录常驻、便携包导出被挡；已在 desktopSync 成功后按 updatedAt 条件 markFolderSynced。② 移动端 listFoldersForSync 把固定「回收站」笔记本也发布 ⇒ 首轮同步平白多发一代并把 notebook-trash 写进云端；已排除 TRASH_NOTEBOOK_ID（与桌面同口径）。
- 门禁：tsc 0；vitest **783 files / 4993 passed / 12 skipped / 0 failed**；diff-check 通过；Android 离线构建通过。

### 261110 · 便携包只接受 .zip.lln
- 用户定稿：不为历史数据做兼容 ⇒ Android staging 按文件名只接受 .zip.lln，旧 .zip 直接拒绝；桌面导出/UI/文档同步去掉「兼容旧 .zip」。

### 261109 · 便携包纯离线导出 + 后续 S3 接续
- 用户定稿：不配置 S3 也能导出；已启用云同步时导出前自动 sync 一次；纯离线迁移支持，之后配 S3 仍能同步。
- 桌面 portableExport：无 baseline.json.gz 时不再拒绝，改为生成 localOnly 内容哈希清单（notes/quickNotes 的 sha256）；manifest baseline=null。有云端基线时行为不变（manifest 带 baseline）。
- 手机导入：manifest.baseline=null 时只读内容哈希、不写 sync_v3_state.baseline；结果页明确提示「纯离线包」。Android staging 允许 baseline 为 null。
- 导出前同步：设置页按钮始终可用；portableExportStatus 返回 cloudActive/lastSyncedAt，cloudActive=true 时先 syncNow，失败则停止导出。
- 验证：桌面无 S3 隔离实例真实导出（5.6MB，baseline=null、内容哈希完整）；同一工作区随后配空 S3 前缀首传 14 文档/92 对象成功。手机（第二台模拟器）导入离线包成功（14/5/3/4/92，baseline=null），随后配 S3 同步成功并写入云端 baseline（↑0↓0，下载 4 目录；文档内容相同故 0 正文）。
- 测试前缀 ...-portabletest2 / ...-offlinetest 已清理；原 lakex-notes-dev3 未写。

### 261109 · 备份语义澄清 + 移动端顺序 + 便携包架构 review
- 备份语义：整库备份 = 完整工作区（DB 快照 + 正文/资源/历史快照），用于归档/整机迁移；自动/立即备份 = 仅两个数据库快照（无正文/资源/历史），用于快速回滚。两者互补；按钮/文案改为「整库备份（完整目录）/自动备份（仅数据库）/立即备份数据库/从数据库快照恢复」。
- 移动端设置顺序对齐桌面：常规 → 外观 → 云端与同步 → 备份与恢复 → 历史 → 导入 → 资源管理 → 清理缓存 → 回收站 → AI 助手 → 更新中心 → 关于；编辑器页标题改为「常规」。
- 移动端备份与恢复再拆三组：恢复 / 修复缺失数据 / 从桌面迁移；移除此前的页尾长说明，便携包说明压缩为一段。
- 261110 移动端设置表面统一：恢复「灰底 + 白卡」层次（手写分组容器自动补卡，Group/Section 原语不变）；云端与同步拆为「连接信息 / 连接与同步 / 配置迁移 / 服务说明」四组；关于拆为「关于 / 数据诊断」两组。
- 261110 P0 原语收敛：SettingsDrawer / BasicSettingsSections 全部改用 Group/Section，新增 settingsPrimitivesGuard 测试禁止再手写 mb-set-group/mb-set-items；S3/备份/关于按语义分组。
- 261110 P1：新增移动端 .mb-btn--settings（主题色描边、透明底，仅设置页），替换设置页 primary/secondary/ghost；设置菜单图标底色改 --mb-set-tone-* 令牌，不再写死 hex。确认/重命名/更新弹窗仍用 primary 实心。
- 261110 移动快照扩到 **9 态**：新增 settings-s3 / settings-backup / settings-about；设置抽屉/子页入口先判已开（避免二次点击把抽屉关掉），行用 DOM click + scrollIntoView。已在 lake_gate 连跑两轮，9 态 0 差异；基线 `scripts/mobile-audit/baseline/mobile-snap.json` 已重烤。
- 仍待：深/暖色下的设置页设备走查（移动端当前只有浅色/深色/纯黑三档）。
- 便携包 review：导出前同步下沉到主进程 beforeExport（任何入口一致）；离线哈希改用 noteBodyRelativePath 单一来源并缺正文直接报错；manifest.baseline=null 语义与 localOnly 哈希文件写入 spec §9。

### 261109 · UI 整理（移动端 + 桌面设置）
- 用户原则：能点的控件排在纯文字说明之前（免责声明除外）。
- 移动端：设置菜单把「更新中心」从首项移到「关于」上方（倒数第二）；备份与恢复/便携包导入/关于诊断改为「标题 → 操作按钮 → 说明/状态」；更新中心「检查间隔」改用 Field（控件独占一行，说明不再被右控件挤成窄列）；新增 mb-set-block--actions-first 原语（无手写样式）。
- 桌面设置：Block 新增 descAfter（操作/统计先出现、说明后置）；备份与恢复把「导出便携包」上移到自动备份之前、各操作块按钮前置；关于把「诊断（复制诊断信息）」上移到版本/环境之前，第三方许可保持最后。
- 备份与恢复再分组（对齐「数据维护」的多分组式）：桌面 = 备份 / 恢复 / 迁移到手机 三组；移动端 = 恢复 / 从桌面迁移 两组。每组内仍保持「操作 → 说明」。
- 261109 后续微调：桌面「备份占用 + 上次备份结果」拆成置底的「存储占用」组；关于页「数据与存储」置顶；数据维护页「回收站」「全文搜索」置顶。
- 261109 按钮/下拉与顺序收尾：新增 .ln-btn--outline（主题色描边 + 透明底，不填色），备份与恢复页动作按钮统一该样式；备份间隔改为 Select 下拉（每天/每周）；关于页顺序最终为「关于 → 数据与存储 → 诊断 → 版本与运行环境 → 第三方许可」（用户要求「关于」置顶）。
- 261109 设置页按钮原语收敛：新增 .ln-btn--settings（主题色描边 + 透明底 + 默认文字色，不填色/不染字），只在设置页使用；已替换 SettingsPanel / UpdateCenter / RebuildDataBlock 内的 primary/secondary/outline 按钮。重命名、确认等对话框仍保持实心 primary，不动。
- 便携包后缀改为 .zip.lln（桌面导出文件名；导入端兼容旧 .zip），见 docs/PORTABLE-TRANSFER.md。

### 261109 · 更新中心（桌面 + Android）
- 新增应用内更新中心：检查更新（GitHub latest release 的 `latest.json`，CI 生成）/ 更新日志（复用 `docs/RELEASE-NOTES.md`）/ 自动检查（默认开，启动 + 6/12/24h）/ 自动下载（默认开；Android 仅 Wi-Fi）/ 忽略此版本；**不做静默安装**（桌面打开安装包、Android 拉起系统安装器）。
- 桌面新增 8 个 IPC 通道（165→173，parity 通过）；Android 新增 `UpdatePlugin.kt`（DownloadManager + sha256/证书指纹校验 + FileProvider 安装器）；规格见 [docs/UPDATE-CENTER.md](UPDATE-CENTER.md)。
- 门禁：`npx tsc --noEmit` = 0；`npx vitest run` = **788 文件（777 passed / 11 skipped）/ 4961 passed / 12 skipped / 0 failed**；`git diff --check` = 0；新增单测 37 例。**Android 设备侧未验证**（下载→校验→系统安装器交互留待真机/模拟器）。
- 261109 追加：桌面更新中心改为设置独立「更新」分类页（无弹窗，检查频率用 Select 下拉）；移动端设置菜单「更新中心」放「关于」上方（倒数第二）、「关于」置底；两端的检查间隔都改用既有下拉原语（Select / PickerSheet），未新增 CSS。

### 261109 · 文档收口与门禁复核
- 重写本文件：删除 261106 及更早的 dated 批次（git 可查）；合并五份旧 RELEASE-NOTES；清理已删文档的悬空引用；所有相对链接重定向到现存文档（文档地图见 §1）。
- 清理一批已完成/过期文档与死代码（清单见 §1「工作树」）；更新中心规格与实现见 [docs/UPDATE-CENTER.md](UPDATE-CENTER.md)（见上一条 261109 更新中心）。
- 门禁实测（清理后）：`npx tsc --noEmit` = **0**；`npx vitest run` = **770 文件 / 4918 passed / 12 skipped / 0 failed**（11 文件 skipped）；`git diff --check` = **0**。`check:bundle` 的 mobile-entry 仍超目标（已知红，见 §1）。
- 本文件之后：先按 §1 核实 HEAD / worktree，再从 §3 领活；§2/§3 已定稿的语义不要再重新争论。

### 261108 · v1.0.4（移动端顶栏 / 手写板修复，已发布）
- 首页顶栏统一 16px 页边距（`--mb-page-pad`）、文字 tab `nowrap`、窄屏不再挤换行；Sheet / 全屏标签页头部与状态条右内距收口到 16。
- 手写板移动端导航新增「新建页」；阅读态单指左右滑动翻页（横向 ≥60px 且横向占优，纯视图不写正文）；页码固定单行。
- 版本 1.0.4 / versionCode 11004；发布说明并入 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)。验证：真机 412×842 截图通过；移动端 6 态基线重烤后两轮 0 差异、平板 6 态 0 差异、`check:mobileui` 通过。

### 261108 · v1.0.3（Gitee APK 镜像链路，已发布）
- 无业务改动，用于验证「GitHub 全量 + Gitee 只同步 Android APK」链路。Gitee 单附件上限 100MB、仓库附件 1GB ⇒ mac/Windows 包超限，workflow 只上传 `android-release.apk` 并校验响应。
- 本次 Gitee APK 上传约 30 分钟；步骤超时放宽到 50 分钟、单请求 40 分钟，避免慢速上传被误杀。GitHub Release 6 个资产齐全（commit `213c2f79`）；Gitee Release 说明带 GitHub 链接。
- 版本 1.0.3 / versionCode 11003。

### 261108 · v1.0.2（Android 正式签名，已发布）
- Android APK 从 debug keystore 切到 **release keystore**（GitHub Secrets 注入），CI 增加解码 + `apksigner` 指纹校验。证书 SHA-256：`A8:BA:87:F7:F7:A5:E0:68:71:CB:CF:4E:EF:10:78:A0:38:01:E2:B5:B6:DD:3C:82:55:51:6A:B5:CF:21:2E:35`。
- **v1.0.1（debug key）升级 v1.0.2 必须卸载重装**（会清本机数据，先备份）；v1.0.2 起同 key 可覆盖升级，keystore 必须离线备份。
- macOS 仍 x64 + arm64 ad-hoc（未公证）；Windows NSIS 不变。GitHub Release commit `6e37aa89`。

### 261108 · v1.0.1（macOS 双架构 + ad-hoc 签名，已发布）
- 修复 v1.0.0 macOS 产物被判「已损坏」：CI 改 `--x64 --arm64` 分别打包，`mac.identity=- + mac.hardenedRuntime=false` 做 ad-hoc 有效签名；universal 单包因 sharp arm64/x64 原生依赖冲突不可用。
- 未公证 ⇒ 首次打开走「系统设置 → 隐私与安全性 → 仍要打开」；免提示仍需 Apple Developer ID + 公证。commit `3ec036b4`。
- APK 仍是 debug keystore 签的 release 变体（正式签名在 v1.0.2 完成）。

### 261108 · v1.0.0 正式发版（已发布）
- 首个 1.0 正式版；GitHub Release（workflow run `42471006316` success）：mac arm64 dmg/zip（199MB）、Windows NSIS（165MB）、Android release APK（34.5MB）。
- 发版过程修复：打包冒烟搜索无障碍断言过期（「搜索标题和正文」→「搜索标题、正文和标签」）；CI 固定 npm 官方源 + electron 镜像 + Gradle 腾讯镜像；Android APK 改名不再依赖 `node -p`。
- **tag 事实**：v1.0.0 tag 在多次失败流水线后最终指向 `02be1b00`（产物来自该 commit），此前被移动过；此后 tag 不可移动，发错只能 bump 版本再发。macOS 未签名/未公证、Android 为 debug keystore 签的 release 变体。

### 261108 · 发版前 UI 抽样回归 + 其它 261107/261108 落地面
- **UI 抽样回归**（真实 CDP 鼠标/触摸驱动桌面隔离实例 + Android gate 手机/平板）：新建笔记本/文档、目录多选与右键批量、创建副本、批量打标签、批量删除确认与回收站恢复、文档标签/标签空间、全文搜索、S3 配置与首拉/上传、A/B 双向跨设备删除传播、历史恢复、附件下载、大文档、整库备份、原生文件选择器（dev-only 测试钩子）、S3 冲突留档。结论：未发现功能性报错/数据错误。残余风险 = 真实第三方 Android 分享面板、Android 文件选择器、AI 外部服务、S3 被覆盖版本一键恢复（回归文档已删，git 可查）。
- **文件导入（桌面）**：「导入」子菜单按类型分项 Markdown / Word(.docx) / Excel(.xlsx) / CSV；主进程 `mammoth` → HTML（图片转 data URL）、`read-excel-file` → usheet 工作簿；新增 `mammoth@1.13.0`、`read-excel-file@9.3.14`（仅在主进程，不影响首屏）。限制：.doc/.xls 不支持；Word 页眉页脚/脚注/修订/文本框/公式/分栏等不导入；Excel 只导值（公式取缓存）；CSV 全文本。移动端分享导入仍只覆盖 Markdown。
- 同窗口还落地：桌面「创建副本」（进度 + 取消、`noteDuplication` 存储无关抽取）、桌面多选菜单重做（工具条删除、动作收进右键、全选图标、批量打标只追加且可新建标签）、AI 助手架构收口（请求模型 + 定位/输出单源、AI 写作助手卡、面板视觉收敛）、单块复制桥（图文混排）、桌面「置顶」+ 移动端「常用」统一改名「置顶」。

### 261107 · 上线前最后一批（标签存储统一 + 数据安全守卫 + 同步/多选/安全修复）
- **桌面文档标签关系迁入小记库**（261107 起）：一次性 `ATTACH` 跨库事务 + 行数校验 + `tag_storage_meta.note_links_v2` 标记；失败保持主库旧服务（可回退，主库旧表保留一版、不再读写）。wire `tagIds/tagsUpdatedAt` 不变。**备份/恢复必须同时恢复两库**（`restoreMainDatabaseFromBackup` 已同步处理，缺失小记库时只恢复主库）。
- **数据安全**：`saveBaseline` 改守卫式归位（只清「本地 updated_at 仍等于基线快照」的行）；`applyRemoteNoteMeta` 用「本轮开始前本地快照」守卫；空目录保护上收 `core/quickNoteTags`。桌面 `sync-progress` 双订阅修复（进度刷新由常驻 `useSyncProgress` 单一 owner）。
- **移动多选**：`SELECTION_MAX=500`（旧实现 2 万篇 O(n²)）；`DocListSheet` >80 行用 `@tanstack/react-virtual`。
- **安全**：`read_import_image` 只接受本会话系统选择框选过的文件所在目录（含子目录）下的图片。
- **口径单源**：`core/duplicateNotesReport` / `errorContract` / `settingsDefaults` / `tagAggregate` / `batchNotesReport`；`desktop/treeSelection`、`desktop/moveTreeModel` 迁入 `src/core`。
- 门禁：tsc 0；vitest 784 文件 / 4947 例；`check:bundle` 的 mobile-entry 在**本批改动前的 HEAD 就已超**（entry 65,460B / preload 33 / 首屏 374,060B），本轮按现状冻结预算（66KB / 34 条 / 380KB）让 CI 恢复绿，目标仍是 60KB / ≤12 条 / 360KB。

### 261107 · 推送前 review（修复死样式清理误伤注释 + 清理死 API）
- **真实回归**：死样式清理脚本按「选择器 { 规则 }」正则删除，把注释里的 `.ne-editor-wrap-content { overflow-y: auto }` 示例当规则删掉，**连带删掉该注释的 `*/`** ⇒ `mobile.css` 出现未闭合注释，紧随其后的 QuickNoteComposer 动作行样式被整体注释。已恢复；mobile.css 声明数 1607→1617（仍低于改动前 1665）。
- 删除重命名改弹窗后遗留的 `renamingId/renameValue/onRename*` 死 props；`settingsGroups.test` 改为解析联合类型再断言；`useTagDragSort` 返回值只保留消费字段。
- **教训**：批量删样式/注释后必须核对注释配平（mobile.css 现 174/173 是既有历史不配平，不得新增），并跑一次设备/视觉门禁自证。

### 261107 · 移动端架构收敛（P1/P2 四批）
- **新原语**：`src/mobile/lib/actionError.ts`（`toastActionError`，22 处收口，文案逐字不变）、`ui/EmptyState.tsx`（43 处空态）、`ui/TopBarIconButton.tsx`（真按钮）、`ui/rowActivation.ts`、`ui/SheetFooter.tsx`（13 文件）、`ui/docBatch.ts`（多选共享判据）、`lib/listTime.ts`；`SettingsDrawer` 菜单模型抽到 `settings/settingsMenu.ts`；`TagsHomeTab` 拖拽抽 `tags/useTagDragSort.ts`；toast 二轮再迁 12 处（累计 34 处 / 12 文件）。
- **CSS 收敛**：bitable 细边白面合并、`.mb-list-item` 并入 `.mb-row`、新增 `.mb-glass`；死样式清理 −21 规则 / −90 声明。`mobileLayers` 基线同步收紧（kit 596→575、mobile 1665→1609 等）。
- 审计与 backlog 写进 [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md)「UI 原语与架构审计（261107）」；未做：大文件拆分、PageHeader 抽取（复核后判定不做，理由已记）。设备验证：手机 6 态 / 平板 6 态 / 多维表 3 态 0 差异。

### 261107 · 移动端 v2「柔光纸面」P1–P4 + 多选/命名/移动重做
- **v2 视觉基线**：唯一参照 `preview/mobile-paper-light.html`（不入库）；theme 令牌（光场 / 三层表面 / 柔光玻璃 / 圆角 12/16/26/28 / 动效）、三屏外壳（首页 / 文档 / 设置）光场与滚动玻璃顶栏、设置分组卡 + 彩色图标块、纯黑 OLED 档、笔记本动态主色（`core/mobileAccent`，不写正文、不参与同步）、共享元素转场（小记卡→写作卡、文档卡→工作区）。规格见 [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md)。
- **交互重做**：多选页 v2（`.mb-sel-topbar` / 浮动等分动作条 / 复选框绝对定位零位移 / 新增「置顶」「打标签」）；新建与重命名统一走 `NameSheet` 弹窗（不再行内 input）；移动目标选择只允许选笔记本（平铺 `MoveTargetTreeSheet` + 搜索，单选/多选共用）。
- **设备验收口径**：三套快照（手机 6 态 / 平板 6 态 / 多维表 3 态）必须以**重装后的新 APK** 重烤并连跑两轮 0 差异；旧 APK 上的绿灯不算数（261107 踩过）。
- 已知遗留：设置子页图标块未全铺（按用户要求先留）；移动端 `@layer` 未做（CSS 仍靠 import 顺序）。

## 1. 当前基线（唯一状态来源，261109）

> 本节按 261109 实测重写。**任何状态判断以本节 + `git status` / `git log -1` 为准**；§0 的抬头状态只作批次历史。

**版本与仓库**

- **261110 历史清理（一次性）**：`.ai-writing-recon/`（走查截图 / 页面快照 / 探针脚本，59 文件 ≈15MB）已用 `git filter-repo --invert-paths` 从**全部历史**移除；被重写的是 **v1.1.0 之后的 23 个提交**（hash 以 `git log` 为准），**v1.0.x / v1.1.0 的 tag 与其提交 hash 未变**（不含该目录）⇒ 已发布 Release 与 CI 产物不受影响。重写前快照：`/Users/admin/file/local-lake/lakex-local-notes-backup-<stamp>/all.bundle`（62MB，含全部 refs）。**旧 clone / worktree 需 `git fetch --force --prune` + `git reset --hard origin/master` 或重新 clone**（旧 hash 已不可达）；本机原 `lakex-local-notes-diary` worktree 已删除（其分支是 master 祖先，无内容丢失）。

- **worktree（261109 发版时）**：`lakex-local-notes` = `master`（发版主工作树）；`lakex-local-notes-diary` = `feat/diary-space`（本批开发用，已合并 master 并合回 master）。AI 写作与日记**都已进 master**，两个空间共存（⌘3 / ⌘4）。
- 主分支 `master`，HEAD = **`a9e50def`**（261111 骨架/预取/图片缩略/性能基线 + 快照基线重烤）；本批代码 = `79b91eb1`；其间并行会话提交 `eb526bf7`/`aa41333d`/`5383032a`（小记预览收口）与 `48b8f3d5`（桌面预热）。**`origin`（Gitee）仍停在 `544f2532`，以上均未 push**（`git push origin master` 双推）。
- `package.json` = **1.1.0**；Android `versionName 1.1.0` / `versionCode 11100`（从根 `package.json` 派生，版本号单一来源：`1000 + major*10000 + minor*100 + patch`）。
- tag：`v1.0.0`–`v1.0.5`、**`v1.1.0`**（另有旧 `v0.0.1` / `v0.0.2`）；已发布 tag 不再移动。`v1.1.0` = AI 写作 + 日记两个新空间。
- `v1.0.5` 是**发在 AI 写作合并之前**的：AI 写作第一次随本版发布，别在旧发布说明里找它。
- 分支：`master`（唯一长期分支，本地 + Gitee + GitHub 同步）；特性分支用完即合，不留长期分支。
- 远端：`origin` = Gitee（SSH，日常拉取/推送源），第二 pushurl = GitHub HTTPS ⇒ `git push origin <branch>` 一次推两边；GitHub 只在推 tag 时构建。
- 发布说明：[docs/RELEASE-NOTES.md](RELEASE-NOTES.md)（v1.1.0 → v1.0.0 倒序合集，原五份独立文件已合并删除）；**v1.1.0 段落 = CI 生成 GitHub Release 正文的来源**（release job 抽当前 tag 段落）。

**工作树（261109 清理批 + 更新中心批，已提交）**

- 清理批分三个本地提交：`e4f1fd3f`（代码死文件 26 个）、`967c09e6`（文档清理：删 20 篇 + 5 份旧发布说明合并为 [docs/RELEASE-NOTES.md](RELEASE-NOTES.md)）、`04eb32a7`（HANDOFF / AGENTS / README / PRODUCT / DESIGN / MOBILE-OPS 对齐）；**工作树仍未 clean** —— 另一会话的 AI 助手批次（`src/features/ai/**`、`features/aiWriting/**`、`styles/app/misc.css`、`styles/app/tabs.css`、`cssLayers.test.ts` 增量与 HANDOFF 里的该批次条目）尚未提交；提交本批时已按文件隔离，不属本批。
- 文档：删除一批已完成/过期的研究、审计、回归文档；新增 RELEASE-NOTES 合集；ARCHITECTURE / LAKEX-CONTRACT / MOBILE-LONG-DOC-PROBE 等随清理更新。
- 代码：删除已确认无引用的死模块（`src/core/decideUpload*`、`lakeReconcile*`、`quickNoteReconcile*`、`syncDecision*`、`electron/mdToHtml.ts`、`electron/storeUtils.ts`、`electron/syncDecision.ts` 及若干一次性 scripts）；`QuickNoteEditor` / `QuickNotePreview` 等有小改。
- 本文件（HANDOFF）已重写并随本批提交；其余文件清单与 diff 见上述提交。
- **261109 更新中心批（本提交）**：`docs/UPDATE-CENTER.md` + `src/core/update/` + `electron/update/` + `electron/ipc/registerUpdate.ts` + 桌面 `UpdateCenter` UI + Android `UpdatePlugin.kt` + 移动更新中心 UI + CI `scripts/generate-update-manifest.mjs`；新增单测 37 例。
- **261109 AI 写作批（已合并 master：`53fe678c` → `4ec1b6a4` → `84a6879a`，合并提交 `986e2151`）**：`docs/AI-WRITING.md` + `src/core/aiWriting.ts`（纯逻辑/预算/消息组装 + IPC 载荷类型）+ `electron/aiWritingRepository.ts` + `electron/ipc/registerAiWriting.ts`（通道 176→185）+ `src/features/aiWriting/*`（工作区/侧栏/输入卡/提示词库/文档选择/消息/两个弹窗/回合与上下文模块/转换包装）+ 桌面壳层接入（`desktopTypes` / `DesktopTopBar` / `useDesktopLifecycle` / `App` / `shell.css`）；AI 流式思考内容贯通（`reasoning_content`）；新增单测 42 例（core 10 / 仓库 5 / turn 5 / context 4 / docs 7 / 转换 9 / 既有 AI 2）。

- **261109 日记批（本会话；已合并 master）**：`docs/DIARY.md` + `src/core/diary.ts`（判据单一来源）+ `electron/diaryStore.ts` + `electron/ipc/registerDiary.ts`（通道 185→**186**）+ `src/features/diary/*`（桌面空间页/右键「转为文档」）+ `src/mobile/diary/*`（第 4 tab、日记页、转文档、`diaryNodesFrom`）+ wire `folders[].space` + 两端 `tree_nodes/folders.space` 列（移动 schema 12）+ 便携包搬运 space。独立验证者补 10 例（wire 往返/移动事务），本会话累计新增约 101 例。

**门禁基线（261109 发版前：AI 写作 + 日记合并后实测）**

- `npx tsc --noEmit` = **0 错**。
- `npx vitest run` = **862 文件（850 passed / 11 skipped）/ 5398 例**（261111 骨架/预取/图片批提交前实测；唯一失败 `electron/s3v3/perf.integration` 的时延门禁在本机满负载下 flaky，孤立重跑通过——既有口径）。
- **261110 AI 助手 / 小记批（本批实测，含「钉住=每作用域挂起」「标题可改」「弹窗走内核渲染」「时间线自适应」）**：`npx tsc --noEmit` 0；全量 vitest **855 文件（844 passed / 11 skipped）/ 5357 passed / 12 skipped / 0 failed**（本批新增：`aiAssistantSession` 4 例 / `AiMessageView.render` 5 例 / `aiLakeKernelRegistry` 4 例 / `AiWritingDialogs.render` +2 例）；`ui-metrics` 颜色 0 / !important 9=清单 / 跨文件重复 103≤105；`git diff --check` 0；`cssLayers` 基线 `app/tabs.css` 188→189、`ai/aiDialogParts.css` 87→91、`app/quick-notes.css` 667→674（均写明理由）。
- `git diff --check` = **0**。
- `check:bundle` / `check:arch`：**已转绿**（261110 首屏瘦身）。mobile-entry = **59,835 gz / 6 链接**、首屏 347,990 / 360,000（余量 12.0KB）、entry CSS 140,392 / 141,312；desktop app-js 191,799 / 307,200、首屏 564,378 / 600,000（余量 35.6KB）。预算已按目标收紧（`check-bundle-budget.mjs` 12 条 / 60KB、`check-arch.mjs` 360KB），不再有「已知红」。**注意**：preload 条数只防「静态依赖回入口」，字节由 `check-arch` 守 —— 不要为了压低条数把懒加载改回静态。运行前需先有 `dist` / `dist-mobile` 构建产物。
- 其它样式/边界/设备门禁按改动范围跑（分层口径见 AGENTS §3#21）；最近一次移动设备记录 = **261110（移动收口批）**：手机 **9 态重烤基线 + 两轮 0 差异**、**平板 9 态补烤 + 两轮 0 差异**、**多维表 3 态重烤**、**23 屏 23/23 ok**（`lake_gate` / `lake_tab`，详见 §0 收口批）；桌面 `check:stylesnap` 42 态仍未跑（本机无合成夹具缓存，见 §3）。

**设备与环境（本机实测）**

- Node **v24.18.0**（`$HOME/.nvm/versions/node/v24.18.0/bin`，必须 24）；JDK **21**（`/Library/Java/JavaVirtualMachines/jdk-21.jdk`；系统默认 java 是 1.8，手跑 gradlew 必须指 21）；Android SDK `/opt/homebrew/share/android-commandlinetools`。
- AVD 3 个：`lake_mobile`（开发默认）/ `lake_gate`（门禁固定夹具，**勿改其数据**）/ `lake_tab`（平板与窗口矩阵）；移动端 AVD 的 CDP **9335 开发 / 9336 门禁 / 9340 平板与窗口矩阵**（桌面 dev 走 9222；设备 serial 以 `adb devices` 现场为准）。
- 手机 9 态 / 平板 9 态 / 多维表 3 态 = 261110 收口批重烤并两轮 0 差异；23 屏走查 261110 23/23。本批（261110 接手批）未重跑设备装置、未装包，见 §3。
- 桌面数据：开发 `~/Library/Application Support/lakex-local-notes-dev`，正式 `~/Library/Application Support/lakex-local-notes`（**禁止触碰**）；日志在对应目录 `logs/`。

**发布与推送事实**

- Android 签名 = release keystore（证书 SHA-256 见 §0 v1.0.2）；keystore 必须离线备份，丢失后无法覆盖升级。
- macOS = x64 + arm64 分开打包，ad-hoc 签名未公证（首次打开走「仍要打开」）；免提示需 Apple Developer ID + 公证。
- **GitHub 推送：优先走 SSH remote `github`**（261109 实测：HTTPS 到 github.com **完全不通**（443 连接超时/HTTP2 framing），SSH 22 **可用** ⇒ `git push github master`；`origin` 的 HTTPS pushurl 会失败）。**VPN 开启时 GitHub 一律不通（含发版 tag 推送）**，发版前确认 VPN 已关。HTTPS 可用时期的老办法：`git -c http.version=HTTP/1.1 push <url> <branch>`。曾用 `http.curloptResolve` 仅对单次 git 命令覆盖 DNS 解决（不改全局 DNS/代理/TLS，不固化 IP）。
- **v1.1.0 发版（261109 20:03 CST）**：master = `075272b2`（已推 Gitee + GitHub），注解 tag **`v1.1.0`** 已推两处并触发 GitHub `Release` workflow（macOS x64+arm64 / Windows / Android / publish）；tag 指向 `075272b2`，**不可移动**。发版前 review 修掉三项 P1（AI 写作排除日记子树与日记本、槽位上移消除 features→desktop 违规、AI 写作改 lazy 回收首屏余量）。
- **本机 stash 已清空**（原 a11y WIP 已合并进 master，261110）；`git status` 应为 clean。
- 发版流程见 [docs/RELEASE.md](RELEASE.md)；用户手册见 [guide/README.md](../guide/README.md)。

**文档地图（现存；已删文档不要再链）**

- 概览 / 红线：[README.md](../README.md) · 本文件 · [AGENTS.md](../AGENTS.md)
- 架构：[docs/ARCHITECTURE.md](ARCHITECTURE.md) · 产品 / 设计：[docs/PRODUCT.md](PRODUCT.md) · [docs/DESIGN.md](DESIGN.md) · [docs/MOBILE-DESIGN.md](MOBILE-DESIGN.md) · [docs/PAD-ADAPTATION.md](PAD-ADAPTATION.md)
- 同步 / 存储 / 容错：[docs/SYNC-PROTOCOL.md](SYNC-PROTOCOL.md) · [docs/STORAGE-LAYERS.md](STORAGE-LAYERS.md) · [docs/RESILIENCE.md](RESILIENCE.md) · [docs/SYNC-DEVICE-CONTRACT.md](SYNC-DEVICE-CONTRACT.md) · [docs/SYNC-STATE-CONVERGENCE.md](SYNC-STATE-CONVERGENCE.md)
- 内核 / 表格 / 多维表 / 手写板：[docs/LAKEX-CONTRACT.md](LAKEX-CONTRACT.md) · [docs/lakexEditor-developer-docs/](lakexEditor-developer-docs/) · [docs/USHEET-UPGRADE.md](USHEET-UPGRADE.md) · [docs/INK-PAD.md](INK-PAD.md) · [docs/BITABLE-VIEWPORT.md](BITABLE-VIEWPORT.md)
- 移动端：[docs/MOBILE-OPS.md](MOBILE-OPS.md) · [docs/MOBILE-TECH-STACK.md](MOBILE-TECH-STACK.md) · [docs/MOBILE-AI.md](MOBILE-AI.md) · [docs/MOBILE-BITABLE-DINGTALK.md](MOBILE-BITABLE-DINGTALK.md) · [docs/MOBILE-USHEET-YUQUE-PARITY.md](MOBILE-USHEET-YUQUE-PARITY.md)
- 工程 / 排错：[docs/DEVELOPMENT.md](DEVELOPMENT.md) · [docs/CODEX-GUIDE.md](CODEX-GUIDE.md) · [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) · [docs/LOGGING.md](LOGGING.md) · [docs/RELEASE.md](RELEASE.md) · [docs/UPDATE-CENTER.md](UPDATE-CENTER.md) · [docs/PORTABLE-TRANSFER.md](PORTABLE-TRANSFER.md)

## 2. 风险与已知不稳定（跨批次，别再踩）

- **快照门禁依赖设备数据**：只在专用 AVD + 固定夹具上跑；改外壳几何/构成、重灌夹具、`pm clear`、装新构建、跑过造数据探针后**必须先重烤基线**（`--from <warm>.json --write-baseline`），否则下次全量必红。5554/5556 实例有验证数据，误跑必假红。23 屏走查装置修过「菜单页误点关闭」的潜伏 bug ⇒ **历史绿灯不完全可信**。
- **模拟器 force-stop/am kill 会丢最近的 WebView localStorage 写入**（261110 实测，控制变量已验证：自写任意新键同样丢，**不是产品代码问题**；LevelDB log 未落盘、优雅退出才提交）⇒ **验「默认空间 / 主题 / 侧栏宽度」这类本机偏好必须用 App 自己的退出路径**（首页连按两次返回退出再启动），别用 `am force-stop` 下结论。
- **验收状态**：「已合并 / 已双推 / 已发布」≠「用户逐条点收」。261102 十四批、261103 各批只有设备实测记录；设备绿灯只代表装置与计算值，不代表真实第三方环境（分享面板 / 文件选择器 / AI 外部服务 / S3 覆盖恢复）。
- **平板回退史**：十三批「expanded 改内核固定工具栏」已被十四批整体回退；残留旧路径（内核工具栏、`body.lake-tablet`、`__lakeSetTablet`、`nativeDeviceHint`）若被重新引入 = 第三套口径。
- **inkDoc v4（写 4、读 1|2|3|4）**：旧端读到 v4 会进只读保护 ⇒ 跨端混用必须在发布说明里写清（含「手机/平板需重装新包」）；改格式只能「新端写新版、旧端只读」并同步 [docs/INK-PAD.md](INK-PAD.md)。
- **依赖补丁 4 处**（univer ui / plait draw / xiangfa mindmap / lakex-drawnix）：升级后必须 grep 过滤句计数 = 0 且设备上出现「手形工具 — H」；**patch 打上但未命中不会报错**，必须逐条确认语义生效（登记见 AGENTS §2）。
- **设备装置不进 CI**（无 AVD/GPU）：`.github` 的 PR 门禁只覆盖 tsc/vitest/双 build/core/ui-metrics/bundle/arch；设备类验证必须人工跑。
- **并行会话共用工作树（261110 实测）**：同一 checkout 里可能有另一 DSH 会话在改别的功能（本轮 = AI 助手固定/复制）。提交前必须 `git status` 分辨；只 stage 本批文件；**共享基线文件**（如 `src/styles/cssLayers.test.ts`）被双方各改几行时，用 `git hash-object -w` + `git update-index --cacheinfo` 只提交本批版本，对方增量留在工作树；**绝不用 `git add -A`**。
- **门禁预算现状**：`check:bundle` 的 mobile-entry 在 HEAD 已超目标，脚本冻结的是「现状值」；不要把它当绿，也不要把冻结值当目标。
- **历史文档已删除**：261109 起一批研究/审计/回归/旧发布说明已删（git 可查）；旧文档/代码注释里的「HANDOFF §3#N / §4」是历史编号，**不对应本文**，待办只看 §3（本节不编号）。README / 其它文档中若仍有指向已删文档或旧编号的引用，以 git 与现存文档为准（本批不改其它文件）。
- **发布链路**：Gitee 单附件 100MB / 仓库 1GB 上限（mac/Windows 包只能走 GitHub）；GitHub 慢速上传需依赖 workflow 的 50 分钟步骤超时，不要缩短。

## 3. 待办（唯一待办清单）

> 规则：只有「真问题 / 不做有代价 / 收益大于复杂度」才进本节（AGENTS §3#17）；完成后**直接删行**，历史留 git。
> 本节**不再编号**：旧文档/注释里的「§3#N」是历史编号，不对应下面的条目。

**P0（不做就卡住主线）**

- **写作卡全屏后的设备门禁**：9 态里没有写作卡（不受影响），但 **23 屏走查需覆盖两条入口 + 键盘开合**；发版前补跑。
- **桌面 `check:stylesnap` 42 态**：本机无合成夹具缓存，已连续三批未跑（按钮梯队 / 空间改名 / 按钮第二批）。下次有夹具的机器全量跑并重烤；**重点看本批视觉 delta**（清单见 §0）；同时确认是否新增「日记空间」态。
- **移动端本批设备点收**：`bash scripts/android-build.sh --sync --install`（lake_mobile）后看：① 设置各子页按钮（`--outlined` 与旧 `--settings` 应 0 变化）；② AI 页操作键形状（自绘胶囊→L3 中性框）；③ 基座/ghost 字色略浅的屏；④ 日记「取消日记标记」/ 转文档文案；⑤ 9 态快照（DOM 未变，预期 0 diff）与 23 屏走查；⑥ 首屏懒 chunk 冒烟：开文档后粘贴、小记 composer、分享导入 MD/PDF、更新中心、图标/表情选择器；⑦ 冷启动首页（已验）与 9 态/23 屏。
- **手机快照盲区：`.mb-sheet` 打开态**：9 态无一态打开底部 Sheet ⇒ 新增 `home-filter-sheet` 态并重烤，顺带覆盖 CreateSheet。
- **每批收尾固定动作**：更新 §1 基线与门禁计数 + §3 + §0 批次抬头；提交后立刻回写。
- **下一版发布**（流程 `docs/RELEASE.md`）：发布说明写清 ① inkDoc v4 旧端只读/手机需重装；② 标签顺序仅设备本地；③ 标签删除=缺席两端都要升级；④ 发版前全量门禁矩阵（手机 9 + 平板 9 + 多维表 3 + 23 屏 + windowsweep + 桌面 42）。

**P1（该做但可排期）**

- **平板 9 态快照**：本轮只烤手机/多维表；平板需另起 `lake_tab` + 重烤，发版前补（写作卡全屏/图片缩略后平板可能漂）。
- **移动性能基线脚本冷启动采集**：CDP page target 竞态（页内标记注入失败）待修；修好后在 lake_gate 录一份基线并纳入本地门禁。
- **图片缩略第二步**：写作卡/内核内图片、标签详情预览仍原图（同法 `?w=1024`）。
- **日记「取消标记」残余验收**：跨端 wire 传播（一端取消 → 另一端知识库出现该本、日记空间消失）需**真机 + 配 S3** 验；取消是单向的（无回标入口，回标另立项）。
- **按钮第二批的用户点收**（清单见 §0）：尤其「删除图标常红」「选中标签项变淡」「AI 页操作键形状」是否接受。
- **小记快路径后续优化（非必须）**：请求已 13→11；重复点首次 `push-state` 约 1455ms（SQLite/原生桥多次调用，第二次 25ms）⇒ 若要再快，可把 baseline+单条行+标记合并成一次窄端口调用；**不要再省写后 pointer 读回**（「已同步」可信度）；要再省 ~5 次往返只能上条件写替代锁（协议级，另立项）。
- **发版前补一次快捷 capture 冷启动真机**（本次只测热启动；同一代码路径，请求数相同）。
- **便携包真实 3GB 数据验证**；**更新中心设备验收**（Android 下载→校验→系统安装器）；**桌面 3 项实机复核 + 平板复验**；261104 三项裁决残余验证；小记→文档标签携带待定；导入/导出/键盘真机冒烟债；依赖补丁 4 处升级复核。
- **死 CSS 审计复核（261111）**：桌面候选 `.diary-split-handle` 是 `SplitPane` 的 `${className}-handle` 动态拼接、移动端 `.lv1–3` 是大纲层级动态类 ⇒ **均为假阳性，不删**；`docs/audit-261027/` 4 份**保留**（`TROUBLESHOOTING` / `SYNC-PROTOCOL` / 源码注释仍引用，删了会断出处）。旧「资料库」注释残留：`shell.css` / `app/base.css` 待并行会话收尾后统一，`kit.css` 1 处因该文件在别人写作用域暂不动。
- **首篇编辑器 fallback 的最终解法（需用户裁决）**：① 拆内核 chunk（大改，需 RFC）；② 改「启动自动打开文档」语义（恢复标签为空时不自动开 / 先画列表再开）。当前预热只覆盖「用户中途点文档」，自动开首篇仍会看到 200–300ms fallback。
- **编辑器同构骨架 fallback（可选，观感最好）**：替换「正在加载编辑器…」文字为轻骨架；需新增 editor CSS + `cssLayers` 基线，等并行会话释放后做。

**P2（体验缺口 / 长期）**

- 大库与**真实 Android 物理机验收从未做过**；墓碑 payload 老化；移动云清理无 UI 入口、目录恢复后 `deleted_notes` 残留；缺正文/缺小记三条恢复路径只有单测 mock。
- 移动端文本格式未接入口（unlink / replace / style→code·quote / 表格块级命令族）；顶栏 44→52 需另开需求；平板「点空白落光标」待用户裁决。
- **脚本/源码注释里的旧 `§7.x` 引用**（`§7.25/27/28/30/31`，与 AGENTS 现编号 21–24 不符；历史遗留）⇒ 下次碰时统一，不单独开批。
- **移动端首轮元数据再发布**：初始发布后第一轮整轮同步会因既有 tag 版本元数据做一次「只含元数据」的再发布（gen+1、正文对象不涨）；与快路径无关，可单独立项评估是否省掉。

**已闭合，别重复**

- 移动/桌面空间命名 → 已定稿两端「知识库」（261110）。
- 桌面按钮原语梯队 + 第二批（app 级 39 个）→ 已迁移；移动 `mb-btn` 同模型已独立实现（261110）。
- 日记 v1 残余四条（过滤测试 / 标签不聚合 / 取消标记 / 移动告警）→ 已收口（261110）。
- AGENTS 超预算 → 已精简到 46,610B（261110）。
- 移动端首屏瘦身 → entry-js 59.7KB / preload 6 / 首屏 347.9KB（261110，预算已收紧）。
- 移动端两条创建入口的「保存并同步」= 同一单条快路径，已真机真 S3 实测（261110）。
- 小记写作卡卡顿（长按创建 / 键盘开合）→ 全屏 + 长任务 775→72ms（261111）。
- 桌面编辑器 fallback 骨架 / capture 首帧预取 / 列表图片缩略 / 手机 9 态+多维表 3 态重烤+23 屏（261111）。
- 桌面冷启动预热三条触发已上（261111）；首篇 fallback 是内核 chunk 地板，未消除（解法见 §3）。
- 单条小记推送请求数 13→11（独立管线，261111）。
- 二轮/实机修复批「未跑 6 态」、胶囊固定底部 / 平移画布开关、P9–P12 候选、平板内核工具栏两条例外 → 均已闭合/撤回。
