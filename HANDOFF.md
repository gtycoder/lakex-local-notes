# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接（261009 → 261008）

> 写给完全没有上下文的新会话。接手顺序 **README → HANDOFF → AGENTS**。**本节只保留最新 1–2 批（261010 / 261009）**；更早的 dated handoff 已删除，只在 git 历史可查（`git log -p --follow HANDOFF.md`）。文中提到的「专项文档」= 已删除的 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`。**真正的待办看 §3，长期坑看 §4，移动端看 §8。**
>
> **下一会话焦点（261010 收尾 → 下一会话，用户定）**：① **页面详细测试 + 优化细节**（逐页走查、查漏补缺）；② 若继续表格，取 `docs/USHEET-UPGRADE.md` §7 的中期项（条件格式 / 数据验证 / 公式库完整版）单独立项。表格性能（含 5000 行档）已收口，**别再优化包装层**（实测见下面 261010 节）。
> **已定不再讨论**：「开始」工具收窄后**隐藏旧工具就是为了让折叠的出来**（用户 261010 定：不给白名单、保持现状）；canonical 快照挪空闲时段暂不做；移动端/桌面抽公共 runtime、单实例多 workbook 共享不做；公式栏收起方案仅存档；MiSans 桌面字体（暂缓）；**Android 端"先保证能用"**。**唯一已知遗留** = 多标签切换时内核工具条 1~4 帧绘制空帧，见 §3#9（诊断与可行方向已写全，别重复试提层类改动）。

### 261009 B1 · 桌面逐页走查（页面详细测试）+ 3 条修复 + 走查装置入库

- **范围**：用户定的焦点①。隔离夹具（`make-fixture`，**不碰真实数据**）+ 新装置 `scripts/css-audit/walkthrough.mjs`，
  跑 **5 轮 × 19 屏 = 95 个屏态**（浅/深/暖 × 1315、浅/深 × 1000），每屏「截图 + 五类实测探针」（越界/截断/对比度/焦点环/整页横向溢出）。
- **修掉 3 条**（都实测复现、都改在单一来源、都留截图）：
  1. **树行焦点环是浏览器默认环**：树行是 `div[tabindex="0"]`，不落在 tokens.css 的焦点规范里 ⇒ 键盘聚焦时画的是 `outline: auto`（颜色随系统高亮色，实测 `rgb(153,200,255)/1px/auto`）→ 就地补令牌环 + 负 offset（`styles/app/shell.css`）。修复后 `2px solid`、颜色取当前主题 `--lake-accent`。
  2. **窄窗（1000px）小记写作区动作行把标签折进按钮里**：分栏是 `minmax(290px, 36%)` ⇒ 写作卡只有 ~346px，而四件套（小记一下/取消/⌘Enter 提示/可拖入提示）≈340px + 默认 `nowrap` ⇒ 标签在按钮内部折两行、第二行被行盒裁掉（实测按钮 70×40、行高 28）→ 动作行改「**整组不收缩 + 放不下就换行**」（`styles/app/quick-notes.css`）。1000px 下按钮回 70×28、行高 51、无裁剪；**1315px 截图逐字节相同**（零回归）。
  3. **「关于 → 运行时」文案写死 Electron 43**（实装 44.3.0）→ 去掉写死版本（"实际版本见下表"），避免与下表重复且必然过期。
- **探针结论（95 屏态）**：对比度告警 **0** · 整页横向溢出 **0** · UA 默认焦点环 **0** · 无错误屏。
- **候选（未修，理由已记）**：① `.sidebar.sidebar-docked` 的 `height:100%` 取的是**网格容器**高度而它在第 2 行 ⇒ 侧栏与其分隔条比可用高度**高 38px**（实测 820 视口下 bottom=858）。当前**无可见症状**（背景/命中带都被窗口裁掉，侧栏内也无底部锚定内容）⇒ 按 AGENTS §3#17 不动，记入 §3；② 富文本里插普通 2×2 表格时 `table.ne-table`(750) 宽于 `.ne-table-hole`(654) ⇒ 出现横向滚动条（夹具表格无固定宽度）；需一条**真实文档**数据才能定性；③ 画板画布内自带主题下拉（Drawnix 厂商 UI，与 App 主题控件并存）⇒ 观察项。
- **补屏（B1 收尾）**：走查脚本补到 **22 屏**（新增 **文档属性 / 历史版本 / 分屏**）+ 屏幕过滤参数（`walkthrough.mjs <theme> <width> <屏名逗号列表>`）。再跑 **light-1315 与 dark-760 各 22 屏**：三张新屏几何与层级都正确（分屏两栏 + 合并标签、属性对话框、历史快照面板），无新增缺陷。
  - 两条**装置备注**：① 分屏菜单项类是 `.tab-switcher-select`（`Menu` 的 `surfaceClassName="tab-switcher-menu"`，不是 `[role=menuitem]`，已写进脚本）；② 760 档下「属性 / 历史版本」取不到——窄窗是抽屉形态、右键菜单不在同一可见层 ⇒ 这两屏以 1315 档覆盖为准。
- 门禁：tsc ✓ · vitest **214 文件 / 1724 用例** ✓ · ui-metrics ✓ · cssLayers（两处基线按新声明上调并写明理由）✓ · `git diff --check` ✓。

### 261009 追加 · 表格内核 floating 层收口（黄叹号不再逃出标签宿主；@univerjs/ui 补丁 + 两道护栏）

- **用户报**：表格里那个**黄叹号**层级最高、切到别的文档也盖不住。
- **定位（只读取证，链已完整）**：它是内核 **CellAlert**（`@univerjs/sheets-ui` 的 `ForceStringAlertRenderController`：单选「文本格式的数字」单元格时弹的警告，菜单项「转换为数字」——截图里的 600010 列正是这种单元格；`sheets-numfmt-ui` / `sheets-formula-ui` 另有两个同类，都走这一个浮层）。承载它的 floating 层（`CanvasPopup`）被内核**无条件 portal 到 `document.body`**（`@univerjs/ui` 的 `DesktopWorkbenchContent` / `MobileWorkbench`，读的是新建 div + `document.body.appendChild`）⇒ **它不在标签宿主里**：`styles/app/tabs.css` keep-alive 的 `opacity/visibility` 隐藏（刻意保留布局尺寸）对它无效；内核自己"看不见就隐藏"的判据读**画布 rect**（`visibility:hidden` 的元素 rect 仍有效）⇒ 它认为还在屏幕上。只有它长期可见，是因为 CellAlert **随选区常驻**（下拉/日期/颜色都是瞬态）。
- **修法（用户 261009 选 A）**：`patches/@univerjs+ui+1.0.3.patch`（**唯一** Univer 补丁；两处 workbench 各 2 行）——floating 容器改挂实例自己的 `mountContainer`（`#univer-sheet-<noteId>`）+ 打 `data-lake-univer-floating` 标记（探针定位用）+ 卸载改 `portalContainer.remove()`（不再假定父节点是 body）。只改挂载点、不改内核逻辑 ⇒ 一次修掉**整类**浮层逃逸（CellAlert / 下拉 / 日期 / 颜色 / 选区），功能一个不丢。
- **护栏**：`usheetKernelContract.ts` 的 `UNIVER_PATCH_HOOKS`（触点 + 为什么 + 失效表现）；`univerContract.test.ts` **护栏③**（补丁文件在仓库里；实装产物里**必须没有** `document.body.appendChild(portalContainer)`、必须有挂载/remove/标记）；`usheet-kernel-probes.mjs` **+2 条**（容器在宿主内；切走后不可见）。升级处置与 **patch-package「本机安装失败不以非零码退出」的陷阱**写进 `docs/USHEET-UPGRADE.md` §4.7，`AGENTS.md` §2 加了一句（原文明写"不要给 Univer 打 patch"，已改成"仅此一处例外"）。
- **验证**：补丁对**上游原始 1.0.3** 可重放（`npm pack` + `patch --dry-run` + 真应用，结果与仓库内文件逐字节一致）；产物核对（`dist/assets/UniverSheetEditor-*.js` 内是 `setAttribute('data-lake-univer-floating'); s.appendChild(O)`，旧写法 0 处）；隔离实例探针 **退出码 0**（8/11 通过，3 项为既有"合成输入无 OS 焦点"提示；补丁两条全过：`{inHost:true,inUniverRoot:true,atBody:false}` / `{hostActive:null,visibility:"hidden"}`）。首轮那条 `工作表「＋」` 失败是**合成点击偶发**（复跑 PASS，且该路径与补丁无关）。
- 门禁：tsc ✓ · vitest **214 文件 / 1724 用例**（+2）✓ · ui-metrics ✓ · check:core 75-0 ✓ · 双端构建 ✓ · bundle 预算 ✓ · `git diff --check` ✓。
- **同批顺带（设置页文案，用户 261009 追加）**：`启用云同步` 行新增**隐私数据提示**（可见、琥珀色）——徽标「隐私数据 · 云端不加密」+ 说明「开启后笔记正文与附件会上传到你的 S3（按原样存储、不做加密）；请先确认该桶为私有、未开放公开读，且凭据只有你持有」。**用户追加口径（261009）**：**固定展示** —— 不开条件渲染，云同步关着、"还没测试连接通过"时也照常显示（"云端不加密"必须在开启前一直在眼前），也**不做**需要悬停才出现的隐藏提示。
  实现**零新增 CSS**：`settingsPrimitives` 的 `Switch` 加可选 `note`（渲染进既有 `.config-note`）+ 徽标复用 `.ln-tag--pending`（`--lake-status-pending` 琥珀）——两条都是既有单一来源；文案收在 `core/cloudState.ts` 的 `CLOUD_PRIVACY_NOTICE`（桌面/移动**共用一份**，照 `cloudStateHint` 先例）；`settingsSearch` 的 `sync-enabled` 关键词补「隐私 / 隐私数据 / 加密 / 不加密 / 私有」（搜得到）。
  **实机确认**：桌面（隔离实例 + CDP，把开关关掉 ⇒ 描述切到"先在上方…测试连接"变体）**提示仍在**；移动端（模拟器 + `emu-cdp`，同步设置页）徽标同样 `rgb(143,95,14)` / 软底 `rgb(247,240,226)`，380px 宽下 4 行显示正常；`npm run check:mobilesnap` **6 态 0 差异**（该子页不在基线态里）。
- **未做 / 注意**：① **dev 实例（vite dev server）仍跑预打包的旧依赖** —— `node_modules/.vite/deps/facade-*.js` 里还是 `document.body.appendChild(portalContainer)`，要看效果需重启 vite（必要时 `--force`）；本轮**没动**用户正在看的 9222 实例。② 本批是**代码改动，未提交**，等用户验收。③ 移动端真机未跑（补丁同时覆盖 `MobileWorkbench`，移动端产物已重建）。

### 261010 · 表格（usheet）性能 + 粘贴落点 + 右键插图 + 默认尺寸 + 内核契约与升级规范（已交付）

- **性能（实测：隔离 userData + 真实 Electron + CDP，dev/scheme 双模式）**
  · 切标签空窗 0.69s（scheme）/1.83s（dev）→ **0.01s**：UniverSheetEditor 隐藏**不再销毁实例**（keep-alive），只在卸载（关标签 / 换文档）时 dispose；隐藏态无空转（3s 内 rAF 0 次），每实例净增 6–15MB，总量受 maxOpenTabs（默认 8）约束。
  · dev 首次打开 3.68s → **0.18s**：MultiTabEditor **仅 dev** 空闲预取表格分包（打包侧保持真懒加载）。
  · 大表格（打包构建，点击→画面）：1 万格 92ms / 5 万格 126–148ms / 10 万格 240–485ms / 40 万格 340–1712ms（**方差大**，同一夹具复测到过 340 与 1712）；我们自己的 JSON 往返只占 ~30ms@2.2MB ⇒ 瓶颈在内核渲染，不在包装层。编辑落盘主线程长任务 75ms@10 万格 / 221ms@40 万格。**结论：5000 行这一档没问题，不必再优化我们的包装层。**
- **粘贴图片落点**：单图 + 有活动单元格 ⇒ **单元格图片**（先上传成资产再插，从源头不产生 blob）；无选区 / 一次多图 ⇒ 放行内核默认（浮动图，**不静默丢图**）；只读封死；上传失败退回内联 data URL。为什么只能在 DOM 层（window 捕获）拦：见 docs/LAKEX-CONTRACT.md §5.25。
- **单元格右键「插入」子菜单**新增「插入单元格图片」（facade createMenu({ action: 命令 id }).appendTo([...])，**复用**已有命令；路径逐段单个 key）。
- **默认尺寸 = 50 行 × 16 列**（用户 261010）：新建表格文档（core/usheetDoc.ts 的 USHEET_DEFAULT_ROWS/COLUMNS，单一来源）与工作表标签「＋」（preset 的 footer.addSheetButtonConfig）两处同一口径；移动端 viewer 共用同一份 footer 配置。
- **底部计算条 36px → 30px**；文档状态栏改为**实测变量**跟随（--usheet-status-bottom，与多维表 --lake-bitable-status-bottom 同姿势），保持其上沿 4px 缝。内核把该高度写成**行内样式** ⇒ 这一条覆盖是全仓新增 !important 的唯一理由（理由写在规则处）。
- **架构/升级收口**：内核触点集中 src/features/usheet/usheetKernelContract.ts；静态护栏 univerContract.test.ts（版本一致性 + 触点符号存在性）；运行时探针 scripts/usheet-kernel-probes.mjs（升级后一条命令）；规范与路线 docs/USHEET-UPGRADE.md；@univerjs/* 全部**精确锁 1.0.3**（不许 caret/tilde 区间，避免两份 core 让 DI 静默失效）。
- **用户已定「不做」（别再提）**：① 「开始」工具收窄里**隐藏旧工具就是为了让折叠的出来** ⇒ 不给白名单、不改现状；② canonical 快照挪到空闲时段（只对大表有意义）暂不做；③ 移动端/桌面抽公共 runtime、单实例多 workbook 共享不做（理由见 docs/USHEET-UPGRADE.md §7）。
- 门禁：tsc ✓ · vitest **214 文件 / 1722 用例** ✓ · ui-metrics ✓ · check:core 75-0 ✓ · 双端构建 ✓ · bundle 预算 ✓ · git diff --check ✓ · 探针 **7 致命项全过**（2 项提示为「合成输入无 OS 焦点」偶发，不影响退出码）。

### 261009 收尾 · 移动端表格切换 + 三处移动端修复 + 跨端污染清理 + 手机口径适配（已合并并推送 master）

- **移动端表格组件切换（kind=usheet 只读查看器）**：新增 `src/mobile/usheet/MobileUsheetViewer.tsx` —— 与桌面**同一套 Univer 内核**；只读（`setEditable(false)`）、**不挂工具条/公式栏**、**不保存不写库**；首次可见才挂载；资源走本机 AssetServer canonical URL + token；**懒加载不进首屏**（入口 chunk 对 6.6MB 的 Univer 运行时零静态引用，由 `mobileLazyChunks.test.ts` 卡住）；接进 `NotebookWorkspace` 的 kind 分派（原为"暂不支持"占位）。
- **模拟器实测（Capacitor WebView；AVD `lake_mobile` Pixel6/API36）**：网格正常渲染；`[data-u-comp=ribbon-toolbar|headerbar|formula-bar]` 计数 **0**（只读）；**在格子上输入不落库**（回读 DB 正文未变）；heap ≈ 58MB；无崩溃。
- **三处移动端真问题（用户现场反馈，均已修）**：
  ① **层序被内核打穿**：Univer 给 canvas 写了 inline `z-index:8`，而移动端底栏 `z-index:3`、侧滑抽屉 `z-index:7` ⇒ 画布盖住二者（实测底栏按钮 `elementFromPoint` 全命中 CANVAS）→ 给 `.mobile-usheet` 建层叠上下文（`position:relative; z-index:0; isolation:isolate`）。
  ② **只读仍拉起输入法**：Univer 内部 `div[contenteditable]`（`#__editor___INTERNAL_EDITOR__DOCS_NORMAL`）自己抢焦点（实测 `mInputShown=true`）→ 只读查看器加**焦点闸门**（容器内 `[contenteditable]` 一律 blur）。
  ③ **跨端污染**：移动端借桌面 `components/NoteInfoDialog` → `HistorySnapshotPreview` → 懒加载**桌面** `UniverSheetEditor`/`BitableEditor`/`BoardEditor` ⇒ 桌面编辑器被打进移动端包、且移动端打开表格历史快照会挂**桌面**编辑器 → 新增 `src/mobile/ui/NoteInfoSheet.tsx`（移动端自有「文档属性」抽屉）替代；桌面 `NoteInfoDialog` 未动；`HistorySnapshotPreview` 另加移动端提示护栏（纵深防御）；护栏见 `mobileLazyChunks.test.ts`。
- **移动端「文档属性」按手机口径重排**：内容自带左右 16px 内边距（`.mobile-sheet-body` 本身是 0 内距）、信息**一行一项**（标签左/值右）、章节 1px 分隔线、空态紧凑左对齐（原误用为"整屏空"设计的 `.mobile-sheet-empty`）。实机几何：sheet 412×553、`.minfo` padding-left 16px、行宽 380。
- **移动端残留审计（专项，全清）**：源码 / kind 取值 / CSS / `doc_kind` schema / Android 原生层 / 产物 / 快照脚本 —— 无 `fortune`/`luckysheet`/`MobileSheetViewer`/`.mst-*`/旧 `sheet` kind；重建后 `dist-mobile` 里的**桌面编辑器 chunk 与桌面专属标识全部消失**（只剩 `MobileUsheetViewer`）。
- **未覆盖（后续/真机验收补）**：触摸滚动与双指缩放、软键盘弹出后的布局、移动端表格里的图片加载、真机；另有**首帧短暂空白**（画完即正常，未量化绘制耗时）。
- 门禁：tsc 0 · ui-metrics ✓ · vitest **210 文件 / 1703 用例** · check:core 75-0 · 双端构建 ✓ · `git diff --check` ✓。

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
7b. **B1 走查留下的两条低优先候选（261009，均已实测、当前无可见症状）**：① **侧栏比可用高度高 38px** —— `.sidebar.sidebar-docked` 的 `height:100%` 取的是**网格容器**高度，而侧栏在第 2 行（顶栏之下）⇒ 实测 820 视口下侧栏/分隔条 bottom=858。因为没有底部锚定内容、背景与命中带都被窗口裁掉，**当前不可见**；真要清掉就改成由网格行决定高度（`align-self: stretch` 已在），属壳层几何改动，需前后截图对拍。② **文档内普通 2×2 表格会出现横向滚动条**（`table.ne-table` 750 > `.ne-table-hole` 654；夹具表格无固定宽度）—— 需要一条真实文档复现后再定性。
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
  - **现状（261009 核对）**：移动端 `src/mobile/bridge.ts` 用一条 `KeyedAsyncQueue`（key 固定 `main`）把**整轮同步（含全部网络往返）**与本地写**完全互斥**——同一条队列上还有 saveNote / 小记保存 / 建·改·移·删笔记本 / 回收站·恢复·彻底删除 / 历史 / 资源清理 / GC。⇒ 同步期间这些操作都排队等整轮结束。桌面**没有**这个问题：维护锁只包「整轮同步 / 数据库备份 / 定期 GC 对账」三件事，本地保存走另一条 IPC 路径。
  - **为什么思源没有（用户 261009 提问，已调研 `siyuan-master`）**：① **文件是真相、DB 只是索引**——保存 = 写 `.sy` 文件，索引入队（`kernel/sql/queue.go` 的 `IndexNodeQueue`）后由后台任务（`kernel/task/queue.go` 的 `DatabaseIndexCommit`）攒批提交，队列还落盘可恢复（`Utils/queue/index.queue`）⇒ **保存根本不等数据库**；② **同步是文件/快照级的**（`dejavu` 仓库），流程里是 `FlushTxQueue()` **排空**本地写队列拿一致视图，**不是持有**它，`syncLock` 只防并发同步不挡用户写 ⇒ 网络等待不冻结本地写；③ **桌面与安卓共用同一个 Go 内核**（安卓端 APK 里跑编译出的内核 HTTP 服务，`KernelService.java` 保活，WebView 只是壳）⇒ 一套并发模型两端通用。
  - **我们的差异（结论）**：仿的是思源的**前端壳 + 数据逻辑**（本地优先 / S3 镜像 / 墓碑 / 回收站 / 快照 / 清单差集），但**没有也无法**复制"单一内核服务两端"的运行形态——移动端是 Capacitor + 原生 SQLite + 共享纯决策函数（两套持久化模型，见 AGENTS §3#17），**并发边界得自己补**：桌面补过了，移动端漏了 F16。**不是路线错，是这两套模型的一处已知欠账。**
  - **可借鉴（不推翻架构）**：排空而不持有（= F16 解法）· 保存与派生数据（搜索索引）解耦 · 队列可恢复（只借思路，别为对齐而做）。
  - **判定口径（先量后做）**：真机测「同步进行中保存一次文档要等多久」的 P50/P95（含首次全量与增量、弱网）；P95 仅数百毫秒 ⇒ 记「不做」；上千毫秒或存在分钟级窗口 ⇒ 立项，方案限定「网络阶段不占主队列 + DB 片段内短锁」+ 跨端对拍。
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

17. **表格（usheet / Univer）的取舍与已定「不做」（261010，别再提）**：① **「开始」工具收窄**——隐藏旧工具（字体/粘贴/百分比/货币/快捷键面板）**就是为了让原先挤在「更多」里的工具自动补位出来**，宽度变短不是目标 ⇒ **不给白名单**；② **canonical 快照挪到空闲时段**——只对大表有意义（40 万格约 130ms），50×16 规模无感，暂不做；③ **移动端与桌面抽公共 runtime**——差异是实质性的（只读闸门 / 焦点 / 资源 URL 带 token / 无工具条），抽出来只会变参数化分支；④ **单实例多 workbook 共享**——先保证不串台；⑤ 依赖侧冗余清理、运行时正文兼容层——不做（AGENTS §3#18 / §3#7）。升级内核依赖一律走 **docs/USHEET-UPGRADE.md**（静态护栏 `univerContract.test.ts` + 运行时探针 `scripts/usheet-kernel-probes.mjs`），**不要 npm update**。

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
- **表格（usheet / Univer）**：`USHEET-UPGRADE.md`（内核触点清单 + 依赖升级 playbook + 路线图；配套 `src/features/usheet/usheetKernelContract.ts` · `univerContract.test.ts` · `scripts/usheet-kernel-probes.mjs`）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md`（当前唯一移动端架构规格；旧 `ANDROID-TECH-SCHEME`/`ASSET-URL-MOBILE-PLAN` 已删）。
- **UI/工程规范**：`scripts/css-audit/README.md`（样式层）· `PANEL-CONTRACT.md`（面板几何/层序契约）· `UI-PRIMITIVES-PHASE1-260926.md`（浮层原语）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端速查（完整端）

> **261009 B2（进行中）** 移动端逐页走查装置：scripts/css-audit/mobile-walkthrough.mjs（配合 drive.mjs 9335）。
> 覆盖：首页（知识库 / 小记 / 书架）、笔记本工作区、各文档（doc / usheet / bitable / board）、设置抽屉九页；每屏「截图 + 探针」
> （越界 / 截断 / 对比度 / 小点击目标 / 整页横向溢出）。
> **⚠️ 关键工具坑（261009 实测）**：**Android WebView 的 CDP Page.captureScreenshot 抓不到 GPU canvas 层** ——
> usheet 网格在页面截图里整片空白，但同屏画布 toDataURL() 有完整内容、设备级 adb screencap 也完全正常
> ⇒ **移动端截图一律用设备级 screencap**（脚本里已改）。别据 CDP 截图报「表格空白」这种假缺陷（本轮差点误报，A/B 撤掉表格补丁后同样空白才定位到是截图问题）。
> 已知观察（未改）：首页顶部 .mobile-htab 命中区 36×25 / 52×25（父容器 .mobile-home-tabs 仅 25 高），低于 48dp 建议；
> 抽屉态下「侧栏右键菜单（属性 / 历史版本）」不在同一可见层 ⇒ 移动端这两个入口需换驱动方式（本轮未完成）。
> **已修（261009 B2）**：小记写作卡的两字按钮（取消 / 保存）标签折成两行、按钮被撑到 62px 高（实测 57×62）——
> `.mobile-qn-btn` 加 `white-space: nowrap`（mobile.css），修复后 58×38 / 75×37；`check:mobilesnap` 6 态 0 差异。
> **已定位并修复（261009 B2 第二轮）**：小记编辑器在**冷启动后作为第一个内核消费者**时渲染成「大图标 + 原生 `<input type=file>`（Choose File / No file chosen）」——
> 根因＝**内核样式表缺席**：桌面由 `styles/index.css` 的 `@import "@dlient/lakex-doc-react/style.css"` 全局引入，移动端入口没引、此前只有 `mobile/editor/DocumentEditor.tsx` 引；
> 于是"先开文档"时正常（CSS 已随文档编辑器模块加载）、"先开小记"时内核图标按原生尺寸铺满。因果实测：坏态 `ne-icon` 规则 **0** 条 + 7 个 >60px 的 `ne-icon-symbol`；开过一次文档后 **76** 条、图标不再超大。
> 修法：在**移动端**写作卡模块 `mobile/home/QuickNoteComposer.tsx` 引同一份 `@dlient/lakex-doc-react/style.css`（引在移动端模块而不是共享的 `QuickNoteEditor`：后者会把 CSS 也打进桌面入口，实测 app-css 1.79MB → 3.07MB、超 2MB 预算）。
> 验证：重装后冷启动 → 小记 → 新建小记（首个内核消费者）`ne-icon` 规则 76 条、大图标 0、截图渲染正确；桌面 app-css 回到 1,791,242（预算 exit 0）。
> **装置备注**：force-stop 后 WebView socket 会变，冷启动脚本要先 `emu-cdp.sh` 轮询重连再 `drive.mjs`（本轮已按此跑通）。
> **261009 B2 收尾（覆盖面 + 结论）**：本轮覆盖 = 首页（知识库 / 书架 / 小记）、笔记本工作区（文档树抽屉）、
> doc×2 / 多维表×2 / 表格 / **画板**、文档属性抽屉、历史版本、大纲抽屉、小记编辑器、设置九页、资源管理。
> **画板**是模拟器上原先缺的数据，按本节上面的种子法补了一篇 `移动画板`（`notes.doc_kind='board'` + `emptyBoardBody()` 那份 JSON，
> id=`mobile-board-1`）——移动端 `MobileBoardViewer` 挂载正常（canvas 412×842、空板、底栏「大纲」如预期 disabled）。
> 每屏探针（越界 / 截断 / 对比度 / 小点击目标 / 整页横向溢出）全绿；`check:mobilesnap` **6 态 0 差异**。
> **未覆盖 / 边界（有理由，不是漏）**：① **缩略图** —— 模拟器上没有带图的小记或图片字段数据，且 png/jpg/jpeg 的边界已在本节记录；
> 要看图得先造带图数据（下轮或真机）。② **大纲左滑手势**的运行期驱动没做：门控逻辑（`swipeTargetSide` + `canOpen`）
> 已有单测 `src/mobile/gestureCore.test.ts` 明确断言「表格/多维表/画板没有大纲 ⇒ 左滑作废」；本轮在设备上又量到**同一个 `outlineAvailable` 判据的两侧**：文档（无标题文档）底栏「大纲」`disabled=false`、画板与表格 `disabled=true`。运行期用 CDP touch 驱动左滑没做成——壳是 keep-alive（隐藏视图元素仍在 DOM、rect 为 0），我的导航在"从文档回首页"这一步反复选到不可见元素；由于门控已有单测 + 状态侧实测，判定为**价值重叠、不再投入**（真要驱动得先给 walkthrough 的 goHome 加命中测试版可见性判据，那是装置改进、不是产品验证）。
> ③ 真机项（图片 / 附件、键盘安全区、同步后图片加载）仍待真机，与本节「当前剩余验收」合并。

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
