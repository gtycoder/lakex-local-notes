# HANDOFF.md — Local Lakex Notes 项目交接（唯一权威交接文档）

> 写给完全没有上下文的新会话。接手顺序：**README（根）→ 本文件 → AGENTS.md（根，长期红线/机制）**。
> 本文件只保留【最新几个批次 + 当前基线 + 真正的待办 + 长期坑】；历史 dated handoff 已删除，只在 git 历史可查（`git log -p --follow docs/HANDOFF.md`）。
> **⚠️ 261022 历史已重写两次（品牌/邮箱标准化 → 闭源内核移出公开仓库）**：旧 commit hash 全部失效，文中旧 hash 只作历史记录，`git show` 不可达。
> **当前状态以文末 §1（基线）/ §2（风险）/ §3（待办）为准**：§0 是批次记录、保留当时的「未提交 / 未 push / 待验收」口径；261102 及更早条目的提交状态见 §1，**不要据此判断当前是否已推送**。
> **移动端（Android）的构建 / 安装 / AVD / CDP / 门禁 / 点按口径 = `docs/MOBILE-OPS.md`**（原 §8「移动端速查」已删，同批内容重建进该文件）；桌面会话不要改它，移动端会话不要改桌面文件。

## 0. 最新交接（261027）

### 261104 · 三项裁决定稿 + 落地（**本地提交，未推送**）
- **① 表格语义（用户裁决 = A，长期）**：排序/冻结/单元格·行列保护 = **文档数据**；阅读态只读，排序/冻结回编辑态；**不补移动端保护行列入口**；读态筛选保持「只对本机生效、绝不写正文」的唯一例外。已回填 `AGENTS.md` §4 与 `LAKEX-CONTRACT.md` §5.47，**无代码改动**。
- **② 移动端缺正文/缺小记（B-lite，文档 + 小记；已落地）**：探针（lake_mobile）结论：文档缺正文**原本就不打开**（已比只读更严，toast 提示），小记**原本完全静默**（已修）。实现：`src/mobile/data/missingBodies.ts`（只 stat、分批 200、判据复用 `core/missingBody`、hasSyncBase 读 v3 baseline）+ bridge 单篇云端拉回（pointer→索引→lakeBodyKey→**sha256 校验**→写正文，**不调整库 restoreFromCloud**）/ 历史恢复（复用 restoreHistory）/ 搜索缓存重建纯文本（标 local）/ 彻底删除；设置→资源管理「缺正文」「缺小记」两行（非空才显示）+ Sheet（常驻结果行、`confirmMobile` 二次确认）；同步警告「正文缺失」行改「去恢复」；打开提示统一文案、每篇每会话一次。**0 新增 CSS**。
- **③ 移动端表格面板（已落地）**：删 4 处不可达 toast 死分支 + 7 个无能力占位（附件 / 图表 / 批注 / 数据验证 / 分列 / 图表视图 / 条件格式）；接线「单元格图片」「手写签名（透明 PNG、按笔迹 bbox 裁剪、仅移动端）」「只读逐行表单视图」。**附件结论 = Univer 1.0.3 无任何单元格附件能力（依赖里无 attachment 包）、桌面也没有；自研属立项级 ⇒ 不做、删占位**。附带修隐性 bug：移动端编辑含图表格会把资产 URL（带 token）写回正文 ⇒ capture/基线新增 URL→filename 映射（`usheetDiskSrc`，与桌面 diskSource 同口径）。
- **门禁**：tsc 0 / 全量 vitest **600 文件 3672 例（3660 通过 + 12 skipped；另有 11 个 integration 文件 skipped）** / ui-metrics 0 违规 / check:core 137 文件 0 / check:mobileui / 双 build / check:bundle + check:arch（移动首屏 343.9KB/360、桌面 541.3KB/600、import 违规 0）/ `git diff --check` 0；**移动 6 态快照 0 差异**（lake_gate，re-bake 后 `mobile-snap.json` 与提交版 0 改动）。
- **设备验收（lake_mobile / emulator-5554，重装 debug APK 40,164,026B）**：四面板无置灰（插入 4 / 数据 4 / 视图 2 / 更多 6）；签名插入 ⇒ 正文含 `"source":"<filename>.png"` 且无 `127.0.0.1`；「单元格图片」（stub 选择器）同链路通过；表单视图 2 行/翻行/关闭且**正文逐字节不变**；缺正文文档与小记各弹一次同源 toast（连点不重复）；资源管理两行计数正确、彻底删除走二次确认并落到「已彻底删除」；测试数据已回滚（文档 9 / 小记 4，测试文档资产已清）。
- **风险/遗留**：① 云端拉回只有单测 mock（lake_mobile 未配 S3，未真机验证）；② `hasSyncBase` 沿用桌面语义（账本被清过时可能只显示仅历史/无备份）；③ 小记重建纯文本会标 local、下次同步可能覆盖云端（二次确认已写明后果）；④ 表单视图一次性 `getValues`（默认 35 行；超大表若卡再行数帽）；⑤ 手写签名仅移动端（桌面未接，未立项）。

### 261104 · 二十六批：手写板「页面」面板（缩略图/大纲合并）+ 页签语义 · **已提交并双推（hash 见 §1）**
- **用户口径**：参考 Edge PDF 的双视图；去掉底部缩略图横条；**滚动 + 页码跳转**（不做分页条）；面板右侧**悬浮、不可固定**，打开时画面左移让位；页签既能只打标记、也能带一句话说明。
- **结构合并**：`InkOutlinePanel`（底栏向上的大纲浮层）+ 桌面 `InkPageStrip`（底部横条）⇒ 新的 `InkPagesPanel`（**右侧悬浮**、单一入口 `页面` ▦、两视图 `缩略图|大纲`、筛选 `全部|批注|页签`、查找、页码跳转、滚动虚拟化）。底部横条只在**移动端全局预览**里保留；桌面不再挂载。
- **页签语义（本批唯一动数据的地方）**：`page.note` **字段名与 v4 版本都不变**，语义改为「**字段存在即页签**，空串 = 纯标记」；`normalizePageNote` 不再丢弃空串、序列化在 `note !== undefined` 时写出（含 `"note":""`）。⇒ 旧构建编辑含纯标记的文档会把字段丢掉，**已同步重装 Android APK**（含新解析/序列化）。
- **面板行为**：`data-pages-panel="open"` 时 `.ink-page-stage` 加 360px 右内距 ⇒ 页面整体左移、不被面板遮挡（页宽高不变）；大纲只搜**页签文字与页码**（笔迹无 OCR）；打开/切页/切视图自动把当前页滚进可视区；`Esc`/`✕` 关闭；只读态禁用编辑/删除/新建，跳页可用。
- **删除**：`InkOutlinePanel.tsx` + 其 render 测试（由 `inkPagesPanel.render.test.tsx` 取代）；`inkOutline.ts` 去掉 `nextInkOutlineMode` 与旧 labels，改 `all|annotated|tabbed` + `filterInkOutline` + `tabPageIds`；桌面 CSS 整块删旧大纲浮层。
- **门禁**：tsc 0 / 全量 vitest **594 文件 3620 例（3608 通过 + 12 skipped）** / cssLayers（inkPad.desktop 138→305：新增面板规则、删旧浮层）/ mobileLayers 不变 / ui-metrics 0 违规 / check:core 137 文件 0 / check:mobileui / 双 build / check:bundle + check:arch（移动 342.1KB、桌面 541.3KB、import 违规 0）/ `git diff --check` 0。
- **二轮修正（用户 261104 17:39，已落盘待复验）**：① 面板改**左侧悬浮覆盖**（删除 stage 右内距规则 ⇒ 打开不再移动画布）；② **可拖宽**（右缘 8px 手柄、280–560 夹取、`lakex-local-notes-v3.ink-pages-panel` 设备本地记忆，纯函数 `clampPagesPanelWidth` / `readPagesPanelWidth` / `writePagesPanelWidth`）；③ 缩略图改**2 列大图、只留删除**（前移/后移删除）、缩略图视图去掉筛选/摘要/查找；④ 跳页控件上提到头部（与视图 tab 同行）；⑤ **页签编辑从面板挪到底栏独立按钮** `InkPageTabButton`（打标记/保存/清除，只读禁用），面板不再有页签编辑框。测试：`inkPagesPanel.render.test`（v2 重写）+ `inkPageTabButton.render.test`（新增 5 例）。门禁：tsc 0 / 全量 vitest **594 文件 3620 例（3608 通过 + 12 skipped）** / cssLayers（inkPad.desktop 305→316）/ ui-metrics / 双 build / bundle+arch / diff-check 全绿。
- **三轮修正（用户 261104 18:00，已落盘并自验）**：① **最小宽度 320**（顶栏刚好一行 + 一行 2 个缩略图，向上取整；grid `minmax(132px,1fr)`）——实测 320 时 `gridTemplateColumns: 139.5px 139.5px`、header 高 39 单行；② **长按拖拽排序**（缩略图：300ms 长按、8px 移动取消、`dropTargetIndex` 纯函数换算槽位、`movePageTo` 一次可撤销提交；拖完吞掉那次 click 不误触发跳页）；③ **页签弹层自适应左右展开**（`is-align-left/right`，避免被面板/窗口裁）；④ 拖宽手柄收进面板内（`right: 0`），不再与画布重叠。自验（dev 实例）：拖动第 3 页到第 1 位 ✓（`dragging/dropTarget` 类均出现、顺序 [p3,p1,p2,…]），再拖回 **顺序逐值还原（netZero=true）**；测试数据未留改动。
- **画布区从「窗口底」改「下沉画布」+ 分界线（用户 261104 18:14 报「背景和顶栏融合，像出了问题」）**：手写板画布原来用 `--lake-bg-window`（与 Tab 栏/窗口同色、且与顶栏之间没有分界线）⇒ 整块看起来没画完。改为 **`.ink-pad--desktop` 背景 = `--lake-bg-sunken`（浅 #eceef1 / 深 #131417 / 暖 #ecebe8，主题令牌一键跟随）+ `border-top: 0.5px` 发丝线与顶栏交代边界**；顶部工具条上边距 8 → 12 留呼吸。白纸面在更沉一档的画布上才浮得起来（DESIGN 的 sunken 语义补了「手写板画布底」这一用途）。
- **顶部工具条改「表格 ribbon」同构（用户 261104 18:24 点单）**：原来是居中悬浮胶囊（fit-content + 圆角 10 + card 阴影 + 居中 + 上下留白），和 Tab 栏两条白块叠着看像没对齐。改成**通栏白条**：`width:100% / align-self:stretch / margin:0 / padding:6px 12px / 无圆角无阴影 / 仅下边 0.5px 发丝线 / 左对齐 gap 6` —— 与表格的 ribbon 结构一致（Tab 栏 → 白工具条 → 下沉画布 + 白纸面）。实机 computed 复核：w=975=pad 宽、radius 0、shadow none、border-bottom 0.5px、ml=0。
- **四轮修正（用户 261104 18:34）**：① 画布底色**恢复与顶栏/窗口同色**（保留 0.5px 顶栏分界线；顶部通栏白条仍在，层次靠它交代）—— DESIGN 的 sunken「画布底」附注同步撤回；② **顶栏 Tab 标题字号 12 → 14px**（与目录栏同档，`.tab-item` 的 `--lake-font-size-tiny` 改 `--lake-font-size-body`）；③ **手写板底部状态栏垂直居中**：`.document-statusbar[data-doc-kind="ink"] { bottom: 6px }`（底栏 38 / 胶囊 26 ⇒ 6+26+6），实测胶囊中心与底栏中心均为 800；④ **页签功能上移动端/Pad**：表单抽成 `features/ink/InkPageTabForm.tsx`（桌面弹层与移动 Sheet 共用，**登记进 crossEnd SHARED**，两端各补 `ink-page-tab__*` 样式）；InkPad 只加 `renderPageTab` 宿主注入点，移动端入口 = 顶部导航的新「页签」按钮 → `MobileSheet`（`src/mobile/ink/MobilePageTab.tsx`）；Pad 与手机同一套外壳自动兼容。测试：`MobilePageTab.render.test` 4 例 + 面板/表单断言更新；mobileLayers（inkPad.mobile 156→182）/ cssLayers（inkPad.desktop 331→334）。**移动端两处配套**：① 顶部页码改紧凑写法 `1 / 1`（原来「第 1 / 1 页」+ 共享 72px 最小宽，胶囊塞不下第四组；`.ink-pad--mobile .ink-pages span` 最小宽归零）——否则新增入口会撑出 19px 横向滚动；② 页签 Sheet **不能**放进顶部胶囊（横向滚动容器会撑大 scrollWidth、还可能被裁）⇒ 按钮在导航、Sheet 由 `MobileInkPad` 作为兄弟节点渲染（`MobilePageTabButton` + `MobilePageTabSheet`，**不用 createPortal**，仓内 portal 只允许 Overlay 白名单）。设备实测（lake_mobile 412）：nav `scrollWidth 395 == clientWidth 395`、页签按钮全在胶囊内；Sheet rect `[0,640,412,202]`、不在胶囊 DOM 内；打标记 → 入口 `has-tab`、重开 Sheet 清除页签可用；输入「手机页签测试」保存 → 回显；清除 → `has-tab` 消失、数据复原。
- **桌面实机复验 · 二轮（261104 17:53，dev 实例 CDP 9222，1280×820）**：① **左侧悬浮覆盖不动画布** —— 开/关面板 frame `{507.89,102,469.21,664}` **逐值不变**、stage padding 仍 16/16（无 data-pages-panel 内距）；面板 `{268,46,360,717}`（left8/top8/bottom56、absolute、无固定控件）。② **拖宽**：360 →（+120）**480**，再 +200 ⇒ **560 上限**、−400 ⇒ **280 下限**；`localStorage.lakex-local-notes-v3.ink-pages-panel` 同步；Page.reload 后仍是 280。③ 缩略图 `gridTemplateColumns: 159.5px 159.5px` = **2 列**（旧 3 列 ~95px），29 格 + 新建页格，**只剩删除**（hover 出现，无前移/后移）、无 chips/摘要/查找。④ 大纲：chips「全部/批注/页签」+ 摘要 + 查找在、**无页签编辑框**、跳页控件在头部同行。⑤ 底栏 `页签` 按钮（bookmark 图标，位于「页面」右侧）：弹层 role=dialog、label「第 N 页页签」、打标记/保存/清除页签；**落盘实证**：打标记后正文出现 `"note":""`，点清除后 `"note"` 计数 0（数据已复原）。⑥ 测试数据恢复：面板/弹层已关、宽度 key 删除（回默认 360）、全库 ink 正文 0 个 note。
- **桌面实机复验（261104 17:28，dev 实例 CDP 9222，1280×820；**右移口径已被二轮改成左侧覆盖**）**：面板 `{x:952,y:46,w:320,h:718}`（absolute / top8 / right8 / bottom56 / z5，无固定控件）；打开面板 frame **x 511.91 → 339.91（左移 −172px），宽高 470.17×665 逐值不变**，关闭回原值且 attr 清空。页签三态实测：打标记 ⇒ 字段存在值为空串 + 缩略图角标「有页签（纯标记）」；保存文字 ⇒ 磁盘正文 v4 出现 `"note":"持久化探针"`；清除 ⇒ note 字段消失（内容与磁盘原样相等 ⇒ 保存路径写回原文 v3，符合「打开=只读/改回原样不写盘」）。视图/筛选/跳转：role=tab 与 aria-pressed 正常、「页签」筛选只列 2 条、真实 Enter 跳页不关面板、335 页跳第 200 页后当前行自动滚入（scrollTop 5493）；锁定态前移/后移/删除/新建/保存/清除全禁用、跳页可用（输入框也已随本批禁用）。测试数据已恢复（磁盘 v3、无 note、笔迹数不变，文档已解锁）。

### 261104 · 二十五批：手写板文字块 WYSIWYG / 贴图源图校验 / 背景入口归位 · **已提交并双推（hash 见 §1）**
- **用户三条反馈**：① 文字块样式有问题，且编辑样式和完成样式完全不同、编辑态↔展示态转换时变动很大；② 贴图无法展示，仅有边框；③ 导入图片/PDF 放到和背景一栏，改名「背景图片」「背景 PDF」。
- **① 两个根因（实测，不是猜）**：
  · **移动端缺 v4 样式**：`src/mobile/ink/inkPad.shared.css` 是桌面共享文件的独立副本（261029 起，mobileIndependence 门禁禁止移动端引桌面样式），v4 的文字块/贴图 9 组规则只加在桌面侧 ⇒ 移动端 `.ink-text-editor` 计算样式 `position: static`（默认 textarea：灰边、白底、按流排在页面底部）；`.ink-text-controls/.ink-text-resize/.ink-image-remove/.ink-image-resize` 在移动端**完全没有样式**。
  · **键盘把页面缩一半**：`.ink-page-frame` 的宽来自 fitSize（ResizeObserver 量 stage），IME 弹起把 stage 压矮 ⇒ 实测 396 → 218，提交后回弹 = 「转换过程中很大变动」。
- **① 修法（三个，缺一仍有观感问题）**：① 移动端副本补齐 9 组规则（`:hover`→`:active`，边框按红线统一 0.5px）+ 新增 `src/mobile/ink/inkSharedCssParity.test.ts`（两份共享文件**类名集合必须一致**，漏同步即红，防再漂移）；② 移动端 `.ink-page-frame` **删掉 `max-height:100%`**（Android 实测：fitSize 冻结后 inline 高 560 仍被 CSS 夹到 308 ⇒ SVG `preserveAspectRatio` letterbox ⇒ 内容缩到 55%、而编辑框/控制条按 frame 宽定位 ⇒ 文字比虚线框低 32.6px；去掉后内容 scale 与展示态一致、dy≈0，超出由 stage 滚动）。**别再给 frame 夹高**（`inkPadWiring.test` 已钉住）；③ **编辑框改隐形输入区**（无白底/无边框/无内距、几何按 px 内联）；基线单一来源 = `INK_TEXT_BASELINE_RATIO`(0.9) 与 `INK_TEXT_EDITOR_BASELINE_RATIO`(1.12，CSS 行盒公式) 之差 `inkTextEditorTopOffset`(−0.22em)，**编辑中同 id 不渲染 `<text>`**（不叠字），提交后 SVG 文字落回同一位置；**移动端文字编辑期间冻结页面尺寸**（宽不变、只变矮 ⇒ 判 IME，不跟缩）。
- **② 贴图**：真图链路没问题（桌面实测 1220×2656 正常出图）；移动端「仅有边框」= 模拟器相册里**只有两张 1×1 / 70 字节占位 PNG**，插进来就是缩放到 317×239 的透明像素。修法：两端 `onInsertPageImage` 先 `probeInkImageFile`（`createImageBitmap` → `<img>` 兜底）再上传，最小边 < 8px 或探测失败**抛错**，InkPad 用 `role=alert` 横幅显示「图片太小（1×1），无法作为贴图」/「无法识别这张图片」，不再静默插空框（纯函数 `inkPageImageSourceError`）。
- **③ 入口归位**：移动端「导入图片/导入 PDF」从 ＋ 菜单移到**纸张行**（`InkBackgroundSourceButtons` 进 `.ink-backgrounds`），文案改「背景图片」「背景 PDF」；桌面同步改名。＋ 菜单只剩「文字 / 贴图」；纸张行 4 纸张 + 2 背景按钮在 412 一屏（视觉 36 / 命中 44）。
- **门禁**：tsc 0 / 全量 vitest **594 文件 3620 例（3608 通过 + 12 skipped）** / cssLayers（桌面 inkPad.shared 声明数不变）/ mobileLayers（ink shared 188→259、inkPad.mobile 127→156，新增逐条登记）/ ui-metrics 0 违规 / check:core 137 文件 0 / check:mobileui 全过 / 桌面 + 移动 `vite build` / `check:bundle` + `check:arch`（移动首屏 342.1KB/360KB、桌面 541.3KB/600KB、import 违规 0）/ `git diff --check` 0。
- **设备复验（261104 15:55，双端）**：
  · **Android（lake_mobile / emulator-5554，重装含本批的 debug APK，未 pm clear）**：编辑态 `.ink-text-editor` = position absolute / border 0 / background transparent / padding 0（旧包 static + UA 灰边 + 白底 + padding 2px）；编辑中同 id `<text>` 不渲染；**frame 宽高 396×560.1 编辑前后逐值不变**（旧包 396→217.76 / 560→308.29）；**SVG 内容 scale 编辑 0.4978 == 展示 0.4978**（只修冻结不修 max-height 时是 0.2738）；文字与虚线框按页面百分比 **dx=dy=0**（编辑框顶高 5.26px = 0.22em×48×0.4978，即设计值）；控制条贴文字块上方、resize 手柄贴在右下；**提交后 250ms 与 1.2s 逐值零差异**；阅读态 stage scrollHeight == clientH（无滚动条异常）。贴图：stub 真图 600×400 → 资产 17,337B、naturalWidth 600×400、屏幕可见；1×1 → `role=alert`「图片太小（1×1），无法作为贴图」且 page.images 不增；纸张行 6 项（空白/横线/网格/点阵/**背景图片**/**背景 PDF**）、＋ 菜单仅文字/贴图、阅读态无背景入口。
  · **测试数据已回滚**：Android 那篇「无标题手写板」按产品路径（选中 → ×）删掉两轮验收插入的 2 张 600×400 测试图，正文 `page.images` 回到 **1 条（用户自己的 1×1）**、文字块与笔迹未动（正文 2686B / v4 / images=1 / texts=1 / strokes=14）；设备磁盘上两张测试资产：`1793778383110_ea2bce4e.png` 经 `lakeNative.deleteOrphanAsset`（= 资源页孤儿清理同一条路）删除，`1793777701306_eb3ba50d.png` **被历史快照 #13（07:41）引用 ⇒ 按设计保留**（正文/声明/同步都不引用，用户不可见；删了会让该快照恢复缺图。`cleanNoteOrphans` 不在 lakeNative 契约里、`cleanupHistory` 是全局保留策略，都不适用于单文件，故不做）。桌面复现实例（`--user-data-dir=/tmp/lake-board-repro`）里的测试文字块/贴图保留在 /tmp 实例，不进用户数据。
  · **桌面（dev 实例 CDP 9222 / vite 1421 / 资产 19877；before = HEAD 运行时）**：编辑框 border/padding/background/border-radius 全 0、字号不再被 8px 夹（PDF 页 5.1px vs 展示 5.07px）、编辑中 `<text>`=0；**A4 与 PDF 两页 Δ左缘 +0.24 / +0.25px、Δ首行基线 +0.22 / +0.36px、字号差 +0.02 / +0.03px**（before：白底 + 1px 虚线框 + padding 2/4 ⇒ Δ基线 **+8.02px**、Δ左缘 **+5.19px**、字号 8px vs 5.07px = **1.58×**、textarea 默认 2 行高 30px）；失焦提交经 focus emulation 复验正常（CDP 下窗口无焦点不提交属装置）；贴图真图 600×400 可见、1×1 与损坏 PNG 均拒绝并给可见横幅；底栏「…点阵 背景图片 背景 PDF」仍在纸张之后，只读锁定态两按钮 `disabled` + opacity .5。
- **追加（同日·用户反馈 4）· 移动端瞬时提示改气泡**：导入失败/插入贴图失败/导入完成以前是板内 `.ink-invalid-banner`（role=alert）——它会占掉一块画布**并挤动页面尺寸**。现在 `InkPad` 新增宿主注入点 `onTransientMessage(text, kind)`：`MobileInkPad` 注入 `showToast`（与「已移入回收站」同一条 `.mb-toast` 原语，6s 自动消失、不占版面），桌面不注入 ⇒ 仍用板内横幅（空间足够、可回看）。**只有瞬时动作结果走这条通道**；保存失败 / 正文坏这类常驻状态仍用板内横幅。参数：`error` → `.mb-toast--error`（左侧 ❗），`info` → 普通 toast；截断/取消等可累加文案在 banner 模式下才拼串，toast 模式逐条弹。
- **追加的设备复验（Android，装含本批 APK）**：1×1 贴图 → `.mb-toast.mb-toast--error`「插入图片失败：图片太小（1×1），无法作为贴图」（rect 363×47.6 @ y16 顶部浮层）、`.ink-invalid-banner` **0** / `[role=alert]` **0**、`page.images` 0→0、**frame 396×560.08 弹出前后逐值不变**、**6095ms 自动消失**；真图 600×400 仍插入（images 0→1、无横幅），随后按产品路径删除复原（资产目录清空、orphans 0）。
- **追加（同日·用户现场报「点添加怎么自动有一个图」）**：
  · **根因 = 验收装置残留，不是数据没恢复**：CDP 里 stub 过的 `HTMLInputElement.prototype.click` 留在 WebView 里（不重启不清），用户接着点「贴图/背景图片」就被静默替换成 600×400 测试图。已 `force-stop` 重启解开（原生 click 复原）。**规则：验收里 stub 过文件选择后，必须 force-stop 重启 App 再交还用户**（见 §7#24）。
  · **顺带修一个真 bug**：`onPointerDown` 的贴图命中原来只看 `event.target.closest("[data-page-image]")`，而笔迹永远画在贴图上层（`<path>`）⇒ **被笔迹盖住的贴图永远选不中、删不掉**；改成 `hitTestPageImage(page, point)` 坐标命中（target 兜底）。护栏 = `inkPageImages.render.test`「被笔迹盖住也能选中」。
  · **清理**：3 张被塞进来的 600×400 测试图按产品路径（选中 → ×）删除 ⇒ `page.images 0`；CDP 点按在图面上留下的 **10 个 4×4 合成点**用整笔橡皮清掉；4 条孤儿资产走 `deleteOrphanAsset` 清空。用户笔迹（21 条）与文字块 "Tttt" 未动，笔记回阅读态、无横幅。
- **残余（已知、有意保留）**：① 编辑框 scale 用 frame 宽（含 0.5px 边）⇒ 桌面最右缘 **≤0.8px** 系统性偏移（肉眼不可见；要消掉需测量 SVG 内容宽 + 偏移，收益 < 复杂度）；② 编辑框里的**断行**由浏览器排（textarea），提交后由 `wrapInkTextLines` 估算排（屏幕/导出同一份）；中文 1em 两边一致，**长英文段**可能差一两行断点（估算偏保守 ⇒ 提交后行数只会更少/持平、不会裁切）；要彻底一致得把屏幕断行也交给浏览器，会与 PDF/SVG 导出分叉（主进程量不了字），本轮不做；③ 错误横幅沿用既有导入错误口径（不自动消失，直到下次导入/刷新）。
### 261104 · 反馈修正：高亮块不弹类型选择、分栏改**锚定气泡**（+ 两个坑）· **本地修复**
- **高亮块**（用户口径：不需要弹窗，块自带颜色选择）：移除 261104 早先加的「类型选择层」（`ALERT_TYPES` / `toggleAlertChooser`）；「高亮块」入口直接插默认档（`alert tips`），颜色/类型由块被选中后内核自带的色板改（用户截图）。
- **分栏**（用户口径：像对话框一样在原位置出气泡）：从「+ 面板底部内联行」改成**贴着「分栏」条目**的 fixed 气泡（优先条目上方 8px、放不下翻到下方、左右按视口夹住；透明背板点外部关闭）。**不要**在 dock 里挂 `window.addEventListener("pointerdown")` 关气泡——`dockPanelFocusGuard.test` 明确禁止 dock 自挂全局监听。
- **两个坑（都实测踩到）**：① dock 根是 `pointer-events:none`（只有 toolbar/panel 子项是 auto）⇒ 气泡必须自己 `pointer-events:auto`，否则 CDP/手指点按会**穿透到面板**（现象 = 点了「三栏」没反应、气泡还关了，误以为命令失效）；② 气泡用 fixed 时必须渲染在 dock 根、不能放进 `.med-panel-inner`（那里 overflow 滚动容器会裁）。
- **设备复验（lake_mobile）**：气泡 rect `[39,665,236,48]` 贴在「分栏」条目 `[111,721,93,52]` 上方（gap 8）；CDP 点「三栏」→ `ne-columns data-cols="3"`；点外部 → 气泡关闭；点「高亮块」→ `ne-alert` 计数 0→1、无任何选择层。
- **门禁**：tsc 0 / 全量 vitest **591 文件 3598 例（3586 通过 + 12 skipped）** / mobileLayers editor-dock 基线 280→298（气泡容器+背板+三分隔）/ ui-metrics pass / `git diff --check` 0。
- **追加（同日·用户口径）**：气泡里三个选项之间加 **0.5px 竖分隔**——「一眼能看出是 3 个块」（`border-left: .5px solid var(--lake-border-1)`，等分 76px×3）。
- **复盘**：本轮「分栏/高亮块」返工两次（内联行 → 气泡；类型选择 → 不弹）——首版按「补能力」做过头，属过度设计；已按用户反馈收敛，HANDOFF/AGENTS 只保留最终口径。
### 261104 · 二十四批：文字块「选中时固定出现」控制条（含 24 批首版理解纠偏）· **本地改动**
- 用户澄清：**选中时固定出现、失去焦点就消失**（首版按「每段文字常驻」实现是误读，已回退）：选中某段文字后，虚线边框 + `A-`/`A+` + 右下角拖宽手柄 + `×` 删除一直都在；点别处取消选中即一起消失。
- **编辑中也保留**：控制条按钮 `onPointerDown` 阻止默认行为（不抢 textarea 焦点 ⇒ 不会先失焦提交），所以输入过程中也能调字号。
- 实现：`InkTextSelectionControls` 去掉 `selected` 入参（只渲染选中的那一段）；InkPad 只对 `selectedTextId` 渲染边框与控制条，处理器 `startTextResize(event, id)` / `bumpTextFontSize(id, delta)` / `removeText(id)` 按 id 调用。
- 测试：未选中无控制条 → 点选出控制条/手柄/删除 → 点空白消失 → 再选中删除；cssLayers shared 258→259。
- **门禁**：tsc / vitest（2 条 `dockPanelFocusGuard` 红仍来自另一会话在途移动端改动）/ mobileui / diff-check。
### 261104 · 二十三批续：移动端插入入口（文字/贴图）+ 文字块控制条（A-/A+/拖宽/删除）· **本地改动**
- **移动端 ＋ 菜单**：新增「文字」（始终有）与「贴图」（宿主注入 `onInsertPageImage` 时）；`MobileInkPad` 实现 `onInsertPageImage`（相册选图 → `bridge.uploadResource` → 原图尺寸）。宿主没接任何入口时 ＋ 不出现，保持定稿 7 键一屏（护栏 `MobileInkPad.render.test` 仍然过）。
- **文字块控制条**（`InkTextSelectionControls.tsx`，独立文件避免跨端样式护栏）：`A-` / `A+`（字号 6..96）、`×` 删除、右下角**拖宽手柄**（宽度 60..页宽，影响折行，拖动只改内存、松手 commit）。
- **纯函数**：`resizePageText` / `bumpPageTextFontSize`（+ 2 例单测）；渲染测试覆盖 A+ 改字号、拖宽 300→500 落盘、× 删除。
- **门禁**：tsc / vitest（578 文件 3583 例；剩 2 条 `dockPanelFocusGuard` 红来自另一会话在途移动端改动）/ cssLayers（shared 227→258）/ mobileui / diff-check。
### 261104 · 二十三批：页内文字块（插入 / 双击编辑 / 拖动 / 删除 / 导出）· **本地改动**
- **插入**：顶部工具条「插入文字」（`Type`）→ 空块落在「水平居中、页面 15% 高度」并立刻进入编辑；空文本提交自动移除该块。
- **编辑**：双击进入编辑；用 HTML `<textarea>`（中文 IME 必需）；`Ctrl/Cmd+Enter`/失焦提交，`Esc` 取消。输入框位置/字号按页面百分比与当前缩放换算。
- **换行单一来源**：`inkPageTexts.wrapInkTextLines`（CJK 1em / 其它 0.55em）被渲染、导出、高度计算三处共用 —— 主进程量不了文字，精确测量会导致导出与屏幕不一致。
- **选中/拖动/删除**：点文字选中（虚线框）；拖动只改内存、松手 commit；Delete 删除；与贴图共用 `InkSelectionRect`（组件已从 `InkImageSelectionRect` 改名）。
- **导出**：PDF/HTML 与独立 SVG 都渲染 `<text>`+`<tspan>`，文本节点转义；测试含「转义」与「换行来自同一估算」。
- **门禁**：tsc / vitest（579 文件 3581 例；另有 2 条 `dockPanelFocusGuard` 红来自另一会话在途移动端改动）/ cssLayers（shared 215→227）/ mobileui / diff-check。
### 261104 · 二十二批：工具条重排（贴图上移 / 背景导入下沉）+ 修「贴图插入后点不中、不能再次编辑」· **本地改动**
- **排布（用户定稿）**：顶部工具条 = 画笔类 + 颜色/笔宽 + 撤销重做 + **贴图**（`Sticker` 图标，aria-label 仍是「插入贴图」）+ 缩放；底栏 = 页码/新建页/页面管理 + 大纲 + 导出 + 纸张 + **背景来源**（「背景图」「背景 PDF」文字按钮，排在纸张之后）。独立组件 `InkBackgroundSourceButtons.tsx`（跨端样式护栏只扫 SHARED 名单）。
- **真 bug**：内联 `<image>` 带着从背景图抄来的 `pointer-events:none` ⇒ 插入后一旦取消选中就再也点不到，用户报「贴图之后就不能移动、确定之后无法编辑」。已去掉该属性；实测 `document.elementFromPoint` 在贴图中心返回 `<image data-page-image>`，合成 pointerdown 能选中并出现手柄。
  · 顺手把两处 `setPointerCapture` 包 try/catch：合成事件里没有活动指针会抛 NotFoundError（虽然不影响选中，但控制台会响）。
  · 注：本机 CDP 的 `Input.dispatchMouseEvent` 目前打不进 Electron 窗口（连空白处画线都不产生 path）⇒ 真实鼠标/触摸验收由用户手测，自动化只用合成事件 + elementFromPoint 断言。
- **门禁**：tsc / vitest / cssLayers（desktop 120→138）/ mobileui / diff-check。
### 261104 · 二十一批续：贴图缩放手柄（下一批：文字块）· **本地改动**
- **缩放手柄**：选中贴图右下角出现手柄（`InkImageResizeHandle`，HTML 浮层 `cursor:nwse-resize`），拖动 = 保持宽高比、锚点左上角、最小边 24（复用 `resizePageImage`）；拖动期间只改内存，**松手才 commit 一次**；`pointercancel` 还原。
- **为什么用 window 监听而不是 setPointerCapture**：捕获会把事件重定向到句柄、连带改变后续 click 语义（AGENTS §7.20），且句柄是 HTML 浮层不需要捕获。
- 测试：`inkPageImages.render.test` 新增「拖到 x=500 ⇒ 宽 200→400、松手一次落盘」；形状函数另有 5 例纯函数单测。
- **门禁**：tsc / vitest（578 文件 3575 例）/ cssLayers（shared 205→215）/ mobileui / diff-check 全绿。
### 261104 · 二十一批：页内贴图交互（插入/选中/拖动/删除）+ 备注与文字块进全文搜索 · **本地改动**
- **贴图插入**（桌面底部「插入贴图」）：宿主选图 + 上传资产 → `placeInkPageImage` 按**页宽 40%、保持原图比例、居中**落到当前页（用户定稿）。纯函数集 `inkPageImages.ts`（place/hit/move/resize/remove，5 例单测）。
- **选中 / 拖动 / 删除**：点图 = 选中（SVG 虚线框 + HTML 浮层 ×）；拖动只改内存（docRef+setDoc），**松手才 commit 一次**；`pointercancel`/丢捕获还原；拖出页面钳到「至少 40px 在页内」；Delete/Backspace 删除。缩放函数已就绪，手柄 UI 下一批。
- **两个零件独立成组**：`InkImageSelection.tsx`（虚线框 + 删除按钮）—— 跨端样式护栏只检查 SHARED 名单（InkPad 在内），独立组件就不逼移动端补样式。
- **搜索**：`inkToSearchText` 从「恒空串」改为提取 **页备注 + 页内文字块**（笔迹仍不可搜）；快速路径先查 `\"note\"`/`\"texts\"` 标记，绝大多数保存路径零额外开销。
- **测试**：`inkPageImages.test`（5）+ `inkPageImages.render.test`（插入落点/自动选中/删除落盘/未注入无入口）；`inkDoc.test` 搜索用例改为「备注/文字块进、笔迹不进、坏正文不抛、超长截断」。
- **门禁**：tsc / vitest（578 文件 3574 例）/ cssLayers（shared 191→205）/ crossEnd / mobileui / diff-check 全绿。
### 261104 · 修「收/放键盘 + 点工具导致光标漂移」（嵌套 contenteditable 焦点误迁移）· **本地修复**
- **现象**（用户实机报，严重）：收起/展开键盘、点工具（面板开合/行内命令）后光标跑到别处或消失、正文滚动跳变。
- **根因（不是本轮 dock/字号/胶囊改动引入；键盘与光标代码本轮未动）**：`useEditSurface.applyImeSuppression` 的全局分支遍历**所有可见 contenteditable** 逐个 blur/focus。正文里一旦有嵌套编辑宿主（分栏卡 `NE-COLUMNS-CONTENT`、表格/卡片宿主），循环最后 focus 的是**最后一个嵌套宿主** ⇒ 焦点/选区被搬过去，浏览器再把正文滚到底（实测修复前：收键盘后 selection 丢失、`body.scrollTop 0→507`、caret rect 归零）。
- **修法**：① 只对**当前聚焦宿主** blur/focus（放回输入法时取**顶层**宿主），`inputmode` 仍写全部；② blur/focus 前后保存/恢复 DOM range 与滚动容器的 `scrollTop`；③ dock 工具栏 `onMouseDown` 先 `snapshotSelection()`；④ inline 命令后选区失效时 `repairSelection` 同步 + 下一帧各修一次。
- **设备复验（lake_mobile）**：收键盘 / 展键盘 / 开合「更多」/ 点「加粗」四组操作，caret rect（top=111,h=21）与 `body.scrollTop` **全程不变**；加粗重渲染后 anchor 文本节点被拆分（同位置，offset 2→0）。
- **触发条件说明**：这次是探针在测试文档里插了**分栏卡**（= 嵌套 contenteditable）才稳定复现；真实文档含分栏/表格/卡片时同样会踩。测试文档里的链接/分栏/高亮块是探针产物，可删。
- **门禁**：mobile 区（src/mobile/editor|notebook|ui）**42 文件 226 例全绿**；全仓 tsc/vitest 当前被另一会话在途 ink 改动挡住（`DesktopInkPad` 的 `onInsertPageImage` 等），非本次修复引入。护栏 `editSurfaceImeGuard.test.ts`（4 例静态契约）。
### 261104 · 二十批：inkDoc v4（页备注 / 页内贴图 / 页内文字块）+ 书签改页备注 · **本地改动**
- **为什么升 v4**：把「页级内容」一次装齐，避免反复升版把旧端反复踢进只读；**S3 协议不动**（正文按字节内容寻址、资产声明是全文字符串扫描）。
- **格式**：写 4、读 1|2|3|4。新增 `page.note`（≤200 字，截断而非丢页）、`page.images`（30/页）、`page.texts`（200/页，编辑 UI 后续批次）。集合字段不是数组 ⇒ 该页坏；数组里单个坏元素只丢自己。
- **书签 → 页备注**：删掉设备本地 `inkBookmarks.ts`（含测试），大纲面板换成「页备注」输入 + 保存（进撤销栈、标脏、随同步走）；大纲范围改成 只看批注 / 全部页 / **只看有备注**；缩略图条的小点改为「有页备注」。
- **贴图渲染**：InkPad 与三种导出（PDF HTML / 独立 SVG / 用其栅格化的 PNG）都按页逻辑坐标画 `page.images`（rotation 绕自身中心），笔迹永远最上层；`readInkPageSvg` 修掉「所有贴图共用背景图 data URI」的错，改成逐 URL 解析。
- **测试**：`core/inkDoc.v4.test.ts`（7 例：版本、备注往返/截断、贴图/文字坏元素只丢自己、上限、字段序）、`inkOutlinePanel.render.test`（备注保存进正文 + 三范围循环）、导出贴图用例。
- **门禁**：tsc / vitest（核心+ink+导出 1049+ 例全绿后再跑全量）/ cssLayers / mobileui / diff-check（见提交说明）。
### 261104 · ＋面板：分栏 2/3/4 栏 + 高亮块类型选择（设备实测）· **本地改动**
- **分栏**：「分栏」入口点开内联行（两栏/三栏/四栏），选中走内核 `columns` 命令（接数量）。设备实测：`ne-columns data-cols="3"`。
- **高亮块**：「高亮块」入口点开内联行 5 个语义类型（提示 info / 技巧 tips / 成功 success / 注意 warning / 危险 danger），选中走 `alert` 命令。设备实测落盘 `ne-alert ne-alert-type="danger"`（alert 计数 8→9）。
- **行内选择行自动滚入可视**：+ 面板内容已满 312px，新增选择行会落在可视区外（点了入口却看不到选项 / 按坐标点空）⇒ 展开时对面板最后一行 `scrollIntoView({ block: "nearest" })`（分栏/高亮块/链接共用）。这是本轮踩到的真坑（首测点「危险」点在面板外）。（**261104 反馈后修订**：分栏改锚定气泡、高亮块不再弹选择 ⇒ 这条现在**只剩链接编辑行**仍适用。）
- **内核边界（已回填契约 §5.46，避免以后重复试）**：`unlink` 命令在本项目的链接上返回 false（host 的选择模型拿不到"纯链接选区"，只有内核链接面板那条路）；`replaceAll` 需要 ranges 数组，传文本会抛 `t.forEach is not a function` ⇒ 移动端「查找替换」本轮不做（不绕过内核模型改正文）。
- **门禁**：tsc 0 / 全量 vitest **586 文件 3575 例（3563 通过 + 12 skipped）** / `git diff --check` 0。设备：三栏 `data-cols=3`；危险高亮块 `ne-alert-type=danger`；Aa 面板 312/312 不变。
### 261104 · 字号/行高合并成一行步进器 + 两端对齐 + 首行缩进文案收口 · **本地改动**
- **字号 + 行高合并一行**（用户点单）：两行各一枚「− 当前 +」步进器，共用 `src/mobile/ui/ValueStepper.tsx`（`FontSizeStepper` / `LineHeightStepper` 都是薄包装；几何/无障碍一套）。「更多」面板 5 行 → **4 行**（公式行 / 缩进行 / 字号+行高 / 画图族）。
- **行高可回显、可回默认**：设备实测 `queryCommandValue("lineHeight")` 默认返回 **null**、设置后返回数值；「默认」档 = **不传参**调用 `execCommand("lineHeight")`（传 `"default"` 会抛 `lakex_editor_assert_error`）。档位顺序照内核下拉 `[1, 1.15, 1.5, 默认, 2, 2.5, 3]`。
- **两端对齐（justify）接通**：内核 `alignment` 接受 `justify`（实测 `ne-alignment=justify`），Aa 对齐从 3 档补到 **4 档**（属补入口，不是缺口）。
- **首行缩进文案收口**：内核 `firstIndent` 是**整篇**把 root 下所有 `p` 设 `text-indent`、只 set 不 remove（outdent 也不清）⇒ 改名「**全文首行缩进**」，不再当"当前段开关"。`clearFormat` 只清行内 mark（与 Word/语雀一致）——这两条从 P2 缺口表**关闭**。
- **设备复验（lake_mobile，重建 APK）**：更多面板 4 行、合并行两张卡、字号 16→19、行高 2→2.5→2；Aa 面板 clientHeight = scrollHeight = 312；点「两端对齐」后 `ne-alignment=justify`。
- **门禁**：tsc 0 / 全量 vitest **585 文件 3570 例（3558 通过 + 12 skipped）** / mobileLayers editor-dock 基线 265→280 / `git diff --check` 0。
### 261104 · 十八批：手写板大纲 / 书签（设备本地）+ inkDoc 随机健壮性护栏 + 真机验收清单 · **本地改动**
- **书签 = 设备本地视图**（`features/ink/inkBookmarks.ts`）：key `…v3.ink-bookmarks.<noteId>`，不进正文/不标脏/不进 S3；单篇上限 200；坏值静默回退；删页顺手清理。
- **大纲 = 纯派生**（`features/ink/inkOutline.ts`）：`annotated`（默认：有笔迹 / 有页图 / 有书签）与 `all`；`inkOutlineSummary`、`bookmarkPageIds` 两个小纯函数。
- **入口**：桌面底部「大纲」按钮 → 弹出面板（摘要 + 当前页书签开合 + 页列表点跳）；缩略图条给书签页打小点（`InkPageStrip` 新增 `bookmarkedPageIds?`）。移动端本轮无入口（底部坞 7 键定稿）。
  · 控件独立成 `InkOutlinePanel.tsx`（桌面专用）—— 与 `InkExportMenu` 同因：跨端样式护栏要求共享组件类名两端都有样式。
  · 坑：`InkOutline.tsx` 与 `inkOutline.ts` 只差大小写 ⇒ macOS 大小写不敏感 + tsc TS1149 ⇒ 组件改名 `InkOutlinePanel.tsx`。**新增文件别只靠大小写区分**。
- **inkDoc 随机健壮性护栏**（`core/inkDoc.fuzz.test.ts`，确定性 mulberry32）：① 120 轮随机合法文档往返（页/笔/点计数一致、可再序列化）；② 400 轮畸形输入（截断/改字节/错版本/深嵌套/错类型）断言 `parseInkBody` **永不抛错**、非 null 结果可再序列化；③ null/空串/16MiB 边界。理由：保存会永久丢弃坏页 ⇒ 解析健壮性 = 数据安全。
- **真机验收清单**（`docs/INK-DEVICE-CHECK.md`）：延迟/压感/掌托四场景/大文档五指标 + `__lakeInkInputStats()` / `__inkPerfStats()` 取数法 + 「什么结果改哪个文件」。真机数据回来前**不动**压力映射与掌托策略。
- **门禁**：tsc / vitest / cssLayers 基线（shared 188→191、desktop 52→120）/ diff-check。
### 261104 · 字号步进器（Aa → 更多）+ 二级面板开合「胶囊闪入闪出」修复 · **本地改动**
- **字号步进器（用户批准方案）**：字号从「Aa」面板底部 8 钮改成 `− 当前 +` 步进器，搬进「更多」面板、与行高/缩进同组（261012 原定「放最底部」作废）。档位仍是内核 12 档掐头去尾的 8 档（14…32）；命令仍 `fontsize`（px 入参），回显读 `queryCommandValue("fontsize", false)`。共用控件 `src/mobile/ui/FontSizeStepper.tsx`（几何照表格 T 面板：40 高 / 132 宽 / 18px 图标 / 首尾置灰）。**Aa 面板内容 354 → 300px**。
- **面板高度下限 280 → 312**（`useEditSurface({ minPanelHeight: 312 })`）：Aa 300px 在 280 下限下仍会裁 20px；且「打开前键盘开着」捕获 312、「键盘关着」落到 280 ⇒ 同一面板两种高度。312 ≈ 常见键盘高，面板尺寸稳定。
- **胶囊闪入闪出（用户报）**：根因 = 面板开合会顺带切 IME（开：收；关：放回）⇒ `keyboardOpen` 在过渡里抖一次，`capsuleHidden` 跟着变，再配上 250ms transform/opacity 过渡 = 胶囊在面板边上滑入/滑出。
  · 修法 ①：判据抽到 `src/mobile/notebook/capsuleVisibility.ts` 纯函数；**面板 open/closing 阶段冻结可见性**（打开前是什么就保持什么，关完再按键盘判据）。`dockPanelPhase` 单一来源 = `src/mobile/editor/dockPanelPhase.ts`（EditorDock 写、useWorkspaceChrome 读）。
  · 修法 ②：编辑态胶囊 `.mobile-bottom-bar--above-dock { transition: none }` ⇒ 残余键盘路径也瞬时，不再滑动。
- **设备复验（lake_mobile，重建 APK）**：键盘关着开面板 → 胶囊全程可见、零 class 翻转（被 dock z=4 盖住）；键盘开着开面板 → 胶囊全程保持隐藏，不再「弹出来又缩回去」；关面板 → 无 opacity/transform 中间帧，键盘回填后瞬时隐藏；⌨ 收键盘 → 瞬时恢复；Aa 面板 clientHeight = scrollHeight = **312**（不再溢出）。
- **门禁**：tsc 0 / 全量 vitest **581 文件 3552 例（3540 通过 + 12 skipped）** / mobileLayers 基线 mobile.css 1486→1487、editor-dock.css 259→265 / `git diff --check` 0。
### 261104 · 十七批：手写板导出（整本 PDF 压缩 + 单页 PDF/PNG/SVG + 底纹随页）· **本地改动**
- **整本 → PDF（既有能力，本轮修体积）**：页图内嵌前用 sharp 转 JPEG q80（Chromium 打印会把 WebP 按无损重写）。335 页实测 **382 MB / 30.0 s → 74.9 MB / 13.5 s**（页数仍 335）。链路：`exportInkPdfHtml`（改异步）→ `printToPDF`。
- **底纹与画布一致（用户定稿）**：`buildInkPdfBody` 逐页输出 `ink-page__paper`（pattern + rect），几何抽到 `src/core/inkPaperGeometry.ts`（画布 `InkPaper.tsx` 与导出共用，不再各写 32/16/1.4/31.5）；`blank` 页仍是白纸。
- **单页导出（新增）**：手写板底部**一个**「导出」按钮 → 悬浮菜单「当前页 PDF / PNG / SVG」（用户明确不要三个按钮）；移动端不注入 ⇒ 无入口。
  · PDF：`export_note` 新增第 4 参数 `{ pageIds }` → 同一管线只导指定页（1 页 134 KB / 213 ms）。
  · SVG：新 IPC `read_ink_page_svg`（纯读，返回自包含 SVG 文本）+ `export_ink_page_svg`（落盘；170 KB / 20 ms）。
  · PNG：渲染层 `inkSvgRasterize.ts` 把 SVG 以 2× 画到 canvas → 新 IPC `save_ink_page_png` 落盘（2667×4176 / 1.79 MB / 309 ms）。
  · 坑：`createImageBitmap(new Blob([svg], {type:'image/svg+xml'}))` 对带 data URI 图片的 SVG **解码失败**（InvalidStateError）⇒ 必须走 `img.src = data:image/svg+xml,…`。
  · 目录：新增 IPC 允许省略目录（= 默认 `~/Desktop/lakex-local-notes-导出`）；传了就必须来自 `pick_export_dir` 白名单。
- **明确不做**：移动端导出（Android 缺 SAF/分享落盘，要原生插件 + 设备验收）；整本导出为图片（只做单页，整本只出 PDF）。
- **测试**：`noteExport.inkPdf.test.ts`（底纹 / pageIds 过滤 / JPEG 内嵌 / 单页 SVG / 静态契约）、`inkExportPage.render.test.tsx`（一个按钮 + 三格式菜单 + 回调当前页 + 失败横幅）、`inkPadWiring` 桌面分支契约更新。
- **实测产出**（`~/Desktop/lakex-local-notes-导出/`）：`pdf-335实测-6.pdf`（74.9 MB）、`pdf-335实测.png`、`pdf-335实测-4.svg`、`dot-bg-dot.png`（底纹与笔迹都在）。
- **门禁**：tsc / 全量 vitest / check:mobileui / diff-check（见提交说明）。
### 261104 · 十六批：PDF 导入「边导边用」+ 笔迹样式收敛成单一来源 · **本地改动**
- **边导边用（用户点单：解析慢没关系，解析一部分就一部分能用）**：`importPdfPages` 新增 `onPagesReady`（每攒够 `IMPORT_COMMIT_BATCH=10` 页交付一批，**第一批不等满批**）；`InkPad` 立刻 `commit` 进正文，用户可在后台继续栅格化/上传时就开始标注。
  · 不抢当前页：`planPdfPageInsert(..., { keepActivePage })` —— 第一批替换空白首页并切到第 1 页，之后每批只追加。
  · 取消：已交付页留在正文并提示「已取消 PDF 导入：已导入 N 页，可以继续标注」；未交付页连资产清掉，且清理**只删未交付 URL**（`committedUrls`），否则正文会出现被删图的坏页（磁盘核对：50 页资产全在）。
  · 失败页也算「已完成」，否则一个坏页会把后续交付永久卡住。
- **真实 335 页书验收（dev 桌面，visible 窗口）**：500ms 时进度 1/335、正文 1/1；**3.5s 正文已 11 页**；之后每 ≈2s +10 页（21→31→41→51）；中途取消 ⇒ 正文 51 页保留、`[role=alert]` 文案正确、save 样本 0.1–0.3ms / 正文 21–32 KiB。
- **笔迹样式单一来源**：新增 `src/features/ink/inkStrokeStyle.ts`（perfect-freehand 参数 + opacity/blend），画布静态层、正在写的笔、缩略图、`electron/noteExport` 四处改为从它取（此前 4 份拷贝，缩略图 0.35 与其它 0.3 已漂）。用户定稿**不加更多笔工具**，只保留「锋利感（thinning/taper）/ 平滑感（smoothing）」旋钮。护栏 `inkStrokeStyle.test.ts`。
- **测试**：`pdfImport.test`（批次 3/3/1 + 取消时不动已交付资产 + 失败页不卡交付）、`inkPdfImport.render.test`（第一批到手即出页、第二批追加不抢页、取消文案）、`inkStrokeStyle.test`（数值 + 禁止字面量）。
- **门禁**：tsc / 全量 vitest / check:mobileui / diff-check（见提交说明）。
### 261104 · 十五批：PDF 导入 500 页 + 进度分母修复 + 纸张在 PDF/图片页的处置 + 高亮笔宽度 · **本地改动**
- **PDF 上限 300 → 500**（`INK_PDF_MAX_PAGES`；`pdfRasterDesktop` 默认值改为引用同一常量，不再各写一份）。截断提示、toast、静态契约测试一并改。
- **进度分母修复（用户报「两个数一起涨，后面应该是总页数」）**：旧实现上传阶段传 `total = Math.max(enqueued, uploaded)` = 「已入队数」⇒ 恒显示 298/298。
  · 现在分母 = 栅格化首事件报上来的真实总页数并夹到上限（移动端原生报的是 PDF 真实页数），分子在栅格化阶段看已渲染页数、栅格化完成后改看已写入页数（`pdfProgressText` 纯函数）。
  · 真实 335 页导入实测：进度事件 670 条、上传阶段分母**全程恒为 335**（不再是 1..335 递增）。
- **PDF 页禁用纸张切换**（页图铺满整页 ⇒ 切了看不见却会标脏，用户看到「更新的黄点」）：`isPdfPageBackground()` 判 `source:'pdf-page'` 或带 `pdf` 字段；按钮 disabled + `setBackground` 早退，不写盘。
- **图片页恢复纸张底纹**（用户报「点阵点了没效果」）：此前「有图就不画 InkPaper」⇒ 图片页永远白纸。现在 InkPaper 恒在最底层、`<image>` 叠其上 ⇒ 图未铺满时留白处能看到网格/点阵（设备截图确认 QR 页上下留白出现点阵）。
- **高亮笔太少/太细的根因**：两种工具共用 `WIDTHS=[1.5,2.5,4,6]`，在高亮态点任意档位会把 18 改写成 1.5~6，且选中态永远不亮。改为**按工具分档**：笔 1.5/2.5/4/6、高亮 10/18/26/34；另把高亮改成 `thinning:0`（宽面马克笔等宽，不再收锋）。桌面/移动共用 `widthPresets` + `widthDotSize`。
- **真实 335 页 PDF 实测（Chromium 渲染进程，非合成夹具）**：87.5 MiB / 335 页全量导入 **64.5 s**（≈192 ms/页，含 43.05 MB WebP 上传，池宽 3 重叠；首事件 295 ms，无截断无错误）；该文档正文 **114,051 B**，打开解析 **0.6 ms**、序列化 **0.2 ms**；补每页 10 笔×30 点（3350 笔）后正文 **1.67 MiB**、序列化 **7.4 ms** / 解析 **7.0 ms**。
- **v4 阈值按实测改口径**：删掉「页数 > 50」（成本 ∝ 字节；真实 300 页文档正文 111 KiB 却打了 warn ⇒ 假警报），改为 正文 > 2 MiB / 序列化 > 16 ms / 解析 > 100 ms / 同步侧证据；`docs/INK-PAD.md` 补实测表与换算（≈23 B/点、690 B/笔、4 MiB ≈ 6100 笔、真实上限 ≈ 6.6 MiB）。
- **环境坑（新增 §7 级别）**：dev Electron 窗口 `document.visibilityState === 'hidden'` 时 pdf.js 渲染依赖的 rAF 不触发 ⇒ 导入**永久卡在「正在导入 PDF：准备中…」且 CPU 0%**。做 PDF 导入实测前先 `osascript -e 'tell application "System Events" to set frontmost of process "Electron" to true'`。
- **门禁**：tsc / 全量 vitest / check:mobileui / diff-check（见提交说明）。
### 261104 · P2 移动端文本格式能力实测（只读探测 + 设备实测，未改代码）· 结论落 §3
- **方法**：lake_mobile（emulator-5554）+ 已装 debug APK（0.0.2，11-03 21:31），CDP `Input.dispatchMouseEvent` 点按 / `Input.insertText` 输入，`adb exec-out screencap -p` 截图；在真文档里逐项验证 `ne-*` 属性与计算样式（判据不是按钮高亮）。
- **结论：旧文档列的「H5/H6、缩进、行高、清除格式、格式刷」大多早已存在且生效**——H1–H6（28/24/20/15px）、字号（22→22px）、颜色/背景、对齐、三种列表、缩进（32/64px）、行高（2→32px）、上标/下标（12px + vertical-align）、清除格式（清行内 mark）全部 ✅。
- **唯一 no-op = 格式刷（已于同日修复，见文末一行）**：无参 `execCommand('paintFormat')` 不记录格式（根节点无 `.ne-paint-formatting`），选目标无效、无 toast；根因与修复方向见 `LAKEX-CONTRACT.md` §5.45。
- **新发现**：① 首行缩进是**全文级且不可取消**（内核遍历 root 下所有 p，只 set 不 remove）；② clearFormat 只清行内、不清块级（对齐/缩进/行高/段落样式保留）；③ Aa 面板内容 354px > 可视 312px，**字号行默认在屏外**（按坐标点会落空，首测被误判成 no-op）；④ 未接入口 = justify / unlink（两端皆无）/ replace（移动只查不换）等。
- **修复已落地（同日，非探测批）**：新增 `src/mobile/editor/formatPainter.ts`（按内核 service token 取 `IFormatRenderService`，`recordPaintFormat`/`clearPaintFormat`）+ dock「格式刷」改走它；**记录必须晚于面板收起**（内核 `afterExecCommand('selection')` 会把刚记录的刷子当场消费）。设备复验：开刷 → 目标段变 `ne-bold` 且刷形态自动退出；再点「格式刷」= 取消并提示「已退出格式刷」。护栏 `formatPainter.test.ts` 7 例。
- **环境遗留**：dev 实例留有一篇「无标题文档」测试页（可删）。回填：`LAKEX-CONTRACT.md` §5.45 + 本节 §3 已按实测重写。

### 261103 · 十四批：移动端资源页「本地资源占用」（原生只读统计）· **本地改动**
- **缺口**：桌面「关于 → 数据与存储 → 内容统计」已有「资源 N 个，X MB」，移动端只有资源**数量**（`diag.resourceCount`）、没有字节数；JS 侧逐文件 stat 每次 ≈68ms 桥往返，几万文件不可用。
- **做法**：新增只读原生插件 `AssetUsagePlugin`（`@CapacitorPlugin(name="AssetUsage")`，后台线程递归 walk `filesDir/note-assets` + `quick-notes/assets`，返回 `{files, bytes}`，不删不改）；`MainActivity` 注册；TS `src/mobile/native/assetUsage.ts`（仅原生端，Web 预览/测试返回 null）；bridge 暴露 `getAssetUsage()` 并登记进 `lakeNative` 调试契约（62 → 63）；资源页新增一行「本地资源占用」显示 `N 个文件，X MB`。
- **设备实测（emulator-5554 / 1080×2400，新 APK）**：先经 bridge 上传一张探针 PNG（202B）→ `lakeNative.getAssetUsage()` = `{files:1, bytes:202}`；打开 设置 → 资源管理，页面显示「本地资源占用 … 1 个文件，202 B」（与原生统计一致）。
- **测试**：`useSettingsSectionData.test` 增加 getAssetUsage 断言（resourcesOpen 时读取）；`lakeNativeContract.test` 计数 62→63（显式改）；Kotlin 侧仅过 `compileDebugKotlin`（构建通过），真机手写笔场景不涉及本插件。
- **门禁**：tsc / 全量 vitest / check:mobileui / diff-check 全绿；APK 构建成功。
### 261103 · 十三批：手写板导入体积提示（P2 落地）+ 翻页预解码（P1 实测否决）· **本地改动**
- **P2（已落地）**：图片页 / PDF 导入完成后给一条 6s 自动消失的状态提示，说明页数与**本次上传的资产字节**（= 首次同步要传的量）：`已导入 3 页，图片约 1.5 MB（首次同步会一起上传）`、PDF 截断时 `已导入 12 页（共 20 页）…`。
  · 实现：`inkImportNotice.ts`（纯格式化/文案）+ `importInkImagePages`/`importPdfPages` 累计 `uploadedBytes`（upload 结果带 size 时累计；缺省 0）；`InkPad` 用现有中性 banner（`data-ink-import-notice`）展示、定时清除。
  · 单测：`inkImportNotice.test` 3 例 + `inkImageImport` 上传字节累计 1 例；不新增依赖/样式。
- **P1（预解码相邻页背景图）实测否决**：20 页整页图文档 A/B 翻页耗时 —— **未预取 30.4ms / 预取后 32.0ms**（均 10 次两帧到稳定）⇒ 30ms 级成本在 SVG/React 重渲染而不是图片 decode；按「无收益不保留」删掉整段预取实现（代码处留一行结论注释），避免无收益复杂度。
- **门禁**：tsc / 全量 vitest / check:mobileui / diff-check 全绿。
### 261103 · 十二批：图片页背景导入下采样（防 48MP 图当背景时解码 OOM）· **本地改动**
- **触发**：用户问「PDF/大量图片当背景标注是否影响性能」。实测 20 页整页图背景：正文仅 **4,466 B**、只解码当前页 1 张、翻页 ≈33.5ms、缩略图全走 `?w=256` ⇒ 运行时开销可控；**真正风险 = 图片页背景导入不限尺寸**（48MP ≈ 190MB 解码/页，移动端可能被杀）。
- **修法**：`inkImageImport` 新增 `INK_BACKGROUND_MAX_EDGE=2400` 与纯函数 `inkBackgroundDownscaleTarget`；导入前超过最长边就走 `inkImageDownscale.downscaleInkImageFile`（canvas 等比缩放，webp 0.9 → jpeg 兜底）再上传，并把目标像素尺寸记进正文；小图不缩；下采样失败按原图导入（不阻断）。
- **收益**：最坏单页解码 ~190MB → **~23MB**；PDF 路径不变（raster maxWidth 1600/上限 2400）。
- **测试**：`inkImageImport.test` 新增 3 例（大图缩放并上传缩放字节/小图不缩/失败回退 + 目标尺寸纯函数），共 10 例全过。
- **门禁**：tsc / 全量 vitest / check:mobileui / diff-check 全绿。
### 261103 · 十一批：手写板性能观测 + v4 演进提案（先量化再决定）· **本地改动**
- **背景**：用户问「手写板要不要重新设计 / 有没有增量保存与虚拟加载」。结论：**不重写**（core/几何/历史纯函数分层、只渲染当前页、缩略图视口虚拟化、页级 undo patch、防抖+未变不写都已就位），真正缺口在**存储/加载粒度**。
- **已落地（默认零行为改变）**：`src/features/ink/inkPerfStats.ts` —— 在 `parseInkBody`（打开）与 `inkToBody`（保存）两处记录 `{kind, ms, bytes, pages, strokes?, points?}`（环形 40 条）；`window.__inkPerfStats()` 取数、`__inkPerfReset()` 清空；开日志 `localStorage["lakex-local-notes-v3.ink-perf-debug"]="1"`。阈值常量：正文 >4MiB / 页数 >50 / 序列化 >50ms / 解析 >300ms（命中打 warn，作为 v4 立项判据）。
- **设备实测（桌面 dev / CDP 9222）**：打开 1 页 45 笔样本 → load 0.1–0.5ms / 14.8KB；落一笔保存 → save 0.4ms / 15.1KB / 46 笔 / 515 点。
- **提案写入** `docs/INK-PAD.md` 新增「手写板 v4 演进提案（未立项，先观测）」：页粒度 `manifest.json + pages/p-<id>.json`、脏页增量写、manifest+当前页±预取加载、页对象内容寻址同步、沿用「新端写 v4 / 旧端只读」兼容先例；列出立项阈值、改动面与风险、明确不做（journal 半吊子 / 页内笔迹裁剪）。
- **单测**：`inkPerfStats.test.ts` 3 例（阈值判据独立 / 环形 40 条 / debug 开关）。
- **门禁**：tsc / 全量 vitest / check:mobileui / diff-check 全绿。
### 261103 · 十批：手写板「笔迹偶发消失」根因修复（中断即丢弃 ⇒ 提交已完成部分）· **本地改动**
- **用户复测反馈**：九批按批渲染后**仍然偶发消失**，同一操作在画板里完全正常 ⇒ 说明不是通用渲染压力，是 ink 自己的收口路径。
- **根因**：`InkPad` 的 `cancelPointer` 绑在 `onPointerCancel` **和 `onLostPointerCapture`** 上，且第一行就把 `activeStrokeRef` 置空 ⇒ 只要一次落笔**没收到配对的 pointerup**（快速滑动时浏览器可能先发 `lostpointercapture`、或捕获被释放/重定向，up 打到别的元素上），已经画出来的笔迹就被**静默丢弃**；更糟的是 `activePointerRef` 残留会让后续 pointerdown 直接 `return`（画不上，要重开文档）。画板（Drawnix）没有这条路径，所以同操作正常。
- **修法（`src/features/ink/InkPad.tsx`）**：
  · 新增 `finalizeInterrupted(reason)`：画笔/高亮笔在中断时**若已 ≥2 点就按已完成部分提交**（并写一次历史增量 + 打 `[ink] 落笔被中断…` 警告）；橡皮保留原语义（回滚到本笔开始 + 不进历史栈）；<2 点视为误触丢弃。
  · `onPointerCancel` / `onLostPointerCapture` 都走它（不再直接丢笔）。
  · `onPointerDown` 发现 `activePointerRef` 残留（上一次 up 丢失）时，先对残留那笔执行同一收口，再开始新笔 ⇒ 不会再「整块画布从此画不上」。
- **设备实测（桌面 dev / CDP 9222，隔离数据目录）**：
  · 落笔中途派发 `pointercancel` → 正文笔迹 **22 → 23**（以前是丢弃，不计入）；
  · 只按下+移动、**不发 pointerup**，紧接着再按下继续画 → **23 → 25**（残留那笔先落盘 + 新笔照常）。
- **单测**：`inkPadWiring.test.ts` 增 1 例（中断收口/残留 pointer/按批渲染三组静态契约，30 例全过）。
- **待办**：请用户复测「快画/快擦」；若仍复现，用九批的 ink 诊断（`__lakeInkInputStats()`）回传，重点看是否有 `cancels>0` 或 `ups=0` 的笔。
### 261103 · 九批：手写板落笔批处理 + 指针诊断扩到 ink（用户澄清：是**手写板**不是画板）· **本地改动**
- **澄清**：八批按「画板（Drawnix）」查了；用户指出实际是**手写板（ink）**。八批的画板诊断保留（默认关、无害），本轮把诊断与热路径修到 ink。
- **机制层根因方向**：`InkPad` 的 `onPointerMove` 每个 coalesced 点都 `setActiveStroke`、每个擦除点都 `setDoc` ⇒ 一次 pointermove 触发 N 次 React 重渲染 + perfect-freehand 轮廓重算。快速落笔/快速擦除事件率最高，渲染被压垮（「画快了不生效」最可能的成因）。
- **修法（`src/features/ink/InkPad.tsx`）**：`appendPoint` 只改 ref（`activeStrokeRef`/`lastPointRef`）并返回是否追加，不再逐个 setState；`onPointerMove` 整批 coalesced 点追加完**统一 setActiveStroke 一次**。`eraseAt` 只改 `docRef`+`erasedIdsRef` 并返回是否擦到，一批擦完**统一 setDoc 一次**。落笔数据始终在 ref ⇒ 渲染节流不影响保存/capture。
- **诊断扩到 ink**：`src/features/board/boardInputDiagnostics.ts` 泛化（`label=board|ink` 分桶、只统计指定画布 `.plait-board-container` / `.ink-page-svg`，同一套 pointerType/moves/ups/cancels/lost/coalesced/时长/mouseAfterPen 聚合）。开启：`localStorage["lakex-local-notes-v3.ink-input-debug"]="1"` 后重开手写板标签；`__lakeInkInputStats()` 取数（画板仍 `__lakeBoardInputStats()`；`window.__lakePointerInputDebug=true` 全开）。
- **校验（桌面 dev / CDP 9222，隔离数据目录）**：手写板快速落笔 240 点 → 正文笔迹 2→3；整笔橡皮快速横扫 120 点 → 3→2；诊断记录 2 笔（label=ink，moves=240/120，cancels=0）。单测 +1（ink 分桶/画布过滤），`boardInputDiagnostics` 共 5 例 + `boardValueCoalescer` 3 例。
- **待办**：请用户在**手写板**上按 ink key 复现快画/快擦，把 `__lakeInkInputStats()` 发回；若仍丢，按统计判断是事件没进来 / 引擎没消费 / 被 cancel，再定后续（eraser 必要时加线段相交命中）。
### 261103 · 八批：画板输入诊断 + 回灌合并（定位「快画/快擦丢笔」）· **本地改动**
- **背景**：用户报桌面端画板快速落笔/快速擦除不生效（三端可能都有）。
- **复现结论（桌面 dev / CDP 9222，隔离数据目录）**：用合成鼠标事件**无法复现**「快画丢笔」——1 点 / 2 点 / 15 点 / 120 点 / 500 点笔画全部落笔并写入正文（回读 `readNote` 核对元素数）。但发现一个**确定性异常**：发生过一次 `pointerType=pen`（数位笔）笔画后，**后续鼠标笔画全部不生效**（pen 仍能画，刷新页面恢复）——疑似 plait 的输入类型切换卡住，也可能只是 CDP 合成残留，**待真机确认**。
- **新增 `src/features/board/boardInputDiagnostics.ts`（默认关，生产零开销）**：开启 = `localStorage.setItem("lakex-local-notes-v3.board-input-debug","1")`（或运行时 `window.__lakeBoardInputDebug=true`）后重开画板标签；只观测画布 `.plait-board-container` 上的 pointerdown/move/up/cancel/lostpointercapture，按「一次落笔」聚合 `pointerType / moves / ups / cancels / lost / coalesced / 时长` 并打 `[board-input]` 单行日志；`window.__lakeBoardInputStats()` 取结构化数据（含 `mouseAfterPen`）、`__lakeBoardInputReset()` 清空。判读口径写在文件头。
- **新增 `src/features/board/boardValueCoalescer.ts`**：把「onChange → 回灌 React state」合并到下一帧（16ms 定时器，**不用 rAF**——隐藏窗口不触发）；保存/capture 用的 `cardValueRef`/`valueRef` 仍同步更新。桌面 `BoardEditor` 与移动 `MobileBoardViewer` 都接入，避免快速落笔时「React 渲染 + 引擎按新 value 重算」叠在同一帧。
- **校验**：桌面 dev 慢笔 12 点 / 快笔 120 点均落笔并落盘（元素 17→19、19→21）；诊断只记录画布上的 2 笔（工具栏点击已排除）；单测 `boardValueCoalescer` 3 例 + `boardInputDiagnostics` 3 例。
- **待办**：请用户按上面开关复现一次（桌面鼠标/数位笔各一次），把 `__lakeBoardInputStats()` 输出发回；确认是「事件没进来」「plait 没消费」还是「笔→鼠标卡住」后再定修法（若确认 pen→mouse 卡住，按现有 patch 机制做最小依赖补丁或在宿主侧重置输入类型）。
### 261103 · 七批：AI 助手默认关闭（桌面与移动端同口径）· **已提交并双推 `fdf9c455`**
- **口径**：AI 助手**默认关**。桌面 `src/lib/aiEnabled.ts` 由「默认开」翻成「默认关」——判定改为 `=== "1"`，localStorage 不可用时也回落 **false**（fail-closed，不替用户打开）；移动端 `src/mobile/ai/aiSettings.ts` 本来就是默认关（`=== "1"`），本轮不做改动，仅对齐文档。
- **行为不变的部分**：关闭只拦网络（`lib/ai.ts` 的 `runAiChat` 直接拒绝、`aiNetworkHint` 文案不变），**配置与 API Key 保留**；入口仍可见（移动端首页 AI 键仍可进页，进页显示「AI 助手已关闭」+ 去开启；桌面点入口报同一句引导），否则用户找不到开关。
- **测试**：`lib/aiEnabled.test.ts` 默认关 + 存储异常 fail-closed；`lib/ai.test.ts` 的「正常走主进程」用例改为**显式置 `1`**（此前依赖默认开）。
- **文档**：261029 历史条目加「261103 起改为默认关」标注；MOBILE-AI.md 既有「AI 助手（默认关）」不变；AGENTS §4 增加一行长期口径。
- **门禁**：tsc 0 / 全量 vitest 全过 / check:mobileui / `git diff --check` 0。
### 261103 · 六批（A 组工程收尾 + B1/B2 多维表收尾 + A3 设备门禁补齐）· **已提交并双推（`ae14ffd1` / `1f164f2b`）**
- **A1 横屏左右安全区**：新增令牌 `--mobile-left/right-safe-area`（`env()` 与原生 `WindowInsets` 注入值取 max）；原生 `lakeInsets` 增加 `getLeft/getRight` 并把 `__lakeSetNativeInsets(top,bottom,left,right)`（老包只传 2 个参数 ⇒ 缺省 0，保持兼容）。接入点：手机抽屉（`.side-panel` 左右）、平板树/大纲（`.pad-tree`/`.pad-outline`）、编辑 dock 工具条与面板内容、手写板悬浮条、画板 >720px 竖向轨、列表/正文/多维表页级 padding。**竖屏 inset=0 ⇒ 观感零变化**，手机 6 态快照 0 差异已证。
- **A2 死 CSS 清理**：删 `mobile.css` 里头部收口后 0 引用的 `.mbt-meta*`（5 条）与 `.mbt-toolbar`（1 条）；`mobileLayers` 手机壳基线 **1522 → 1486（−36）**、dupGroups 7 → 6（收紧，不是回涨）。
- **A4 pad 顶栏触摸目标（用户选方案 1）**：**删掉页签内小 ×**（26/28，位于 `overflow-x:auto` 的 30px 横滚条里 ⇒ 扩命中盒会被裁、抬高条高又改外壳几何），关闭动作改到**顶栏右侧一枚 `.toolbar__button`（44×44，关闭当前页签，无活动页签禁用）**。设备实测（lake_tab）：`.pad-tab__x` 计数 **0**、关闭钮 **44×44** 且可点、两页签点一次变一个；`pad.css` 声明 168 → **158**（−10，基线同步收紧）。「＋ 打开文档」仍在页签条内（30×30，唯一残留小目标，按需再处理）。
- **A5 文档漂移**：`PRODUCT.md` 的「同步并发 8」→ **12**、「10 万文档 / 100 万附件」→ **2 万 / 20 万（AGENTS §1 口径）**；`MOBILE-EMPTY-CATCH-LEDGER` 全量重扫（29 条漂移：28 条按注释文本重定位、1 条 `deviceProfile.ts` 已删故移除），复扫 **0 漂移**。
- **A6 useKeyboard 单实例**：改为进程内单例 store + `useSyncExternalStore`（一份 window/visualViewport 监听 + 一份状态，工作区 chrome / 编辑面 / 表格共享），对外 API 不变。
- **B1 只读态「视图状态」chip**：`mobileBitableViewState.ts` 纯函数出摘要（已筛选/已排序/已分组，筛选按规则数、嵌套分组累计）+ 落点页签；header model 增 `hasViewState → showViewStateChip`（只读 + 有状态才显示，编辑态一律不显示）；chip 在 row2 右侧、点开**只读**视图配置面板。
- **B2 视图页签重名自动编号**：「表格 / 表格 2 / 表格 3」（未知类型按视图名分组同样编号），**只改展示不改存储名**。
- **A3 设备门禁**：① 手机 6 态 `check:mobilesnap` —— 首轮仅 `home-doc` 指纹变（`pm clear` 重灌夹具的文档 id churn，元素数不变），按 §5.3 **重烤基线**（baseline 只变 1 行 hash）后 **0 差异**；② 23 屏走查：修掉装置里长期潜伏的 bug —— 菜单页的「关闭设置」与子页「返回」共用 `.mobile-settings-close`，旧写法在菜单页会误点关闭导致 8 个 settings 屏全部 `not found`，改为只认 `[aria-label=返回]`；③ 多维表 3 态 `check:bitablesnap`：装置里「内容」页签文案与「视图配置」按钮已随本轮改名/收口失效，改为「表格」+ 只读态走「视图状态」chip → 布局 → 卡片；按 §3#21③ **重烤基线**（元素数 2100→2106 / 2082→2072 / 2095→2084，属头部重构的预期变化）后 **0 差异**。
- **门禁**：tsc 0 / 全量 vitest **571 文件 3477 例（12 skipped）** / check:core 136 文件 0 / check:mobileui / 双 build / check:bundle / check:arch / `git diff --check` 0；clean APK **37,968,660 B**。
- **A3 剩余两项已补完**：④ 平板 6 态 `check:tabletsnap`（lake_tab，1280×800，CDP 9340）—— 元素数全一致（1822/1822/1827/2012/1912/1849），但**指纹 6/6 全变**：平板基线是 12:28（十三批）烤的，之后十四批回退了工具条/胶囊、261103 改了胶囊底距与大纲宽度，加上本轮 A1/A4 ⇒ 按 §3#21③ **重烤**（baseline `mobile-snap-tablet.json` 6 行 hash 变）后 **0 差异**。⑤ 走查装置修掉长期潜伏 bug（见上），23 屏全 ok。
- **A4 结论（不改外壳就别指望 44）**：`.pad-tabs` 是 `overflow-x:auto`，伪元素扩命中盒会被裁；页签条只有 30 高，抬高就改十四批外壳几何 ⇒ 本轮取几何上限 30×30 并把例外继续写进 MOBILE-DESIGN/PAD-ADAPTATION。要真 44 需另开「顶栏 44 → 52」需求。
### 261103 · 四批（视图页签单独一行 + 视图默认短名）· **已提交并双推（`733ab4aa`）**
- **两行 header**（同一 `<header class="mbt-header">`）：row1 = [☰ 数据表名] [spacer] [字段] [筛选] [＋]；row2 = [视图页签横滚] [视图列表]（仅 `header.showViews`）。只读 row1 只剩 ☰+表名；单视图不渲染 row2（header 48）；表单分支 row1 也只有 ☰+表名。设备实测（412×843）：`header=[16,60,380,90]` = 48 + 2 + 40（原三行 132 / 三批单行 48）。
- **五批（同日追加）**：视图列表入口**钉在第 2 行最右**（页签容器与按钮之间加 `.mbt-header__spacer`；页签再多也只在左边横滑）——设备实测 pad `row2=[16,110,1248,40]`、按钮贴右缘。
- **默认短名**：`mobileViewTabLabel` 的 grid「内容」→「表格」；`core/bitableDoc.defaultViewName` 改短名 表格/表单/看板/画册/日历（未知类型仍「视图」，默认表 seed 与 normalize 回退同步）；`BITABLE_VIEW_TYPE_LABEL`（表格视图/表单视图…）保留给新建菜单与回退提示。设备实建五种视图读正文：`表格/表单/看板/画册/日历` 全部符合。
- **门禁**：tsc 0 / 全量 vitest **569 文件 3468 例（12 skipped）** / check:mobileui / 双 build / `git diff --check` 0；clean APK **37,967,940 B**。mobileLayers 基线 mobileBitable.css 921 → 928。
- **已知**：旧文档已存视图名不变（只有新默认名变短）；两个 grid 视图并存时页签会显示两个「表格」（既有重名回落规则，未改）；桌面 BitableViewBar 显示存储名 ⇒ 新建视图同样短名（布局未动）。
### 261103 · 三批验收（画板轨图标错位 / 多维表头部 3 行→1 行 / 手写板 14 色）· **已提交并双推（`733ab4aa` / `75c46902`）**
- **① 画板竖向轨「左右错位」**：根因 = 每个工具项 `<label class="tool-icon">` 里的隐藏 radio `input`（15px）**仍参与 flex 布局** ⇒ 图标被挤右 15px、label 被撑到 51px、白卡 61px（实测按钮中心 48.5 / 图标中心 56）。修法（`src/mobile/board/board.css`，>720px）= 把该 input 改视觉隐藏（绝对定位 1px + 透明）、label 加 `position:relative` ⇒ 列宽 36、卡片 46、图标左右余量 **9/9**。设备实测 pad：`tb=[18,64,46,446]`、`svg=[32,158,18,18]`、leftGap=rightGap=9。
- **② 移动端多维表头部 3 行 → 1 行**：新增 `src/mobile/bitable/mobileBitableHeader.ts`（纯函数 model，**不依赖 records**）+ 6 例单测；头部 = [☰ 表名] [视图页签横滚] [视图列表] …… [字段] [筛选] [＋]，删「编辑中/只读」徽标、元信息行（记录数/视图名）、与筛选重复的「视图配置」按钮；记录数移到网格末尾统计行；图标改 LayoutList / TableProperties / ListFilter 三者互异；只读态只剩表名（单视图不渲染页签区），表单视图同走精简头部。设备实测（412×843）：before 3×44=132px → after 1×48px，点筛选后可见 .mb-sheet **恰好 1 个**，三图标 svg class 互不相同；`src/features/bitable/bitableEditorMount.test.ts` 的旧断言（`(viewTabs.length > 1 || editable)`）已改指向 header model。
- **③ 手写板色板 6 → 14 色（2 行 × 7）**：单一来源 `src/features/ink/inkPalette.ts` 的 `INK_STROKE_COLORS`（取值全部来 `core/colorPalette.ts`，不新造颜色字面量），桌面工具条与手机/平板悬浮色板共用；颜色是正文**值**（`InkStroke.color: string`）⇒ inkDoc 版本 / 点编码零改动；移动端色板容器改网格 `repeat(7, var(--mb-tap-min))`，命中盒仍 44×44。设备实测：14 个 `.ink-color`、行分布 7+7、逐色落笔颜色序列与面板一致、reload 后重开 14 色全部重绘。
- **重构尺度（回答用户「是否需要大规模重构」）**：**不做整体重写**，只做头部收口（header model + 单行渲染）。移动多维表是 表格/看板/画册/日历/表单 × 只读/编辑 的多分支，全量重写风险 > 收益；本轮收口已消掉「一个功能两个入口 / 三行占位 / 状态徽标」三个真实痛点。
- **门禁**：tsc 0 / 全量 vitest **569 文件 3468 例（12 skipped）** / check:core 136 文件 0 / check:mobileui / 双 build / check:bundle / check:arch（移动 340,756B / 360KB；桌面 541,235B / 600KB；import 0）/ `git diff --check` 0。clean 重建 APK **37,967,916 B**。
- **遗留（有意不动）**：`mobile.css` 里旧的 `.mbt-views/.mbt-meta*/.mbt-toolbar*` 已成死 CSS（跨作用域，另立清理；`.mbt-readonly` 仍被记录详情页使用，勿一起删）；手写板第 2 行淡色是给高亮/浅标注的（当画笔偏淡，有意）；桌面手写板工具条同步 14 个 20px 圆点（共享定义，桌面未实机复验）。
### 261103 · 二轮验收（胶囊编辑态常显 / 画板工具条改回桌面同款 + 依赖补丁）· **已提交并双推（`2b29d9e8` / `ae14ffd1`）**
- **用户二轮定稿两条（覆盖同日一轮的做法）**：
  1. **胶囊**：文档编辑态**常显**（抬到 dock 上方）—— 编辑态也可能没有光标、键盘与二级面板都没展开，此时要能切目录/看大纲/换标签/切笔记本。pad 实测：编辑态胶囊 `[496,624,288,56]` 可点，点「文档树」拉起 `.pad-tree.is-open`。**允许被覆盖**：键盘弹起 ⇒ `capsuleHidden` 隐藏（`--hidden`，visibility hidden/opacity 0）；dock 二级面板展开 ⇒ 层序盖住（胶囊 `--above-dock` **z=2** < dock 容器 **z=4**；实测面板 `[0,408,1280,336]` 打开后胶囊 `hit=false`、命中元素 = 面板控件）。表格/多维表/画板/手写板编辑态仍隐藏。
  2. **画板工具条 = 桌面同款（含 hand）**：新增依赖补丁 `patches/lakex-drawnix+0.1.0.patch` —— 删掉 `index.mjs` / `index.js` 两处 `isMobile && pointer === hand ⇒ null` 过滤（`git apply --check` 通过；还原原文→应用→sha256 与产物一致）。手机 = 顶部横轨可横滑（scrollWidth 519 > clientWidth 383，横滑后「导出」完整可见）；pad = 左侧竖排 `[18,64,61,446]` 全在视口内、含「手形工具 — H」；高度不够时 `board.css` 的 `max-height + overflow-y` 可纵滚（临时压矮后 scrollTop 0→104 自证）。选中 hand 后单指拖动 `.viewport-container` 782,339 → 902,419 且 DOM 不变（只平移、不绘制）。**一轮自制的「平移画布」开关整体删除**（`boardPan.ts`/测试、viewer 的 panMode/按钮/手势层、`board.css` 的 `.mobile-board-pan*`）——用户明确「不伦不类」。
- **门禁**：tsc 0 / 全量 vitest **568 文件全绿** / check:core 136 文件 0 / check:mobileui / 双 build / check:bundle / check:arch（移动 340,759B / 360KB；桌面 541,239B / 600KB；import 违规 0）/ `git diff --check` 0。
- **补丁登记**：AGENTS §2 补丁面 **3 处 → 4 处**（新增 lakex-drawnix，写明升级后复核口径：两处过滤 grep = 0 + 设备上工具条出现「手形工具 — H」）。
- **未跑**：`check:mobilesnap` 6 态 + 走查（本轮改动落在编辑态胶囊与画板工具条，6 态是阅读态；发版前全量再跑）。
### 261103 · 实机验收修复批（pad 横滑 / 胶囊固定底部 / 表格三连 / 画板工具条+平移开关）· **已提交并双推（`ce442482` / `ae14ffd1`；胶囊与平移开关两条已被二轮覆盖）**
- **用户 6 条验收问题（261103 实机）**：
  1. **pad 首页横滑恢复**：删掉 `pad.css` 里 `html[data-form-factor="expanded"] .mobile-tab-stage` 的 `overflow-x:hidden / touch-action:pan-y / scroll-snap-type:none` 特例（261103 曾以「整屏手势与顶栏页签冲突」为由禁掉，用户要求恢复）。设备实测：scrollLeft 0 ↔ 1280，tab 跟随（小记 ↔ 知识库）。
  2. **胶囊固定底部**：任何编辑器编辑态一律**隐藏**胶囊（`useWorkspaceChrome` 的 `capsuleHidden = chromeHiddenNow || !!active?.editing`；261103 同日的「编辑态抬到 dock 上方」整体撤回），删 `.mobile-bottom-bar--above-dock` 与 `.mobile-workspace--capsule-edit` 正文让位。pad 实测：读态胶囊 bottom 20；编辑态 `--hidden`（visibility hidden / opacity 0）；键盘弹起 innerH 744→408 时胶囊仍隐藏、不再随键盘上浮。
  3. **新建表格默认 35 行**：`core/usheetDoc.ts` 的 `USHEET_DEFAULT_ROWS` 50 → 35（`USHEET_FOOTER_CONFIG` 同源）。设备实测：新建表正文 rowCount=35，已有表仍 50。
  4. **移动端公式栏双光标**：根因 = 261025 误判「canvas 不画 caret」后叠的自绘 2px 闪烁条（内核 canvas 本来就会画）；整条删除（`useNativeSheetFormulaBar` 的读像素 effect、viewer 的 span、`usheet-chrome.css` 规则与关键帧 542→532）。设备像素扫描：修复前同帧两条（x=515-517 内核 / 520-524 自绘），修复后只剩内核一条。
  5. **整行/整列选中后视口跳走**：根因 = `MobileUsheetViewer.ensureActiveCellVisible` 把**整个选区**喂给 `sheet.command.scroll-to-cell`，内核按 range **末端**滚动 ⇒ 整列滚到第 49 行、整行滚到第 15 列；修法 = 整选时跳过自动滚动（`usheetChromeModel.sheetSelectionCoversWholeAxis` + 单测），普通单元格/区域行为不变。设备实测：C3 → 点列头 A，视口与地址保持。
  6. **画板**：① **>720px 移动壳视口竖向工具条被裁**（平板/折叠屏/横屏/分屏）：vendor `.draw-toolbar` 的桌面几何 `top:50% + translateY(-50%)` 被上游 `.drawnix--mobile` 的 `top:20px` 覆盖、**translateY 残留** ⇒ 新增 `src/mobile/board/board.css`（`@media (min-width:721px)`：去 translateY、`top:12px`、`max-height` + 内部滚动）；② **移动端没有 hand 工具**（vendor 按 UA 过滤）⇒ 补应用侧「平移画布」开关（`MobileBoardViewer` + `boardPan.ts` 纯函数 + 6 例单测；单指拖动滚 `.viewport-container`，事件挂 window 不 capture）。
- **文档**：AGENTS §4 改为「胶囊固定底部」；MOBILE-DESIGN / PAD-ADAPTATION 同步；LAKEX-CONTRACT 新增 **§5.44**（drawnix 720px 分叉 + UA 过滤 hand + 平移语义）；USHEET-UPGRADE / MOBILE-TECH-STACK / `bridge/notes.ts` 注释 50×16 → 35×16；MOBILE-EMPTY-CATCH-LEDGER 行号重扫（删除已失效条目）。
- **门禁**：tsc 0 / 全量 vitest **569 文件 3468 例（12 skipped）** / check:core 136 文件 0 / check:mobileui / 双 build / check:bundle / check:arch（移动首屏 340,722B / 预算 360KB；桌面 541,237B / 600KB；import 违规 0）/ `check:windowsweep` pass / `git diff --check` 0。clean 重建 APK **37,968,503 B**（增量构建会虚增到 42MB，量体积一律 clean）。
- **设备复核（261103 终版，屏上量值）**：pad(5554/1280×800) 首页横滑 scrollLeft 0↔1280✓；读态胶囊 `[496,668,288,56]`（bottom 20）、编辑态 `--hidden`（vis hidden/op 0）✓；画板编辑态竖向轨 `[300,64,61,406]` 全部在视口内（修复前 `[18,-131,…]`）✓、平移开关 `[294,688,44,44]` 可点、单指拖动 viewport scroll 787→907✓；phone(5556/412×842) 整行选中不再横跳（视口保持 A–C）✓、DOM 无 `.mb-usheet-caret`（双光标那条已删）✓。
- **未跑/残留**：`check:mobilesnap` 6 态 + 走查（本轮改动只影响**编辑态**胶囊与 pad 首页手势，6 态都是阅读态、DOM 未变；发版前全量再跑）；桌面 usheet ③ 未实机（静态推断内核 `_scrollToSelection` 用 selection.primary、不取 range 末端；如需实测另起桌面任务）。
- **风险/待裁决**：① 平移开关开启时透明手势层把工具条一起盖住（= 「期间不误绘制」的代价），若要平移时仍能点工具条需按工具栏 rect 动态留白；② ④ 依赖内核 canvas 自绘 caret，若某态原生编辑器不聚焦会表现为「没有光标」；③ 两台开发实例（5554/5556）已有验证数据（无标题表格 ×2 等），跑快照门禁前需 pm clear + 重灌夹具。
### 261103 · P12 桌面内核 lazy（5 边界 + idle 预取）· **已提交并双推（分支 feat/pad-touch-ui）**
- **落地**：`EditorTab` / `TrashPanel(embed)` / `NoteInfoDialog` / `HistoryPanel` / `QuickNoteEditor` 全部 React.lazy + Suspense；
  `kernelPrefetch`（就绪 3s idle 预取 kernel chunk）；`QuickNotesWorkspace` 保持常驻（ref.revealNote 时序），只 lazy 其内核子件。
- **护栏**：`desktopKernelLazy.test` + `kernelPrefetch.test`；check-arch desktop 首屏预算 2.5MB→**600KB**、check-bundle app-js 2.9MB→**300KB**。
- **实测**：desktop 首屏 **2,378,113 → 541,234B gz（−77.2%）**；dev 冒烟：启动→新建→点树行→编辑器挂载正常。
- **门禁**：tsc 0 / vitest 568 文件 3470 例 / core / mobileui / 双 build / bundle / arch / diff-check。
- **遗留**：冷 cache「启动即恢复文档」仍等 kernel chunk（P11 取舍）；Trash/History 关闭即卸载（内部状态重置，判可接受）；桌面设置面板/小记/历史的交互冒烟未覆盖（静态契约已覆盖接线）。
- **累计首屏（P9→P12）**：移动 392,977 → 340,783B gz（−13.3%）；桌面 2,785,488 → **541,234B gz（−80.6%）**；NotebookWorkspace 1212 → 510 行。
### 261103 · P11（诊断按需实测否决 / 工作区 510 行 / 大 chunk 取证 / 桌面内核 lazy A/B）· **已提交并双推（分支 feat/pad-touch-ui）**
- **① `s3v3Report` 按需**：实测首屏仅 −1,224B gz（340,783→339,559）⇒ **不做，已回退**（动态 import + 兜底的复杂度大于收益）。
- **② 剩余组装搬 hook**：新增 `useWorkspaceAssemble`(79) / `useWorkspaceSync`(61) / `useWorkspaceActions`(200)，openSidebar/openOutline 并入 chrome hook ⇒ NotebookWorkspace **660 → 510 行（−22.7%）**；旧 256 条逻辑行逐字命中 256/256，JSX 字节相同。
- **③ 大 chunk 取证**：`plantuml` 6.4MB raw 只被 `lakeRuntime`（懒 chunk）引用；28 条 preload 均为小 chunk ⇒ 首屏无大 chunk，不改。
- **④ 桌面内核 lazy A/B（只读+临时副本实测）**：只改 3 处首屏 −0.3%（内核挪进 preload 仍在首屏）；5 个边界全 lazy 首屏 2.07MB→0.22MB gz（−89.6%）；cold `spawn→#root` 1,360→865ms（−36%），但 cold 点开首篇文档 +538ms ⇒ **必须 5 边界 + idle 预取打包做**，本轮不做；证据 `/tmp/p11`。
- **门禁**：tsc 0 / vitest 566 文件 3463 例 / core 136/0 / mobileui / 双 build / bundle / arch（mobile 340.8KB/360KB、desktop 2.38MB/2.5MB、import 0）/ 手机+平板 6 态 0 差异 / windowsweep。
### 261103 · P10 收尾（工作区逻辑搬 hook / 设置抽屉按需 / import 规则扩展）· **已提交并双推（分支 feat/pad-touch-ui）**
- **P10-①（P9-5c）**：新增 `useTreeDrag`(168 行) / `useWorkspaceChrome`(159) / `useWorkspaceSession`(206)，**纯搬移不改行为**（旧逻辑行 478 条逐字命中 475，余 3 条等价改写）⇒ NotebookWorkspace **984 → 660 行（−32.9%）**；静态契约测试改读 hook。
- **P10-②**：`SettingsDrawer` 改 `lazy()`（打开设置才加载）⇒ mobile entry JS **79,032 → 53,496B gz（−25.5KB）**、首屏 **366,792 → 340,783B gz（−26KB）**；预算收紧 entry 80→60KB、首屏 390→**360KB**；设备冒烟设置/云同步子页正常。
- **P10-③**：`SIDEBAR_*_WIDTH` 下沉 `core/layoutConstants`（desktopTypes re-export、Sidebar 改核心）；check-arch 增加 `components-no-desktop` 规则并纳入扫描 ⇒ 违规 **0**。
- **P10-④ 结论（不改）**：28 条 preload 只有小 chunk，usheet/plantuml/lakeRuntime/Drawnix 都不在首屏图，仅按需加载。
- **累计**：移动首屏 392,977→340,783B gz（−13.3%）、entry −32.3%；桌面首屏 −407.4KB；NotebookWorkspace 1212→660 行。
- **门禁**：tsc 0 / vitest 566 文件 3463 例 / core 136/0 / mobileui / 双 build / bundle / arch / 手机+平板 6 态 0 差异 / windowsweep。
### 261103 · P9 收尾（首屏 / import 方向 / isolate 结论 / 工作区拆件）· **已提交并双推（分支 feat/pad-touch-ui）**
- **P9-1 bridge/sync 按需**：`src/mobile/bridge/sync.ts` 8 个 v3 重依赖（s3v3Remote/mobileDeviceStore/sync 编排/s3v3Engine/Transfer/AssetBackfill/protocol）改函数内 dynamic import（离线/未配置在 import 前返回）⇒ mobile 首屏 **392,977 → 366,792B gz（−26.2KB / −6.7%）**，bridge chunk 97,164 → 31,671B gz；首屏预算收紧 **420→390KB**。
- **P9-2 CodeMirror defer**：`index.html` 经典脚本加 defer ⇒ desktop 首屏 **2,785,488 → 2,378,113B gz（−407KB）**；`check-arch` 区分阻塞/defer 两套预算（desktop 首屏 2.5MB + defer 450KB）；dev Electron 冒烟通过。
- **P9-3 import 方向清零**：新增 `core/layoutConstants.ts`，`desktopTypes` re-export，`features/outline` 改依赖 core ⇒ check-arch 违规 **0 条**。
- **P9-4 isolate:false 二次结论**：projects 方案实测 **30.21→19.25~21.51s（−32~36%）**，但两轮红点不同（bridge/home.test、assetServer 模块期 env、bridgeStartup）⇒ **结构性依赖文件级隔离，保持 isolate:true**；重开前置（去全局化/显式注入）写进配置注释，不改断言。
- **P9-5 工作区拆件**：WorkspaceTopBar / WorkspaceOverlayHost / NotePaneHost / WorkspaceDrawers（+ P4 的 Capsule/Panels）⇒ NotebookWorkspace **1212→984 行**；`kernelStyleBootstrap` 判据改相对 import 闭包。
- **门禁**：tsc 0 / vitest **566 文件 3463 例** 30.21s / check:core 136/0 / check:mobileui / 双 build / check:bundle / check:arch / 手机+平板 6 态 0 差异 / windowsweep pass。
- **剩余（P10）**：P9-5c 逻辑搬 hook（≈−250 行）、bridge 里 `s3v3Report` 静态 12KB、`components→desktop` 规则扩展、plantuml/usheet 大 chunk 按需评估。
### 261103 · 架构 8 段落地（P1–P8）+ 清「平板模仿桌面工具栏」冗余 · **已提交并双推（分支 feat/pad-touch-ui）**
- **依据** [docs/ARCH-REVIEW-261103.md](docs/ARCH-REVIEW-261103.md) §8 实施记录（含每段验证与 P9 剩余）。用户裁决：8 段全做、彻底清冗余、自主推进。
- **pad 外壳**：P1 面板常驻 DOM（开合切 class，手势跟手/状态保持）；P2 每侧一个 PanelMode + Esc 单一 owner + 平板通用几何整体迁入 pad.css（`padCssOwnership.test` 钉「data-form-factor 只在 pad.css」）；P3 判据收敛单一 store（useSyncExternalStore）+ **删死代码**（isPadLayout / nativeDeviceHint / body.lake-tablet / `__lakeSetTablet` / Kotlin lakeDevice+isTabletLayout+pushDeviceProfile+onConfigurationChanged）；P4 shellModel 纯 reducer（+7 例）+ 拆出 WorkspaceCapsule / WorkspaceTreePanel / WorkspaceOutlinePanel。
- **ink**：P5 热路径（序列化移出落笔/翻页、id→path 缓存、pointercancel 回滚、页条虚拟化、Android webp 缩略图）；P6 **inkDoc v3**（点编码定点 −52%~−67%、activePageId 出正文进 localStorage `lakex-local-notes-v3.ink-nav.<noteId>`、sourcePdf 只留 name/pageCount、坏页可丢；**旧端读 v3 进只读保护**，同 v1→v2 先例）；P7 导入流式（onPage + 上传池 3 + raster/upload 两阶段进度 + 失败取消定向清理 + 暂存 PDF 与原生 cacheDir 清理）。
- **全局**：P8 `check-arch.mjs`（首屏资源图 gzip 预算 393KB/420KB、import 方向、契约导出；接 check:bundle）+ `.github/workflows/pr.yml`（tsc/vitest/双 build/core/ui-metrics/bundle/arch）+ SQLite 懒加载（**修 thenable 启动卡死**：Capacitor 插件代理自带抛异常的 then，必须 `{plugin}` 盒子 resolve）+ assets LRU 32MiB；vitest isolate:false 实测 −40% 但 deviceConformance 依赖模块隔离 ⇒ 回退留结论。
- **门禁**：tsc 0 / 全量 vitest **553 文件 3442 例** / check:core 0 / check:mobileui / 双 build / check:bundle / check:arch / 手机+平板 6 态 0 差异 / windowsweep pass / compileDebugKotlin 通过。
- **未做（P9，另开）**：bridge/sync 域按需加载（首屏大头，需实测）、桌面 CodeMirror defer（407KB gz）、features→desktop 冻结违规清零、deviceConformance 拆 worker 后重开 isolate:false、NotebookWorkspace 再拆 TopBar/OverlayHost/NotePaneHost。
### 261103 · 架构评审（pad 外壳 / ink·PDF / 全局）+ 两个回归修复 · **已提交并双推（分支 feat/pad-touch-ui）**
- **产出** [docs/ARCH-REVIEW-261103.md](docs/ARCH-REVIEW-261103.md)：3 路只读评审（pad / ink / 全局）+ 量化；TL;DR、按域问题清单、目标架构、8 段实施计划（P0–P8）、预算矩阵、明确不做清单、5 条待用户裁决。核心结论：**不整体重写**；先修 4 条主线（pad 判据/外壳状态机、ink 线性恶化、首屏预算量错对象、CI 零覆盖）。
- **修复 C1（评审发现的真回归，261103 引入）**：平板弹键盘（adjustResize 把 innerHeight 压到 <560）会把整个外壳打回 medium（页签/树/大纲被卸载）。修法 = `formFactor` 用 `effectiveWindowHeight(innerHeight, shellHeight())`（稳定外壳高），并在窗口**宽**变化时 `resetShellHeight()`。实测 lake_tab：744→460 仍 `expanded`；真换成 1600×460（宽也变）回落 `medium`。
- **修复 W2**：`NotebookWorkspace` 的 `escape` 改为「有动作 `return true` / 无动作 `return false`」——此前各分支 `return undefined` ⇒ hook 恒 `preventDefault`，上一层（MobileApp）永远收不到 Esc。
- **新增 L1 装置** `scripts/mobile-audit/window-sweep.mjs` + `npm run check:windowsweep`：7 个窗口（412×842 / 600×800 / 700×700 / 800×1280 / 1280×800 / 915×412 / 1280×500）断言形态档 + `body.lake-tablet` 同源，再验 800×1280→1280×800→915×412 的 tabs/活动页/滚动保持；实测全过。
- **文档**：`docs/ARCHITECTURE.md` 顶部加「Manifest V2 已过期，现为 S3 v3」横幅；`docs/MOBILE-OPS.md` / `scripts/mobile-audit/README.md` 登记窗口矩阵装置。
### 261103 · 胶囊与编辑态手势补丁（第十四批续，分支 `feat/pad-touch-ui`）· **已提交并双推；待用户点收**
> 用户点单：① 文档编辑时**保留悬浮胶囊**，且文档编辑时**大纲也要能滑出来**（其他类型禁用横滑）；② 悬浮胶囊**适当向下移一点**（手机/平板都要）。前一轮已定稿：多 Tab = 顶栏横向平铺条、树/大纲默认悬浮点 Pin 才固定、不做改名。
- **胶囊**：新增令牌 `--mobile-capsule-drop: 12px` —— 胶囊底距由 32 → **20px**（手机/平板共用，只改这一个数就能整体调高低）。文档（Lake）**编辑态不再隐藏**：加 `.mobile-bottom-bar--above-dock`（= dock 高 56 + gap 8）浮在底部 dock 上方；`.mobile-workspace--capsule-edit .mobile-doc-body` 把正文底距补到「dock + 胶囊」，最后一行不被压。表格/多维表/画板/手写板编辑态仍隐藏（各有自己的底部工具条）。
- **手势**：`usePanelDrag` 新增 `allowFrom`（起手点命中 EXCLUDE 时可豁免）—— Lake 文档正文是 contenteditable，编辑态也能从正文起手拉侧栏；`canOpen` 收窄为**只认文档类型**（表格/多维表/画板/手写板自身有横滑语义 ⇒ 横滑 no-op，胶囊入口照常可用）。手机与平板同一套判据。
- **设备实测**：pad 编辑态胶囊 top 624 / bottom 680（dock top 688，gap 8）、读态 bottom 20；编辑态右滑 → `.pad-tree`、左滑 → `.pad-outline`；phone 编辑态胶囊同样在 dock 上方，右滑 → `.side-panel--left.on`、左滑 → `.side-panel--right.on`；usheet 读态两个方向横滑都 no-op；退出编辑胶囊回到 bottom 20。
- **大纲加宽（同日追加）**：平板右大纲 **240 → 320**（新增令牌 `--pad-outline-width`，悬浮/停靠同宽）；1280 下停靠后正文 960、悬浮时大纲 x=960。左树仍 280。
- **固定面板不吃手势（同日用户报）**：`usePanelDrag` 的 `isOpen` 不再把**固定态**面板算作「已展开」、`commit(close)` 对固定态直接忽略 ⇒ 固定大纲后右划开目录，不会再把它滑没（实测：固定大纲 320 保持，左树 282 打开）。
- **宽度自适应（同日用户报）**：① 小记时间线与知识库共用**同一条** `--pad-content-width: min(92%,1200px)`（1280 实测都 1178、800 实测 736），不再各自写死 760/1080；② 侧栏宽度改**窗口比例**并钳制：`--pad-tree-width: clamp(240px,22vw,360px)`、`--pad-outline-width: clamp(240px,25vw,420px)`（1280 → 树 282 / 大纲 320；800 → 都是 240）。
- **「手机横屏算不算平板」（同日用户问）**：`expanded` 追加**高度门槛** `expandedMinHeight=560` —— 手机横屏（842×390 / 915×412）判 **medium**（单栏，保持手机逻辑，不出双侧栏/固定），平板竖横屏（800×1280 / 1280×800）才是 expanded。实测手机转横屏 ff=medium、转回 compact。
- **修「小记特别窄」（同日用户报）**：平板块给 `.mobile-scroll` 加了 `max-width:760; margin:auto`，而它是 `.mobile-tab-pane`（column flex）的 **flex item** —— 交叉轴 auto margin 让 stretch 失效 ⇒ 宽度退化成 fit-content（实测小记时间线 **146px**、卡片 114px）。修法：平板块显式 `.mobile-scroll { width: 100% }`，max-width 与 auto margin 正常居中（实测小记 scroll/cards **760**、卡片 728；知识库 `.mobile-library` **1080**）。手机不受影响（平板块选择器只匹配 medium/expanded）。
- **基线**：**手机 + 平板 6 态都重烤**（胶囊下移 12px 改了所有态的几何指纹）；手机 home-doc 1997、平板 home-doc **1897**（干净夹具，上一版 1912 是带着一篇测试表的脏实例），两边连跑两轮 **0 差异**（大纲不在 6 态里，加宽后再跑平板门禁仍 0 差异）。
- **文档**：AGENTS §4 增加「文档编辑态保留胶囊 + 横滑只对文档开放」契约；MOBILE-DESIGN 补胶囊显隐/底距令牌与 pad 手势判据。
### 261102 · 平板第十四批：工具条全部回移动端 + 胶囊回归 + 树/大纲可固定（分支 `feat/pad-touch-ui`）· **已双推；待用户点收**
> 用户口径原话：「即使使用 pad，桌面端那套逻辑并不适合触屏」「各种工具栏先恢复成使用移动端的样子」「树/大纲默认悬浮，加一个固定按钮，逻辑和桌面端一致，注意可编辑空间的收窄」「知识库也做宽一点」「胶囊/切换笔记本/多 Tab 就和移动端一模一样」。
- **工具条全部回退到手机**：① Lake 文档编辑态恢复 **`EditorDockHost`（底部 dock）**，不再开内核固定工具栏（`showToolbar` 回到 `!editing`）；② 多维表删掉平板 **9 项文字工具条**与行高入口（回到手机紧凑图标条；筛选/排序/分组改从「视图配置」页签进）；③ 手写板删掉**内联色板/笔宽**（回到 v3 悬浮面板；`InkPad` 的 `inlineTools` prop 整体删除）；④ 表格删掉**只读常驻 dock**（回到手机语义：只读不渲染 dock、编辑态 fixed + 96px spacer）。⇒ AGENTS 里「平板走内核工具栏 / 平板不挂胶囊」两条例外**已撤回**。
- **工作区胶囊回归**（文档树 / 标签页 / 大纲 / 切换笔记本，与手机同一套）；平板顶栏只留「返回 + 文档页签条（多 Tab 保留）+ 查找/编辑/同步」；胶囊编辑态照手机隐藏。
- **树/大纲：默认悬浮 + 可固定**：默认收起、`position:fixed` 覆盖层（左树 280 / 右大纲 320，z=`--mobile-z-drawer`45；大纲 261103 由 240 加宽，令牌 `--pad-outline-width`）；面板头新增**固定按钮**（Pin/PinOff）——固定 = `position:static` 停靠进布局、`.pad-main--docked` 改三栏、可编辑区随之收窄（实测正文 1280→1000）；再点回悬浮。收起路径 = 胶囊 / 点正文 / Esc（**只对悬浮态生效**，固定态不吃 Esc）；点开文档时自动收悬浮左栏。**固定状态持久化**（设备本地视图：`lakex-local-notes-mobile.pad-panels`，只存 pinned、不进正文/不进 S3；冷启按 pinned 直接停靠展开；大纲在没有活动文档时先按既有规则收起，切到文章时补开）。
- **知识库加宽**：`.mobile-library` / `.nb-shelf` / `.nb-list` 1080，书架列改 `repeat(auto-fill, minmax(96px, 1fr))`（实测 1280 下 **9 列**、书架 976 宽）；顶部页签同步 1080；小记时间线仍 760。
- **正文画布吃满**：内核把 `.lake-editor` / `.lake-editor-mount` 按内容撑成 ~85px ⇒ 下方一大块空白点不到。expanded 下这两层 `height:100%`（实测挂载高 **85 → 612**）。
- **键盘收起 = dock 的 ⌨**（手机同一条）：编辑态 dock 在、`.med-btn--kb` 点一下把焦点交回 `.ne-engine`；十三批那枚「收起键盘」浮钮与顶栏 onPointerDown **已删**。
- **顺手修**：十三批遗留的 `.mobile-scroll`/`.mobile-doc-body` 让位覆盖（胶囊/dock 回归后应恢复手机口径）、未使用的 `.pad-nb` / 内核工具栏 40×40 / `.pad-kb-dismiss` 全删；`--hairline` 未定义早已改 `--lake-border-1`。
- **门禁**：tsc 0 / 全量 vitest **548 文件 3408 例（12 skipped）** / `check:core` 135 文件 0 / `check:mobileui` + ui-metrics（!important 19/19、字号 48/49、颜色 0、跨文件重复 13/13）/ 桌面+移动 build / `check:bundle` / `git diff --check`。`mobileLayers` 基线收紧：pad.css **151→144**、usheet-chrome **545→542**、bitable **902→896**。
- **设备（lake_tab / emulator-5582，1280×800，重装本批 APK + 干净夹具）**：胶囊 4 项（文档树/标签页/大纲/切换笔记本）；顶栏只剩页签 + 查找/编辑/同步；开树 fixed 280 → 固定后 `position:static`、main `row`、正文 x=280 w=1000 → 取消固定回 fixed；点正文收、点树行开文档后收；大纲 320 同理（261103 加宽后：悬浮 x=960 / 停靠后正文 960）；固定态不响应 Esc（悬浮态响应）；编辑态 dock 56px 在、`med-btn--kb` 可点（焦点回到 `.ne-engine`）、内核工具栏 **0** 个、胶囊隐藏；知识库/书架 976 宽 9 列；画布 612 高。
- **手势入口统一（261103 用户报的两个问题）**：① 横向手势原来走手机抽屉 DOM（`.side-panel`），在平板上会先动画一个**空抽屉 + 遮罩**（用户看到「手势一出来目录栏就固定了」）；② 右滑打开的是手机右侧抽屉（有遮罩、无 Pin），与胶囊打开的大纲（悬浮 + Pin）**不是同一个东西**。修法：`usePanelDrag` 在 expanded 下 `getPanel/getMask/isOpen/commit` 全部指向**悬浮左/右栏**（与胶囊同组件），平板**不再渲染手机抽屉**（`{!padTwoPane && ...}`）；给悬浮面板补 250ms 入场动画（reduced-motion 已登记）。顺带修：点正文收起从 `onPointerDown` 改 `onClick` —— 手势也是从正文起手，pointerdown 会先收面板、同一手势再被判成「拉开另一侧」（实测：滑走左栏 → 右大纲自己弹出来）。
- **快照门禁**：**平板 6 态重烤**（home-doc **1913 → 1912**：胶囊回归 + 加宽 + 画布高度，手势修复后手机空抽屉不再渲染 −10 元素；其余元素数不变、6 态指纹全变），连跑两轮 **0 差异**；**手机 6 态 0 差异**（未重烤：胶囊/dock/抽屉对手机本来就是现状）。
- **未做 / 已知**：内容画布的「点空白即定位到文末」没有做（内核只认引擎内的点击；现在白板可点但点到引擎外不落光标 —— 与手机现状一致，要不要加 JS 落光标**待用户裁决**）；横屏左右安全区仍未接。
- **复核**：`docs/PAD-ADAPTATION.md` §10.16 记录本条，并把 §10.7（表格只读 dock）/§10.9（手写板内联）/§10.12（多维表 9 项条）标注为**已回退**；§10.9–§10.11 的「视图配置筛选/排序/分组可写」不受影响（手机也在用）。

### 261102 · 平板第十三批：悬浮目录/大纲 + 正文满宽 + 收起键盘 · **已双推（Gitee + GitHub，`027853cd`）**
- **为什么改**：第十二批的 280 左栏 + 240 右栏是**占布局**的（正文被挤成窄条）；用户口径「正文满宽」。本批把两者改成 **position:fixed 悬浮覆盖层**（不占布局、不挤压正文），正文吃满窗口，只靠阅读内距 32 留边。
- **改了什么**：① `pad.css`：`.pad-tree` 280 / `.pad-outline` 240 改 fixed（top = `--pad-float-top` = 顶栏 44 + margin 8 + 安全区溢出；圆角 + popover 阴影；**无遮罩**）；**层序改 `--mobile-z-drawer`(45)** —— 旧 `--lake-z-sidebar`(250)/`--lake-z-outline`(260) 是桌面数值，在移动端会盖住 Sheet(70)/菜单(81)/对话框(90)；`.lake-editor-mount`/`.ne-engine` 全网宽、`.mobile-doc-body` 加 `--mb-reader-pad:32`；`.mobile-library` 与 `.mobile-home-tabs` 1080（小记时间线仍 760）；平板首页不再预留胶囊 96px 底距；两处**未定义的 `--hairline`** 改 `--lake-border-1`（分隔线此前根本没画）。② `NotebookWorkspace`：**默认都收起**（覆盖层会盖正文）；**三路收起** = 顶栏按钮 / 点正文（`.mobile-workspace-body` 的 onPointerDown）/ **Esc**（`usePadShortcuts`，逐层：浮层 → 树 → 大纲）；点开文档自动收左栏；空态文案按平板改写。③ 平板无 dock ⇒ 键盘弹起时顶栏出「收起键盘」浮钮（`.pad-kb-dismiss`，44 触达），点顶栏任意处也会 blur 收 IME。
- **实测（lake_tab / emulator-5582，1280×800，重装本批 APK + 干净夹具）**：默认 tree/outline 均不渲染、`.mobile-workspace-main` column、`.lake-editor` padding 32；点顶栏「文档树」→ `.pad-tree` 280 / computed z-index **45**；点树行打开文档 → 树自动收起；再开树点正文 → 收起；再开树按 **Esc → 收起**（修前收不掉，根因见下）；大纲 240 同理；键盘模拟（视口压到 400）→ 浮钮出现（85×44，右下），点顶栏后 activeElement=BODY，恢复视口后浮钮消失。
- **🩹 本批修掉的真 bug（Esc 收不掉树）**：`MobileApp` 的 `usePadShortcuts` 无条件挂 `escape` handler ⇒ 它的监听注册得比工作区早、每次 Esc 都 `preventDefault`，而 hook 里有 `defaultPrevented` 守卫 ⇒ 工作区那条「Esc 收悬浮树/大纲」永远被吃掉。修法 = **Esc 逐层语义**：handler 返回 `false` 表示「本层没东西可关」⇒ 不 preventDefault，让后面的监听者继续；`MobileApp.escape` 改成真的关掉东西才返回 true。（浮层能收、树收不掉就是这个分叉。）
- **门禁**：tsc 0 / 全量 vitest **548 文件 3408 例（12 skipped）** / `check:core` 135 文件 0 / `check:mobileui` + ui-metrics（!important 19/19、字号字面量 48/49、颜色字面量 0、跨文件重复 13/13）/ 桌面+移动 build / `check:bundle`（mobile entry JS 77,971/81,920、CSS 137,547/141,312、preload 20/23）/ `git diff --check`。`mobileLayers.test.ts` 的 pad.css 基线 **152 → 151**。
- **快照门禁（两个实例都实跑）**：平板 6 态**重烤**后连跑两轮 **0 差异**（home-doc **2012 → 1913**：树不再常驻挂载、正文满宽；其余 1822/1822/1827/1912/1849 不变）；手机 6 态元素数全不变（1997/1822/1822/1827/1912/1849）——`pm clear` 重灌夹具后 home-doc **只有指纹变**（行 key 带文档 id，装置既有约定）⇒ 按 README 重烤 `mobile-snap.json`（只 hash 一行变），复跑 **0 差异**。
- **APK 体积（同线对比，隔离 worktree 实建）**：debug **+8,364 B（+0.022%）**，其中 pad **+6,392 B**、同批 ink/PDF +1,972 B；release +6,856 B（+0.020%）。dex / so 逐字节不变（pad 只动 web assets 压缩后体积）。**结论：pad 适配没有让安装包变大**（见 commit message 与本批报告）。
  ⚠️ **别用 `android/app/build` 里的增量产物量体积**：同一份代码在增量构建里实测是 **42.1MB**（zip 条目只有 37.67MB，4.2MB 是构建目录残留的条目对齐/padding），`rm -rf android/app/build` 后重建回到 **37.95MB**。量安装包一律 clean 后 `stat -f%z`。
- **仍缺（有意不做 / 已知）**：① 悬浮层不做遮罩（有默认收起 + 三路收起）；② 跨档 32px 滞后（PAD-ADAPTATION §3.2#5）未做（CSS-only 瞬时切换，实测无抖动）；③ ~~顶栏页签关闭 26×26 / ＋ 28 / 笔记本切换 32 低于 44 Rule~~ **已由 261103 六批 A4 处理**（页签内 × 删除、关闭动作改顶栏 44×44；「＋」仍 30，见最新条目）；④ ~~`useKeyboard` 仍被加在工作区~~ **261103 六批 A6 已改单例 store**；⑤ ~~横屏左右安全区仍未接~~ **261103 六批 A1 已接**（`--mobile-left/right-safe-area`）。

### 261102 · 平板（pad）适配第一批（分支 `feat/pad-adaptation`，worktree `../lakex-pad`，**已合入 master**）
- **范围**：只做「平板外壳 + 文档工具栏」，手机布局零改动。判据 = **窗口宽**（不是设备属性）：`src/mobile/pad/formFactor.ts` 三档 `<600 compact / 600–799 medium / ≥800 expanded`，写 `html[data-form-factor]`；原生 `smallestScreenWidthDp` 只作提示（`window.__lakeSetTablet` 保留，但布局不再依赖它；`native/deviceProfile.ts` 已删）。
- **双栏工作区**：`NotebookWorkspace` 在 expanded 渲染常驻左栏 `.pad-tree`（复用 `NotebookTreeList`，与抽屉共用同一份 `treeList`；平板下抽屉不再渲染第二份树，避免 `.side-panel-body` 双实例破坏拖拽查询）；胶囊「文档树」在平板 = 左栏开合。CSS 落 `src/mobile/pad/pad.css`（已登记 `mobileLayers.test.ts`：38 声明 / 0 重复组）；原 `body.lake-tablet` 7 条规则改为 `html[data-form-factor="medium|expanded"]`。
- **文档工具栏**：`DocumentEditor` 在 expanded 编辑态 `showToolbar:true`（内核固定工具栏 = 桌面同款 items，溢出进「…」）并**不挂 `EditorDockHost`**（手机不变）。几何：工具栏吃满文档列、`.ne-engine` 限宽 760 居中、`.mobile-doc-body` 底部不再留 dock 的 80px；内核工具栏命中 26→40（只抬图标按钮，下拉保留自身宽度）。AGENTS「移动端输入面=底部 dock」已加平板例外条款。
- **验收**：新建 AVD `lake_tab`（pixel_tablet / android-36 google_apis arm64，端口 5580 / CDP 9340），装本批 APK 实测：`data-form-factor=expanded`、左栏 280、`main` flex-row、内核工具栏 906×50、按钮 40×40、`med-toolbar` 不存在、编辑态可输入；截图 `.css-audit/pad-mockup/` 与 `/tmp/pad-editor3.png`（gitignored 目录）。
- **门禁**：tsc 0 / `vitest run src/mobile` 182 文件 836 例全绿（含新增 `pad/formFactor.test.ts`）/ `check:mobileui`（含 ui-metrics）/ `git diff --check`；**手机 6 态快照未跑**（lake_gate 未启动，改动按 data-form-factor 门控，预期零差异，下一批补跑）。
- **未做 / 下一步**：① 工作区顶栏仍手机样式（无桌面式文档页签；胶囊暂保留——标签页/大纲/切换笔记本仍靠它）；② 右大纲常驻栏未做（仍是抽屉）；③ 首页 expanded：内容已限宽 760，但横滑分页未禁；④ 表格 ribbon / 多维表横向工具条 / 手写板桌面工具条 = §8 的 T0–T2；⑤ 平板 MD 编辑器附件/图片插入走内核面板，需实测上传链路；⑥ 平板快照装置（`check-mobile-snap --viewport`）未加。
- **复现**：`cd ../lakex-pad && ANDROID_SERIAL=emulator-5580 bash scripts/android-build.sh --sync --install`；`bash scripts/emu-cdp.sh 9340`；`node scripts/cdp-eval.mjs 9340 @scripts/mobile-audit/gate-fixture.mjs`。
**第十二批（多窗口/断点实测 + 收尾）**：用 `adb shell wm size` 现场改窗口宽验证判据与外壳：600×800 → `medium`（左栏消失、主列 column）、800×800 → `expanded`（左栏回来）、恢复 1280 → expanded；说明分屏/自由窗口下布局会按**窗口宽**实时切换（`shellHeight` 的宽度重置是纯函数单测覆盖——平板上没有 dock，键盘态没有可观察 UI）。**手机 6 态 0 差异、平板 6 态（干净夹具重烤后）连跑两轮 0 差异**；tsc / 全量 vitest 548 文件 3408 例 / check:mobileui / diff-check 全绿。**本目标（Android 平板可点收）完成**：双栏外壳、桌面式顶栏页签、常驻大纲、内核工具栏、表格只读 dock、多维表 9 项工具条 + 排序/分组/筛选/行高、手写板内联色板、外接键盘快捷键、两套快照门禁。**遗留（不在本目标）**：**iPad/iPhone 没有端**（仓库无 ios/ 工程，`com.lakexlocalnotes.ios` 只是预留 id；先建 iOS 壳工程 = Capacitor iOS + BodyStore/AssetServer/SecureStore/SQLite 端口 + 签名，属独立立项，不是布局适配）、填色规则编辑器、导入 CSV 列映射、真机手写笔验收、纯高度拖拽盲区。下一批（若继续）：iOS 壳工程立项评审（先确认要不要做 iPad/iPhone 端，再谈布局）；Android 真机手写笔/多窗口人工验收；条件填色与 CSV 导入仍留桌面。


### 261102 · 用户点单五条（多维表新建视图 + 字段自动编辑 / 手写板分页纸张 / 设置输入行 / 小记标签 / 浮层留白）· **已双推**
- **① 多维表新建视图（移动端优先表单）**：core 新增 `addBitableView(doc, tableId, type)`（`src/core/bitableMutations.ts`：kanban 第一个 select / gallery 第一个附件 / calendar 第一个 date / form 不写 formFieldIds；导航不改），桌面 `BitableEditor.addView` 改调 core（同一笔写入把 activeViewId 指到新视图，行为逐字不变）。移动端 `MobileBitableViewListSheet` 编辑态给「新建视图」：**「新建表单视图」主按钮排第一** + 表格/看板/画册/日历 `.mb-chip`；只读态禁用并明写「只读状态不能新建视图，点右上角「编辑」后可新建」；入口 = 视图页签行条件 `(viewTabs.length > 1 || editable)`（只读单视图不变 ⇒ 快照不受影响，编辑态单视图也能进列表）；建完自动 `switchView`（设备本地导航）。
- **② 新增字段即进入编辑（两端）**：`addMobileField` 返回 `{doc, fieldId}`；移动端「字段面板 → 添加」后自动打开「修改字段」面板（字段面板保持打开、同铅笔路径层序）；桌面 `addField`（表头/面板类型网格）与 `insertField`（插入列）落字段后自动弹 `FieldEditorModal` 编辑它。**语义 = 先落字段再编辑，取消后字段保留**（有意）。
- **③ 移动端手写板分页/纸张**：根因 = ink footer 落在固定底部胶囊下方点不到 + 打开即阅读态（纸张/新建页本来就禁用）。修：阅读态允许翻页/页面管理/缩略图选页（纯视图、不写盘；capture 交父层最新正文而非挂载时旧原文）；`InkPageStrip` 增 `readOnly`（增删排序禁用 + title 说明，选页可用）；阅读态 footer 让位胶囊（`padding-bottom: calc(--mobile-status-height + --mobile-bar-gap + --mobile-bottom-bar-height + --lake-space-sm)`）、footer 接安全区、分页/纸张/缩放/页面条按钮 36/18 → `--mb-tap-min`(44)；纸张仍**仅编辑态**（正文数据，阅读态给可见说明）；顺手修 P1：ink 注册 `onEditorCapture` + `toggleEdit` 完成分支纳入 ink（「切完纸张立刻点完成」不再丢最后 500ms）。
- **④ 移动端设置输入行 = 标签在上、控件在下**：S3 六项（Endpoint/Region/Bucket/Object prefix/Access Key/Secret Key）+ AI 四项（接口地址/模型/API Key/温度）由同行改 `Field`（`.mb-set-item--field`，控件占满下一行）；`kit.css` 补 `.mb-set-item--field .mb-set-item__ctl > .mb-input/.mb-select--trigger { flex:1 1 auto; width:100%; min-width:0 }`（右缘一致契约）；历史数字/选择器/开关/分段**不动**（用户诉求是「一行放不下」的输入类）；PickerSheet 底距 8→`--mb-page-pad`；SearchSheet 双重底距（body 16+safe 与结果区 20+safe 叠加）删掉一份。
- **⑤ 小记标签强调 + 浮层留白巡检**：`.qn-tag` 白底 + 0.5px 边 → **浅灰绿实底 `--lake-quick-tag-bg`（浅 `#e8f2ec` / 深 `#263029`）、`border:0`、内距 `var(--lake-space-lg)`、文字 `--lake-text-1`、圆角 8**；筛选条左右 12→`--mb-page-pad`；选中态**有意保留 accent**（筛选选中必须一眼可辨）。浮层：小记打标弹框 body 改 `--form`（16 左右/20 底，行内距归 body）；菜单 Sheet `.mb-menusheet__items` 补安全区；标签页抽屉裸 `env()`→令牌；**侧栏（Outline）去掉 `.mb-sheet__body`+`.mb-list`**（floating/kit 后加载会把底部安全区 24 覆成 16/4）⇒ 底部 24+safe；其余面板审计后均符合契约（明细与截图在 `.css-audit/batch-261102/`，gitignored）。
- **补做（同日追加）·移动端视图改名/复制/删除**：core 新增 `renameBitableView` / `duplicateBitableView` / `deleteBitableView`（桌面 `BitableEditor` 的 deleteView/copyView/重命名改调 core，行为逐字不变）；移动端视图列表行改「wrapper + 选择按钮 + ⋯」（button 不嵌套），⋯ → `MobileBitableViewActions` 面板（重命名输入 / 复制视图 / 删除视图二次确认；只读三项置灰 + 理由；只剩一个视图时删除禁用）；打开操作面板时**先关视图列表**（避免两个 sheet 叠着，与数据表操作一致）。实机验收：改名「视图B」→「视图C」toast + 列表回读；复制 → 页签 3 枚且切到「视图C 副本」；删除副本 → 回到 2 视图（页签 内容/表单）；只读态三项 disabled +「只读状态不能修改视图（视图配置属于正文）」、删除确认写明视图名与「记录本身不受影响」。截图 `.css-audit/batch-261102/{21..26}-view-*.png`。
- **门禁**：tsc 0 / vitest **546 文件 3399 例（12 skipped）** / check:core 135 文件 0 / ui-metrics / check:mobileui / 桌面+移动 build / check:bundle（mobile entry JS **77,368**/81,920、CSS 136,838/141,312、preload 20/23；桌面 pdfjs 独立懒 chunk 1.61MB raw/499KB gzip，入口 chunk 内 unpdf/cMapUrl 命中 0；移动入口因静态 import 分享导入编排上涨到 76.8KB，仍低于 81,920 预算但余量变小）/ check:android-release 12 项 / `git diff --check`。
- **设备验收（emulator-5554 / lake_mobile，重装本批 APK）**：多维表编辑态单视图 → 视图列表 → 新建表单视图（tabs 内容/表单、默认字段可直接填、提交 1 条真落盘）；「添加字段」→ 自动弹「修改字段」；手写板阅读态 footer bottom **748 < 胶囊 top 754**、分页/纸张按钮 **44×44**、阅读态翻页/页面条可用且增删禁用、编辑态新建页 + 网格纸张 → `readNote` 回读 2 页且 `background:"grid"`（保存竞态修复生效）；S3/AI 每行 `labelAbove=true` 且 6/4 个输入框右缘全部一致（367）；小记卡标签计算值 `bg rgb(232,242,236)/border 0 none/padding 12/radius 8`，打标弹框 body 左右 16/底 20、行左缘 16。桌面（dev app / CDP 9222）：新增字段 → 自动弹「编辑字段」（标题 = 新字段名）、新建视图 tabs 2→3 正常（core 下沉后行为不变）。
- **设备门禁（lake_gate / emulator-5556，重装 + `pm clear` + 固定夹具）**：6 态与多维表 3 态**均重烤基线**（`home-doc` 指纹随新文档 id 变化；多维表 3 态因侧栏 `.side-panel-body` 底部安全区 16→24 而变，元素数 2100/2082/2095 不变）→ 连跑两轮 **0 差异**（`baseline/mobile-snap.json` 仅 home-doc hash、`baseline/bitable-snap.json` 3 态 hash 更新）。
- **手写板布局 v1（261102 追加，用户点单「翻页/缩放/全局预览放顶部、工具放底部」）**：移动端改为「顶部固定条（阅读/编辑同一条）：翻页 ‹ 第 n/N 页 › ｜ 缩放 − % +（点 % 复位）｜ 全局预览（现有 InkPageStrip 页面总览）」+「底部工具坞**仅编辑态**：笔/高亮/橡皮/颜色/笔宽/撤销重做（横滑）+ 纸张行（空白/横线/网格/点阵，接安全区）」；阅读态**删除**底部三行（页码/纸张/缩放）与旧只读说明行，底部只剩工作区胶囊，pad 让位 = 状态栏+间隔+安全区+胶囊+8（实测 96+safe）；编辑态工作区胶囊 `--hidden`、工具坞贴底（高 105，与胶囊不重叠）。桌面 InkPad 结构逐字不变（variant 分支 + 静态守卫）。设备实测：阅读态顶部翻页/缩放（100%→125%，画框 396→495）/全局预览可用，footer=0、hint=0、pad padding 96；编辑态顶部仍在、footer=1、工作区胶囊 hidden、点「网格」生效；完成回阅读态。截图 `.css-audit/batch-261102/{30,32,33}-ink-*.png`。**待用户看一版**：工具行 412 宽一屏约 5~6 项需横滑（颜色 44 圆点偏大、撤销/重做/笔宽在右侧需滑）；全局预览是**插在顶部条下方占布局**（非浮层）；360 宽顶部条可能需轻微横滑；阅读态让位 96px 是否偏多待真机确认。
- **手写板布局 v2（同日追加，用户点单：悬浮形式 + 只读最大化 + 编辑态固定悬浮工具栏 + 工具缩小）**：移动端把 v1 的顶部导航条与底部工具坞都改为**绝对定位悬浮 overlay（不占布局）**：顶部 pill（翻页｜缩放｜全局预览，阅读/编辑同一条）top 8、圆角 pill、实底 + 0.5 边 + popover 阴影；底部编辑态悬浮卡（bottom 8+safe、圆角 12）两行缩小为工具行 48 / 纸张行 40，工具图标 18、**颜色 44 盒 + 视觉内圆 28**（active 2px 环）、纸张视觉 36 + `::after` 上下补 4 保持 44 命中；阅读态无 dock、无说明行，底部只剩胶囊（让位仍为胶囊 tokens 表达式，画布比 v1 多出导航高度）。全局预览仍是流内 InkPageStrip（打开时下移一个导航高度避让）。桌面 InkPad 零变化。设备实测：阅读态 nav absolute 45 高、footer=0、nav 不压纸（navOverlapsPage=false）、stage 694、胶囊可见；编辑态 dock absolute 89 高（工具行 48 / 纸张行 40）、颜色 44/28、纸张 44×36 + `::after`、工作区胶囊 hidden、点「点阵」生效；截图 `.css-audit/batch-261102/{40,41,42}-ink-v2-*.png`。**待用户看**：放大 >100% 时悬浮条会盖住纸面（预期）；全局预览仍是流内面板；颜色内圆 28 是否合适、工具行是否还要收（当前横滑）。
- **手写板布局 v3（同日追加，用户点单：颜色/笔宽收成菜单 + 全局预览改悬浮）**：编辑态工具行收成一屏 **7 个 44 按钮**（笔/高亮/橡皮 + 当前色 + 当前笔宽 + 撤销/重做，合计 327px ⇒ 412/360 都不横滑）；颜色收成「当前色圆点（44 盒 + 28 内圆）→ 点开悬浮色板（6 色，坞上方 8 的卡面，选值/再点/点外部即关）」，笔宽收成「当前笔宽按钮（视觉点封顶 20）→ 4 档悬浮小面板」；**全局预览改悬浮覆盖**（`data-overlay=preview`：absolute、导航下方 8、max-height 45dvh 内部滚动、z-index 1，不推画布；桌面仍流内；**点面板外部（画布）即关闭**，点面板内部不关）。色板/笔宽面板补极窄屏兜底横滑（<340 一排放不下时 `overflow-x:auto`）。设备实测：工具行 7 键 `scrollWidth==clientWidth`，色板 6 色选色写回（当前色变）、笔宽 4 档选 6（点 12px）、预览开关时 stage 高度 790 不变且浮层在导航下方；截图 `.css-audit/batch-261102/{50,51,52}-ink-v3-*.png`。
- **修复：重启后恢复的活动标签不是退出时那个（261102 用户报）**：根因 = 移动端标签会话只持久化 tab id 列表、**没持久化 activeId**，恢复时用「列表最后一个」当活动页（切换标签不会把标签挪到末尾）。修：新增 companion key `lakex-local-notes-mobile.tabs.<nb>.active`（挂在 tabs 前缀下，退出清空按前缀整棵删天然覆盖；旧格式无 active ⇒ 回落最后一个，首帧补写）；`useNotebookTabs` 初始 active 优先存档值（须在 ids 内），持久化同时写 ids+active；`NotebookWorkspace` 恢复改 `restore(saved, savedTabActiveId)`。设备复现验证：开两 tab（多维表 + 手写板）→ 停在第一个（多维表）→ force-stop 重启 → 进同一笔记本恢复到**多维表**（旧行为会回到列表最后的那个），active key 全程正确。单测：tabRestore +4 例（active 非末尾/旧格式/非法自愈/切换落盘）、cleanup 两 key 一起清。
- **手写板「100% 上下空白不均」修复（同日追加）**：根因 = 纸面按整屏居中，而悬浮导航/工具坞正好压在上下留白里（编辑态上方空约 60、下方约 20）。修：`.ink-page-stage` 上下补出与悬浮条等高的内距（新增 `--ink-mobile-nav-h` 45 / `--ink-mobile-dock-h` 89，**只读态只补顶部**），纸面改在「导航—工具坞」可视区居中。设备实测：只读态 nav 底 105 → 纸面顶 146（41）→ 纸面底 706 → 胶囊顶 754（48）；编辑态 38 / 43（此前约 60 / 20）。截图 `.css-audit/batch-261102/{70,71}-ink-centered-*.png`。
- **T1 落地：手写板 v2 = 图片页背景 + 手写批注（261102）**：`src/core/inkDoc.ts` 升 v2（读 1|2、写 2；每页可选 `backgroundImage`：本笔记空间 canonical URL、fit contain|cover|stretch、opacity、pixelWidth/Height、source image|pdf-page、pdf{url,page,pageCount}；整篇可选 `sourcePdf`；坏 URL/小记空间/data URL/越界一律整篇 null）；渲染在 InkPaper 前加 SVG `<image>`（pointer-events:none），图片页不画底纹，缩略图走 `?w=256`；新增 `features/ink/inkImageImport.ts`（选图→像素/体积校验→上传→成 A4 页，纯逻辑 + 两端注入 upload）；入口 = 移动端编辑态「全局预览」面板「导入图片」、桌面编辑态工具条「导入图片」。设备实测（emulator-5554，重装 APK）：v1 手写板打开后版本仍 1（不写盘）→ 上传 640×480 图 + 写 v2 正文 → 重开渲染 `<image href=…>` 且 `pointer-events:none`、缩略图 URL 带 `?w=256`、编辑态有「导入图片」入口、`readNote` 回读 version 2 + backgroundImage + 1 条笔迹。截图 `.css-audit/batch-261102/{80,81,82,83}-ink-*.png`。单测：inkDoc v2 10 例、导入 7+8 例、openReadOnly 6、wiring 23 等（定向 32 文件 210 例）。
- **T2-A 平台 spike 结论（261102）**：桌面 unpdf 自带 pdf.js 在 Electron 渲染层栅格化**可行、零新依赖**（扫描版/嵌入中文/非嵌入中文带 ToUnicode 全对；A4@2x render 10~15ms、WebP 22~27KB ≈ PNG 的 1/11.7）；**唯一已证缺口** = 「预定义 CMap + 非嵌入字体」PDF 整页空白 + cMap 告警（unpdf 无 cmaps/standard_fonts 资源）⇒ 先接受子集给缺字提示，有真实样本再补 ~1.6MB cmaps 数据文件（不新增 npm 依赖）。Android 新增 `PdfRenderPlugin.kt`（系统 PdfRenderer、逐页串行/RGB_565/WebP/进度/取消/路径校验）+ `MainActivity` 注册 + `src/mobile/native/pdfRender.ts` 薄封装，`compileDebugKotlin` 10s 通过、零打包体积；A4@2x WebP 22~27KB、300 页输出约 6.6~8.1MB、估算串行 10~30s（真机待测）。分享入口现状：application/pdf 会被存成 .bin 且 JS 当图片塞小记 seed（静默失败）⇒ T2 UI 前必须补 `.pdf` 映射 + 独立路由 + 可见提示。spike 报告 `.css-audit/spike-pdf/REPORT.md`（gitignored），脚本挪 `.css-audit/spike-pdf-scripts/`。
- **T2 落地：PDF 导入 → 图片页 + 手写批注（261102，用户选 B 方案补 cmaps）**：① 数据/编排：新增 `src/features/ink/pdfImport.ts`（PDF bytes → 先落原文件（正文 `sourcePdf` 引用防孤儿清理）→ 逐页栅格化 → 每页资产上传 → `InkPage[]`，含 300 页截断、空白首页替换、取消、逐页容错/可读错误）+ `pdfRasterDesktop.ts`（`await import("unpdf")` 懒加载、`getDocumentProxy` 带 `cMapUrl=public/vendor/pdfjs/cmaps`、`renderPageAsImage` → canvas WebP 0.8、页逻辑尺寸 pt×4/3）。② cmaps：`public/vendor/pdfjs/cmaps`（pdfjs-dist 6.4.299，Apache-2.0，1.6MB，NOTICE 已记；移动端构建 `vite.mobile.config.ts` 剔除）。③ Android：`PdfRenderPlugin.kt` + `PDF 分享映射`（见下条）；修两处真机 bug：RGB_565 无法 WebP 压缩（改 ARGB_8888）、页图只缩不放 + 逻辑/像素尺寸混用（改始终缩放到 maxWidth、输出 `width/height`=pt×96/72 逻辑 + `pixelWidth/Height`=位图）。④ UI：桌面工具条直接两个入口（导入图片 / 导入 PDF）；**移动端收进编辑态底部悬浮工具坞的「插入」按钮**（撤销/重做右侧，点开坞上方悬浮菜单：导入图片 / 导入 PDF；全局预览面板不再放导入行）——用户反馈原入口藏在预览面板里找不到。进度「第 n/N 页 + 取消」，加密/损坏/超 100MiB 可见错误。设备验收：桌面（dev/CDP 9222）导入 10 页 PDF → `version 2 / pages 21（重复导入累加）/ sourcePdf true / 首屏 pdf-page 793.3×1122.7`、页图渲染正确；移动端（emulator-5554，重装 APK）导入同一 PDF → `pages 10 / sourcePdf true / 首屏 793×1123 / pixelWidth 1600×2264 / source pdf-page / 无错误`（重置空白文档后首页替换生效）。截图 `.css-audit/batch-261102/{92,93,94,95}-*pdf*`。
- **T2-C 分享入口（261102）**：Android `extensionFor` 支持 `application/pdf → .pdf`（mime 不可信时按 DISPLAY_NAME 兜底）、分享输出显式 `kind: image|pdf|file`、PDF 单独 32MiB 档、Manifest 增加 `application/pdf` SEND filter；JS `sharedContentKind/sharedContentUnsupportedHint` 保证 pdf/file **不再静默当图片进小记**。**分享→自动导入已接（18b）**：`readSharedContentBytes` 读 shared-inbox（**读成功才删、失败保留可重试**）→ `importSharedPdfAsInkNote`（标题派生 → 默认笔记本 → `createInk` → 共享的 `mobilePdfImport` 适配器 → `saveNote`；失败/取消 `trashNote` 回滚空文档）→ MobileApp 冷/热分享统一 `handleSharedContent`（busy 互斥）→ `setRoute` 打开新文档（阅读态，用户再点编辑批注）；成功不再弹旧提示，file 仍「暂不支持该分享类型」，image 行为不变。设备侧 ACTION_SEND 真链路未自动化（adb 无法给 shell 授予 MediaStore/Documents URI 读权限，插件报 SecurityException，属测试装置限制）；已用注入 deps 的单测覆盖编排/回滚，`shared-inbox` 读取/删除路径有单测。
- **手写板工具坞可发现性（261102 收尾）**：移动端编辑态工具行改为 **插入(＋) ｜ 笔 ｜ 高亮 ｜ 橡皮 ｜ 当前色 ｜ 当前笔宽 ｜ 撤销 ｜ 重做**（＋从行尾移到第一位，gap 4→0、分隔 margin 2→0；8×44+4+4=360 ≤ 412 可用 395 ⇒ 412 不横滑）；「插入」打开坞上方悬浮菜单「导入图片 / 导入 PDF」（原藏在全局预览面板的入口已删）；桌面工具条直接入口不变。设备实测：首按钮=插入、8 按钮、`scrollWidth==clientWidth`。截图 `.css-audit/batch-261102/{96,97,98}-*`。
- **手写板导出 PDF（压平，261102 续，桌面）**：`electron/noteExport.ts` 新增 `exportInkPdfHtml`（`exportPdfHtml` 按 kind 分流：ink 逐页压平、doc 原路径），每页 A4（210×297mm、`page-break-after`）叠背景图 data URI（object-fit 按 fit、缺图 skipped++）+ 矢量笔迹 SVG（viewBox=页面逻辑尺寸、xMidYMid meet；pen 实心 path、highlighter `opacity .3 + mix-blend-mode:multiply`；主进程复用 `features/ink/inkGeometry` 的 `strokeToSvgPath`，perfect-freehand 在 dependencies）；无背景图页白底、不画纸张底纹；markdown/html/docx 对 ink 仍报错（文案改为「仅文档可导出 Markdown/HTML/资料包；手写板仅支持导出 PDF」），UI `ExportSubmenuItem` 对 ink 只给「导出为 PDF（手写压平）」。单测 `electron/noteExport.inkPdf.test.ts` 10 例。**实机验证（dev/CDP 9222）**：对 29 页（27 张背景图页）的「PDF导入验收」调用 `exportNote(id,"pdf")` → `~/Desktop/lakex-local-notes-导出/PDF导入验收.pdf`（1.96MB、**29 页 == 文档页数**、首屏背景图与文字正确、无多页/裁切）。**限制**：混合页尺寸统一 contain letterbox；大文档 base64 全内嵌可能触 printToPDF 60s/内存（未压测）；高亮 multiply 合成与提示文案待点收。
- **打包版 cMap 验证（261102）**：`electron-builder --dir` 出 `release/mac-arm64/LakexLocalNotes.app`，以临时 `LAKE_USER_DATA` + CDP 9223 启动；`fetch(lakexlocalnotes://app/vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap)` → **200 / 43,366B**；导入「预定义 CMap + 非嵌入中文」PDF（无 cmaps 时空白）→ 页图正确显示中文（打包私有协议实测通过；首次探针因 dev 与打包同占 :19876 误判为 404，停 dev 后复测正常）。
- **分享 PDF 优化（261102 续）**：① 分享处理从「忙时直接丢弃」改为 **串行队列**（`src/mobile/ink/shareQueue.ts` 纯类；等待位默认 5，满则 toast「分享处理队列已满，丢弃本次分享」；异常后继续下一个）；冷启动 consume / 热启动 shared 统一入队。② `SharedPdfImportResult` 补齐 `pageCount`（真实页数）/`importedPageCount`/`truncated`/`errors`，`sharedPdfImportToast` 一句话报「已导入 N 页 / PDF 共 M 页仅导入前 N 页（上限 300 页）/ N 页成功 K 页失败（第一页原因…）」；失败取消回滚与读取失败提示不变。测试：shareQueue 5 例 + mobilePdfImport 15 例（含 5 toast）+ 静态路由断言。
- **手写板导出 PDF 300 页压测（261102 续）**：dev app + CDP 真实 `exportNote(id,'pdf')`：300 页无图 313ms/0.49MB、300 页 5 张循环图 603ms/1.45MB、300 页 20 张噪声图 1.23s/5.10MB、**300 页 100 张不同噪声图 4.7–4.8s/24.47MB**；最重例主进程 RSS 峰值 209MB、结束后回落，无 error/crash，60s 超时余量约 12 倍 ⇒ **未改代码、无需超时参数化**。视觉抽查（sips 转 PNG）：背景图/笔迹/高亮 multiply/页脚 `1 / 100` 正确；证据 `.css-audit/task22-ink-pdf-stress/`（gitignored）。**若未来允许 300 页全为 4K 照片级原图，再考虑超时参数化/降采样/进度。**
- **待办（本批未做）**：PdfRender cacheDir 中间产物未主动清理（系统可回收）；导入上传阶段进度仍显示 n/N（栅格化完成后上传 300 页串行，观感可能像卡住）；只读单视图无视图入口（有意，避免改快照）；移动端视图**拖拽排序**未做（桌面有）；新建 form 会命中「第一个 form 优先」默认落地（既有规则）；页面级 6 处裸 `env(safe-area-inset-bottom)` 未统一（另立）；桌面新增字段取消后字段保留（有意）。

> **261030 移动端多维表批次（已本地提交 + 设备验收，见下条收尾）**：按钉钉实机复刻移动端多维表 —— 视图页签（表单/内容）+ **默认落表单填写**（只读文档里唯一写路径，提交=新增记录，走 `onPersistNow` 立即 `bridge.saveNote`）+ 内容视图**表格/卡片两套布局**（卡片 1/2 列、封面、主副标题、展示字段；**只做 1/2 列**）+ 分组 + 只读详情整页（1/N）+ 视图配置面板（布局可改、筛选排序只读）+ 视图列表。展示类配置**全部设备本地**（`lakex-local-notes-mobile.bitable-layout.<noteId>`，不写正文不同步，用户 261030 定）。实机实测与方案见 `docs/MOBILE-BITABLE-DINGTALK.md`（含 11 张钉钉截图 + 5 张样机图：`docs/mockups/mobile-bitable.html`）。门禁：tsc 0 / vitest **518 文件 3196 例** / check:core 135 文件 0 / check:mobileui / 桌面与移动 build / check:bundle（entry JS **73,621**/81,920、CSS 136,741/141,312、preload **21**/23 —— 本轮上收 core 后入口图净减 2 条）/ diff-check。**设备级验收已做（emulator-5562/lake_gate，重装本轮 APK）**：lakeNative 造「观点收集」夹具（grid+form 双视图/7 记录）→ 默认落表单、提交 7→8 且 readNote 回读 8 条（真落盘）、表格/卡片/视图配置/详情/编辑态全通过、布局偏好重启保留；修掉「提交按钮与列表末尾被底部胶囊压住」、空分组标签改「未填写」。**261030 二轮**：① 详情页改单 header（viewer `onFullscreenChange` → 工作区 `subpageFullscreen` 复用 `chromeHiddenNow` 隐藏顶栏/胶囊，切文档/进出编辑复位）+ 返回键先关详情（`pushBackHandler`，此前会直接退工作区）；② 分组头日期在移动端格式化成「6月9日」（`mobileBitableFormat.ts`，不动 core）；③ **表单语义上收 core**（`src/core/bitableForm.ts`：可填字段/题目顺序/必填/提交值，桌面 `BitableFormView` 与移动端共用，修掉两端旧分叉），守卫同步改指 core；④ **P1 表单附件/图片可上传**（系统选择器 → `bridge.uploadResource`，映射与桌面一致，`mobileBitableAttachments.ts` 纯映射 + 单测）；⑤ **记录面板附件也可编辑**（上传控件抽成 `MobileBitableAttachmentEditor`，表单 + 记录面板共用；`MOBILE_EDITABLE_FIELD_TYPES` 增补 attachment/image）；⑬ **字段显示格式 + 类型互转 + 自动保存修复（261030）**：① 显示格式（日期 4 档 / 数字 5 档，core 格式化，两端设置项）；② 类型互转仅限**无数据**字段（core `convertBitableFieldType`/`fieldHasData`，有数据禁用并说明）；③ **修掉移动端自动保存从未生效的严重 bug**（`useAutoSave` 防抖回调先删 pending 再 drain ⇒ 永远不写；已修 + 3 例回归测试，影响所有可编辑文档，设备复验改格式 ~1s 落盘）。⑫ **修改字段（移动端，用户点单）**：字段面板铅笔 → 修改字段面板（标题/类型展示/默认值/必填/选项），按类型动态出设置（日期三态含「添加记录当天」、单选选项增删改名、进度颜色…）；类型修改/关联/AI/附件属性仍只在桌面。core 新增 `updateBitableField` + 单测；「字段」入口在所有内容视图编辑态可见。设备复验默认值/选项/必填均可回读（真落盘）。⑪ **数据表操作（重命名/复制/删除，两端）**：core `renameBitableTable`/`deleteBitableTable`/`duplicateBitableTable`（复制换全量 id + 视图字段引用 + 关联清值去配对）+ 单测；移动端抽屉行 ⋮ → 操作面板（只读置灰、删除二次确认）；桌面左侧列表 ⋮ 改成三项菜单（替换原「⋮=重命名 + 独立垃圾桶」）。桌面未做实机截图验收。⑩ **多数据表切换（用户反馈）**：常驻 ☰ 入口 + 左侧「数据表」抽屉（搜索 / 列表 / 当前项高亮 / 新建数据表；只读置灰、编辑态可用），替换原来「>1 表才出现」的顶部横向页签；演示文档改为双表（观点收集 / 资料收集）。⑨ **反馈批**：表单去冗余（封面/重复标题/说明，用户点单）+ 收键盘单一来源 `ui/dismissKeyboard.ts`（点空白/提交/选日期时 blur）+ 自有日期选择 `MobileBitableDateField`（MobileSheet + core 月历，表单与记录面板共用，替换系统 date 弹窗）；单测 + 设备复验。⑧ **P2 三套视图 + 表单编辑态**：移动端 看板（core kanbanColumns）/ 画册（galleryCoverImage）/ 日历（calendarMonthDays）渲染 + 表单编辑态（仅文档编辑态，改视图配置；按钮「返回填写」）；
⑦ **提交后状态可见**（`submitStateText(cloudState)`，读 `bridge.getCloudState()`；不写「已同步」），提交条上移不再被胶囊压住；⑥ **多维表专项设备门禁** `npm run check:bitablesnap`（表单/内容·表格/内容·卡片 3 态，夹具自建自删、不污染 6 态与走查；取快照/比对逻辑抽 `snap-gate.mjs`、导航工具抽 `snap-lib.mjs` 与 6 态共用；连跑两轮 0 差异）。验收用的「观点收集」夹具**已从 lake_gate 删除**（它会插到最近文档、打乱 home-doc 态），删除后 6 态快照 0 差异（`check-mobile-snap --port 9336`）。**待办**：① 门禁装置把 bitable 并进 6 态快照与 23 屏走查（当前是独立 `check:bitablesnap` 装置）；② 卡片内联编辑、筛选/排序编辑（只读）、甘特视图留 P1/P2（看板/画册/日历与表单编辑态已随 ⑧ 落地）；③ 桌面端本批未做实机截图验收（42 态快照本机无夹具缓存）。

> **261030 收尾（新会话接手完成，本批已双推 Gitee + GitHub）**：上一会话在最后一道门禁处中断。① **修掉唯一失败用例**：`src/core/bitableFormatGrouping.test.ts` 的「筛选按原始日期等于」误用了日期字段不支持的操作符 `is`（`filterOperatorsFor(date)` 只有 equalTo/lessThan/greaterThan/isEmpty/isNotEmpty；未知操作符按「未配置不拦截」放行 ⇒ 两条记录都命中）→ 改 `equalTo`，断言与语义不变；② 注释整理（`duplicateBitableField` 的文档注释被夹在「数据表级」分段注释前，挪回函数上方）；③ **门禁全绿**：tsc 0 / vitest **531 文件 3247 例**（12 skipped）/ check:core **135 文件 0** / ui-metrics / check:mobileui / 桌面+移动 build / check:bundle（entry JS **73,706**/81,920、CSS 136,741/141,312、preload **21**/23）/ `git diff --check`；④ **设备侧（lake_gate / emulator-5562，重装本轮 APK）**：`check:bitablesnap` 3 态 **0 差异**（2100/2082/2095）、`check-mobile-snap` 6 态 **0 差异**（未重烤基线：`baseline/mobile-snap.json` git diff 为空、sha256 前后一致）、**清夹具后再跑 6 态仍 0 差异**；实机 Phase1 21/21 + Phase2 17/17 全 PASS —— 默认落表单、表格↔卡片（2 列/封面/主副标题）、日期格式「6月9日」+ **1062ms 自动保存回读 `format:"md"`**、数据表抽屉/重命名/复制/删除、布局偏好重启保留、只读态置灰+理由、表单提交 3→4 条真落盘且按钮不被胶囊压住、记录详情单 header + 返回键先回列表。证据 `.css-audit/261030-final/`（截图 00–22 + phase1/phase2-result.json + SUMMARY.md，gitignored）。**桌面侧只有代码 + 单测/编译，未做实机截图**（见上条待办③）。

> **验收三条观感项已修（261028）**：① 浮窗「上次同步」去重（只留明细行）；② 「测试连接」通过状态改成**按配置指纹绑定**（`src/lib/s3FormState.ts`），保存不再失效、改连接字段才失效；③ 七牛 Endpoint → Path-style 开关禁用+提示+保存/测试强制 false。真机复验通过（保存后开关仍可用、浮窗只有一处上次同步、Path-style 灰显）。事故自留：`SettingsPanel.tsx` 曾因「整文件 read→write」被截断（read 对 67KB 文件会截断），用 CDP sourcemap 的 `sourcesContent` 还原后以脚本断言替换重做；**大文件禁止整轮回写**。同时 `commit/pipeline.test.ts` 扩到 5 场景（本地更新/零变更/资产/本地 purge/冲突）。


> **真机/真 S3 验收（261028）**：桌面（隔离副本 + 真 dev 桶 `lakex-notes-dev3`）与 `lake_gate` 模拟器（现场构建 debug APK）均通过；首轮 1 文档上传/移动 1 文档下载、增量零变更轮不发布、浮窗两行细分与移动新细分行渲染正确、无 console error。**验收中修掉 P1**：`last_synced_at` 在 v3 路径无写入点 ⇒「上次同步」永远旧时间/为空（补 `store.markSyncComplete` + `electron/syncStatusWiring.test.ts` 静态锁）。待用户裁决 3 条观感项（浮窗「上次同步」重复出现 / 保存后需重测才能开开关 / Path-style 对七牛须关）。详见 08 §32、截图 `.css-audit/accept-261028/`。


> **当前基线（已迁移）**：见文末 **§1**（`master` `408d6126` + `feat/pad-touch-ui` 36 提交未合；门禁 571 文件 3477 例）。**下方「待用户验收 / 待用户裁决 / 下一会话焦点」为 261030 口径的历史归档，未逐条销账；当前待办一律看 §3。**
> **待用户验收**：表格 P4/P5 桌面侧、小记搜索/标签（桌面+Android）、CSS 层修复、长按 capture 启动、移动端表格「链接/十字高亮」设备点按、多维表重命名单边框 + 创建项「新建多维表」、默认标题/筛选单边框/云同步默认关、AI 面板全文开关只给无选区入口、macOS 全屏顶栏去掉红绿灯让位、表格第三方输入框单边框（vendor 焦点归属）、全屏附件预览/顶栏不加红绿灯让位、**移动端多维表复刻（表单优先 / 内容·表格·卡片 / 数据表操作 / 字段格式与互转 / 看板·画册·日历 / 登记专项门禁）—— 设备验收已过，等用户点收**、**移动端 UI 整改（原语收敛 / 面板与文档留白 / 字号小档整体抬一档）—— 设备实测已过，等用户点收**、**261102 五条点单（多维表新建视图 + 字段自动编辑 / 手写板分页纸张 / 设置输入行上下布局 / 小记标签强调 / 浮层边界留白）—— 设备验收已过，等用户点收**。
> **待用户裁决**：① 移动端表格 ⋯ 面板逐项去留（29 项：22 可点 + 7 置灰占位；已给出逐项功能与建议，等用户点单后再裁）；② **缺正文 / 缺小记的移动端入口**（要不要做"移动资源页"；桌面判据 `missingBodyRecovery` / `missingQuickNoteRecovery` 可直接复用，但手机端有没有这个场景/放哪层入口属产品决定）；③ **表格「单元格保护 / 阅读态筛选·排序·冻结」的语义**（写正文 vs 设备本机视图——决定 P4-4 与 P5 剩余怎么收口；桌面/移动同一套判据）。
> **下一会话焦点**：① 表格 P4/P5 剩余（移动阅读态/保护语义）——**先等待用户裁决③**；② 移动端文本格式缺口（H5/H6、缩进、行高、清除格式、格式刷）；③ 画图插入项解禁；④ 逐页走查；⑤ GitHub Releases 与签名/公证；⑥ **移动端缺正文 / 缺小记的恢复入口** —— **先等待用户裁决②**（判据已在 `src/core/missingBody.ts`，桌面资源页是现成样板）。
> **已定不再讨论**：长期红线见 `AGENTS.md` §3；历史决定见 git。

### 261030 · 发版 v0.0.2（GitHub Actions 三端打包，已发布）· **tag 已双推**
- **版本**：`package.json` 0.0.1 → 0.0.2。**Android 版本号改由 package.json 派生**（`android/app/build.gradle` 顶部读 `rootProject.file('../package.json')`；versionName = 语义版本，versionCode = 1000 + major×10000 + minor×100 + patch ⇒ 0.0.2 = **1002**，只增不减，避免 `INSTALL_FAILED_VERSION_DOWNGRADE`）。「关于」页读的 `App.getInfo()` 从此与 Release 产物名一致（此前写死 `1.2`）。**发版只 bump package.json，不要手改 build.gradle 的版本号。**
- **流程**：`chore(release): v0.0.2` = `4b2a2467` + 注解 tag `v0.0.2`，`git push origin master v0.0.2` 一次双推；Gitee 只镜像代码+tag（不跑 CI）。
- **CI（run [41039672304](https://github.com/gtycoder/lakex-local-notes/actions/runs/41039672304)）四个 job 全绿**：macOS（含 packaged smoke）/ Windows / Android（release 变体 + 非 debuggable 断言）→ Publish Release（`generate_release_notes`）。
- **GitHub Release** <https://github.com/gtycoder/lakex-local-notes/releases/tag/v0.0.2> 四个产物：`LakexLocalNotes-0.0.2-arm64.dmg`(187MB) / `-arm64-mac.zip`(188MB) / `LakexLocalNotes.Setup.0.0.2.exe`(156MB) / `-android-release.apk`(33MB)。
- **Gitee 发行版未同步**：仓库未配 `GITEE_TOKEN` secret（按既有口径 Gitee 只保留代码+tag 镜像；要同步就在 GitHub 配 token 后重跑 workflow_dispatch）。
- **已知**：macOS 未签名/未公证（首次打开右键→打开）、Windows 未签名（SmartScreen → 更多信息 → 仍要运行）、Android 是 debug keystore 签的 release 变体（`debuggable=false`）。发版后 tag 不可移动（发错只能 bump 版本再发）。

### 261030 · 移动端 UI 整改（用户点单三条：原语 / 留白 / 字号）· 已双推（Gitee + GitHub）
- **① 接入已有原语，不再自造**：kit 新增 `.mb-chip` / `.mb-chip-row`（选项胶囊）—— 把 bitable 并存的 `.mbt-feditor__choice` / `.mbt-chip` / `.mbt-form-chip` 三套收敛成一件；只读选项值改用 `.mb-tag`（相邻间距 = `.mb-tag + .mb-tag`，**不包容器层** ⇒ 设备快照元素数不变）。新增 `.mb-sheet__foot`（Sheet 底栏唯一来源：左右页内距 + 底部安全区 + 发丝线），删掉 feditor/date/actions 三处各写一套的 footer padding。「修改字段」面板骨架改为 `.mb-set-section` / `.mb-set-item(--field)`（与「编辑记录」同一形态），控件沿用 `.mbt-form-input` / `.mb-switch` / `.mb-btn`。
- **② 留白（贴边）**：六个 bitable 面板补 `bodyClassName="mb-sheet__body--form"` —— `.mb-sheet__body` 默认横向 0 内距 ⇒ 内容直接贴着屏幕边（就是用户截图红框里「标题/字段类型」标签被裁掉的那类问题）；`.mobile-bitable` 10→16、`.mbt-page-body/.mbt-page-foot/.mbt-drawer__*/.mbt-action-row` 12→16；新增 `--mb-reader-pad`(20) 只给连续长文：文档正文 `.lake-editor` 14→20、记录详情页 body 12→20。
- **③ 字号**：按 tokens 的「The Token-Size Rule」**小档整体抬一档**（用户口径「除编辑器正文外整体偏小」）：nano 11→12 / micro 12→13 / tiny 13→14 / small 14→15；body 16 与行标题 16 不动（编辑器正文字号仍是独立设置项，不归这条 ramp）。Sheet 标题升到 `--lake-font-size-title`(18)/600/text-1 并补省略（长表名不把关闭钮挤出去）；`.mbt-option` 旧字面量 12 改走令牌（字号字面量 49→48）。
- **文档**：`docs/MOBILE-DESIGN.md`（字号档 12/13/14/15/16/18/20/24、Caption 14 / Micro 13 / Nano 12、页面内距 16 + 阅读面 20、原语清单补 chip 与 Sheet 两件契约、字号字面量现状 48）；`tokens.css` 注释；`mobileLayers.test.ts` 基线（tokens 190→191、kit 539→565、floating 284→295，逐条写理由）。
- **设备实测（lake_mobile / 5554，重装本轮 APK）**：修改字段面板 bodyPad=16 / inputLeft=32 / chip 高 36 / 标题 18px / footer pad=16；文档 `.lake-editor` paddingLeft=20；记录面板 `mb-sheet__body--form`；表单 / 网格 / 字段面板 / 首页 / 设置页截图在 `.css-audit/ui-261030/`（gitignored）。
- **设备门禁（lake_gate / 5562，重装本轮 APK）**：6 态与多维表 3 态因**字号/几何变化**指纹全变、元素数不变 ⇒ 按 MOBILE-OPS §5.3 **重烤两份基线**（`baseline/mobile-snap.json` 6 态 / `baseline/bitable-snap.json` 3 态），重烤后连跑 **0 差异**（元素数 1822/1822/1827/1996/1912/1849 与 2100/2082/2095 均未变）。
- **门禁**：tsc 0 / vitest **531 文件 3247 例** / 双侧 build / check:bundle（mobile entry JS 73,708/81,920、CSS 136,802/141,312、preload 21/23）/ check:core 135 文件 0 / check:mobileui + ui-metrics（字号字面量 48/49、!important 19/19）/ check:android-release 12 项 / `git diff --check`。
- **未做**：桌面侧无改动（本批只动移动端样式层 + kit/floating 原语 + bitable 组件）；23 屏走查未跑（改的是全局字号/内距，6 态快照已覆盖首页/设置，走查建议改版后补一次）。

### 261029 补丁 · 首启欢迎页统一（Android 小记 + 桌面文档）/ 桌面 AI 总开关 / AI 页分组标题去灰底 · **本地提交（见 git log 首条，未 push）**
- **首启欢迎页（用户点单）**：桌面欢迎文档与 Android 默认「欢迎」小记使用同一份内容（`src/core/lakeDocForm.ts` 的 `WELCOME_TITLE`/`WELCOME_INTRO`/`WELCOME_GUIDE_LINKS`；桌面 `welcomeLakeBody()` 带可点击链接，小记 body 同源 + `welcomeQuickNoteText()` 纯文本镜像）。内容含 **Gitee / GitHub 使用说明** 两个入口（`…/blob/master/guide/README.md`）。
  - Android 仅在**全新库**创建一次（固定 id `welcome-quick-note`，标记 `welcome_quick_note_initialized`；用户删除后不复活；有数据的旧库只补标记不插入；失败只 warn 不阻断启动）。新增 `src/mobile/data/welcomeQuickNote.ts` + 判据单测。
  - 门禁夹具（`scripts/mobile-audit/gate-fixture.mjs`）会物理删除这条欢迎小记，保持「4 条小记」的确定性夹具（否则每次新装快照都会多一条）。
- **桌面 AI 总开关（用户点单）**：设置 → AI → **连通性** 分组新增 `ai-enabled` Switch（设备本地 `localStorage`，~~默认开，保持旧行为~~ ⛔ **261103 起改为默认关**，与移动端同口径）；关闭后 `lib/ai.ts` 的 `runAiChat` 直接拒绝、**任何路径不出网**，配置与 Key 保留；未配置 API Key 时尝试开启会给行内提示（同「启用云同步」口径）。`settingsSearch` 已登记 `ai-enabled`。
- **AI 页观感**：`.settings-panel .config-section__title` 去掉灰底色（`--lake-bg-subtle` → transparent），分组边界只由卡片 0.5px 边承担（用户反馈"灰色衔接条很丑"）；手册 `desktop-settings-ai.png` 已重拍。
- **手册**：01/10/12 章补首启欢迎小记、桌面 AI 开关位置与语义。
- **基线**：新装夹具后 `home-doc` 指纹变化（文档 id 变化，元素数不变）⇒ 6 态重烤；之后门禁连跑 **0 差异**。
- **门禁**：tsc 0 / vitest 508 文件 3165 例 / ui-metrics / check:core / check:mobileui / mobile build / check:bundle / diff-check。

### 261029 本轮 · S3 迁移码 / AI 防御开启 / 两端对齐与 UI 审计 / 全面回归 / 用户手册 · **本地提交（见 git log 首条，未 push）**
- **功能**：移动端 S3 支持「粘贴迁移码」（与桌面 `S3ConfigImportDialog` 同形同构，坏码就地报错）；AI 开关默认关、必须「测试连通性」通过才能开（与 S3 同一逻辑；未验证点击只提示不打开）；「启用云同步」点击时未配置/未验证给可见提示；「执行深度清理 / 清理云端」加二次确认；关于页加回技术身份。
- **视觉/文案（用户 5+1 条口径）**：两端边框 **0.5px**（内容区/焦点环/对勾/进度环/画板笔迹例外）；动效统一 **ease-out 250ms** 并删装饰性过渡；圆角字面量收敛到令牌、删装饰阴影；界面文案人话化、**禁中点「·」**（固定术语「云端已删除（仅本地）」「隐私数据（云端不加密）」）；两端光学对齐 + 同心圆角（外 R − 间距）；信息秩序重排（桌面设置导航/云端组，移动根菜单/AI/同步页）。设计口径已回填 `docs/DESIGN.md` §Shapes/§Motion/§Voice & Copy、`docs/MOBILE-DESIGN.md`、`.impeccable/design.json`、`AGENTS.md` §3#14 观感红线。
- **回归（桌面 80 例 `✅74/❌4/➖2`、移动 50 例，P0=0）**：报告 `.css-audit/regression-261029-{desktop,mobile}/REPORT.md`。
  - P1 修复 3：① 桌面状态栏「云关闭仍待同步」→ `documentStatusModel` 入参改 `cloudEnabled`，`App` 传 `isCloudActive(cloudConfigured, cloudEnabled)`；② 移动未配置 S3 点「立即同步」被记「同步成功」→ `bridge/sync.ts` 仅在 summary 非空时写状态；③ 移动首次打开 AI 的 `readdir` ENOENT console.error → `aiImageStore.sweepOrphanConversationDirs` 先建目录再读。
  - P2 修复 5（移动）：设置根页可见关闭按钮；新建面板标题「新建文档知识库」→「文档与知识库」；多维表元信息去掉重复「视图」并占满；空画板加空态；大纲右侧抽屉「让位底部胶囊」曾修后按用户 261029 决定**已回退为全高**（大纲/目录是临时切换、不长期驻留；左侧抽屉同样不做让位）。
  - P2 结论（桌面）：工具栏按钮 disabled/插入面板点不开 = 冷启动未聚焦 + 后台窗口首击伪影（点正文后正常，dev/scheme 一致，非回归）；状态栏字数/图片保持**不可点**（顶栏同步入口已足够）；内核工具栏 **a11y 不做**（用户 261029 决定：不为读屏用户适配；此前试过的焦点环也一并回滚）。
  - **二次补测（移动）**：回收站 移入→恢复→再移入→彻底删除 闭环通过（未配置 S3 时无假云端标记）；「清理云端」二次确认（取消不执行）；首页胶囊长按上滑速记进入写作卡；Lake 文档插入表格 = **内核原生表格卡**（非 Univer；独立「新建表格」文档才走 Univer）；手写板入口确认存在（工作区→文档树→新建→新建手写板，非缺口）。报告 `REPORT2.md`。
- **用户手册**：新增 `guide/`（15 篇 Markdown + 31 张真实截图，中文、相对链接+锚点、桌面/Android 分列）。
- **基线**：移动 6 态重烤（settings 元素 1909→1912 = 设置根页关闭按钮；大纲回退后 home-doc hash 再变一次，仅 1 态），重烤后门禁连跑 **0 差异**。
- **门禁**：tsc 0 / vitest 505 文件 3156 例 / check:core 133 文件 0 / check:mobileui / check:bundle / ui-metrics / `git diff --check`。

### 261029 · 运维文档重建（Android 使用方法）+ lake_gate 换新包 · **已提交 d02a7144（仅本地，未 push）**
- **背景**：旧 HANDOFF §8「移动端速查」在 `03ef3fb3` 随重写被删，但 HANDOFF 头注释、`docs/MOBILE-TECH-STACK.md`、`docs/LAKEX-CONTRACT.md`、README 仍指向 §8 ⇒ 安卓端「怎么构建 / 怎么装 / 怎么连 CDP / 怎么跑门禁」失去单一来源。
- **落地**：新增 `docs/MOBILE-OPS.md`（唯一运维手册，10 节：环境前置 / 构建安装 / 运行调试 / 浏览器预览边界 / 门禁装置 / 点按口径 / 包名与数据 / 故障排查 / 261029 设备现状 / 与桌面判据边界）；4 处失效引用改指它，另补 `MOBILE-TECH-STACK` §五#7、`HISTORY-DESIGN`、README 文档表。
- **口径收窄**：`AGENTS.md` §2 ⓪ 的「vendor 成品组件只挂 LakexEditor ⇒ 那些组件从不运行」改为精确版 —— 只指 **React 包装层**（`LakexEditor` / `SvgIcon` / `ImageToolbar` / `BookmarkToolbar` / `drawingBoardAI` 适配）；`BlockHoverHandle` 是我们自挂的例外（`blockHandleMount.ts`）；**内核层 `ne-*` UI 不受影响**。`LAKEX-CONTRACT` §5.8/§5.32 回填 261029 复核 + bundle 证据（i18n 串在 dist/dist-mobile 的 JS 里 0 命中，`ne-image-toolbar` 只在 CSS —— CSS 在 ≠ 组件在）。
- **设备**：`lake_gate`（emulator-5562）重装新包 `com.lakexlocalnotes.android`（旧包保留未卸），灌夹具后重烤 6 态基线（元素数不变，仅 `home-doc` 指纹 `br6io→xy3qs9`），门禁连跑 **0 差异**；`emulator-5554/5560` 仍是旧包 ⇒ 要跑先重装。设备/门禁口径见 `docs/MOBILE-OPS.md`。
- **门禁**：本批无代码改动；`git diff --check` 干净 + 移动 6 态门禁 0 差异（Lead 复跑验证）。基线 `scripts/mobile-audit/baseline/mobile-snap.json` 随本批入库更新。

### 261029 · macOS 应用菜单（参考思源裁剪版）· **已提交 6ecae807 + aa152132 并双推**
- **参考思源的做法**（`app/electron/main.js` 的 `applyMacAppMenu`/`setStartupApplicationMenu` + `appMenu.test.js`）：只 darwin 装自定义菜单；role 打底、label 逐项覆盖（思源取自语言包）；「设置…(⌘,)」只发 IPC 给渲染层（`siyuan-open-setting`）；帮助 = 使用指南(IPC) + 反馈/官网/GitHub(openExternal) + DevTools(dev)；菜单有纯函数测试（每个 role 必须有 label）。
- **我们的裁剪版**：新增 `electron/appMenu.ts`（纯模板函数）+ `electron/appMenu.test.ts`（5 例：首组 appMenu、设置 ⌘, 只走回调、编辑/窗口 role、帮助回调、dev-only DevTools、role 都有 label）+ main 里 `Menu.setApplicationMenu`（仅 darwin）+ `open-settings` 主→渲染事件（preload `onOpenSettings` → `native.onOpenSettings` → App 打开设置面板）。**不做**：多窗口按窗口切菜单、用户自定义热键、i18n 语言包（单窗口/中文 UI/无热键设置 UI，YAGNI）。
- **实测（AppleScript 读真实菜单栏 + 真点一次）**：`Apple, Electron, 编辑, 窗口, 帮助`；应用菜单 = 关于 LakexLocalNotes / 设置… / 服务 / 隐藏×2 / 全部显示 / 退出；帮助 = 使用文档 / 反馈问题 / **打开数据目录** / 开发者工具(dev)。点「打开数据目录」实测 Finder 打开 `~/Library/Application Support/lakex-local-notes-dev/`（打包版为 `…/lakex-local-notes/`）。**dev 标题是 Electron**（macOS 取 Electron.app 的 CFBundleName，`setName`/label 都改不了）；打包版（v0.0.1 的 DMG）标题是 `LakexLocalNotes`。
- **门禁**：tsc 0 / 全量 vitest **515 文件 3149 passed（12 skipped）**（+appMenu 5 例）/ 桌面 build 通过 / `git diff --check`。

### 261029 · 提交前 review + 双推脚本 + CI 改 tag-only · **已提交 03ef3fb3 并双推**
- **代码 review（本批 575 文件）修掉 6 处**：① `deviceStore.ts` 与 `intentLogState.ts` 两份重复的 `mergeSyncMarkers` → 只留 intentLogState 一份（deviceStore re-export）；② `loadState` 原来 `migratePersisted` + `fromPersistedState` **迁移两次** → 新增 `ledgerOf()` / `persistedNeedsMigration()`，投影与迁移分离、只迁移一次，日志文案 v2→v3 修正；③ `s3v3DeviceStore.ts` 里过时的「conformance 双端各跑 10 场景」→ 单实现契约（21+3）；④ 4 处测试写死旧 Android 包路径 / 1 处大写旧串 `LOCALLAKEXNOTES`（改名遗漏）；⑤ 安全（secrets/debug 残留/`.only`/vite.config onstart）扫描干净；⑥ 删除文件均为既有批次删的 v2/manifest 时代死代码与过程文档，无新增误删。
- **双推脚本（入库，SSH）**：新增 `scripts/setup-remotes.mjs` + `npm run setup:remotes`——`origin`=Gitee、`github`=GitHub（**两者都走 SSH，不弹密码**）、`origin` 双 pushurl（一次 push 两边）。地址硬编码在脚本里（地址很少变）；**remote 配置不入库**，clone 后跑一次即可。本机另在 `~/.ssh/config` 加 `Host github.com → IdentityFile ~/.ssh/id_ed25519_personal`（默认 id_rsa 未在 GitHub 登记，不配置会 fallback 失败）。已实跑验证（dry-run 双端通过）。
- **首次公开 Release 已验证（261029）**：`v0.0.1`（`ecd65752`，package.json 同步 0.0.1）推送后 GitHub Actions 全绿（macOS/Win/Android/Publish），Release 产出 4 个产物（`LakexLocalNotes-0.0.1-arm64.dmg` / `-arm64-mac.zip` / `LakexLocalNotes.Setup.0.0.1.exe` / `-android-release.apk` 33MB）；普通 push 未触发任何 run（符合 tag-only）。Gitee 侧**不跑 CI**（Gitee Go 收费），发行版同步只靠 GitHub Actions 调 Gitee API（需 `GITEE_TOKEN` secret；本次未配 ⇒ 该步 skipped）。旧内部 tag v0.1.0–v0.1.4 已删除（避免 `--tags` 误触发 5 轮打包）。
- **CI 触发口径（用户 261029 定）**：GitHub 为发版主仓；**只有推 tag 才打包**。`release.yml` 保持 `push: tags: ["v*"]`（+ 手动重跑）；`packaged-smoke.yml` **去掉 `push: branches: [master]`**（普通 push 不构建、不耗 macOS runner；tag 上由 release 内联冒烟兜底）。README / docs/RELEASE.md / AGENTS 三处口径同步（两处托管、clone 后 setup:remotes、tag-only）。
- **门禁**：tsc 0 / 全量 vitest **514 文件 3144 passed（12 skipped）** / check:core 133 文件 0 / ui-metrics + check:mobileui / 两条 build / check:bundle / check:android-release 12 项 / Android `compileDebugKotlin`+`testDebugUnitTest` BUILD SUCCESSFUL / `git diff --check`；`setup-remotes.mjs` `node --check` + 实跑通过；两个 workflow YAML 解析通过。
### 261029 · 全量改名（local- 词序 → lakex-local-notes）· **未提交**
- **范围**：项目名/仓库名/npm 包名改为 `lakex-local-notes`，productName `LakexLocalNotes`；全仓替换 623 处 / 198 文件（旧词序、旧驼峰、旧无分隔写法均清零）。工程目录同时改为 `/Users/admin/file/local-lake/lakex-local-notes`。
- **平台身份拆分（用户 261029 定）**：桌面 `com.lakexlocalnotes.desktop`；Android `com.lakexlocalnotes.android`（`capacitor.config.ts appId` + `android/app/build.gradle namespace/applicationId` + Kotlin 包目录 `android/app/src/main/java/com/lakexlocalnotes/android/`，源码与测试都搬了）；**iOS 预留 `com.lakexlocalnotes.ios`**（尚无 ios 工程，建工程时用该 bundle id，不复用 Android id）。
- **派生身份同步**：数据目录 `lakex-local-notes-dev`/`lakex-local-notes`、日志 `lakex-local-notes.log`、localStorage `lakex-local-notes-v3.*`/`lakex-local-notes-mobile.*`、私有协议与深链 `lakexlocalnotes://app`/`quick-note`、electron-builder artifactName、README 徽章、CLI/CI 里的仓库名、Android `app_name`/快捷方式/FileProvider（`${applicationId}.fileprovider` 跟随）全部跟随；S3 迁移码 `LLN1.` 不变（缩写仍是 Lakex Local Notes）。
- **门禁（改名后全绿）**：tsc 0 / 全量 vitest **514 文件 3144 passed（12 skipped）** / check:core 133 文件 0 / ui-metrics + check:mobileui / 两条 vite build / check:bundle（preload 23、mobile JS gz 72,502、CSS 137,096）/ check:android-release 12 项 / `git diff --check`；**Android 真实编译**：`./gradlew :app:compileDebugKotlin` 与 `:app:testDebugUnitTest` BUILD SUCCESSFUL（需 `JAVA_HOME=jdk-21` + `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`）。
- **运行验证**：dev 从新目录启动成功（窗口标题 `LakexLocalNotes`、新 userData `~/Library/Application Support/lakex-local-notes-dev` 全新初始化）。**旧词序的 dev 数据目录保留未删**（孤儿，可随时清）；因数据目录/包名/localStorage 全换，dev 里的 S3 配置与窗口布局要重配。
- **已落地（261029）**：提交 `03ef3fb3`，`git push -u origin master` 一次推 **Gitee `gtycoder/lakex-local-notes` + GitHub `gtycoder/lakex-local-notes`**（两端 head 均为 `03ef3fb3`）；远端配置由 `npm run setup:remotes` 生成（`origin` 双 pushurl + `github` remote），**不入库**。**发版前必须重装 APK**（applicationId 变了，等于新 App，旧装机不会升级覆盖）。
### 261029 · E3-1 phase2b 复核裁决（不做）+ 两条护栏 · **未提交**
- **裁决**：全量 phase2b（引擎直接消费 records + 物理删 DeviceState 8 个旧字段）**不做**。实测：9 本账在非测试代码 188 处引用 / 17 个文件；其中 **6 本每次 loadState 都由 DB 行重新推导**（listQuickDeleted/listQuickPurges/listRestorePending*/listPurgedTombstones/cloud_deleted 列/listBodyRecoveryPending ⇒ 端口读必须留）、写侧 DB 投影 + 信封一份不减、字段映射早已隔离在 `engineBridge.ts`（207 行纯函数）⇒ 只换内存载体、LOC 中性偏负，而风险是同步正确性热路径（最大项）。按 AGENTS §3#17 结案不做；证据与成本表见 `docs/SYNC-STATE-CONVERGENCE.md` §1.3c（状态表已改 ⛔）。
- **残项 1（判据单点）**：新增 `src/core/s3v3/state/cloudDeleted.ts` 的 `settleCloudDeleted`（失效三态 = 显式恢复 / 远端同 id 再现 / 本地已彻底删除）；引擎 `finalizeRemotePurged`（传 remotelyPresent）与适配器 `createDeviceStoreMeta.loadState` 的 DB 投影兜底（传 locallyPurged）**同调一函数** —— 原来两层各写一份「同口径」，引擎加第 4 种原因而适配器没跟上就是徽标永久挂死 + 每轮空转。测试 +7（cloudDeleted.test.ts）+2（engineBridge：顺序保持/无变化返回同一对象）+1（deviceStoreMeta：DB 投影与信封标记合并后失效）。
- **残项 2（穷尽性护栏）**：`intentLogState.test.ts` 用 `{[K in keyof Required<DeviceLedger>]: …}` 声明每本账非空样本并逐个 save→load ⇒ **新增/改名 DeviceState 账本字段却没接线 = tsc 失败**（自证：临时加 `__probeLedger` 报 `TS2741 Property '__probeLedger' is missing`，随后还原）；顺带修不对称：`toPersistedState` 的 quick-purge 改 **purges ∪ purgeTimes** 并集（与 v2→v3 迁移同口径，避免「只有时间表」的旧信封在下一轮 save 静默丢时间戳）。
- **门禁**：tsc 0 / 全量 vitest **514 文件 3144 passed（12 skipped）** / 定向 electron/s3v3+core+mobile 69 文件 499 passed / `git diff --check` 干净。wire 协议、DeviceState 形状、DB schema、引擎行为均未变（纯判据抽取 + 测试护栏）。
- **安全复核（261029，5 项不做 + SEC-12 已修）**：SEC-04（资产 token 只对带 Origin 生效）/06（无权限收敛，且「全拒」会拒掉 `clipboard.readText()` ⇒ S3 剪贴板导入/多维表粘贴失效）/08（Android 全局 cleartext）/09（WebView 桥生命周期与 data:/blob:）/11（PDF 走 PDFium）+ SEC-13b/13e 逐条按「功能能不能出现、现有防线能不能兜住、成本收益是否成比例」判为**不做**，理由与场景判断写在 `docs/audit-261027/02-security.md` §6（含：我们**依赖** `clipboard.readText` 默认放行；移动端 CSP `script-src 'self'`+hash、`object-src none` ⇒ 桥/混合内容无触发路径；同机进程/root 本来就能直读明文正文与数据目录）。只顺手修两处**会误导安全推理的注释**（`network_security_config.xml` 自称「开发版」实为发布配置；`vite.mobile.config.ts` 头注释 `androidScheme=https` 实为 http）。唯一剩下的是**发布正确性**待办：SEC-03 真实 CI 首跑（不写任何防御代码）。
- **SEC-12 已修（261029，用户确认后期要发版、走 GitHub Actions）**：两个 workflow 的全部 action 从 mutable major tag 换成**不可变 commit SHA**（checkout v4.4.0 / setup-node v4.4.0 / setup-java v4.9.1 / upload-artifact v4.6.2 / download-artifact v4.3.0 / softprops/action-gh-release v2.6.2，行尾注释版本号），workflow 头注释写「升级 = 换 SHA + 改注释版本」；Gitee token 仍按 Gitee API `access_token` 形态（托管 runner 单租户 + action 已 pin ⇒ 残余面可接受）。**同批功能项：HTML 附件改可用系统默认浏览器打开**（`isSafeShellOpenFilename` 显式放行 `html/htm`，此前被 fail-closed 拦成「该附件类型不允许用系统应用打开」）；我们自己的源仍不返回 `text/html`（`MIME_BY_EXT` 无 html、未知扩展名 octet-stream + nosniff），移动端 native 白名单暂不放开 ⇒ 只看外部浏览器执行，不新增应用内执行面、不需要新防御。门禁：tsc 0 / `assetNaming`+`attachmentOpen`+`electron/ipc` 49 例绿 / `check:android-release` 12 项 / YAML 解析通过 / diff-check 干净。
- **环境坑（261029 现场定位）**：`private/lake-notes-electron-obsolete-261027`（261023 旧副本、自带 node_modules）**共享 dev 数据目录** `lakex-local-notes-dev`；在它里面 `npm run dev` 会拿旧 schema 迁移打当前 dev 库 ⇒ `SqliteError: table tree_nodes has no column named sync_state`，表现 = 出 splash 后空白/直接退出（日志 `logs/lakex-local-notes.log` 的 `[crash]` 行会打出旧副本路径）。已把该副本改名为 `…obsolete-261027.DISABLED-261029`（可随时改回）。**dev 只在 `/Users/admin/file/local-lake/lakex-local-notes` 启动**；DSH 宿主里启动要 `env -u ELECTRON_RUN_AS_NODE`。
### 261029 · 架构批（E3-1 phase1 + Del-6）· **未提交**
- **E3-1 phase1（账本收敛第一步）**：新增 `src/core/s3v3/state/intentLogState.ts`（`DEVICE_STATE_VERSION=2` + toPersistedState/fromPersistedState/migratePersisted）；持久化**只写一份 v2 信封**（9 本账 + `assets` 资产声明投影 + 桌面 `hashCache`，world 仍是 DB 投影不进信封；baseline 原位不动）；桌面 `desktopStoreAdapter` 与移动 `v3StateRepository/mobileDeviceStore` save 只写信封、load 摊回完整 DeviceState；旧格式**单向迁移**（load 不写盘，下轮 save 落 v2），未知版本/损坏 → null。**引擎对 DeviceState 的读写一行未改**；wire 协议未动。新增 intentLogState.test.ts（6 例）+ 适配器/仓储迁移用例（+5 例）。
- **Del-6**：`sync_base` **彻底删除**（桌面+移动 schema/读写方法/测试；可云恢复判据改 `remoteNoteIds` v3 事实；从云端拉回正文不再 `setBaseHash`；diagnostics 改读 v3 baseline.json.gz 的 per-note contentHash）；`declared_assets` 零残留（含移动死 DDL）；**`published_at` 保留**（desktopSync 成功轮后 markTombstonesPublished，待同步计数依赖；删列需先设计新判据，单独立项）。旧库残留空表不迁移/不 DROP。
- **门禁**：tsc 0 / 全量 vitest **500 文件 3133 passed（12 skipped）** / check:core 129 文件 0 / ui-metrics / check:mobileui / 两 build / bundle / android-release / diff-check；移动端重装后 6 态快照 0 差异。
- **设计文档**：`docs/SYNC-STATE-CONVERGENCE.md`（E3-1 phase1/phase2、E2-4 分阶段、Del-6 判定与验收）。
- **E2-4 phase C-3b-2（261029）**：移动 26 个写方法 + 3 钩子（begin/flushWriteBatch=executeSet 批窗口、moveStagedBodyFiles、applyCloudDeletedProjection 投影事务）；mobileDeviceStore 698→398 行，旧 saveState ~280 行删除，saveState 委托 core meta.saveState()；移动端口保留语义差异（quick purge 保留副本+打标、回收站 parent/trashed_at、staged 小记正文、hasNote 覆盖 notes∪quick_notes）。A/B（2000 篇）：首拉 49.0→36.8ms、增量 18.1→19.8ms、SQL 2011→2013、原生 executeSet 均 1 次；conformance.mobile 21/21、mobileCloudDeleted/remParity/historySnapshot 全绿。
- **Del-6 published_at（261029，完成）**：桌面逐行 published_at → **单一 waterline**（`device_state.tombstones_published_at`；小记库 `quick_tombstones_published_at`），pending = `deleted_at > 水线`，成功同步后写水线；桌面 `ALTER TABLE ... DROP COLUMN published_at`。移动 schema v10 同批删 `deleted_notes.published_at`（DDL+旧库 DROP）、`localStorePort.markTombstonesPublished`、bridge 方法、契约面登记。**真实 S3**：桌面首传 ↑1/823ms、零变更 96ms、改 1 篇 ↑1/632ms，DB 校验无 published_at 列且水线已写；移动 schema v10 首传 ↑9/3.64s、空跑 215ms（前缀 12→0）。**E2-4/E3-1 phase2a/Del-6 三项全部收口**；最终门禁 tsc 0 / vitest 502 文件 3133 passed / check:core 132 文件 0 / 两 build / bundle / android-release / diff；设备复位 6 态 0 差异。
- **E3-1 phase2a（261029）**：持久化从 v2「9 组字段」收敛为 **v3 类型化 IntentLog（records 判别联合）**——`IntentLogStateV3 { version:3, records, assets, hashCache }`；toPersistedState 摊平 9 字段→records、fromPersistedState 投影回 DeviceState（**引擎一行未改**）；v1/v2 单向迁移、未知 kind 丢弃+warning、断代门只读 v3；baseline 不信封化；桌面/移动适配器接线。测试：intentLog 13 例（round-trip/迁移/warning/版本门）+ 6 个 v2 形状用例更新；定向 97 文件/586 passed。
- **E2-4 收尾 · 移动 locked_at（261029）**：移动端口补齐编辑锁时间戳（listNotesSyncMeta 读 locked_at；applyRemoteEditLock/importRemoteNote 写 is_locked+locked_at）；conformance 场景 5 改断言「纯锁变更按 locked_at 字段级 LWW 传播、两端时间戳一致」；**唯一剩余语义缺口关闭**。
- **Del-6 published_at（261029，task-22 进行中）**：用 device_state 单一 waterline 标量替代逐行 published_at；成功后写 waterline、pending = deleted_at > waterline；删列/方法/DDL（DROP COLUMN 兼容性由实现方裁决可保留列只停读写）。
- **E2-4 phase C-3c（261029）**：conformance 从双端对拍改单实现契约（defineDeviceContract；删 capabilities 机制、场景 5 按端口语义直断、deferAssets 去分支、目录兜底 it.fails 转正）；单跑 21 it + mixed 3 it；删 desktop 双跑与 __baselineOldStore；SYNC-DEVICE-CONTRACT §5 改「共享实现+端口差异」6 条矩阵（唯一剩余语义缺口 = 移动 locked_at 仍丢弃）。**E2-4 收口**。
- **E2-4 phase C-3b-1（261029）**：第 5 处漂移契约化——core deleteNote 两处复用但两端语义不同（桌面都软删；移动「远端墓碑→回收站」vs「state 缺失→写 deleted_notes 墓碑+删行/正文」），新增可选 purgeLocalNote 端口（core 收敛删除优先用它，否则回落 deleteNote；桌面不实现=逐字不变），移动端口已实现。桌面 61/459、合并 89/575 全绿。C-3b-2（移动 22 写方法+3 钩子+saveState 切换对拍/perf）在 task-19（core-services 执行）；C-3c（conformance 契约化+删旧实现）随后。
- **E2-4 phase C-3a（261029）**：第 4 处漂移（移动 quick 删除 baseline-aware 三态）下沉 core——saveQuickNotes quick-missing 三态（purge / cloud-delete / physical-delete），桌面不实现 discardQuickNote 即回落软删（迁移前语义），无 if(platform)；端口 +deletedAt +可选 discardQuickNote；桌面回归 61 文件/459 不变，合并门禁 89 文件/575。C-3b（移动 23 写方法+3 钩子+saveState 切换对拍）与 C-3c（conformance 契约化+删旧实现）在 task-18。
- **E2-4 phase C-2a（261029）**：PlatformDataPort 3 钩子（begin/flushWriteBatch、moveStagedBodyFiles、applyCloudDeletedProjection；桌面不实现=旧逐行语义）+ staged 正文契约（importRemoteNote(content=null,{staged})/applyStagedBodyNote/stagedBodies.has）；桌面不变对拍 61 文件/459 passed。**迁移中发现第 4 处真实漂移**：移动 quick 删除是 baseline-aware 三态（已同步/云端已删除→软删+打标；从未同步→物理删）；裁决 **b**：baselineQuickIds 判定下沉 core，桌面回归不变；C-3（task-17）三步收口。**phase C 移动真实 S3 冒烟（C-1/C-2a 构建）**：首传 ↑9 / 1.96s、零变更 ↑0↓0 / 171ms；云端 12 对象，清理后 0。
- **E2-4 phase C-1（261029）**：移动读侧 PlatformDataPort（28 方法：notes/folders/quick_notes/tags/tag_links/deleted_notes）+ createMobileBodyFileDriver（kind 感知伪路径 + stat 缓存）；写侧 22 方法显式 phase C-2 占位（防误切换）；core 用行字段/独立端口承载移动差异（cloudDeleted 投影失效过滤、assetsHash 行兜底、listQuickPurges 与桌面 quickDeletes 口径分离、标签 order 兼容），无 if(platform)；移动 loadState 切 meta.loadState()（旧 ~110 行删除）。**移动真实 S3 冒烟（phase B 构建）**：首传 ↑9 / 3.28s、零变更 ↑0↓0 / 289ms；云端 12 对象，清理后 0。phase C-2（移动 saveState + 3 钩子 + conformance 契约化）在 task-16。
- **E2-4 phase B（261029）**：PlatformDataPort（28 方法，幂等/事务/只读语义写进注释）；core `createDeviceStoreMeta` 收 loadState/saveState/saveFolders/saveQuickNotes 编排（桌面先切）；桌面 `desktopStoreAdapter` 515→187 行（纯装配）、新增 `desktopPlatformPort` 151 行转接；切换前后同一套 electron/s3v3+store 对拍均 455 passed。移动：`capacitorAssetFileDriver` + 8 个资产方法接共享实现（loadState/saveState 留 phase C）。**桌面真实 S3 冒烟（261029）**：隔离 userData + 临时前缀：首传 ↑1 / 1.82s、零变更 1.69s、改 1 篇 ↑1 / 672ms；state.json 确认为 v2 信封（version=2 + assets + hashCache）；云端 5 对象，清理后 0。门禁：tsc 0 / 全量 vitest 502 文件 3144 passed / check:core 132 文件 0 / 两 build / bundle / android-release / diff；桌面 scheme 启动 smoke 通过。phase C（移动 loadState/saveState + conformance 契约化）在 task-15。
- **E2-4 phase A（261029）**：共享 `FileDriver` + `createFileBackedAssetIo`（9 个资产 IO 方法：白名单/tmp 过滤/原子写/删除时机钩子/原生路径可选）+ `mergeSyncMarkers`；桌面 8 个资产方法改 1 行委托（−50 行）；顺带修 `persistSyncMarkers` 信封化后丢标记 bug。门禁：tsc 0 / vitest 501 文件 3140 passed / check:core 131 文件 0 / 两 build / bundle / android-release / diff；桌面 scheme 启动 smoke 通过。phase B（PlatformDataPort + loadState/saveState 编排上收，桌面→移动）在 task-14。

### 261029 · 收口第二批（DT-09/DT-16 + core CORE-05/09/10/13/14 + Del-6/Del-9 + SEC-03 出包 + MOB-04 A/B）· **未提交**
- **版本口径（261029）**：S3 **wire 协议 = v3**（`S3V3_POINTER_VERSION=3`，pointer/索引/声明/对象布局不变）；**同步内核 = v4**（四相 plan→apply→commit→finalize，`s3v3Engine` 已全部委托 `runSyncRound/initialRound/pullRound`）。不存在「S3 协议 v4」；设置「关于」显示 v3 是协议版本，不是内核版本。
- **桌面**：DT-09 顶栏 4→1（App.tsx 单一渲染点 + 槽位 Provider `desktopWorkspaceSlot.tsx`，857→836 行 −21，render 测试 5 例含单渲染点棘轮）；DT-16 生产代码 any **35→0**（lakeRuntime 21 / kernelUiAtoms 9 / lakeTocScrollFollow 3 / aiResultOps 2；全仓 src+electron 生产代码 0）。
- **core**：CORE-05 syncUtils **296→90 行**（manifest v2 常量/解析/校验/wire/mimeTypeFor 全删，全仓含测试 0 命中），「关于」改「同步内核 v4（plan→apply→commit→finalize） · 协议 v3（pointer + 内容寻址索引）」；CORE-09 路径段 + TRASH_NOTEBOOK_ID 单源（含 v4 pullRound 第三处；describeError 判定语义不同、按裁决保留两处）；CORE-10 selectHistoryDrops nowMs 注入 + 新增 `core/randomId.ts`（WebCrypto + 确定性兜底）替代 3 处 Math.random ID；CORE-13 新增 `src/core/search/schema.ts` 单一 DDL 来源（移动 schema + 桌面 schemaInit/quickNotes 全部接线）；CORE-14 新增 `core/syncSettings.ts normalizeSyncSettings`（桌面/移动接入，main.ts interval 判据改 `autoSyncIntervalMs`）。残余：manifestTypes/syncEngineTypes 类型端口（D-7 同批）、core 反向 import ../lib/types 7 文件（下一批）、重试 jitter Math.random（合理保留）。
- **删除/文档（Del-6/Del-9）**：18 份过程文档（S3-V3-* 15 + S3-MANIFEST-SCALE-RESEARCH + S3-GC-DESIGN + S3-REDESIGN）**物理删除**，23 处引用改指 SYNC-PROTOCOL/注明 git 可查（docs/*.md 51→33）；`declared_assets` 桌面建表+读写+测试已删（旧库空表不迁移）；`sync_base` 仍被 v3 `setBaseHash` 写、`hasSyncBase` 兜底、诊断只读 ⇒ **不硬删**，留 E3；`published_at` 仍被 quickNotes 使用。
- **SEC-03（本机 CI 等价证据）**：`gradle assembleRelease` BUILD SUCCESSFUL 2m3s → release APK 34,430,040B sha256 d1eb2b91…470b20b9；`aapt` 无 application-debuggable（xmltree 无 debuggable 属性）、`apksigner` CN=Android Debug、`check-android-release-config --apk` 13/13；`adb install -r` 到 lake_gate 成功启动，`run-as` 返回 package not debuggable。**真实 CI 首跑仍未做**（ubuntu 冷缓存/aliyun 剔除/runner SDK/AGP 自动 debug keystore）。
- **MOB-04（261029：查找接内核 + 虚拟渲染已切换）**：MobileFindBar 改「内核优先」——从编辑器实例取内核 ISearchService（`editor._$commandUnderlay._renderer.getService({value:'ISearchService'})`），`onSearch(q)` 给 `count`/`jumpTo`（与桌面工具栏查找同一逻辑；取不到降级 DOM）。因此编辑态打开内核虚拟渲染（`disableVirtualRendering:false`）+ 真实 `scrollNode`（getter 取 `.mobile-doc-body`）。A/B（lake_gate 500 块/200 图）：编辑节点 **5552→2197**、进编辑墙钟 **5117→2102ms**（TaskDuration 3351→342ms），只读/打开耗时不变；设备复验：查找 **1/300**（内核红/黄高亮）、jumpTo(299) 滚动、编辑态输入真实写入正文、滚动后卡片按需水合（4/4 img）、`edit-surface-invariants.mjs` 全 ok、移动 6 态快照 0 差异。
- **类型收口批（task-11，261029）**：D-7 删 v2 端口类型——`src/core/syncEngineTypes.ts` / `manifestTypes.ts` / `src/mobile/data/syncDbPort.ts`（509 行）/ 批量窗口测试删除，最小活面迁 `src/mobile/data/localStorePort.ts`，死适配器 `createCapacitorS3Store` 删（`s3Store.ts` 201→45 行）；CORE-10 tail——新增 `src/core/sharedTypes.ts`，`src/lib/types.ts` 改 re-export，core 生产 `../lib/types` import = 0，删死 barrel `src/core/types.ts`，`check-core-boundaries.mjs` 白名单收紧。另：**S3Settings 三处定义**（core/syncUtils / lib/types / electron/storeTypes）收口到 core/syncUtils（lib/storeTypes re-export）；**移动 23 屏走查装置修复**（keep-alive 下按可见入口导航、进知识库后开/合文档树抽屉），走查**分轮累计 21/23 屏至少一轮通过**（单轮最多 15/23；`doc-history`/`notebook-icon-sheet` 仍被走查 goHome 关不掉 NoteInfo 浮层卡住，属装置债非产品报错——失败时 App 仍有返回/编辑、无 console error；`quicknote-editor` 1 处 smallTap `.qn-tag-add` 93×28 为既有 nit）。门禁：tsc 0 / 全量 vitest **497 文件 3113 passed（12 skipped）** / check:core 128 文件 0 / 两 build / bundle / diff-check；并行跑 `perf.integration` 偶发 ratio flake（单独跑绿、复跑全量绿）。
- **移动设备复验**：重装 debug APK → pm clear → 重灌 gate 夹具 → 重烤 6 态快照基线 → **0 差异**；MOB-01 返回键关浮层、设置→同步设置「从云端恢复」入口（关闭态 disabled+理由）、cloudState=unconfigured（测试 S3 配置已清）。设置「关于」文案改为「同步内核 v4（plan→apply→commit→finalize） · 协议 v3（pointer + 内容寻址索引）」并经设备核对 + 快照 0 差异。
- **门禁**：tsc 0 / vitest **498 文件 3118 passed（12 skipped）**（较上批减少的 20 例为已删 manifest v2/过期 wire 测试；411 首跑曾 1 例并行 flake，复跑全绿）/ check:core 130 文件 0 / ui-metrics / check:mobileui / 两次 build / check:bundle（preload 23/23、JS gz 72,476、CSS 137,096）/ check:android-release 12 项 / git diff --check。
- **未做/待办**：真实 CI 首跑（SEC-03）；桌面 42 态快照（本机无合成夹具缓存，建议有夹具机器补 1315 态）；安全项已复核裁决不做（SEC-04/06/08/09/11/12 + 13b/13e，功能口径见 `02-security.md` §6）；CORE-10 lib/types 反转、CORE-11、CORE-13 测试夹具手写 DDL（可接受）、E2-4/E3-1；MOB-16 已裁决不做。

### 261028 晚 · 审计收口批（文档对账 / P1 残留 / core / 安全零风险 / 设备验证）· **未提交**
- **文档**：新增 `docs/audit-261027/13-audit-status.md`（84 条逐条状态 + 文件:符号证据，自包含、不依赖 /tmp）；02/03/04/05/10/00 状态表按工作树事实重写；`docs/SYNC-DEVICE-CONTRACT.md` §5 加「261028 对账」列（仍漂移 1 = 移动 `lockedAt` 恒 null；有意保留 4；已对齐 3）。
- **P1 残留**：DT-04 桌面行为护栏 5→7 例（doc 子组件崩溃被 `EditorErrorBoundary` 接住 + 重试重建、capture 注册/注销）；DT-15 标签恢复改 `restoreTabs`（`tabSession.restoreTabSessionForLimit` 最近 N 截断 + 并发 4 + 一次 `setOpenTabs`）；MOB-14 空 catch 销账（当前树 279 catch / 空 80；22 处「忽略」改真实理由、5 处新接 `reportMobileActionError`；台账 `docs/MOBILE-EMPTY-CATCH-LEDGER.md` + `emptyCatchGuard.test.ts` 护栏）；MOB-11 6 组浮层逐处判定「结构/语义不同」→ `docs/MOBILE-SHEET-EXCEPTIONS.md`（另修 MobileAiPage 附件 ActionSheet 缺 pushBackHandler）；SD-06 按契约 §5 销账。
- **core 服务层**：CORE-10-06 桌面注入 native SHA-256（`electron/sha256Native.ts` + main 接线，core 不 import node）；-07 `fileKindOf` 单一来源（`fileCard` 投影 `assetNaming`）；-09 路径段判据单源（`storeUtils.isSafePathSegment` + 两个薄包装）；-10 契约装置移 `src/testing/`（core 非测试 import vitest = 0）+ locale 折叠 `toLowerCase`；-12 删 `mobile/data/quickNotesDbPort.ts`（DDL 内联 schema、逐字节等价）。CORE-10 纯函数其余项（clock/random/`../lib/types` 7 文件）未做，文档标「部分」。
- **安全零风险**：SEC-03 新增 `scripts/check-android-release-config.mjs`（12 项静态断言，挂 CI + `npm run check:android-release`）；**261029 用户裁决「放宽」**：release job 只以 macOS 成功为前提，Android 失败只阻断自己的 APK、不阻断 mac/win 发版（Android job 仍无 continue-on-error、aapt 断言照跑）；SEC-10 AGENTS 补丁面对齐「3 处/两目录」；SEC-13a（`writeQuickAsset` 断言）、13f（资产 Cache-Control `private`）。（真实 CI 首跑/装机未做）
- **设备验证（lake_gate = emulator-5562 / CDP 9336，重装工作树 APK）**：`check:mobilesnap` 6 态重烤基线后 0 差异；MOB-01 返回键关浮层；MOB-06 purge 清 `note-assets/`；「从云端恢复」入口可见（云同步关闭时 disabled+理由）；**真实 S3**（临时前缀 `lakex-notes-leade2e-1793194194`，已清理到 0 对象）：桌面首传 ↑1/5.3s、空跑 859ms；移动新设备首拉 ↓1/2.48s、次轮空跑 754ms（10 条本机独有按裁决进回收站并给 warning）、`restoreFromCloud` ok/793ms；浏览器端用 headless Chrome 真实打开 `127.0.0.1:19880`（`window.lakeNative` shim + 正文渲染）通过。
- **护栏变化（261029 用户已接受）**：移动首屏 preload 预算 21→23（按当前树实测；21 那份早于 `reportMobileActionError`/`nativeErrors`/`toastBus`/`core/textStats` 进入入口图；本批把 `SearchSheet` 改按需加载净 -1）。check:bundle 全绿（preload 23/23、入口 JS gz 72,459/81,920、CSS 137,096/141,312）。
- **门禁**：tsc 0 / vitest **496 文件 3138 passed（12 skipped）** / check:core 127 文件 0 / ui-metrics / check:mobileui / 两次 build / check:bundle / check:android-release / `git diff --check`。未 commit/push；正式数据目录未触。
- **261029 用户裁决**：① preload 预算 21→23 接受；② SEC-03 放宽（Android 失败不阻断 mac/win 发版，已改 `release.yml` + `check-android-release-config.mjs` 断言与 02/13 文档）；③ CORE-10 纯函数残余**下一批做**；④ MOB-18 并入 SEC、不单独跟（02/04/13 已标）；CORE-14 按「删重复类型」收敛（`electron/storeTypes.ts` 现 re-export `src/lib/types.ts` 的 `SyncSettings`，归一函数仍缺列为后续）。
- **仍未做（下一批）**：CORE-10 纯函数残余（clock/random/`../lib/types` 7 文件）、CORE-09 另两份判据、CORE-06 7 处直连 crypto、CORE-11/13、CORE-14 归一函数、DT-09/DT-16、SEC-03 真实 CI 首跑（其余 SEC 已复核不做，见 02 §6）、SD-06 移动 `lockedAt`、Del-6 死列、Del-9 过程文档物理删、E2-4/E3-1。

### 261028 · 审计（A/B/C）+ A 止血批 · **未提交，待用户验收**
> 输入 = 261027 全仓审计；文档在 `docs/audit-261027/`（00 摘要 / 01 产品架构 / 02 安全 / 03 桌面 / 04 移动 / 05 同步 / 06 重设计 / 07 v4 RFC / 08 执行记录 / 09 core 数据模型 / 10 core 服务）。
- **P0 已修（SD-01）**：全量重拉（baseline 丢失/损坏）不再永久删除本地独有文档与历史——**复用「远端 purge」语义**：本机有、云上没有 ⇒ 软删进回收站 + 打「云端已删除·仅本地」标（`cloud_deleted` 投影），正文/附件/历史保留、不参与上传/合并；显式恢复后 local-wins 重新上传。回归 `electron/s3v3/pullAllSafety.test.ts`（含恢复后重传）。**语义变更点**：两台设备首轮各自上传时，输的一方的本地独有数据进本机回收站（不再物理删除、也不自动上传）。
- **A 批其余**：SD-03（可云恢复判据改 v3 事实）、SD-04（purge 墓碑记账）、SD-05（清理失败不再报失败）、SEC-01（AI 改 baseUrl 必须重填 Key）、SEC-02（S3 endpoint 保存前校验）、SEC-03（Android release 变体去 debuggable + CI 去容错）、死面删除（4 模块/TreeRepository/ink 占位/ui-metrics 失效项）、MOB-06（purge 清资产）、MOB-01（返回键关浮层 + useBackHandler 顺序）、DT-01（doc 错误边界）、DT-02（11 处原生 confirm 换 useConfirm）。
- **门禁**：tsc 0 / vitest **448 文件 2824 passed（11 skipped）** / ui-metrics 10-10 / check:core 0 / check:mobileui / git diff --check。**未跑设备门禁**（MOB-01/06 待真机点验）。
- **用户裁决（261028）**：① **浏览器端保留并完善**——桌面端偶尔需要在浏览器里分屏读笔记，**分屏交给浏览器本身**（我们不加深链/多窗口改造）；仅桌面端、移动端不需要；学习思源推进（`11-browser-end-plan.md` 已缩减为 P0 安全收口 / P1 能力+下载 / P2 bundle）。02 D-1 由"建议删"改判"不删"、SEC-07 升 P1。② **移动表格置灰项保留**、后续讨论（表格端优化原计划被 S3-v3 中断）。③ **表格 `ff` 不做换字体、直接收敛成 core 常量**（已实现）。④ **ink undo 走推荐方案**（操作日志+页级快照、全局 undo，实施中）。⑤ 全量重拉的「本机有、云上没有」**放回收站并标「云端已删除·仅本地」，复用远端 purge 逻辑**（已实现）。
- **第二轮（261028 下午，未提交，已完成）**：表格 `ff` canonical 化（`USHEET_CANONICAL_FONT_FAMILY`，桌面删 `lakeFontFamily/applyFontPolicy`、移动端同函数，MOB-05 core 侧闭环）；ink undo 改 patch 语义（页级 InkPatch、全局 undo、每次只整篇序列化一次）；浏览器端 P0（token 不再进静态 JS：HttpOnly cookie + 统一 `isAllowedRequest`；CSP 保持通配，261028 复核撤回收窄）；「本机有、云上没有」改回收站 + cloud_deleted 标（移除未提交的 `archived` 机制，显式恢复后重传）。浏览器端**编辑完整性**：插图/附件（bytes 归一）+ AI 流式（SSE ai:stream + registrar httpSend）已修。门禁：tsc 0 / vitest **450 文件 2847 passed** / ui-metrics / check:core / check:mobileui / diff-check 全绿。
- **第四轮（261028 下午续，未提交）**：多维表 markdown/ai 筛选修复；搜索索引同步落盘带 cache+FTS（打开文档后置触发保留兜底）；FTS 保留字查询修复；删 `quickNoteKeys` 死模块；空跑轮跳过 `saveBaseline`；删 `validParents` 等死代码；9 处浮层改测量式定位；抽 `editorViewport`/纯化 `desktopDerivedState`/统一 Suspense 文案。**安全项暂停**（CSP 通配复核为既有决定，已撤回收窄）。门禁：tsc 0 / vitest 451 文件 2857 passed / ui-metrics / check:core 116 文件 0 / check:mobileui / diff-check。
- **第五轮（261028 晚，未提交）**：移动 MOB-08（启动失败可处置）/MOB-09（附件上限+历史清理真正生效）/MOB-12（标签恢复显式 restore）/MOB-15（移动首屏预算护栏）；桌面 DT-05（小记列表 summary 投影 + `read_quick_note` IPC 136）/DT-08（日志收口）；同步 SD-02（bodyCache 批内生命周期 + 上传分批 flush）。门禁：tsc 0 / vitest 454 文件 2869 passed / ui-metrics / check:core / check:mobileui / 两次 build / 预算 / diff-check。
- **第六轮（261028 深夜，未提交）**：移动 MOB-02（浮层单 owner `useWorkspaceOverlays`）/MOB-11（`MobileSheet` 原语，迁移 2 处）；桌面 DT-12（`useAnchoredMenu`/`InlineRenameInput`）/DT-13（`useAsyncAction`，设置页 6/10）；浏览器 P1（`hostCapabilities` 矩阵 + `GET /download` 白名单下载 + shim 覆盖 5 个 export*）；CORE-02（`core/docBodySafety`，usheet/board 坏正文只读）。门禁：tsc 0 / vitest 463 文件 2936 passed / ui-metrics / check:core 117 文件 0 / check:mobileui / 两次 build / 预算 / diff-check。
- **第七轮（261029 凌晨，未提交）**：`SYNC-PROTOCOL.md` 重写为 v3（过程文档加失效横幅）；同步诊断最近 3 轮落 device_state + 设置页一键复制；小记 purged 90 天窗口；core `docBaseline`「打开=只读」判据（桌面/移动 usheet）；`MAX_DOC_BODY_BYTES` 单一来源；DT-04 jsdom 行为护栏试点；DT-16 类型收口；DT-11 dead-css 工具修复。门禁：tsc 0 / vitest 470 文件 2977 passed / ui-metrics / check:core 120 文件 0 / check:mobileui / 两次 build / 预算 / diff-check。
- **第八轮（261029 凌晨，未提交）**：DT-06 宿主契约/DT-07 `createLakeDocument` 921→330 行（抽 4 个 dispose 模块）；SD-08/12 测试策略门禁化（全量 vitest 47s→24s，定向 perf 9s）；CORE-05/06/08/10；移动 MOB-13/14/17 + MOB-11 再迁移 2 处；ARCHITECTURE/TROUBLESHOOTING 过期描述更新。
- **第九轮（261029 凌晨，未提交）**：移动 MOB-11 再迁 7 处（工作区图标/历史、DocList、Outline、bitable 字段/记录、首页图标）；桌面 board/ink 接 `docBaseline`（打开即关闭/改回原样不写盘）；historyPreview 画板判据统一；DT-13 设置页 10/10 组、DT-08 再收 15 处 console。门禁：tsc 0 / vitest 477 文件 3030 passed（24.7s） / ui-metrics / check:core 120 文件 0 / check:mobileui / diff-check。
- **第十轮（261029 凌晨，未提交）**：SD-06 保守版（`docs/SYNC-DEVICE-CONTRACT.md` 端口/差异矩阵 + conformance 10 场景）；MOB-04 保守版（长文档 DOM 探针脚本 + A/B 计划，未切换虚拟渲染）。门禁：tsc 0 / vitest 477 文件 3042 passed（25.1s） / ui-metrics / check:core / check:mobileui / builds / bundle / perf 门禁 / diff-check。
- **v4 决策（261028 用户拍板）**：① 全量重拉「本机有、云上没有」复用回收站 + 「云端已删除·仅本地」标（不新制备份区；A 批已实现）；② 账本收敛**断代、不做双写**（旧端提示升级；E3 直接收敛删旧字段）。编辑器/小记 lifecycle 已定：共享状态机/意图/判定，不共享存储/历史/保留策略（小记冲突副本两端统一建新副本）；同步台账**不做详细面板**：云图标浮窗放「状态 / 上次同步 / 上传下载细分（文档·目录·小记·字节，用户要求保留）/ 待同步数 / 失败与冲突入口」，其余明细进「设置 → 同步诊断」与日志。v4 尚未开工。
- **第十一轮（261029，未提交）**：删 manifest 时代死代码（12 文件/1443 行 + 就地 ~350 行，净减约 1760 行：syncAdapters/syncAssets/gcDecisions/gcDiagnostics/gcPolicy/core+lib services、syncDecisions 7 legacy、桌面 s3_gc_pending 链路）；移动画板接 `docBaseline`；浏览器 P2 量化后**决定不做**（`docs/BROWSER-BUNDLE-SPLIT.md`）。门禁：tsc 0 / vitest 472 文件 2996 passed（23.1s） / ui-metrics / check:core 115 文件 0 / check:mobileui / 两次 build / bundle / diff-check。
- **第十二轮（261028，未提交）**：同步浮窗收敛（只留状态/上次同步/**上传下载细分（文档/目录/小记/字节，0 也显示）**/待同步数/冲突与跳过计数+入口；明细进设置→同步诊断）；引擎 report 增细分子段并在桌面/移动 UI 消费；移动设置页加一行细分；本地空间卡片去重。门禁：tsc 0 / vitest 473 文件 2999 passed（25.8s） / ui-metrics / check:core 115 文件 0 / check:mobileui / 两次 build / bundle / diff-check。**建议走查**：云图标浮窗（已配置/仅本地/有警告/有冲突四种）、移动设置页同步区。
- **v4 已开工（261028）**：E1-1 协议层 `src/core/s3v3/protocol/`（keys/types/index/pointer + barrel，33 文件 import 更新）+ `plan/types.ts` 契约；E1-2 `src/core/s3v3/plan/plan.ts` 的 `planSync()`（零 IO 决策层，复用 merge；reads/writes/transfers/deletes/publish/intentChanges/warnings/total；零变更 publish=null）+ 9 例单测。未改引擎行为/wire format。E1 已收口（261028）：E1-1 协议层文件归位 · E1-2 纯 planSync（零 IO，复用 planLakeMerge/planQuickNotesMerge）· E1-3 对拍门禁 4 场景通过（零变更/远端更新/本地更新/冲突；pull/PUT/archive/publish 一致；发现并修正「纯拉取轮不重发索引」）。**资产级 transfer 归 Apply、pending 删除归 Commit/Finalize**（分层裁决见 08 §25.1，不进 plan）。**E2-1 已落（261028）**：`src/core/s3v3/apply/applyPlan.ts` —— 只消费 plan 做 IO（归档→声明读取→下载→上传→purge 删除），数据安全五条不变量内建（缺正文不上传、坏字节不落盘、内容地址不错配、收敛不删本地、单对象隔离）；13 例单测 + 与旧引擎副作用对拍 4 场景（PUT/writeBody/archive/publish 一致）。**尚未接进引擎**（旧路径保留，不做磁盘双写）。**E2-1b 已落（261028）**：`SyncPlan.publishes` 补「metadata-only 上传」盲区（正文没变也要走资产/声明）；`apply/applyAssets.ts` 做声明差集 PUT/GET（空目录不写空声明 + 自愈下载、坏字节不落盘、幂等、`deferDownloads`）。两个 applier **都还没接进引擎**。**E2-2 已完成（261028）**：`commit/buildPublishIndex.ts`（纯合成：上传失败回退远端旧条目/远端也没有则移除、`assetsHashes` 覆盖清空、publish=null 短路）+ `commit/commitPlan.ts`（发布锁 → 读回 pointer 校验 → 写索引 → 复核锁 → 写指针 → 读回确认；零变更不碰 S3；只删自己的锁）。**端到端对拍** `commit/pipeline.test.ts`：plan→apply→buildPublishIndex→commitPlan 与旧引擎发布**同一索引 commit / 同 generation / 索引字节一致**。**E2-3 进行中（261028）**：pending 删除执行器 `commit/executePending.ts` 已落（门禁仍复用 `core/s3v3Gate`）；端到端链路补资产段（`planSync→applyPlan→applyAssets→buildPublishIndex→commitPlan`，与引擎的资产键集合/索引字节/`assetsHash` 完全一致），并修掉一处语义分叉（本机无资产时**不写空声明**，与 v3 `uploadAssets` 同口径）。**IntentLog 已落**（`commit/intentLog.ts`：add/bump/clear 三段纯函数，10 例）+ 删除路径端到端对拍（两条链路发布同一「已删」索引 commit、对象消失；**有意差异**：旧索引对象留给 deepCleanup，引擎则是 pending 立即删）。**剩余**：引擎切四相（E2-3 主体，动生产路径）+ E2-4 单一 DeviceStore。新模块（applyPlan/applyAssets/buildPublishIndex/commitPlan/executePending）**都还没接线**。台账 UI 已定为"不做详细面板"。
- **P1 修复（261028 晚，未提交）**：并发发布锁不再当同步失败——引擎 `publishLockWaitMs`（默认 10s，只在锁被别端持有时等）+ `lock-busy` 20s 内抖动退避重试，仍失败才抛；新增 `src/core/s3v3LockContention.test.ts`（6 端并发无失败/长期占锁有界失败/短占用自动等到/外层退避后成功）。同步错误分类跨 IPC 透传（`syncCode/syncClass` + 广播 `errorCode/errorClass`）：手动同步可重试 ⇒ 2.5s 后自动重试一次、不弹硬失败；`epoch-mismatch` ⇒ 「云端是另一套数据」+ 直达 设置→同步→「从云端恢复」按钮（自动同步走状态栏 notice）；移动端只加可操作后缀（无恢复入口）。门禁：tsc 0 / vitest **491 文件 3110 passed（11 skipped）** / check:core 0 / ui-metrics / check:mobileui / 两次 build / bundle / diff-check（`perf.integration` 并行 flake 单独跑与 STRICT 均过）。同日按用户裁决：① 空基线+非空云端**保持默认逻辑不做**（本地独有进回收站 + 「云端已删除 · 仅本地」）；② 「按需下载附件」移动端新设备默认开、桌面默认关（两端现状即符合，未改代码）；③ 移动端补「从云端恢复（换机/坏库）」（清本机 v3 账本 → 整轮只拉不打；不隔离整库/不重启/不删附件；`syncDomain.restoreFromCloud` + 设置页入口 + 契约，core 仅 WRITE_OPS 加 1 行）。详见 `docs/audit-261027/12-v4-test-report.md` §7。
- **未做/延后（均需用户或 v4 前置）**：移动表格置灰 10 项（保留待议）；MOB-04 切换虚拟渲染（需设备实测）；MOB-16（产品口径待裁决）；DT-09（顶栏 4→1，需快照重烤）；SD-06 彻底统一（v4 E4）。
- **B/C**：v4 RFC（`07`）待评审 §13；core 补审（`09/10`）新发现筛选恒真、搜索索引过期、FTS 保留字报错、坏正文策略分叉（建议排在 v4 M0 前修）。

### 261027 · S3 v3 转正 + 回归演练 + 打包修复

> 本批是 S3 v3 的收尾：`fix/s3v3-perf` 合并进 `master` 并推送；旧协议留在 `backup/master-pre-s3v3-261027`（b8f67c33）。备份分支相对 master 没有任何独立提交（master..backup=0），其唯一「master 侧」提交 b8f67c33 的 4 个文件改动已核对：PRIVATE-REPO.md / export-public.mjs 删除与 package.json 的 export:public 移除都保留了；.gitignore 两行说明被分支带 vendored 内核的写法有意替代（私有仓现状，非丢失）。

- **合并**：`750d24de merge: S3 v3 转正（fix/s3v3-perf → master）`（--no-ff、无冲突；846 文件 +579,184/−12,464）；跟进提交 `99c6d052`（移动 UI 硬指标归零）、`ae3556c5`（移动快照基线重烤）、`08345db5`（桌面快照基线重烤）。master 已 fast-forward 推送 `1486b4d4..08345db5`；`fix/s3v3-p1/prod/parity/rem/perf` 5 个分支已推送；tags 无变化。
- **v3 能力（已上线）**：pointer + 内容寻址索引/声明/正文/资产、无墓碑永久删除零痕迹；首拉按需资产（`deferAssets` 新设备默认开并固化）+ 打开/占位点击按需补拉（原生 `getToFile`，文档/小记同一条通道）；附件上传全量原生化（原生 size/hash + 全部 `putFromFile`，含小记空间；孤儿登记改 `statLocal` 不再读整份附件）；待补资产账本（失败附件下轮自动重试、双端持久化、3 次丢弃）；conformance 10 个语义场景（双端各 21 个 it）+ 桌面×移动混合并发 3 场景 + 弱网矩阵；断点续传、staging 正文（移动真机增量 OOM 修复）、数据库级串行锁、首轮并发首传 pointer 竞态自动重试、恢复原父已删回落兜底笔记本（移动补平桌面）、同步导入小记当场回填列表元数据。
- **回归门禁（合并后 master）**：vitest 434 文件/2747 例、tsc 0、`check:core` 0 违规、`check:bundle` 预算内、`check:mobileui` 0 超基线、移动整页快照 6 态 0 差异、桌面整页快照 34 个稳定态 0 差异（8 个窄窗态由脚本标记 UNSTABLE 跳过）、桌面 `vite build` ✓、Android APK ✓、`node scripts/e2e-packaged-smoke.mjs` ✓。
- **端到端**：模拟器 vis-r1 全新安装按需首拉 600 篇 **9.7s**（0 附件目录、`deferAssets=true` 固化）；quick-r1 小记 2.0s + 占位点击 **258ms** 原生补齐；真机 50950385 增量同步 **3.2s**（↑0 ↓0）、读文档 771ms。
- **打包纪律（261027 实锤）**：从**软链 node_modules 的 worktree** 跑 electron-builder 时 sharp 的平台包 `@img/*` 会被漏掉（asar 内 @img 条目 0）⇒ 打包版主进程启动即崩「Could not load the 'sharp' module using the darwin-arm64 runtime」。**不是 OOM**（渲染进程 `--max-old-space-size=4096`）。打包必须用**真实 node_modules**（`npm ci` 的克隆/CI；不要在 symlink worktree 里出包），出包后自检 `app.asar.unpacked/node_modules/@img` 存在；详见 `docs/RELEASE.md` 的「打包自检」。
- **测试数据清理**：vis-r1 桶的 `vis-0591` 曾被上传基准测试写入 4×25MB `*.bin`（声明 100MB）——已重写 declaration/index/pointer（generation 9）移除并删对象；「首拉后首开文档 18s」就是这些大文件下载，不是产品回归（干净数据 171ms/67ms，已复测确认）。
- **已知未做（非阻塞）**：超大文件 MPU/分片上传（用户决定不做，笔记本挂大附件是低频场景）；桌面快照 settings 态动态值抖动（CI 建议按 README 双实例自证）；旧 index 对象留待深度清理。
- **CI**：已加 `.github/workflows/packaged-smoke.yml`（PR/push master/手动）+ release 工作流出包后 smoke 门禁；本地等价 `bash scripts/ci-packaged-smoke.sh`（含真实 node_modules 检查、@img 自检、packaged smoke；本机实测通过）。
- **下一步**：① DMG/签名/公证按 `docs/RELEASE.md`（用户决定暂不做签名/公证）；② 发布前复跑设备冒烟（vis-r1 / quick-r1 测试桶可用，避开被污染的 vis-0591 说明）。
### 261026 · S3 v3 首拉性能 + 进度 UI（分支 `fix/s3v3-perf`，基于 `7f329011`）

> 输入 = 真机首拉 39 分钟（资产 26min + 应用 13min）+ `SIYUAN-SYNC-BORROW.md`。目标：1.6GB 首拉 5–10 分钟、文档先出来、进度可见。分两笔提交（`3c67360d` + 本笔）。

- **P0-1 全局下载流水线**：新增 core `s3v3Transfer.runTransferPipeline`（对象级任务、失败隔离、完成即回调）；正文/声明/资产统一进同一调度器（`downloadConcurrency` 默认 20，可配），删掉「按篇 runPool + 逐篇 barrier」；增量同步先并发预取正文/声明再应用，资产登记后统一 flush。
- **P0-2 文档先出来**：`pullAll` 正文按 100 篇分块下载并**分块 saveState**（文档/目录先可打开），小记等图片就绪再落库，资产在应用之后跑；适配器对「正文未到」的新条目先跳过建行。
- **P0-3 桌面资产下载即落盘**：`DesktopStoreDevice.writeAsset` 直接写 `noteAssetsPathFor`（不依赖 DB 行、不再内存 stage 整轮 1.7GB），`importRemoteNote` 传空 assets（文件已就位）。
- **P0-4 移动原生资产直传**：`S3v3Remote` 增可选 `getToFile/putFromFile`、`S3v3DeviceStore` 增可选 `assetNativePath`；引擎资产下载/上传优先走原生（移动端 `NativeAssetSync.getFile/putFile`，字节不过 JS/Capacitor 桥、原生做 size+sha256 校验），仅 Lake 资产（`assets/`）生效，小记/桌面自动回退字节路径。
- **P0-5 移动派生索引延后（部分）**：`bridge.syncNow` 不再 `await reconcileIndex`，改为去抖后台重建（失败只影响搜索）；正文/行仍按批落库。**未做**：createNote 的 text_cache 逐篇计算仍在 apply 路径（需再拆「行快速写入 + text_cache 后台回填」）。
- **P0-6 进度事件 + UI**：引擎 `onProgress({phase,done,total,bytesDone,bytesTotal})`（metadata/bodies/apply/declarations/assets/finalize）；移动 `syncProgressStore` 节流（≥250ms 或 ≥1%）转发；设置页同步卡显示「阶段 + 已/总 + 字节」，首页云同步按钮的 title/aria-label 同步显示（不改 5 槽构图）。桌面引擎进度已可用，UI 接线下一步（SyncStatusPopover）。
- **测试**：`perfPipeline.test.ts`（并发峰值 12–20、进度到齐、正文落库早于资产写盘、桌面资产立即写盘）、`nativeAssetTransfer.test.ts`（原生下载/上传不产生资产字节 GET/PUT；unsupported 回退）、`syncProgressStore.test.ts`（节流/文案）。既有契约测试全过：零变更只读 pointer、改 5 篇资产 GET=0、缺正文/删除/恢复/小记单条推送。
- **门禁**：tsc 0；定向 vitest 51 文件 188 passed/8 skipped（`mobileCloudDeleted` 2 例为 HEAD 既有失败）；桌面+移动 `vite build` ✓；`git diff --check` ✓。
- **未做/待真机**：真机首拉复测（预期资产 13→40–80 文件/s、正文应用不再串行、文档先可打开）；移动应用批量化（text_cache 延后回填）；移动首页可见进度条（当前仅 title + 设置卡）；按需资产（首拉不搬媒体）仍列为下一步 P1。

### 261026 · S3 v3 遗留收尾（分支 `fix/s3v3-rem`，基于 `f3c3585f`）

> 输入 = PARITY 审计剩余 P1/P2 + 上一批 HANDOFF「仍缺」。本批 6 项，全部带回归；不改协议布局。

- **移动端云清理改 v3 原生（item 1）**：`runMobileV3DeepCleanup` 走 pointer→索引/声明→keep 集→引擎 `deepCleanup`（保留窗口默认 7 天 + `historyRepository.historyAssetRefs` 历史引用保护），bridge `gcDeepCleanup` 写 `s3_gc_log`。原实现读 v3 永不写的 `manifests/latest.json` ⇒ 清理按钮恒 0。回归 `src/mobile/v3/remParity.test.ts`。
- **恢复标记轻量落盘（item 2）**：无发布轮本来就会 `saveState`（补注释防回退）；新增可选端口 `persistSyncMarkers`——单条小记推送等「不走整轮 saveState」的路径把清除后的 `remotePurged/restorePending` 落盘并同步 DB `cloud_deleted` 投影（桌面 sidecar/移动 v3_state/FileDeviceStore 三端实现）。回归 `electron/s3v3/markerPersist.test.ts`、`quickPushSingle.test.ts`、`src/mobile/v3/remParity.test.ts`。
- **元数据兜底 C4/C5**：`planLakeMerge` 增 `isRemoteDescendant` 环检测（文档/目录：本地父在远端树中位于本节点之下 ⇒ 跟随远端断开，即使本地 updatedAt 更新）；引擎建 `validParents` 乐观集合传给合并；桌面/移动适配器把**非法/缺失远端 parent 回落兜底笔记本**（懒建「未分类」），且同轮 `deleteMissing` 不删这些兜底目录。移动端 `saveState` 顺序改为**目录先于文档**落库。回归 `remFolderParent.test.ts`、`s3v3Core.test.ts`（C4 两例）、`remParity.test.ts`（C5）。
- **目录恢复传播 D4**：`l && !r` 时若本地目录在本轮被恢复/编辑过（`updatedAt > base.updatedAt` 且不在回收站）⇒ 按 `upload` 重新发布（远端缺席让位）；配套「目录删除意图让位」——远端同 id 目录重新出现且更新时间不早于本机 purge 时间 ⇒ 删除意图本轮失效，否则 A 会每轮把 B 恢复的目录再删掉。双端回归 `remFolderParent.test.ts`（A purge → B 恢复 → A 拉回为活跃目录）。
- **移动端小记冲突副本 C8**：`MobileDeviceStore.archiveQuickNote` 实现（新 id、正文/图片复制、标签关系复制、`ready_to_sync=0` 纯本地墓碑、归档后清旧图片目录）；双端同改时移动端也能在 quick 回收站找回本地版本。回归 `remParity.test.ts`。
- **移动端结构化同步回执（item 6）**：`runMobileV3Sync` 支持 `onPhase` 回调；`MobileSyncResult` 增 `warnings/supersededNotes/progress`；设置页同步区新增「N 篇被云端版本覆盖（已留历史）」列表，并修正原先只读 `result.notes?.warnings`（v3 下恒空）的取数。
- **门禁（本分支）**：tsc 0 · 定向 vitest（`electron/s3v3` + `src/core/s3v3` + `src/mobile/v3` + settings/ipc 相关 = 48 文件 / 177 passed / 8 skipped；`mobileCloudDeleted.test.ts` 2 例为 **HEAD 既有失败**）· 桌面 + 移动 `vite build` ✓ · `git diff --check` ✓。

### 261026 · S3 v3 parity 补齐（分支 `fix/s3v3-parity`，基于 `5c88da5b`）

> 输入 = 旧新逐项审计 `/tmp/lake-ab/deliverables/PARITY-OLD-VS-V3.md` 的剩余 P0/P1。本批补 5 项 + 桌面端 1 项可选能力，不改协议布局、不做数据迁移，全部带 vitest 回归。

- **B6 回收站附件惰性补拉（v3 原生）**：新增 `src/core/s3v3AssetBackfill.ts`：pointer → 对应空间索引 → 该条 `assetsHash` → 声明对象（校验 declHash）→ 本地 size+sha256 差集 → 只对缺失/损坏者 GET 并按 size+sha256 校验落盘（`force` 供恢复强拉）。桌面 `ensureTrashNoteAssets` 改走它（不再读 v3 从不写的 `declared_assets`）；移动 `downloadDeclaredAssetsFor` 同步改走 v3（`createMobileS3v3Remote` + assetFs 端口）。回归 `trashAssetBackfill.test.ts`（删本地附件后补拉成功）、`s3v3AssetBackfill.test.ts`（跳过/补下/校验失败/无 pointer/声明被篡改）。
- **F3/F4 深度清理保护**：`deepCleanup` 增 `extraKeep` / `retentionDays`（默认 7 天；<=0 = 立即到期）/ `now`，并新增「每空间保留最近一个未引用索引（上一版）」；provider 不返回 `lastModified` 时保守保留；`runV3DeepCleanup` 注入本机历史引用（`store.listNoteIdsWithHistory/getProtectedRefs`）与 `getS3GcSettings().gcRetentionDays`。回归 `deepCleanupWindow.test.ts`（历史引用不删、窗口内不删、窗口外删、上一版索引保留、dryRun 不删、retentionDays=0 语义）。
- **E2 小记单条推送**：引擎新增 `pushQuickNote`（读 pointer/quick 索引 → 只替换该条 → 上传正文/图片 → 取锁 → CAS 复核 pointer → 写索引 → 写 pointer（lake commit 不动，generation+1）→ 读回校验 → `markQuickNoteSynced` + baseline）。桌面 `sync_quick_note` 与移动 `bridge.pushSingleQuickNote` 改走它；两条退回整轮路径保留且显式返回 `full-sync`（no-cloud / no-baseline / cloud-changed / remote-deleted）。回归 `quickPushSingle.test.ts`（其余条目/标签逐字节不变、lake 不动、重复推送 unchanged、三类 fallback）。
- **F1 移动端历史快照**：`mobileDeviceStore.writeHistory` 接 `historyRepository.createHistorySnapshot`（Lake 文档，保护 30 天；小记按产品定稿返回 `quick-note-history-skip`），`archiveBody` 同步生效。回归 `historySnapshot.test.ts`。
- **C8 小记冲突副本（桌面）**：`S3v3DeviceStore` 增可选 `archiveQuickNote`；引擎在「双端同改、远端胜出」时先把本地版本归档进小记回收站（`QuickNotesStore.archiveLocalToTrash`：新 id、纯本地、恢复后是一条新小记），不再依赖对小记无实际作用的 `createHistorySnapshot`。移动端未实现该端口（产品定稿：小记不留副本）。
- **门禁（本分支）**：tsc 0 · 定向 vitest（`electron/s3v3` + `src/core/s3v3` + `src/mobile/v3` + 相关 core/ipc = 43 文件 / 198 passed / 8 skipped）· `mobileCloudDeleted.test.ts` 2 例为**既有失败**（HEAD 同样红，非本批引入）· 桌面 + 移动 `vite build` ✓ · `git diff --check` ✓。

### 261026 · S3 v3 生产化修复（分支 `fix/s3v3-prod`，基于 `fix/s3v3-p1` 1287d2af）

> 输入 = 真实用户 A/B 实测（`/tmp/lake-ab/deliverables/AB-REPORT-V3-REAL-USER.md`）+ 旧新逐项对照审计（`/tmp/lake-ab/deliverables/PARITY-OLD-VS-V3.md`）。本批只做 P0/高价值缺口，全部有 vitest 回归。

- **P0 资产下载差集（R1）**：`downloadAssets/downloadQuickAssets` 先扫本地（`listAssets`+`readAsset`，size+sha256 精确匹配）⇒ 跳过 GET。以前改 5 篇长文会让对端重下该篇全部图片（50 轮下行 5.06MB/轮、≈上行 3×）。回归 `assetDownloadDiff.test.ts`（正文/元数据变更 ⇒ 0 资产 GET；本地缺一张只补那一张）。
- **P0 声明对象跨轮缓存（P0-1 残余）**：资产声明是不可变内容寻址对象 ⇒ 引擎改用模块级 `DECL_CACHE`（上限 2000），桌面每轮新引擎也能复用；元数据漂移轮不再逐篇重复 GET 声明。
- **P0 gzip 魔数误判（R2）**：端口改为**按 key** 解压（仅 `meta/`、`quick-notes/meta/`）；正文/附件即使以 `1f8b` 开头也原样返回（修复 .gz/.tgz 类附件 `Z_DATA_ERROR`）。桌面 `s3Remote.ts` 抽出 `decodeRemoteObject` 便于单测；移动 `s3v3Remote.ts` 同步改。旧协议存在同 bug，不记为 v3 回归。
- **P0 缺正文闭环（R3）**：① 适配器 hash 缓存文件缺失即失效（原先"云端已拉回却不落盘"）；② 正文文件缺失时 `saveState` 走 `importRemoteNote` 重建（普通 `saveNote` 会以"笔记不存在"拒绝）；③ 下载分支：本地/云端都缺 ⇒ `local_body_missing`（且**保留远端索引条目**，避免一次对象缺失变永久删除）；本地缺失但云端有 ⇒ 拉回 + `local_body_restored`；④ 上传分支：缺正文先从云端按 hash 拉回，失败则 `failUpload` 回退索引，**绝不上传空正文**；⑤ 初始化上传剔除缺正文条目。新增结构化 `warningDetails: SyncWarning[]` 并透传 `SyncResult.warnings`（UI `SyncStatusPopover` 可见）；移动端 `MobileSyncResult.warnings` 同步透传。回归 `missingBody.test.ts` / `parity.test.ts`。
- **P0 资源页「缺正文 → 从云端拉回」（B5）**：`restoreMissingBodyFromCloud` 原实现读旧 `manifests/latest.json`（v3 永不写 ⇒ 永远 not-in-cloud）。改为读 v3 pointer→lake 索引→内容寻址正文并校验 sha256；支持注入 remote 供测试。回归 `parity.test.ts`（成功/hash 不符/条目不存在）。
- **P1 崩溃追赶放大（R4，根因已定位）**：真实故障 = kill -9 落在 initialUpload「pointer 已写、baseline 未写」窗口 ⇒ 重启走 `pullAll`；旧实现无条件 GET 全部正文+附件（实测 B 一轮 22,115 GET/1.37GB/423s）。**数据侧**修复：`pullAll` 对 state 里已有的条目按 contentHash 复用本地正文；资产走差集（声明仍读、字节不重下）。根因二：崩溃重发布使大批条目元数据漂移 ⇒ 每篇 `applyRemote` 触发整篇资产刷新（40,152 次 asset GET、只有 8 次正文）⇒ 由资产差集 + 声明缓存消掉。回归 `pullAllDiff.test.ts`（删 baseline 模拟崩溃：整轮 0 正文/资产 GET）。
- **对齐旧协议的缺失行为（本批已补）**：编辑锁字段级 LWW（锁变更不 bump updatedAt，原先跨端不传播；`s3v3Merge` + 双端 e2e 回归）；元数据变更不再重传同 hash 正文；同步进度阶段（`load-state/read-index/downloads/uploads/publish-*/pending` → SyncProgress download/upload/manifest，首拉不再只有 connect→done）；冲突留档回执（`S3v3SyncReport.supersededNotes` → `SyncResult.conflicts/supersededNotes`，UI 冲突清单恢复）。
- **后续批次已补（见下方 `fix/s3v3-parity`）**：B6 回收站附件惰性补拉、F3/F4 深度清理 history 引用/上一版索引/年龄窗口、E2 小记单条推送、F1 移动端历史快照、C8 小记冲突副本（桌面）。
- **后续已补（见上方 `fix/s3v3-rem`）**：移动端云清理 v3 原生（item 1）、恢复标记轻量落盘（item 2）、C4/C5 环检测与父目录兜底、D4 目录恢复传播（含目录删除意图让位）、移动端小记冲突副本（C8）、移动端结构化回执（warnings/superseded/progress）。
- **仍缺（PARITY 审计，待排期）**：① 小记/ Lake 墓碑不携带删除前内容（D2/D3/E4，产品语义待确认）；② 移动端 qnotes 缺正文恢复入口未接 v3；③ 移动端云清理无 UI 入口（IPC 具备，设置页未接按钮）；④ 目录恢复后 tombstone 清理（每轮靠意图让位，`deleted_notes` 行保留）；⑤ PARITY 其余 P2（GC 待回收表/诊断、状态栏字节/目录计数等）。
- **门禁**：tsc 0 · 定向 vitest（s3v3/移动 v3/相关 core）通过（`mobileCloudDeleted.test.ts` 2 例为**既有失败**，HEAD 同样红，非本批引入）· 桌面+移动 `vite build` ✓ · `git diff --check` ✓。

### 261026 · S3 v3 P1 修复 + 口径定稿（分支 `fix/s3v3-p1`，基于 `feat/s3-v3` ba8f185c）

- **P1 v3 空发布抖动（已修 + 回归）**：根因 = 桌面 v3 适配器把合并结果写回 Store 时只落正文/部分几何字段，**远端/合并结果里的 `updatedAt` 没落库**（正文未变时完全不写；改走 `saveNote/moveTreeNode/setNodeIcon` 时又被改成 now()）。而 v3 三方合并用 `updatedAt` 判断「本地元数据是否更新」⇒ 两端各持不同旧时间戳，隔轮互相判定"元数据更新"，索引在 A/B 两个 hash 间翻转、每轮 +1 generation（实测 g10→g11，published=true、uploaded/downloaded=0；零变更从只读 200B pointer 退化为拉整份索引）。修复：`DesktopStoreDevice.saveState` 对已存在条目把合并结果元数据原样落库（`applyRemoteNoteMeta` + 新增 `Store.applyRemoteFolderMeta`；正文下载后同样回写远端 `updatedAt`）；并把引擎回收站常量从 `"trash"` 改为真实 `notebook-trash`（否则回收站条目父节点写坏）。回归：`electron/s3v3/idlePublishRegression.test.ts`（两端空闲 5 轮 + 增量后回闲：published=false、零传输/零写、只读 pointer ≤1KB）。
- **并发上限定稿 12（用户 261026 批准）**：代码原本已默认 12（`DEFAULT_TRANSFER_CONCURRENCY` / `deleteMany`）；本次统一文档口径（AGENTS §3#13；过程文档 S3-REDESIGN/S3-V3-* 已删，git 可查）。
- **死代码清理**：删除 `src/core/syncEngine.ts`、`quickNotesSyncEngine.ts`、`quickNotePush.ts`、`syncPerf.ts` 与只测它们的旧测试/AB 对比测试；仍被 type-only 引用的形状集中到 `src/core/quickNoteSyncTypes.ts`（无运行时逻辑，勿复活旧通道）。
- **迁移策略定稿 = 不迁移**：`electron/s3v3/migrate.ts` 与迁移测试已删；S3-REDESIGN §8（过程文档已删）改写为「首开 v3 从本地真相全量上传 / 旧 manifest 不读不删留孤儿 / 回滚 = 换回旧版本客户端」。升级与回滚路径见 `docs/SYNC-PROTOCOL.md`（原 S3-V3-CUTOVER §2/§3，git 可查）。
- **移动端首拉 profile（只诊断，未改行为）**：移动端 v3 复用同一引擎 ⇒ 并发上限 12 生效；传输走 `CapacitorHttpHandler` → Capacitor 原生 `Executors.newCachedThreadPool()`（无信号量/无串行化），12 个请求可同时在飞；但每请求 body/响应要 base64 过桥 + JS 主线程编解码（大对象是 CPU/内存瓶颈），底层 HttpURLConnection 无连接池调优。**未做低风险改动**；首拉还受 `MobileDeviceStore.loadState` 全表映射与启动 DDL 影响。
- **仍存风险**：① 移动端适配器仍不落「仅 `updatedAt` 变化」的元数据（标题/父/排序/正文路径会写；图标/锁/排序分支不写 `updated_at`）且 `lockedAt` 恒为 null ⇒ 桌面↔移动混合使用仍可能偶发一轮元数据抖动（真机验证后在移动端做同构修复）；② **真实 Android 物理机未验收**（触摸/返回/键盘/后台/schema 迁移）；③ **大库阈值未在真实设备探测**（>2 万文档、索引 3~5MB gzip 时首拉/增量耗时；v3.1 按篇增量索引是下一档）。
- **门禁（本分支）**：tsc 0 · 定向 vitest（s3v3 引擎/适配器/回归 + 移动 v3 + 相关守卫）147 passed / 2 failed（`src/mobile/v3/mobileCloudDeleted.test.ts` 两例在 **HEAD ba8f185c 上同样失败**，非本批引入）· 桌面 + 移动 `vite build` ✓ · `git diff --check` ✓。按 lead 指令本机并发压测期间未重跑全库。

### 261026 · S3 v3 转正 + 旧同步字段删除（分支 `feat/s3-v3`，未合并 master）

- **默认 v3**：桌面文档/小记、移动端全部默认走 v3；旧 legacy 同步入口、旧 quick-notes 单条推送/云端恢复、旧 GC/旧 quick-notes 同步模块与对应测试已删除。移动端不再有 `syncProtocol=legacy`。
- **旧字段彻底删除（无历史数据回填）**：
  - 桌面 `notes.sync_state` / `tree_nodes.sync_state` / `quick_notes.sync_state` 列已删，统一 `is_dirty` / `is_purged`；`listNotesForSync` 的 `syncState` 由新字段派生（旧同步账本只读派生值）。
  - 移动端 schema **v8**：同样删 `sync_state`，加 `is_dirty/is_purged`；迁移先删旧列（`DROP COLUMN`，失败可选跳过），**不迁移旧值**。后续 261026 徽标追加升 **v9**（`cloud_deleted` + quick_note_deleted.purged_at）。
  - UI/DTO/NoteInfo/文档状态模型已去掉 `syncState`；`is_dirty` 只在 v3 发布成功写 baseline 后清零。
- **「云端已删除 · 仅本地」徽标（261026 追加）**：远端彻底删除后本地回收站副本只打标、不改恢复语义；桌面/移动回收站文档与小记均显示；恢复并重新上传成功后自动清标。移动端远端删除小记改为保留 quick 回收站只读副本（原先物理删），并修复 quick `restorePending` 优先于 purge 墓碑，恢复可重传；本地 purge 后标记清除且多轮同步零 put/delete。
- **门禁**：tsc 0 · vitest **2717 passed / 24 skipped**（移动端 528）· 桌面 + 移动 `vite build` ✓· 真实七牛 v3 集成测试 ✓ · 真实七牛压测 200 文档 × 10 附件 ✓。
- **真实设备/双端验收（261026，模拟器 + 桌面隔离数据 + 真实七牛）**：移动端新建知识库/文档/小记、编辑、重命名、表情图标、删除、同步；桌面拉取与回传；创建/重命名/排序/图标/软删/彻底删除/小记删除均跑通。压测：200 文档 × 10 附件 = 2391 对象，首传 13.3s、对端全量 25.2s、增量 0.65s、purge 0.82s。
- **验收中发现并修复（`4850ed9f` / `dcf44e6f`）**：
  - 桌面 v3 首拉顺序错误：先建文档后建目录 ⇒ 新父目录缺失直接报错；改为先 upsert 目录（保留远端 id）再落文档，目录删除放文档之后。
  - 桌面首拉丢失远端文档图标；改为首次创建后应用 icon（新文档统一走 `importRemoteNote`，支持远端 trashed/deletedFromParentId）。
  - 移动端 `saveBaseline` 从不清 `is_dirty` ⇒ 同步后 UI 永远“待同步”；改为发布成功批量清 notes/folders/quick_notes 并清 restore_pending；远端正文落地保留远端 updatedAt（避免下一轮误判本地更新）。
  - 桌面本地 purge 未生成 v3 删除意图 ⇒ 远端条目被重新拉回；改为从 `deleted_notes.purged_at` 派生 intents（适配器载入时补齐）。
  - 移动端同步后阅读态标题/正文不刷新；首页小记/目录不刷新。改为 sync 后强制重读活动标签 + 刷新首页快照。
- **已定稿（用户 261026）**：远端彻底删除时本地副本保留在回收站、只打「云端已删除 · 仅本地」徽标，允许恢复；恢复重新上传成功后徽标消失；本地主动彻底删除后不再产生任何 S3 行为。**目录（folder）不做该语义**（用户决定）。
- **删除语义定稿（261026 二轮确认）**：回收站 = 软删除（移动到「回收站」笔记本，**不是墓碑**，正文/附件保留、不写墓碑）；墓碑 = 彻底删除后云端索引缺席，曾持有端保留「云端已删除·仅本地」只读可恢复副本、不参与 S3（除显式恢复）；从未持有过的新设备无法恢复已 purge 文档（用户接受）；回收站自动过期默认 **90 天**（原 60，trashAutoPurgeDays），cloud_deleted 副本不豁免。
- **分支状态**：feat/s3-v3 已推送到 origin，**未合并 master**；用户将自行测试。提交：15411bb3（徽标/小记保留/恢复）、a2d7e684（小记删除方跟随恢复）。
- **剩余待办**：
  1. **真实 Android 物理机验收**（目前只有模拟器；触摸、系统返回、键盘、后台切换、真机 schema v8→v9 迁移）。
  2. **目录 folder 的云端删除语义**：当前按用户决定不做；若以后要做，需要 core 侧保留 folder 副本 + 徽标 + 恢复链路。
  3. **状态栏 cloud-deleted 专属配色**：DesktopStatusBar 已有文案/图标，但 styles/chrome.css 还没有该 kind 的 pending/橙色样式（可选）。
  4. **v3 标签独立空间 / 文档标签 UI**：小记标签已同步，文档标签仍未做。
  5. **合并 master 前复核**：双端构建、门禁、真实 S3 回归、HANDOFF 收口；合并时不要带测试前缀/临时凭据（已清理）。
  6. **大库阈值探测**：>2 万文档 / 索引 3~5MB gzip 时首拉与增量实机耗时（当前只有合成数据；v3.1 按篇增量索引是下一档）。
  7. **移动端同构 metadata 对齐**：桌面 P1 修复后，移动适配器仍可能因不落 `updatedAt`/`lockedAt` 产生一轮抖动；真机验证后按 `DesktopStoreDevice.saveState` 同一口径修。
- 报告：原 docs/S3-V3-REMOVAL-PLAN.md / docs/S3-V3-CUTOVER.md（过程文档已删，git 可查）。

### 261025 · S3 墓碑保留调研（仅文档，未改代码）

- **调研 SiYuan/dejavu**：Git-like 仓库（objects/indexes/refs）+ `refs/latest-sync` 三方合并 + 云端锁 + 有界 purge；删除 = 新 Index 中缺席，没有墓碑字段。
- **本项目现状**：单文件 Manifest + 永久墓碑 + 墓碑内容进 GC keep 集 + Manifest 无 CAS/云端锁；删除传播可靠，但墓碑元数据与删除前正文/图片没有退出机制（`pruneTombstones` 生产未调用）。
- **完整对照、差异表与推荐方案**（P0 墓碑 payload 老化 / P1 Manifest 条件写或云端锁 / P2 last-sync 快照 + 三方合并）见 `docs/SYNC-PROTOCOL.md` §13/§14（原 S3-GC-DESIGN §7 已删，git 可查）。
- **决策**：用户 261025 定“后续优化”，本批不改同步协议；P0 落地前现行红线不变（purge 必须写墓碑、墓碑永久保留）。
- **v3 实现（分支 `feat/s3-v3`，未合并）**：协议内核 + 运行时 + 旧清单迁移 + 假 S3/真实七牛/大规模测试已完成；**尚未接入 Electron/移动端、未复用 8 并发池、未做设备级 e2e**。报告：原 `docs/S3-V3-IMPLEMENTATION-REPORT.md`（过程文档已删，git 可查）。
- **S3 重设计方案（草案，261025，仅文档；过程文档已删，git 可查）**：原 `docs/S3-REDESIGN.md` —— 目标 2 万文档/20 万附件；云端只存当前状态（无墓碑/无提交链/无全局资产清单）+ 设备本地基线 + 锁 + epoch；**永久删除当轮清空、零痕迹**；含迁移与验收计划。
- **清单规模与分片调研（261025，仅文档）**：清单体积实测（10 万文档/100 万附件 = 170MB 明文 / 71MB gzip；20MB 断点 5.76 万篇或 1.24 万篇）、字段去留矩阵、三项零风险结构项、墓碑退役最小充分条件（锁 + epoch + 缺席语义翻面 + 主动删条目）见原 `docs/S3-MANIFEST-SCALE-RESEARCH.md`（过程文档已删，git 可查）。

### 261024 · 小记标签子系统（方案 B：目录 + 关联表）+ 快捷筛选 · **已提交 `d7a589da` / `0ac825fd`**

- **架构（用户拍板方案 B：最彻底）**：标签与笔记**独立管理、独立逻辑**，只通过关联表发生关系。
  - `.qnote` **只存内容** `version/text/body/images`（v3，但已移除 `tagIds`）；
  - 标签目录 `quick_note_tags`；关系 `quick_note_tag_links(note_id, tag_id, position)`；`quick_notes.tags_updated_at` = 关系 LWW 时钟；
  - 桌面：`electron/quickNoteTagsStore.ts`（目录）/ `quickNoteTagLinksStore.ts`（关系）/ `quickNoteTagService.ts`（唯一协调层）；`quickNotes.ts` 只留薄 API `setQuickNoteTags` / `applyRemoteQuickNoteTagLinks`，保存正文不再接标签；
  - 移动端：`src/mobile/data/quickNoteTagsRepository.ts` / `quickNoteTagLinksRepository.ts` / `quickNoteTagService.ts`；仓储/搜索/同步端口同规则。
- **无历史迁移（用户原话：\"不用管历史。也不用管迁移。\"）**：删除 v2→v3 迁移与移动端 `migrateQuickNotesV3`；`MOBILE_SCHEMA_VERSION` **6**（删 `tags_json/tag_ids_json`，加 `tags_updated_at` + links 表/索引）。
- **协议**：`.qnote` v3 = 纯内容；小记 Manifest（version 仍 `1`）保留可选 `tags` 目录，并给每条 item 新增可选 `tagIds` + `tagsUpdatedAt`。下载时**正文未变也按 `tagsUpdatedAt` 合并关系**；上传/单条推送都带本地关系（unchanged 判定含关系签名）。
- **标签目录/管理**：ID = `t_` + `sha256(归一名称)` 前 16 位；改名只改目录 + 重索引标签词；合并 = 改关联 + 墓碑；删除 = 墓碑 + 清关联（小记保留）；创建幂等（同名 active 返回、同名墓碑复活）。
- **桌面 UI**：`QuickNoteTagManager`（搜索/重命名/合并/删除/置顶/排序）、`QuickNoteFilterDialog`（时间六档 + 自定起止 + 类型 + 标签包含/排除）、`QuickNoteTagPicker` 按 ID；保存正文后再按需 `native.setQuickNoteTags`。
- **移动端**：HomePage/Composer/TagSheet 改按 ID；`applyQuickNoteTags` 只调 `bridge.setQuickNoteTags`；建标签只刷新标签目录（`onQuickNoteTagsChanged`），不重读小记列表；详情缓存从 `readQuickNote` 顶层 `tagIds` 取。
- **缺陷修复**：① 保存正文不携带标签 ⇒ 预览勾选待办不再清空标签；② 搜索账本 `tags` 存 JSON 数组（含空格标签恢复不拆坏）；③ 类型/标签筛选互斥，点卡片标签会清掉类型筛选。
- **护栏**：`quickNoteTags.test.ts`、`quickNoteFilters.test.ts`、`quickNoteModel.test.ts`（正文不含标签字段）、`quickNotes.test.ts`（关系独立 / 墓碑清关联）、`quickNotesDbPort` / `quickNotesSearch` / `quickNotesListProjection` / `useQuickNoteDetailCache` 等；IPC 通道 **137**（+`set_quick_note_tags`）、WRITE_OPS **36** / ALL **82**（同步基线并写明理由）。
- **门禁**：tsc 0 · vitest **384 文件 / 2698 例通过**（17 skip）· ui-metrics 0（未定义令牌 0）· check:core ✓ · check:mobileui ✓ · 双端构建 ✓ · check:bundle ✓ · `git diff --check` ✓。**未做 CDP 真实验收 / 设备实测 / 移动端标签管理页**。
- **标签展示修复（用户 261024 报：写作区标签行显示 `t_...`）**：根因是写作区/选择器只拿 `tagIndex.tags`（只含有计数标签）查名称，刚加到草稿、尚未保存的标签计数为 0 ⇒ 查不到 ⇒ 回退显示 ID。现在统一由 core `buildQuickNoteTagOptions(tagDirectory, index.tags)` 合成**完整目录选项**（含 0 条小记的标签），写作区/选择器/管理页都用它；名称缺失只显示「已删除标签」，**任何展示路径都不再回退到 ID**。标签条仍只用有计数的索引。桌面与移动端同规则。
- **评审收口（261024 方案 B 复审）**：① 移动端搜索索引在 `setNoteTags` / 远端关系变化后强制重建（此前只有内容 hash 变化才重建，按新标签搜不到）；② 移动端删除/合并/同步目录不再嵌套 `d.transaction`（SQLite 不允许嵌套 BEGIN），改为 `*InTransaction` 变体；③ 同步下载改为「新小记先落正文行、再合并关系」，冲突时先归档本地关系再写远端；冲突归档副本复制标签关系，恢复时推进 `tags_updated_at`；④ 删除标签/合并目标校验 + 远端关系过滤已墓碑标签，防关系复活；⑤ 标签目录合并改为字段级等价比较，远端目录为空/无变化时不再全量重建搜索索引；桌面首次建关联表、移动端 v5→v6 升级各清一次派生搜索索引；⑥ 单条推送按 `tagsUpdatedAt` 选关系权威版本，避免本地空关系抹掉远端较新标签；⑦ 列表/详情 `tags` 与 `tagIds` 保持等长（未知标签用空串），修复卡片标签名错位；⑧ 关系 store/仓储不再依赖目录 store/仓储：存在性校验与墓碑过滤上移到 `tagService`，并删除未使用的 `counts` API。
- **未做（等用户决策）**：移动端标签管理页；桌面回顾/导出；标签颜色/图标/多级。

### 261023(十) · 加密文本卡（端到端）+ `isLocked` → `isEditLocked` 更名 · **已提交 `6333e8a9` 并推送三仓，待用户验收**

- **① 更名（用户点单）**：`isLocked` 有歧义 ⇒ 全仓代码标识符改为 **`isEditLocked`（是否锁编辑）**，并成对改 `lockedAt→editLockedAt`、`setNoteLocked→setNoteEditLocked`、`applyRemoteLock→applyRemoteEditLock`、`mergeLockState→mergeEditLockState`（40 既有文件 + 1 新护栏，约 300 处）。
  **对外标识一律冻结**：S3 清单 JSON 键仍是 `isLocked/lockedAt`（解析 `syncUtils.ts` 的 `manifestFromWire`、写出 `syncEngine.ts` 的 `manifestToWire` 两处映射；护栏 `manifestLockWire.test.ts` 5 例）；SQLite 列 `is_locked/locked_at` 与 schema 不动（三处行映射补注释）；IPC 通道 `set_note_locked`、preload 导出名、`scripts/*.mjs`、用户文案「已锁定」全部未动。口径由用户定：**线上键冻结、代码内改名**，避免与旧 APK 互操作裂缝。


## 1. 当前基线（唯一状态来源，261103 收盘）

> 本节 261103 20:35 重建、**261104 15:10 按 git 实测更新（合 master 收尾）**；§0 的批次抬头保留当时口径（261102 及更早的「未提交 / 未 push」多已失效），**任何状态判断以本节为准**。

**仓库与 worktree（`git worktree list` 实测）**

| worktree | 分支 | HEAD | 状态 |
| --- | --- | --- | --- |
| `lakex-local-notes`（主仓库） | `feat/pad-touch-ui` | 见 `git log -1`（**不写死 hash**；本批 = 261104 三项裁决落地） | **本地提交、未推送**：origin 落后 1 个提交、GitHub 落后 4 个（本机用 HTTPS 补推，见下方环境注记）；**已合入 master（与 master 同一 commit）**；工作树多会话并行，状态**以 `git status` 为准** |
| `lakex-pad` | `feat/pad-adaptation` | `17f44dbd` | **历史残留**：平板第一批早已合入 master，本分支落后 master 15 提交、领先 0。其 README/AGENTS/HANDOFF 是旧口径（「平板走内核工具栏」「补丁 3 处」），**不要当依据**；确认不再用可 `git worktree remove lakex-pad`（需用户点头） |

- `master` = `feat/pad-touch-ui` 的同一 commit（**不写死 hash，见 `git log -1`**；261104 合 master）。master 自 `408d6126` 前进 **70+ 提交**（手写板线 + 移动端/编辑面线 + 本批表格/恢复）。
- 发版：只有 v0.0.1 / v0.0.2（`4b2a2467`），`package.json` = 0.0.2；**v0.0.2..HEAD 共 125 提交未发版**（下一版 v0.0.3 的发布说明必须写 inkDoc v4：旧端只读、手机/平板需重装）。
- 261103 各批已全部提交并双推（20:08–20:21）：`ce442482`（usheet 35 行/双光标/整行整列）、`733ab4aa`（多维表头部+短名）、`2b29d9e8`（画板工具条+第 4 处补丁）、`75c46902`（ink 14 色）、`ae14ffd1`（胶囊/横滑/安全区/页签 44/useKeyboard）、`1f164f2b`（门禁装置+三份基线重烤）、`1e74c3f8`（文档）、`fdf9c455`（AI 默认关）。
- 261103 之后（261104 凌晨，均已双推）：ink 三修（`912143da` 落笔/擦除按批渲染、`8f32a5ca` 中断不丢笔）+ 性能观测 `af169f96` + 图片页背景下采样 `8dc83a87` + 导入体积提示 `388232db` + 资源页本地占用 `1adcde27`。

**门禁基线**（261104 20:57 主工作树实测，含本批 ①②③）：tsc 0 / 全量 vitest **600 文件 3672 例（3660 通过 + 12 skipped；另有 11 个 integration 文件 skipped）** / ui-metrics 0 违规 / `check:core` 137 文件 0 / `check:mobileui` / 双 build / `check:bundle`（mobile-entry-preload 24/30、mobile-js 54,481/61,440、mobile-css 137,925/141,312）/ `check:arch`（移动首屏 343.9KB/360KB；桌面 541.3KB/600KB；import 违规 0）/ `git diff --check` 0。**移动 6 态快照 0 差异**（lake_gate，重烤后 `mobile-snap.json` 与提交版 0 改动）。**APK 已重装**（lake_mobile emulator-5554，debug，40,164,026B）。设备：本批面板/签名/单元格图片/表单视图/缺正文场景已逐条实测（见 §0）；23 屏走查与平板本次未跑（改动不涉及外壳几何，`check:windowsweep` 未跑）。

**环境（本机实测 261104 追加）**：**GitHub 推送走 HTTPS**（本机 `~/.ssh/id_ed25519_personal` 未在 GitHub 侧生效，SSH 报 `Permission denied (publickey)`；keychain 里有 `gtycoder` 凭据）⇒ `git push https://github.com/gtycoder/lakex-local-notes.git <branch>` 可用；Gitee 仍 `origin` SSH 正常。**本机已把 `origin` 的第二 pushurl 改为该 HTTPS 地址**（`git config --add remote.origin.pushurl …`）⇒ `git push origin <branch>` 一次推两边且 exit 0；`npm run setup:remotes` 会把 GitHub 写回 SSH，若再报 publickey 按上法改回 HTTPS。

**环境（本机实测 261103）**：Node **v24.18.0**（`$HOME/.nvm/versions/node/v24.18.0/bin`）；JDK **21** `/Library/Java/JavaVirtualMachines/jdk-21.jdk`（系统默认 java 是 1.8，手跑 gradlew 必须指 21）；Android SDK `/opt/homebrew/share/android-commandlinetools`；AVD **7 个**：lake_mobile / lake_gate / lake_tab / lake_body / lake_lock / lake_meas / lake_sheet；CDP **9335 开发 / 9336 门禁 / 9340 平板与窗口矩阵**。Android 唯一运行手册 = `docs/MOBILE-OPS.md`（serial 号段以 `adb devices` 现场为准，文档里的 5556/5562 已不一致）。

## 2. 风险与已知不稳定（跨批次，别再踩）

- **快照门禁依赖设备数据**：只在专用 AVD + 固定夹具上跑；改外壳几何/构成、重灌夹具、`pm clear`、装新构建、跑过造数据探针（long-doc-dom）后**必须先重烤基线**（`--from <warm>.json --write-baseline`），否则下次全量必红。5554/5556 实例有验证数据（无标题表格等），误跑必假红。23 屏走查装置刚修掉「菜单页误点关闭」的潜伏 bug ⇒ **历史绿灯不完全可信**。
- **验收状态**：261102 十四批、261103 各批都只有设备实测记录，**没有用户逐条点收**；「已双推」≠「已验收」。
- **平板回退史**：十三批（内核固定工具栏）已被十四批整体回退。残留旧路径（内核工具栏、`body.lake-tablet`、`__lakeSetTablet`、`nativeDeviceHint`）若被重新引入 = 第三套口径。
- **inkDoc v4（v3 读兼容）**：写 4、读 1|2|3|4；**旧端读到 v4 进只读保护** ⇒ 跨端混用必须在发布说明里写清（含「手机/平板需重装新包」）；改格式只能「新端写新版、旧端只读」，并同步 `docs/INK-PAD.md`。v4 = 页备注 + 页内贴图 + 页内文字块（S3 协议未动）。
- **P12 取舍**：冷 cache「启动即恢复上次文档」仍要等 kernel chunk；Trash/History 关闭即卸载（内部状态重置，判可接受）。
- **依赖补丁 4 处**（univer ui / plait draw / xiangfa mindmap / lakex-drawnix）：升级后必须 `grep` 过滤句计数 = 0 且设备上出现「手形工具 — H」；**patch 打上但未命中不会报错**，必须逐条确认语义生效。
- **设备装置不进 CI**（无 AVD/GPU）：pr.yml 只覆盖 tsc/vitest/双 build/core/ui-metrics/bundle/arch。
- §0 历史区（261030 及更早）的「未提交 / 未 push」是当时口径，**不要据此判断**。

## 3. 待办（唯一待办清单）

> 规则：只有「真问题 / 不做有代价 / 收益大于复杂度」才进本节（AGENTS §3#17）；完成后**直接删行**，历史留 git。
> ⚠️ 旧文档/代码注释里的「`HANDOFF` §3#N」指 261022 重写前的旧待办编号（已随历史删除，`git log -p` 可查），**不对应本节编号**；本节 261103 重建后不再用编号引用。

**P0（不做就卡住主线）**

1. **发 v0.0.3**（**合 master 已于 261104 完成**，master 与 feat/pad-touch-ui 同一 HEAD）：发版前跑全量门禁（手机/平板 6 态 + 多维表 3 态 + 23 屏走查 + `check:windowsweep` + 桌面 42 态；桌面 42 态本机无合成夹具缓存，需有夹具的机器补）。发版流程见 `docs/RELEASE.md`，tag 规则见 AGENTS §4（版本号单一来源 = `package.json`）。**发布说明必须写清 inkDoc v4：旧端打开 v4 文档只读，手机/平板需重装新包**。
2. **每批收尾的固定动作**：更新 §1 基线/门禁计数 + §3 待办 + 批次抬头状态（本批 261103 已完成对账；**以后不要让 §0 的「未提交」标记再漂移**——提交后立刻回写）。

**P1（该做但可排期）**

3. **桌面 3 项实机复核**：usheet 整行/整列选中不跳滚动、桌面手写板 14 色、设置/小记/历史 lazy 路径的交互冒烟（P12 遗留）。

   **平板（lake_tab）实机复验页签/页面面板**：代码无形态分支（`formFactor` 只改外壳宽度与侧栏），Android 手机已实测；平板 AVD 本轮未启动 ⇒ 需要时 `bash scripts/emu-up.sh lake_tab` 装同一份 APK 复核一次。
4. **依赖补丁 4 处升级复核口径**（仅当升级对应依赖时）：见 §2。
5. **已裁决、已落地（261104，别再问）**：① 表格语义 = 读态只读 + 排序/冻结/保护属文档数据（不补移动端保护入口）；② 移动端缺正文/缺小记 = B-lite（文档+小记，已落地）；③ 表格面板 = 删无能力占位、接线单元格图片/手写签名/表单视图（已落地）。残余验证：**缺正文云端拉回需在配了 S3 的实例上真机走一遍**（目前仅单测 mock）；**表单视图大表行数帽**（一次性 `getValues`，默认 35 行，超大表若卡再加）。

**P2（体验缺口 / 长期）**

6. **移动端文本格式（261104 设备实测已收口，别再按旧文档当缺口）**：H1–H6 / 字号 / 颜色 / 对齐 / 列表 / 缩进 / 行高 / 上下标 / 清除格式**全部生效**；**字号+行高已合并成一行步进器**（更多面板 4 行），对齐已是 4 档（含两端对齐）。已关闭、别再立项：首行缩进（内核只做整篇 set、无 undo ⇒ 文案改「全文首行缩进」）；clearFormat（只清行内 mark，与 Word/语雀一致）；Aa 面板溢出（字号搬进「更多」+ 面板下限 312 ⇒ 312/312 无裁切）。**分栏 3·4 已补**（贴着「分栏」条目弹锚定气泡）；**alert 类型不补**（块被选中后内核自带色板可改，用户口径）。未接入口：unlink（kernel 命令对 host 选区返回 false，只有内核链接面板那条路）/ replace（kernel 只收 ranges、移动端查找面板是宿主自研 ⇒ 本轮不做）/ style→code·quote / 表格块级命令族（lakex 表格卡上下文工具条）。另有：画图插入项解禁（文本绘图仍置灰）；移动视图拖拽排序；PdfRender `cacheDir` 清理；页面级 6 处裸 `env(safe-area-inset-bottom)`。
7. 墓碑 payload 老化（261025 定「后续优化」）；大库阈值探测（>2 万文档 / 索引 3–5MB）；**真实 Android 物理机验收从未做过**；PARITY 残余（移动云清理无 UI 入口、目录恢复后 `deleted_notes` 残留）。移动缺正文的「云端拉回 / 历史恢复 / 重建纯文本」三条只在单测 mock 覆盖，需真机 + 配 S3 验证。
8. 顶栏真 44 需另开「44 → 52」需求（六批 A4 结论）；平板内容画布「点空白落光标」（待用户裁决）。

**已闭合，别重复**

- 二轮/实机修复批「未跑 6 态」→ 六批 A3 已重烤、0 差异。
- 「胶囊固定底部」与「平移画布开关」已被二轮覆盖（前者撤回、后者整体删除）。
- P9–P12 候选：`s3v3Report` 按需（−1.2KB，否决）、`isolate:false`（回退留结论）。
- 平板「走内核工具栏 / 不挂胶囊」两条例外已撤回（AGENTS 已同步）。
