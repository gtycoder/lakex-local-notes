# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接（261007 → 261006）

> 写给完全没有上下文的新会话。接手顺序 **README → HANDOFF → AGENTS**。**本节只保留最新 1–2 批（261007 / 261006）**；更早的 dated handoff 已删除，只在 git 历史可查（`git log -p --follow HANDOFF.md`）。文中提到的「专项文档」= 已删除的 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`。**真正的待办看 §3，长期坑看 §4，移动端看 §8。**

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
3. **UI 低优先**：目录树窗口化（先量到真实卡顿再立项）·设计词表继续裁剪。~~画板 `Wt is not a function`~~ **已修复**（`6b901bb`：移除 rolldown drawnix codeSplitting，生产构建画板崩溃；vite.config.ts 有注释）。
4. **移动端剩余**：真机验收、数据导出/导入、粘贴与资源 URL、长文档大纲跳转；详细步骤见 §8。
5. ~~**搜索整体重构**~~ **已完成**（`984ccbc` 统一 FTS5+unicode61+CJK 单字预分词+增量账本、`d5ed6c0` 移动端纯文本源+拉丁前缀+多命中定位、`4fea72b` 设置页重建索引、`820305b` 标题-only upsert 保正文索引）：桌面/移动共享 `src/core/search/`。**剩余为可选增强（非缺陷）**：移动端索引源改 `getDocument("text/plain")`；拉丁子串检索（加 3-gram 列）；小记搜索（二期）；命中定位仍是 DOM 启发式（lakex 无公开查找 API）。
6. **历史快照恢复为新文档**：用户已明确先不做；恢复入口仍只覆盖当前文档，恢复前自动留档。
7. **低优先数据/性能**：附件哈希缓存仅在真实痛感出现后立项；回收站惰性下载暂缓；Word/PDF 大附件与历史 `lakex-contract.d.ts` 按需处理。
8. **已知外观**：离线残余资源、移动端缩略图仅覆盖 png/jpg/jpeg（失败回退原图）、多维表附件旧数据的体积展示边界。

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
14. **表格（FortuneSheet）暗色模式 —— 用户 261006 立项，本会话不做**：FortuneSheet **无主题 API**，单元格区是 canvas 硬编码白底（内核源码 `if (bg == null) bg = "#ffffff"`）、默认字色 `defaultStyle.fillStyle=#000`、网格线 `#dfdfdf`、行列头字 `#5e5e5e`；DOM 外壳（工具栏 / 行列头 / 工作表标签 / 公式栏 / 容器）是硬编码浅色、可 CSS 覆盖。可选做法：**A** 只覆盖 DOM 外壳（低风险，但单元格仍白）；**B** 渲染层给缺省格补暗底 / 亮字、**保存前剥除**（真暗，但需解决「剥除口径 / 主题热切换 / 撤销栈」三件事）。推荐 A 先落、B 单独立项。详见 git 历史。
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
- **要「仿照云端」时，优先读云端前端资源而不是一个个点 UI**（260929 用户提示，已实践）：`bsk evaluate` 里 fetch `performance.getEntriesByType('resource')` 找到 `gw.alipayobjects.com/**/lakex_table_yq.*.chunk.css|.async.js`（CORS 可读），配置表/样式规则直接 grep 就有（如统计项的 types 限制、占位 hover 规则）；点 UI 只用来交叉验证。
- **用户可能与测试实例共用同一个进程/窗口**（260929 用户明确交代）：我起的隔离实例（LAKE_USER_DATA=$TMPDIR/lake-accept + LAKE_RENDERER=scheme）用户会**直接在同一个窗口里看/操作** ⇒ **不要默认 kill 实例、不要 rm -rf 该 userData**（那是他正在看的数据）；只有用户明确说「清理/重建」时才收尾。同理，验证脚本不要顺手删掉自己建的测试笔记。
- **读落盘要轮询**：自动保存有防抖，改完立刻读会拿到旧值。
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

### 当前剩余验收
- V1 空库多端同步：创建/编辑/删除/恢复/GC。
- 真机：图片与附件、编辑保存、同步后图片加载、键盘安全区。
- 数据导出/导入、剪贴板粘贴、长文档大纲跳转。
- 缩略图目前仅 png/jpg/jpeg，失败会回退原图。
- ~~多维表只读控件（布尔/链接/评分/进度/关联/时间）~~ 260929 已在模拟器验收；真机复验仍可做。
