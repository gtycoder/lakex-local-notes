# HANDOFF.md — Lake Notes 项目交接（唯一权威交接文档）

> 写给**完全没有上下文的新会话**。接手顺序：**README → HANDOFF → AGENTS**；之后按需读相关 `docs/`。AGENTS 是长期红线/机制/坑，每次自动加载。
> **本文件只保留「最新 §0（1–2 节）+ 当前基线 / 真正的待办 / 有价值的坑」。**
> 所有历史 dated handoff（旧 `§0 <日期>` 节、`§2.x` 各批会话）已从本文件**删除**，只在 git 历史可查：`git log -p --follow HANDOFF.md`（或 `git show <旧提交>:HANDOFF.md`）。文中残留的 `§2.x` / 旧 `§0` 引用是**历史指针**，去 git 查，**不要在本文件重建历史**。
> **§8 是移动端（安卓）专职交接**，由移动端会话维护；桌面会话不要改 §8，移动端会话不要改 §0-§7 之外的桌面文件。

## 0. 最新交接 · 260929 · 多维表功能扩展（V01–V04 + T01/T04/T02A + 单级分组/UI2 + 260929-OPT + T02B.1/T02B.2/T02B.3）

> 写给完全没有上下文的新会话。**本轮的方案、进度、修改记录、会话结论全部在 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`（下称「专项文档」）**：先按 README → HANDOFF → AGENTS 读总上下文，再**完整读专项文档**，然后按它的 §8 顺序继续；**本文件不展开专项细节**，专项会话结束前必须回写专项文档 §11/§12/§13。

### 修复 · 261006 · 画板工具栏图标对齐 + 多维表展开浮窗适配边界

- 用户两条反馈。① **画板左侧竖排创建栏图标错位**：内核原生 `label.tool-icon` 里的隐藏 radio 占 15px 流内宽度、lakex 注入触发器未居中 ⇒ 三类工具项图标圆心分 57 / 50 / 42.5 三档。修在 `src/features/board/boardEditor.css`（内核例外覆盖，不手改 vendor）：radio 移出流 + 注入触发器居中 ⇒ 实测 11 项 centerX **全为 42**，真实点击切换 / 高亮正常。② **多维表单元格展开浮窗适配边界**：`ExpandPanel` 旧实现横向按占位宽 400 夹取，而实际宽度是「记住的尺寸」⇒ 越界（1258 视口 / 锚点 x≈1020 / 记忆 900 宽时旧实现溢出 ~490px）。改用**真实尺寸**定位 + 夹进视口 + 窗口 resize 重新适配（仍不因拖动 / 缩放重算定位）。
- ③ **多维表 AI 字段展开默认进「预览」**（用户 261006），Markdown 字段仍默认「编辑」：`MarkdownExpandPopover` 按 `field.type === "ai"` 决定初始态（只读仍恒为预览）。真实端 CDP：AI 字段面板打开即 `预览` 高亮、无 textarea、头部「重新生成」在。
- ④ **全应用「文本选中」统一为固定色 + hover 气泡改用同色**（用户 261006 报「文档是主色变浅，多维表/表格/输入框是固定深蓝」，随后定稿「固定色比较好；选中的边框已经是主题色，多主题色放一起不好看」）：① 根因是内核 antd 基底（编译进 `vendor/lakex-doc-react/dist/style.css`，import 在 legacy 层）里有一条裸 `::selection{background:#1890ff}`，只被内核 `.ne-engine ::selection` 覆盖 ⇒ 其它一律固定蓝；② 修法：把 `--lake-select-bg` 从三套主题收进 `themes/base.css`、定为**主题无关固定值** `rgba(63,95,160,.16)`（用户截图的 `#d8dde8` 就是它在 `#f5f5f5` 上的合成），再在未分层 `kernel-theme.css` 加全局 `::selection{background:var(--lake-select-bg);color:inherit}`（未分层普通声明压过 legacy 层，不需要 `!important`）；③ 用户追加「这种冒泡都改用选中色」：`--lake-tooltip-bg/-fg` 由深蓝 `#3f4868`/`#f8f9ff` 改为同色系的 `#d8dde8`/`#1f2329`（`.ln-tip` 与各处 hover 气泡同一令牌）。真实端实测三主题：`::selection` 恒 `rgba(63,95,160,.16)`、`.ln-tip` 恒 `#d8dde8` + `#1f2329`。**用户明确：这不是设计系统的例外，而是「选中 / 气泡」这一处的独立设计。**
- ⑤ **多维表导航改为「设备本地」**（用户 261006 选 C）：`activeTableId` / 每张表的 `activeViewId` 不再作为正文真相 —— `useBitableSession` 序列化时恒写「第一张表 / 第一个视图」（新增 `serializeBody`），切表 / 切视图只写 `localStorage`（`lake-notes-v3.bitable-nav.<noteId>`，见 `BitableEditor`；历史快照预览 `chrome=false` 不读写）。效果：**切表不落盘、不标脏、不进同步**；每台设备各自记住最后看的表 / 视图。真实端 CDP：切表后状态栏全程 `仅本地`、正文 `activeTableId` 不变、localStorage 导航已更新。
- ⑥ **表格「当前工作表 + 缩放」改本机 + 修「选区误标脏」**（用户 261006 审计「只改展示不得触发 S3」的落地）：① `sheetsToBody` 新增 `LOCAL_SHEET_KEYS`，把 `status`（当前工作表）/`zoomRatio`（缩放）从正文剔除，改存 `lake-notes-v3.sheet-views.<noteId>`（新 `features/sheet/sheetViewStore.ts`）；打开时还原（多表显式 `activateSheet`）。② `SheetEditor.scheduleSave` 改为**先比正文再决定**：`bodyOf(latestRef) === lastSerializedRef` 时直接 return ⇒ 点选单元格 / 滚动这类 onChange 不再把文档推成「待保存」。真实端 CDP：点选单元格与点缩放（110%→120%→110%）全程状态栏 `仅本地`、正文 `len` 与字段不变、localStorage 视图已更新。明细见审计结论（§0 上文）。
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
- 门禁全绿：tsc ✓ · vitest **1702 passed / 16 skipped** ✓ · check:core 75-0 ✓ · ui-metrics（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · cssLayers+uiPrimitives ✓ · 双端构建 ✓ · `git diff --check` ✓。真实端 CDP 实测：强制 900 宽面板 `right=1250`（视口 1258，8px 边距）。明细见专项文档 §11/§12/§13。已提交：`c361001`（修复批）· `0b60125`（目录栏 ＋/重命名弹窗）· `22def1f`（垂直几何）· `5397548`/`5ad4f64`（资源浏览器 + 基线）· `f6e2298`（删资产登记漂移）· `5c8f1e4`（快照装置）· 本轮设置微调与基线（后续提交）。

### 当前批次 · 261005-MM · AI 多模态基础能力（图片 + PDF，落到多维表 AI 字段）

- 范围（用户 261005 定稿）：**先做图片 + PDF 的「基础能力」**；Office 不做、**AI 生成图片不做且不立项**、移动端只读无 AI（`src/mobile` 0 处 AI 引用，已核实）。
- 关键事实：**DeepSeek 的 `deepseek-flash` 本身支持图片输入**（OpenAI 兼容 `content` 数组 + `image_url`；格式 JPEG/PNG/GIF/WebP、单图 ≤1024 token；见官方《图像理解》）⇒ 不换供应商、不加协议。**但 DeepSeek 的 file / Files API 只收图片** ⇒ PDF 必须本地抽文本。
- 落地：core 内容块模型（`text` / `image` / `document`；附件跨 IPC **只传 `{noteId, filename}` 引用**）→ 主进程唯一解析入口 `electron/ai/aiContentResolver.ts`（图片 → data URL；PDF → `electron/ai/pdfText.ts` 用 `unpdf` 抽文本，限额 32MiB / 6 万字符 / 10s、扫描件明确报错、按 `noteId/filename/size` 缓存）；图片 / 文档**只允许 `user` 消息**、各限 10 / 5。
- AI 字段：字段配置加 `includeAttachments`（编辑器「把引用的图片 / PDF 一起发送给 AI」开关），`buildAiFieldMessages(..., { noteId })` 出内容块；其余附件仍只出文件名。**PDF 按扩展名判定**（`fileKindOf` 不许进文档模型，既有护栏禁止）。
- 门禁全绿：tsc ✓ · vitest **1673 passed / 16 skipped** ✓ · check:core 75-0 ✓ · ui-metrics（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · cssLayers+uiPrimitives ✓ · 双端构建 ✓ · `git diff --check` ✓。
- 真实端：**隔离 Electron + CDP + mock OpenAI 端点 9/9**（出站 `[text, image_url, text]`、图片 data URL、PDF `【附件：报告.pdf】\nHello Lake`、非 PDF / 缺失附件 / system 带图三条错误路径均正确）；另用自造最小 PDF 走**真实 unpdf** 抽取实测 ✓。
- **续 · 图片入口（用户 261005 定稿：不做手动附图）**：① 文字选区含图片 → **自动**随首轮问答作为 image 块发出（`selectionToolbar/selectionImages.ts` 用 `range.cloneContents()` 取图，仅本地资产、按磁盘名去重）；② 图片浮动工具栏新增「AI」入口（`CardItem tip="AI"` → 单图上下文），无文字选区时首轮出**图片预设**（描述 / 提取文字 / 翻译 / 自定义）。面板新增 `attachments`，追问沿用 history。
- 门禁续：tsc ✓ · vitest **1679 passed / 16 skipped** ✓ · check:core 75-0 ✓ · ui-metrics ✓ · cssLayers+uiPrimitives ✓ · 双端构建 ✓ · `git diff --check` ✓；**隔离 Electron + CDP 18/18**（真实文档 + 真实图片卡片：两条入口都实测出站带 `image_url` data URL）。仍未提交。
- **续② 三处修复（261005 用户反馈）**：① AI 面板最高收到**可用高 3/4**（原先全高太长）；② 图片入口去掉「替换选区」、保留「插入到选区后」（按图片模型节点定位落点；文字入口不受影响）；③ 修「图片浮栏弹层歪到最左」—— 根因内核 **`.ne-card-toolbar` 有 `transform`**，`position:fixed` 相对它定位 ⇒ 已把弹层移出 `.ne-card-toolbar`（放 `.selection-toolbar` 下）。④「图片栏只留图标」调研已出（仅 4 项带文字，去 span 即可，~584→465px），**未实施、待拍板**。
- **续③**：① AI 面板最高改**配置整数** `AI_DIALOG_MAX_HEIGHT = 512`（不再比例乘法；实测 512px）；② **图片浮栏只留图标**（去 4 处文字标签，实测 584→432px；hover 仍出名称）；③ 核实**图片裁剪可用**（`setCro(true)` 真进裁剪态：`_isCroping=true`、`_cropImageOp` 已设置、裁剪 DOM 11 个）—— vendor 「空桩」注释过期，已回填 `LAKEX-CONTRACT §5.21`。另清理 438 处文档转义反引号。
- **续④ 图片 Cmd+X 剪切（用户选方案 1）**：vendor `src/index.ts` 导出 `deleteBlockByRange`（LOCAL-CHANGES #28，已重建 `dist/` 三件产物）；宿主 `SelectionToolbar` 加 Cmd/Ctrl+X = `selectNode(卡片)` + `execCommand("copy")` 写剪贴板 → `deleteBlockByRange(editor, topLevelBlockOf(cardEl))`。真实端实测：图片从**正文与 DOM 都删除**、剪贴板得 `text/html` 图。⚠️ 坑：守卫**别用裸 `[contenteditable='true']`**（主编辑器引擎就是它 ⇒ Cmd+X 永远进不来）；验证剪贴板前要先清空。
- **续⑤ 修正（用户实测）**：图片剪切**不能用块级删除**（`deleteBlockByRange` 删整个块，会把同段的其它图片/文字一起删）；改用内核**卡片级**命令 `deleteCard(cardId)`。真实端：同段 3 图删中间一张 → 只掉它、文字与另两图保留。vendor 改动**已整体还原**（零分叉）。
- **续⑥ 泛化（261005）**：Cmd+X 卡片剪切覆盖**所有卡片类型**——`SelectionToolbar` 用 `activeCardRef` 记最近点过的任意 `ne-card`，命中卡片才拦（非折叠文字选区让位）。真实端同文档 image/file/video/audio 各 2 张逐个切：每类只掉目标 1 张、其余类型零变化。
- 明细只在专项文档 §11/§12/§13。**未提交（待验收）**。

### 修复 · 261005 · AI「插入到选区后」压扁原块 + 最终改为「分隔线 + AI 生成提示」

- 用户 261005 报：选 4 项无序列表 → 用 AI「插入到选区后」→ 4 项被压成 1 项（多行变软换行、只剩一个项目符号）、**每行块句柄消失**，「格式绝对是错误了」，要求彻查并看其他格式是否同样。
- 根因（隔离 Electron + 程序化模型选区复现，正文级证据）：`SelectionToolbar.onInsertAfter` 旧实现把「`getSelection().toString()` 的**纯文本**原文 + 空行 + AI」整体 `insertAtSelection("text/markdown", …)` **替换原选区** ⇒ 纯文本丢块结构、markdown 再把连续行并成一段。实测 4 项列表落盘成 `<li>甲<br/>乙<br/>丙<br/>丁</li>`（1 项）+ 引用 + 残留 `<ul start="2">丁项</ul>`。
- 修法（结构）：**只插新块、绝不碰原块** —— `insertAtPosition({ id: 父节点, offset }, "text/markdown", …)`，`offset` = 选区末端所在**顶层块**在父节点 `_children` 的下标 **+1**；新增 `aiModelSelection.positionAfterModelRange()`（按模型 `_parent`/`_children` 算，不用 DOM→模型映射）。
- 顺带修：`applyModelRange` 一直走 `editor.execCommand("selection", …)` 会抛 `setStart: … not of type 'Node'` 并被 try/catch **静默吞掉（= 从未生效）** ⇒ 改走 `editor.kernel.execCommand`（实测正确设回模型选区）。
- ⚠️ 内核坑（已回填 `docs/LAKEX-CONTRACT.md` §5.16）：`transformDOMRange(setStartAfter(el))` 把「某元素之后」映射成 **el 自己的下标（少 1）**；块级插入落点必须按模型父子关系算（列表在模型里是一个 `<ul>`、DOM 里是多个兄弟项）。
- **标记口径（用户 261005 两次改向后的最终定稿）：不再包引用、也不加任何提示词约束。**
  - 依据：实测内核 Markdown **原生支持表格**（连 `> ` 前缀的表格也解析成真表格），但 Lake 的容器（引用/高亮块/分栏/折叠块）**都装不下表格** —— 表格会从引用里跳出来、且前后文字被并进同一引用 ⇒ 顺序错位（见契约 §5.16）。
  - 「插入到选区后」= 在落点插「**分隔线（hr 块卡） + 「以下内容由 AI 生成」提示 + AI 正文（原生 Markdown） + 分隔线**」；落点仍走 `insertAtPosition`。
  - 「替换选区」= **原样插入** AI 输出，不加任何标记。
  - 插入后仍**自动选中 AI 正文**（`selectNewBlocks(..., skipFirst=true)` 跳过前置提示段），保住「首次插入即选中」。
- 真实端（隔离 userData + mock OpenAI + 真浮栏 + 真点按钮）：结构修复 **31/31**；最终标记 **11/11**（列表 4→4 保留、hr 块卡 ×2、提示在正文前、选中态只含正文；替换无提示/无 hr）。脚本 `/tmp/ai-after-fix.mjs` · `/tmp/ai-marker-check.mjs`。
- 门禁：`tsc` ✓ · vitest **1625 passed / 16 skipped** ✓ · `check:core` 75 文件 0 违规 ✓ · `ui-metrics`（hex=0/rgb=0/`!important`=9/未定义令牌=0）✓ · `cssLayers+uiPrimitives` ✓ · 双端构建 ✓ · `git diff --check` ✓。
- 改动：`selectionToolbar/SelectionToolbar.tsx` · `selectionToolbar/aiModelSelection.ts` · `selectionToolbar/aiInsertMarker.ts`(新) · 护栏 `aiModelSelection.test.ts`(新) · `aiInsertMarker.test.ts`(新) · `selectionToolbar.wiring.test.ts`。**未提交（待验收）**。
- **顶栏「更多 → AI 助手」永远纯提问（用户 261005 定稿，已回滚"按选区区分"）**：**不读选区**（`selectionText` 恒空、不传 `onReplace`/`onInsertAfter`），只问 + 复制（每条回答各带复制）；浮动工具栏 AI 不变（有选区才出现，负责替换/插入）。原因：选区滚出可视区后从右上角进入会有锚点/滚动难题。为此临时抽出的 `aiWriteBack.ts` 共用模块已删除、写回逻辑回到 `SelectionToolbar.tsx` 内联。真实端：顶栏（哪怕有选区）按钮 = `[发送, 重新生成, 关闭]` 且请求不带选区；浮栏 = `[…插入到选区后, 替换选区…]`。
- **AI 面板改对话式复制（用户 261005）**：**每条** AI 回答各自带一个复制按钮（复用 kit 的 `.ln-iconbtn--compact`，**不新增 CSS**）；去掉底部「只复制最后一条」的按钮。真实端 2 轮实测：2 条回答 = 2 个复制按钮、底部按钮 = `[发送, 重新生成, 关闭]`、点第 1 条复制得到**第 1 条**文本。改动 `AiAssistantDialog.tsx` + 护栏 `aiAssistantDialog.test.ts`。
- **Markdown 渲染抽象（261005 预留替换接口）**：自研轻量子集渲染器从 bitable 提到中立共用件 **`src/components/markdown/MarkdownView.tsx`**（含排版 `markdown.css`，作用域 `.md-preview`；旧 `.bt-md-preview` 随之下线：`bitableMarkdown.css` 60→17、新文件 43）；AI 回答正文加**唯一可替换缝** `src/features/ai/AiMessageBody.tsx`（**当前已接自研 MarkdownView 渲染**；将来换 react-markdown / remark-gfm / llm-ui / streamdown **只改这一处**）。本轮**不引入任何 md 库**（社区调研：react-markdown+remark-gfm 最标准、streamdown 绑定 Tailwind 不适配、llm-ui headless 但 0.x）。
- **AI 首轮预设提示词（261005）**：**有选区的浮动入口**在**首轮**显示一行预设（复用 kit 分段控件 `.ln-segment`，无新原语）：总结 / 续写 / 摘要 / 修正 / **自定义（最后）**。点击 = **只把提示词填进输入框**（绝不自动发送），用户点「生成」才确认；手动改字退回「自定义」；点「自定义」清空。顶栏入口无选区 ⇒ 不显示预设。提示词单一来源 `src/features/ai/aiPrompts.ts`；布局 `aiDialogParts.css`（预设行 + 复制动作行，已登记 cssLayers）。真实端 9/9。
- **「复制为 Lake」（261005）**：AI 回答下方**两个复制按钮**（图标按钮原语 `.ln-iconbtn--compact`，间距在 `aiDialogParts.css`）：① 复制纯文本（原行为）② **复制为 Lake**（内核格式，粘到 Lake 原生直插、不弹「是否转换」；无内核时禁用）。两者说明走**自绘即时气泡**（kit `.ln-tip` + `.ai-dialog__tip` 补 `position: fixed`，与多维表 `.bt-file-tip` 同口径；**无延时**——原生 title 约 1s 延迟，用户 261005 要求实时，实测 5ms 出现）；Lake 按钮图标 = **`lake` 四字母文字徽标**（`.ai-dialog__lake-badge`，不用代码块图标）。配方 = `readData('text/markdown')` → `writeData('text/ne-inode'/'text/html'/'text/plain')` → 把 ne-inode 负载按内核 `<ne-clipboard data=…>` 约定嵌进 `text/html` 写剪贴板（见 CONTRACT §5.18）；内核实例靠新增 `editorRegistry.ts`（mount→editor WeakMap）取。真实端 7/7 + **用户真机 ⌘V 已验证原生还原、无转换弹窗**。
- **块句柄菜单的「AI 助手」（261005）**：块菜单**第一项** = AI 助手（vendor 注入 + 透传，LOCAL-CHANGES #27），唤起**同一个** AI 面板；上下文 = **句柄覆盖的块**（多块=整段，单块=整块）。落库复用浮栏同源 `selectionToolbar/aiResultOps.ts`（替换 / 插入到选区后）。踩坑：**菜单点击会把模型选区压成折叠的光标** ⇒ 必须先判折叠、自己把整块选成模型选区，否则「替换」会退化成「光标处插入」（实测追加）。真实端 5/5（含"真替换"断言）。

### 修复 · 261005 · 切标签「表格重排闪烁」+ 活动标签判定重构

- 先排除误判：用户报「dev 切标签极卡、内容加载不出来」，日志证据显示渲染进程跑在**过期 HMR 模块**上（`menuLeft` / `TOOLBAR_FORMAT_FALLBACK_ICON` 在当前源码里已是 0 处引用）并有 `[sheet] editor crashed`；**重启 vite + Electron 后即恢复** ⇒ 不是「功能变多导致性能下降」。剩下的真问题 = **文档里 `fit-width` 表格切回来重排闪烁**。
- 根因：非活动标签用 `display:none` 藏 ⇒ 表格容器宽度变 0；切回来 **0→N** 被内核 `fitWidth` 的 ResizeObserver（`lakex.js` `_updateFitWidth` / `s2`）当成一次真实 resize ⇒ 重算列宽 + 重渲染整张表。真实端实测（4 标签 / 用户那篇 `520d143d` 正文）：**ResizeObserver 触发 263 次 / 693ms、表格 DOM 变动 1095 次、LayoutCount +14 / RecalcStyle +18**。
- 修法（方案 2 = 保留布局地隐藏）：`EditorTab` 去掉 inline `display:none`，改按 `data-active` 的共享规则隐藏。修后同条件实测：**ResizeObserver 0 次、表格 DOM 变动 0、LayoutCount +3**。
- ⚠️ **踩坑（261005 用户实测，勿改回）**：第一版共享规则用 `content-visibility: hidden`，结果**活动编辑器的绘制被整个压掉**——用户实例里文档与多维表整片空白（DOM 都在、命中测试也命中，就是没画出来）。像素判据（编辑区 ink 比例）：`content-visibility:hidden` + 宿主重叠在同一网格格（`grid-area:1/1`）**0.23%**（空白）；`display:none` / `visibility:hidden` / `opacity:0` / `content-visibility` 但**不重叠** 四种都是 **1.61%**（正常）。结论：**`content-visibility: hidden` + 网格重叠**这个组合有 Chromium 层面的问题。
- 最终口径：`tabs.css` 里 `:is(.lake-editor-tab, .sheet-editor, .bitable-editor, .board-editor):not([data-active="true"]),
.board-editor--restoring { opacity: 0; visibility: hidden; pointer-events: none; }`（画板「贴位置」过渡态也并入同一条，避免同一个语义两套实现）。`visibility:hidden` 负责跳过绘制 + 退出无障碍树与 Tab 焦点（不需要额外 `inert`/`aria-hidden`）；`opacity:0` 兜住内核工具条自己写 `visibility:visible` 的泄漏（画板 260926 那个「按钮永久停留」）；两者都保留盒子与内部滚动位置。护栏 `boardEditorMount.test.ts` 已断言这条最终形态。
- 前置重构（用户定为「即使只为整洁也要做」）：把「谁是活动标签」从**几何推断**改成**显式信号**。4 种编辑器宿主（`EditorTab` / `SheetEditor` / `BitableEditor` / `BoardEditor`）显示时打 `data-active=true`；新增唯一来源 `src/features/editor/activeEditor.ts`（只认属性、绝不看几何）。原先 3 处「白猜」的消费者改回自己手里的数据：`SelectionToolbar` 的内核工具条 → `container.querySelector('.ne-ui-toolbar')`（工具条本就在自己容器内，实测 `.ne-ui-toolbar → .ne-ui → .ne-editor → .lake-editor-mount`）；AI 面板文字栏 → 新增 `container` prop（顶栏入口无容器，退回 `activeEditorMount()`）；`useEditorTopVar` 的 `.ne-ui` 候选只取 `activeEditorHost()`。`lakeRuntime.visibleToolbarExists` 补 `content-visibility` 排除且卡工具栏只在本编辑器内查。
- 内存实测（4 标签 / 3 篇表格文档，两独立实例交替跑）：heap 26.7 / 26.5 / 32.0 / 26.5 MB，nodes 4820 / 4826 / 5276 / 4820 ⇒ **无上升**（不重排反而少建节点）。保留布局确实会多建布局对象，但被「少一次重排重渲染」抵消，未观测到增量。
- 护栏：新增 `src/features/editor/activeEditor.test.ts`（3 条：唯一来源不看几何 / 4 宿主都打信号 / 原白猜消费者不再全局搜——含 `desktopDerivedState` 的滚动归零与 `EditorTab` 里 `style.display` 判隐藏这两处**补漏**）；更新 `selectionToolbar.wiring.test.ts`、`aiAssistantDialog.test.ts`、`boardEditorMount.test.ts`；`cssLayers` 基线：`tabs.css` 189→192（+3 = 共享隐藏规则）、`boardEditor.css` 14→12（隐藏声明上移）、`editor.css` 基线仍是原值 70（中途 +2 的隐藏规则已上移到 `tabs.css` 统一）。⚠️ **e2e 脚本自己也曾用同一几何启发式**（`getBoundingClientRect().width>0` 挑 mount），随方案 2 一并改成 `[data-active=true]`——否则 AI-1 会误判（这正是「几何猜可见」脆弱的现场证据）。
- ⚠️ **vendor 重建产物的 diff 会很大，属正常**：`npm run build:vendor` 每次都会重新 mangling 压缩标识符（`Ps→Fs`、`Fp→Ip`…），`dist/index.es.js` 可整体重排 3 万行左右（语义等价）。判断重建是否正确**不要看 diff**，看两件事：① 源码侧 `LOCAL-CHANGES` 对应的行为在真实端复现（本次：BH-8 走廊修复、引用内「高亮块」带文字）；② `git diff --check` 干净。
- 独立事项（不在本条范围）：`@fortune-sheet/core` 的 `updateContextWithCanvas` 在 React ref 为 null 时裸读 `placeholder.clientWidth` 会抛 `TypeError`（日志 `[editor] crashed ce04a097…` ⇒ 错误边界整编辑器重建）。已在 `patches/@fortune-sheet+core+1.0.4.patch` 加判空（保留原有 hunk）。**诚实边界：只验证了补丁已生成/应用，未复现原始崩溃**。
- 门禁：`tsc` ✓ · vitest **1611 passed / 16 skipped** ✓ · `check:core` ✓ · `ui-metrics`（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · 桌面 + 移动 build ✓ · `git diff --check` ✓ · 选区/块手柄 e2e **13/13** ✓ · 真实端 `--lake-editor-top` 三标签恒定 64px、活动标签内恰好 1 个内核工具条 ✓。
- **已统一（用户追加「统一吧」）**：4 种编辑器宿主现在共用同一条隐藏规则 —— `tabs.css`：
  最终形态 = `opacity: 0; visibility: hidden; pointer-events: none;`（**不是** content-visibility，原因见上一条踩坑）；
  同时删掉三处各自的隐藏实现（`EditorTab` 的 inline `display:none`、sheet/bitable 的 `fn__none`、画板的 `board-editor--hidden`）。`grid-area: 1/1` 本来就每种宿主各自有（未动）。
- 真实端四态验证：**恰好 1 个 `data-active`**，活动项 `pointer-events:auto`、其余 `none`（隐藏靠 opacity/visibility），且四种编辑器都正常渲染（doc 1 / sheet 2 / bitable 1 / board 21 个 svg·canvas）；宿主盒子都保留（1056×748~778）。像素判据复测：编辑区 ink = 1.61%（与旧 `display:none` 一致 ⇒ 绘制正常）。
- 重编辑器内存实测（同实例三次交替）：「统一」30.1MB / 3842 nodes →「模拟旧 `display:none !important`」30.1MB / 3844 nodes →「统一」30.1MB / 3844 nodes ⇒ **完全相同**，统一没有内存代价。
- 旁证：画板 `boardEditor.css` 的注释里 260926 就实测过两个反面教材（`display:none` 让画布 `.viewport-container` 塌成 0 ⇒ 浏览器钳掉滚动位置、切回跳回原处；`visibility:hidden` 被内核工具条自己的 `visibility:visible` 顶掉 ⇒ 画笔/箭头/形状按钮永久停留），与这次表格重排实测量指向同一结论。

### 当前批次 · 261004 块编辑（引用内块独立 / 引用内转化为裁剪 / 合并手柄 / 取消引用）

- 云端实测（browser-skill + Edge）：引用**首个子块**的手柄 = 整个引用的合并手柄；引用内**非首**块各自出柄；引用内「转化为」= 11 项（h1–h6 / 正文 / 有序 / 无序 / 任务 / 高亮块，图 2），引用外 15 项；主菜单 6 项；手柄**顶对齐块首行**；多块选中样式 = **整块背景**（比文字选中浅）；**取消引用** = 引用第一行手柄 → 转化为 → 「引用」**回显 selected** → 点一下。
- 落地（vendor LOCAL-CHANGES #23 · `docs/LAKEX-CONTRACT.md` §5.8.6）：`NE-QUOTE` 移出 `STRUCTURAL_BLOCK_TAGS`（非首块各自出柄）**但保留父块上提**（首块 → 整个引用）；`QUOTE_HIDDEN_CONVERT_VALUES` 按 `isInsideQuote` 裁掉 codeblock/quote/columns/collapse，且「转化为」整体**内联到第一级**（沿用原样式：紧凑图标格 + 卡片格）；`updateHandlePosition` 顶对齐；`selectedTopBlocks` 加 `blockContainerOfRange`（支持引用内多选）；**块编辑只在鼠标触达块句柄时触发**（`selectionchange` 不扫描/不高亮，多块判定在 `mousemove` 的 `e.buttons===0`，拖选中不判定）；选中样式覆盖**所有行级块**（正文/标题/列表），段间距用动态入参 `--ln-brick-hl-extend`（= 与下一个高亮行的实际空隙；单行/末尾为 0 ⇒ 只用行高本身）补齐 ⇒ 无行间隙也不溢出（内核 `::before + z-index:-1` 在列表项上不可见，故不用）；选中样式用 `highlightedRef` 记录、每次先全清再重记并在选区收缩时清除（用户实测「选中过一次背景就不消失」，已修）；新增 `unwrapQuote`（`dropPositionOf` + `insertAtPosition` + 节点级删除，内部块按原类型提升）。
- 顺带修 bug：`getCurrentConvertValue` 原无条件下探列表标记，把「含列表的引用」误判成 `ol/ul`（「转化为」回显成「有序」、点「引用」不取消反而再包一层）→ 收窄为「块自身是列表项时才下探」。
- 门禁：`tsc` ✓ · 全量 vitest **1580 passed / 16 skipped** ✓ · 双端 build ✓ · `check:core` 0 违规 ✓ · `ui-metrics`（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · 护栏 `blockMenuNative.test.ts`（28）+ 新增 jsdom `blockMenuHelpers.test.ts`（3）✓。
- 真实 Electron（隔离 `/tmp/lake-blk-261004`，自造「引用 + 无序/有序列表」文档）实测：引用内第二个列表项句柄 top=233=该项；其「转化为」11 项（无序*）；引用内两项多选 → 高亮 2 块、句柄 top=203=首项；引用首行句柄 top=166=引用 top、「转化为」15 项（引用*）→ 点「引用」→ `ne-quote` 消失、内部块（含列表类型）提升到顶层；整块背景像素实测 rgb(220,234,250) 铺满整行。
- 诚实边界：云端「多块拖选合并」的真实鼠标拖拽手势未复现（browser-skill 无拖拽）；`git diff --check` 仅报 vendor **重建产物** `dist/index.cjs.js` 的**既有**行尾空白（HEAD 同位置也有）。

### 修复 · 261004 · AI 助手弹窗定位（绝不盖住选区）

- 用户 261004 报「AI 弹窗又盖住了选区」；隔离 Electron + mock OpenAI SSE 真实端复现：面板内容流式长到 `maxHeight` 后**翻到选区上方**（实测面板 top **153**、选区 bottom 471）。
- 根因：弹窗走通用 `usePopoverPosition` / `placePopoverAtPoint` 的「下方放不下就翻上方」；而 `maxHeight` 用 `Math.round` 向上取整、恰好比可用空间多不到 1px，令「下方是否放得下」判定失败 ⇒ 翻转。
- 修复：① 新增 `placePopoverAtPointBelow`（只放锚点下方）+ `usePopoverPosition` 的 `allowFlip` 选项（默认 true，其它浮层不变），AI 弹窗传 `allowFlip:false`；② `maxHeight` 改 `Math.floor`；③ 选区自绘层 `measure()` 同步刷新锚点，**面板跟随选区滚动**；④ 打开时 `reserveAiDialogSpace` 只补到 `AI_DIALOG_MIN_HEIGHT`（**克制版**：生成再长交面板内滚动，不再推编辑区）；⑤ 顺带修 `reserveAiDialogSpace/clearAiDialogSpace` 取「文档第一个 `.lake-editor-mount`」（keep-alive 下可能是隐藏实例）→ 改取可见挂载点。
- 真实端实测（隔离 userData/端口）：`AT OPEN` / `AFTER STREAM` / 上滚 / 下滚 四态 `covers:false`；护栏 `aiAssistantDialog.test.ts`(5) + `topMenuPosition.test.ts` 新增用例。
- 门禁：tsc ✓ · vitest **1592 passed / 16 skipped** ✓ · check:core 0 ✓ · ui-metrics（hex=0/rgb=0/`!important`=9/未定义令牌=0）✓ · 双端 build ✓ · cssLayers+uiPrimitives ✓ · `git diff --check` ✓。**未提交（待验收）**。
- 改动：`src/features/ai/AiAssistantDialog.tsx` · `src/features/editor/selectionToolbar/SelectionToolbar.tsx` · `src/hooks/topMenuPosition.ts` · `src/hooks/usePopoverPosition.ts` · `src/hooks/topMenuPosition.test.ts` · `src/features/ai/aiAssistantDialog.test.ts`(新)。

### 修复 · 261004 · 浮动选区工具栏滚动后「干到顶栏」

- 用户 261004 报：选中文字后浮动工具栏正常，**一滚动就跑到顶栏里**。隔离 Electron 实测两处根因：
  1. `computeToolbarPosition` 的「下方档」只按 `anchor.bottom + gap` 定位、**没有夹 topLimit**；选区被滚到顶部时 anchor.bottom+gap 落进/越过顶界（内核固定工具栏底边）⇒ 浮栏出现在固定工具栏之上、乃至顶栏。
  2. 顶界来源 `document.querySelector(".ne-ui-toolbar")` 取的是**文档第一个**实例；多 tab keep-alive 下第一个是隐藏实例（实测 rect 高 **0**），顶界塌成 host.top+8，进一步让「上方档」成立。
- 修复：① `computeToolbarPosition` 下方档 top = `Math.max(topLimit, belowTop)`（与上方档同一条顶界线）；② 新增 `visibleChromeToolbar()`（取 rect 高 >0 的 `.ne-ui-toolbar`），浮动栏定位与 `clampToEditorArea` 两处都改用它。
- **最终口径（用户 261004 三次追加后定稿）**：浮栏**始终贴在选区上方**、随滚动自然移动；**不做**显隐切换（会闪）；滚到顶界以上时**被固定工具栏/顶区盖过去**（不是盖在它们上面）；快滚不能跳。
- **最终方案（用户「做，还是跳」后彻底改）**：浮栏宿主挂进编辑区**滚动容器** `.ne-editor-wrap`（内核实测 `position:relative + overflow:auto`），用**内容坐标**绝对定位
  （`top = rect.top - wrapRect.top + wrap.scrollTop`）⇒ 它随正文一起滚（合成器线程同步、零相对位移）、并被滚动容器裁切
  （滚到顶界以上从固定工具栏下沿滑出）。**滚动时无需任何 JS 更新**，从根上消除跳动。
- 关键改动：`mountSelectionToolbar` 把 host 挂到 `.ne-editor-wrap`；`.selection-toolbar` 由 `position:fixed` 改 `absolute`；
  `placeToolbarNow` 用**实时**选区 rect（非 state 快照）换算内容坐标（避免快照与 scrollTop 不同步造成的漂移）；不再用 clip-path / scroll 重定位。
- AI 自绘选区层保持 inline（`position:fixed` 逃逸 overflow，照常工作）；**不用 createPortal**（否则触 UI 原语门禁）。
- 过程中试过并撤掉：可见带收起/重现；clip-path 裁切版；命令式 scroll 重定位版（摆动 99→10px 仍有残留）。
- 真实端（隔离 userData/端口）：页面内 rAF 平滑滚 wrap 实测 `selTop - toolbarTop` **range 0**（完美跟随）；`toolbarCount` 恒 1；越过顶界由滚动容器裁切。
- 门禁：tsc ✓ · 全量 vitest **1600 passed / 16 skipped** ✓ · 双端 build ✓ · ui-metrics/cssLayers/uiPrimitives ✓ · `git diff --check` ✓。**未提交（待验收）**。
- 改动：`SelectionToolbar.tsx` · `useSelectionToolbar.ts` · `mountSelectionToolbar.ts` · `selectionToolbar.css` · `selectionToolbarModel.ts`(+test) · `selectionToolbar.wiring.test.ts`(新)。

### 修复 · 261004 · AI 弹窗跳动 / 自绘选区画到顶栏

- 用户 261004 报：AI 弹窗也跳；自绘选区高亮也画进顶栏（与浮动工具栏同类问题）。**定稿口径**：AI 浮窗也要**跟着滚动**（浮动工具栏在选区上方、AI 在选区下方），并且**高度封顶、超出面板内滚动**。
- 修复（全部统一到「挂在滚动内容里 + 内容坐标」）：
  1. **原选区高亮：自绘**（用户 261004「彻查/别反复打补丁」）。三条路都实测过：
     · **保留内核原生选区**（最理想，逐像素一致）：实测 `selection.addRange()` / `setBaseAndExtent()` 都会把焦点**拉回编辑器**（`activeElement` 从提问框变成 `ne-engine`）⇒ 提问框失去焦点、没法打字，与「输入框可聚焦」**互斥**，不可行。
     · **CSS Custom Highlight API**（`::highlight()`）：不动选区/焦点、很稳；但实测 Chromium 里它**只画字形盒（≈21px）**，而内核原生选区按**行盒（≈30px）**绘制 ⇒ 比原生矮一截、行间露缝（用户 261004：「行间距没处理，前后效果不同」）⇒ 放弃。
     · **自绘（采用）**：**逐文本节点**取矩形 —— `Range.getClientRects()` 跨块时会额外返回「块盒」（整块满宽、还可能跨多行），列表/标题会被并成一大条满宽背景（用户 261004 截图实证）；改成逐文本节点的子 Range，只拿文字盒。**逐片段**取行高（标题/列表/正文行高各不相同，统一行高会把正文撑得过高）。**列表标志**（`ne-oli-i` / `ne-uli-i` / `.ne-list-symbol`）**排除**（内核原生选区**不渲染**标志，用户 261004 截图实证）；每个矩形**右缘补一个空格宽**（内核选区矩形含行尾空格，`getClientRects()` 只到最后一个字形）。再走单一来源 `lineBoxRects()` 撑到行高 + 按**垂直中心**按行并成一个（有单测）。宿主在 `.ne-editor-wrap` 里用**内容坐标**绝对定位（随正文滚、被容器裁切、**不监听 scroll** ⇒ 不跳动）。
     ⚠️ 分组判据必须是**垂直中心**（同一行的行盒/文字盒中心一致，相邻行相差一个行高）；**不能用「矩形相交」**——撑开后相邻行首尾相接、稍一重叠就会把 2~4 行并成一大块（用户 261004 实测截图），已有回归单测。
  2. **AI 弹窗**：`Overlay` 新增可选 `container`（portal 目标）；`AiAssistantDialog` 新增 `scroller`，浮动工具栏入口传 `.ne-editor-wrap`，面板渲染进滚动容器、`position:absolute` + **内容坐标**（`contentAnchor = at − 内容原点`，只在 open/at 变化时算一次）⇒ 随正文滚；顶栏入口不传 `scroller`，维持原视口级 fixed。
  3. **高度封顶**：内容自适应与手动拖拽上限都 = **编辑区可视高 − 2×边距**，超出交 `.ln-dialog__body` 内部滚动（不无限扩大）。
  4. **右下角拖拽把手**（用户 261004）：`.ai-dialog__grip`，**只改高度**（上下可拖、左右不动），夹在 `[AI_DIALOG_RESIZE_MIN=140, resizeMax]`；**不做记忆**（关掉即恢复自适应）；按钮行右侧留 18px 不压「关闭」。
  5. **按钮不做特殊高亮**（用户 261004）：「替换选区」去掉 `.ln-btn--primary`，与其它按钮同级。
  7. **点 AI 不闪**（用户 261004）：自绘层的测量改 **`useLayoutEffect`**（绘制前同步算好并 setState）——原生选区会被提问框 autoFocus 折叠，自绘层若晚一帧才挂上，中间就有一帧「原生已消失、自绘还没出现」= 闪一下。逐帧实测：点击后**第 0 帧就有自绘矩形、原生已隐藏**，其后每帧 diff=0。
  6. **打开面板不滚动编辑区**（用户 261004：选区跳动体感极差）：删掉整条 `reserveAiDialogSpace`（打开时向下滚编辑区补空间，实测一帧内最多跳 **807px**）；追问框改 `focus({ preventScroll: true })`（面板在滚动容器里，普通 focus 会把面板滚进可视区 ⇒ 整个编辑区跟着跳）。
- 真实端（隔离 userData/端口）：打开面板前后 `scrollTop` **恒 0**（不跳）；自绘高亮与原生选区**同高**（每行 59px@2x）；AI 弹窗 `styleTop` 恒 1250.5（内容坐标），滚动时面板与选区**同步位移**。
- 缩放手感实测：下拖 +160 → 高 89→**249**（宽不变）；左拖 −120 → 宽仍 **654**；上拖 −400 → 夹到 **140**；下拖 +600 → 到达 **682**（编辑区可视高）。
- 全格式对拍（标题 h1/h2 · 段落 · 无序列表 · 有序列表 · 引用 · 尾段，逐条像素比）：自绘与内核原生各条高亮带的 y/宽在 **≤8px（2x 图，≈4 CSS px，行尾空格/取整）**内一致，行高逐片段正确（h1 37 / h2 32 / 正文·列表 30）。
- 门禁：tsc ✓ · 全量 vitest **1607 passed / 16 skipped** ✓ · 双端 build ✓ · ui-metrics/cssLayers/uiPrimitives ✓ · `git diff --check` ✓。**未提交（待验收）**。
- 改动：`Overlay.tsx` · `AiAssistantDialog.tsx` · `SelectionToolbar.tsx` · `selectionToolbar.css` · 护栏 `aiAssistantDialog.test.ts`/`selectionToolbar.wiring.test.ts`。

### 当前批次 · 261003-UI（设置页重做 + 浮动工具栏「格式」合并 + AI 选区高亮）

#### 261003 · 画板 AI（已接通，实机验收通过）

- **内核侧本来就是「配置驱动」，一直没接**：`DrawnixBoardCore` 有可选 prop `ai?: DrawingBoardAIConfig`，满足它才会渲染 `LakexAIBoardAssistant`（工具栏上的绿色 AI 徽标 + 生成面板 + 落元素）。我们原先没传 ⇒ 画板**连 AI 按钮都不显示**（不是"有按钮点了没反应"）。
- **契约**（`vendor/lakex-doc-react/src/components/lakex/types.ts`）：`generate(request) => Promise<string | object>`；request = `{ description, systemPrompt（内核自带的画板 JSON 规范，实测 ~8.5k 字符）, contextPrompt（历史需求 + 当前画布唯一一份最新 JSON + 本轮需求，内核建议直接当 user message）, history, currentBoard, locale, signal }`；注释明说「前端画板不会保存 API Key，也不绑定具体模型」——正好对上我们「Key 只在主进程」。
- **接线**（`src/features/board/BoardEditor.tsx`，只改这一个文件）：`ai={{ generate: aiGenerate }}`；`aiGenerate` 把 system/user 组好后交给**既有**的 `runAiChat(newAiRequestId(), messages)`，返回累计文本；`request.signal` 的 abort → `cancelAiChat(requestId)`。**不新增 IPC、不动主进程**。
- **只读门禁**：`readOnly ? undefined : { generate }` —— 锁定/回收站的画板不给 AI 入口（AI 会往正文落元素，属写操作）。实测：锁定后徽标消失、解锁后回来。
- **长度护栏**：主进程 `ai_chat` 入参上限 = 40 条消息 / **20 万字符**（`electron/ipc/registerAi.ts`）。画板会把整张画布 JSON 塞进 `contextPrompt`，所以在 generate 里先算总长，>19 万就抛一句能看懂的提示（而不是透出「内容过长」）。
- **实机验收（隔离实例 + 本地 mock OpenAI 兼容端点 + 真实 SSE + CDP）**：
  - 生成：点徽标 → 面板（描述框 placeholder「例如：生成一个用户登录流程图…」）→ 输入 → 点「生成」→ mock 收到 `stream:true`、system 8450 字符、user 243 字符 → 画布上出现 **开始→判断→是→结束**，提示「✓ AI 图形已生成」。
  - 取消：mock 切慢速 → 点「生成」显示「正在生成…」→ 点「取消生成」→ **mock 侧 `aborts:1`（上游请求真的被中断）**、画布无变化、不弹错误提示。
  - 只读：锁定画板 → 徽标消失；解锁 → 回来。
- 护栏：`src/features/board/boardEditorMount.test.ts` 新增一条源码级断言（接的是 `ai.generate`、只读不给入口、走 `runAiChat`/`cancelAiChat`、有 19 万上限）。
- **真实供应商已验（261003 · DeepSeek 真 Key）**：连通性 `{ok:true}`、`/models` 返回 `deepseek-flash` / `deepseek-v4-pro`；画板 AI 喂「用户登录流程图（含失败重试）」**约 10s** 返回 **18 个元素**、分支与回环都正确并自动落盘（`boards/{id}.board.json` 5.9KB）；编辑器选区 AI 喂「翻译成英文」**6s** 返回正确译文。Key 全程只在主进程加密存储：渲染层设置视图 `hasKeyInView:false`、隔离实例库中**明文出现 0 次**、仓库 grep 0 次。
- **已知小瑕疵（真模型）**：模型不给 `width` 时按内核默认 180px 出节点，「输入账号和密码」被截成「输入账号和密」。这是内核 `aiBoardSchema` 的默认/归一化资产（vendor），暂不动；要修就在我们侧按文本估宽。
- **未做（有意）**：文内「文本绘图」卡片（`TextToDiagram`）—— 内核那支绿色徽标没有注入点。

- **设置页整体重做**（用户出图定稿「Sections」风格；AI 页先做一版、确认后铺到整页）。
  - 原语：`src/components/settingsPrimitives.tsx` 新增 `Section`（分组内的一段白卡，可带标题条）与 `Field`（**堆叠行**：标题/说明在上、控件整行在下，带字段级 error）。`Group` 现在自动把整组内容包成一张卡；组内已显式用 `Section` 时不再套（避免卡中卡）。
  - 样式单一来源 = `src/styles/feature.css` 的 `.settings-panel .config-*`：分组内容由「灰底块」改成**一叠白卡**（1px 边框 + 圆角 + 分段标题条）。**11 个分类全部统一**（编辑器/外观/快捷键/文档与历史/云端与同步/AI/资源/回收站/浏览器端/日志/关于）。
  - 行型规则：长输入 / 下拉 → `Field`（堆叠、整行）；开关 / 数字 / 段控件 → `Item`（内联右对齐），与思源一致。
  - AI 页 = 四张卡：**服务 / 凭据 / 模型与参数 / 连通性**。API Key 改**常驻输入框 + 眼睛按钮**（明文/密文切换），保留「留空即沿用已保存」；状态用 `badge`（已保存/未配置）。供应商差异字段（思考强度/思考模式/温度）仍**动态增删**（实测切 DeepSeek 自动出现两项、温度按 thinking 隐藏）。
  - 设置弹窗头 **52px → 40px**：根因是 `.settings-panel-large .settings-header` 的 `min-height:52px` + 共享的 `.floating-dialog-header{padding:14px 16px 0}`（上 14 / 下 0）。已把这条几何**从 components.css 并到 overlay.css** 紧邻 `.floating-dialog-header`（同一层、更高特异性，非叠覆盖）。
  - **顺手修掉两个真 bug（影响全站，不止设置页）**：① `.b3-button--outline` / `--cancel` 被基座 `.b3-button:not(.quick-note-publish):not(.quick-note-discard)`（(0,3,0)）压掉 —— 全仓 **40 处**「描边次按钮」实际都渲染成实心主色（`getComputedStyle` 实证）；② `.ft__error`（危险操作）同样没变红。均在 `kit.css` 补齐特异性修复。
- **浮动工具栏「格式」合并**（用户三轮定稿；文件 `src/features/editor/selectionToolbar/SelectionToolbar.tsx` + `editorCommands.ts` + `selectionToolbar.css`）。
  - 原「段落样式(T)」+「有序/无序/待办/引用/行内代码/链接」共 6 个按钮 → **一个父入口 + 菜单**；父入口回到**原 T 的位置**（字号左边）。**浮栏 466px → 338px**。
  - 菜单 = `正文 · 标题›`（「标题」是**二级菜单**，悬停/点击展开 标题1–6，贴右放不下自动翻左侧）‖ `有序/无序/待办/引用` ‖ `行内代码/链接`；**正文（默认态）也打勾**。行高 38→26、分隔线上下 4→2 ⇒ 整个菜单 ~360px → **226px**。
  - 父入口图标**跟随当前块类型**：标题→`editor-h1..h6`、列表/引用/代码→各自图标、正文→`editor-paragraph`；尾部箭头复用文字色/背景色那支内核箭头（`.ne-ui-toolbar-color-dropdown-arrow`，本地已镜像）。当前类型同时写进 tooltip。
  - ⚠️ **图标选择坑（别再走一遍）**：`editor-format` **不在内核 sprite 里**（KIcon 只会渲染空白，已踩）；`t-moremark` 是内核原生「更多标记」入口（= 上标/下标/行内代码），我们没有上标下标，不能用；`editor-paragraph` 会和原「段落样式」按钮撞图 —— 最终靠**把段落样式并进同一个入口**从根上消掉了这道选择题。内核 sprite 共 **325 个 symbol**（`icon-editor-*` 53 个）。
  - ⚠️ 内核把工具条按钮**定死 26px 宽**：父入口要放"图标+箭头"，必须 `width:auto`，否则箭头被挤成 0 宽（实测）。
- **所有浮层的边缘适配**（用户第 3 条：不固定位置的弹窗都不能被裁/被盖）：
  - 四类浮层（字号/格式菜单、颜色面板、链接编辑层、图片三种白卡）+ 二级菜单，全部改 `position: fixed` + **项目单一来源** `placePopoverPosition` / `placePopoverBeside`（`src/hooks/topMenuPosition.ts`，目录右键同款：下方优先 → 放不下翻上方 → 夹进视口；子菜单贴右 → 放不下翻左侧）。
  - 关键补充：**再夹进「编辑器区域」**（`clampToEditorArea`）。因为浮栏层序低于目录栏/顶栏/大纲，只按视口夹会让菜单跑到**目录栏底下被盖住**（= 看不见，正是用户要避免的）。
  - 实测：视口 900×620 + 选中最靠右文字 → 菜单 `590..817` 完全在视口内且 `elementFromPoint` 命中菜单本身；子菜单自动翻到主菜单**左侧**（`379..588`）。
- **AI 交互期间保留原选区高亮**（用户报「点 AI 后选中的文字高亮消失」）：
  - 根因 = AI 面板提问框 **`autoFocus`**：输入框一聚焦，浏览器就**折叠 DOM 选区**（实测 `getSelection().isCollapsed === true`）⇒ 原生高亮消失，不是内核丢了选区。
  - 修法 = 用**打开前捕获的 Range**（`aiRangeRef`，P2 做「替换选区」时留下的）**自绘一层高亮**：颜色取内核选区同一令牌 `--lake-select-bg`（内核 `--lakex-editor-selection` 即它，观感一致）；跟滚动/缩放重算；Range 失效（DOM 重渲染）就自动收起，不画假的；关闭面板即移除。渲染在**工具栏之外**（选区折叠后工具栏会 `return null`，挂里面会被一起卸载）。
  - ⚠️ **只在原生高亮已经没了的时候才画**（用户 261003 实测反馈「叠成了两层」）：`measure()` 先看 `window.getSelection()`，原生还非折叠就**一层都不画**，交给浏览器画；触发点 = `selectionchange` + `focusin/focusout` + 滚动 + 缩放。
  - 实测：打开面板（原生还在画）→ 自绘层 `exists:false`（不叠）；在提问框输入使原生折叠（`nativeCollapsed:true`）→ 自绘层出现、矩形与原文一致；点关闭 → 移除。
  - **试过"不自绘层"的替代方案并否决**（用户 261003 问「有没有不自绘层的修法」）：把捕获的 Range 塞回 `document.getSelection()`（云端 AI 插件"护选区"的思路）。实测两个致命问题：① 会把**输入框的焦点顶掉**、之后完全打不进字（`textarea.value` 不再更新）；② 触发 `selectionchange` **无限循环**（2 秒 22749 次）。根因：浏览器只在"document selection 所在的那个可编辑区"里画原生高亮，另一个输入框拿到焦点后旧选区无法保留 ⇒ **必须自绘**。
  - **样式对齐（用户 261003 反馈"样式不对"）**：原生是 `.ne-engine ::selection{background:var(--lakex-editor-selection);color:inherit}`——画在文字**底下**；自绘层盖在文字**上面**会把字色也染蓝、还多了 2px 圆角。改法 = `mix-blend-mode: multiply`（白底得到与原生同一色值 `255*.84+91*.16`，黑字仍是纯黑 ⇒ 4× 放大截屏逐像素一致）+ 去掉圆角。
  - **去抖（用户 261003 反馈"有点闪烁"）**：打字时每次 `selectionchange` 都会走到 `measure()`，无脑 `setState` 会反复重渲染 ⇒ 现在只在矩形**真的变了**（>0.5px）时才更新状态。
  - **高度按行盒撑开（用户 261003 反馈"高度不够、跨行露缝"）**：原生 `::selection` 按**行盒**（line-height）画，而 `Range.getClientRects()` 给的是**文字盒**（只到字形高，实测 21px vs 行高 30px）⇒ 跨行时两行的色带之间会露一条缝。现在取所在块的 `computedStyle.lineHeight`（`normal` 时按 1.6×字号兜底）把每个矩形**居中撑到行高**，两行自然首尾相接，与原生一致。
  - **零闪烁（用户 261003「还是有一点点闪烁」）—— 两个根因都修了**：
    ① **对话框换了树位置 ⇒ React 重挂载**：它原先在「工具栏可见时挂在工具栏内部、工具栏消失时挂在外层」，点进提问框（选区折叠 → 工具栏卸载）时整棵子树被重新挂载 = 闪一下。现在对话框与工具栏是**同一 Fragment 的两个固定槽位**，`!target` 分支也保留 `null` 占位（Fragment 按 index 对账，少一个槽位照样会换位置）。
    ② **原生 ↔ 自绘的交接帧**：面板一打开就把**原生选区色置透明**，自绘层从那一刻起一直画 ⇒ 全程没有交接。两个必须（两条都踩过）：
       · 规则要写在 **`src/styles/kernel-theme.css`（未分层）**，不能写组件 CSS（overlay 层）——**层序里未分层普通声明压过所有分层普通声明**，写在 overlay 层会静默失效（实测 `getComputedStyle` 仍是原色）。
       · 规则要**同时指到 `.ne-engine` / `.lakex-default-theme`**：CSS 变量取**最近祖先**，而内核运行时注入的 `<style>` 把 `.lakex-default-theme{--lakex-editor-selection:rgba(27,162,227,.2)}` 挂在**引擎元素**上，只写挂载点（在更外层）会被"就近"盖掉 ⇒ 点 AI 后**两层叠加、颜色变深**（用户 261003 截图实证）。
       最终规则 = `.lake-editor-mount.lake-ai-sel-hidden, .lake-ai-sel-hidden .ne-engine, .lake-ai-sel-hidden .lakex-default-theme { --lakex-editor-selection: transparent; }`（(0,2,0) > 内核那条 (0,1,0) ⇒ 胜出，仍不需要 `!important`）。
  - **零闪烁实测（MutationObserver 事件流）**：打开面板 → `mount-class suppressed` 与自绘层挂载在**同一帧**（13ms 内）完成；之后「点进提问框 → focusin → selectionchange collapsed」以及连续打字，**全程没有任何 `mount-class` / 宿主 DOM 变更** ⇒ 视觉上完全不闪。用户另选了别的文字时会把选区还给原生（否则他看不到自己新选的内容）。
  - **「点 AI → 点面板 → 再点 AI」的两个坑（用户 261003 报，都已修）**：
    ① **面板飞到右上角**：AI 按钮原先每次都按"当前选区"重算锚点，而此时选区已被面板输入框折叠 ⇒ 量到空矩形 ⇒ 锚点变 `null` ⇒ `AiAssistantDialog` 的 `fallbackAt`（**右上角，那是给顶栏入口用的**）接管。修法：① 再点 AI = **面板消失**（用户定稿；不做开关态、不加 `checked`）；② 打开时**只在量到有效矩形时才更新锚点**，拿不到就沿用上次的。
    ② **关掉后面板一消失、选区也没了**：面板输入框把 DOM 选区折叠过，直接关就什么都不剩。修法：关闭统一走 `closeAi()` —— 关面板 + **把捕获的 Range 设回 `document.getSelection()`**（延一帧、并 `execCommand("focus")` 把焦点还给编辑器），原生高亮随即回来。
    实测流水：点 AI（面板在 `(280,205)`、`selCollapsed:false`）→ 点面板（`collapsed:true`、自绘层仍在）→ 再点 AI（**面板消失 + `collapsed:false`、选区原样回来**）→ 再点 AI（重新打开仍在 `(280,205)`，不再飞右上角）。
- **格式菜单「行内代码」不回显（用户 261003 报）**：改用错了判据 —— `code` 属内核 **moremark 家族的状态型命令**，checked 的判据是 **`queryCommandState('code') === 1`**（内核自己的写法，bundle moremark 段：`checked: r === 1`、`disabled: r === -1`），**不是** `queryCommandValue`（那是 bold/italic 这类普通 mark 用的）。已把 `marks.code` 从 `isMarkActive(q("code"))` 改成 `isCommandExecuted(st("code"))`；已回填 `docs/LAKEX-CONTRACT.md` 命令表。实测：应用后父入口图标变 `editor-inlinecode`、按钮高亮、菜单「行内代码」打勾、tooltip「格式 · 行内代码」。
- **调研结论（已排除，避免重复投入）**：morphicons（https://www.morphicons.com）**不是图标库**，是"两个**描边**图标之间的形变动画引擎"（MIT、~6-8KB gzip、零依赖）。内核那 325 个图标是**填充**图标（`fill="currentColor"` 236 处 + 硬编码灰阶）且带 `<g>`/`transform` —— README 明确：纯填充会在解析期报错、不支持 `<g>`/`transform` ⇒ **内核图标一个都换不了**（要换=改 vendor，红线）；我们自己那 57 个文件用 `lucide-react`（描边，兼容），但它只吃 vanilla `lucide` 的**数据**、不吃 `lucide-react` 组件 ⇒ 等于给图标开第二个来源。**用户 261003 决定先不做。**
- 门禁：`tsc` ✓ · vitest **1537 passed / 16 skipped** ✓ · 桌面 + 移动构建 ✓ · `ui-metrics`（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · `check:core` 0 违规 ✓ · `git diff --check` ✓。
- **本批未验证（诚实边界）**：移动端设置抽屉（共用同一套原语，但只加载自己的 CSS，本批**未跑模拟器**）；深色/暖色主题未逐屏对拍；窄窗（<800px）下目录栏为浮层盖住编辑区时，菜单仍可能被该浮层压住（那种布局通常也选不到被盖住的文字）。
- 改动文件：`SettingsPanel.tsx` · `settingsPrimitives.tsx` · `editorCommands.ts` · `selectionToolbar/SelectionToolbar.tsx` · `selectionToolbar/selectionToolbar.css` · `styles/feature.css` · `styles/kit.css` · `styles/overlay.css` · `styles/components.css` · `styles/cssLayers.test.ts`。

### 当前批次 · 261003-AIFIELD（多维表 AI 字段 + Markdown 字段 · 已实施待验收）
- 用户定稿路线：**不做飞书式 AI 单元格操作**；`ai` 字段——**命令里用 `{{字段名}}` 字段变量**（「插入字段」可插多个、生成时**原位替换**；不再拼字段值列表）、值为文本快照、**手动生成/不自动重跑**；**261004 追加**：新增 `markdown` 字段类型，**AI 字段默认按 Markdown 口径**（单元格去标记单行预览 + 悬停「展开」→ 浮窗**编辑/预览**双模，模仿钉钉；AI 面板头部带「重新生成」、**值可手动编辑**）。任务定义见专项文档 §7 批次 G，明细见 §11/§13。
- 实现：core（`ai` 类型 + `{prompt}` 单一来源 + `buildAiFieldMessages`/`aiPromptFieldNames` + 重命名联动 `renameAiFieldToken` + `markdown` 类型并入文本口径 + CSV 拒绝导入 AI）；渲染器 `markdown.tsx`（常用子集、React 元素、不用 innerHTML；表格/图片首版不做）；单元格（AI 状态机 + `MarkdownCell`；展开浮窗抽出**共用壳 `ExpandPanel`**，文本格同款）；列菜单「AI 生成整列」（仅空缺/全部、确认、进度、取消、失败重试）；并发 3、整批 `beginGesture/endGesture` = **一次撤销**；只读无入口（展开只给预览）；移动端文本回退。**无新 IPC、无新依赖**。**261004-b 样式归位（用户指出后按官方审计收敛）**：编辑·预览走 kit 的 `.ln-segment`、说明文字 `.bt-field-label-text`、告警 `.ln-tag--error`、「插入字段」`.bt-secondary`；删繁写头与自写小按钮；两 CSS 字号/间距/圆角全量化令牌（官方审计 lookalike 0.86→0.61、重复族清零；基线 43→32 / 67→59）。**261004 续**：展开浮窗**尺寸本地记忆**（`text`/`md` 各一份、松手写盘、只记大小）+ `.bt-md-cell` 右缘留位（与文本格 26px 同义，两格都不压字）。
- 门禁：tsc ✓ · vitest **1586 passed / 16 skipped** ✓ · check:core 75 文件 0 违规 ✓ · ui-metrics（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · cssLayers+uiPrimitives ✓ · 桌面 + 移动构建 ✓ · 本改动范围 `git diff --check` 干净（仓库级报错在另一会话在途的 vendor dist，未触碰）。
- 真实端 CDP **23/23**（隔离实例 + mock OpenAI）：插入字段 → `根据{{文本}}` 原位替换；Markdown 字段展开编辑→预览→落盘；AI 值 MD 预览 / 展开 / 手改落盘 / 「重新生成」回写；展开浮窗拖动/缩放不回弹 + **重开沿用记住的大小（480×320）**；整列空缺 2/2；**一次 ⌘Z 撤销整批**（单格结果保留）；锁定入口消失/值保留；解锁恢复。
- **未提交（待验收）**；Android 未跑（移动端代码本批未改）；**图片/附件内容（多模态）不做**（用户 261004 决定：只传文件名）。

### 当前批次 · 260930-AI-P0（已实施，本轮提交）
- 目标：为产品接入**可配置供应商**的 AI（P0 只做 OpenAI / OpenAI 兼容），**结构按多供应商切换预留**（新增一家 = core 目录加一条 + 设置下拉自动出现，IPC/渲染层不动）。
- 架构红线：Key **只在主进程**（渲染层 CSP connect-src 只放行 self/本机，已挡死外发）；密钥走 `SecretCipher`（safeStorage/Keychain，**fail-closed**）；`ai_settings` 是**独立 settings key**，不入同步/S3/备份。
- core：`src/core/aiProviders.ts`（`AI_PROVIDERS` 目录 + 设置规整/脱敏/合并；视图只给 `hasApiKey`）。
- main：`electron/ai/aiClient.ts`（官方 `openai` SDK + 任意 OpenAI 兼容 baseURL；流式/连通性/错误归类；可注入 factory 便于单测）；`electron/ipc/registerAi.ts`（`ai_get_settings` / `ai_save_settings` / `ai_test_connection` / `ai_chat`（handleEvent，`ai:stream` 推流）/ `ai_cancel`）。
- IPC 同步四处：`registerAi.ts` + `preload.cjs` + `native.ts` + `webApiServer.ts` 的 `WEB_METHODS`（有测试卡一致性）。
- 依赖：`openai@^7.25.0`（Apache-2.0、0 依赖、CJS；主进程 external 自动派生）。
- UI：设置页新增「AI」分类（供应商 / 模型 / Base URL / API Key / 温度 / 测试连接）+ `settingsSearch` 条目；渲染层 `src/lib/ai.ts`（load/save/test/runAiChat 流式/cancel）。
- 真实端验证（mock OpenAI + 隔离实例 + CDP）：保存设置 → `aiTestConnection` `{ok:true}` → 流式对话 deltas `["hello"," from"," mock"]`、最终文本 `hello from mock`；主库 `ai_settings` 落盘为 `enc:v1:` 密文、**无明文 Key**。
- 门禁：tsc / vitest **1523 passed / 16 skipped** / check:core 74-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。
- 动作入口：编辑器**选区浮动工具栏「AI」** → `AiAssistantDialog`（预设 润色/译成中文/译成英文/总结/自定义 → 流式输出 → 复制 / 替换选区；**结果不自动改写正文**，由用户决定）。真实端 CDP：拖选文字 → 工具栏出「AI」→ 对话框带入选区文本 + 5 预设 → 生成 → 流式 `hello from mock`。
- **P1 已完成**：①供应商切换（目录加 DeepSeek / 自定义 OpenAI 兼容端点；按 `editableBaseUrl` 收口 Base URL；切换即按该家默认初始化）②顶栏「更多」→「AI 助手」入口（无选区也能用，默认「自定义」）③对话**多轮**（消息线程 + 追问）。真实端 CDP：切 deepseek 自动建配置（`https://api.deepseek.com/v1` / `deepseek-chat`）；顶栏入口默认「自定义」；两轮追问 `echo:写一句问候` / `echo:再翻译成英文`。
- **④ 的诚实结论（未做到替换）**：模态对话框会折叠内核选区 ⇒「替换选区」三次尝试（DOM Range 恢复 / 浏览器 insertText / 内核 insertAtSelection）**都退化为『插入到原选区起点』**，且内核 Cmd+Z 未恢复改动。**按钮已改名「插入到光标处」**，不再承诺替换。真正替换需用内核 modelRange：`engine.transformDOMRange` + `renderer.kernel.createModelRange` 构造后走 `insertAtSelection(format, data, modelRange)`（契约 §5.8）。**260930 续**：已按此写适配并把 modelRange 作第三参传入，实测**直接 no-op（文档毫无变化）** ⇒ 取值形状未对齐；**已回退到可用的插入路径并删掉该适配**。再做需运行时打断点确认 `transformDOMRange` 返回的真实结构。 **260930 运行时诊断（决定下一步）**：`editor._engine.transformDOMRange(range)` 与 `editor.renderer.toViewRange(range)` **实测都返回 null**（不是形状问题，是 DOM→view 映射不成立；`transformDOMRange` 内部正是 `renderer.toViewRange` + `view.getModelRangeInfo`）。另外 Overlay `Dialog` **有焦点陷阱**——从模态框内回写编辑器选区在架构上互斥。**推荐下一步**：把 AI 结果面板从模态 `Dialog` 换成非模态 `Popover`（不抢焦点/不锁焦点），编辑器保持选区 ⇒ `insertAtSelection` 天然就是替换；否则就保持现在这个诚实的「插入到光标处」。 **260930 再试（已回退）**：回写前 `editable.focus()` + 恢复 DOM Range + `insertText` ⇒ **变成彻底 no-op**（浏览器改了 DOM、内核模型没跟），比插入更糟，已回退。 **260930 读源码**：`renderer.toViewRange(range)` → `dM(renderer, range)` → `dF(renderer, node, offset)` 用 `cv(domNode)` 找 view node；我们的 range 就断在第一跳（`cv` 拿不到该 DOM 节点的 view node）⇒ 返回 null，因此**构造不出 modelRange**。要继续需搞清 `cv`/view-node 注册机制（或换 `editor.getUIInjector()` 一类入口），不是改参数形状能解决的。 **260930 重大发现（云端取证，BrowserSkill + Edge）**：云端语雀的 AI 面板是**内核插件**——`pluginRegister({pluginName:"ai", command:{aiInsert, aiInsertCard, aiDelete}, service:{IAIEditorService, IAIViewerService}, toolbar:{deepSeek}})`，选项 `{api:"", showSelectToolbar:true}`；「替换选中内容」= `execCommand("aiInsert",{dataType:"text/plain",data,select,insertAtAfter:false})`，「插入选区下方」= `insertAtAfter:true`。它**不做 DOM→view 映射**，用的是**内核模型选区** `kernel.document.selection.firstRange`，并用 `execCommand("selection",{ranges:[{start:{node,offset},end:{node,offset}}]})` 设回。**我们 vendored 内核没有 `ai` 插件**（更旧的构建），但有 `selection` 命令与 `insertAtSelection`；已按「捕获模型选区 → 回写前 selection 设回 → insertAtSelection」实现（`src/features/editor/selectionToolbar/aiModelSelection.ts`）。⚠️ 自动化拿不到非折叠的内核模型选区（合成拖选后 offset 仍 0/0），替换与插入无法自动区分；**正解是把内核升级到带 `ai` 插件的构建**（或启用该插件）。 **260930 官方文档核对（yuque-developer-docs/08 命令列表）**：替换类命令有两条，**都依赖「内核当前选区」**——`insertText(text)`「在当前选区插入文本，非闭合选区则替换选区内容」；`insertAtSelection(format,data)`「选区非折叠时被选中内容被替换」。**官方文档里没有任何 AI 命令**（`aiInsert` 是云端私有插件，未文档化）。实测：聚焦编辑器 + 恢复 DOM Range + 等 30ms 再执行内核 `insertText` → **仍然无变化**，说明内核始终没把我们恢复的 DOM 选区同步成模型选区；配合前一条（`selection` 命令 `setStart` 报错、`toViewRange` 返回 null），**现有 vendored 内核无法程序化建立非折叠选区**。云端能工作是因为它的 AI 插件自己设 `plugin.ignoreSelectionChange=true` 护住选区（我们内核无此插件）。⇒ **结论未变：正解是把内核升级到带 `ai` 插件的构建**。

### 260930 · AI 接入收尾（整理 / 查漏补缺）
- **全链路**：设置（供应商 → Base URL → API Key → 模型 → 高级项）→ 草稿式连通验证（`ai_test_connection` / `ai_list_models` 收草稿、回传 `retryable`）→ 会话（多轮 / 流式 / 取消）→ 回写（替换选区 / 插入到选区后 / 重新生成）。
- **本轮整理**：删除死字段 `AiProviderDef.modelsPath` 与 `editableBaseUrl`；去掉 `normalizeAiError` 间接层（统一 core 的 `aiErrorMessage`）；测试直接测 core 归类；确认 AI 面板无死 CSS 类；更新对话框过时注释（预设已移除）。
- **已知局限（非阻塞）**：①「插入到选区后」是「原文 + 空行 + AI」**组合写回**，AI 落在**选区结束处**另起段落，不是整段之后（内核无 `aiInsert{insertAtAfter:true}`，且"折叠模型选区"内核不接受 —— 见 `docs/LAKEX-CONTRACT.md` §5.16）；②未做多模态；③真实云 chat 已用 DeepSeek 验（流式/思考参数/401/模型名 400），**超长输入的提示文案未验**。
- 依据：`docs/LAKEX-CONTRACT.md` §5.16（内核侧）+ §5.17（供应商侧）。
### 260930 · AI 设置流程重做（goal 完成）
- 按用户确认的 7 步重做 `SettingsPanel` 的 AI 段，**草稿式**：编辑先落 `aiDraft`，拉列表/测试通过后才写回。
- ①供应商（说明"只支持 OpenAI 兼容"）②Base URL 预填默认可改+恢复默认 ③API Key 已保存/更换（编辑态才带 Key）④获取模型列表=轻量连通验证 ⑤模型单选手填（datalist）⑥高级：思考强度/思考模式/温度**按供应商能力显示** ⑦测试并保存：分级 gate。
- **分级 gate**：`ai_test_connection`/`ai_list_models` 回传 `retryable`；鉴权/模型类**硬拦**（无"仍要保存"按钮），网络/限流**可仍要保存**。字段级错误按归类贴到 apiKey / baseUrl+model / 整体。
- 实测（隔离实例 CDP）：OpenAI 下渲染 provider/baseUrl/key/model/reasoning/temperature；切 DeepSeek 后出现 thinking 且温度按思考模式隐藏；断网 → "网络不可达"+"仍要保存"；**401 → Key 行贴错且无"仍要保存"**。
- 坑：`fieldErrorFor` 必须**先判 `retryable`** 再按文案匹配——断网文案里含 "Base URL" 字样，先匹配会把网络错误误贴到 Base URL 字段（已修）。
### 260930 · AI 错误归类与重试职责（真实 SDK 实测后修正）
- **实测方式**：本地起一个 OpenAI 兼容 HTTP 端点，走**真实 openai SDK + 默认工厂**跑 401/429/500/正常 SSE/端口不可达（`electron/ai/aiClient.http.test.ts`，5 项全过）。
- **实测揪出两个真问题**：① SDK **默认自己就重试**（`maxRetries:2`），我又加了一层 ⇒ 双重重试（429 实测 3.2s、请求数超预期）；② 连接失败时 SDK 抛 `APIConnectionError`、message 只有 `Connection error.`，**只按状态码/关键词匹配永远归不了类**。
- **修法**：重试统一交给 SDK，显式 `maxRetries: 1`（去掉手写重试循环，避免双重重试与重复输出）；错误归类抽到 `src/core/aiErrors.ts`（纯函数 + 12 项单测），**先按 SDK 错误类名**（AuthenticationError/RateLimitError/APIConnectionError/APIUserAbortError…）再按 status/code，并区分「限流」与「额度不足」。
- 遗留：真实**供应商**（DeepSeek/OpenAI 云）端到端仍未跑，需要用户提供 Key；本轮的本地端点已覆盖协议、流式与错误路径。
### 当前批次 · 260930-AI-P2（已实施，本轮提交并推送）
- **④ 达成 ✅**：「替换选区」+「插入到选区后」都可用。机制 = 打开 AI 面板前捕获**内核模型选区**（`kernel.document.selection.firstRange`），回写时用内核 `selection` 命令设回（替换=原范围；后插=折叠到 `end`），再 `insertAtSelection`。真机（真实鼠标）实测：**替换成立、⌘Z 可撤销**。原理/反面教材见 `docs/LAKEX-CONTRACT.md` §5.16。
- **闪烁根因（已修）**：AI 对话框是 Overlay 浮层、不在浮栏 DOM 内，点它触发浮栏 `onPointerDown` 的「按住即隐」⇒ 浮栏消失又出现。修：`useSelectionToolbar` 对 `.ln-dialog/.ln-scrim` 内的 pointerdown 直接 return。
- **「插入按钮点不了」根因（已修）**：AI 对话框原先渲染在浮栏 JSX 内部，浮栏 `if (!target) return null` 时被**连带卸载** ⇒ 状态清零。修：对话框提到早退之外（`const aiDialog` / `if (!target) return aiDialog`），并让 `holdRef` 在 `aiOpen` 时冻结。
- 踩坑：**合成拖选进不了内核模型选区**（`firstRange` offset 恒 0/0），CDP 合成鼠标**验证不了**替换/撤销，必须真实鼠标 —— 前几轮「替换失败」的结论是被这个测试缺陷误导的。

### 当前批次 · 260930-LOCK（已实施，本轮提交并推送）
- 用户 260930：只读锁做成**文档级、按类型统一**的入口，并让"锁"真正落到**内核层**（不能只隐藏工具栏）。
- **目录栏右键**加入口「锁定（只读）/ 解锁」（与 重命名/历史版本/属性 同组）；`toggleNoteLock(targetNoteId?)` 泛化 ⇒ **不必先打开**文档即可锁；`Sidebar` 增 `lockedNoteIds` / `onToggleLockNote`。
- **目录行锁标识** `.tree-row-lock`：行尾常驻小锁。踩坑：`.tree-row` 是**固定 4 列 grid**，插第 5 个子元素会把「⋯」挤到下一行（用户报换行）⇒ 列定义 4→5，且**锁格每行都渲染**（未锁为空）保证「⋯」恒为末列。
- **画板内核级只读**（vendor LOCAL-CHANGE #22）：`DrawnixBoardCore` 原来只在 `afterInit` 设一次 `board.options.readonly` ⇒ **已打开**的画板锁定后仍可编辑（思维导图还能加节点、画布仍可编辑）。改为 `React.useEffect([board, readOnly])` 运行期同步；宿主 `BoardEditor.handleCoreChange` 另加 `readOnlyRef` 兜底。**重建 vendor dist（chunk 增删改，需一并提交）**。
- **表格内核级只读**：上游 `@fortune-sheet/react` 的 `InputBox` 只按**行/列级** `rowReadOnly/colReadOnly` 判定，不看全局 `context.allowEdit` ⇒ 锁定时输入框仍 `contentEditable=true`（能敲字、提交被内核丢弃）。在**已有 patch** 里加 `context.allowEdit === false ? false : …`，用 `patch-package` 重建 `@fortune-sheet+react+1.0.4.patch`（注意 `patch-package` 会调 x86 git，需 `PATH="/usr/bin:…"`）。
- **状态栏「已锁定」可点解锁**（方案 B）：**只有锁胶囊可点**（`button.document-statusbar-lock` + `pointer-events:auto`），点开 `Popover`「本文档已锁定（只读）／解锁」；「表格」「同步状态」保持**纯展示、不可点**（可选中文字）。App 传 `onUnlock`。
- **表格只读工具栏**（260930 续）：只读时工具栏只留**视图类**——批注查看 / 定位条件 / 查找（`TOOLBAR_ITEMS_READONLY`）。依据内核 `allowEdit` 门禁：加粗/对齐/边框/合并/排序/筛选/冻结/链接/快速公式/批注增删改全部直接 return，留着就是"点了没反应的死按钮"；`cell-image` 是**插入图片**（写操作）故只读下不出现（查看已有图片走点单元格里的图片，菜单只读时已去「删除」）。
- 护栏：`sidebarContextMenu.test.ts` · `boardEditorMount.test.ts` · `sheetEditorMount.test.ts` · `desktopStatusBar.test.ts`。
- 真实端 CDP：目录栏锁**未打开**的文档 → 树行出现小锁 → 打开即只读；画板 `board.options.readonly` false→true→false；表格 `contentEditable` 未锁 true / 锁定 false 且真实按键进不去；状态栏点表格/同步**无浮层**、点胶囊出浮层、点「解锁」生效。
- 门禁：tsc / vitest **1515 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。

### 收口 · 260930-按文档保存状态（已提交 `a640af2`）
- `useSavePipeline` 的 `saveState` 由**全局单值**改为**按文档** `saveStates: Record<noteId, SaveState>`；`setSaveState(noteId, state)`；App 的 `getDocumentStatus` 只取**活动文档**那条（缺记录时回落到该标签的 `dirty`）。⇒ 后台文档保存不再污染当前文档状态栏。
- 顺带删除死状态 `lastSavedAt/setLastSavedAt`（全仓无消费者）。
- 改动：`useSavePipeline.ts` · `useDocumentTabs.ts` · `useTabLifecycle.ts` · `App.tsx`；新增 1 条「按文档隔离」单测。
- 门禁：tsc / vitest **1508 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。**不改**保存/落盘/revision 语义（只改状态归属）。
- 已提交 `a640af2`。

### 修复 · 260930-状态栏闪烁（已提交 `9866024`）
- **现象**：当前文档底栏状态在「保存中 ⇄ 待保存」高频摆动（~2s 一次），看着一直闪。
- **根因**：一个隐藏的**表格 tab**（keep-alive）里 `<Workbook onChange>` 是**内联箭头**（每次 render 新身份），而 FortuneSheet 内核的 onChange effect **依赖该身份** ⇒ 每次 render 都回调 onChange ⇒ 无条件 `scheduleSave()` → `onDirty` → **全局** `saveState` 变脏 → render → 再回调，形成 dirty↔saving 死循环；而状态栏的 saveState 是**全局单值**，于是当前多维表的状态栏被隐藏表格的churn带着闪。
- **修法**：SheetEditor 给内核传**稳定身份**的 `handleWorkbookChange`（`useCallback([])`，逻辑走 `workbookChangeRef` 指向最新闭包），函数体逐字不变、行为等价，只断掉"身份变化→伪回调"这一环。
- **验证**：真实 dev 实例（9222）修复前每 2s 一次 `dirty→saving→dirty`；修复后 6s 内只剩一次 `local-only`，表格 tab 从 `[dirty]` 变干净。门禁：tsc / vitest **1506 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；新增 1 条身份护栏。
- 已提交 `9866024`。

### 当前批次 · 260930-BTCHROME（已提交 `5864845`）
- 多维表**右上角「更多」菜单**（视图页签行最右；`BitableViewBar` 新增 `trailing` 槽）：**搜索 / 导出为 CSV / 锁定当前文档（只读）**；搜索从工具条移入菜单（内联查找框仍在工具条下方）；锁定复用文档的 `setNoteLocked`。
- 接线：App 的 `toggleNoteLock` / `exportNoteById(noteId,"csv")` → DesktopLibrary → MultiTabEditor → BitableEditor（新增 `locked` / `onToggleLock` / `onExportCsv`）；`bitableViews.css` 新增 `.bt-viewbar-trailing`（baseline 138→141）。
- 门禁：tsc / vitest **1506 passed / 16 skipped** / check:core 73-0 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；真实端 CDP：菜单=搜索/导出为 CSV/锁定当前文档（只读），搜索出内联框，锁定后「添加记录」禁用且菜单变「解锁当前文档」，解锁后恢复可编辑（「导出为 CSV」因弹系统目录框未自动点击，仅验存在）。
- 已提交 `5864845`（与 SIDEMENU/CSV 同一提交）。

### 当前批次 · 260930-SIDEMENU（已提交 `5864845`）
- 目录栏右键菜单优化（用户 260930）：① 「新建文档/新建表格/新建数据表/新建画板/新建分组」收进**「新建」子菜单**（复用 Overlay `Submenu`，同一组创建动作只占一行）；② 右键菜单**去掉「打开文件位置」**（属性弹窗 `NoteInfoDialog` 仍保留）。
- 门禁：tsc / vitest **1503 passed / 16 skipped** / check:core 73 文件 0 违规 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；真实端 CDP：笔记右键 = 新建/重命名/历史版本/属性/导出/删除（无「打开文件位置」），「新建」展开为 5 项；笔记本右键同类。
- 已提交 `5864845`。

### 当前批次 · 260930-CSV（已提交 `5864845`）
- 用户 260930 定调：**只做 CSV 导入导出（D02 JSON 不做）**；导出菜单**按文档类型拆分、不混用**；**彻底删除「导出为原生 Lake」**；CSV 用**主流通用格式**（Excel 通用）；sheet/board 先做**占位**（表格 CSV/Excel、画板 PNG/SVG，逻辑后续）。
- 已实施：新增 core `src/core/bitableCsv.ts`（UTF-8 BOM + CRLF + RFC4180 导出；首行表头 + 列映射 + 坏格丢弃的导入）；bitable 右键/⋯「导出为 CSV」+ 工具栏「导入 CSV」（映射对话框 `BitableCsvImportDialog`）；新增 `export_bitable_csv` / `pick_import_csv` 两个 IPC；导出菜单按 kind 拆分并删除 Lake 导出。
- 门禁：tsc / vitest **1501 passed / 16 skipped** / check:core 73 文件 0 违规 / ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿。
- **真实端 CDP 已做**（隔离实例、按端口精确回收）：CSV 导出真实 IPC 落盘（BOM/CRLF/`"甲, 乙",TRUE`/无磁盘名）；右键导出菜单 bitable=CSV、doc=Markdown/HTML/PDF、sheet=CSV·Excel 占位、board=PNG·SVG 占位，**全页无「原生 Lake」**；bitable 工具栏有「导入 CSV」。**未自动化**：导入的文件选择走原生 NSOpenPanel，导入端到端未跑（core 有单测）。sheet/board 占位无逻辑。明细只在专项 §11/§12/§13。
- 续：新增**多维表「导出为压缩包（含附件）」**（自写 store 方式 ZIP，无新依赖）：zip 内含 `{表名}.csv` + `附件/{文件名}`，附件/图片真实文件一并打包、同名自动 (2)、CSV 指向归档内相对路径；真实端用 ditto/bsdtar/Python `zipfile` 校验通过（Apple Info-ZIP `unzip` 不认 UTF-8 名属工具限制）。
- 已提交 `5864845`。

### 当前批次 · 260930-AR01（已实施，用户授权合入推送后停止）
- 隔离分支 `codex/bitable-ar01`，worktree `/Users/admin/file/local-lake/lake-notes-electron-worktrees/bitable-ar01`；本批为编辑会话/写入/导航历史/快捷键/只读草稿/共享预览所有权收口。**实际改动及验证只在专项 §13 最新记录 / §17.11。**
- 全量测试 **1441 passed / 16 skipped**、tsc/core/CSS/原语/双端构建通过；11 个新行为测试。**真实 Electron 验证不完整：列宽 redo 断言失败（未定位产品或驱动原因），后续只读草稿与预览完整流程未走完；Android 未实测。功能保持待验收。**
- 用户明确“不要验证了直接合并到 master 并推送远程”，且授权与另一会话只读审计文档一起提交。保留 `docs/NON-BITABLE-ENGINEERING-AUDIT-2026-09-30.md` 与 `docs/audit-evidence-2026-09-30/`，不实施其中方案。
- **已合入 master 并推送成功**：`9535ed91`「fix(bitable): AR01 会话安全收口并记录整体工程审计」，包含本批代码/讨论记录与另一会话审计文档。已停止后续验证和开发；AR02–AR04 未开始。提交授权不代表功能验收通过。

### 当前批次 · 260930-AR02（第一段已实施，待验收；未提交/未合 master）
- 用户确认按**路线 B（有边界的内部重构）**继续推进。本批从 AR02 起步，只取「字段删除 / 单元格写入 / 记录新增 / 附件回填」这一切口：新建 `src/core/bitableMutations.ts`（`stripFieldFromView` / `deleteBitableField` / `setBitableCellValue` / `setBitableRecordValues` / `appendBitableAttachments` / `addBitableRecord`，无变化一律返回原引用），`BitableEditor.tsx` 的内联删除清理与各写入动作全部改调 core；**附件回填改为捕获发起上传时的 tableId**（切表后不再写到「那时的当前表」）。
- 隔离分支 `codex/bitable-ar02`（主工作树，未新建 worktree）：全量 **1451 passed / 16 skipped**，tsc / check:core（70 文件 0 违规）/ ui-metrics / cssLayers+uiPrimitives / 双端构建 / `git diff --check` 全绿；新增 9 例纯函数单测 + 1 条挂载护栏，并更新 3 处只认旧内联写法的源码护栏指向新单一来源。
- **未提交、未合 master、未推送**；未跑 Electron CDP 真实端点与 Android；AR02 的 core 按依赖拆分、AR03/AR04 未开始。功能保持待验收。明细只在专项 §11/§13。

### 260930-AR03/AR04（已证实热点优化 + 真实端性能前置）
- 用户要求「继续推进到 AR04」。已做 AR03 的**已证实热点**：AR-F5 选区逐格命中改行/列索引、AR-F6 `relationTargetRecords` 改按 `records` 引用缓存、字段序收敛到 `orderedAllTableFields`；新增 `relationIndex.test.ts`。
- 同一分支 `codex/bitable-ar02`：全量 **1453 passed / 16 skipped**、全门禁 + 双端构建通过；CPU 前置基准：3000×15 选区 228.8ms→1.2ms、3000×3000 关联 389.4ms→0.7ms。
- **AR04 真实端已完成**：行为验收 7/7 通过（关联 chip / 选区四边 / 列菜单删除字段：移除+对侧降级+数据保留+视图配置清理）；压测工具 scripts/bitable-stress.mjs，目标 5000×20 打开 **12.42s / 84.8 万 DOM / 395MB / 首次点选 2.25s**，10000×20 = 24.8s/1.69M/1.34GB，20000×50（100 万格）200s 未完成，**50000×50 因正文 >32MiB 直接存不下**。结论：CPU 热点已消除、**DOM 全量渲染是瓶颈**，行虚拟化需单独立项，等用户拍板。
- 仍未提交/未合 master；未跑 Android；AR02 的 core 拆分与 AR03 结构拆分未做（无实测收益前停止）。

### 260930-B（AR-F7 续已实施，待验收；未提交/未合 master）
- 表单提交双向关联镜像、复制关联字段不继承配对、字段类型变更清视图引用、「加进本组」系统时间护栏、动态日期在切回可见/聚焦时刷新计算时点；core bitableMutations.ts + 4 例新单测。
- 全量 **1457 passed / 16 skipped**、全门禁 + 双端构建通过。仍未提交/未合 master。
- C（结构拆分/循环依赖）与 D（真实端收尾/Android）未实施；见专项 §17.12。

### 260930-D（真实端收尾 + 整体 UI 回归）
- 列宽 redo 澄清为驱动假象（真实端 260/180/260，通过）；关 tab 保留通过；整体 UI 回归 13 项通过（统计/五视图/添加记录/新增字段/隐藏列/关联选择器/填色/筛选/搜索入口）。
- 只读草稿 IPC 仍未定论（需先提交输入再锁定复验）；共享预览仅 jsdom 覆盖；Android 未做。仍未提交/未合 master。

### 260930-S0（非多维表审计 S0 全部实施 + F03/F04 元数据尾收口，待验收；已合入 master 本地 42ad41b、未推送）
- 分支 codex/audit-s0（从 6a0ec68 开出）。唯一权威进度在 docs/NON-BITABLE-ENGINEERING-AUDIT-2026-09-30.md §12。
- 已完成：F09 · F10 · F07 · F05 · F11（第一批）· **F06 移动 create/save 分离（missing/gone 明确拒绝）** · **F01 保存失败不关闭/淘汰/锁定** · **F02 revision 快照入队前绑定** · **F04 恢复只按真实 gone 判只读 + 普通保存不隐式复活** · **F17 容量基准断言现契约**（第二批）· **F04 元数据写边界 fail-closed（删除 `revivePurgedIfNeeded` 隐式恢复最后入口）** · **F03 reload 取消按文档作用域（不同文档互不取消，全库同步用自己的 run id）**。
- 门禁：tsc 通过、全量 vitest **1486 passed / 16 skipped**、check:core 70 文件 0 违规、git diff --check 通过、opt-in 容量基准实跑通过；**桌面真实端 CDP `scripts/e2e-audit-s0.mjs` 16/16**、**安卓真实端 `scripts/e2e-f06-android.mjs` 6/6**（emulator-5554 + debug APK）。**绝不启动路线 C（正文入 SQLite）**；S1 DocumentSession 也未批准。
- 已知取舍：F06 的 bridge.saveNote 对"无墓碑的新 id"仍可初始化；F03 竞态在真实 hook（jsdom 受控延迟）层验证——`window.lakeNative` 被 contextBridge 冻结，无法向真实 App 注入读延迟，真实端覆盖两篇不同文档各自历史恢复都生效。

### 260930-S0 后续（C/B/A 捕获契约，已实施，待验收；已合入 master 本地 42ad41b、未推送）
- C：生命周期持久化闸门收敛为 `src/core/lifecycleFlush.ts` 单一来源（962f4b0）。
- B：新增 `scripts/profile-editor-input.mjs`（opt-in）实测多 MB 文档每键整篇序列化 ≈ 数十 ms；据此实施**捕获契约**（f994ee2 + 24a21cc）：EditorTab 每键只通知"有变更"、正文改在保存/草稿/关闭时按需 capture；删除 `MultiTabEditor.contentCache/reloadKeysRef` 第二份正文。
- 效果：2MB 单键 57.9→10.0ms、长任务 1761ms→0；桌面 e2e 17/17；全量 vitest 1490 passed / 16 skipped。
- 诚实边界：profile 脚本就绪判定不严（只信量级）；自愈竞态无真实端注入点；doc 每键不 setState 大字符串。

### 260930-S0 后续 D（F14/F15/Bitable，已实施，待验收；已合入 master 本地 42ad41b、未推送）
- F14：抽出 EditorErrorBoundary，错误边界给可点的「重试」（换 mount generation 重建子树），删除「切换标签即可恢复」空话；补 jsdom 行为测试（e6aab97）。
- profile：scripts/profile-editor-input.mjs 就绪判定加固（先等目标 tab active + 内容长度两轮稳定），可作可信性能基线（e6aab97）。
- F15：Sheet/Board/Bitable 一改动即标脏 + 注册按需序列化，关闭/退出/淘汰/锁定走捕获契约，消除「改完 <800ms 就关」丢最后编辑（87e5e4e + c726e23）。
- **F13 明确不做**（仅状态显示不一致、无数据影响）；**§6.1-#2 不做**。editorChangeGuard 仍在用，未删。
- 门禁：全量 1493 passed / 16 skipped；桌面 e2e 17/17。诚实边界：Sheet/Board/Bitable 的编辑→关闭未做自动化真实端（待人工抽验）。

### 260930-S2（过时路径清理，已实施；已合 master 本地、未推送）
- secretCipher.decrypt：非 enc:v1 不再返回明文，改为提示重配 + 空串（44eb4a0）。
- ssrf：删除只被自身测试调用的 assertSafeRemoteHost 预解析入口（44eb4a0）。
- syncAdapters：删除旧 FakeStore 的 `?.` 可选兜底，测试补齐完整 port（88c3f3f）。
- schemaInit：改用当前完整 DDL，删除逐列 ALTER / 旧 trigram 重建 / 旧 notes→tree seed 迁移（7986f22）。
- **暂缓（审计标注为条件删除）**：assetServer 旧 file/null origin —— 需真实浏览器核对 Origin:null/file:// 消费者后再删。
- 门禁：tsc / 全量 1488 passed / 16 skipped / check:core 71 文件 0 违规 / diff --check；全新 workspace 桌面 e2e 17/17。

### §6.1 剩余性能项测量（260930）
- **#4 音频兜底全工作区扫描**：CDP 计数 `document.querySelectorAll(音频选择器)`——1 标签 ~11 次、8 标签 ~53 次（≈6.6×标签数/前 6s）。**已修**（5c70b1c）：改为 `mount.querySelectorAll`，全局扫描 53→0、每次范围降到约 1/N；重试/清理逻辑不变。
- **#5 代码块水合扫描**：`host.querySelectorAll('.ne-codeblock')` 计数——8 标签总计仅 1 次（仅可见实例扫、交互期 defer）。**未测到高频，不作为问题**。
- **#6 保存后孤儿/历史 refs 扫描**：裸文档保存 ~1ms；500 资源 + 100 历史快照 ~7ms（增量 ~6ms/次）。量小，暂不改。
- 脚本：scripts/profile-save-orphans.mjs、scripts/profile-scan-counts.mjs（均 opt-in、隔离实例）。
- **状态：非多维表审计指定项全部实施完毕并合入 master 推送**；剩余项已归位（F16/S3 正式待办；F12/F13/S1/§6.1-#2 不做；F08 走 A、跨介质窗口有意不修；assetServer 旧 origin 待真实浏览器验证）。

### 当前会话 · 260930-ARCH（仅文档，待讨论）
- 用户要求多维表功能扩展暂告一段落，先只读评估整体代码与架构，再讨论是否需要大规模重构；**本轮不实施代码**。
- 当前源码 `ae1cfda`（条件填色、统一选色与筛选面板优化），工作树在本轮开始时干净、仅一个 master 工作树；本地 `origin/master` 跟踪引用同 HEAD（未联网 fetch）。**条件填色已提交**，下方旧描述的“未提交”是历史状态；功能验收状态不擅自变更。
- **完整讨论稿与证据只在专项文档 §17**：建议有限内部重构，不改正文格式/数据边界/五视图/资产与同步；优先解决隐藏标签写事件、只读写入/发布、撤销分类、重复预览宿主，并补行为测试。已确认问题尚未修复，AR01–AR04 未开始。
- 本轮重跑 tsc、全量 vitest（1430 passed / 16 skipped）、core/CSS/原语门禁；仓库外 React/jsdom + CPU 样本 9 用例确认现有问题。**未 build / CDP / Android 实测，未改产品代码、未提交或推送**。下一步先讨论专项 §17.10，不自动继续旧功能队列。

### 一、任务目标
- 用户 260928 启动「多维表功能扩展」专项：按专项文档 §8 顺序**逐编号实施、每个编号单独验收**——V01 多视图工作台 → V02 看板 → V03 画册 → V04 日历 → T01 列级统计 → **T03 多级分组（260929 废弃，改为单级）** → T04 语义排序 → T02A 基础字段 → T02B.1/.2/.3 关联 → T06 表单 → D01/D02 导入导出。
- 期间用户三次现场追加/纠偏（均已落地，细节见专项文档 §13）：
  1. 图片与附件**拆成两个字段类型**（image 复用附件值模型、上传侧只收图片）；图片预览范围**恒为单个单元格**（两列图片就是两类，绝不跨列合并）；**磁盘名绝不外显/不可编辑**。
  2. 表单视图加「编辑表单 / 预览表单」双模：编辑态**恢复 v1 原形态**，「填写表单」= 直接跳预览 tab（不做独立弹层）；已配置默认进预览、未配置默认进编辑。
  3. 看板图片字段上卡出**缩略图**（不显示文件名）；字段类型选择改 **2 列网格**（不分「基础/高级」组）；**创建/修改时间必须能参与筛选与排序**（这是修掉我之前设的假边界）。

### 二、已完成内容（提交状态见「提交」列）
| 编号 | 内容 | 提交 |
| --- | --- | --- |
| — | 专项文档建立 + HANDOFF §3.9 登记 | `c2aa11a` |
| V01 | 多视图工作台：视图类型开放集合 + 未知类型安全回退；视图壳拆 `BitableViewBar` / `bitableViews` | `b17f652` |
| V02 | 看板：单选字段分栏（空栏保留 / 未分组）、卡片、拖拽只写分组字段值、看板配置面板 | `b17f652` |
| V03 | 画册：封面取第一个图片附件、裁剪/适应、常规/紧凑、卡片字段 | `b17f652` |
| V04 | 日历：月网格 + 跨天展开 + 单选配色 + 拖拽保持时长平移（全程本地日期语义） | `b17f652` |
| 追加批 | image 字段类型；画册/表格/看板/表单预览单单元格；展示名守卫；表单双模 | `b17f652` |
| F01/F02/F03 | 文档图片预览改取**正文**（虚拟渲染下 DOM 不全）；附件命名审计；表单编辑态回退；看板缩略图 | `b17f652` |
| T01 | 列级统计：底栏统计行（通用/数字/日期口径）、视图级配置、随筛选现算 —— 260929 先整体删除、**同日恢复**（用户确认分组后需要按组统计） | `dbe70ae`（同日恢复） |
| T03 | 多级分组：最多 3 级 + 拖动调优先级 + 层级缩进（`groupRecordsTree`）——**260929 已废弃并回退为单级** | `9b80ede` → 本次回退 |
| T04 | 语义排序：单选/多选「选项顺序 / 选项逆序」；日期文案早→晚/晚→早 | `9b80ede` |
| T02A | 基础字段：布尔/链接/评分/进度/创建时间/修改时间（含默认值与进度配色） | `6f046df` |
| T02A-fix | **系统时间字段打通筛选/排序/分组**（记录级取值口径 `bitableFieldValue`）；其中「统计」部分随 T01 于 260929 回退 | `ef75e96` |
| style | 字段类型选择改 2 列网格；顺带修 T02A 漏 import CSS 的 bug | `3a39030` |
| V05 分组样式 + T01 恢复 | 分组头改**整行 56px**（折叠钮 + 分组值 + 每列统计，首列 `N 条记录`）；每组记录后 40px 圆形「加进本组」、顶级分组间 20px；列统计恢复并保留「无配置不显示空条」；**表格内「添加」统一为同一颗圆形 + 钮**（新增字段 / 添加记录 / 加进本组）；分组头**分组值优先占位、首列统计下限 80px（云端实测）、过长省略**，并修掉长文本撑开 `table-layout:auto` 造成的列错位；**V05 续四条**：列选中点外即清、分组汇总行固定 36px、分组头每列都有汇总位、底部汇总栏**常驻**（24px 贴视图底）+ 状态栏上移让位；**分组「加进本组」的 + 有独立行高（32px）但不画行线**（不嵌边线）**、已分组时表底那个 + 隐藏**；**T01 汇总方式逐字对齐云端 config**（只有第一列默认「记录总数」、其余默认空白且占位仅 hover、统计格 = 白底 chip + ▾、按字段类型给选项，进度无求和） | **已提交（待验收）** |
| 浮层定位 | **贴底翻上方**统一：垂直口径收敛到 `placeVertical`/`usePopoverPosition`；多维表日期/单选/展开面板/行菜单 + 标签/卡片右键改走实测定位 | `05b6a96` |
| T02A 续 | 评分：空星**实心** + 选中星对齐云端金（`--lake-rating-star`）；进度：**只留条 + 百分比**（数值框删除），可拖动/键盘可达/Delete 清空、只读不接指针 | `4e19df0` |
| 260929 UI 细节 | 分组重做为**单级白卡 + 边框/圆角**（删除多级树、添加分组、拖动优先级、层级样式）；`+` 行下边线清除；表底重复“共 N 条记录”清除；目录把手增加全局离开清理兜底 | **已提交（待验收）** |
| 260929-UI2 分组底衬 + 底栏收口 | 复刻云端「浅灰分组通道 + 白卡」：表头下 20px 间隙、加进本组/组间/表下空白统一走新令牌 `--lake-bg-subtle`（**不分组时表格下方空白同款**）；**数据表选择区 `.bt-tables` 也改用同一个灰**（原先更深的 `--lake-bg-block`，左右像两套风格）；卡片收口移到该组最后一条记录（+ 行在卡外）；汇总文案「共 N 条」；**删掉表底「已选择 N 个单元格」横条**（其信息改为**多选时**落在底栏最左格：「选择 N 行」/「选择 N 个单元格」，单选不触发）；**底栏底色也改成同一块灰**（与表格区融合、靠 1px 分隔线分界），**汇总行（底栏 + 分组头）去掉行内竖线做整行处理**、光标所在的一格加重到 `--lake-bg-block`；**格线/卡片边线改挂更浅的 `--lake-border-2`**（对齐云端 `rgb(244,245,245)`）；**修「选无统计仍显示共 N 条」**（去掉分组头首列的 `?? "count"` 兜底），**左下角计数改 `shownRecords.length`**（= 当前视图正在展示的记录数，只随筛选/搜索与多选变，与汇总项的实时计算是两套独立逻辑）；**两处添加入口的 ＋ 号改编号列独占一格 + 居中**（落在行号正下方）；**分组面板的删除键改为行尾 🗑「删除分组」**（与筛选/排序行同一套）；**修格内「两层边框」**（单元格自己有 2px 选中环时不再叠输入框焦点环），**链接格改云端形态**（展示文本 + 右端 🔗 图标，点图标用本地浏览器打开，双击编辑，不再常驻输入框）；底栏即最底下那条，状态栏改**实测贴住底栏上沿**（`--lake-bitable-status-bottom`，重叠 0px） | **已提交（待验收）** |
| 260929-OPT 阶段代码优化 | 用户要求「先整理/优化当前阶段代码」：修 6 处真 bug（进度颜色面板打不开 / 表单题序被丢 / 系统时间列查重失效 / 系统时间列复制为空 / 搜索绕开展示口径 / 删字段留脏配置）+ `statForField` 原型链加固 + 令牌合规 + 单一来源 | **已提交（待验收）** |
| T02B.1 关联基础模型 | 同一文档内跨表关联：`BitableRelation` 模型 + 统一解析 `BitableDisplayContext`（可选 ctx）+ 字段配置（目标表/允许多个）+ `RelationCell` chip；失效不崩不级联；CDP 真实端点验收通过 | **已提交（待验收）** |
| T02B.2 单向关联 | 关联选择器：搜索 / 目标记录列表 / 已选计数 / 新建记录 / 取消·确认（草稿确认前不写正文）+ 跳转目标记录；多选·单选均可用；复用 `.bt-option-*` 原语；CDP 真实端点验收通过 | **已提交（待验收）** |
| T02B.3 双向关联 | 反向字段（默认名 = 来源表名 + 来源字段名）+ 回填已有值 + 双向镜像唯一写入口 `applyRelationMirror` + 删一侧解除配对（对侧降级单向、数据保留）；CDP 真实端点验收通过 | **已提交（待验收）** |
| 移动端多维表只读补齐 | 布尔/链接/评分/进度/关联/系统时间的**只读控件**（非裸文本）+ 非 grid 视图回退提示；Android 模拟器 CDP 验收通过（见 §8） | **已提交（待验收）** |
| 数据表行操作浮动 | 「⋯ / 删除表」改绝对定位浮层、悬停浮现、不占流内位置（名称/计数不再被挤压）；CDP 实测无位移 | **已提交（待验收）** |
| 字段类型弹出选择 | 「编辑字段」的字段类型由内联大网格改弹出选择器（一行触发器 + Popover 内同一 2 列网格）；弹窗不再被撑高 | **已提交（待验收）** |
| 类型左对齐 + 选项回车切换 | 字段类型触发器文字左对齐（不再被 button 默认居中）；选项输入框回车 = 当前选项完成并切到下一个，已是最后一个才新建 | **已提交（待验收）** |
| 状态栏「一个表有一个没有」修复 | 底栏位置实测改量**粘性 `td`**（`<tr>` 是 static，纵向溢出时算出负值把状态栏顶出屏幕）；两表实测都显示 | **已提交（待验收）** |
| 关联字段目标表占位 | 「编辑字段」里 `关联数据表` 的占位文案「选择数据表」不再是下拉选项（原先 `value:""` 当选项、空值还被判为选中并打勾）；改走 `SelectMenu` 的 `placeholder`，选项只留同一文档内的其它数据表 | **已提交（待验收）** |
| T02B.4 关联数据范围 + 选择器改版 | 字段配置加「从视图筛选记录」（不勾选=目标表全部记录；勾选=绑定目标表的一个视图，候选只列该视图筛选后的记录）；关联选择器由单元格小气泡改**全局大弹窗**（两个 tab：所有可关联记录 / 已选 N 条；全局搜索 + 右侧筛选·排序；主区域 = 目标表整表；页脚 已选·取消·确认）；按用户要求**不做「添加记录」**，并一并撤销行内「跳转目标记录」 | **已提交（待验收）** |
| 新建数据表默认结构 | 默认表改为**只建 1 列「文本」+ 3 行空白记录**（不再预置单选/日期列）；「新建数据表」、新建多维表文档首表、空正文兜底共用 `createDefaultBitableTable` 单一来源 | **已提交（待验收）** |
| 关联选择器图片/附件真渲染 | 选择器整表里图片出缩略图（可点开预览本格）、非图片附件出「📎 文件名」chip（>2 折成 +N）；资产 URL 收敛为 `bitableAssetUrl` 单一来源（单元格/看板/画册/选择器共用） | **已提交（待验收）** |
| 横向页签原语（B 墨线 + 计数徽标） | 用户从 5 个形态里选定 **B**：`kit.css` 正式原语 `.ln-tabs`（文字 + 选中变强调色 + 与文字等宽的 2px 下划线；数量进 `.ln-tabs__count`、右侧动作 `.ln-tabs__action`），**已全量落地**（关联选择器 / 回收站 / 历史面板 / 表单编辑·预览）；legacy `.ln-tabs` 从 `components.css` 整段收编进 kit（单一来源），过渡变体 `.ln-tabs--seg` 已删除；`.seg` 只剩取值选择/图标开关 | **已提交（待验收）** |
| 表头「新增字段」的 ＋ 贴左列（260930） | 加号原来被 `th` 的浏览器默认 `text-align:center` 甩到表尾空白区正中（实测那一格 604px 宽、加号在 x=965）。改为 `.bt-grid th.bt-th-add { text-align: left; padding-left: 8px }`：**只对齐内容、不动列宽**（该格仍吸收表格剩余宽度，数据列不被撑开），实测加号左缘 = 最后一列右缘 + 8px | **已提交（待验收）** |
| 选项编辑「添加」不再自动全选（260930） | 「添加选项 / 选项回车新建」时新行原先把默认名 `选项 N` 整块选中 ⇒ 输入框里一块系统蓝底（用户报「为什么会有蓝色的底色」）。改为：`focusOptionInput` 只 `focus()` + **光标落末尾**（去掉 `el.select()`）；新选项**留空**、默认名改走 `placeholder`；保存时空名按位置兜底成「选项 N」（`bitableEditor.css` 补 `.bt-input::placeholder { color: var(--lake-text-4) }`）。实测新行 `selection=[0,0]`、键入即选项名、空着保存落成「选项 7」 | **已提交（待验收）** |
| 列宽自由设置 + 行高不被内容撑高（260930） | ① 列宽改为**以字段 `width` 为准**：`auto` 布局下 `<col style="width">` 只是「至少」，附件 chip 实测把 180 撑到 **413** ⇒ 每个格子加行内 `max-width`（`columnWidth(field)`；表头 / 记录格 / 分组统计格 / 底栏统计格四处）。② **行高绝对不被内容撑高**：`.bt-grid th, td` 补 `white-space: nowrap`（日期列 80px 时 `2026-09-07` 折行把行高 36→48），日期/时间格出省略号、文本格 `text-overflow: ellipsis`。③ 拖拽下限 **80 → 40**（用户：「可以设定一个比较小的下限值」） | **已提交（待验收）** |
| 附件按**文档类型图标**展示（260930） | 附件不再显示文件名 chip / 缩略图：单元格 = **小类型图标** + hover 出**名称气泡**；展开面板 = **大类型图标**（名称仍在卡下方，**名字被省略号截掉时 hover 同样出全名气泡** —— 同一套 `useNameTip`，用 `scrollWidth > clientWidth` 判截断，没截断不弹）。图标用 **lucide-react**（内核 sprite 实测 325 个 symbol 无一个 file/pdf/doc 系，云端的彩色页图标不在 kernel bundle 里 ⇒ 无法复用），类型判定走 core 新增的 `fileKindOf()`（单一事实源），配色新增 `--lake-file-*` 令牌；**图片字段仍是缩略图**，但 **hover 名称气泡与附件同一套**（用户追加）。**移动端同步落地**（附件字段 = 小图标 + 名称；触屏没有 hover，名称保留），Android 模拟器实测通过；**关联选择器整表、看板卡片、画册卡片也复用同一套**（`AttachmentChipList` 单一来源：选择器不再自养「📎 文件名」chip；看板卡片不再只显示图片；画册卡片不再是一串文件名）——三处都只出**类型图标/缩略图**，名称靠 hover 气泡（用户：「看板视图不展示名称了」「画册视图的附件也要改」）| **已提交（待验收）** |
| 样式大统一（260930 审计，三批） | **第一批**：菜单项收编 `.ln-menu__item`、图标按钮收编 `.ln-iconbtn`（`--compact`/`--accent`）、新增 `.ln-ellipsis`；**第二批**：`.ln-ellipsis` 落到 16 处、「选中行」三元组收编进 `.ln-row.is-selected`、面板头合并；**第三批**：新增 `.ln-imgfill`（图片填满+裁切，4 处）+ 收编**关联选择器搜索框**到 `.ln-input__field` + `.b3-list-item__text`/`.quick-note-file-chip__name` 换 `.ln-ellipsis`（10 个调用点）+ 删死代码 `.mobile-qn-img` 三条。审计脚本 `.css-audit/audit-{lookalike,primitives}.mjs`：命中 **29 → 16**、重复族 **46 → 39** | **已提交（待验收）** |
| 关联选择器视图投影（260930） | 绑定视图=字段顺序+隐藏字段+只读筛选/排序/分组基线；未绑定=默认表格视图字段顺序但全部字段/记录；本机额外筛选/排序不写回；后加字段动态进入 | **已提交（待验收）** |
| 关联/历史/回收站只读渲染统一（260930） | 关联选择器值改走主表格 `CellEditor readOnly`（选择/多选色块、布尔复选框、评分星、进度条+百分比）；历史快照、回收站/锁定文档继续共用只读 `BitableEditor → CellEditor` | **已提交（待验收）** |
| 单向/双向关联拆成真实字段类型（260930） | `relationOneWay` / `relationTwoWay` 两个真实 `BitableFieldType`；去掉 `relation.mode`；类型选择器与字段面板分别用单链/双向箭头图标；建对/解绑/镜像按 type 判断 | **已提交（待验收）** |
| 列菜单隐藏列 + 文本颜色加深（260930） | 列菜单新增“隐藏列”快捷项；列文字颜色改用独立深色调色板，不再复用浅色选项背景 | **已提交（待验收）** |

| 260930 筛选精准重做 | 字段类型操作符矩阵（文本/数字/日期/单选/多选/复选/附件/关联）、具体日期 + 15 种动态日期、根组 AND/OR、最多 2 层子组；新增共享 `BitableFilterEditor` 与递归 `evaluateFilterNode`，关联选择器同步复用，后续条件着色可复用 | **已提交（待验收）** |
| 260930 条件填色 + 统一选色 | 单元格 / 整行 / 行侧 / 整列；复用筛选单规则编辑器与求值器；`cell/row/column` 按钉钉候选顺序做 alpha 混色，`rowSide` 独立（色条 6px）；应用内所有选色统一为内核 70 色实色卡 + 最近使用 + 自定义；**最近使用按入口独立分桶**；下拉互斥；桌面 + 移动只读；另修 Lake 文档跨节点选区遮住行内背景（内核选区统一映射半透明 `--lake-select-bg`）；全门禁 + 隔离 Electron CDP 实测通过 | **未提交（待验收）** |
| 260930 选色交互收口（三项 + 默认项 + 浮层/子菜单分流） | 应用内统一色板整体缩小；进度字段颜色改为全宽输入式触发器；列菜单「文本颜色」保持子菜单语义（选色后保持预览、点空白关闭）；填色色板保持普通浮层语义（点面板其它位置即关）；所有色卡统一默认项——文字类「默认色」，背景类「无背景色」，填色无背景色时保留规则但不参与投影 | **未提交（待验收）** |
| 260930 筛选面板横条修复 | 筛选面板不再写死 820px 宽度，改为占满 Popover 内容区，消除 818px 内容区对 820px 子元素的 2px 横向溢出；空筛状态收为 320px 且隐藏无意义的“删除筛选”页脚 | **未提交（待验收）** |

### 三、当前状态与门禁
- 分支 `master`；**本批（上表所有行）已提交并推送**：代码提交 `681f148`（多维表专项收口，含 260928–260929 各批）、文档提交紧随其后；`origin/master` 已同步。更早的 23 个本地提交（`1494331..1fe4d22`）也一并推上去了。**上表各行的「已提交」只表示已入库，功能本身仍是「待用户验收」**。
- 更早的 V05/T01、评分/进度修复（`4e19df0`）、T01 回退（`d2eeb79`）、浮层定位（`05b6a96`）本来就在仓库里；本轮用户 260929 明确授权「合并 master 并推远程」，已 `git push origin master`。
- 多级分组源头为 `9b80ede`；本次已删除多级树/多级面板/层级样式，单级分组、按组统计和「加进本组」保留。
- **260930 六条已提交并推送**（用户明确授权「提交 master 并推送远程」）：代码 `486b032`「feat(bitable): 列宽/行高 + 附件类型图标 + 选择器·看板·画册统一（260930 六条）」，文档 `dd0b3e9`「docs(handoff): 记录 260930 多维表六条改动」；上表各行状态见「提交」列。更早的 260928–260929 各批仍是 `681f148`（同样已入库、**功能待验收**）。
- **260930 筛选精准重构与待提交收口批次已合并提交**：代码 `7dd81ba3`「feat(bitable): 筛选精准重构与 260930 多维表收口」，包含筛选字段矩阵/动态日期/AND OR/2 层子组、共享 `BitableFilterEditor`，以及与筛选共用文件且已全绿的前置关联/只读/隐藏列收口改动；功能仍待用户验收。条件着色后续直接复用 `BitableFilterRule` / `evaluateFilterNode` / `BitableFilterEditor`。明细回写专项文档 §11/§12/§13。
- **260930 条件填色 + 应用内统一选色已实现、未提交**：`BitableView.fillRules` 视图级配置 + 40 条上限；复用筛选 `BitableFilterRule`/编辑器/求值器；钉钉同款候选混色；应用内所有选色统一为内核 70 色实色卡 + 最近使用 + 自定义，**最近使用按选项色、进度色、列文字色独立分桶；填色只分“最近背景色”（cell/row/column 共用）和“行侧色”两桶，并持久化到 localStorage**；Lake 编辑器继续走自己的 `LakeColorBoard` 适配器且样式/渐变不变；桌面与移动只读均接投影；所有 SelectMenu 同一时刻只保留一个打开。**填色规则颜色已从旧 `soft-*` token 改为 hex，旧临时规则不再兼容，需重选颜色。** 全门禁与隔离 Electron CDP 已通过，等待用户验收；明细见专项文档 §11/§12/§13。
- 门禁全绿：`tsc --noEmit`✓ · `vitest run` **1430 passed / 16 skipped**✓（筛选重做 + 条件填色 + 选色交互收口）· `check:core` 0 违规✓ · 桌面 + 移动构建✓ · `ui-metrics`（hex=0 / rgb=0 / `!important`=9 / 未定义令牌=0）✓ · `cssLayers`+`uiPrimitives`✓ · `git diff --check`✓。
- 每个编号都做了 **CDP 真实端点验收**：`env -u ELECTRON_RUN_AS_NODE LAKE_RENDERER=scheme LAKE_USER_DATA=<临时目录> LAKE_ASSET_PORT=<独立端口> electron --disable-gpu --remote-debugging-port=<独立端口> .`，用 Node 24 内置 WebSocket 直驱 `Runtime.evaluate`。

### 四、当前问题 / 遗留（都不阻塞继续）
1. **待用户验收**：V02–V04 + 三批追加需求 + T04 + T02A + **260929 T02A 续（评分星/进度条）+ 浮层定位统一 + V05 单级分组样式（含续四条）+ T01 恢复 + 260929 单级分组/目录把手/重复计数细节优化 + 260929-UI2 分组底衬与底栏收口 + 260929-OPT 阶段代码优化 + T02B.1 关联基础模型 + T02B.2 单向关联 + T02B.3 双向关联 + T02B.4 关联数据范围/选择器改版 + 新建数据表默认结构 + 关联选择器图片/附件真渲染 + 关联选择器视图投影 + 关联/历史/回收站只读渲染统一 + 单向/双向关联拆成两个真实字段类型 + 列菜单隐藏列 + 文本颜色加深 + 横向页签原语（B 墨线+计数徽标） + 移动端多维表只读补齐 + 数据表行操作浮动 + 字段类型弹出选择 + 类型左对齐/选项回车切换 + 状态栏「一个表有一个没有」修复 + 关联字段目标表占位修复 + 260930 表头「新增字段」＋贴左列 + 260930 选项编辑「添加」不再自动全选 + 260930 列宽自由设置 + 行高不被内容撑高（下限 40）+ 260930 附件按文档类型图标（单元格小图标 + hover 名称气泡 / 展开面板大图标 + 文件名截断时 hover 出全名 / 图片格 hover 同名气泡 / 移动端同步 / **关联选择器、看板卡片、画册卡片都复用同一套**且卡片不显示名称）+ 260930 筛选精准重做（字段类型操作符矩阵 / 15 种动态日期 / AND·OR / 最多 2 层子组 / 共享 `BitableFilterEditor`）+ 260930 条件填色（四模式 / 钉钉 alpha 混色 / 内核 70 色实色卡 + 自定义 / 移动端只读）+ 应用内统一选色（Lake 适配器不变）**（专项文档 §11 看板里均为「待验收」）。V01 已验收通过；T03 多级分组已废弃。**T01 列级统计：当天先删后已恢复，并定稿为底部常驻栏**（专项 §11/§13）。
2. 已知口径/边界（用户知情、可接受）：
   - **移动端**：看板 / 画册 / 日历 / 分组仍**回退为只读表格 + 明确提示**；**260929 已补齐多维表只读控件**（布尔/链接/评分/进度/关联/系统时间，不再是裸文本）并**在 Android 模拟器上完成 CDP 验收**（见 §8「多维表只读」）。
   - 分组当前最多一级；历史多分组正文只保留第一级配置（当前产品语义，不做兼容迁移）。
   - 文档图片预览：同一张图在正文出现两次时，双击第二次仍定位到第一张（**张数正确**，定位精度小瑕疵）。
   - 评分是整星（不做半星）；进度是 0–100 整数；图片字段只按扩展名/MIME 判图片（不做内容嗅探）。
   - 表单暂不渲染 `formDescriptions`（逐字段描述）；日历的当前月份是本机展示态（不写正文）。
   - **关联**：T02B.2 选择器支持多选/单选、搜索、新建目标记录、跳转；T02B.3 双向关联建反向字段并双向同步、删一侧降级为单向且数据保留；关联列的筛选/排序/分组/统计当前按「空」处理（专项 §6.4 最小侵入口径）；目标表被删只展示失效、不级联。
3. 与专项无关的上线收尾遗留仍在 §3（真实端双端同步实测、Android 真机验收、发布说明）。

### 五、下一步计划
1. 等用户对第 4 节第 1 条的范围验收（**代码已提交并推送**，验收只看功能；发现问题直接改 + 追加提交）。
2. **条件填色已提交 `ae1cfda`，功能验收状态不变**；260930 当前会话先做整体架构讨论（专项 §17），不自动开始修复或继续扩展。
3. 按专项文档 §8 顺序本应继续 **D01 CSV → D02 JSON**，但 **260929 用户明确「先不做导入导出」**，D01/D02 暂缓；期间已完成**移动端多维表只读补齐 + Android 模拟器验收**（见 §8）。恢复导入导出时从 D01 开始。
4. 每个编号的固定动作：core 纯函数（`src/core/bitableDoc.ts`）+ 各视图独立组件/独立 CSS 文件（**必须**在 `src/styles/cssLayers.test.ts` 的 FILES/BASELINE 登记）+ 单测 + 全门禁 + CDP 真实验收 + 回写专项文档 §11/§12/§13。

### 六、本轮踩过的坑（关键；长期条目已并入 §4）
1. **改完 `src/**` 必须先 `npx vite build`，再跑 scheme 模式的验收**：`LAKE_RENDERER=scheme` 服务的是 `dist/`，不重建就是在**旧 bundle** 上验收，会出现「改了没生效」的假象（本轮踩过一次，白折腾一轮）。
2. **CDP 查询必须限定可见元素**：`.bitable-editor:not(.fn__none)`。多 tab keep-alive 下，裸 `.bt-viewbar` / `.ln-popover` 会点到隐藏 tab 的菜单。
3. **CDP 依附的窗口 `document.hidden === true`** ⇒ `loading="lazy"` 的图片**不加载**（`naturalWidth=0`）。验收封面/缩略图要临时 `removeAttribute("loading")` 才能看到上屏；**不是产品缺陷**（同一 URL 的 `fetch`/`new Image()` 都 200）。
4. **新增 CSS 文件必须由使用它的组件 `import`**：本轮 T02A 建了 `bitableFieldCells.css` 却漏 import，那批新单元格样式一直没加载（元素在、样式空），直到做 2 列网格发现 `grid-template-columns: none` 才暴露。
5. **`cssLayers.test.ts` 基线是硬上限**：`features/bitable/bitableEditor.css` 已顶满 **1081/1081（headroom = 0）** —— 再加任何一条声明都会让用例变红；本轮所有新样式都进了新文件（`bitableViews.css` / `bitableKanbanView.css` / `bitableGalleryView.css` / `bitableCalendarView.css` / `bitableFormView.css` / `bitableFieldCells.css`）。
6. **读落盘要轮询**：应用层自动保存有防抖，改完立刻 `readNote` 会读到旧值甚至空对象（本轮多次误判「没保存」）。
7. **同一文件被多批改过时没法按批拆 commit**（`git add -p` 的补丁手术风险高）⇒ 本轮代码合成一个 commit、文档单独一个；不要为了「一批一 commit」硬拆。
8. **在 DSH 宿主里跑 CDP 验收必须加 `--no-sandbox`**（260929 新增）：否则 Chromium 自带 sandbox 初始化报 `Operation not permitted`，连锁 `NetworkService/GPU crashed`，最终 `FATAL: GPU process isn't usable. Goodbye.` 整个实例退出（§6 的验收命令本轮首次执行即因此失败）。加 `--no-sandbox`（userData/端口本就隔离）后正常。

## 1. 项目一句话 + 铁律（详见 AGENTS.md）
本地优先笔记应用（Electron 44 + React 18.3 + better-sqlite3 + 语雀 Lake 内核），S3（七牛 Kodo 兼容）同步。
**红线**：① 本地是真相、S3 只是镜像（云端备份绝不反噬本地）；② 目录/删除强一致（删除传播、墓碑权威）；
③ `src/core/` 禁 `node:` 导入（平台差异走端口注入）；④ 开发数据只用 `lake-notes-dev`，绝不碰正式数据；
⑤ 不为旧数据写兼容/迁移（能删重建就删重建）；⑥ 杀 Electron 只 kill 具体 PID，禁 `pkill -f Electron`；
⑦ 不擅自合 master（代码批次需用户验收；文档类清理可直接提交；**260928 多维表批次已由用户明确授权「提交代码」（仅提交、未推送）**）。移动端另有铁律见 **§8.0**。

## 3. 待办与已知问题（上线后 backlog）

> 当前主线是多维表专项（见 §0 与专项文档）；以下是专项之外真正保留的低优先项。

1. **同步 warning 结构化**：`SyncReport.warnings` 从字符串改为 `{ kind, noteId?, filename?, message }`，与 UI 展示/点击定位一起做。同步红线区，单独立项。
2. ~~**画板 AI 助手**~~ **已完成（261003）**：接的就是内核 `ai.generate` 钩子，转主进程既有 AI 通道（Key 不出主进程、不新增 IPC），只读不给入口。见 §0「261003 · 画板 AI」。仍不做的是**文内文本绘图卡片**（`TextToDiagram`，内核那支绿色徽标无注入点）。
3. **UI 低优先**：目录树窗口化（先量到真实卡顿再立项）·设计词表继续裁剪·画板 `Wt is not a function` 根因定位。
4. **移动端剩余**：真机验收、数据导出/导入、粘贴与资源 URL、长文档大纲跳转；详细步骤见 §8。
5. **搜索整体重构**：FTS/短词/增量搜索不并入普通维护，单独立项。
6. **历史快照恢复为新文档**：用户已明确先不做；恢复入口仍只覆盖当前文档，恢复前自动留档。
7. **低优先数据/性能**：附件哈希缓存仅在真实痛感出现后立项；回收站惰性下载暂缓；Word/PDF 大附件与历史 `lakex-contract.d.ts` 按需处理。
8. **已知外观**：离线残余资源、移动端缩略图仅覆盖 png/jpg/jpeg（失败回退原图）、多维表附件旧数据的体积展示边界。

10. **样式大统一（260930 审计，三批已完成；③⑤ 已记录、暂缓不做的理由见下）**：用户要求「找出散落各处的相同操作模式，做成正式原语统一起来」。
    **已完成**（详见 §0 行 + AGENTS §3#14 的单一来源清单）：
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

9. **多维表优化专项**：唯一方案/进度/修改记录/会话结论在 `docs/BITABLE-OPTIMIZATION-HANDOFF.md`；专项会话先完整读它、结束前必须回写它，**不在 HANDOFF 内展开专项细节**。当前进度见 §0 第二节。
   **条件填色 + 统一选色已实现、待验收**：详见 `docs/BITABLE-FILL-COLOR-RESEARCH.md` 与专项文档 §11/§12/§13。四模式复用筛选单规则编辑器，按钉钉语义做 alpha 混色；应用内选色统一为内核 70 色实色卡 + 最近使用/自定义；最近使用按入口独立分桶并存 localStorage，Lake 内核适配器样式不变；当前代码已提交 `ae1cfda`；功能验收状态以专项 §11 为准，当前转入 §17 架构讨论。

11. **多维表行虚拟化（AR04 已证瓶颈；用户 260930 决定暂不做，留待后续）**：真实 Electron 压测（scripts/bitable-stress.mjs）——目标 5000×20 打开 **12.42s / 84.8 万 DOM / 395MB 堆 / 首次点选 2.25s**；10000×20 = 24.8s/169 万/1.34GB；20000×50（100 万格）200s 内未渲染完成；50000×50 因**正文 32 MiB 上限**根本无法保存。结论：CPU 热点（AR-F5/F6）已消除，**DOM 全量渲染是瓶颈**，支持 5000 级规模需行虚拟化/渲染策略；立项前先定「5000×20 滚动/编辑目标 + 验收口径」。多维表审计其余遗留见专项 §17.12。

12. **非多维表审计遗留（260930 会话决定）**：
    - **F16 安卓整轮网络同步持本地写队列** → **记入正式项目待办**：先出真机/模拟器时延数据，再拆「sync/GC 维护互斥」与「短本地事务互斥」，网络阶段不占本地 DB 写锁；需单独立项 + 跨端 sync 对拍。
    - **S3 内核适配收口与实机性能** → **记入正式项目待办**：重试/观察限制到 host/card/session；卡水合/自愈/scroll 先测后删；跑前台长正文/代码/媒体/大纲/锁定回归。
    - **F12 安卓固定密钥** → **不做**：属设备安全（Android Keystore）范畴，本项目不承担设备安全职责。
    - **S1 DocumentSession / F13 / §6.1-#2** → **不做**（会话正确性已由 S0 + 捕获契约覆盖；后两者收益不足）。
    - **F08 双介质一致性** → 走 §8 **路线 A**（保持文件+DB、只修会话）；**A 不修 F08 跨介质窗口**（需 B/C）。A 的会话修复已完成。
    - **§6.1 剩余性能项**：已测量（见 §0「§6.1 剩余性能项测量」）。#4 **已修**（5c70b1c，收窄到实例 mount）；#5 未测到高频（不做）；#6 增量 ~6ms/次（暂不改）。


13. **AI 多轮对话记忆只保留最近 40 条（用户 261005 决定：先文档化、不做长期记忆）**：主进程 `electron/ai/aiChatMessages.ts` 的 `assertMessages` 只把**最近 40 条消息**发给供应商（更早的上下文丢弃；另有 `AI_MAX_TOTAL_CHARS=200000` 上限），面板关闭即清空、**无长期 / 跨会话记忆**，设置页「AI → 说明」已如实标注。若要长期记忆 / 摘要压缩 / 跨会话共享，需单独立项（涉及存储与成本，超出笔记软件当前范围）。
14. **表格（FortuneSheet）暗色模式 —— 用户 261006 立项，本会话不做**：FortuneSheet **无主题 API**，单元格区是 canvas 硬编码白底（内核源码 `if (bg == null) bg = "#ffffff"`）、默认字色 `defaultStyle.fillStyle=#000`、网格线 `#dfdfdf`、行列头字 `#5e5e5e`；DOM 外壳（工具栏 / 行列头 / 工作表标签 / 公式栏 / 容器）是硬编码浅色、可 CSS 覆盖。可选做法：**A** 只覆盖 DOM 外壳（低风险，但单元格仍白）；**B** 渲染层给缺省格补暗底 / 亮字、**保存前剥除**（真暗，但需解决「剥除口径 / 主题热切换 / 撤销栈」三件事）。推荐 A 先落、B 单独立项。详见 §0 ③ 与专项文档 §13。
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
- **网格是全量 DOM 渲染、无虚拟化**（260930 AR04 压测，真实 Electron）：DOM ≈ 8.5 个/格；目标 5000×20 打开 12.4s / 84.8 万节点 / 395MB 堆 / 首次点选 2.25s；10000×20 → 24.8s / 169 万 / 1.34GB；20000×50（100 万格）200s 内未渲染完。支持 5000 级规模前需要行虚拟化/渲染策略（专项 §17.7 AR04 触发条件已成立）。压测工具 scripts/bitable-stress.mjs；CDP 依附窗口隐藏，量不到 FPS，只能量挂载/DOM/堆/交互延迟。

### 工程 / 环境
- Node 必须 24；better-sqlite3 是 Electron ABI，系统 Node 不能替代运行时。
- 改 `electron/**` 或 `src/core/**` 会触发 Electron 重启；验证前确认 CDP 端口连的是新实例。
- Vite dev server 必须长驻；`nohup` 起的进程会随会话回收。
- 杀 Electron 只按唯一 CDP 端口精确定位 PID；禁 `pkill -f Electron`、`killall`。
- DSH 宿主里启动仓库 Electron 要 `env -u ELECTRON_RUN_AS_NODE`。
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
1. 主线是多维表专项（§0）；专项之外只从 §3 取项并单独立项，不要恢复已完成的研究/计划文档。
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
- **多维表优化专项**：`BITABLE-OPTIMIZATION-HANDOFF.md`（唯一方案、状态看板、修改记录和多会话交接；**专项会话必读必写**）。
- **条件填色 + 统一选色（待验收）**：`BITABLE-FILL-COLOR-RESEARCH.md`（四模式 + 钉钉同款 alpha 混色；筛选引擎与编辑器复用；应用内 70 色实色卡 + 最近使用/自定义；Lake 适配器样式不变；当前代码未提交）。
- **内核**：`LAKEX-CONTRACT.md`（闭源 lakex 行为契约 + 速查表，编辑器相关**先读**）。
- **正文写入（写 `.lake` 前必读）**：`LAKE-CONTENT-WRITING.md`（约定 + 反例 + 校验判据；配套 `src/core/lakeDocForm.ts` 与 `scripts/lake-roundtrip-check.mjs`）。
- **指南**：`CODEX-GUIDE.md`（CDP 驱动真实 Electron，动手前必读）· `DEVELOPMENT.md` · `ARCHITECTURE.md` · `TROUBLESHOOTING.md` · `RELEASE.md` · `SYNC-RELIABILITY-VERIFY.md`（数据完整性门禁）。
- **移动端**：`MOBILE-TECH-STACK.md` · `ANDROID-TECH-SCHEME.md` · `ASSET-URL-MOBILE-PLAN.md`。
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
