/**
 * dock 展开面板（M-04 从 EditorDock.tsx 拆出，纯搬移/零行为变化）：
 * 「＋」插入 / 「更多」/ 「Aa」字体 / 表情四个面板的 JSX、条目清单（INSERT_GROUPS/moreRows）与面板动作
 * （表情/颜色/画板/格式刷）全部收在本文件；props 只收「命令执行器 + 当前值」，不自建面板状态。
 * 面板开合状态机/外壳高/输入法/焦点守卫不在本文件：useEditSurface.ts（AGENTS §3「移动端 Lake 输入面 = 底部 dock」、§7#23）。
 * 护栏：mobileBoardInsert / dockFontSizeStepper / dockColorRows / dockInsertChoosers（源码级，随拆分迁到本文件）。
 */
import type { ReactNode } from "react";
import { Bold, Italic, Underline, Strikethrough, Code, Quote, List, ListOrdered, ListTodo, Minus, Undo, Redo, Eraser, Camera, Image as ImageIcon, Paperclip, Music, Video, Smile, Tag, CalendarDays, Table2, SquareCode, Highlighter, Columns2, FoldVertical, Link2, FileSymlink, Lock, Calendar, Sigma, Superscript, Subscript, Paintbrush, ArrowRightFromLine, IndentIncrease, IndentDecrease, Pilcrow, AlignLeft, AlignCenter, AlignRight, AlignJustify } from "lucide-react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { beginFormatPainter, formatPaintService } from "./formatPainter";
import { showToast } from "../ui/toastBus";
import { MARK_COMMANDS, BLOCK_INSERT_COMMANDS, STYLE_BLOCKS, FONT_SIZE_OPTIONS } from "../../features/editor/editorCommands";
import { cardValueFromBoardDoc, createBoardDoc, type BoardPreset } from "../../core/boardDoc";
import { QUICK_TEXT_COLORS, MOBILE_BOARD_LIGHT, MOBILE_BOARD_SOLID } from "../../core/colorPalette";
// 「Aa」面板的取值型命令（字号/对齐/字色/背景色）与链接，全部复用既有单一来源（不另造一套；契约全文见 dockCommandState.ts）
// 注：移动端**色板**不再走内核色卡适配器 LakeColorBoard，而是照语雀排布自己画 2×7 圆点格
//（用户 261012 定稿「色板照抄语雀、不用那么多颜色」）；颜色仍全部取自 core/colorPalette.ts 的内核色阶。
import { normalTextColor, paletteDefaultValue, persistentColor, rememberColor, type ColorVariant } from "../../features/editor/selectionToolbar/colorMemory";
import { colorApplyCommand } from "../../features/editor/selectionToolbar/selectionToolbarModel";
// 卡内 textarea 等非正文输入面的「光标处插入」与插入命令的「卡片保护区」（261123：插表情把整卡顶掉）。
import { activeTextEntryField, insertTextIntoField } from "../../features/editor/fieldInsert";
// 表情选择器与小记写作卡**共用同一套**（AGENTS §3#14：同一交互语义只有一套）；这里只复用它的实现。
import { EmojiPanel } from "../ui/EmojiPanel";
// 字号步进器（261104）：移动端共用控件，几何/交互与表格 T 面板同款；档位算术在它自己的纯函数里（有单测）。
import { FontSizeStepper } from "../ui/FontSizeStepper";
import { LineHeightStepper } from "../ui/LineHeightStepper";
import type { PanelMode } from "./useEditSurface";
import { lineHeightValue, readCommandValue, type SelectionValues } from "./dockCommandState";

/** dock 面板条目的动作；`anchor` = 触发按钮（表情选择器要锚定它）。 */
type DockAction = (anchor?: HTMLElement | null) => void;
/** 面板条目形状（`+ ` /「更多」两个网格共用，保证几何与置灰态单一来源）。
 *  `glyph` = 用数字/字形代替图标（B6：行高 6 档没有专属图标，直接显示 1 / 1.15 / …） */
type DockItem = { label: string; Icon?: typeof ImageIcon; glyph?: string; run?: DockAction; disabled?: boolean };

/** 格式命令 → lucide 图标（正文面板用图标而非文字，对齐思源移动端） */
const COMMAND_ICONS: Record<string, typeof Bold> = {
  // 行内代码用 \`</>\`（Code），与「＋」面板的**代码块卡片**（SquareCode，方框内 code）一眼可辨（用户 261012）
  bold: Bold, italic: Italic, underline: Underline, strikethrough: Strikethrough, code: Code,
  quote: Quote, unorderedList: List, orderedList: ListOrdered, taskList: ListTodo,
  hr: Minus, undo: Undo, redo: Redo,
  // B6（261017）：清除格式放进行内标记行（与 B/I/U/S/行内代码同一行）
  clearFormat: Eraser,
};

/** 移动端字号档（261104 用户批准：改「− 当前 +」步进器、搬进「更多」面板与行高同组；
 *  261012 原为「Aa」面板最底部一行 8 钮 —— 面板内容 354px > 可视 312px，正好把这一行裁掉）。
 *  仍从内核 12 档 `FONT_SIZE_OPTIONS` 里掐掉最小的 12/13 与最大的 40/48 ⇒ 中间 8 档（14…32）。
 *  取值全部来自内核档位，不新增字号。要再少/再多只改这一处。 */
const MOBILE_FONT_SIZES: readonly number[] = FONT_SIZE_OPTIONS.slice(2, -2);

/** 文本绘图卡的默认 initValue（与 vendor src/cards/TextToDiagram/index.ts 的 initValue 同形；照抄最小 mnermaid 示例）。 */
const MERMAID_DEFAULT_VALUE: Record<string, unknown> = {
  code: "flowchart TD\n    A[Start] --> B[Decision]\n    B -->|Yes| C[End]",
  type: "mermaid",
  cardHeight: 500,
  showEditor: true,
  showPreview: true,
};

/** 对齐（内核 `alignment`：left/center/right/justify；移动端 261104 补齐 justify）。 */
const ALIGN_ITEMS: ReadonlyArray<{ value: "left" | "center" | "right" | "justify"; label: string; Icon: typeof Bold }> = [
  { value: "left", label: "左对齐", Icon: AlignLeft },
  { value: "center", label: "居中", Icon: AlignCenter },
  { value: "right", label: "右对齐", Icon: AlignRight },
  // 261104：内核 alignment 接受 justify（设备实测 ne-alignment=justify / text-align:justify），补第 4 档。
  { value: "justify", label: "两端对齐", Icon: AlignJustify },
];

/** dock 面板的「命令执行器 + 当前值」面（EditorDock 编排侧传入；本文件不自建状态）。 */
export interface DockPanelsProps {
  /** 当前打开的面板（null = 关）。 */
  panelMode: PanelMode;
  /** 退场期继续按上一次的面板渲染（useEditSurface.renderedPanel）。 */
  renderedPanel: PanelMode;
  /** 收起过渡期（面板内容保持原样直到被键盘盖住，见 useEditSurface.closingHold）。 */
  closing: boolean;
  closingHold: boolean;
  /** `.med-panel-inner` 退场 transition 结束（= useEditSurface.onPanelTransitionEnd）。 */
  onPanelTransitionEnd: () => void;
  /** 命令执行器：runPanel = 还选区 → 执行 → 快照（useEditorCommandDispatcher）。 */
  runPanel: (command: string, ...args: unknown[]) => void;
  /** 内核命令原始执行（画板插入要拿返回值 = 新卡 id）。 */
  exec: (command: string, ...args: unknown[]) => unknown;
  restoreSelection: () => void;
  snapshotSelection: () => void;
  refreshActive: () => void;
  /** 收面板（hide = 只收键盘、留住光标；格式刷/画板插入用它，不拉起输入法）。 */
  closePanel: (mode?: "restore" | "hide") => void;
  /** 面板间切换（表情 ⇄ 插入）。 */
  togglePanel: (mode: Exclude<PanelMode, null>) => void;
  /** 媒体/表格插入入口（EditorDockHost 提供）。 */
  onInsertImage?: () => void;
  onInsertAttachment?: () => void;
  onInsertAudio?: () => void;
  onInsertVideo?: () => void;
  onInsertTable?: () => void;
  onInsertCamera?: () => void;
  /** 「链接」条目：打开底部链接浮窗（浮窗与选区簿记在 EditorDock）。 */
  openLinkSheet: () => void;
  /** 「分栏」条目：锚定气泡（run 把被点条目当锚点传进来）。 */
  openColumnsChooser: (anchor?: HTMLElement | null) => void;
  /** 取值型命令当前值（高亮/回显唯一来源，见 dockCommandState.SelectionValues）。 */
  activeValues: SelectionValues;
  /** 命令生效高亮判据（工具栏与面板共用同一实现，EditorDock 传入）。 */
  isOn: (name: string) => boolean;
  /** 色板取默认色/持久色、格式刷记格式都要内核实例。 */
  editor: LakeEditorInstance | null;
}

export function DockPanels({
  panelMode, renderedPanel, closing, closingHold, onPanelTransitionEnd,
  runPanel, exec, restoreSelection, snapshotSelection, refreshActive, closePanel, togglePanel,
  onInsertImage, onInsertAttachment, onInsertAudio, onInsertVideo, onInsertTable, onInsertCamera,
  openLinkSheet, openColumnsChooser, activeValues, isOn, editor,
}: DockPanelsProps) {
  if (!panelMode && !closing) return null;

  /** 内核日历卡 `currentDate` 形态 = YYYYMMDD 整数（HANDOFF §0(五) 实测）。 */
  const dateStamp = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  /** 表情：选中后按内核原意插**文本**（`unicodeEmoji` 卡是死占位，见 LAKEX-CONTRACT §5.29）。
   *  面板本身在 `.med-panel` 里就地渲染（EmojiPanel fill），所以这里只负责插。
   *  261123（用户现场「插表情把加密文本整卡顶掉」）：
   *  ① 焦点在卡内 textarea / 输入框等**非正文输入面** ⇒ 插进该输入面的光标处（setRangeText + input 事件），
   *     一个内核命令都不发——绝不让「替换选区」语义碰到卡片；
   *  ② 其余情况交给 exec 层的卡片保护区（选区触卡 ⇒ 明确不动作 + 提示，不静默吞卡）。 */
  const insertEmoji = (emoji: string) => {
    const field = activeTextEntryField();
    if (field) {
      insertTextIntoField(field, emoji);
      try { field.focus(); } catch { /* 输入面已卸载：插入已完成，不阻断 */ }
      return;
    }
    runPanel("insertAtSelection", "text/lake", `<span>${emoji}</span>`);
  };

  /**
   * 应用颜色：语义**完全复用桌面那一套**（colorApplyCommand = 内核 descriptor 的 onEvent('select')：
   * 文字色取到正文色 ⇒ clearColor、背景色空/等于当前 ⇒ clearBgColor），"最近使用色"也与桌面共用同一记忆
   * （colorMemory）。空串 = 面板里的「默认/无填充」行 ⇒ 取内核默认色。
   */
  const pickColor = (raw: string, variant: ColorVariant) => {   // variant 必填：字色/背景色各走各的，别再有隐含默认
    if (!editor) return;
    const value = raw || paletteDefaultValue(editor, variant);
    rememberColor(editor, variant, value);
    const { command, arg } = colorApplyCommand(variant, {
      visual: value,
      persistent: persistentColor(editor, value),
      normalText: normalTextColor(editor),
      currentBg: readCommandValue(editor, "bgColor"),
    });
    runPanel(command, ...(arg === undefined ? [] : [arg]));
  };

  /**
   * 「＋」面板的插入项清单（用户 261015 亲自指定顺序与分组）。
   *
   * **两组（8 + 11）**：① 拍照 图片 附件 音频 视频 表情 状态 日期；② 表格 引用 分割线 代码块 高亮块 分栏 折叠块 链接 文档引用 加密文本 日历。
   * **4 列**下：① 8 项 = 2 行**零空洞**；② 11 项 = 3 行（末行 3 项、1 个空位）。两组之间用更大的间距分隔。
   */
  const INSERT_GROUPS: ReadonlyArray<{ key: string; items: ReadonlyArray<DockItem> }> = [
    // ① 媒体与时间（用户 261015 定：拍照 · 图片 · 附件 · 音频 · 视频 · 表情 · 状态 · 日期 · 日历）
    { key: "media", items: [
      { label: "拍照", Icon: Camera, run: () => onInsertCamera?.() },
      { label: "图片", Icon: ImageIcon, run: () => onInsertImage?.() },
      { label: "附件", Icon: Paperclip, run: () => onInsertAttachment?.() },
      { label: "音频", Icon: Music, run: () => onInsertAudio?.() },
      { label: "视频", Icon: Video, run: () => onInsertVideo?.() },
      // 表情：**在面板区内展开**（用户 261013：像输入法那样占满展开区、固定高度不跳），不再弹浮层。
      { label: "表情", Icon: Smile, run: () => togglePanel("emoji") },
      { label: "状态", Icon: Tag, run: () => runPanel("insertCard", "label") },
      { label: "日期", Icon: CalendarDays, run: () => runPanel("insertCard", "dateCard", { date: Date.now() }, false) },
    ] },
    // ② 剩下的（表格 · 引用 · 分割线 · 代码块 · 高亮块 · 分栏 · 折叠块 · 链接 · 文档引用）
    { key: "block", items: [
      { label: "表格", Icon: Table2, run: () => onInsertTable?.() },
      { label: "引用", Icon: Quote, run: () => runPanel("quote") },
      { label: "分割线", Icon: Minus, run: () => runPanel("hr") },
      { label: "代码块", Icon: SquareCode, run: () => runPanel("insertCard", "codeblock") },
      // 高亮块：内核里是 `execCommand("alert", type)`（不是 insertCard）。
      // 261104 用户口径：**不要再弹类型选择**——高亮块被选中后内核自带色板可改颜色/类型（见设备截图），
      // 插入时只给默认档（tips）即可。
      { label: "高亮块", Icon: Highlighter, run: () => runPanel("alert", "tips") },
      // 标签用「分栏」而不是「分栏卡片」：窄格下 4 个字会被省略号截断（桌面端仍叫分栏卡片）。
      // 261104：2/3/4 栏改成**贴着条目**的锚定气泡（run 收到被点条目当锚点）。
      { label: "分栏", Icon: Columns2, run: (anchor) => openColumnsChooser(anchor) },
      { label: "折叠块", Icon: FoldVertical, run: () => runPanel("collapse") },
      // 链接从「Aa」面板移到这里（用户 261012：链接融合到 + 号里）；点它在本面板内联展开链接编辑行
      { label: "链接", Icon: Link2, run: () => openLinkSheet() },
      { label: "文档引用", Icon: FileSymlink, run: () => runPanel("insertCard", "customBlock", { $name: "lake-note-ref", $htmlStr: "", noteId: "", title: "" }, true) },
      // 加密文本（261023）：自定义卡「lake-locked-text」，与桌面「+」面板同一张卡（卡值是密文，明文从不进正文）
      { label: "加密文本", Icon: Lock, run: () => runPanel("insertCard", "customBlock", { $name: "lake-locked-text", $htmlStr: "" }, true) },
      // 日历从第一组挪到这里（用户 261015：「把日历放到第二组」）
      { label: "日历", Icon: Calendar, run: () => runPanel("insertCard", "calendar", { currentDate: dateStamp(), colorIndex: 0, schedules: {}, __spacing: "both" }, true) },
    ] },
  ];
  /** 文档内画板族插入：内核 insertCard 的返回值就是新卡 id；随后用官方的 focusCard 把选区落到卡上。
   *  先 restoreSelection 保证在当前光标处插入；面板走 hide 档（收起但不放回输入法），否则画板一插入就会拉起键盘。 */
  const insertBoardCard = (cardName: string, preset: BoardPreset) => {
    restoreSelection();
    const value = {
      $name: cardName,
      $htmlStr: "",
      ...cardValueFromBoardDoc(createBoardDoc(preset)),
      cardHeight: 560,
    };
    // custom-card 插件的正式入口 = 插一张 customBlock，卡值里的 $name 指向注册名；
    // 直接 insertCard('drawing-board', …) 不会命中 customBlock 插件（实测 no-op）。
    const cardId = exec("insertCard", "customBlock", value, true);
    snapshotSelection();
    refreshActive();
    closePanel("hide");
    if (typeof cardId === "string" && cardId) {
      window.setTimeout(() => {
        exec("focusCard", cardId);
        refreshActive();
      }, 80);
    }
  };

  /**
   * 「格式刷」= **内核服务调用，不是命令**（261104 设备实测 + bundle 实据，见 formatPainter.ts 头注释）：
   * 先还选区 → 让内核按当前光标记录格式（已在刷形态则取消）→ **hide 档收面板**（不放回键盘，否则键盘盖住目标）。
   * 记录之后由内核自管「点目标即应用、应用后退出」，dock 不再做第二步，也**不要再无参 execCommand('paintFormat')**。
   */
  const onFormatPainter = () => {
    restoreSelection();
    // 已在刷形态 ⇒ 本次点击 = 取消（与桌面点同一颗按钮一致），不用等收面板。
    const alreadyActive = !!formatPaintService(editor)?.hasPaintFormat?.();
    snapshotSelection();
    refreshActive();
    closePanel("hide");
    // ⚠️ 记录必须**晚于面板收起后的焦点/选区事件**：内核 formatPainter 在 afterExecCommand('selection')
    // 且未处于鼠标按下时，会把「已记录格式」立刻应用到当前选区并（once=true）退出刷形态
    // ⇒ 收面板/还焦点产生的 selection 命令会把刚记录的刷子当场消费掉，表现为点了没反应。
    window.setTimeout(() => {
      const result = beginFormatPainter(editor);
      if (result === "unavailable") {
        // 兜底：内核换代丢了服务时保持旧行为并明说（v1.99.0 不会走到这里）。
        exec("paintFormat");
        showToast("当前编辑器不支持格式刷", { type: "error" });
      } else if (result === "cancelled") {
        showToast("已退出格式刷");
      } else {
        showToast("格式刷已开启，点选目标文字");
      }
    }, alreadyActive ? 0 : 160);
  };

  // 「更多」面板：**按行分组**（261017 二改用户点单；261104 二次收口）——公式/上下标/格式刷一行、缩进三项一行、
  // **字号 + 行高同一行**（两枚「− 当前 +」步进器）、画图占位一行。
  // 文本增强命令全部走内核 `renderer.execCommand`。
  // 行条目两种形态：`items` = 图标/文字/数值按钮行；`custom` = 整块自定义控件（步进器），共用同一 .med-f-row 几何。
  // ⚠️ 撤销/重做已移到**主工具栏**（261017：工具栏最右、更多之后、键盘之前），不再在本面板。
  const moreRows: ReadonlyArray<{ key: string; label?: string; items?: ReadonlyArray<DockItem>; custom?: () => ReactNode }> = [
    { key: "inline", items: [
      { label: "公式", Icon: Sigma, run: () => runPanel("insertCard", "math", null, true) },
      { label: "上标", Icon: Superscript, run: () => runPanel("sup") },
      { label: "下标", Icon: Subscript, run: () => runPanel("sub") },
      // 格式刷是「取格式 → 点目标」的两步模式：**激活后必须收面板、放回输入法**，否则用户无法点目标
      { label: "格式刷", Icon: Paintbrush, run: onFormatPainter },
    ] },
    { key: "indent", items: [
      // 261104 澄清文案：内核 firstIndent 是**整篇**把 root 下所有 p 设 text-indent（只 set 不 remove，无法撤销）
      // ⇒ 名字改成「全文首行缩进」，避免被当成"当前段"的开关。
      { label: "全文首行缩进", Icon: ArrowRightFromLine, run: () => runPanel("firstIndent") },
      { label: "减少缩进", Icon: IndentDecrease, run: () => runPanel("outdent") },
      { label: "增加缩进", Icon: IndentIncrease, run: () => runPanel("indent") },
    ] },
    // 字号 + 行高（261104 二次收口，用户点单）：两行合并成**一行**，各自「− 当前 +」步进器。
    // 字号 = 内核 8 档（MOBILE_FONT_SIZES，px 入参）；行高 = 内核 lineHeight 取值域 + 「默认」档。
    // 行高命令：数值直接传；「默认」= **不传参**调用（设备实测 execCommand("lineHeight") 可清 ne-line-height，传 "default" 会抛错）。
    { key: "size-line", custom: () => (
      <>
        <div className="med-f-card med-f-step"><FontSizeStepper value={activeValues.fontSize} sizes={MOBILE_FONT_SIZES} onPick={(px) => runPanel("fontsize", px)} /></div>
        <div className="med-f-card med-f-step"><LineHeightStepper value={lineHeightValue(activeValues.lineHeight)} onPick={(v) => (v === "default" ? runPanel("lineHeight") : runPanel("lineHeight", v))} /></div>
      </>
    ) },
    // 画图族：纯文字（用户 261017）；Drawnix 四类共用同一画板内核，261019 P0 解禁。
    // 文本绘图仍单独评估（不是同一套 Drawnix 场景），先保持置灰，不在本批偷偷放出一个未验收入口。
    { key: "drawing", items: [
      { label: "画板", run: () => insertBoardCard("drawing-board", "drawing") },
      { label: "流程图", run: () => insertBoardCard("flowchart-board", "flowchart") },
      { label: "UML 图", run: () => insertBoardCard("uml-board", "uml") },
      { label: "思维导图", run: () => insertBoardCard("drawing-mindmap-board", "mindmap") },
      // 261114（用户点单「移动端可以做」）：文本绘图解禁。卡注册名 = vendor customCard 的 `name`（不是 slash 的 `custom-text-to-diagram`）；
      // 走 customBlock 正式入口（与画板族同一条 insertCard 路径），initValue 必须带 code/type/cardHeight/showEditor/showPreview。
      { label: "文本绘图", run: () => runPanel("insertCard", "customBlock", { $name: "text-to-diagram", $htmlStr: "", ...MERMAID_DEFAULT_VALUE }, true) },
    ] },
  ];

  /** 「＋」面板的插入条目（方块：图标 + 文字）。 */
  const insBtn = ({ label, Icon, run, disabled }: DockItem) => (
    <button
      key={label}
      className="med-ins-item"
      aria-label={label}
      disabled={!!disabled}
      title={disabled ? label + "（移动端暂未支持）" : undefined}
      onClick={run ? (e) => run(e.currentTarget) : undefined}
    >
      {Icon ? <Icon size={22} /> : null}
      <span className="med-ins-label">{label}</span>
    </button>
  );
  /** 「更多」面板的行条目：图标 + 文字 / 数值（行高档）/ 纯文字（画图占位）；几何与「Aa」面板同款。 */
  const rowBtn = ({ label, Icon, glyph, run, disabled }: DockItem) => (
    <button
      key={label + (glyph ?? "")}
      className="med-f-btn"
      aria-label={glyph ? label + " " + glyph : label}
      disabled={!!disabled}
      title={disabled ? label + "（移动端暂未支持）" : label}
      onClick={run ? (e) => run(e.currentTarget) : undefined}
    >
      {glyph ? <span className="med-f-glyph">{glyph}</span> : Icon ? (<><Icon size={18} /><span className="med-f-label">{label}</span></>) : <span className="med-f-label">{label}</span>}
    </button>
  );

  /** 面板里的命令条目（行内 / 块级 / 历史共用一套渲染，避免三段重复 JSX）。 */
  const cmdBtn = (c: { name: string; label: string }) => {
    const Icon = COMMAND_ICONS[c.name];
    return (
      <button key={c.name} className={"med-f-btn" + (isOn(c.name) ? " med-f-on" : "")} onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>
        {Icon ? <Icon size={20} /> : c.label}
      </button>
    );
  };
  // 「一卡一组、一行最多两卡」的分组（用户 261012 定：照语雀那样拆开排布）
  // 行内标记：加粗/斜体/下划线/删除线/**行内代码**（用户 261012：行内代码恢复，就放在这一行）
  // B6（261017 用户点单）：行内标记行 = B / I / U / S / 行内代码 + **清除格式**
  const inlineMarks = [...MARK_COMMANDS, { name: "clearFormat", label: "清除格式", group: "mark" as const }];
  // 列表：与「对齐」同处一行（用户 261012：对齐和列表放一行）
  const listItems = BLOCK_INSERT_COMMANDS.filter((c) => c.name === "unorderedList" || c.name === "orderedList" || c.name === "taskList");
  /** 取值型高亮：对齐（内核默认返回空串 = 左对齐）、字色（空串 = 正文色）、背景色。 */
  const alignActive = (value: string) => (activeValues.alignment || "left") === value;
  const textColorActive = (hex: string) => !!activeValues.color && activeValues.color.toLowerCase() === hex.toLowerCase();
  const noTextColor = !activeValues.color;
  /**
   * 色板 = **背景色**（261014 解耦）：过去这一块由 colorVariant 驱动 —— 切到字色时它回显的是字色，
   * A 排点一下它就跟着标红，用户看到的就是"两行串联"。现在两行各自独立：
   *   A 排 = 文字色（回显 activeValues.color）；色板 = 背景色（回显 activeValues.bgColor）。
   */
  const boardColorActive = (hex: string) => !!activeValues.bgColor && activeValues.bgColor.toLowerCase() === hex.toLowerCase();
  /** 首格「无填充」的当前态。 */
  const boardClearActive = !activeValues.bgColor || activeValues.bgColor === "transparent";
  /** 背景色色块（圆形，照语雀）。 */
  const boardSwatch = (hex: string) => (
    <button
      key={hex}
      className={"med-f-sw" + (boardColorActive(hex) ? " is-on" : "")}
      style={{ background: hex }}
      onClick={() => pickColor(hex, "bg")}
      aria-label={"背景色 " + hex}
      title={hex}
    />
  );

  return (
    <>
      {/* 展开面板：占住键盘区（键盘不显示），工具栏停在它上沿；关闭过渡期（closing）继续挂载。
          261019(八) 用户报「收面板→键盘 闪烁」：restore 档不能提前播滑出/淡出 —— 键盘是**从面板上方滑上来**的，
          面板内容保持可见（closingHold）直到被键盘盖住；否则键盘还在上升、面板先变成一块空白（实测约 200ms 空块）。
          只有输入法迟迟不来时才放行滑出（useEditSurface 的 1800ms 兜底）。 */}
      <div className="med-panel" data-open={panelMode || closingHold ? "1" : "0"} data-closing={closing ? "1" : undefined} data-kind={renderedPanel ?? "none"} aria-hidden={!panelMode} onMouseDown={(e) => {
        // 默认 preventDefault 保选区（点面板条目不丢内核选区）；但**表单输入必须放行**（261119 设备报障：
        // 链接编辑行的文本/链接输入框点得见聚焦态、打字进不去、键盘不出）—— mousedown 默认动作 = 聚焦 +
        // 落光标 + 唤起软键盘，被 cancel 后 label 激活兜出的程序化 focus 不弹键盘（AGENTS §7#17）。
        // 与桌面 SelectionToolbar 容器同一豁免口径（260924「输入即关闭 / 写不进去」），别再收窄/放宽选择器。
        const t = e.target as HTMLElement | null;
        if (t && typeof t.closest === "function" && t.closest("input, textarea, .ne-link-editor")) return;
        e.preventDefault();
      }}>
        <div className="med-panel-inner" onTransitionEnd={(event) => { if (event.target === event.currentTarget) onPanelTransitionEnd(); }}>
          {renderedPanel === "emoji" ? (
            /* 表情：**占满面板区**（输入法式；.med-panel 已是固定高）——不弹浮层、不随内容跳高度。 */
            <EmojiPanel bucket="input" fill onPick={insertEmoji} onBack={() => togglePanel("insert")} />
          ) : renderedPanel === "insert" || renderedPanel === "more" ? (
            <>
              {/* 「＋」= **方块网格**（261015 用户点单：照图1 的方块样式；两组 8+10、3 列）。
                  「更多」= **分行白卡**（261017 二改用户点单：公式/上下标/格式刷一行、缩进三项一行、行高一行、画图占位一行；
                  261104 在缩进与行高之间加「字号」步进器行 —— 用户批准把字号从「Aa」面板搬过来与行高同组）。 */}
              {renderedPanel === "insert" ? (
                <div className="med-ins-groups">
                  {INSERT_GROUPS.map((g) => (
                    <div className="med-ins-grid med-ins-grid--tile" key={g.key}>{g.items.map(insBtn)}</div>
                  ))}
                </div>
              ) : (
                <div className="med-font-panel">
                  {moreRows.map((row) => (
                    <div className="med-f-row" key={row.key}>
                      {row.custom ? row.custom() : (
                        <div className="med-f-card" data-count={row.items?.length ?? 0}>
                          {row.label ? <span className="med-f-rowlabel">{row.label}</span> : null}
                          {row.items?.map(rowBtn)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* 261120：链接编辑已改为底部浮窗（见 EditorDock 的 LinkEditorSheet），面板内不再内联输入行。 */}
            </>
          ) : (
            <div className="med-font-panel">
              {/* 段落样式（独占一行） */}
              <div className="med-f-row">
                <div className="med-f-card" data-count={STYLE_BLOCKS.length}>
                  {STYLE_BLOCKS.map((b) => (
                    <button key={b.value} className="med-f-btn" onClick={() => runPanel("style", b.value)} aria-label={b.label} title={b.label}>
                      {b.value === "p" ? <Pilcrow size={20} /> : b.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 行内标记（独占一行）——行内代码/链接按用户 261012 移出本面板：
                  代码块在「+」面板已有，链接融合进「+」面板 */}
              <div className="med-f-row">
                <div className="med-f-card" data-count={inlineMarks.length}>{inlineMarks.map(cmdBtn)}</div>
              </div>

              {/* 对齐 ｜ 列表（用户 261012：两者放一行；**261015 用户点单：左右对调** ⇒ 对齐在左、列表在右）
                  注：「引用 / 分割线」已删（+ 面板已有）、「撤销 / 重做」已移到**主工具栏**（261017） */}
              <div className="med-f-row">
                <div className="med-f-card" data-count={ALIGN_ITEMS.length}>
                  {ALIGN_ITEMS.map(({ value, label, Icon }) => (
                    <button key={value} className={"med-f-btn" + (alignActive(value) ? " med-f-on" : "")} onClick={() => runPanel("alignment", value)} aria-label={label} title={label}><Icon size={20} /></button>
                  ))}
                </div>
                <div className="med-f-card" data-count={listItems.length}>{listItems.map(cmdBtn)}</div>
              </div>

              {/* 字色：一排 A（默认 + 常用色）—— **只属于文字色**（261014：与下面背景色板互不影响；
                  原先末位还有个"背景色入口"用来切色板变体，正是两行串联的根源，已删除）。 */}
              <div className="med-f-row">
                <div className="med-f-card med-f-colors" data-count={QUICK_TEXT_COLORS.length + 1}>
                  <button className={"med-f-btn med-f-a" + (noTextColor ? " med-f-on" : "")} onClick={() => pickColor("", "text")} aria-label="默认颜色" title="默认颜色">A</button>
                  {QUICK_TEXT_COLORS.map((c) => (
                    <button key={c} className={"med-f-btn med-f-a" + (textColorActive(c) ? " med-f-on" : "")} style={{ color: c }} onClick={() => pickColor(c, "text")} aria-label={"字色 " + c} title={"字色 " + c}>A</button>
                  ))}
                </div>
              </div>

              {/* 背景色板（261014 解耦：**只属于背景色**，与上面那排 A 各管各的）—— 2 行 × 7 格，照语雀排布：
                  浅色行首格 = 无填充，其余 6 淡色；第二行 7 实色。颜色全部取内核色阶
                  （core/colorPalette.ts 的 MOBILE_BOARD_*，逐色 ΔE 就近映射，不自己造色）。 */}
              <div className="med-f-row">
                <div className="med-f-card med-f-board">
                  <div className="med-f-board-row">
                    <button
                      className={"med-f-sw med-f-sw--none" + (boardClearActive ? " is-on" : "")}
                      onClick={() => pickColor("", "bg")}
                      aria-label="无填充"
                      title="无填充"
                    />
                    {MOBILE_BOARD_LIGHT.map(boardSwatch)}
                  </div>
                  <div className="med-f-board-row">{MOBILE_BOARD_SOLID.map(boardSwatch)}</div>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  );
}
