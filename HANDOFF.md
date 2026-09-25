# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。开工先读三份：本文件 → `AGENTS.md`（长期红线/机制/坑，每次自动加载）→ 相关 `docs/`。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接 · 260926 续 · UI 原语收敛（Phase 0 / 0.5 / 1a–1f + 深色/内核主题专项）· **已合 master 并推送**

> 写给完全没有上下文的新会话。用户口径：当前 UI"零碎问题本质是弹窗不统一、结构混乱"；本批把 **浮层/按钮/开关** 三个角色收敛成**单一原语**，并把"手抄选择器清单"换成"单一 base + 唯一性门禁"。设计稿与可交互预览：`docs/UI-PRIMITIVES-PHASE1-260926.md` + `docs/preview/ui-primitives-260926.html`。

### 一、已完成（按提交，均已合 master；本批共 20 个提交，tip `b68cf8b`）
- **Phase 0**（`f15687a`）：修四处缺失样式——`.confirm-dialog`/`.emoji-picker` 接入统一表面、`config-block__actions` 布局（JSX 用 11 处但全仓无定义）、`.b3-switch::after` 补回被删源漏掉的滑块基线。CDP 实测四项。
- **过期 b3 注释清理**（`15f587b`）：`src/b3/**` 已整体删除，清掉 6 个文件的现值语气残留 + `AGENTS §3 #14`。
- **设计稿 + 预览**（`440fdac`/`471b599`/`2c3e949`/`927b240`）
- **浅色 accent 对齐设计规格**（`f977a05`，Q10）：`themes/light.css` accent 家族 `#3d7eff→#5b6f96`（ink `#3a4a68`、tint `#eceff5`、text `#3a4a68`，hover/press 派生）；**dark 保持紫、warm 保持橙**（CDP 确认未变）。
- **深色表面统一**（本提交）：dark `--lake-bg-panel` `#25262b` → **`#1e1f22`（== canvas）**。根因：light/warm 里 `panel == canvas == #fff`，dark 却 `panel(#25262b) ≠ canvas(#1e1f22)` ⇒ 顶栏/面包屑/原生大纲/正文出现"四种黑"的明显色阶。CDP 实测修复后侧栏/面包屑/编辑器/原生大纲**均为 `rgb(30,31,34)`**，仅顶栏 `window #1a1b1e`（与浅色"外壳略深于内容"同构）。`--lake-bg-block` 未动。
- **内核主题变量集中映射（专项，本提交）**：新增**未分层**的 `src/styles/kernel-theme.css`，把内核 schema 的 53 个 `--lakex-editor-*` 映射到 `--lake-*` 令牌。**关键**：内核的 schema `<style>` 是未分层的，`未分层 > 任何 @layer` ⇒ 写在 `@layer` 里的变量桥**永远压不过**它（这就是深色大纲/工具条/下拉/图标反复出问题的同一根因）。必须放未分层 + `[data-theme=...]` 高特异性。分三段：① dark+warm 共用（表面/边框/文字/主色/色板）② **仅 dark** 语义黑白反相 ③ **仅 light** 把内核的绿主题色/亮蓝链接换成本项目规格 accent。feature.css 里原先零散的变量桥与消费属性覆盖（大纲底色/工具条文字/下拉值/图标 color）**已删除**，集中表成为唯一来源。CDP 实测三主题均正确（light 主色 `#5b6f96`、dark 反相 `#a8a9ad`、warm 保持 `#000`）。
- **Phase 0.5 深色修复**（`238051c`）：根因=内核把浅色 schema 的 `--lakex-editor-*` 作为**未分层 `<style>`** 注入（`.lakex-default-theme{--lakex-editor-background-primary:#fff}`），未分层 > 任何 `@layer` ⇒ 变量桥失效。修法=feature 层直接覆盖消费属性（`.ne-icon` 修正原误写 `.ne-icon-symbol`、工具条文字、`.ne-toc-sidebar/.ne-viewer-toc-sidebar` 底色）。CDP 实测 dark 大纲 `rgb(37,38,43)`、图标 `fill rgb(168,169,173)`。
- **Phase 1a**（`3d0023e`）：`src/components/ui/Overlay.tsx` 原语（Overlay + Dialog/Menu/Popover；portal/层序/外点/Esc/焦点圈闭/滚动锁）；overlay 层序令牌 `--lake-z-overlay-menu/scrim/dialog/lightbox = 600/700/710/720`；修 B1（`.modal-backdrop` z 30→令牌，原先遮罩盖不住外壳）；`.ln-dialog` 布局+表面合并到 `overlay.css` 单一来源；`.ln-menu/.ln-popover` 表面统一。试点：ConfirmDelete。
- **Phase 1b**（`7649b4e`）：对话框迁移 5 个（NoteInfo / AssetRename / Search / Trash / History）；原语加 `surfaceClassName/scrimClassName/surfaceRef`（支持顶对齐命令面板、可拖拽浮窗）。
- **Phase 1c**（`87a4788`）：菜单迁移（CardContextMenu ×2、Sidebar 新建+右键、MultiTabEditor 标签切换+右键、BitableEditor 行右键、DesktopOverlays 顶栏 ×2）；菜单层序统一到 `--lake-z-overlay-menu`。
- **Phase 1d**（`be45029`）：emoji 选择器 + 多维表两个气泡；原语加 `ignoreOutside`。
- **Phase 1e**（`b0a9b67`）：设置开关 `b3-switch(input)` → `ln-switch(button+role=switch+knob)`；`onChange` API 由 ChangeEvent 改为 `(checked:boolean)`，6 调用点同步。
- **Phase 1f**（`src/styles/uiPrimitives.test.ts`，本提交）：三条门禁——① `createPortal` 只允许 Overlay 原语 + 显式白名单；② `.ln-dialog/.ln-menu/.ln-popover` 只在 `overlay.css` 定义；③ overlay 层序令牌唯一、递增、都高于 topbar。

### 二、门禁（全绿）
`tsc` 0 · `vitest` **1289 passed / 16 skipped** · 桌面 + 移动 `vite build` OK · `ui-metrics`（`var(--b3-*)` 0 / 颜色字面量 0 / `!important` 9 / 未定义令牌 0）· `cssLayers` 2/2 · `check-core-boundaries` 0 违规 · `git diff --check` clean。

### 三、有意保留 / 未做（都写明了理由，别再当漏项）
- **ImageLightbox / AttachmentPreview**：全屏媒体预览（自带背景点击关闭 + `position:fixed` 铺满），迁到居中 Dialog 收益低风险高；已列入 G1 白名单。
- **selection-toolbar 的 tip**（`kernelUiAtoms.tsx`）：非交互 tooltip，§3.7 决定不建 Tooltip 原语；已列入 G1 白名单。
- **非 portal 的浮层**：`SyncStatusPopover`（自带外点/Esc）、`QuickNotesWorkspace` 的 sort/row 菜单、`ExportSubmenuItem`（父菜单内的子菜单）——保留其现有机制，未迁。
- **Button（`b3-button` 45 处 / `ln-btn` 13 处）**：按 Q4 **增量迁移**（接触即迁 + 新代码只用 `ln-btn`），**不做一次性 find/replace**；`.b3-button` 规则保留（kit.css 已映射设计规格）。

### 四、踩过的坑
1. **内核主题变量是未分层注入的**：`--lakex-editor-*` 不在 vendor CSS 定义，由 `ThemeSchema.apply(domNode)` 以未分层 `<style>` 写入 ⇒ 永远压过 `@layer`。要覆盖只能**直接覆盖消费属性**（feature 层压 legacy 层），不能靠变量桥。
2. **`.ne-icon` 不是 `.ne-icon-symbol`**：原图标修复选择器写错，规则从未命中（深色下图标一直黑）。
3. **cssLayers 基线归并**：把规则从 A 文件搬到 B 文件会合法抬高 B 的声明数；本批 overlay.css 94→145、feature.css 102→104，均已在基线注明。
4. **原语 dialog 会锁 body 滚动并恢复焦点**：迁移大浮窗（回收站/历史）时用 `surfaceRef` 把外部 `panelRef` 接上，否则拖拽/缩放失效。
5. **本沙箱里跑 `npm run test:packaged` 要透传 `--no-sandbox`**：DSH agent 宿主的 seatbelt 让 Chromium 自身 sandbox 初始化失败（`sandbox initialization failed` + GPU `Sorry, GPU process isn't usable. Goodbye.`），打包版直接崩、CDP 拿不到页面。包装脚本 `scripts/e2e-packaged-smoke.mjs` 已支持 `LAKE_PACKAGED_ARGS="--no-sandbox --disable-gpu"`，并且会等 `lake://` 页面真正出现（打包版先暴露 `about:blank` 目标）。实测该命令 exit 0（两个内层 smoke 都过）。

### 五、下一步
- 合 master 前建议：跑一次**打包 smoke**（`npm run test:packaged`）与**真实数据点验**（设置页开关、右键菜单、属性弹窗、搜索、回收站/历史拖拽）。
- 若继续收敛：`SyncStatusPopover`/QuickNotes 菜单/ExportSubmenu 可后续并入 `<Menu>`；`.b3-switch` 死 CSS 可清（现无 tsx 引用）。
- 已知残留：内核浅色 schema 的"主题色"是绿 `#00b96b`，浅色下部分内核图标仍绿（未映射到 accent，单独一项）。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 43 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交）。移动端另有铁律见 **§8.0**。

## 3. 下一步计划 + 当前问题（真正的待办，按优先级）

### 下一步计划
0. **【260922 留下 · 桌面面板/目录优化项】260923 用户裁定并落地：(a)(b)(f) 已做，(g) 已撤销；余下 (c)(d)(e) 仍挂起（定性见各条）。**
   - **✅ (a) 已做（260923）**：`docs/PANEL-CONTRACT.md` —— 垂直几何栈（令牌 + 派生式）/ 层序 / 悬停延时与并集判定 / 宽度持久化与默认值陷阱 / 键盘入口 / 已知取舍。
   - **✅ (b) 已做（260923）**：`⌘]`（Feishu 口径）固定/收起目录栏 —— `useWindowShortcuts` 新增 `onToggleSidebarDock`（capture 阶段），App 在 `useDesktopShell` 之后注册；📌 加 `aria-keyshortcuts`，设置「快捷键」加一行。隔离实测 docked→collapsed→docked，正文 hash 不变（内核未占用该组合键）。
   - **✅ (c) `library-changed` 广播 —— 已做（260924，见本文件最上方 §0）**：浏览器端写入已落地 ⇒ 触发面出现。主进程 `afterInvoke` 对目录树变更通道（create/move/rename/delete/restore…）无条件广播 `library-changed`；桌面 preload `onLibraryChanged` + shim SSE 订阅 + `useSyncRefresh` 重读目录树/摘要。**实测**：Web API 建画板 → 桌面目录栏自动刷新。
   - **(d) 目录树窗口化 / 按笔记本懒加载 —— 先测再定**：现开发库 `tree_nodes=549`、`content-visibility` 已上（`shell.css` 的 `.tree-row`），无实测卡顿；懒惰化要动 `listTreeNodes` 契约，回归面大。先造 5k/10k 合成数据量渲染耗时，量到卡再立项（优先虚拟滚动）。
   - **(e) 小件去重 —— 不做**：两侧"同构"实为两套语义（左栏向右长、大纲向左长；几何/推挤刻意不同）⇒ 收益仅"更整洁"，命中 AGENTS #17 过度设计信号。出现第三个面板或证实某 bug 源于分叉时再抽，且只抽无策略差异的部分。
   - **✅ (f) 已做（260923）**：目录 peek 顶边改为 `calc(var(--topbar-height) + 4px + var(--breadcrumb-height) + 6px)`（浮层顶、阅读态大纲顶同批派生）——不再写死 80/112/74，用户调顶栏/面包屑/工具条高度时不再漂。
   - ~~(g) 「点把手固定」的 240ms 窗口~~ **已撤销（用户 260923：不做）**；并已在 `docs/PANEL-CONTRACT.md` §已知取舍 里记为定稿，别再提。
1. **画板 AI 助手接入**（真功能，待定后端）
   - 钩子：`config.drawingBoardAI.generate`（vendor `LakexEditor` 会挂到 `editor.__lakexDrawingBoardAI`）；我们不走 `LakexEditor`，是直接 `Doc.createOpenEditor`，需在 `src/features/editor/lakeRuntime.ts` 创建 editor 后**手动挂**这一行。
   - 截图那个绿色 AI 徽标是**内核**的「文本绘图 AI 助手」（`.ne-text-diagram-ai-assistant-*`，正是 `mass-office` 背景图所在元素）；vendor **无注入点**（`KernelAssistantConfig` 只有 `supportEmoji`）→ 接不了。
   - 可接的是画板卡的「AI 画板助手」（`.lakex-ai-board-*`）；未配置时面板提示「尚未配置 AI 服务」。
   - 官方示例：`vendor/lakex-doc-react/examples/`（前端 `generate` / `aiProxyPlugin.ts` 后端代理 / `mockDrawingBoardAI.ts` / `.env.example`）；契约见 `src/components/lakex/types.ts`。
   - 待定：模型/服务与 endpoint、API Key 存放（**建议 Electron 主进程代理**，勿用 `VITE_`）、设置项、移动端网络。
2. **离线残余（均「外观级」，非功能）**——详见 `docs/OFFLINE-ASSETS-AUDIT-260916.md`：① `__puml` 预设缩略图 8 张（`cdn.nlark.com` / `lark-assets-prod…`）仍外链；② `mass-office.alipay.com` 的内核内联 AI 图标；③ 思维导图 KaTeX CSS（@xiangfa 注入 jsdelivr，待运行时确认）。（PlantUML ✅ 已解决。）
3. **移动端剩余批次**：B7/B8 + 真机复验缺口 —— 明细见 **§8**。
4. **产品/技术债（长期）**：~~W-8 ACAO / W-10 dompurify~~ ✅ **已结案（260926）** —— ① **W-8 已修**：`electron/webApiServer` 对 `/api/*` 与 `/__native.js` 做 **Host + Origin 完整白名单**（不放行空端口）+ `Sec-Fetch-Site` 拦截，`webApiServer.test.ts` 覆盖跨站 Origin→403 / DNS-rebinding Host→403 / 空端口 Origin→403；② **W-10 不需要 dompurify（据实否决加依赖）**：残留 `dangerouslySetInnerHTML` 只有搜索摘要（`SearchPanel` / 移动 `SearchSheet`），由 `src/core/search/snippet.ts` 的 `buildSnippet` **全量 HTML 转义**、只输出 `<mark>`；`snippet.test.ts` 覆盖 script/&/引号/img-onerror；全仓无 `eval`/`new Function`，另一处 `innerHTML` 是 `lakeRuntime` 自己的静态图标串 ⇒ 加依赖命中 AGENTS #17。以下仍待办：大纲 viewer 只读点击不跳转；回收站首拉成本（惰性下载暂缓，动恢复红线）；Word/PDF 导出 + 附件大文件 S3 分片；`docs/LAKEX-CONTRACT.md` §4 的 `lakex-contract.d.ts` 落地。CSS 层级冗余见 §3.9（260917 已收口）。
5. **非代码**：安卓同步偶发 `UnknownHostException` = 设备网络（联网重试）。
6. **小记（Quick Notes）设计取舍 —— 是否直接挂 Lake 内核底座**（用户 260917 提出）：**260919 已定稿并落地 =「挂」**。小记正文升 v2（内核形态 `body`，`docs/QUICK-NOTE-LAKE-BODY-260919.md`），写作区**编辑时挂一个**内核实例（`src/features/quickNotes/QuickNoteEditor.tsx`），转换退化为「搬运 + 资源作用域改写」。**260919 晚又续做 note 版式对齐云端**（工具条「图片/待办」+ 展开成完整编辑器，内核机制见 `docs/LAKEX-CONTRACT.md` §5.11）。剩余：真机点验 + 上一条的 7~9 潜在缺陷 + `QUICK-NOTES-SPEC.md` 文档过期。
7. **Lake 正文写入收口**（约定见 `docs/LAKE-CONTENT-WRITING.md`）：① 自动化程序（不在仓库）**直接写库 + 手写裸 `<img>`**，导致 287 篇测试文档一被打开就被内核重写（图片降级成失败卡片 + 变待同步 → 随下次同步上传）→ **必须改成走应用写入路径，或只写纯文本**；② 仓库内 4 处手拼写入者**已收口**到 `src/core/lakeDocForm.ts`，并加了"绝不产出裸 `<img>`"的单测围栏；③ 旧数据按 §3 原则 7 **不写归一化兼容**，用修好的姿势重建（见第 8 条）。
8. **旧数据处置 —— 等用户决定，别擅自动数据**：287 篇含裸 `<img>`（+7 篇已降级成失败卡片）。选项：**A 删掉重播（推荐，符合原则 7）** / B 留着但别打开 / C 就地改写成卡片（= 为损坏数据写代码，与原则 7 冲突，不推荐）。
9. **「深层重复」CSS 候选清理（260917 已收口；结论：不做整批）**：档0（围栏基线纠偏）+ 档1（可证死声明清理）已完成，见 §2。按严格口径（同 at-rule 上下文 + 同单选择器 + 同属性）**全库只有 55 条可安全删**，已删并 ab2 全矩阵 34 状态证 0 差异。此前估算的"29 文件 / 3835 声明 / 184 争用（147 跨层）/ 92 选择器"**大多是把不同 `@media` 条件（宽/窄两套）算成争用**——那些不能删。**结论：不再推进 8–12 人日的整批清理**；若日后新增重复，围栏 `src/styles/cssLayers.test.ts` 会卡住，`scripts/css-audit/plan-dup-decls.mjs` 可随时重生成候选。
10. **浏览器端（本机附属窗口）后续（专项见 `docs/BROWSER-CLIENT-DESIGN.md`）**：已完成"开关 + 说明 + 打开按钮" + **阶段 1 SSE 推送**；剩余缺口按优先级：① ✅ **推送已做（260924，见本文件最上方 §0）**：`GET /__events` SSE（header token 鉴权）+ `webServerController.broadcast`；`main.ts` 的 `broadcastSyncProgress` 与 pending 摘要 diff（`afterInvoke`）已接 sink；shim 里 `onSyncProgress`/`onPendingSummaryChanged` 用 fetch 流自解析 SSE；② ✅ **宿主能力浏览器化（260924 已做，见本文件最上方 §0）**：shim 暴露 `capabilities`（`nativeDialog:false`）+ 透明覆盖 `saveAssetAs`（浏览器下载）/`openAttachment`（新标签）/`copyAssetPath`（复制资源 URL）；UI 对导出/备份/云端恢复给「请在桌面端操作」提示。**目录类导出/备份的浏览器下载未做**（无 zip 依赖，见设计文档阶段 2）；③ **开发体验**：只服务构建产物 `dist/`（无 HMR），无 `npm run dev:web` 脚本；④ **安全（已复核：比早期记录的更完整）**：已有 Origin/Host 白名单（防 DNS rebinding）、`Sec-Fetch-Site` 跨站拒绝、仅 header token（常量时间、禁 query）、`/__native.js` 限 same-origin/none、dist 路径穿越防护；剩余可选增强见 `docs/BROWSER-CLIENT-DESIGN.md` 阶段 3。
    - **AI 生成的文档能否"各端发现"（用户 260917 提问 → 结论）**：只要 AI **走应用写入路径**（`createNote` + `saveNote`，媒体让内核产出——**禁直写库/手拼 `.lake`**，见 `docs/LAKE-CONTENT-WRITING.md`），就会以 `sync_state='local'` 落库 → **跨设备**靠现有 S3 同步天然可见（无需新机制）；**同机多窗口/浏览器**要"立即看到"则需再加一个 `library-changed` 事件（复用同一 SSE 通道）。**浏览器端本身只覆盖本机**（绑 127.0.0.1，不是同步参与者）；AI 若在云端生成属另一套设计（走同步协议或把 webApiServer 暴露到网络 = 需单独的安全方案）。

11. **【优化项 · 用户 260918 决定「先不做」】块拖拽的两个进阶能力：多块选区批量拖拽 + 拖拽改层级（蓝色导引线）**
    - **用户决策（260918 原话）**：「拖拽改层级 + 蓝色导引线 这个列入待办吧，我感觉现在就挺好的，云端的跨层级有点乱，并不是很好用。先不做了」；并要求与「多块选区的批量拖拽」**合并成一项优化项**记录（非 bug、不进主线待办）。
    - **共同触发条件**：用户明确需要时再做；不做不影响现有功能（现有拖拽=单块+整段列表父项，已满足日常）。

    **(a) 拖拽改层级（云端那种蓝色导引线）—— 已调研：可做**
    - **能力齐备，不用新内核能力**：纵向移动已可用；层级 = 列表项 `ne-level`（模型 `attrs.level`/`parentIndex`）；内核有 `indent`/`outdent`/`canIndent`/`firstIndent`（§5.9 注册表；**`editor.execCommand` 上有效、移动端 `renderer.execCommand` 上无效**），菜单「缩进」已在用。
    - **要补的是交互与落点语义**：① 拖拽时按光标**水平偏移**算目标层级（候选 `0..(上方块层级+1)`，按列表缩进宽度 32px 量化）；② 导引线按层级改 `left/width`（现有 `positionIndicator` 已画 2px 横线，扩展很小）；③ 落点 = 垂直照旧 + 层级差用 `indent`/`outdent` 补齐（或同一模型事务里改 `level`）；④ 顺序要实测：先移动后改层级 vs 先改层级后移动（插入同列表会重建列表节点、range/选区失效——§2.5 的坑）。
    - **代价/风险**：约 **0.5–1 天**（含新 e2e：拖后断言 `ne-level` 与顺序）。风险集中在跨列表边界与「层级变更后子项是否跟着走」（云端按「父项 = 整段」，我们已有 `blockSpanElements` 可复用）。用户主观评价：**云端这套跨层级交互偏乱、不算好用** ⇒ 做的话不要照搬，要先定交互。

    **(b) 多块选区「批量拖拽」（260917 记录；云端 Lake 也未实现）**
    - **现状**：Issue 4 已支持多块选区的聚合手柄 + 批量删除/复制/剪切/转化；**拖拽仍按单块**（`moveBlockNative` 遇到多块选区直接返回 false），手柄在拖拽时不进入拖拽态。
    - **难度：中等偏易**，可复用现有原语、无需新内核能力：`selectedTopBlocks` + `selectBlocksInEditor` 取整段选区 → `getSelectionContent('text/lake')` 取整段 fragment → **节点级删除整段**（`removeBlockNodesNative`，260918 起；**不要**用 `deleteByRange`——它在根级整块上会补空段落，见 §5.8.5）→ `insertAtPosition(dropPos, 'text/lake', frag)`。与单块「摘节点 → 落点插入」同一套路，只是把「一个块」换成「一个选区」。
    - **三个真实风险（决定工作量）**：① **卡片保真**：单块卡片走 `moveCard` 逐字节保真；整段 fragment 里含卡片时只能走 lake 序列化再插入 ⇒ 卡 id 会重发（已注册卡字节应保真，**未注册卡会丢**，与「打开即保存」同因）；要跟单块一样保真，需在移动前把选区里的卡片逐个 `moveCard` 或按卡类型分流。② **列表层级/顺序**：整段跨列表时层级依赖 fragment 顺序与 `data-lake-indent`，删+插后要复核层级不被压平（Issue 3 只验证了单个父项）。③ **落点边界**：落点落在选区内部要拒绝（现有 self/span 判断需扩展到整段选区）。
    - **UI**：ghost 需渲染整段（多块）预览；落点线 / 边缘自动滚动可复用（ghost 已支持「列表父项整段」，扩展到多块改动不大）。
    - **代价**：约 **0.5–1 天**（含 e2e）。

12. **【S3 审计遗留 · 低优先级】**（260918 审计三条 P0/P1 已落地，见 §0 本批 + `docs/S3-STORAGE-AUDIT-260918.md` §7.5/§8）：① **B4 实测**——该篇附件哈希全量重算在上传**和下载**两侧都会发生，有痛感再做 `(filename,size,mtime)→hash` 缓存（贴 AGENTS §3 #11 红线，**单独立项**）；② **D4** purge 文件删除失败 → 阻断云端前缀删除；③ 移动端 `note_history` 补 `refs_json`/`protected_until`（建议并入 §8.7 真机验收批次）。

13. **【表格文档（kind=sheet）收口 · 进行中 · 260918】分支 `feat/sheet-document` 上已写完且门禁全绿，但【未提交】【未真机验收】** —— 完整交接见 **§2.8**，设计/实测见 `docs/SHEET-BITABLE-DESIGN-260918.md`。
    - **（260919 已变更）**：表格内核已由 **jspreadsheet-ce 换成 FortuneSheet 1.0.4**；下面 CE 相关的收口项部分已随迁移作废/改写，**当前表格状态一律以 §2.8 的 260919 各轮补充 + `docs/FORTUNESHEET-FEASIBILITY-260919.md` 为准**；图片相关见第 **14** 条。剩余项（用户已同意先列入待办）：
    - **（必做）真机验收**：新建表格 → CE 渲染 → 编辑 → 落盘 `sheets/{id}.sheet.json` → 自动保存 → 同步 → 另一端/移动端表现。见 §2.8 四.1 的 5 个观察点。
    - **（✅ 260919 已解决）`SheetEditor.tsx` 的 2 处内联样式**：CE→FortuneSheet 重写后消失——容器尺寸走 `.sheet-editor` CSS（`src/features/sheet/sheetEditor.css`，fence 基线已同步），CE host `pointerEvents` 随 CE 删除；`grep -rn "style=" src/features/sheet/` = 0。
    - **（✅ 260919 已完成）非 doc 类型的导出/MD 守卫**：`electron/noteExport.ts` 的 `exportHtmlNote`/`exportPdfHtml`/`exportNotePackage` 已加 `assertDocKind` 前置守卫（非 doc 抛 `InvalidInput`）；桌面 `TreeNode` 已加 `kind`（`listTreeNodes` LEFT JOIN notes + `mapTreeNode`），目录树右键「导出」子菜单与文档 ⋯ 菜单对非 doc **隐藏**；状态栏对非 doc 把「字数/图片」**替换为「表格/多维表」**；大纲侧栏对非 doc 隐藏。回归测试见 `electron/store.test.ts`。
    - **（✅ 260919 已确认）文档回填**：`docs/SYNC-PROTOCOL.md` 已有 260919 段（manifest **v6** + 每条 note 可选 `kind` + 旧端读 v6 显式拒绝）；`docs/STORAGE-LAYERS.md` 已有 `sheets/{id}.sheet.json` + `notes.kind` 决定路径 + `sheetToSearchText` 段。无需再改。
    - **（提交前）清理 spike 产物**：`spike.html`、`src/spike/`、`scripts/spike-sheet-ce.mjs`、`vite.spike.config.ts`、`vite.spike.build.config.ts`（保留两份 `docs/*-260918.md` 设计文档）。
    - **（提醒）manifest v6 ⇒ 所有端一起升级**：旧端读到 v6 显式拒绝同步（刻意安全闸）。

14. **【表格图片独立管理】浮动图 P1 ✅ 260920 / 单元格图片 P2 ✅ 260921 / 缩略图 ✅ 260921 续（均未提交，见 §2.16 / §2.18 / §2.19）** —— 规范与落地记录见 **`docs/SHEET-IMAGE-MANAGEMENT-260919.md` §5 / §13 / §14**。
    - **✅ P1（本会话）**：正文 `sheets[].images[].src` 存 **filename**（**版本号不变**，仍 v2 —— 结构未变、两种形态读写都支持，升版本会让既有表格变空表）；
      文件落 `note-assets/{noteId}/`，**清单声明无需改（磁盘实扫）**，同步/GC/历史复用现有资产管线（红线 #11/#17）；老正文里的 base64 在**打开时**自愈（同一条提升路径，不是兼容分支）。
      实机实测：正文 323B 只有 filename、资源落盘、reload 后按**本实例端口**渲染。
    - **✅ P2（本会话）**：单元格图片 = `images[].cell = {r,c}` 锚点 + 几何跟单元格走（`src/core/sheetGeometry.ts` 复刻内核口径）+
      CSS `object-fit: scale-down` 锁比例不放大 + 指针事件关闭；插入/替换/Delete 删除/粘贴插入/冻结窗格偏移都做了；
      **不走原稿的 overlay/canvas 两条路**（复用内核浮动图通道，滚动/裁剪/缩放全免费）。见 §2.18。
    - **✅ 缩略图（260921 续）**：assetServer `?w=` 按需缩放（`sharp` + 原格式 + GIF/SVG 跳过 + 内存 LRU + 并发闸 4），
      档位随显示宽度换代；**不落盘派生文件**（会被磁盘实扫声明成资产、却不在正文引用集里 ⇒ 注定被判孤儿回收）。
      实测 2400×1600 在 81px 格里解码成 256px（位图 15.4MB → 175KB），落盘正文不含 `?w=`。
      **续 2**：同一套已接**多维表附件格**（26px 取 128 档，放大预览仍原图）与**移动端小记封面**（最大档位 1024），
      安卓 Java AssetServer 同语义实现（`inSampleSize`，只认 png/jpg/jpeg，8 项 JVM 单测过，**真机未验**）。见 §2.19。
    - **仍待做**：**P3 移动端表格只读渲染 + 对拍 + 压测** · **移动端缩略图真机验收**（设备上看小记封面/表格图片）·
      AB 多端往返 + 删图后 GC 回收实测 · 「单元格格式 → 图片」对话框入口（要 patch 内核 React 弹窗，本批刻意不做）·
      浮动图缩略图。
    - **前置已做**：图片按钮按实例定位（patch react）、本地插入可用（见第七轮）。
15. **【移动端小记工作台能力 · 待办 · 用户 260920「先计入待办，先不做」】**：移动端小记目前只有 编辑/删除/排序；桌面的**转正式文档 / 批量选择 / 置顶 / 列表视图**尚未搬过来。详见 `docs/MOBILE-PARITY-260920.md` §五。

16. **【移动端复用小记能力 · 后期】** 桌面小记已定稿为「内核当写入器 + 自研读取器（白名单）」（见 §2.10 续做第五~八轮）。
    移动端小记目前是纯文本输入 + 合成 lake 段落/图片卡（`src/mobile/quickNotesRepository.ts`）；
    用户要求后期**复用同一套能力**（同一份白名单 + 同一个预览读取器 `quickNotePreviewParser.ts`），
    工具栏形态可按移动端（`EditorDock`）调整。做之前先读 §2.10 续做 + `docs/LAKEX-CONTRACT.md` §5.11。
17. **【UI 重构收尾 · 待办清单】** —— 方案见 **`docs/UI-REDESIGN-OPTIMIZATION-PLAN-260923.md`**（行为不变的优化 + 与安卓重做的排期）；评价见 `docs/UI-REDESIGN-REVIEW-260923.md` **§四**：P0 安全 ✅ **已结案**（W-10 不需 dompurify / W-8 已修，见本 §3 第 4 条）· P1（`library-changed` 广播 / 目录树窗口化 / 面板契约可执行化 / 分段控件与设置说明字号的共享层 `!important` 阻塞）· P2（设计词表裁剪 / 历史文档标注 / 画板 `Wt is not a function` 立项）· P3 见本 §3 其余条目。
18. **【浮动工具栏颜色 · 「最近使用自定义颜色」】**（260924 记录，用户：先记着后续处理）：内核调色板的「最近使用」**只记自定义色**——`updateUserColor` 只在「更多颜色」RGBA 选择器关闭（`saveColor`）时触发，**预设色块 `onSelect` 不写**；持久化在 `localStorage['ne_lakex_user_color_local_store_key']`（≤10，末尾最新），经 `editor.getUserColors()` / `editor.updateUserColor(c)` 读写。我们的浮动颜色面板「最近使用」目前是**占位**（`LakeColorBoard` 写死「暂无」）。要真做需先定：是否也记预设色块（会偏离内核语义）、面板改读 `editor.getUserColors()`、点最近色如何应用（`color`/`bgColor`）。**当前不动**。

### 当前问题 / 已知坑（不阻塞）
- 画板**不再记忆视口**（拖动/缩放后重开为默认/自适应）：这是 260916 为「不让视口触发保存/上传」刻意做的取舍，**用户已确认接受**（"谁知道下次进来要看什么"）。不要改回去。
- 离线残余 3 处（见上，全外观级）。
- `public/vendor/cdn` 的 32 个静态无引用文件**不能删**——它们是 `electron/cdnRedirect.ts` 的**运行时兜底白名单**（用「镜像里是否存在该文件」决定是否把 `gw.alipayobjects.com` 请求回本地）。
- 桌面日志里的 `download_remote_resource` **INVALID_INPUT（不允许下载本机或私网地址）不是"无关噪声"**（260917 更正）：它标记着「打开了自动化手写裸 `<img>` 的文档」→ 内核回写失败态卡片 + 该文档变待同步，**打开即发生**。详见 §3.7 与 `docs/LAKE-CONTENT-WRITING.md`。（403 仍是远端策略问题。）
- **小记转换产物是"内核容忍"而非"内核产出"**：`electron/quickNoteConversion.ts` 写的图片卡片是 `originalType:"url"` + `originWidth/originHeight` + `from:"quick-note"`，内核自产卡片是 `originalType:"binary"` + `width/height` + OCR 字段（`search/ocrLocations`）。今天**实测稳定**（`.lake` mtime 停在转换时刻、无脏点、无快照、对拍 PASS），但依赖内核容忍度 → 与 §3.6 的取舍一起讨论。
- **判定"是否被内核重写"的口径**（别再靠肉眼）：`.lake` 的 **mtime 不变** + 标签无脏点 + 无新增历史快照 + 正文里 `status%22%3A%22error%22` 为 0；批量判断用 `scripts/lake-roundtrip-check.mjs`（只动副本）。
- **`vitest` 是 `node` 环境，跑不了内核**：涉及内核行为的验证只能 CDP 驱真实 Electron；不要试图为它写单测（对拍脚本就是这种模式）。

## 4. 踩过的坑（合并版；通用红线/环境见 AGENTS.md）

### 本次会话新坑（260923 · dev 下首次打开画板导致整页 reload）
- **被 `optimizeDeps.exclude` 的 vendor 包，其内部按需 import 的重型依赖必须显式加进 `optimizeDeps.include`**：`@dlient/lakex-doc-react` 因要走 `lakexAlipayLocal` 的 gw 本地化 transform 被 `exclude`，但 Vite **不扫描被 exclude 依赖的 import** ⇒ 它内部按需加载的 `@plait/*`（画板）、`@xiangfa/mindmap*`（思维导图）、`mermaid`/`flowchart.ts`/`@viz-js/viz`/`@plantuml/*`（文本绘图）启动时不会预构建；**首次真正用到**时才被发现 → `[vite] dependencies optimized: ...` + `optimized dependencies changed. reloading` → **整页 reload**。
- **症状**：dev 启动后第一次打开画板，白屏数秒，然后**其余已打开标签全被关掉、只剩画板**。原因叠加 `useBootstrap` 只重开 `lastOpenedNoteId`（`src/hooks/useBootstrap.ts:46`），标签是纯内存态、reload 即丢。
- **修复**：`vite.config.ts` / `vite.mobile.config.ts` 的 `optimizeDeps.include` 补全上述依赖（`exclude` 必须保留）。桌面已 A/B 验证：修复前 import 画板引擎即触发 reload；修复后 235ms 完成、无 reload。**仅 dev 有**（生产无依赖优化器）。
- **排查手法**：独立 Vite cache（`cacheDir` 指到 `/tmp`）+ 独立 `LAKE_USER_DATA`/`LAKE_ASSET_PORT`/`LAKE_DEV_SERVER_URL`，抓 Vite stdout 的 `optimized dependencies changed. reloading`，CDP 看 `Runtime.executionContextsCleared` + `Page.frameNavigated` 佐证整页刷新。

### 本批（260918 表格文档 SheetDocument）新坑 —— 完整版见 §2.8 五
- **`NoteSummary` 有两份**（渲染层 `src/lib/types.ts` + 主进程 `electron/noteQueries.ts`）、**`mapSummary` 有三处 SELECT**（`noteQueries.listNoteSummaries` + `store.ts` 回收站列表 + `store.ts` saveNote 回读）：加字段漏一处 = "保存后类型丢成 doc"，症状极隐蔽。
- **TS 推断返回类型会放宽字面量**：`{ kind: cond ? "sheet" : "doc" }` ⇒ `string`，外层端口类型不兼容。用嵌套三元/`as`/显式返回类型。
- **远端导入必须按 manifest 的 `kind` 解析路径**：导入时 DB 还没行，`notePathFor` 会回退 doc ⇒ 表格写到 `notes/{id}.lake`。已注入 `bodyPathFor(noteId, kind)`。
- **CE `parseFormulas: true` 在严格 CSP 下整表崩**（只出表头）；`false` 则完整渲染 + 0 违规。CE image 列只认 `data:image`（图片只能内联 base64，且 base64 不匹配 `ASSET_NAME_RE` ⇒ 不污染 `manifest.assets`）。
- **Univer 实测过重**：产物 9.77MiB/2.48MiB gzip（55 个 locale chunk ≈4.3MiB）、依赖 118MB（含本项目原本没有的 `rxjs` 11MB）、堆 23.76MiB、**≈20MB/实例（与 keep-alive 多 tab 冲突）**；其多维表本体在 Pro。
- **开源多维表选型事实**：`@teable/core` 是 MIT（field/formula/convert，可当自研底座）；`@teable/sdk` MIT 但强绑 Teable 服务端；NocoDB 是 Sustainable Use License；成熟开源多维表全是服务端应用。
- **`npx vite dev` 会拉起第二个 Electron 抢 CDP 9222**（探针会看到 `chrome-error://`）——调研用独立 config + 1422 端口规避；**依赖 9222 的脚本先探测本机 Electron 是否在跑**（用户会关掉 dev 实例）。

### 本次会话新坑（2026-09-18 S3 审计批次）
- **验证「清单拉取失败」不能只改错密钥/endpoint**：桌面同步先 `remote.test()`（ListObjectsV2），坏凭据/不可达都在那里抛、UI 本就正确报失败。只有「清单非法 JSON / 解压后 >20MiB / `test()` 之后那次 GET 瞬时失败」才会走到引擎 pull 的 catch。**写审计复现步骤前先确认「实际在哪一层抛」**（本次审计 §7.4 的 F2/D2 两步复现都因此验不出来，已按 §8 更正）。
- **同步失败语义已改「真失败一律抛」**：`syncEngine` pull manifest 的 catch 不再有「降级成 return」分支（对象缺失=首次同步走 null 分支，不是异常）。改这段代码若加回吞错，会退回「同步成功、0/0」假安全；且引擎早退后 Controller 的 purge 前缀删除/`markPurgeSynced` 也会跟着执行（顺序问题）。
- **留档快照是「被覆盖编辑」的唯一保障，不许吞错**：`syncAdapters.createHistorySnapshot` 的空正文（""）= `.lake` 读失败（应用永不产出空 `.lake`，`emptyLakeBody` 是 `<p><br></p>`），必须抛；`createHistorySnapshot` 遇 `.lake` 缺失是**静默 return null**（不留档）——「无空快照」≠「无问题」。
- **「资源能否被删」的单一真相 = `AssetRepository.getProtectedRefs`**（当前正文 ∪ 历史 refs ∪ 未保存草稿 refs）。任何新的删除路径（自动/手动清理、GC）都走它，**不要**自己另写「当前正文引用」判定——草稿引用这层就是这么漏掉的（审计 D3）。
- **给审计文档下结论前跑独立复测脚本**：清单体积这类估算用 `crypto.randomUUID()` 按 `buildUploadEntry` 字段构造实测（本批 `/tmp` 脚本复测 5K+2万附件 = 4.30MiB，与文档 4.08MiB 同口径）；纯文字估算容易把「字节余量」和「条数余量」混着说。

### 本次会话新坑（2026-09-17 第三批：浏览器端）
- **dev 改 `electron/preload.cjs` 不会热重启**：vite-plugin-electron 只 watch 入口 `electron/main.ts`；dev 下 preload 是**直接读源文件** `../electron/preload.cjs`（不在 `dist-electron/` 里）。改完 preload 必须**手动重启 Electron**（或 `touch electron/main.ts` 触发重建）才生效，否则渲染层还是旧方法（症状：`window.lakeNative.getWebStatus is not a function`）。
- **改主进程/共享模块后要确认 `dist-electron/main.js` 已重建再测**：重构中途会短暂出现 main.js 与源码不同步（本次报 `store.getWebSettings is not a function`），重建后即消失——别当业务 bug 查。
- **浏览器端"不落盘"是有意的**（用户 260917 明确：每次启动默认关闭、用时再开）：**不要再加回持久化**（无论 `settings` 表还是 localStorage）。开关是运行期起停（`createWebServerController`），不是"启动时读开关"。
- **打开外部链接的 URL 必须主进程构造**：`open_web_client` 不接受渲染层传 URL（只按固定端口拼），避免把任意链接丢给 `shell.openExternal`（开放重定向/本机文件）。

### 本次会话新坑（2026-09-17 第二批）
- **"同一几何只修了一处视图"的漂移**：底部 4px 灰缝在小记视图早已单独去掉，基础 `.workspace` 却还留着 `margin-bottom: 4px` → 文档页最底露灰条。**修共享几何前先 grep 有没有"某个状态单独覆盖过同一属性"**（那通常说明基础层漏改了），别只改报障的那一处。
- **审计装置会随 UI 批次漂移**：`scripts/css-audit/css-audit.mjs` 的 `nav.search` 还在找左上角下拉（入口已搬右上角）→ `ab2` 在**状态准备阶段**抛错（不是比对差异，易误读成回归）。跑审计装置前先确认它跟得上最近 UI 搬位。
- **`ab2 plan` 测不了 `app/*.css`**：它们被 Vite 内联进 `src/styles.css` 那张表（dev-id 实测 424 规则）；按文件名注入会 `missing` → **假 PASS**（见 `scripts/css-audit/README.md` §七）。必须用 `SPEC` 注入"整份内联内容"（本会话 `build-spec-dup.mjs` 即此）。
- **`ab2` 的 `only` 过滤是状态全名精确匹配**：传 `search-empty` 匹配不到 `search-empty:1315:light`，会被**静默跳过**（本会话白跑一轮）。

### 本次会话新坑（2026-09-17，务必记住）
- **`scrollIntoView` 会滚动"所有"可滚动祖先**：它不认"我只想滚这个容器"。本会话因此把 `body` 滚了 42px（`.sidebar` 的 `margin-top: 42px` 让外壳多出 42px 可滚区间）→ 整个 `.app-shell` 被顶上去 → 固定顶栏与壳内容错位（侧栏头钻进顶栏下、面包屑挤进 tab 行）。**要滚就只改目标容器的 `scrollTop`**；已把 `html/body` 改 `overflow: clip` 兜底（`hidden` 挡不住程序化滚动）。
- **可见区要按"窗口"裁剪，不能只看容器矩形**：停靠目录栏底边在窗口外 42px（`.sidebar` 的 `height: 100% !important` 没补偿自己的 `margin-top: 42px` —— 见 `app/shell.css:238` 的 2026-08-13 注释）→ 只用 `listRect.bottom` 判断"是否可见"会**永远少滚 42px**（症状："向上定位正常、向下永远差一截"）。副作用：目录栏最后 ~42px 内容看不全（既有布局债，未修）。
- **Chromium 给 `::view-transition-group` 默认 250ms 形变动画**：只压 `::view-transition-old/new` 不够 —— 这个默认 group 动画才是"切标签慢"的主因（实测占掉 anim 阶段 276ms 里的 ~250ms）。我们最终**整个 View Transition 都不要**。
- **对拍/等待窗口别拍脑袋定**：内核水合改写延迟 **0.5s～7.8s 不定**，短窗口会给**假 PASS**。高风险形态（正文含裸 `<img>`）必须等满上限。
- **加"对拍单测"是死路**：`vitest` environment = `node`，内核要 DOM → 只能用 CDP 脚本（`scripts/lake-roundtrip-check.mjs`）。
- **改 `electron/**` 会触发 vite-plugin-electron 重启 Electron**（老坑见下），本会话改了 `store.ts`/`schemaInit.ts`/`quickNoteConversion.ts`，构建与重启实测正常；仍按老规矩：改完别再频繁动主进程文件。

### 更早新坑（2026-09-16，仍需记住）
- **rolldown `codeSplitting.groups`**：`includeDependenciesRecursively` 默认 `true`，会把**入口也需要的依赖**并进该分组的 chunk，令入口**重新静态引用**它（懒加载失效）。要真正惰性必须设 `false`（app `vite.config.ts` 的 drawnix 组）。
- **vendor lib 构建默认 `inlineDynamicImports:true`**：会把动态 import 内联回单文件。画板卡懒加载要求关掉它，并**提交新增的 chunk 文件**（`DrawnixBoardCore-*.js/.cjs` 会随内容改名，旧的要删）。
- **`external` 匹配 package 子路径必须用正则**：精确字符串 `'@plantuml/core'` 匹配不到 `@plantuml/core/plantuml.js`（7MB 会被内联进主 chunk、预算炸）。用 `/^@plantuml\/core(\/|$)/`。
- **根 `.gitignore` 别写裸 `dist`**：会吞掉 `vendor/.../dist` 和 `public/.../katex/.../dist`（katex 镜像差点因此没进 git）。锚定 `/dist`。
- **内核 maxView（卡片/表格全屏）**：`.ne-ui-max-view{position:fixed;inset:0;z-index:1000}` 是「无外壳独立编辑器」口径；我们带侧栏/顶栏 → 会盖住整个窗口（表格缩左上、外壳被压）。适配：`.document-pane{position:relative}` + 把 `.ne-ui-max-view` 改 `position:absolute;inset:0;z-index:30`（外壳保留，内核「返回文档」退出按钮也才有布局）。
- **`src/styles/cssLayers.test.ts` 是 CSS 围栏**：新增声明会超基线。**合法新增**（不是多层覆盖回涨）就同步抬高该文件基线并注明原因；只允许变小。
- **画布滚轮门控要覆盖所有 canvas 卡**：`prepareCustomCards` 原来只给 `isMindmap` 加 `withCanvasWheelGate`；Drawnix 的 `drawing-board/flowchart-board/uml-board/drawing-mindmap-board`（slash `/hb`）漏了 → 光标路过就滚画布。识别 = 卡名集合 + `slash.mainSearch === "/hb"`。
- **画板 viewport 不是内容**：`DrawnixBoardCore.onViewportChange → onChange({plaitViewport})` 会让**每次拖动/缩放**都改卡片值 → `contentchange` → 保存 → `syncState=pending` → S3 上传。已在 vendor 改 no-op（LOCAL-CHANGES #8）。
- **keep-alive 多编辑器**：每个打开 tab 的编辑器都在 DOM 里（隐藏）。CDP 用 `document.querySelector('.mindmap-interaction-gate' / '.ne-ui-exit-max-view-btn')` 会抓到**隐藏 tab** 的元素（尺寸 0）→ 误判。必须按「可见元素过滤 / 限定 active tab 内」再判断。
- **CDP 测画布缩放别用 ctrl+wheel**：那是 Chromium 的**浏览器缩放**（会缩放整个 app 并卡住脚本）。测画板缩放要走画布自带缩放控件，或先**真实点击**激活门控再用普通 `mouseWheel`。
- **CDP 探针**：Node 24 有内置 `WebSocket`（别用系统 node 18 会 `WebSocket is not defined`）；改完 vendor/app 必须 `location.reload()` 后再测，否则测到旧状态。
- **vendor 源码改了要重建产物**：`npm run build:vendor`（`vite build` + `tsc` + postbuild），产物 `dist/**` 入库；只改源码不重建 = 运行的是旧产物。

### 同步 / 数据语义（最危险的一类）
- **`purged_at` 不是"已彻底删除"的永久标记**：`markPurgeSynced()` 在前缀删除成功后清空它（防重复删）。任何"别让它复活"的判定必须看**永久墓碑**（folder 看 `deleted_notes.node_type='folder'`）。
- **purge 的墓碑必须无条件写**：`notes` 行缺失时跳过 = 云端永不下架 = 之后必然复活成"父不存在的不可见文档"（本轮实数据踩到）。
- **不要给"资产存在性"做本机持久缓存**（GC 会真删对象 → 缓存失真 → 破坏跨端自愈）；用"刚下载的远端清单"做差集（AGENTS #11）。
- **`contentHash` 会骗人**：`syncAdapters.localHashOf` 对 synced 笔记返回 `store.baseHash`（不读 `.lake`）；判"本地可复用"必须**实读正文 + sha256**。
- **清单声明⇒存在**：上传走差集但 `manifest.assets` 仍**全量声明**（裁剪声明 → 他端 GC 误删在用资产）；禁逐对象 HEAD。
- **兜底「未分类」只惰性创建**：下载阶段无条件 `defaultNotebookId()` 会凭空建"未分类"并上传扩散；`effectiveParent()` 也只能在"真应用"处解析。
- **S3 并发峰值 ≤8**（七牛建议）：`NOTE(2)×ASSET(4)`；曾 16 偏高、无必要。
- **软删 = 移动到回收站笔记本**（`parentId=TRASH + trashedAt`），`deleted:true` 只用于 purge 墓碑。混用 = B1 级致命 bug。
- **守卫不能只挂在一条路径上**：`tab.deleted` 此前只在同步刷新里设置，启动恢复/点击打开都不判定 ⇒ 同一文档"同步过就只读、没同步就能编辑"。这类判定必须收敛成一个纯函数（现 `isGoneNote`）在所有入口调用。
- **静默丢弃用户输入是最坏的失败模式**：`if (deleted) return;` 不打提示 → 用户以为已保存。拦截必须同时给可见反馈 + 出口。
- **文档漂移**：易过期事实（分支/hash/计数/当前焦点）**只写 HANDOFF §0**，别写回 AGENTS/README。
- **`git worktree list` 要纳入开工检查**（历史上漏看过一次 android WIP）。

### 渲染 / CSS
- **浮层 flex 列的固定区必须 `flex: 0 0 auto`**：`header/页签/提示条/错误条` 默认 `0 1 auto`，内容一多就被压扁，溢出文字被**后绘制的列表**盖住（就是"回收站左侧列盖住顶部提示"）。复现：CDP 把面板压到 200px 高，比对 `Range` 文字底边与列表 `top`。
- **预览/图片切换不要清空旧内容**：`setState(null)` + 文本占位 = 塌陷再撑开 = "闪一下"。正解：保留旧图 + 新图 `img.decode()` 后替换 + 容器固定高度。
- **居中缩放容器别用 grid 的隐式 auto 行**：`display:grid; height:300px; overflow:hidden` 里图片按原始尺寸撑高行 → `max-height:100%` 失效、图被裁切。要 `display:flex; align-items:center; justify-content:center`。
- **同一元素被多层 CSS 覆盖会互相打架**（styles.css → b3/components.css → overlays.css）。改 UI 前先 `grep` 类名看有几处定义；跨层加 modifier 时写进**同一层**（`.badge` 会赢过 styles.css 里的 `.quick-notes-count`）。
- **vendored `text-clamp` 混入不等于省略号**：`.b3-list-item__text` 只有 `overflow:hidden`，长文件名会把 `__meta/__action` 挤出列宽，需自己补 `min-width:0 + text-overflow:ellipsis + white-space:nowrap`。
- **lucide 图标把 `className` 直接给 `<svg>`**：`el.className` 是 `SVGAnimatedString`（`.replace` 会炸），且 `.b3-list-item__graphic svg{}` 匹配不到 → 包一层 `<span className="b3-list-item__graphic">`。
- **密集列表行不要做 `:active scale()`**：28~40px 的行按压缩放会抖字、与滚动条抢空间（思源只给 hover 底色）。

### 工程 / 环境
- **hooks 必须在早退之前**：`SettingsPanel` 的 `if (!open) return null;` 之后全是普通函数，把 `useState/useEffect` 插进去 → "Rendered more hooks…" → **整个 React 树卸载**（`#root` 变空，长得像 GPU 崩溃）。
- **改 `electron/*.ts` 或 `src/core/*`（含 `syncDecisions.ts` 这类被主进程 import 的共享模块）→ vite-plugin-electron 重启 Electron → 命中未带 `--use-angle=metal` 的 GPU `exit_code=15`，整个 dev 实例被带走**。fresh `npm run dev` 一般不崩、**热重载才崩**。改完别再动主进程文件，或直接重启一次。
- **窗口被关掉 ≠ 进程退出**：`/json` 返回空数组但 Electron 还活着时，`open -a <Electron.app>` 触发 `activate` 会重建窗口。
- **`nohup` 起的 vite/vitest 会随 exec 会话回收而死**：dev server 必须 **tty=true 长驻**；测试直接前台跑（vitest 全量 ~3s）。
- **量 DOM 逐帧变化前必须解除后台节流**：窗口不可见时 rAF 一帧不跑、`setInterval(10ms)` 被节流成 ~1000ms（第一版数据因此全错）。解法：CDP `Emulation.setFocusEmulationEnabled{enabled:true}` + `Page.setWebLifecycleState{state:'active'}`，并用"10ms 定时器 1 秒跑了几次"自检。
- **别用跨进程往返做时序观测**：点击和采样要放在页面内**同一个 async 表达式**里，否则错过 <100ms 的中间态。
- **CSS `:nth-of-type` 数的是同类型兄弟**（含分组标题 div），不是"第 N 个列表行"；脚本里用 `rows[i].click()` 显式取索引。
- **`Page.reload` 之后 CDP `Input.dispatchMouseEvent` 可能点不动**（窗口非激活），`element.click()` 仍可靠；要测真实 hover/拖拽/剪贴板才用鼠标事件。
- **CDP 裸驱无需第三方库**：Node **v24 有内置 global `WebSocket`**（别用系统 node 18，会 `WebSocket is not defined`）；页面 target 在 `http://127.0.0.1:9222/json`。
- 压测真实云用一次性前缀 `lake-stress-<ts>/`，**结束必 `deletePrefix` 清场 + 复核 0 残留**；凭证只走环境变量、绝不入库。合成 `Readable` 流式 PUT 在七牛会大面积超时 → 测脚手架用字节 PUT。
- `better-sqlite3` 是 **N-API**（Electron/vitest/node 都能加载）；命令行查库：拷 `.sqlite3`+`.sqlite3-wal` 到别处用 `/usr/bin/sqlite3 -readonly`（app 在跑时读快照）。
- S3 `[perf]` 日志行尾数字是 **epoch 时间戳不是耗时**（旧坑，head 已移除）。
- 七牛：`ObjectStore.test()` 必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404）；正确配置 Endpoint `https://s3.cn-north-1.qiniucs.com`、Region `cn-north-1`、Bucket `local-lake-hebei`、`forcePathStyle=false`。
- 同步完成必须广播 `sync-progress`；`markSynced` 要同时改 `notes` 与 `tree_nodes.sync_state`；IPC 三处同步（`main.ts` handle + `preload.cjs` + `src/lib/native.ts`，preload 暴露名是 **`lakeNative`**）；多表写必须 `db.transaction`。
- 结束 electron 只能 kill 具体 PID，**禁 `pkill -f Electron`**（机器上还有 SiYuan/VSCode/Trae）。

## 5. 下一步建议（新会话）
1. 先跑 §6 门禁确认基线；有问题先测再改。
2. 当前待办见 **§3**（AI 接入 / 离线残余 / 移动端批次 / 技术债）。
3. 任何同步/GC 改动**先读** `AGENTS.md §3 #11/#12/#13/#15/#16` + `docs/SYNC-PROTOCOL.md` + `docs/S3-GC-DESIGN.md`，改前想清"声明是否仍全、被引用对象会不会被 GC 删、跨端自愈是否成立、复活路径在哪"。
4. UI 改动先看 `AGENTS.md §3 #14`（思源版式语法），别再造第四套类名、别写内联样式。
5. 移动端一律按 **§8**（`§8.0` 移动端/桌面硬隔离已解除——桌面与移动可自由改；仅 `src/b3/**` 思源 vendored 等共享/合规件仍须谨慎）。
6. **写任何 Lake 正文之前先读** `docs/LAKE-CONTENT-WRITING.md`：禁手拼媒体（裸 `<img>`）；无内核的主进程只写纯文本；写完用 `scripts/lake-roundtrip-check.mjs --note <id>` 对拍。
7. §3.6（小记是否挂 Lake 内核底座）与 §3.8（旧数据处置）都**等用户决定**：不要擅自大改小记，也不要擅自删/改数据。

## 6. 环境与命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"      # node 24（别用系统 node 18）
cd /Users/admin/file/local-lake/lake-notes-electron
# 门禁（合并前必过）
npx tsc --noEmit && npx vitest run && npx vite build && npx vite build -c vite.mobile.config.ts
git diff --check                                                # 空白错误（注意会报出移动端会话的文件）
# 开发（CDP 9222；改主进程/src/core 文件会重启 Electron 并可能命中 GPU 崩溃，见 §4）
npm run dev                 # = vite --host 127.0.0.1 --port 1421（vite-plugin-electron 拉起 Electron）
# 压测（opt-in，默认被 npm test 跳过）
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.benchmark.test.ts
LAKE_RUN_BENCHMARK=1 npx vitest run src/core/syncEngine.dualStress.benchmark.test.ts
# Tier B 真实云（隔离前缀+自动清理；凭证仅环境变量，勿入库）
LAKE_RUN_BENCHMARK=1 LAKE_STRESS_S3_ENDPOINT=... _REGION=... _BUCKET=... _AK=... _SK=... npx vitest run electron/syncStress.benchmark.test.ts
# 云端对象查看
node scripts/s3-ls.mjs --count | --note <id> | --prefix <prefix>
node scripts/lake-roundtrip-check.mjs --note <id>   # 对拍「这篇一打开会不会被内核改写」（只动副本，退出码 1=会被改写）
```
- **UI 实测姿势**：`curl http://127.0.0.1:9222/json` 拿 page target → Node 24 内置 `WebSocket` 直驱 `Runtime.evaluate` / `Page.captureScreenshot{clip}` / `Input.*`（本会话用这套量出了预览闪烁的逐帧数据）。详见 `docs/CODEX-GUIDE.md`。
- 日志：A `~/Library/Application Support/lake-notes-dev/logs/lake-notes.log`；B `$TMPDIR/lake-device-b/logs/lake-notes.log`。数据目录见 `AGENTS.md §5`（**正式数据禁碰**）。
- 安卓/模拟器：全部命令与环境见 **§8.1 / §8.9**。

## 7. 文档索引（`docs/` 按需查）
- **契约/规格（单一来源）**：`STORAGE-LAYERS.md`（存储分层 + 设备本地契约）· `SYNC-PROTOCOL.md`（同步协议 v4）· `S3-GC-DESIGN.md`（存储/删除 GC v4）· `HISTORY-DESIGN.md`（历史快照）· `TRASH-NOTEBOOK-DESIGN.md`（回收站）· `QUICK-NOTES-SPEC.md`（小记）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）· `LAKEX-MIGRATION-260916.md`（换源/懒加载/离线）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md` · `ANDROID-TECH-SCHEME.md` · `ASSET-URL-MOBILE-PLAN.md`。
- **近期简报/对账**：`CSS-LAYERS-BRIEF-260916.md`（UI 样式层）· `OFFLINE-ASSETS-AUDIT-260916.md`（离线清理对账）· `NARROW-UNIFY-BRIEF-260915.md`（窄窗统一）。
> 历史审计/研究/计划（`*-AUDIT`/`*-REVIEW`/`*-PLAN` 等）已删除（git 历史可查）；权威待办以本文件 §3 为准，移动端以 §8 为准。

## 8. 移动端（安卓模拟器 + 编辑器）专职交接（260908 收尾）

> **260920 晚更新**：移动端小记完善（不挂内核轻量框 / 图片草稿 / 系统分享 / 冷启动提速 / 用户可见名「新建小记」）本会话交接见 **§2.15**；本节其余内容仍是移动端长期基线。

> 本节是移动端（安卓模拟器 + 编辑器）交接：如何用**本机安卓模拟器**熟练验证移动端 UI/编辑，以及移动端任务的目标/已完成/遗留/坑。桌面 Electron 工作见 §0-§7。**注（260907）：原「只做移动端、别碰桌面」的硬隔离已解除**——现在桌面与移动可自由改动（见 §8.0）。

> **面向零上下文新会话——当前状态一句话（260908 收尾）**：移动端已完成**设置项收口** + **完整端**（历史快照列/恢复/删/24h去重/上限/定时、资源管理本地孤儿+云端GC、运行诊断）+ **大纲 viewer 跳转根因修复**（docs 高度塌陷）。主数据同步/编辑基础早已就绪（见 §8.4/8.5）。下一步见 §8.7（真机验收 + 数据导出/导入 + 剪贴板/资源URL）。本会话所有改动已提交 `master`（最新 `8e26910`）。
>
> **260910 更新**：移动端生产存储已切到 **Android native SQLite（WAL）**；`sql.js` 只保留为测试/一次性迁移验证实现。跨端同步端口已全部显式 `Promise`，共享 GC keep set、嵌套树契约、资源大小契约已锁定。最新分支已在 `emulator-5554` 安装并通过重启持久化与资源上限验证；见 git 历史。
>
> **更新的状态（2609xx 之后一个会话）**：又完成两块移动端大改——**编辑器底部工具栏**（修面板展开抖动、命令生效高亮、+/Aa 展开变 ×+震动、去冗余完成钮）与**首层首页重做**（小记卡片、知识库书架/列表+最近文档、底部栏[搜索|新建|云同步]、tab 滑入动效），并修**最近文档/搜索直达**、**第二层底栏滚动隐藏/显示**，且**按用户决策删除知识库排序**（改用共享 sort_order=桌面顺序）。**这批未提交**。

### 8.0 移动端注意（原「移动端铁律」已降级为注意项，260907 用户明确解除硬隔离）
- **桌面与移动已可自由改动**（不再限定 `src/mobile/**`；当前无并行会话，不会有提交冲突）。仍请谨慎：`src/b3/**` 是**思源 vendored 组件（AGPL-3.0）**、`src/features/editor/lakeRuntime.ts` 等是**两端共享模块**，改动前先确认影响面；`electron/`、`src/main.tsx` 改动会触发 vite-plugin-electron 重启 Electron（见 §4 踩坑）。
- 移动端设置/浮层 UI 受 `AGENTS.md §3 #14` 约束：用思源 vendored b3 类，**禁内联样式**（`style={{...}}`）。
- **移动端数据在安卓模拟器 App 沙盒（`com.lakenotes.mobile`）里，不是 macOS 的 `lake-notes-dev`**。开发数据可 `adb shell pm clear com.lakenotes.mobile` 整体重建（`seed_initialized` 会重新种子"个人笔记"笔记本）。
- Node **24** 必须：`export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`（别用系统 node 18）。安卓相关 JAVA/SDK 环境**脚本里已内置，不用手动 export**。

### 8.1 安卓模拟器使用（本机 AVD `lake_mobile`，pixel_6 / API36 / arm64）
**一键脚本**（都在 `scripts/`，环境变量自备，直接跑）：
| 场景 | 命令 |
|---|---|
| 启动模拟器并等开机 | `bash scripts/emu-up.sh`（纯 CDP/远程会话用 `--no-window`） |
| 构建+同步+安装+启动 App | `bash scripts/android-build.sh --sync --install` |
| 把 App WebView 转发到本地 CDP | `bash scripts/emu-cdp.sh`（默认端口 9335） |
| 不起模拟器、浏览器里速测移动 UI | `bash scripts/mobile-preview.sh`（`http://127.0.0.1:1422/preview.html`，390×844 手机框） |

- AVD 名 `lake_mobile`；SDK 在 `/opt/homebrew/share/android-commandlinetools`；gradle 复用缓存 `~/.gradle/wrapper/dists/gradle-8.14.3-bin/.../gradle`（公司网络下不了 distribution，**别走 wrapper**，脚本已指好）。包名 `com.lakenotes.mobile`；`adb` 在 SDK `platform-tools`。
- `npm run dev`（桌面）与移动端无关；移动端构建= `vite build -c vite.mobile.config.ts` → `dist-mobile/`。

**CDP 自动化驱动（本会话验证过的可靠方式）**：
1. `bash scripts/emu-cdp.sh` → 本地 `tcp:9335`。**注意：App 每次重启/导航后 WebView socket 会变**，`/json/list` 可能连不上旧 socket——用 `adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9a-f]+" | sort -u` 找所有 socket，逐个 `adb forward tcp:9335 "localabstract:$s"` 后 `curl -s http://127.0.0.1:9335/json/list` 校验 `type=="page"`，命中即 break。
2. 程序：`const list = await fetch("http://127.0.0.1:9335/json/list").then(r=>r.json())`，取 `type==="page"` 的 `webSocketDebuggerUrl`。
3. 连 WebSocket，`Runtime.enable`，用 `Runtime.evaluate`（`returnByValue:true, awaitPromise:true`）执行任意 JS 驱动/断言。
4. **触摸（触发键盘/IME）**：`Input.dispatchTouchEvent {type:"touchStart",touchPoints:[{x,y}]}` → 延时 ~70ms → `{type:"touchEnd",touchPoints:[]}`，再对 contenteditable `.focus()`。
5. **打字**：`Input.insertText {text}`；**选中文本**：`document.createTreeWalker` 找文本节点 + `Range.setStart/setEnd` + `sel.removeAllRanges();sel.addRange(r)`。
6. `window.__mobileEditor` 暴露当前活跃文档的 Lake 编辑器实例，用于 `renderer.execCommand`/`queryCommandEnabled`（比查 DOM 可靠）。

### 8.2 Lake 编辑器命令名（移动端用 `renderer.execCommand`，命令名与桌面 toolbar 不同）
- **有效**（`queryCommandEnabled`=true）：`bold`、`unorderedList`（列表！）、`orderedList`、`taskList`、`quote`、`code`、`underline`、`italic`、`insertLink`、`hr`、`color`、`style`（块级，传 `"p"/"h1"/"h2"`）、`undo`/`redo`。
- **无效**（no-op/返回 false，别用）：`insertUnorderedList`、`formatBlock`、`heading`、`setHeading`、`insertBulletList`、`strike`/`strikethrough`、`justifyLeft/Center/Right`、`clearFormat`、`fontsize`。
- **命令生效前提**：需要真实 caret/选区在文本块里——`bold` 先选中文字；`style "h1"`/`unorderedList` 需 caret 在段落里。**命令名写错/焦点丢了 = 点了没反应，还会疑似"正在下载"。**
- 渲染 DOM（验证用这些选择器）：列表=`ne-uli-i`/`ne-uli-c`/`ne-tli`（**不是** `<ul>/<li>`）；加粗=`ne-text` 且 `font-weight:700`（**不是** `<strong>`）；标题=`ne-h1`/`ne-h2`。

### 8.3 编辑器 Dock 键盘/面板机制
- `src/mobile/useKeyboard.ts` 返回 `{ base, innerHeight, offset, height, keyboardOpen }`。`base`=键盘收起满高度（max innerHeight）；`innerHeight`=当前；`offset`=edge-to-edge 上移量（adjustResize=0）；`height`=键盘实际高；`keyboardOpen=height>8`。
  - 模拟器是 **adjustResize**（键盘弹 `innerHeight 842→530`，`offset=0`，`bottom:0` 元素天然在键盘上方）；真机可能 **edge-to-edge**（`offset>0` 需上移）。两模式都被覆盖。
- `src/mobile/editor/EditorDock.tsx`：`if(!editing) return null`。工具栏 8 钮：`[+]插入 [Aa]字体 [B]加粗 [列表]unorderedList [任务]taskList [...]字体 [键盘]切换 [√]完成`。
- **工具栏 `--kb-offset`（bottom 基准）**：面板开时 `usable = Math.max(0, innerHeight - base + panelHeight, offset)`；无面板 `usable = offset`。作用：键盘收起 `innerHeight 530→842` 全程工具栏屏幕 Y **不跳**；`max(…, offset)` 兜底 edge-to-edge 真机（键盘回弹瞬间工具栏实时抬到实测键盘上方）。CSS：工具栏 `bottom: var(--kb-offset)`（**无 transition**——对 resize 中的视口做动画会把一帧错位放大成抖动）；面板 `bottom:0; height:var(--kb-offset)` 占键盘区（**有 `box-sizing:border-box`**，塌缩到 0 时不会剩 padding 细条）。
- **面板⇄IME 硬互斥兜底（260911 新增，EditorDock guard effect）**：Lake 命令（hr 等）执行后**内核会异步重聚焦 contenteditable → 输入法弹回**，面板开着时会把面板压扁盖住工具栏（用户三次报此现象，260911 定位到真因）。兜底：`useEffect` 监听 `panelMode && keyboardOpen`（实测键盘状态驱动）→ `setPanelHeight(max(h, height))` + `blurActiveEditable()` 再压回。**任何机型/输入法通用**，因为依据是 visualViewport 实测而非输入法假设。
- **焦点/键盘**：`onMouseDown={(e)=>e.preventDefault()}` 加在 `.med-toolbar`/`.med-panel` 上，**防按钮抢走编辑器焦点**（否则键盘关、caret/选区丢→命令 no-op）。`runInline`（工具栏）= 仅 `exec`；`runPanel`（面板项）= 仅 `exec`，**都不要调 `focusEditor`**。
- 面板开关：开=`setPanelHeight(max(round(height),280))` + `setTimeout(()=>blur(),0)`（提 IME、占住键盘区）；关=`setPanelMode(null);setPanelHeight(0); focusEditor()`（自动恢复键盘）；`收起键盘/显示键盘` 切换。

### 8.4 任务主线（用户定位：移动端=完整端）
用户把移动端定位为**完整端**（大平板轻办公趋势，可能长期只用移动端），要求对齐桌面端的体验与逻辑（AGENTS §3 红线全适用）。
**近期主线（260908 本会话，已全部完成）**：
1. **设置项收口**：移除 `showToolbar`/`showToc`；设置项加 `platform` 标记（桌面专属/移动专属/两端）；设置版式原语抽共享 `settingsPrimitives.tsx`。
2. **移动端完整端**：历史快照（列/恢复/删除/去重/上限/定时自动快照）、资源管理（本地孤儿检测+清理、云端 GC）、运行诊断。
3. **大纲 viewer 跳转根因修复**：编辑器滚动容器塌陷（`.mobile-workspace-body` 非 flex → doc 高度 0）。

**更早（260904，移动端编辑器核心）**：面板闪烁/堆叠、命令名错、焦点/键盘、`--kb-offset` 稳定（见 §8.2-8.3 机制）。

### 8.5 已完成（本会话 + 早前，按领域组织；全部已提交 master）

**编辑/会话基础（早前）**：多 tab+左右抽屉、设置竖向菜单+子页、移动精仿思源样式、seed 数据、keep-alive 性能、settings 重构、`useKeyboard`/`EditorDock`/`editor-dock.css`（命令名、焦点/键盘、`--kb-offset` 稳定）。

**设置收口（260908）**：移除 `showToolbar`/`showToc`（AppSettings schema + 桌面/移动 UI + settingsSearch 全清）；`SettingItemEntry.platform`（desktop/mobile/both）+ `isSettingVisibleFor` 助手；桌面专属项标 `platform:desktop`（快捷键/历史/GC/备份/日志/关于详情）；设置版式原语抽 `src/components/settingsPrimitives.tsx`（桌面 `SettingsPanel` + 移动 `SettingsDrawer` 共用，对齐思源"内核+薄前端"分层）。

**移动端完整端**：
- **历史快照**：`listNoteHistory`/`restoreHistory`（恢复前先给当前正文留档=可反悔）/`deleteHistory`/`cleanupHistory`（共享 `selectHistoryDrops` 分层保留+上限+保留天数）/`snapshotNote` + **24h 去重**；`HistoryMobileSettings`（maxSnapshots/retentionDays/cleanupIntervalHours/snapshotIntervalMinutes，存 device_state）+ 设置「历史」视图 + MobileApp 定时器（`snapshotIntervalMinutes` 周期快照）；目录树长按「历史版本」sheet。
- **资源管理（本地）**：`orphan_assets` 表 + `detectOrphans`（保存登记未引用资源，含历史 refs 保护）+ `listLocalAssets` 跳过孤儿（**删图不再重传**）+ list/delete/clean API + 设置「资源管理」视图。
- **资源管理（云端 GC）**：`S3Store` 扩 `listObjects`/`deleteMany`；共享 `src/core/gcDecisions.buildGcKeepSet`（含 `extraManifests` prev 链引用保护，+单测）；`s3_gc_pending`/`s3_gc_log` 表 + add/remove/list/record；`syncNow` 加 `onPublished` 钩子（新 manifest 不再引用的旧正文/资源→登记待回收，full key）；`gcDeepCleanup` double-anchor 窗口 + 删除写 gc 日志 + 设置「云端清理」按钮。
- **运行诊断**：`getDiagnostics`（文档/分组/小记/资源/孤儿/待回收/快照数+库大小）+ 关于页「数据诊断」区块（移动端无桌面日志文件，此为「关于/日志」等价）。

**其他**：标签保持（localStorage 记上次打开标签 + `maxOpenTabs` LRU 淘汰）；工作区改标题；插入面板纯图标；小记缩略图批量（`listQuickNotes` 一次返回 `firstImage`）；目录树长按管理（重命名/图标/移动/删除）；**大纲 viewer 跳转根因修复**（`.mobile-workspace-body` 加 flex + `.doc-pane` flex:1，编辑器滚动容器恢复）+ `OutlineSheet.jump` 补 DOM 校正。

**lakeNative 暴露（调试契约）**：listOrphanAssets/cleanOrphanAssets/deleteOrphanAsset/gcDeepCleanup/listNoteHistory/restoreHistory/cleanupHistory/getHistorySettings/saveHistorySettings/snapshotNote/getDiagnostics。

门禁：`tsc` 0 · `vitest` 838 通过/15 跳过 · desktop `vite build` + 移动 `vite build -c vite.mobile.config.ts` 全绿 · `android-build.sh --sync --install` 过。

**（2609xx 后续会话，未提交）编辑器工具栏 + 首层首页 —— 见 git 历史**：
- **编辑器工具栏**（`EditorDock.tsx`/`editor-dock.css`）：面板展开抖动修复（`--mobile-dock-space` 由动画 `usable` 驱动，正文区恒 436px）；命令生效高亮（mark 用 DOM 计算样式、块级用 `queryCommandState===1`）；+/Aa 展开变 ×（`med-open`）+ 触感；去底部冗余"完成"。
- **首层首页**（`HomePage.tsx`/`NotebookGrid.tsx`/`mobile.css`）：小记卡片；知识库书架（白卡+线条图标）/列表 + "最近文档"；右上书架↔列表；底部栏[搜索|新建|云同步]；tab 滑入动效；空态不提示创建。
- **其它**：最近文档/搜索/新建直达文档（`NotebookWorkspace` 的 `initialNoteId` 优先）；第二层底栏滚动隐藏/显示；**删除知识库排序**（改用共享 sort_order=桌面顺序）；最近文档简约样式 + 书架默认线条 `BookOpen` 图标。

**（260911 本会话新增，提交 a18a95b）安卓 AssetServer + Dock 竞态 —— 见 git 历史**：
- **AssetServer token 语义对齐桌面**：仅 CORS（带 Origin）校验 token，no-cors（`<img>` 等）放行，外部 Origin 仍 403；修 no-token canonical URL 403 → 图片空白（87e4642 的过度限制）。`+3` 单测（`AssetServerTest`）。
- **Dock 面板⇄IME 硬互斥**（guard effect + panelHeight 跟踪实测 + border-box + usable max(offset)），模拟器实测 0 遮挡。
- **实验痕迹清理**：12 条实验笔记 UI 删除→purge→三端 purged=true。

### 8.6 当前问题 / 未决（需用户真机给现象）
1. **大纲 viewer 跳转 —— 已修复，但待长文档真机验证**：根因（`.mobile-workspace-body` 非 flex → doc 高度塌陷 0）已修复（e95ec6f，实测 doc 高 0→794）。**但**完整"点击大纲标题滚动到位"未端到端验证——因为**用测试文档造不出 Lake 可接受的高内容**（`ne-p`/`ne-h1` 格式不被编辑器接受，渲染成短内容），这是测试固件问题非 bug。**用真实长文档（正确内容格式）点大纲标题确认**。若仍不滚，给现象。
2. **"正在下载"从未复现**（MutationObserver 实时抓也没有）——判断是编辑器初始化瞬时态/旧命令报错后遗症，修复后未见。**若真机仍见，要截图或位置**。
3. 命令在**被改乱的段落**上可能不生效（caret 落标题/边界时 list 0→0）——编辑器 caret 语义，非命令 bug；干净段落正常。
4. **剪贴板粘贴不解析为空**（§3.6-3.8 遗留）：静态线索=移动端入口没挂 `installPasteInterceptor`；android worktree 已补挂，先沿那条线验证。
5. ~~**本地资产 canonical `http://127.0.0.1:19876/{noteId}/{file}` 真机不可达**~~ **✅ 已解决（260911）**：安卓端 `AssetServer.java` 让 canonical URL 在本机可达，403 过度限制已修，模拟器实测编辑器内图片正常渲染。`adb reverse tcp:19876 tcp:19876` 仅宿主机浏览器调试时需要。
6. 用户"移动端整体编辑还有问题"现象未细化——**真机反馈给具体现象再定位**。
7. ~~**首层首页 + 编辑器工具栏改动未提交**~~ **✅ 已提交**（a752f2a，260911 前批次）。
8. **首层"最近文档"= 最近*更新*代理**：非"最近打开"；对用户说清后可再加 `last_opened_at` 追踪。
9. **知识库排序已删除**（用户决策，不再做）：手机端不再写本地 `sort_order`，展示共享顺序 = 桌面端顺序。若日后想"每端独立顺序"，需改同步协议（manifest `folders[].sortOrder`），属红线区、须谨慎。
10. **首层新 UI 真机确认项**：书架白卡+线条 `BookOpen` 图标（已去彩色/红 emoji）；最近文档极简 icon+标题（已去灰底）；顶部排序按钮仅小记显示；知识库右上角为书架↔列表切换。

### 8.7 下一步（移动端，按优先级）
0. **（最新）真机（小米）验收 260911 双修复**（模拟器已实测通过，真机待验）：① **图片/附件插入后立即显示**（AssetServer no-cors 放行修复，此前上传后空白 403）；② **编辑态工具栏不被面板/键盘盖住**（插入分割线→回车复现路径）；③ 同步后图片加载。注意真机很可能是 **edge-to-edge 模式**（与模拟器 adjustResize 不同），兜底已覆盖但值得盯一下。
1. **真机验收本会话交付**（历史/资源/GC/设置/大纲）：重点用**真实长文档**验证①大纲跳转滚动②资源管理（删图不再重传、孤儿清理、云端 GC）。
2. **整库备份/云端恢复**：桌面走「文件系统拷贝 + 应用重启」；移动端数据在沙盒（native SQLite + Capacitor FS，无 workspace 目录），架构不匹配——需另做「**数据导出/导入**」（导出 DB 快照 + 资产清单到文件）。当前已有「运行诊断」统计。
3. **定时自动快照真机验证**：`snapshotNote` 复用 `createHistorySnapshot`（已带 24h 去重）；**移动端模拟器 app 生命周期可能不触发 `setInterval`**，需前台运行验证。
4. **剪贴板粘贴真机验证**（§8.6.4）：沿 android worktree `installPasteInterceptor` 线索。
5. **资源 canonical URL 真机可达**（§8.6.5）：`adb reverse tcp:19876 tcp:19876`。
6. **大纲 viewer 跳转**（§8.6.1）：长文档确认。

### 8.8 移动端踩坑（本会话新增）
- **`insertUnorderedList` 不是 Lake 命令**：`unorderedList` 才对；命令名错=静默 no-op/疑似"下载"。
- **点 dock 按钮会抢走编辑器焦点**：键盘关、caret/选区丢→命令失效。解法：容器 `onMouseDown={e=>e.preventDefault()}`。
- **面板项别调 focusEditor**：`renderer.execCommand("focus")` 重开 IME→叠成"工具栏-面板-键盘"3 层；面板项只 `exec` 不聚焦。
- **别在 setState updater 里 blur**（键盘有时仍开着）；blur 挪到 `setTimeout(0)` 外。
- **工具栏 `transition: bottom` 有害**：它在对"正在 resize 的视口"做动画（键盘收起 `innerHeight 530→842`），把本来稳定的一帧错位放大。改 `--kb-offset=innerHeight-base+panelHeight`（屏幕 Y 恒定）并删 transition。
- **adjustResize vs edge-to-edge**：模拟器 adjustResize（键盘弹 `innerHeight` 变小、`offset=0`）；真机 edge-to-edge（`offset>0` 上移）。用 `height>8` 判键盘开、`offset` 区模式。
- **测试污染**：往文档打字/改格式会改脏 doc → 后续 caret 不可靠（list 0→0）。验证命令用**新建干净文档**（`window.lakeNative.createNote(name,'notebook-personal')`），别在已改过的 PRD/文档上测。
- **模拟器 `.click()` 无 mousedown**：测不了 `preventDefault` 焦点路径；`Runtime.evaluate` 里 `element.click()` 测逻辑，真实 preventDefault 要真触屏/真机。
- **模型看不了图**：`read_image` 失败（模型不声明图片输入）→ 用 DOM/computed style/`getBoundingClientRect` 量测代替截图。

**（260908 本会话新增）**
- **`.mobile-workspace-body` 必须显式 `display:flex`**：它 `flex:1`（高度来自父 flex）但非 flex 容器，`.doc-pane`/`.mobile-doc-body` 的 `height:100%` 在其中**塌陷为 0** → 编辑器无滚动容器 → 大纲跳转/长文滚动失效。修：workspace-body `display:flex; flex-direction:column` + doc-pane `flex:1; min-height:0`。
- **Lake 内容格式 ≠ 裸 HTML**：测试文档别用 `<h1 class="ne-h1">`/`<p class="ne-p">`（编辑器不认，渲染成短内容、无真实标题）。要用**应用内真实生成的 Lake 内容**（或从真实文档读 content 再改）做高度/跳转测试，否则测不出滚动。
- **`S3Store` 接口（共享 `src/core/syncEngine.ts`）扩 listObjects/deleteMany 是可选方法**（`?`）：桌面 `createS3StoreAdapter` 没实现也不报错（GC 用 legacy `electron/sync.ts` ObjectStore）；移动端必须实现才能云端 GC。
- **GC key 带 prefix 一致性**：移动 `listObjects` 返回 **full key**（含 `{prefix}/`），而共享 `buildGcKeepSet`/`collectManifestRefs` 返回 **无 prefix 的 key**——`buildGcKeepSet` 里统一 `keep.add(prefix + "/" + ref)`；`onPublished` 钩子里 `addS3GcPending` 也要传 full key（`${prefix}/${objectKey(...)}`），否则与 `gcDeepCleanup` 的 full-key listing 对不上。
- **`selectHistoryDrops` 是共享函数**（`src/core/storeUtils.ts`）：桌面 `cleanupHistory` 与移动 `cleanupHistory` 共用同一分层保留逻辑；移动端 note_history 无 `protected_until` 列，不涉及桌面那种"冲突归档保护期"。
- **设置项加/改必须同步 settingsSearch 注册表**（AGENTS §3 #14）：新增 `itemId`（如 resources-clean、history-*、appearance-theme）若只在移动端（无搜索），不入 SETTING_ITEMS 也不报错；但**桌面**新增的设置行必须入 SETTING_ITEMS，且 `vitest src/components/settingsSearch.test.ts` 会卡漂移。

**（260908 移动端 UI 对齐思源批次新增）**
- **CSS 层叠顺序坑（同一类被两套定义打架）**：`mobile.css` 由 `MobileApp.tsx` import，注入顺序**早于** `main.tsx` 里的 `src/b3/siyuan.scss` ⇒ 覆盖 `.b3-*` 的选择器必须比思源本体更具体（`.b3-menu.ln-sheet`、`.b3-button.ln-confirm__danger`），否则被反向压过（本次 danger 按钮不红、sheet 高度不生效都是这个原因）。
- **border-box 语义差异**：思源 `_mobile.scss` 的 `.toolbar__icon{width:20px;padding:10px}` 是 content-box 思路；本项目全局 `* { box-sizing: border-box }` ⇒ 照抄会让内容盒塌成 0（图标 0×18 不可见）。移植时写成"总尺寸 = 图标 + 2×padding"。
- **harness 截图假象**：Electron 窗口被遮挡时 transition 会**冻结**，`Page.captureScreenshot` 截到"半开的面板/半屏抽屉"，看着像布局 bug 其实是合成层没画完。解法：截图前注入 `*{transition:none!important;animation:none!important}`（本会话 harness 已内置）+ `Page.bringToFront` + `Emulation.setFocusEmulationEnabled`；另：`mobile:true` 的设备模拟会按 visual viewport 缩放，截图请用 `mobile:false, deviceScaleFactor:2`。
- **同一文档不允许两种壳**：`DocumentPage`（顶栏 4 图标）与 `NotebookWorkspace`（底部栏+抽屉+手势）并存 ⇒ 从首页/搜索打开的文档没有抽屉和守卫。统一后 `openNote()` 一处判定（`isGoneNote`），别再加第二条打开路径。
- **删除文档必须连带关标签**：`applyDelete` 里 `closeTab(node.id)`，否则回收站文档仍留在 tab 里可继续编辑（AGENTS §3 #16 的移动端形态）。

**（2609xx 首层 + 工具栏本会话新增）**
- **lakex `queryCommandState` 对 mark 命令恒返回 `-1`**（0=无效/1=生效/-1=不确定）：用 `!!v` 会把 -1 当"生效"→ 恒误亮。**行内标记生效判定改用 DOM 计算样式**（font-weight≥600 / font-style / text-decoration / code）；块级（quote/列表/待办/undo/redo）用 `queryCommandState === 1`。
- **`--mobile-dock-space`（正文底部留白）别用固定 `panelHeight + 工具栏`**：点开面板瞬间面板还没显形、键盘还开着，留白猛增 280 → 内容区先压扁再弹回（剧烈抖动）。要**用动画中的 `usable`（= `--kb-offset`）驱动**（`留白 = usable + 工具栏`），内容区才全程恒定。
- **`<button>` 默认有浏览器按钮底色 `#efefef`（灰）**：首层最近文档卡、任何"纯图标 button"要设 `background:transparent; border:none`，否则灰色露出来（本会话"最近文档灰底"就是这么来的）。
- **显式打开某文档（最近文档/搜索/新建）时 `initialNoteId` 会被"恢复上次标签"覆盖** ⇒ 打开错文档。修：`NotebookWorkspace` 启动改"显式 `initialNoteId` 优先打开并置为活动，再补开其它已存标签"。
- **emulator CDP socket 随 App 重启变化且 forward 常连不上**：先 `adb forward --remove-all`，再 `adb shell cat /proc/net/unix | grep -oE "webview_devtools_remote_[0-9a-f]+"` 找新 socket，`adb forward tcp:9335 localabstract:$s` 后 `curl /json/list` 校验（多轮重试 + 等 App「Displayed」后再连；用 `adb forward --list` 核对）。
- **知识库 `sort_order` 是共享字段**（manifest `folders[].sortOrder`，跨端同步）：跨端改会互相影响。用户已**决定不做**知识库排序（手机端不写本地 sort_order，展示共享顺序）；以后别再加回，除非先讨论同步语义（红线区）。
- **触感 `navigator.vibrate` 经 CDP 观测不到**：需真机/模拟器手动确认。

**（260911 同步收敛 + AssetServer + Dock 竞态新增）**
- **跨端平台代码先读对端实现再写**：安卓 AssetServer 当初对所有请求强制 token（87e4642），而桌面只对 CORS 请求校验——语义漂移直接造成「上传后图片全 403」。安全语义（token/Origin）两端必须逐字节对齐。
- **Lake 命令执行后内核会异步重聚焦 contenteditable**：面板开着时 IME 会被顶回。不要试图枚举谁在重聚焦（lakex 闭源），用**实测键盘状态兜底**（`panelMode && keyboardOpen` → 再 blur）；`panelHeight` 是打开瞬间的快照，真机输入法带候选条/工具条会更高，必须跟踪实测最大值。
- **`.med-panel` 的 `height:calc(var(--kb-offset))` 必须配 `box-sizing:border-box`**：否则塌缩到 0 时剩 27px padding+border 细条，压在工具栏下半截（就是用户截图里的「工具栏被弹窗盖住」）。
- **adjustResize 下「面板展开 + IME 弹回」的可视症状**：窗口 842→530、`--kb-offset`→0、面板变细条——看到的不是「键盘盖住工具栏」而是「面板细条盖住工具栏」，别误判成 z-index 问题。
- **`listNoteSummaries()` 没有 `trashedAt` 字段**（返回 id/title/parentId/sortOrder/updatedAt/syncState/isConflict/isLocked/lockedAt）：判定「回收站/活跃」必须用 `listTrash()` 的条目（含 `purged`/`deletedAt`）。本轮验证脚本两次因此误判「删除失败」。
- **桌面实例会占宿主机 19876/19877**：`adb reverse tcp:X tcp:19876` 想从宿主机 curl 安卓 AssetServer 时，请求会被宿主 Electron 的 asset server 截胡（404/语义不同）——先 `lsof -nP -i :<port>` 确认宿主端口归属，换冷门端口。
- **`adb kill-server` 后 reverse 规则可能注册了但监听没真正建立**（curl 000）：重启 adb server 后重建 forward/reverse，再 `lsof` 核对监听。
- **CDP 复现 IME 竞态的假象**：物理 `input tap` 后 `userTappedEditorRef` 可能残留 true（目标已聚焦时不再触发 focusin 消费）→ 程序化点击面板命令会把面板关掉，与真实用户路径不同。验证 IME 用 `dumpsys input_method | grep mInputShown` 当事实源；测兜底可直接 JS `el.focus()`（CDP 的 focus 足以唤起模拟器 IME）。
- **模拟器 headless 实例复用坑**：`emu-up.sh` 检测到已跑实例就复用；前会话 `--no-window` 启动的实例会让用户「看不到界面」。处理：`adb emu kill`（优雅关，AVD 数据不丢）→ 重跑脚本（默认带窗口）。

### 8.9 移动端常用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /Users/admin/file/local-lake/lake-notes-electron
npx tsc --noEmit                                             # 类型检查
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts   # 移动 bundle→dist-mobile
bash scripts/android-build.sh --sync --install               # sync+gradle+adb install+launch(com.lakenotes.mobile)
bash scripts/emu-cdp.sh                                      # 转发 WebView→tcp:9335（测 UI 前必跑）
bash scripts/emu-up.sh                                       # 启动模拟器（无窗口 --no-window）
bash scripts/mobile-preview.sh                               # 浏览器预览 http://127.0.0.1:1422/preview.html（需先 build）
# UI 走查（本会话用这套，比模拟器快得多；harness 脚本暂在 /tmp/lkm，待入库 scripts/）
node node_modules/vite/bin/vite.js -c vite.mobile.config.ts --host 127.0.0.1 --port 5173   # 移动 bundle dev（HMR）
./node_modules/.bin/electron --remote-debugging-port=9223 /tmp/lkm                          # 390×844 Chromium 壳
node /tmp/lkm/cdp.mjs --shot /tmp/lkm/x.png '<js>' ; node /tmp/lkm/walk.mjs steps.json      # 裸 CDP 求值/批量走查截图
adb shell pm clear com.lakenotes.mobile                      # 清 App 数据重建种子（dev 才做）
```

### 8.10 目录树交互对齐思源：桌面 ⋯＋ / 移动端 ⋯＋ + 长按拖拽（260912）
- **桌面**：每行 ⋯（竖向 lucide-ellipsis-vertical，= 右键菜单，弹出位置在按钮处）+ ＋（= 新建子文档）。动作默认 display:none 不占宽度（不逼标题缩略），行 hover/选中/聚焦才显形，此时标题才 ellipsis 截断让位；着重色只给光标所在的那个按钮。对齐思源 .b3-list-item__action / more-root / new（见 siyuan-master/app/src/layout/dock/Files.ts:1448-1451）。
- **移动端**：行内 ⋯ + ＋ 常显（触屏无 hover；对齐思源移动端 MobileFiles.ts:1505-1509——移动端行 class 不带 --hide-action）。⋯ → setMenuFor（现有 MobileSheetMenu）；＋ → 弹「新建文档 / 新建分组」再建（bridge.createNote / bridge.createGroup）。标题 min-width:0 + ellipsis 防超长名盖住按钮。
- **长按拖拽排序**：长按 350ms 进入拖拽（haptic），长按不再弹菜单（菜单交给 ⋯）；document 级 touchmove 跟手位移，用 elementFromPoint + 落点比例（<28% before / >72% after / 中间 inside）定落点，视觉 .nb-dragging / .nb-drop-before|after|inside；松手：同父 → bridge.reorderSiblings，跨父/拖入分组 → bridge.moveTreeNodeOrdered。真机实测：把「安卓上行-2」拖到「安卓上行-1」前，顺序生效。
- **已补齐（ed87eb7 / 9d78e6a）**：① 边缘自动滚动——手指进入面板上/下 64px 内，rAF 循环滚动；② 其他行让位——源行到落点之间的行整体上/下移一个行高；③ 拖起行 pointer-events:none，elementFromPoint 穿透到下层行，落点判定稳定；④ 落点线照搬桌面专做的那套（drop-line-before/after 伪元素画 2px accent 线 + soft 光晕；拖入分组 drop-parent），替换原 nb-drop-* box-shadow 方案。真机合成拖拽复验：第 3 行拖到第 1 行前顺序生效。

---
