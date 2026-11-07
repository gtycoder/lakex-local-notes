/**
 * 移动端 CSS 层基线围栏（P0 · 261012 立项）
 *
 * 与桌面 src/styles/cssLayers.test.ts 同构、**两端各自一份**（移动端样式不许共享桌面设计系统）：
 *   · 每个移动端 CSS 文件的「声明数 / 重复(选择器,属性)组数」都不得**超过**基线；
 *   · 减少（清理）随时允许 —— 那正是重构的方向；
 *   · 新文件必须登记进 FILES + BASELINE，否则测试直接失败（防止"漏 import / 野样式文件"）。
 *
 * 基线数字 = 261012 P0 用本文件 scan() 的实测值。改完样式跑一次：
 *   MOBILE_LAYERS_REPORT=1 npx vitest run src/mobile/mobileLayers.test.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const REPORT = !!process.env.MOBILE_LAYERS_REPORT;

/** 移动端自有样式文件（P0 起必须全部登记；新增文件同步登记）。 */
const FILES = [
  // P1（261012）：移动端自有令牌/皮肤层（入口 index.css 只做层序声明 + @import，0 声明）
  "mobile/theme/index.css",
  "mobile/theme/base.css", // 非令牌基础规则（关键帧 / 阅读态字号 / 焦点环）
  "mobile/theme/tokens.css", // 主题无关令牌（几何/动效/层级/字体 + 移动端自有度量）
  "mobile/theme/light.css", // 浅色取值
  "mobile/theme/dark.css", // 深色取值
  "mobile/kit.css", // P2：移动端自有原语库 mb-*（唯一来源）
  "mobile/ui/nodeIcon.css", // 节点图标与选择器；不共享桌面UI样式
  "mobile/floating.css", // P3：浮层原语 mb-sheet / mb-actionsheet / mb-toast / mb-menusheet（P3 接线）
  "mobile/pad/pad.css", // 261102：平板外壳（更宽的移动端外壳 + 悬浮/可固定的目录与大纲；判据 pad/formFactor.ts）
  "mobile/features.css", // P6：图片 Lightbox / 附件预览的移动端外观（结构类名共享）
  "mobile/quick-notes.css", // P6b：小记编辑器宿主与预览（自桌面 quick-notes.css 抽取移动端子集）
  "mobile/mobile.css", // 外壳（首页/工作区/设置/抽屉/toast/小记）
  "mobile/brand-launch.css", // 261020：14A Paper Finch 启动动画（移动端）
  "mobile/editor-dark.css", // 编辑器深色组件边界修复（取值 P1 起归 theme/dark.css）
  "mobile/editor/editor-dock.css", // 底部 dock + 面板
  "mobile/ink/inkPad.mobile.css", // 手写板移动端布局
  "mobile/ink/inkPad.shared.css", // 手写板两端共享的结构类名，移动端独立复制
  "mobile/editor/edit-surface-kernel.css", // 261014 P2：编辑面里「内核按视口/按桌面写死的几何」的唯一收口（doc/note 共用）
  "mobile/editor/mobile-find.css", // 261016：移动端文档内查找条（容器 + 命中高亮 ::highlight），控件复用 kit 的 .mb-input/.mb-iconbtn
  "mobile/usheet/usheet-chrome.css", // 261021：表格 Yuque 式 chrome（40px 工具条 / 21px 公式栏 / 锚定卡片 / 32px 底栏 / 阅读态 5 项）；旧底部 dock 路线已覆盖
  "mobile/ai/ai.css", // 261023：AI 全屏功能页（布局 + 对话流 + Markdown）；控件复用 kit/floating 原语
  "mobile/bitable/mobileBitable.css", // 261030：多维表 P0（视图页签 / 表单填写 / 卡片布局 / 只读详情 / 视图配置）；令牌取值，无字面量
  "mobile/board/board.css", // 261103 task-4：移动端画板（Drawnix）编辑态工具条几何；vendor >720px 的竖向轨被遗留 translateY(-50%) 顶出视口，这里夹回可视区（≤720px 横轨保持 vendor 原样）
];

/** 基线（只允许变小）。261012 P0 实测。 */
// v2 柔光纸面（261107）：本期一次性新增形态（非覆盖回涨），dupGroups 全部未涨：
// · theme +10/+13/+13 = v2 令牌（画布/光晕/玻璃/动态主色/阴影/动效/标题字号；light 与 dark 各一套）
// · kit +25 = 设置分组卡/图标块/当前值/空态容器/开关动效等原语
// · floating +8 = Sheet 玻璃头 + 顶角 28 + 菜单/动作面板/Toast 阴影
// · mobile.css +43 = 外壳光场/顶栏透明与 is-scrolled/折叠标题/tab/卡片化/胶囊玻璃/设置大标题
// · editor-dock +2 = 浮动玻璃 dock（含 -webkit- 前缀）
const BASELINE: Record<string, { decls: number; dupGroups: number }> = {
  "mobile/theme/index.css": { decls: 0, dupGroups: 0 },
  "mobile/theme/base.css": { decls: 3, dupGroups: 0 },
  "mobile/theme/tokens.css": { decls: 204, dupGroups: 0 }, // 261103 六批 A1：+2 = --mobile-left-safe-area / --mobile-right-safe-area（横屏刘海左右安全区，env 与原生 inset 取 max；竖屏为 0 ⇒ 规则无副作用） // 261103：+1 = --mobile-capsule-drop（悬浮胶囊向下微调量，手机/平板共用；只改一个数就能调高低）。 // 261030：+1 = --mb-reader-pad（阅读面左右内距 20：文档正文 / 记录详情；用户报「文档左右边界非常贴边」）——新增令牌非覆盖。 // 261024：+3 = 加密文本插入面板图标的浅色调色板（--lake-locked-text-icon-* 底框/描边/锁色；几何在 lockedTextIcon.tsx；合法新增非覆盖） // 261023：+1 = --mobile-z-page（AI 全屏页层序） // 261021：+1 = --mb-usheet-card-shadow（表格锚定卡片阴影） // 261020：−8 = 删除 --lake-node-icon-* 八档浅渐变（旧线性图标的底板已整体删除，令牌随之退场）；261019：+1 = --mobile-sheet-bar-h（表格页 Univer 底部工具条实测高度 36px，胶囊让位用）. // 261017 Q3：+3 = 选中态语义令牌（--lake-bg-selected / --lake-fg-selected / --lake-bg-selected-hover；与桌面同口径）  |  261016 B2：+8 = 收编 mobile.css 的颜色字面量（知识库 6 档装饰调色板 --mb-nb-accent-1..6 / 纸卡投影 --mb-shadow-paper / 遮罩前景 --mb-on-scrim），**取值原样搬入、逐字节不变**（合法新增，非覆盖回涨）。此前 261015：+10 节点八档渐变、图形尺度、目录表情字号；171，移动端独立令牌
  "mobile/ui/nodeIcon.css": { decls: 86, dupGroups: 0 }, // 261020：101 → 86（−15）= 删掉旧 40 图标/色板/类型页签（−29），再加回容器的「表情符号｜图标」两页签 + 6 列插画网格（+14）；最终只剩表情页与插画网格
  "mobile/theme/light.css": { decls: 75, dupGroups: 0 }, // 261104 验收：撤回导航染色，删除该令牌。 // 261030：+1 = --lake-quick-tag-bg（小记标签浅灰绿实底；用户点单「标签要有点着重」，对齐语雀 App。新增语义令牌非覆盖） // P7b：-22 = 删掉已无人消费的 --b3-* 过渡桥接（261013 中途为"复用内核表情面板"加过 3 条内核 token 桥，用户改为**微信样式**后已撤回）
  "mobile/theme/dark.css": { decls: 129, dupGroups: 0 }, // 261104 验收：导航恢复原色，删除该令牌。 // 261030：+1 = --lake-quick-tag-bg 深色重绘（同浅色那条；合法新增非覆盖） // 261024：+3 = 加密文本插入面板图标的深色重绘（同组 --lake-locked-text-icon-*；合法新增非覆盖） // +41 编辑器深色桥迁入 → P7b -22 删 --b3-* 过渡桥接
  "mobile/kit.css": { decls: 596, dupGroups: 0 }, // 261105 六项：+2 = 控件直属SVG块布局/禁止压缩，沿用原尺寸。 // 261105：+1 = 设置名称字重，默认仍 400；由管理页上下文启用 500，不影响编辑面。 // 261102：+3 = .mb-set-item--field 控件列硬约束（.mb-input / .mb-select--trigger 吃满整行：补 flex:1 1 auto + width:100% + min-width:0；属新增规则，防同页输入框右缘不齐）。 // 261030：+1 = .mb-tag + .mb-tag 相邻徽标间距（多选值不靠额外容器包层，避免 DOM 元素数与设备快照计数涨）。 // 261030：+25 = 选项胶囊原语 .mb-chip（含 :active/.is-on/:disabled）+ .mb-chip-row（此前 bitable 并存 .mbt-feditor__choice/.mbt-chip/.mbt-form-chip 三套，收成一个唯一来源；属新增原语非覆盖）。 // 261017：+15 = S3 第三方服务说明（移动端提醒块：容器 + 标题 + p/ul/li + 免责），对齐思源 S3 设置页；合法新增。 // 261017：+6 = S3 配置迁移码多行输入修饰（.mb-input--multiline 纵拉 + textarea 等宽小字/最小高），桌面迁移码在手机上粘贴用；合法新增。  // 261014：+2 = 表情面板分类条改「一屏 8 格 + 横滑」（用户二次定稿）：新增 .mb-emoji-cats__track（overflow/overscroll/隐藏滚动条）+ .mb-emoji-cat 固定 --mb-tap-min 宽；同时删掉 .mb-emoji-cell--clear（首格清除格撤掉） // P2 248 → P4 +113 → P5 +48（勾选）→ P6c +6（内核宿主）→ P7 +17（选择器 PickerSheet）→ 261013 +9（缩进 ×4 + .mb-input 内层 input ×3 + .mb-empty--inset ×1 + .mb-set-section 细线 ×1）→ 261013 +68（选图标面板最终形态 = **微信样式**：顶部分类条 + 大格子正文 + 清除行；中途"复用内核表情面板"那一版已按用户要求废弃，配套的移动端内核 token 桥也从 theme/light.css 撤回；属移动端自有视觉，非覆盖叠层）；
  // 最后一条 = 浅色窗底转白后，白卡落在白底上会消失 ⇒ 分组边界改由 1px 细线承担（见 MOBILE-DESIGN「The White Rule」）。
  "mobile/pad/pad.css": { decls: 158, dupGroups: 0 }, // 261103 六批 A4：−10 = 删页签内小 ×（.pad-tab__x 两条规则），关闭动作改顶栏 44×44 按钮（A1 的 +2 已计入：.pad-tree/.pad-outline 横屏让位）。 // 261102 十四批：口径改「平板 = 更宽的移动端外壳」——删内核工具栏命中 40×40 / 收起键盘浮钮 / .pad-nb / .mobile-scroll 与 .mobile-doc-body 的让位覆盖（胶囊与 dock 回到手机语义）；新增「固定（停靠）」两栏（.pad-tree--pinned/.pad-outline--pinned + .pad-main--docked）、知识库加宽（.nb-shelf/.nb-list 1080 + 书架列自动填充）、画布吃满（.lake-editor/.lake-editor-mount height:100%）。实测 169（P1 面板常驻 164 + P2 A4 从 mobile.css 整体迁入平板通用几何 5 条；data-form-factor 规则现在只存在于本文件）
  "mobile/floating.css": { decls: 307, dupGroups: 0 }, // 261106 task-94：+3 = .mb-tree-list（批量移动目录树内部滚动：max-height/overflow-y/overscroll），属新增交互形态非覆盖叠层。 // 261105：+1 = 确认框标题字重，提升标题与后果说明的层级。 // 261030：+5 = .mb-sheet__title 补溢出省略（长表名进 Sheet 标题时不许把关闭按钮挤出）；+6 = .mb-sheet__foot（Sheet 底栏唯一来源：左右页内距 + 底部安全区 + 发丝线；四个 bitable 面板原先各写一套 padding）。 // 261014：+34 = 首页「＋」的新建面板 .mb-create*（组标题 + 4 列图标格子；表面仍用 .mb-sheet，不新造弹层） // P3 建库 → 收尾 -1（删掉未使用的 .mb-sheet--tall）→ 261013 A -5（.mb-sheet__empty 并入 .mb-empty--inset）
  "mobile/features.css": { decls: 152, dupGroups: 0 }, // 261016：+10 = 补 LakeEditor 出错态 .editor-error（C4-5 护栏查出移动端此前**无规则** ⇒ 内核加载失败时是裸元素；现在按移动端令牌补齐，属**新增样式非覆盖**）。// P6：图片 Lightbox（57→触屏版）+ 附件预览（82→触屏版）
  "mobile/quick-notes.css": { decls: 280, dupGroups: 0 }, // 261106 task-76：+12 = 标签详情里的小记卡限高（.tag-quick-card 3 + ::after 6 + is-expanded 2 + is-expanded::after 1；复用同一份 .quick-note-preview，属新增页面交互形态非覆盖叠层）。 // 261105 P2-D：+1 = 筛选条 chip 命中盒 min-height: var(--mb-tap-min)(44)（可点按控件，触屏下限；卡内展示型标签仍 28）。 // 261105：+14 = 移动端标签管理行；+9 = 拖拽排序（提示/把手/拖动中/行前·行后落点线；复用 qn-tag-sheet 骨架，属新增交互形态非覆盖）。 // 261030：−1（净）= 小记标签改实底（去掉 .qn-tag 的 0.5px 边 / is-selected 的 border-color）后补回 border:0（.qn-tag 也用在 button 上，移动端无全局 button reset）；此前账面 256 已偏松，按实测收紧 // 261020：+112 = 小记标签（卡片 chip / 写作区标签行 / 筛选条 / 添加标签底部面板；候选集合从有效小记派生） // 261014 查漏补缺：−9 = 删掉移动端永不命中的桌面外壳规则 `.quick-note-composer .quick-note-editor`（含 `.lake-editor-mount` 那条） // 261014：+1 = 内核 note 版式 `min-height:40vh` 收口；+7 = 把内核按**视口**定高的容器链钉在宿主高度上（`.lake-editor-mount/.ne-editor/.ne-editor-body/.ne-editor-wrap/.ne-editor-wrap-content`）+ 解除内核按视口写的 `max-height`（详见 LAKEX-CONTRACT §5.37②） // 261013：+55 = 自带表情选择器改**微信样式**的移动端那份（顶部分类条 / 浅灰底大格子 / 搜索行 / 空态；触屏尺寸走 --mb-tap-min）  // P6b：自桌面 quick-notes.css 抽取的移动端子集（22 条规则）→ 261013 校准到实测值 98
  // dupGroups 3 → 4：新增的 .mobile-route-layer 在 prefers-reduced-motion 里写 transition:none（与主块同名同属性成一组）——
  // 这是本文件既有的无障碍登记模式（.mb-skel / .mobile-htab 同样处理），不是多层覆盖。
  // dupGroups 4 → 6：新增 .mobile-topbar / .doc-pane--fresh .mobile-doc-body 在 prefers-reduced-motion 里关过渡/动画，
  // 与主块同名同属性各成一组（本文件既有的无障碍登记模式，同 .mb-skel）。
  "mobile/mobile.css": { decls: 1573, dupGroups: 6 }, // 261106 task-82：+17 = 多选模式（底部操作条容器 11 + fixed 变体 5 + 勾选态颜色 1；顶部栏复用设置页页头，行复选框复用 .mb-iconbtn）；属新增交互形态非覆盖叠层。 // 261106 task-79：−1 = 段标题改放白色块内（用既有 .mb-set-section__title），删掉不再需要的 .tag-detail-section；.tag-detail-sub 保留（块外副标题），基线收紧。 // 261106 task-77：+2 = 标签详情副标题/段标题间距（.tag-detail-sub 与 .tag-detail-section 各 1 条，纵向用既有 --lake-space-* 令牌）；属排版修复非覆盖叠层。 // 261106 task-76：+2 = 一级「标签」页页头复用 .mobile-settings-head 的两处必要覆盖（.mobile-page-head 的 padding-top 与背景；首页滚动容器无底色且已有顶栏安全区）；属新增页面形态非覆盖叠层。 // 261105 搜索增强：+12 = 范围分段外壳 2（display:flex / margin）+ 范围说明 3（margin/color/font-size）+ 最近搜索容器 1（margin）+ 标题行 6（flex/对齐/间距/颜色/字号）；控件全部复用 kit 的 .mb-segment/.mb-chip/.mb-empty，属新增交互形态非覆盖。 // 261105：移除旧图标按压缩放，字号全部接令牌。 // 261105：+5 搜索结果改button，补宽度/字体/对齐/颜色和清除系统边框。 // 261105 六项：+1 = 自有控件Lucide描边1.75，排除正文与第三方。 // 261105：属性按钮改复用 mb-btn，删除重复视觉；按当前扫描净收紧2。 // 261105：+6 = 管理页内容宽度/居中 3 + 设置说明密度上下文 3；不影响编辑页。 // 261104 验收：+2 = 工作区与顶部均取正文表面，去掉编辑区灰蓝底；仅背景归属，不改几何。 // 261104：+1 = .mobile-bottom-bar--above-dock 加 transition:none（编辑态胶囊显隐瞬时，修二级面板开合时胶囊闪入闪出）。 // 261103 六批 A2：1522 → 1486（−36）= 删头部收口后的死 CSS .mbt-meta*（5 条 18 声明）与 .mbt-toolbar（4 声明）+ 收紧历史余量；A1 横屏安全区 +8（.side-panel 左右 padding 2 / .mobile-scroll 2 / .mobile-doc-body 2 / 备注），净减后按实测收紧。dupGroups 7 → 6 同步收紧。 // 261027：+4 = 平板/折叠屏（body.lake-tablet）内容限宽居中 3 + 设置页加宽 1；只切布局不改 IA，属新增形态非覆盖。 // 261027：+1 = 抽屉工具栏安全区 padding-top（与 min-height 一起，刘海屏只顶开一次）；属修复缺失的安全区，非新增覆盖层。 // 261027：+14 = 按需资产占位卡 .mb-asset-missing（撑开破图为「图片未下载，点击下载」卡片；属新增交互形态非覆盖）。 // 261026：1468→1503（+35）= 首拉可视进度条（.mobile-sync-strip 容器/文本/百分比/进度条槽/填充 7 条规则 + 入场/sweep 关键帧与 reduced-motion 兜底）；属新增交互形态。 // 261026：+8 = 总回收站行「云端已删除 · 仅本地」徽标（.mobile-trash-text 容器 7 + .mobile-trash-cloud 定位 1；徽标本体复用 kit 的 .mb-tag 原语，属新增交互形态非覆盖）。 // 261025 清理：表格原生公式栏/只读条/caret 的样式整体迁到 usheet-chrome.css（表格单一来源），本文件 1563→1460。 // 261024：原生公式栏接管编辑输入面），自绘栏隐藏。 // 261024：+1 = 隐藏内核原生「移动公式栏」（只在内核编辑态挂载；自绘公式栏接管后一律隐藏，出现即自动 cancel）。 // 261022 晚：+1 = 隐藏内核自带的「打开表格工具」浮动钮（无图标、点了没可见效果；对应 ⋯ 入口已删） // 261022：+24 = 小记骨架与写作卡同构 + 内核就绪前的同构骨架盖层（position/inset/z/background/radius/height）+ capture 淡入；骨架与写作卡同构（body/tag/actions/btn 共 12）+ capture 卡片 120ms 淡入（3）+ reduced-motion 关动画（1）+ 空行注释不影响；dupGroups 6→7 = 淡入规则在 reduced-motion 里同名同属性（本文件既有登记模式）。 // 261021 P5：−24 = 顶部只读公式栏整块删除（// 编辑态输入面改由内核移动公式栏承担）；手机 footer 例外仍在（查找条 / 公式栏，共 2 条声明） // 261021 P5 查找替换：+2 = 内核把移动查找条挂在 footer 里 ⇒ 只在 footer :has(查找条) 时放行，其余 footer 子项仍隐藏 // 261021：+43 = 恢复表格宿主几何（.mobile-usheet 层叠上下文 / 公式栏 21），旧 dock 路线 CSS 已删 // 261021：+2 = 全局搜索定位小记卡片的高亮（.qn-card.is-revealed） // 261020 P1：1504 → 1412（−92）= 旧自绘表格顶栏 / 公式栏 / Univer 浮动钮校位规则整块删除，迁入 mobile/usheet/usheet-chrome.css（单一来源）。 // 261020 多维表移动端编辑：+76 = 编辑态部件（单元格按钮 24 / 新增记录与加载更多整行 34 / 记录与字段面板控件排版 18：选项 chips 选中环、评分按钮、进度滑杆、字段新增表单）。属**新增交互形态**，不是覆盖叠层。 // 261020 画板编辑：+4 = .mobile-board-viewer 层叠上下文（position/z-index/isolation）+ 编辑态恢复 .draw-toolbar。 // 261019 usheet 语雀式编辑面：+80 = 顶部常驻工具条（44px/横向滚动/按压态）+ 自绘公式栏（地址/显示值）+ 两颗官方浮动钮上移/隐藏「打开表格工具」。属**新增交互形态**，不是覆盖叠层。 // 261019(七)：+2 = 转场落定后撤掉工作区层的 transform/will-change（fixed 包含块回视口，修「工具栏展开停在键盘上方」）。 // 261019：+1 = 文档属性内容区横向内距（.minfo 用 --mb-page-pad；用户报「属性页不适配手机」，实测 dt.left=0/dd.right=412 贴边）——属**修复缺失的内距**，不是覆盖叠层。 // 261019：+12 = 标签页抽屉「关闭全部」按钮（基样式 10 + 按压态 2）。 // 261019 第五批：+11 = 小记编辑器懒加载兜底改为写作卡骨架（.mb-composer-skeleton 容器 + 标题/行/短行）。 // 261019 第四批：+10 = 「常用」分组标题按钮 .home-section__toggle（收起/展开三角）；「最近文档」已删（其容器复用给常用，声明数不变）。 // 261019 第三批：+1 = 表格页胶囊上移；同批工作区层补不透明底（+1，已计入）。 // 261019 第二批：+17 = 路由转场（stage/layer/视差/reduced-motion 共 14）+ 按压反馈统一（transition 1 + scale 1）。// 261019：+18 = 首层 tab 改**原生横向分页**（用户点单对齐语雀 pager）：.mobile-tab-stage 由 1 条规则（4 声明）扩为横向滚动容器（10）+ 隐藏滚动条（1）+ 写作锁横滑（overflow-x/touch-action 2 + 内层竖滚容器 pan-y 1）+ 新增 .mobile-tab-pane（8）；属**新增交互形态**，不是覆盖叠层。// 261014：+1 = 抽屉工具栏图标左内距（笔记本行图标太贴边）；此前 +1 = 首页胶囊收窄变体 .mobile-bottom-bar--home（只剩 3 项 ⇒ 上限 6 槽 288 → 4 槽 ≈192，对齐语雀紧凑度；工作区那条 4 项不动） // 261014：整块触发改版净 **-19**（删掉「气泡族」.mobile-create-press/.mobile-create-quick，换成整块层 .mobile-block-quick + 胶囊本体的 touch-action/user-select + 条目过渡补 opacity）；基线随之**调小**（只许降） // P1 -39 / P2 +4 / P5 +6 → 收尾 -83 → 261013 必要项 -33 → A -13 → 6.3/6.9 +20（冷启动骨架 mb-skel ×5 + 关键帧；引擎几何压回只改既有声明的值）
  // dupGroups 2 → 3：新增的 .mb-skel 在 prefers-reduced-motion 名单里关掉 animation，与主块同名同属性成一组 ——
  // 这是本文件既有的无障碍登记模式（.mobile-htab 等同样处理），不是多层覆盖。
  "mobile/brand-launch.css": { decls: 20, dupGroups: 2 },   // 261020 新文件：启动覆盖层/标记/动画/静态兜底；2 个重复组 = prefers-reduced-motion 对 anim/poster 的 display 切换
  "mobile/editor-dark.css": { decls: 13, dupGroups: 0 }, // P1：取值迁 theme/dark.css（54 → 13，只留组件级边界修）
  "mobile/editor/editor-dock.css": { decls: 300, dupGroups: 0 }, // 261104 五次收口：297 → 298（+1）= 分栏气泡三个选项之间加 0.5px 竖分隔（用户：一眼看出是 3 个块）。 // 261104 四次收口：294 → 297（+3）= 分栏气泡的透明背板 .med-chooser-backdrop（position/inset/z-index；替代 window pointerdown 监听，守 dockPanelFocusGuard）。 // 261104 三次收口：280 → 294（+14）= 分栏选择改锚定气泡（.med-chooser-pop 容器 10 含 pointer-events + 按钮 4）；panel 内联行删除。 // 261104 三次收口：280 → 293（+13）= 分栏选择改锚定气泡（.med-chooser-pop 容器 9 + 按钮 4 等），panel 内联行删除；属新增交互形态非覆盖叠层。 // 261104 二次收口：265 → 280（+15）= 字号/行高共用 ValueStepper（.med-f-size 两条 → .med-f-step 7 条：容器/按钮/标签/值 等）——同一交互一套几何，属**新增交互形态**非覆盖叠层。 // 261104：259 → 265（+6 净）= 字号从「Aa」面板底部一行 8 钮改为「− 当前 +」步进器（用户批准，搬进「更多」面板与行高同组）：删 .med-f-sizes 两条（−3），新增 .med-fsize 宽 132（+1）与 .med-fsize__value（+8）；属**新增交互形态**（修 Aa 面板 354px > 312px 的裁切），不是覆盖叠层。 // 261103 六批 A1：+4 = 工具栏 padding-left/right + 面板内容 padding-left/right（横屏刘海让位） // 261019(八)：+1 = 收起过渡期面板内容保持可见时不再接受点击（.med-panel[data-closing="1"]）。 // 261017 撤销后端：`.med-btn:disabled` 置灰 +2（255 → 257）。261015：「＋」= 方块网格（两组 8+10 × 4 列、组间 16、方块 52、浅灰底）；「Aa」面板压缩上下间距（行距 8→6、卡内距 3→2、条目 44→40 走注册表补足、色板 37→34、内距 12/14→6/6）+ 图标 17→20、文字/图标色 text-2→text-1。261017（B6）：一级面板统一灰底（selector 加 data-kind=font，声明数不变）；「更多」改行式白卡 + 每项文字说明 + 工具栏中间横滑/键盘固定尾键（删 `.med-ins-glyph` -9、补 `.med-f-btn:disabled` +2 / 行内文字与行标签/不换行 +21 / 工具栏横滑区 + `.med-btn--kb` +5）⇒ 237 → 255
  // 261102 v3（用户点单：颜色/笔宽收菜单 + 全局预览悬浮）76 → 97，全部是**新增交互形态**，不是覆盖叠层：
  //   ① +21 = 色板/笔宽两个悬浮面板（12 条：absolute 在坞上方 8 + 卡面/边/阴影/圆角/横排/内距）
  //      + 全局预览改悬浮覆盖（9 条：absolute/z-index 1/导航下方 top/左右 8/45dvh 内部滚动/卡面/去流内 margin）；
  //   ② −1 = 删掉旧的「预览条 margin-top 让位」流内规则（改悬浮后不再把画布往下推）；
  //   ③ +1 = 悬浮面共用选择器并入 preview。
  "mobile/ink/inkPad.mobile.css": { decls: 182, dupGroups: 0 }, // 261104 二十六批四轮：+25 = 页签在移动端的入口/表单样式（入口 has-tab 高亮 1 + Sheet 内表单容器/标签/输入/动作/两按钮 ~22），属新增交互形态 // 261104 二十五批：+29 = 背景来源与纸张同一行（.ink-bg-source 容器 5 + 按钮 8 + ::after 4 + :active 1）+ v4 文字块/贴图浮层控件的移动端命中盒（文字 ±/删除 4、贴图删除 4、两个缩放手柄 2）；属新增交互形态非覆盖。 // 261103 task-8：+5 = 色板改 2 行 × 7 网格（display:grid / grid-template-columns / justify-content / gap / overflow-x；复用 .ink-color 44 盒，触达不变）；仅排布变化，非新增浮层。 // 261102 task-17（用户截图：工具行太稀 + ＋被裁）：120→122 = +1 = 坞内工具行 gap:0；+1 = 坞内分隔 margin:0（8×44+4×1+内距4=360 ⇒ 412 不横滑；按钮盒仍 44）。 // 261102 task-16（「插入」入口从全局预览移到工具坞）：118→120 = −10（删掉预览面板里的导入行容器 5 + 按钮 5）+12（坞上方「插入」菜单：纵向布局 flex-direction/align-items/justify-content/gap/padding/overflow-x 6 + 菜单行按钮 justify-content/gap/min-width/padding/color/font-size 6）；属入口搬家的新增交互形态非覆盖。 // 261102 T2-B PDF 导入：110→118 = +8 = 预览面板导入行加 flex-wrap/gap（2）+ PDF 进度横幅（display/align/justify/gap 4）+ 横幅里的取消按钮（min-width/padding 2）；属新增交互形态非覆盖。 // 261102 v2 图片页（T1）：102→110 = +8 = 全局预览面板里的「导入图片」行（容器 display/justify-content/padding 3 + 按钮 gap/min-width/padding/color/font-size 5）；属新增交互形态非覆盖。 // 261102 v3 收口：99→102 = +1 = 悬浮条尺寸变量（--ink-mobile-nav-h / --ink-mobile-dock-h）+1 = 画布上下内距（纸面在悬浮条之间居中）+1 = 编辑态底部内距；属新增交互形态非覆盖叠层。（上一轮 +2 = 色板极窄屏兜底 overflow-x）
  "mobile/ink/inkPad.shared.css": { decls: 259, dupGroups: 0 }, // 261104 二十五批：188 → 259（+71）= 按桌面补齐 v4 页内文字块/贴图 9 组（.ink-text-editor / .ink-text-controls / .ink-text-size / .ink-text-remove / .ink-text-resize / .ink-image-remove / .ink-image-resize / .ink-page-thumb__note / .ink-text-controls.is-selected）；此前漏同步 ⇒ 移动端文字框退化成默认 textarea。副本漂移由 src/mobile/ink/inkSharedCssParity.test.ts 钉死（类名集合必须与桌面一致）。
  "mobile/editor/mobile-find.css": { decls: 15, dupGroups: 0 }, // 261016：新文件 = 查找条容器（6）+ 计数（6）+ ::highlight 命中/当前命中（3）
  // 261020 P1 新文件（表格 chrome）；基线按实测回填（只许降）
  "mobile/usheet/usheet-chrome.css": { decls: 593, dupGroups: 0 }, // 261104：+61 = 手写签名浮层（.mb-usheet-sign* 31 声明）+ 只读表单视图（.mb-usheet-form* 29 声明）+ 浮层打开时抬高表格宿主层序 1 条——移动端表格新增交互形态，表面复用 .mb-sheet / .mb-btn 原语，不是覆盖层叠加；仅新增声明，其它文件基线未动。 // 261103 task-3：−10 = 删自绘光标 .mb-usheet-caret（规则 9 声明 + 关键帧 1）——原生 canvas 自己画 caret（设备实测两个光标），基线收紧。// 261102 十四批：−3 = 删平板「只读常驻 dock」两条规则（dock position:static + spacer height:0，共 3 声明）；表格恢复手机语义。 // 261025 清理：删自绘公式栏 + fx 面板 CSS，接收原生公式栏/只读条/caret；573→543。单一来源。 // 261024 A 批（对齐钉钉）：468→496（去掉 dock 重复的 ✓ 后 −8） = T 面板分组标题 + 浅灰 chip + 字号步进 + 40 方块色板 + 列表行图标/46 行高 + 面板白底 + dock ✓；dup 4→0 = 旧的 fboard/fsw/fcolors 重复组随重写删除（只降）。 // 261024：467→468 = 色板「当前背景色」反显环（.mb-usheet-fsw.is-on）；455→467 = 面板底部渐隐提示（::after 10 声明 + [data-scrollable] 1）+ 末块列表去 8px 尾巴（1）；列表行高 46→40、面板内距为取值变化不计声明。 // 261023 v5：302→401 = 顶部工作表行 + 公式栏 + dock + 面板（新增交互形态，用户定稿）；dup 0→4 为同一批交互态的同名属性，接受。// 261022 晚：+52 = 两行工具条（行容器 / 次行分隔线）+ 文字格式一级标签 T + T 卡（四个开关 / 8 色圆点）+ 底栏十字高亮开关——属**新增交互形态**（用户点单：两行、常用外置、T 二级展开、十字高亮移到缩放左侧），不是覆盖叠层 // 261021 P4-2：+29 = 二级选择器两种形态（圆点色板 12 / 图标行 17），语雀同款且与 SheetMenuBody 单一来源 // 261021 P4：+5 = 一级「小数位」按钮（语雀 toolbar-decimal-inc：文字 .00 + 小加号；min-width / gap / 字号 / 行高 / 字距）——属新增一级工具项，不是覆盖叠层 // 261021：工具条 40 / 锚定卡片 / ⋯ 七行图标 / 底栏 32 / 阅读态 5 项（替换旧 dock 路线）
  "mobile/ai/ai.css": { decls: 341, dupGroups: 1 }, // 261023：+12 = 消息内图片（用户气泡方向 + 3 列网格） // 261023：+10 = 「回到底部」浮钮 // 261023：+52 = 图片附件（待发送缩略图 6 + 资料图片网格 8 + 其余布局） // 261023：+16 = 历史对话独立页（层序/元信息/操作区/行尾删除） // 261023：+14 = GFM 表格（wrapper/table/th/td/对齐）；+3 = 解析器共用后的 hr // 261023：AI 页（布局 / 对话流 / Markdown / 设置页按钮组）；dupGroups 1 = reduced-motion 关掉入场动画（本文件既有登记模式）
  "mobile/bitable/mobileBitable.css": { decls: 957, dupGroups: 0 }, // 261105 P1：943 → 957（+14 实测）= 视图长按拖拽排序的拖拽态与落点线（.mbt-viewrow.is-dragging 2 + is-drop-before/after 两条容器规则 2 + 两条伪元素落点线各 3 = 8 + 拖拽中禁原生纵向手势的 .mbt-viewlist-rows.is-dragging 2；伪元素画线不改行几何）；属**新增交互形态**非覆盖叠层。 // 261103 六批：928 → 943（+15 实测）= 只读「视图状态」chip（.mbt-viewstate-chip 13 声明 + 按下态 1）+ 同期六批 A1 横屏安全区内距（2）；属**新增交互形态/安全区修复**，不是覆盖叠层。四批：921 → 928 = 头部改两行（.mbt-header 纵向列 + row1/row2 容器）；三批：896 → 921 = 三行压一行 + 统计行头部/统计行
  "mobile/board/board.css": { decls: 16, dupGroups: 0 }, // 261103 六批 A1：+1 = >720px 竖向轨 left 计入左安全区（横屏刘海）。 // 261103 task-9：+10 = 工具项里的隐藏 radio 改成视觉隐藏（label position:relative + input 绝对定位 1px 透明：9 声明），修「图标被 input 挤右 15px / 卡片被撑宽」的左右错位——属**修复几何**，不是覆盖叠层（task-5 的应用侧平移开关已被 261103 二轮定稿否决并删除）
  "mobile/editor/edit-surface-kernel.css": { decls: 24, dupGroups: 0 }, // 261014 P2：把散在 mobile.css（doc 侧）/ quick-notes.css（note 侧）的内核几何收口**合成一份**（doc/note 共用 data-mb-edit-host 契约） // 261013：+1 = 表情面板分类条在 dock 里拉满面板边（当时口径：9 个分类 ≈45.8px、一屏放得下不横滚；261014 已改「一屏 8 格 + 横滑 + 钉住的动作键」，见 kit.css）
};

/** 扫描 src/mobile 下所有 CSS，确保没有「未登记的野样式文件」。 */
function listMobileCss(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listMobileCss(p, out);
    else if (e.name.endsWith(".css")) out.push(path.relative(SRC, p).split(path.sep).join("/"));
  }
  return out.sort();
}

/** 极简 CSS 扫描器（与桌面 cssLayers 同一口径，两端各自持有一份）。 */
function scan(css: string): { decls: number; dupGroups: number; emptyRules: number; emptyAtRules: number } {
  const props = new Map<string, number>();
  let decls = 0;
  let emptyRules = 0;
  let emptyAtRules = 0;
  const n = css.length;
  const skipWs = (j: number) => {
    while (j < n && /\s/.test(css[j])) j++;
    return j;
  };
  const findBlockEnd = (braceIdx: number) => {
    let depth = 0;
    let j = braceIdx;
    for (; j < n; j++) {
      const c = css[j];
      if (c === "/" && css[j + 1] === "*") {
        j = css.indexOf("*/", j + 2);
        if (j < 0) return n;
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        j++;
        while (j < n && css[j] !== q) {
          if (css[j] === "\\") j++;
          j++;
        }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return j;
      }
    }
    return n;
  };
  const walk = (from: number, to: number) => {
    let j = skipWs(from);
    while (j < to && j < n) {
      if (css[j] === "/" && css[j + 1] === "*") {
        j = skipWs(css.indexOf("*/", j + 2) + 2);
        continue;
      }
      const brace = css.indexOf("{", j);
      if (brace < 0 || brace > to) break;
      const head = css.slice(j, brace).trim();
      const end = findBlockEnd(brace);
      if (head.startsWith("@")) {
        if (!/^@(keyframes|-webkit-keyframes|font-face|page|property|charset|import|namespace|layer)\b/i.test(head)) {
          const body = css.slice(brace + 1, end);
          if (/^@(media|supports|starting-style|container|layer)\b/i.test(head) && !body.includes("{") && !body.includes(":") && !body.includes("/*")) emptyAtRules++;
          walk(brace + 1, end);
        }
      } else {
        const body = css.slice(brace + 1, end);
        let declarationsInRule = 0;
        for (const raw of body.split(";")) {
          const line = raw.trim();
          const k = line.indexOf(":");
          if (k <= 0 || line.startsWith("@") || line.includes("{")) continue;
          const prop = line.slice(0, k).trim();
          if (!prop || prop.startsWith("//")) continue;
          decls++;
          declarationsInRule++;
          const key = head.replace(/\s+/g, " ") + "||" + prop;
          props.set(key, (props.get(key) || 0) + 1);
        }
        if (!declarationsInRule && !body.includes("{")) emptyRules++;
      }
      j = skipWs(end + 1);
    }
  };
  walk(0, n);
  let dupGroups = 0;
  for (const count of props.values()) if (count > 1) dupGroups++;
  return { decls, dupGroups, emptyRules, emptyAtRules };
}

describe("移动端 CSS 层围栏（P0）", () => {
  it("每个移动端样式文件的声明数与重复(选择器,属性)组数都不超过基线", () => {
    const grew: string[] = [];
    for (const rel of FILES) {
      const got = scan(readFileSync(path.join(SRC, rel), "utf8"));
      const base = BASELINE[rel] ?? { decls: 0, dupGroups: 0 };
      if (got.decls > base.decls) grew.push(rel + ": 声明数 " + base.decls + " -> " + got.decls);
      if (got.dupGroups > base.dupGroups) grew.push(rel + ": 重复组 " + base.dupGroups + " -> " + got.dupGroups);
    }
    if (REPORT) {
      for (const rel of FILES) console.log(rel, JSON.stringify(scan(readFileSync(path.join(SRC, rel), "utf8"))));
    }
    expect(
      grew,
      "以下移动端样式文件新增了「多层覆盖」或未登记的新文件（请收敛到一处来源，或把基线调小）：\n  " +
        grew.join("\n  ")
    ).toEqual([]);
  });

  it("每个文件都必须登记进 FILES + BASELINE（防止野样式文件漏 import）", () => {
    const missing = FILES.filter((rel) => !(rel in BASELINE));
    expect(missing, "以下文件没有基线：\n  " + missing.join("\n  ")).toEqual([]);
    const unregistered = listMobileCss(path.join(SRC, "mobile")).filter((rel) => !FILES.includes(rel));
    expect(
      unregistered,
      "src/mobile 下有未登记的样式文件（新文件必须登记 FILES + BASELINE，且必须由使用它的组件 import）：\n  " +
        unregistered.join("\n  ")
    ).toEqual([]);
  });

  it("移动端 CSS 不得再出现会作用于 JSX 的桌面类名选择器（ln-/b3-/fn__/config-）", () => {
    // 261013 立的护栏：P2–P5 把 JSX 迁到 mb-* 之后，mobile.css 里还留着一批挂在 .ln-row 上的规则
    // （拖拽落点线 / 真机 touch-action / 标签页卡片）——它们**永不命中**，缺陷就是这么静默丢的。
    // 口径：只查**选择器里**出现这四类前缀；注释与变量名不算（--ln-indent 已删）。
    const bad: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of css.split("}")) {
        const brace = rule.indexOf("{");
        if (brace < 0) continue;
        const head = rule.slice(0, brace);
        if (/(^|[\s,>+~(])\.(?:ln-|b3-|fn__|config-)/.test(head)) bad.push(rel + " :: " + head.trim().replace(/\s+/g, " ").slice(0, 90));
      }
    }
    expect(bad, "以下选择器挂在桌面类名上，而移动端 JSX 只用 mb-* ⇒ 永不命中（要么删掉，要么回接到 mb-*）：\n  " + bad.join("\n  ")).toEqual([]);
  });

  it("没有留下「空壳规则」（选择器 { }）——清完声明必须连壳一起删", () => {
    const shells: string[] = [];
    for (const rel of FILES) {
      const { emptyRules, emptyAtRules } = scan(readFileSync(path.join(SRC, rel), "utf8"));
      if (emptyRules) shells.push(rel + ": 空规则 " + emptyRules + " 条");
      if (emptyAtRules) shells.push(rel + ": 空 @media/@supports 块 " + emptyAtRules + " 个");
    }
    expect(shells, "以下文件留下空壳规则：\n  " + shells.join("\n  ")).toEqual([]);
  });
});
