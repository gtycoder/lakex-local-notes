/**
 * 壳层 CSS「多层覆盖」防回归围栏（260915）。
 *
 * 背景：这个项目的样式是分层加载的（基础骨架 → 思源主题/组件 → 壳层打磨层），
 * 同一个 (选择器, 属性) 经常被写 2~8 次，谁赢取决于加载顺序 + !important：
 * 改一处要同时改几个文件，跨宽度/跨主题还会"另一边没跟上"（用户报过多次）。
 * §2.40/§2.41 已把这类重复清过一轮，这条用例负责**不让它再长回来**：
 *   · 每个文件的声明总数、以及「同一 (选择器, 属性) 被写≥2 次」的组数，都不得**超过**记录值；
 *   · 减少（清理）随时允许 —— 那正是我们想要的方向。
 * 基线数字来自 260915 清理后的实测值；清理得更多时，顺手把基线调小即可。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

/** 我们自己的样式文件（不含 vendor：lakex 包内样式）。260923 W2：src/b3/** 已整体下线（含 AGPL 思源移植层）。 */
const FILES = [
  "styles/index.css",   // UI 重设计 P1：单入口，只 @layer 声明 + @import 编排（0 声明）
  "styles/compat.css",  // P7-b：桌面兼容层（从 b3 收编的承重规则 + 仍在用的思源类）
  "styles/a11y.css",    // P7-e：无障碍最高层（reduced-motion 契约，靠层序取胜）
  "features/attachment/attachment-preview.css", "features/editor/image-lightbox.css", "features/outline/outline.css",
  "features/editor/selectionToolbar/selectionToolbar.css",
  "features/sheet/sheetEditor.css",
  "components/historySnapshotPreview.css",
  "features/bitable/bitableEditor.css",
  "features/bitable/bitableViews.css",   // V01：视图层（视图页签/回退提示），按职责从 bitableEditor 分出
  "features/bitable/bitableFieldCells.css",   // T02A：布尔/链接/评分/进度 单元格样式
  "features/bitable/bitableKanbanView.css",   // V02：看板视图样式
  "features/bitable/bitableGalleryView.css",   // V03：画册视图样式
  "features/bitable/bitableCalendarView.css",   // V04：日历视图样式
  "features/bitable/bitableFormView.css",   // 表单双模（编辑/预览）样式
  "features/bitable/bitableRelationPicker.css",   // 关联记录选择器（260929：全局大弹窗）
  "features/bitable/bitableFileIcon.css",   // 260930：附件「文档类型」图标 + hover 名称气泡
  "features/bitable/bitableAiField.css",   // 261003：AI 字段（单元格状态 + 字段配置 + 整列生成对话框）
  "features/bitable/bitableMarkdown.css",
  "components/markdown/markdown.css",
  "features/ai/aiDialogParts.css",   // 261005：AI 助手弹窗内局部布局（预设提示词行 + 复制动作行）   // 261005：Markdown 轻量子集渲染（从 bitable 提出，bitable 与 AI 面板共用）   // 261004：Markdown / AI 字段（单元格预览 + 展开浮窗 + 预览排版）
  "features/bitable/bitableFilterEditor.css",   // 260930：筛选条件树（远端 lake 风格 + 可复用）
  "features/bitable/bitableFillRules.css",   // 260930：条件填色配置与表格投影
  "features/board/boardEditor.css",
  "styles/dialog.css", "styles/document-status.css",   "styles/components.css",   "styles/tokens.css",   "styles/feature.css",   // P3 起：功能域层（正文/等宽字体等）
  "styles/kit.css",       // P4 起：自有组件库（14 件）
  "styles/chrome.css",    // P5 起：应用外壳（活动栏/目录栏头部/状态栏 …）
  "styles/overlay.css",   // P5-c 起：浮层（对话框 / 菜单 / 气泡）
  "styles/kernel-theme.css",   // 260926：内核 lakex 主题变量集中映射（**未分层**，故意不进 @layer）
  // 基础层（260916 第二档 S3：原 styles.css 拆成入口 + 10 个域文件；入口只剩 @import 编排，不再计声明）
  "styles/app/base.css", "styles/app/dialogs.css", "styles/app/editor.css",
  "styles/app/misc.css", "styles/app/panels.css", "styles/app/quick-notes.css", "styles/app/settings.css",
  "styles/app/shell.css", "styles/app/tabs.css", "styles/app/vendor-board.css",
];

/** 基线（按本文件的 scan() 实测）。只允许变小 —— 唯一例外是「按职责归并」（HANDOFF §2.48 的 S2/S3）：
 * 把规则从一个文件搬到另一个文件会合法地抬高接收方的计数：此时同步抬高该文件基线，
 * 并在同一批把来源文件的基线调小（搬走多少、留下多少要对得上，让总量保持可见）。 */
const BASELINE: Record<string, { decls: number; dupGroups: number }> = {
  // 261006（UI 刷新 Phase 1.2）：chrome.css 470→473、app/shell.css 424→427 ——
  //   chrome.css +3 = 同步提示条去掉「单侧 3px 色条」改用图标色（.sync-toast-icon--ok/--error/--unavailable）；
  //   shell.css +3 = 目录/大纲筛选行高度动画改 grid-template-rows（.dock-filter-row 的 display/grid-template-rows/min-width
  //   与 .dock-filter-row__inner 的 min-height）。两处都是合法新增（非覆盖回涨）。
  "styles/index.css": { decls: 0, dupGroups: 0 },   // UI 重设计 P1：单入口（@layer 声明 + @import 编排，0 声明）
  "styles/feature.css": { decls: 83, dupGroups: 0 },  // 260930 设置页重做：+30 = 分组内容由「灰底块」改「一叠白卡」（.config-section 表面/标题条 + 行统一 padding/border）+ 新增堆叠行 .config-item--stack（标题在上、控件占整行）+ 字段级错误 .config-item__error/.config-note（此前 .settings-hint 无定义）+ 名称行对齐徽章；全是新增盒子/间隔，不覆盖既有声明，且桌面专属作用域 .settings-panel（移动端不加载本层）。此前：视觉优化 + 内核编辑器主题桥（lakex 跟随深色/暖色：含 .ne-ui-toolbar）；260923 收敛：-19 = 大纲侧栏的 .outline-* 覆盖并回 features/outline/outline.css 单一来源；260926：+2 = 修内核图标选择器（.ne-icon-symbol→.ne-icon）+ 直接覆盖工具条文字/原生大纲底色（内核浅色 schema 以未分层 <style> 注入、压过变量桥）；合法新增非覆盖回涨
  "styles/kit.css": { decls: 649, dupGroups: 0 },   //  261006 Phase 2.2: +2 = .native-title-tip 表面（全局 title 拦截器，见 components/ui/NativeTitleTips.tsx）  //  261006 Phase 2.2: +48 = 新增 checkbox/radio 自绘原语（桌面 .app-shell 作用域，排除内核正文待办框）；勾选用边框旋转绘制，不引入颜色字面量  //  261006 Phase 2.2: +4 = 原为 +4；随后修「块状药丸/文字右移」再 +10（列表改 flex 列、选项 100% 宽、勾选位改右侧绝对定位、展开/聚焦统一为柔光环） 新增下拉弹层样式 .ln-select__list (min-width/max-height/overflow) + .ln-select__item (white-space)，取代原生 select 的系统弹层；选项复用 .ln-menu__item  // 260930 大统一：+14 = 单行省略工具类 .ln-ellipsis(--grow) + 图标按钮主色变体 .ln-iconbtn--accent + 菜单项选中态；并把 overlay.css 的 legacy 菜单项选择器（.top-menu > button 等 5 个）**收编进本文件的 .ln-menu__item 单一规则**（那边对应减少，见基线注释）     // 260929：横向页签原语按用户选定的「墨线 + 计数徽标」重建（基座取自 components.css 的 legacy 墨线 + 补回 min-width/cursor，新增 .ln-tabs__count；随后回收站/历史/表单全部迁入、删掉过渡的 .ln-tabs--seg 变体 ⇒ 558 → 593 → 577）。原记录 —— P4 组件库 + P5-g 面板件 + P5-h 控件 + P5-i 开关（实测）；260926：+8 = 补回 .b3-switch::after 被删源漏掉的滑块基线
  "styles/chrome.css": { decls: 473, dupGroups: 0 },   // 260930 续：+3 = 目录行「已锁定」小锁 .tree-row-lock（非交互、行尾常驻）   // 260930 大统一：-39 = 目录栏图标钮（.dock-icon-btn 6 条规则）与目录行动作钮（.tree-row-action 3 条）的视觉声明收编到 kit 的 .ln-iconbtn(--compact/--accent),  // 260929 续：+2 = 多维表状态栏改为**贴着底栏上沿停靠**（[data-doc-kind="bitable"] 再补 height/min-height 22px，与 sheet 同口径）⇒ 底栏不被状态栏压住。260929：+1 = 多维表文档状态栏上移让位底部常驻汇总栏（[data-doc-kind="bitable"] 的 bottom，与 sheet 同层变体）。P5 外壳 + S1+A + 整边缩略图槽；260922：+21 = 左缘「跟手把手」（隐形热区里浮出、Y 跟手、点击固定；热区 39→8 与去缩略图同批）；+10 = 目录「悬浮」改半幅浮卡（固定高度、顶贴面包屑下缘、四角圆角）；260926 续：+1 = 本地空间指示 .workspace-local（未配置云同步时尾段显示本地图标）；+3 = 表格文档状态栏并入 sheet 底部统计行（[data-doc-kind="sheet"] 的 bottom/height/min-height——高度基线在本层，同层就地加变体，合法新增非覆盖回涨）
  "styles/kernel-theme.css": { decls: 62, dupGroups: 0 },  // 260930 续：+1 = `.lake-editor-mount.lake-ai-sel-hidden{--lakex-editor-selection:transparent}`（AI 面板打开时屏蔽原生选区色，自绘高亮零闪烁；必须放未分层本文件才压得过上面那条，见文件内注释）。此前：删除「有背景文字单独 ::selection」无效特判后扫描仍为 61；选区改由半透明 --lake-select-bg 承载。260928：+1 = ④「内核品牌绿」例外（固定工具栏加号单独钉回 --lake-kernel-brand-green；浅/深分别走 Lake 原生 schema）—— 刻意的不统一，合法新增非覆盖回涨；原记录 —— 260926：内核 lakex --lakex-editor-* 集中映射（未分层）；60 = ①dark+warm 共用 43 + ②dark 反相 9 + ③light accent 8
  "styles/overlay.css": { decls: 127, dupGroups: 0 },   // 260930 设置页收口：+2 = 面板型标题栏 .settings-panel-large .settings-header（常规 40px + 对称内边距，标题/关闭钮居中）——从 components.css 按职责并到 .floating-dialog-header 旁边（那边 -2），同一处来源、非覆盖叠层。此前：260930 大统一：-29 = 菜单项规格（.top-menu > button / .context-menu > button / .context-menu-item / .context-menu-submenu > button / .create-menu > button）**整段收编进 kit.css 的 .ln-menu__item 单一规则**（那边 +14）  // P5-c 浮层 + P5-j 搜索 + P7-b .top-menu 定位 + 菜单项布局三件套；260926 Phase 1a：+47 = 浮层原语统一；+3 = 多维表收编 .ln-overlay-surface--raised（对话框内嵌套下拉抬层）+ .ln-scrim--right（记录详情侧边抽屉），合法新增非覆盖回涨——.ln-scrim 基座、.ln-dialog 布局/表面单一来源（并自 dialog.css 收编）、.ln-dialog__actions、.ln-menu/.ln-popover 表面（自 kit.css 收编）；合法新增/归并，非覆盖回涨
  "styles/compat.css": { decls: 217, dupGroups: 0 },  // 260928：+10 = 内核卡片错误兜底块 .ne-card-error-fallback（把 lakeRuntime 里违反 #14 的内联样式收成类，双端共用）；260923：-4 = .tab-item 盒收编到 app/tabs.css；260926：+4 = 补上 .config-block__actions 布局（该 JSX 类此前无任何定义）；+3 = 复位 <button>.b3-list-item 浏览器默认边框/底色/居中（历史快照行等，合法新增非覆盖回涨）
  "styles/a11y.css": { decls: 9, dupGroups: 0 },   // P7-e：无障碍最高层（reduced-motion 契约；靠层序而非 !important 取胜）
  "features/attachment/attachment-preview.css": { decls: 82, dupGroups: 0 },   // 260928：+4 = 预览表面与图片 Lightbox 同源（backdrop-filter blur ×2）+ 工具栏浅色化的 border-bottom + macOS 红绿灯让位 .is-mac（合法新增，非覆盖回涨）
  "features/editor/image-lightbox.css": { decls: 57, dupGroups: 0 },
  "features/outline/outline.css": { decls: 259, dupGroups: 0 },
  "features/editor/selectionToolbar/selectionToolbar.css": { decls: 230, dupGroups: 0 },   // 261004 续：+7 = AI 弹窗右下角**垂直**拖拽把手 `.ai-dialog__grip`（只改高度）及其 hover；按钮行右侧留出把手位。此前 223：261004：AI 弹窗改为「外壳 max-height + 面板内滚动」——新增 .ai-dialog 纵向 flex + overflow、body 的 flex/min-height/overflow、bar 与 actions 的 flex:none（共 +8），并删掉 .ai-dialog__thread 的 max-height/overflow（-2）⇒ 净 +6。此前 217：260930「格式」父入口（+8）= 当前格式图标 + 颜色同款内核箭头的自写几何（含 width:auto —— 内核把按钮定死 26px，不放开箭头会被挤成 0 宽）+ 菜单项的图标/常规字号标签（内核 .ne-ui-item-content 是 16px/700，不适用）；再 +10 = 「标题1–6」二级菜单（贴行右侧展开 / is-flip 翻左侧 / 箭头格）。此前：+4 = 动作行换行（无遮罩浮层）；+16 = AI 助手对齐云端视觉（面板内边距/分隔/消息气泡/生成提示）；+43 = AI 助手对话框，表面/按钮复用 ln-dialog/ln-btn   // +1 = Lake 颜色面板的 native color input 覆盖整行透明命中层；+2 = __kmenu / __cardpop 各加 width:max-content
  // 260924 续：图片形态改内核卡片工具栏结构 + 云端顺序 ⇒ 删自有 menu/item/row/input/apply（-53），+4 外壳只定位；再 +45 = 图片弹窗（宽高/链接/边距）的 __cardpop 白卡 + 输入/复选/开关行 + 百分比段（均 --lake-* 令牌）；
  // 另：+18 = 浮栏 hover 说明（名称+快捷键）portal DOM 浮层；同批 -6 = 删「转为」下拉/heading 字形覆盖
  // 260924：+2 = 段落样式/字号去掉三角后，内核 .ne-ui-toolbar-select-value 固定 width:40px 需按内容收缩 + 收窄工具栏按钮内距（合法新增覆盖内核 legacy 层，非多层叠加）   // 260923 收敛：大纲样式从 feature.css/shell.css 并回本文件单一来源；再 -12 = 层级徽标改「两级语义+中性」，删掉 6 色相里 H3–H6 的 4 条规则   // 260923 W1-L2：-3   // 整边触发 + 去固定轨（合并重复材质规则）；260923 收敛：+2 + 删死 ::before —— 增强大纲样式从 feature.css 并回本文件单一来源（见下）
  // 260919：换成 FortuneSheet；容器尺寸 + 工具栏紧凑 + 无样式输入框补边框（标签样式已按用户要求回滚）
  // 260921：+2 = 单元格图片（禁指针事件 + object-fit: scale-down）——合法新增，非覆盖回涨
  // 260921：+2 = 单元格图片（禁指针事件 + object-fit: scale-down）
  // 260921 续：+35 = 去掉浮动图后新增的单元格图片工具弹窗（11 条）+ 细滚动条（11 条）+ 色条裁切与定位基准（2 条）
  //          —— 合法新增，非覆盖回涨
  "features/sheet/sheetEditor.css": { decls: 64, dupGroups: 0 },   // 260926：+2 = 修底部留白——.luckysheet-scrollbar-y 的 top/height 对齐可见单元格区（第三方内联 height:100%，用 !important 覆盖；合法新增）；+1 = 底部统计行给文档状态栏让位（.fortune-stat-area padding-right 读实测 --lake-sheet-status-w；合法新增，非覆盖回涨）
  // 260920：多维表编辑器（自研，v1）；+63 = 文本「扩大」浮窗；+37 = 行手柄/右键菜单/数据表列表；+82 = 网格线/列选择/列宽拖拽/日期选择器/范围选择/全收起切换（合法新增）
  // 260929：-30 = 分组样式按职责移出（→ bitableViews.css）+ 表底「添加记录」旧样式删除（改用共用 .bt-add-round）+ 删掉已冗余的 .bt-panel-add 组合规则；实测 1051（重复组 0）
  "features/bitable/bitableEditor.css": { decls: 1032, dupGroups: 0 },   //  261006 Phase 2.2: +5 = .bt-input 并入字段原语口径（控件静息边 + 圆角令牌 + hover/focus），高度保持 30  // 260930：统一实色卡（70 色 + 最近使用 + 自定义）新增 52 条声明。此前：-63 = 图标钮与菜单项收编 kit；+6 = 列宽/行高；+1 placeholder；+1 select text-align；+8 数据表行操作浮动
  // 260928 V01 多视图工作台：视图相关新规则一律进本文件（bitableEditor.css 已顶到基线，只允许变小）
  // 260928 V02：净 +4 = 看板配置面板的说明文案 .bt-panel-note（合法新增，非覆盖回涨）
  // 260928 T01：+4 = 表格底部列统计行贴底常驻（合法新增，非覆盖回涨）
  // 260928 T03：+2 = 多级分组层级缩进（变体选择器，合法新增）
  // 260929：分组样式按职责归并到本文件（复刻云端分组头 / 统计格 / 加进本组 / 组间间隔 / 折叠钮 hover）
  // 260929 续：+1 = 「添加」统一为共用圆形 + 钮 .bt-add-round（分组加进本组 / 表底添加记录 / 表头新增字段）
  // 260929 续 2：+8 = 分组头「分组值优先占位（flex）+ 首列统计固定长度 .bt-group-head-stat」
  // 260929 续 3：+5 = 分组头内容改**不进流**（.bt-group-inner 绝对定位），修 table-layout:auto 被长文本撑开列宽的错位 ⇒ 20 → 88
  // 260929 续 4：+17 = 分组汇总行固定 36px、未配置列的「统计」占位钮、底部汇总栏常驻并做薄（24px）
  // 260929 续 5：+5 = 表格撑满一屏（.bt-grid min-height + .bt-grid-filler 占位行），底部汇总栏才贴视图底
  // 260929 续 6：+5 = 「加进本组」不占行（行高 0 + 圆钮绝对定位悬浮在分组边界上）
  // 260929 续 7：+13 = 统计格改白底 chip + 共用 StatCell 内容样式（右对齐/▾/未配置 hover 显形），并删掉旧的「统计」占位钮规则
  "features/bitable/bitableViews.css": { decls: 141, dupGroups: 0 },  // 260930 续：+3 = 多维表右上角「更多」入口 .bt-viewbar-trailing（margin-left:auto 顶右）。原：+2 = 表头「新增字段」的 + 贴着左侧最后一列（`.bt-grid th.bt-th-add { text-align:left; padding-left:8px }`——th 默认居中把它甩到空白区中央；合法新增非覆盖回涨）。260929 续：+5 = 分组底衬（表头下 20px 间隙 .bt-group-head-gap、加进本组通道、组间、末尾占位行统一走 --lake-bg-subtle）；此前：单级分组卡片 + + 行下线
  // 260928 T02A：布尔 / 链接 / 评分 / 进度 单元格 + 字段类型 2 列网格（全新文件，合法新增）
  // 260928 续：+15 = 评分空星改实心（颜色换 --lake-border-strong）+ 进度条可拖动（轨道 position/cursor/touch-action、圆形把手 .bt-progress-thumb、只读隐藏把手）；合法新增非覆盖回涨
  // 260929：净 -3 = 进度数值框整体删除（随之删掉 appearance: textfield 与 ::-webkit-{inner,outer}-spin-button 两条声明）⇒ 回落 84 → 81
  "features/bitable/bitableFieldCells.css": { decls: 88, dupGroups: 0 },   // T02B.2：+17 = 关联选择器行/页脚（.bt-relation-row / -row-title / -foot / -count）−15 = T02B.1 的 .bt-relation-chips/-chip（已改为复用 .bt-option-* 原语）⇒ 净 +2；此前：+1 = 链接格的展示文本 .bt-link-text
  // 260928 V02 看板视图：分栏 / 卡片 / 折叠 / 新建分组（全部合法新增；空栏目必须能当投放区）
  // 260928 追加需求：卡片上的图片字段改为缩略图（.bt-kanban-thumbs/.bt-kanban-thumb，+9 合法新增）
  "features/bitable/bitableKanbanView.css": { decls: 97, dupGroups: 0 },   // 260930：-9 = 卡片附件**复用**表格那套 AttachmentChipList（删自养的 `.bt-kanban-thumb` 五条 + `.bt-kanban-files` 四条——行容器改挂共用的 `.bt-card-files`）
  // 260928 V03 画册视图：卡片网格 / 封面（裁剪·适应）/ 常规·紧凑（全部合法新增）
  // 260928 追加需求：封面改成可点按钮（就地重置原生按钮样式 + button 选择器），净 +4
  "features/bitable/bitableGalleryView.css": { decls: 62, dupGroups: 0 },
  // 260928 追加需求：表单「编辑表单 / 预览表单」双模的壳、题目顺序与直填直提布局（全部合法新增）
  "features/bitable/bitableFormView.css": { decls: 27, dupGroups: 0 },   // 260929：表单双模页签改 kit 原语后 -3（原 .seg 容器改由原语给几何，只留居中一条）
  "features/bitable/bitableRelationPicker.css": { decls: 145, dupGroups: 0 },   // 260930：+7 = 筛选编辑器在关联选择器里的内联布局（根编辑器/视图基线行）；此前 138：+30 = 关联选择器视图基线（只读筛选/排序行 + 视图分组表头/标签/计数）；此前 108：-7 = 选择器整表**复用**表格那套附件渲染（`AttachmentChipList`）
  // 260930：附件「文档类型」图标（用户：附件不展示名称/预览，直接展示类型）——11 个类型色 + 单元格小图标命中区 + 展开面板大图标 + hover 名称气泡（表面走 kit 的 .ln-tip，定位走 usePopoverPosition）；260930 后续：-14 = 撤掉「图标 + 文件名」形态（用户「看板视图不展示名称了」），+4 = `.bt-card-files`（看板/画册卡片共用的附件行容器，单一来源）
  "features/bitable/bitableFileIcon.css": { decls: 25, dupGroups: 0 },
  "features/bitable/bitableAiField.css": { decls: 32, dupGroups: 0 },   // 261004-b：-11 = 说明文字/包裹层归位到既有 .bt-field-label-text 与直排结构（删 prompt-wrap / warn / dialog-note / dialog-summary），字号/间距/圆角全量化令牌；@keyframes 不计数
  "features/bitable/bitableMarkdown.css": { decls: 17, dupGroups: 0 },   // 261005：Markdown 预览排版移到共用 components/markdown/markdown.css（60 → 17，只余本域单元格/展开面板样式）,   // 261004 续：+1 = .bt-md-cell 右缘留出展开按钮空隙（与文本格 26px 同义，两格不再一个压字一个不压）；此前 261004-b 建 59 = 删繁写头/自写小按钮/分段几何（改用 .ln-segment + .bt-secondary），只留单元格布局 + 预览排版；字号/间距全量化令牌
  "features/bitable/bitableFilterEditor.css": { decls: 150, dupGroups: 0 },   // 260930：筛选规则/分组树/日期动态值/多选值/增删菜单 + 面板最大高度/滚动（全新文件）
  "features/bitable/bitableFillRules.css": { decls: 67, dupGroups: 0 },   // 260930：条件填色配置与表格投影（全新文件）；+4 = 「无背景色」填色块居中态（flex 三项 + 图标色），合法新增
  // 260928 V04 日历视图：月网格 / 日程 chip / 今天与跨月态（全部合法新增）
  "features/bitable/bitableCalendarView.css": { decls: 75, dupGroups: 0 },
  // 260920：独立画板文档（kind=board）容器（铺满 tab 格 + 去掉卡片态边框/圆角 + 内核分包加载占位）
  "features/board/boardEditor.css": { decls: 12, dupGroups: 0 },   // 260926：+1 = 内核「主题选择」岛抬到文档状态栏上方（bottom 按状态栏几何派生）；+2 = .board-editor--{restoring,hidden} 共用 content-visibility:hidden + pointer-events:none（display:none 会钳掉滚动位置、visibility:hidden 会被内核工具条的 visible 顶掉；均合法新增非覆盖回涨）
  "components/historySnapshotPreview.css": { decls: 77, dupGroups: 0 },
  "components/markdown/markdown.css": { decls: 43, dupGroups: 0 },   // 261005：Markdown 轻量子集渲染的共用排版（从 bitableMarkdown.css 提出 43 条）.md-preview，bitable 与 AI 面板共用
  "features/ai/aiDialogParts.css": { decls: 8, dupGroups: 0 },   // 260926 新增：历史快照预览样式 = 事实清单 / 摘要小表格 / 只读编辑器槽位（.history-editor-preview 用「列方向 flex + 子项 flex:1 + min-height:320px 兜底」保证编辑器铺满，不依赖百分比高度；预览里隐藏表格统计行），令牌全走 --lake-*，由组件自身 import
  "styles/dialog.css": { decls: 203, dupGroups: 8 },   // +7 = .note-info-history-viewer 容器（260916 W-10：历史内联预览改只读 viewer，替代裸 dangerouslySetInnerHTML；合法新增非覆盖回涨）
  "styles/document-status.css": { decls: 94, dupGroups: 2 },   // 260930：+17 = 状态栏锁标识改可点（button 形态 + hover/focus）+ 解锁浮层内容类   // 260923 W1-L2：-8 = 被 shell 层 chrome.css 同名选择器覆盖；260926：+1 = 画板状态栏右缘对齐画板自己的 20px 栅格（[data-doc-kind="board"] 的 right；合法新增非覆盖回涨）
  "styles/components.css": { decls: 365, dupGroups: 1 },   // 260930：-2 = .settings-panel-large .settings-header（其 padding 早已被 overlay 层的 .floating-dialog-header 压死）按职责并到 overlay.css 单一来源。此前 260929：-45 = .ln-tabs* 页签整套收编到 kit 层单一来源（那边同时 +33）；260923 W1-L2：-15 = 被更高层同名选择器完全压制的规则   // 260916 S4：原 overlays.css 改名 + 并入 @keyframes lake-pop-in；260926 续：+4 = .sync-status-local-note
  "styles/tokens.css": { decls: 6, dupGroups: 0 },   // 260923 审计：按实测收紧（隔离/桥接规则拆走后基线一直是 83，围栏形同虚设）
  // 基础层域文件（260916 S3：原 styles.css 拆成入口 + 10 个域文件；数字 = 拆分当批实测，只允许变小）
  "styles/app/base.css": { decls: 33, dupGroups: 0 },   // 260923：+3 垂直几何令牌；同批删掉全仓零引用的 6 条死令牌（--ease-in-out/--dur-press/--shell-toolbar/--shell-radius/--shell-card-shadow/--shell-micro-card）   // 260923：+3 = 垂直几何令牌 --breadcrumb-height / --editor-toolbar-height / --tab-item-height（合法新增，非覆盖回涨）
  "styles/app/dialogs.css": { decls: 114, dupGroups: 7 },   // 260923 W1-L2：-9 = 被 overlay 层同名选择器完全压制   // +2 = 二级子菜单高度兜底（max-height + overflow-y，260916 修「导出选项被窗口底边裁掉」；与定位上移配套，合法新增非覆盖回涨）
  "styles/app/editor.css": { decls: 70, dupGroups: 0 },   // 260923 W1-L2：-1 = 字体规则被 tokens/feature 层覆盖   // P7-c：并入 styles/editor.css（选择器无交集 ⇒ 层叠等价）；+5 = maxView 适配；+4 = 锁定/解锁延迟销毁的旧实例层 .is-outgoing；+3 = 阅读态大纲只调位置（top/right）与「pinned 展开时正文让位」（260916）；260922：+1 = 正文左内距 56px（内核默认 40 不够块手柄簇 54；顺手修掉 H1 手柄出窗口）——合法新增；261005：+2 = 非活动标签改 content-visibility 保留布局，修切标签时内核 fit-width 表格重排"；261005：-1 = 非活动标签隐藏规则与 grid-area 上移到 tabs.css 统一（content-visibility 保留布局，修表格重排）"
  "styles/app/misc.css": { decls: 274, dupGroups: 0 },   // 260923 审计：按实测收紧
  "styles/app/panels.css": { decls: 94, dupGroups: 0 },   // 260926：-1 = 删掉 `.history-panel{position:relative}`（它把 .floating-dialog 的 position:fixed 顶掉 ⇒ 拖拽用的视口绝对坐标退化成"相对居中偏移"，每次拖/点都把居中量再叠一遍、弹窗跑出屏幕；护栏见 floatingDialogCoords.test.ts）
  "styles/app/quick-notes.css": { decls: 495, dupGroups: 8 },   // 260923 W1-L2：-3（260923）   // P7-c：并入 styles/quick-notes.css（选择器无交集 ⇒ 层叠等价）；原有：+24 列表版式、+30 媒体按类型、+49 卡片预览、+8 展开层限定、+19 卡片收起/展开、+98 列表页对齐云端（标签行/批量条/行⋯菜单/新建按钮）；+15 = 动作行改版（去掉两角布局的空占位，换成 --inline 靠右下 + 「取消」次级描边 + 卡片页脚内边距 + 展开态浮层）；260920：-48 = 删掉随「卡片预览改自研渲染」废弃的 .quick-note-image-grid / .quick-note-saved-images / .quick-note-saved-media 三套遗留规则；+1 = 分块视图卡片展开时退出定位上下文（展开层/页脚落到小记面板）；+8 = 展开态把保存失败/提示条抬到展开层之上（贴面板左下角的浮层）
  "styles/app/settings.css": { decls: 111, dupGroups: 0 },   // P7-c：并入 styles/settings.css（选择器无交集 ⇒ 层叠等价）；260926：-2 = 删掉死规则 `.settings-resize::after` 与 `.history-panel .settings-resize`（旧缩放手柄遗留，全仓无引用；它正是 `.history-panel{position:relative}` 的来历）
  "styles/app/shell.css": { decls: 408, dupGroups: 9 },   // 260923 收敛：-13 声明 / -1 重复组 = 大纲栏的壳层材质规则并回 features/outline/outline.css 单一来源   // 260923 W1-L2：-65 = 被 shell(层) chrome.css 同名选择器完全压制   // P7-c：并入 styles/shell.css（属性级交集为 0 ⇒ 层叠等价）；260917：另收掉 quick-notes 与基础层逐字重复的 margin 覆盖；260922：+1 = 非停靠态编辑区整体右移 53px 给左侧整边缩略图条让位（块手柄/标题折叠钮不再压缩略图；停靠态不加）——合法新增，非覆盖回涨
  "styles/app/tabs.css": { decls: 188, dupGroups: 0 },   // 260923 W1-L2：-9 = 被 shell 层 chrome.css 覆盖   // +1 = .tab-panels grid-template-columns:minmax(0,1fr)（根修：面板不被内容撑宽，多维表/表格才能横向滚动）
  "styles/app/vendor-board.css": { decls: 7, dupGroups: 0 },   // 260916：84 条与 vendor/drawnix-react-text.css 逐字节相同的规则已删（改为直接 import vendor 文件），余下是我们自己的 board-card 包装层
};

/** 极简 CSS 扫描器：只取「叶子样式规则」的声明，跳过注释/字符串/声明型 at-rule。 */
function scan(css: string): { decls: number; dupGroups: number; emptyRules: number; emptyAtRules: number } {
  const props = new Map<string, number>();   // `${selector}||${prop}` → 出现次数
  let decls = 0;
  let emptyRules = 0;
  let emptyAtRules = 0;
  const n = css.length;
  const skipWs = (j: number) => { while (j < n && /\s/.test(css[j])) j++; return j; };
  const findBlockEnd = (braceIdx: number) => {
    let depth = 0;
    let j = braceIdx;
    for (; j < n; j++) {
      const c = css[j];
      if (c === "/" && css[j + 1] === "*") { j = css.indexOf("*/", j + 2); if (j < 0) return n; j++; continue; }
      if (c === '"' || c === "'") { const q = c; j++; while (j < n && css[j] !== q) { if (css[j] === "\\") j++; j++; } continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return j; }
    }
    return n;
  };
  const walk = (from: number, to: number) => {
    let j = skipWs(from);
    while (j < to && j < n) {
      if (css[j] === "/" && css[j + 1] === "*") { j = skipWs(css.indexOf("*/", j + 2) + 2); continue; }
      const brace = css.indexOf("{", j);
      if (brace < 0 || brace > to) break;
      const head = css.slice(j, brace).trim();
      const end = findBlockEnd(brace);
      if (head.startsWith("@")) {
        if (!/^@(keyframes|-webkit-keyframes|font-face|page|property|charset|import|namespace|layer)\b/i.test(head)) {
          // 空的 @media/@supports 块同样是"清完声明没删壳"的残骸（留了占位注释的除外）。
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
          const key = `${head.replace(/\s+/g, " ")}||${prop}`;
          props.set(key, (props.get(key) || 0) + 1);
        }
        // 空壳规则（`选择器 { }`）：清完重复声明后留下的残骸，白占解析与维护成本。
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

describe("CSS 多层覆盖围栏", () => {
  it("每个样式文件的声明数与重复(选择器,属性)组数都不超过基线", () => {
    const grew: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8");
      const got = scan(css);
      const base = BASELINE[rel] ?? { decls: 0, dupGroups: 0 };
      if (got.decls > base.decls) grew.push(`${rel}: 声明数 ${base.decls} → ${got.decls}`);
      if (got.dupGroups > base.dupGroups) grew.push(`${rel}: 重复组 ${base.dupGroups} → ${got.dupGroups}`);
    }
    expect(grew, `以下文件新增了"多层覆盖"，请收敛到一处来源（见 HANDOFF §2.40/§2.41）：\n  ${grew.join("\n  ")}`).toEqual([]);
  });

  it("没有留下「空壳规则」（选择器 { }）——清完重复声明必须连壳一起删", () => {
    const shells: string[] = [];
    for (const rel of FILES) {
      const css = readFileSync(path.join(SRC, rel), "utf8");
      const { emptyRules, emptyAtRules } = scan(css);
      if (emptyRules) shells.push(`${rel}: 空规则 ${emptyRules} 条`);
      if (emptyAtRules) shells.push(`${rel}: 空 @media/@supports 块 ${emptyAtRules} 个`);
    }
    expect(shells, `以下文件留下空壳规则（260915 清理时留过一次，260916 已清除）：\n  ${shells.join("\n  ")}`).toEqual([]);
  });
});
