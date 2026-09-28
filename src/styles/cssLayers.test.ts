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
  "features/bitable/bitableKanbanView.css",   // V02：看板视图样式
  "features/bitable/bitableGalleryView.css",   // V03：画册视图样式
  "features/bitable/bitableCalendarView.css",   // V04：日历视图样式
  "features/bitable/bitableFormView.css",   // 表单双模（编辑/预览）样式
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
  "styles/index.css": { decls: 0, dupGroups: 0 },   // UI 重设计 P1：单入口（@layer 声明 + @import 编排，0 声明）
  "styles/feature.css": { decls: 105, dupGroups: 0 },  // 视觉优化 + 内核编辑器主题桥（lakex 跟随深色/暖色：含 .ne-ui-toolbar）；260923 收敛：-19 = 大纲侧栏的 .outline-* 覆盖并回 features/outline/outline.css 单一来源；260926：+2 = 修内核图标选择器（.ne-icon-symbol→.ne-icon）+ 直接覆盖工具条文字/原生大纲底色（内核浅色 schema 以未分层 <style> 注入、压过变量桥）；合法新增非覆盖回涨
  "styles/kit.css": { decls: 558, dupGroups: 0 },     // P4 组件库 + P5-g 面板件 + P5-h 控件 + P5-i 开关（实测）；260926：+8 = 补回 .b3-switch::after 被删源漏掉的滑块基线（content/position/top/transform/圆角等，合法新增：原先根本没有，非覆盖回涨）
  "styles/chrome.css": { decls: 506, dupGroups: 0 },  // P5 外壳 + S1+A + 整边缩略图槽；260922：+21 = 左缘「跟手把手」（隐形热区里浮出、Y 跟手、点击固定；热区 39→8 与去缩略图同批）；+10 = 目录「悬浮」改半幅浮卡（固定高度、顶贴面包屑下缘、四角圆角）；260926 续：+1 = 本地空间指示 .workspace-local（未配置云同步时尾段显示本地图标）；+3 = 表格文档状态栏并入 sheet 底部统计行（[data-doc-kind="sheet"] 的 bottom/height/min-height——高度基线在本层，同层就地加变体，合法新增非覆盖回涨）
  "styles/kernel-theme.css": { decls: 61, dupGroups: 0 },  // 260928：+1 = ④「内核品牌绿」例外（固定工具栏加号单独钉回 --lake-kernel-brand-green；浅/深分别走 Lake 原生 schema）—— 刻意的不统一，合法新增非覆盖回涨；原记录 —— 260926：内核 lakex --lakex-editor-* 集中映射（未分层）；60 = ①dark+warm 共用 43 + ②dark 反相 9 + ③light accent 8
  "styles/overlay.css": { decls: 154, dupGroups: 0 },  // P5-c 浮层 + P5-j 搜索 + P7-b .top-menu 定位 + 菜单项布局三件套；260926 Phase 1a：+47 = 浮层原语统一；+3 = 多维表收编 .ln-overlay-surface--raised（对话框内嵌套下拉抬层）+ .ln-scrim--right（记录详情侧边抽屉），合法新增非覆盖回涨——.ln-scrim 基座、.ln-dialog 布局/表面单一来源（并自 dialog.css 收编）、.ln-dialog__actions、.ln-menu/.ln-popover 表面（自 kit.css 收编）；合法新增/归并，非覆盖回涨
  "styles/compat.css": { decls: 222, dupGroups: 0 },  // 260928：+10 = 内核卡片错误兜底块 .ne-card-error-fallback（把 lakeRuntime 里违反 #14 的内联样式收成类，双端共用）；260923：-4 = .tab-item 盒收编到 app/tabs.css；260926：+4 = 补上 .config-block__actions 布局（该 JSX 类此前无任何定义）；+3 = 复位 <button>.b3-list-item 浏览器默认边框/底色/居中（历史快照行等，合法新增非覆盖回涨）
  "styles/a11y.css": { decls: 9, dupGroups: 0 },   // P7-e：无障碍最高层（reduced-motion 契约；靠层序而非 !important 取胜）
  "features/attachment/attachment-preview.css": { decls: 82, dupGroups: 0 },   // 260928：+4 = 预览表面与图片 Lightbox 同源（backdrop-filter blur ×2）+ 工具栏浅色化的 border-bottom + macOS 红绿灯让位 .is-mac（合法新增，非覆盖回涨）
  "features/editor/image-lightbox.css": { decls: 57, dupGroups: 0 },
  "features/outline/outline.css": { decls: 267, dupGroups: 0 },
  "features/editor/selectionToolbar/selectionToolbar.css": { decls: 135, dupGroups: 0 },   // 260924 点验：+2 = __kmenu / __cardpop 各加 width:max-content（固定浮栏内绝对定位 width:auto 会 shrink-to-fit 压窄子菜单 → 文字换行；合法新增，非覆盖回涨）
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
  "features/bitable/bitableEditor.css": { decls: 1081, dupGroups: 0 },   // 260928 续 3：+1 = .bt-th-more 改 visibility 显形（display:none 时 rect 恒为 0×0，当浮层锚点会开到左上角），合法新增非覆盖回涨。260928 续 2：+3 = 日期字段默认值三态容器 .bt-date-default（形态下拉 + 选「指定时间」时的日期选择器）。260928 续：净 +4 = 选中单元格改「只留高亮边框」（**删掉** .cell-selected 的 background 灰底，新增 1 条合成 box-shadow + 4 条按边自定义属性 sel-top/-bottom/-left/-right）—— 单格一圈、拖选只描外框。原记录 —— 260928：净 +8 = 行内附件格铺满单元格（.bt-attachment-cell/.bt-attachment-editor height:100%；同时**删掉** .bt-attachment-editor 的 border/border-radius/background 三条 —— 行内不再自画白框）+ 改名改「主名可编辑 / 扩展名固定」（.bt-attach-card-rename 拆成 wrapper + -input + -ext）。更早 —— 260926+ 附件展开面板：+39 = .bt-attach-expand / -head / -body / -dropzone / -grid / -add / -resize（面板表面与几何）+ 附件格 position:relative 与 ⤢ 显形规则；附件卡片改为「上=附件区 / 下=名称（可编辑）+下载」后净 +13（**删掉**悬停工具栏 .bt-attach-card-tools/-grip 与其 hover 规则、-head/-body，新增 .bt-attach-card-file/-meta/-rename/-icon）；+3 = 投放区 overflow:auto + 固定卡片轨道 grid-auto-rows:121px + scrollbar-gutter:stable；行单元格「行高绝对控制」净 +7（.bt-td 裁切 + 行内 .bt-option-label/.bt-attachment-cell/.bt-attachment-editor 一律 nowrap + chip flex:0 0 auto + 未知/关联/空值单行省略 + 行内纵向预算 .bt-attachment-cell padding:2px/.bt-attachment-editor height:28px，实测把 43px 的行压回 36px；同时**删掉** .bt-attachment-remove 4 条声明：行内不再有逐条删除）；合法新增非覆盖回涨（此前历史：260926 B4 分组 +19；260926 云端精仿 B1 行首三件套 +20；-36 = 删掉自建浮层表面/死规则，表面统一由 .ln-popover/.ln-menu/.ln-dialog 提供）；只允许再变小
  // 260928 V01 多视图工作台：视图相关新规则一律进本文件（bitableEditor.css 已顶到基线，只允许变小）
  // 260928 V02：净 +4 = 看板配置面板的说明文案 .bt-panel-note（合法新增，非覆盖回涨）
  // 260928 T01：+4 = 表格底部列统计行贴底常驻（合法新增，非覆盖回涨）
  // 260928 T03：+2 = 多级分组层级缩进（变体选择器，合法新增）
  "features/bitable/bitableViews.css": { decls: 20, dupGroups: 0 },
  // 260928 V02 看板视图：分栏 / 卡片 / 折叠 / 新建分组（全部合法新增；空栏目必须能当投放区）
  // 260928 追加需求：卡片上的图片字段改为缩略图（.bt-kanban-thumbs/.bt-kanban-thumb，+9 合法新增）
  "features/bitable/bitableKanbanView.css": { decls: 109, dupGroups: 0 },
  // 260928 V03 画册视图：卡片网格 / 封面（裁剪·适应）/ 常规·紧凑（全部合法新增）
  // 260928 追加需求：封面改成可点按钮（就地重置原生按钮样式 + button 选择器），净 +4
  "features/bitable/bitableGalleryView.css": { decls: 69, dupGroups: 0 },
  // 260928 追加需求：表单「编辑表单 / 预览表单」双模的壳、题目顺序与直填直提布局（全部合法新增）
  "features/bitable/bitableFormView.css": { decls: 30, dupGroups: 0 },
  // 260928 V04 日历视图：月网格 / 日程 chip / 今天与跨月态（全部合法新增）
  "features/bitable/bitableCalendarView.css": { decls: 75, dupGroups: 0 },
  // 260920：独立画板文档（kind=board）容器（铺满 tab 格 + 去掉卡片态边框/圆角 + 内核分包加载占位）
  "features/board/boardEditor.css": { decls: 14, dupGroups: 0 },   // 260926：+1 = 内核「主题选择」岛抬到文档状态栏上方（bottom 按状态栏几何派生）；+2 = .board-editor--{restoring,hidden} 共用 content-visibility:hidden + pointer-events:none（display:none 会钳掉滚动位置、visibility:hidden 会被内核工具条的 visible 顶掉；均合法新增非覆盖回涨）
  "components/historySnapshotPreview.css": { decls: 77, dupGroups: 0 },   // 260926 新增：历史快照预览样式 = 事实清单 / 摘要小表格 / 只读编辑器槽位（.history-editor-preview 用「列方向 flex + 子项 flex:1 + min-height:320px 兜底」保证编辑器铺满，不依赖百分比高度；预览里隐藏表格统计行），令牌全走 --lake-*，由组件自身 import
  "styles/dialog.css": { decls: 234, dupGroups: 8 },   // +7 = .note-info-history-viewer 容器（260916 W-10：历史内联预览改只读 viewer，替代裸 dangerouslySetInnerHTML；合法新增非覆盖回涨）
  "styles/document-status.css": { decls: 99, dupGroups: 2 },   // 260923 W1-L2：-8 = 被 shell 层 chrome.css 同名选择器覆盖；260926：+1 = 画板状态栏右缘对齐画板自己的 20px 栅格（[data-doc-kind="board"] 的 right；合法新增非覆盖回涨）
  "styles/components.css": { decls: 433, dupGroups: 1 },   // 260923 W1-L2：-15 = 被更高层同名选择器完全压制的规则（kit/shell 层已定义）   // 260916 S4：原 overlays.css 改名 + 并入 @keyframes lake-pop-in（+1 声明，位置不变）；260926 续：+4 = 本地空间弹窗正文 .sync-status-local-note（合法新增非覆盖回涨）
  "styles/tokens.css": { decls: 6, dupGroups: 0 },   // 260923 审计：按实测收紧（隔离/桥接规则拆走后基线一直是 83，围栏形同虚设）
  // 基础层域文件（260916 S3：原 styles.css 拆成入口 + 10 个域文件；数字 = 拆分当批实测，只允许变小）
  "styles/app/base.css": { decls: 33, dupGroups: 0 },   // 260923：+3 垂直几何令牌；同批删掉全仓零引用的 6 条死令牌（--ease-in-out/--dur-press/--shell-toolbar/--shell-radius/--shell-card-shadow/--shell-micro-card）   // 260923：+3 = 垂直几何令牌 --breadcrumb-height / --editor-toolbar-height / --tab-item-height（合法新增，非覆盖回涨）
  "styles/app/dialogs.css": { decls: 137, dupGroups: 7 },   // 260923 W1-L2：-9 = 被 overlay 层同名选择器完全压制   // +2 = 二级子菜单高度兜底（max-height + overflow-y，260916 修「导出选项被窗口底边裁掉」；与定位上移配套，合法新增非覆盖回涨）
  "styles/app/editor.css": { decls: 70, dupGroups: 0 },   // 260923 W1-L2：-1 = 字体规则被 tokens/feature 层覆盖   // P7-c：并入 styles/editor.css（选择器无交集 ⇒ 层叠等价）；+5 = maxView 适配；+4 = 锁定/解锁延迟销毁的旧实例层 .is-outgoing；+3 = 阅读态大纲只调位置（top/right）与「pinned 展开时正文让位」（260916）；260922：+1 = 正文左内距 56px（内核默认 40 不够块手柄簇 54；顺手修掉 H1 手柄出窗口）——合法新增
  "styles/app/misc.css": { decls: 288, dupGroups: 0 },   // 260923 审计：按实测收紧
  "styles/app/panels.css": { decls: 98, dupGroups: 0 },   // 260926：-1 = 删掉 `.history-panel{position:relative}`（它把 .floating-dialog 的 position:fixed 顶掉 ⇒ 拖拽用的视口绝对坐标退化成"相对居中偏移"，每次拖/点都把居中量再叠一遍、弹窗跑出屏幕；护栏见 floatingDialogCoords.test.ts）
  "styles/app/quick-notes.css": { decls: 516, dupGroups: 8 },   // 260923 W1-L2：-3（260923）   // P7-c：并入 styles/quick-notes.css（选择器无交集 ⇒ 层叠等价）；原有：+24 列表版式、+30 媒体按类型、+49 卡片预览、+8 展开层限定、+19 卡片收起/展开、+98 列表页对齐云端（标签行/批量条/行⋯菜单/新建按钮）；+15 = 动作行改版（去掉两角布局的空占位，换成 --inline 靠右下 + 「取消」次级描边 + 卡片页脚内边距 + 展开态浮层）；260920：-48 = 删掉随「卡片预览改自研渲染」废弃的 .quick-note-image-grid / .quick-note-saved-images / .quick-note-saved-media 三套遗留规则；+1 = 分块视图卡片展开时退出定位上下文（展开层/页脚落到小记面板）；+8 = 展开态把保存失败/提示条抬到展开层之上（贴面板左下角的浮层）
  "styles/app/settings.css": { decls: 120, dupGroups: 0 },   // P7-c：并入 styles/settings.css（选择器无交集 ⇒ 层叠等价）；260926：-2 = 删掉死规则 `.settings-resize::after` 与 `.history-panel .settings-resize`（旧缩放手柄遗留，全仓无引用；它正是 `.history-panel{position:relative}` 的来历）
  "styles/app/shell.css": { decls: 424, dupGroups: 9 },   // 260923 收敛：-13 声明 / -1 重复组 = 大纲栏的壳层材质规则并回 features/outline/outline.css 单一来源   // 260923 W1-L2：-65 = 被 shell(层) chrome.css 同名选择器完全压制   // P7-c：并入 styles/shell.css（属性级交集为 0 ⇒ 层叠等价）；260917：另收掉 quick-notes 与基础层逐字重复的 margin 覆盖；260922：+1 = 非停靠态编辑区整体右移 53px 给左侧整边缩略图条让位（块手柄/标题折叠钮不再压缩略图；停靠态不加）——合法新增，非覆盖回涨
  "styles/app/tabs.css": { decls: 193, dupGroups: 0 },   // 260923 W1-L2：-9 = 被 shell 层 chrome.css 覆盖   // +1 = .tab-panels grid-template-columns:minmax(0,1fr)（根修：面板不被内容撑宽，多维表/表格才能横向滚动）
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
