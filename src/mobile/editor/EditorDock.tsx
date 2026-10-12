/**
 * 移动端编辑态底部 dock（app 化适配，对齐 prototype/index.html 编辑态交互）：
 * - 主工具栏悬浮在输入法上方：插入(+)、Aa（字体）、B、列表、待办、收起键盘
 * - 展开面板**占住输入法键盘区（键盘不显示）**：insert（图片/拍照/附件/表格/音频/视频/高亮块/状态/引用/分割线/代码块）+ font（块级/行内/对齐/颜色/背景）
 * - 键盘收起（dock 隐藏 + 右下角重显按钮）
 * 格式命令走 Lake renderer.execCommand（文本 ne-* 属性；块级 style "h1"/"p" 等）。
 *
 * 2026-09 修订（对齐 Lake 官方移动工具栏）：
 * - 类别按钮（+ / Aa）展开面板时变成 ×（关闭）并触发触感反馈；
 * - 命令按钮（B/列表/待办 及面板内 mark/block）随光标/选区**实时高亮**（queryCommandState + getSelectionAttrs）；
 * - `--mobile-dock-space` = 当前 --kb-offset（面板/键盘占位）+ 工具栏，正文底部留白始终跟着占位走。
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListTodo, Keyboard, X, Image as ImageIcon, Camera, Paperclip, Table2, Quote, Minus, Code, SquareCode, Music, Video, Highlighter, Tag, Undo, Redo, Pilcrow, Type, MoreHorizontal, Columns2, FoldVertical, Calendar, CalendarDays, Smile, FileSymlink, Sigma, Shapes, Workflow, Network, GitFork, FileCode2, AlignLeft, AlignCenter, AlignRight, Link2 } from "lucide-react";
import { lakeBridge, type LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { MARK_COMMANDS, BLOCK_INSERT_COMMANDS, HISTORY_COMMANDS, STYLE_BLOCKS, FONT_SIZE_OPTIONS } from "../../features/editor/editorCommands";
import { QUICK_TEXT_COLORS, MOBILE_BOARD_LIGHT, MOBILE_BOARD_SOLID, contrastTextColor, isHexColor } from "../../core/colorPalette";
// 「Aa」面板的取值型命令（字号/对齐/字色/背景色）与链接，全部复用既有单一来源（本文不另造一套）
// 注：移动端**色板**不再走内核色卡适配器 LakeColorBoard，而是照语雀排布自己画 2×7 圆点格
//（用户 261012 定稿「色板照抄语雀、不用那么多颜色」）；颜色仍全部取自 core/colorPalette.ts 的内核色阶。
import { normalTextColor, paletteDefaultValue, persistentColor, rememberColor, type ColorVariant } from "../../features/editor/selectionToolbar/colorMemory";
import { colorApplyCommand, toFontSize, unwrapValue } from "../../features/editor/selectionToolbar/selectionToolbarModel";
import { applyTextLink, captureLinkTarget, isValidLink, type LinkEditorTarget } from "../../features/editor/selectionToolbar/linkEditor";
import { KLinkEditor } from "../../features/editor/selectionToolbar/kernelUiAtoms";
import { useKeyboard } from "../useKeyboard";
// 表情选择器与小记写作卡**共用同一套**（AGENTS §3#14：同一交互语义只有一套）；这里只复用它的实现。
import { openEmojiPicker } from "../../features/quickNotes/quickNoteToolbarWidgets";

type PanelMode = "insert" | "font" | "more" | null;

/** dock 面板条目的动作；`anchor` = 触发按钮（表情选择器要锚定它）。 */
type DockAction = (anchor?: HTMLElement | null) => void;
/** 面板条目形状（`+ ` /「更多」两个网格共用，保证几何与置灰态单一来源）。 */
type DockItem = { label: string; Icon: typeof ImageIcon; run?: DockAction; disabled?: boolean };

/** 选区/焦点节点是否属于编辑器正文（面板命令只认正文选区） */
function isEditorNode(node: Node | null): boolean {
  let el: Element | null = node ? (node.nodeType === 1 ? (node as Element) : (node as ChildNode).parentElement) : null;
  while (el) { if (el.nodeType === 1 && (el as HTMLElement).isContentEditable) return true; el = el.parentElement; }
  return false;
}

/** blur 正文焦点以收起输入法（面板要占键盘区；Lake 命令内部异步重聚焦时也靠它压回）。 */
function blurActiveEditable(): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && typeof el.closest === "function" && el.closest('[contenteditable="true"]')) { try { el.blur(); } catch { /* 忽略 */ } }
}

/** 格式命令 → lucide 图标（正文面板用图标而非文字，对齐思源移动端） */
const COMMAND_ICONS: Record<string, typeof Bold> = {
  // 行内代码用 \`</>\`（Code），与「＋」面板的**代码块卡片**（SquareCode，方框内 code）一眼可辨（用户 261012）
  bold: Bold, italic: Italic, underline: Underline, strikethrough: Strikethrough, code: Code,
  quote: Quote, unorderedList: List, orderedList: ListOrdered, taskList: ListTodo,
  hr: Minus, undo: Undo, redo: Redo,
};

/** 移动端「Aa」面板的字号档（用户 261012：**做成一行、只留常用、掐头去尾**）。
 *  从内核 12 档 `FONT_SIZE_OPTIONS` 里掐掉最小的 12/13 与最大的 40/48 ⇒ 中间 8 档，一行放得下（实测每格 ≈48px）。
 *  取值仍全部来自内核档位，不新增字号。要再少/再多只改这一处。 */
const MOBILE_FONT_SIZES: readonly number[] = FONT_SIZE_OPTIONS.slice(2, -2);

/** 对齐（内核 `alignment`：left/center/right；语雀移动端也只给这三档）。 */
const ALIGN_ITEMS: ReadonlyArray<{ value: "left" | "center" | "right"; label: string; Icon: typeof Bold }> = [
  { value: "left", label: "左对齐", Icon: AlignLeft },
  { value: "center", label: "居中", Icon: AlignCenter },
  { value: "right", label: "右对齐", Icon: AlignRight },
];

/** 需要监测实时状态（生效高亮）的命令 */
const STATE_COMMANDS = ["bold", "italic", "underline", "code", "quote", "unorderedList", "orderedList", "taskList", "undo", "redo"] as const;

/** 行内标记命令：生效检测走 DOM 计算样式（lakex 的 queryCommandState 对 mark 恒返回 -1，不可靠）。 */
const MARK_NAMES = new Set(["bold", "italic", "underline", "code"]);

/** 读取光标/选区处某个标记是否生效（基于 DOM 计算样式，lakex 版本无关）：加粗 font-weight≥600、斜体 font-style、下划线、行内代码。 */
function activeMarkFromDom(name: string): boolean {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  if (!node) return false;
  let el: Element | null = node.nodeType === 1 ? (node as Element) : (node as ChildNode).parentElement;
  const editor = el?.closest?.('[contenteditable="true"]');
  if (!editor || !el) return false;
  for (let cur: Element | null = el; cur && editor.contains(cur); cur = cur.parentElement) {
    const s = getComputedStyle(cur);
    if (name === "bold" && parseInt(s.fontWeight) >= 600) return true;
    if (name === "italic" && s.fontStyle === "italic") return true;
    if (name === "underline" && s.textDecorationLine.includes("underline")) return true;
    if (name === "code" && (cur.tagName === "CODE" || /\bne-code\b|\bne-inline-code\b/.test(cur.className || ""))) return true;
    if (cur === editor) break;
  }
  return false;
}

/**
 * 读取某命令当前是否生效：
 * - 行内标记（bold/italic/underline/code）→ DOM 计算样式（可靠，见 activeMarkFromDom）；
 * - 块级/历史（quote/列表/待办/undo/redo）→ lakex renderer.queryCommandState（返回 1= 生效，-1= 不确定）；
 * 均做了安全访问，查不到即视为未生效（不误点亮）。 */
function isCommandActive(editor: LakeEditorInstance | null, name: string): boolean {
  if (MARK_NAMES.has(name)) return activeMarkFromDom(name);
  if (!editor) return false;
  const ed = editor as unknown as {
    queryCommandState?: (n: string) => boolean | number;
    renderer?: { queryCommandState?: (n: string) => boolean | number };
  };
  try {
    const v = ed.queryCommandState?.(name) ?? ed.renderer?.queryCommandState?.(name);
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;   // 1=生效，0=未生效，-1=不确定 → 不当生效处理
  } catch { /* 忽略 */ }
  return false;
}

/** 选区处的「取值型」命令状态（字号/对齐/字色/背景色）—— 面板高亮与色板回显的唯一来源。 */
interface SelectionValues { fontSize: number | null; alignment: string; color: string; bgColor: string }
const EMPTY_VALUES: SelectionValues = { fontSize: null, alignment: "", color: "", bgColor: "" };
function sameValues(a: SelectionValues, b: SelectionValues): boolean {
  return a.fontSize === b.fontSize && a.alignment === b.alignment && a.color === b.color && a.bgColor === b.bgColor;
}
/** 读内核查询值（解数组、异常归 undefined；调用方自行把 undefined/null 当"无值"，不误点亮）。 */
function readCommandValue(editor: LakeEditorInstance, name: string, arg?: unknown): unknown {
  try { return unwrapValue(editor.queryCommandValue?.(name, ...(arg === undefined ? [] : [arg]))); } catch { return undefined; }
}
function valueText(editor: LakeEditorInstance, name: string): string {
  const v = readCommandValue(editor, name);
  return v === null || v === undefined ? "" : String(v);
}

/** 光标/选区变化时刷新各命令生效状态（selectionchange + 命令执行后主动 refresh）。 */
function useActiveCommandStates(editor: LakeEditorInstance | null) {
  const [states, setStates] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<SelectionValues>(EMPTY_VALUES);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const refresh = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const next: Record<string, boolean> = {};
    for (const name of STATE_COMMANDS) next[name] = isCommandActive(ed, name);
    setStates((prev) => (STATE_COMMANDS.some((k) => prev[k] !== next[k]) ? next : prev));
    // 字号必须带第二参 false 才是「生效字号」（不带第二参时正文返回 null，与桌面固定栏同源）；
    // ⚠️ 内核把字号序列化成 lake-fontsize-N（N = px × 0.75，不是 px）⇒ **不许解析 class**，只能读 queryCommandValue。
    const nextValues: SelectionValues = {
      fontSize: toFontSize(readCommandValue(ed, "fontsize", false)),
      alignment: valueText(ed, "alignment"),
      color: valueText(ed, "color"),
      bgColor: valueText(ed, "bgColor"),
    };
    setValues((prev) => (sameValues(prev, nextValues) ? prev : nextValues));
  }, []);
  useEffect(() => {
    const onSel = () => refresh();
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [refresh]);
  // editor 就绪/切换时刷新一次（selectionchange 不会为首次光标触发）
  useEffect(() => { if (editor) refresh(); }, [editor, refresh]);
  return { states, values, refresh };
}

export interface EditorDockProps {
  editor: LakeEditorInstance | null;
  /** 编辑态才渲染 */
  editing: boolean;
  /** 退出编辑态（工具栏“完成”） */
  /** 触发图片插入（选文件 → 上传 → 插入 Lake） */
  onInsertImage?: () => void;
  /** 触发附件插入 */
  onInsertAttachment?: () => void;
  /** 触发音频卡片插入 */
  onInsertAudio?: () => void;
  /** 触发视频卡片插入 */
  onInsertVideo?: () => void;
  /** 触发表格插入 */
  onInsertTable?: () => void;
  /** 触发拍照（相机直出图片） */
  onInsertCamera?: () => void;
}

/** 执行 Lake 命令（renderer 通道；editor 未就绪静默）。
 *  ⚠️ **必须回传内核返回值**：链接的「这条不行就换另一条」判定靠它（linkEditor.ts），
 *  吞掉返回值会退化成"两条都算成功" = 静默 no-op。 */
function useEditorExec(editor: LakeEditorInstance | null) {
  return (cmd: string, ...args: unknown[]) => {
    try {
      const renderer = lakeBridge(editor ?? undefined).renderer;
      return renderer?.execCommand?.(cmd as never, ...args);
    } catch { return undefined; /* 命令失败不阻断 */ }
  };
}

export function EditorDock({ editor, editing, onInsertImage, onInsertCamera, onInsertAttachment, onInsertAudio, onInsertVideo, onInsertTable }: EditorDockProps) {
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  /**
   * 「Aa」面板内的两个**内联展开**件（用户 261012 定：全套走语雀方式 —— 色板与链接编辑都在面板内展开，
   * 不弹层、不做二级面板）：
   *   - colorVariant：下方色板当前在编辑文字色还是背景色（由色卡行末位的方块切换）；
   *   - linkOpen：链接编辑行是否展开（复用内核 .ne-link-editor 那套 UI 与共享判定 linkEditor.ts）。
   */
  const [colorVariant, setColorVariant] = useState<ColorVariant>("text");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkSrc, setLinkSrc] = useState("");
  const linkTargetRef = useRef<LinkEditorTarget>({ range: null, selected: "" });

  /** 面板打开期间的选区快照：命令执行前后都还原，才能连续加粗→倾斜→下划线 */
  const savedRangeRef = useRef<Range | null>(null);
  /** 只有"用户手指点在正文里"才关面板；程序性 focusin（Lake 命令内部重新聚焦）不算 */
  const userTappedEditorRef = useRef(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const { base, innerHeight, offset, height, keyboardOpen } = useKeyboard();
  /**
   * 展开面板占住的「键盘区」高度（打开瞬间捕获键盘高度，之后不随键盘动画变；0=已收起）。
   *
   * 交互口径（用户 260914 澄清）：**面板覆盖键盘那块区域 = 键盘不显示**，工具栏停在面板上沿不动。
   * 打开时 blur 收起键盘、面板占住腾出来的区域；收起时 focusEditor 把键盘放回来。
   * 让这段"键盘⇄面板"的交接看起来自然的是**面板自身的进出场动画**（见 .med-panel-inner）：
   * 面板背景整个键盘区先铺满（不露空档），内容再从下方滑入 / 滑出，不再出现"瞬间空一块再弹键盘"。
   */
  const [panelHeight, setPanelHeight] = useState(0);
  /** 关闭过渡期间继续挂载面板（否则键盘上升时会先露出一块空白背景） */
  const [closing, setClosing] = useState(false);
  const usable = panelMode || closing
    ? Math.max(0, Math.round(innerHeight - base + panelHeight), offset)
    : offset;
  /** 面板内容：退场动画期间继续用上一次的模式渲染，否则收起瞬间内容先消失、滑动看不见 */
  const [renderedPanel, setRenderedPanel] = useState<Exclude<PanelMode, null>>("insert");
  useEffect(() => {
    if (panelMode) setRenderedPanel(panelMode);
  }, [panelMode]);
  const exec = useEditorExec(editor);
  const execRef = useRef(exec);
  execRef.current = exec;
  const { states: activeStates, values: activeValues, refresh: refreshActive } = useActiveCommandStates(editor);

  // 退出编辑态时复位
  useEffect(() => {
    if (!editing) setPanelMode(null);
  }, [editing]);

  // 收起面板（切换/关闭）时复位两个内联件：色板回到文字色、链接编辑器收起并清空草稿。
  useEffect(() => {
    if (!panelMode) { setLinkOpen(false); setLinkText(""); setLinkSrc(""); setColorVariant("text"); }
  }, [panelMode]);

  // 用户点击可编辑正文（要打字）→ 立即收起面板、恢复输入法键盘，绝不让「面板展开 + 键盘」同时出现。
  // 面板项按钮已 onMouseDown preventDefault 不抢焦点，故焦点落回 contenteditable 只可能是用户点了编辑区。
  useEffect(() => {
    const isEditor = (node: EventTarget | null) => {
      const t = node as HTMLElement | null;
      return !!t && typeof t.closest === "function" && !!t.closest('[contenteditable="true"]');
    };
    const onPointerDown = (e: PointerEvent) => { if (isEditor(e.target)) userTappedEditorRef.current = true; };
    const onFocusIn = (e: FocusEvent) => {
      if (!isEditor(e.target)) return;
      if (!userTappedEditorRef.current) return;          // 命令内部重新聚焦 → 面板不关、键盘不再弹
      userTappedEditorRef.current = false;
      setPanelMode(null);                                // 用户点了正文 → 收起面板（键盘保持不动）
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => { document.removeEventListener("pointerdown", onPointerDown, true); document.removeEventListener("focusin", onFocusIn); };
  }, []);

  // 注：原先的「面板⇄输入法硬互斥兜底」已删除——那条规则是"面板占键盘区"时代的补丁
  // （键盘被顶回来会把面板压成细条）。新口径下面板挂在工具栏上沿、键盘本就常驻，
  // 内核命令后重聚焦正文只会让键盘保持原样，不再需要 blur 兜底（blur 反而会引出输入法动画）。

  // 把 dock 占用的底部空间暴露给正文容器，让正文底部留白（光标不被工具栏/面板盖住）。
  // 面板⇄输入法硬互斥兜底（260911 修复，随"面板占键盘区"口径一起保留）：runPanel 执行命令后
  // Lake 会异步重聚焦正文 → 输入法被顶回，会把占着键盘区的面板压成细条盖住工具栏。
  // 以实测键盘状态驱动（任何机型/输入法都成立）：只要面板开着而键盘又弹出，立刻再收一次，
  // 并把面板高度抬到实测键盘高度（打开瞬间的快照在带候选条的真机上会偏小）。
  useEffect(() => {
    if (!panelMode || !keyboardOpen) return;
    setPanelHeight((h) => Math.max(h, height));
    blurActiveEditable();
  }, [panelMode, keyboardOpen, height]);

  // 底部被占 = 当前 --kb-offset（面板=键盘区高；无面板=键盘上移量）+ 工具栏。
  // 作用域放到 dock 的父容器（.doc-pane / .mobile-document），而非全局 documentElement——避免多 tab 实例互相覆盖。
  useEffect(() => {
    if (!editing) return;
    const toolbar = 54; // .med-toolbar 高 48 + 与面板的 6px 间隙
    const space = Math.round(usable) + toolbar;
    const root = dockRef.current?.parentElement ?? document.documentElement;
    root.style.setProperty("--mobile-dock-space", `${space}px`);
    return () => { root.style.removeProperty("--mobile-dock-space"); };
  }, [editing, panelMode, usable]);

  // 编辑态常驻底部工具栏（完成/插入/字体等）；键盘弹出时悬浮在键盘上方。
  if (!editing) return null;

  const focusEditor = () => {
    try { const ce = document.querySelector<HTMLElement>(".doc-pane.active [contenteditable]"); ce?.focus(); } catch { /* 忽略 */ }
    try { lakeBridge(editor ?? undefined).renderer?.execCommand?.("focus" as never); } catch { /* 忽略 */ }
  };
  /** 收起输入法（面板要占键盘区）：只 blur 正文里的焦点 */
  const dismissIme = () => blurActiveEditable();
  /** 记下当前选区（Range 克隆在 blur 之后仍可用于还原） */
  const snapshotSelection = () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0 && isEditorNode(sel.anchorNode)) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    const r = savedRangeRef.current;
    const sel = document.getSelection();
    if (!r || !sel || !r.startContainer.isConnected) return;
    sel.removeAllRanges();
    sel.addRange(r);
  };

  /**
   * 展开/收起面板：**面板占住键盘区（键盘不显示）**，工具栏停在面板上沿不动（用户 260914 澄清口径）。
   * 关键顺序（同原实现）：同一帧挂面板 + 抬起 --kb-offset，**下一帧才 blur** 收键盘 ——
   * 这样键盘是在已经铺满该区域的面板背后滑走的，不会出现"面板与键盘对撞"的闪烁。
   * 收起时改为「先动画收面板 + 同时放键盘，动画结束再清 panelHeight」：
   * 键盘上升期间那一带仍有面板背景兜着，不会先露一块空白再弹键盘（这正是用户说的"不自然"）。
   */
  const togglePanel = (mode: Exclude<PanelMode, null>) => {
    if (panelMode === mode) {                                         // 再点一次 = 关面板并放回键盘
      setPanelMode(null);
      setClosing(true);
      focusEditor();                                                  // 键盘与面板动画同时开始
      window.setTimeout(() => { setClosing(false); setPanelHeight(0); }, 220); // 略长于 .med-panel-inner 的 160ms
      return;
    }
    snapshotSelection();
    setClosing(false);
    if (!panelMode) setPanelHeight(Math.max(Math.round(height), 280)); // 只在"从关到开"时捕获键盘高度
    setPanelMode(mode);                                               // insert ↔ font 切换沿用原高度 → 工具栏不抖
    requestAnimationFrame(() => { if (panelMode || true) dismissIme(); });
  };

  // 工具栏行内命令（bold/列表/待办）：按钮 onMouseDown preventDefault 不抢焦点 →
  // 焦点/选区留在正文，命令作用在正确位置，键盘不收；执行后再记一次选区，供面板连续使用。
  const runInline = (cmd: string, ...args: unknown[]) => { exec(cmd, ...args); snapshotSelection(); refreshActive(); };
  // 面板项命令：**还原选区 → 执行 → 再记选区 → 面板保持打开**（加粗后还能接着点倾斜/下划线）。
  // dismissIme：面板占着键盘区，命令后内核会异步重聚焦正文把键盘顶回来，必须再收一次（260911 修过）。
  const runPanel = (cmd: string, ...args: unknown[]) => {
    restoreSelection();
    exec(cmd, ...args);
    snapshotSelection();
    dismissIme();
    refreshActive();
  };

  // 收起键盘：手动收起（编辑态保留）。有关闭面板则先收起面板（不恢复键盘——用户明确要收起）。
  const dismissKeyboard = () => {
    setPanelMode(null);
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* 忽略 */ }
  };
  const showKeyboard = () => { focusEditor(); };

  /** 内核日历卡 `currentDate` 形态 = YYYYMMDD 整数（HANDOFF §0(五) 实测）。 */
  const dateStamp = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  /** 表情：选中后按内核原意插**文本**（`unicodeEmoji` 卡是死占位，见 LAKEX-CONTRACT §5.29）。 */
  const pickEmoji = (anchor?: HTMLElement | null) => {
    snapshotSelection();
    openEmojiPicker(anchor ?? null, (emoji) => runPanel("insertAtSelection", "text/lake", `<span>${emoji}</span>`));
  };

  /**
   * 应用颜色：语义**完全复用桌面那一套**（colorApplyCommand = 内核 descriptor 的 onEvent('select')：
   * 文字色取到正文色 ⇒ clearColor、背景色空/等于当前 ⇒ clearBgColor），"最近使用色"也与桌面共用同一记忆
   * （colorMemory）。空串 = 面板里的「默认/无填充」行 ⇒ 取内核默认色。
   */
  const pickColor = (raw: string, variant: ColorVariant = colorVariant) => {
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

  /** 展开/收起链接编辑行：打开时捕获当前选区（我们自己的输入框会抢走内核选区，确认前必须还回去）。 */
  const toggleLinkEditor = () => {
    if (linkOpen) { setLinkOpen(false); return; }
    snapshotSelection();
    const captured = captureLinkTarget();
    linkTargetRef.current = captured.range
      ? captured
      : { range: savedRangeRef.current, selected: savedRangeRef.current ? savedRangeRef.current.toString().trim() : "" };
    setLinkText(linkTargetRef.current.selected);
    setLinkSrc("");
    setLinkOpen(true);
  };

  /**
   * 确认链接：判定与选区还原全在共享实现里（桌面浮栏调的是同一份）。
   *
   * ⚠️ **移动端必须"失败重试一次"**（261012 设备实测）：我们的链接输入框拿到焦点后，
   * 还原选区 + `focus` + **同一个 tick 内**执行 `link`，内核会返回 false、链接不落地；
   * 同样还原、**等一拍**再执行就成功（实测返回卡 id 且写出 `<a href>`）。
   * 内核要等一拍才认"刚从我们输入框交还回来的选区"。
   * 桌面浮栏不受影响、保持同步执行 ⇒ 这条重试只放在移动端这一侧。
   */
  const confirmLink = () => {
    const target = linkTargetRef.current;
    const text = linkText;
    const src = linkSrc;
    const finish = (applied: boolean) => {
      if (applied) { setLinkOpen(false); setLinkText(""); setLinkSrc(""); }
      snapshotSelection();
      dismissIme();
      refreshActive();
    };
    // 先立即试一次（选区本就还在编辑器里时这一步就成功）；失败说明内核选区尚未就绪 ⇒ 160ms 后重试一次。
    const attempt = (delay: number) => {
      window.setTimeout(() => {
        const applied = applyTextLink({ editor: editor ?? {}, run: execRef.current, target, text, src });
        if (!applied && delay === 0) attempt(160);
        else finish(applied);
      }, delay);
    };
    attempt(0);
  };

  /**
   * 「＋」面板的分组排布（用户 261012 定稿：**按功能类型分组、组序与组内序都按使用频率**）。
   *
   * 5 组 / **6 行**：图片与文件(1 行) · 文本块(2 行) · 媒体｜布局(1 行，一行两卡) · 小工具(1 行) · 关联(1 行)
   * ⇒ 行数与改造前的平铺网格**完全相同**，不新增滚动。词汇借内核/语雀的既有分类（布局 / 小工具），不新造概念。
   */
  const INSERT_GROUPS: ReadonlyArray<{ key: string; items: ReadonlyArray<DockItem> }> = [
    { key: "file", items: [
      { label: "图片", Icon: ImageIcon, run: () => onInsertImage?.() },
      { label: "拍照", Icon: Camera, run: () => onInsertCamera?.() },
      { label: "附件", Icon: Paperclip, run: () => onInsertAttachment?.() },
    ] },
    { key: "block", items: [
      { label: "表格", Icon: Table2, run: () => onInsertTable?.() },
      { label: "引用", Icon: Quote, run: () => runPanel("quote") },
      { label: "分割线", Icon: Minus, run: () => runPanel("hr") },
      { label: "代码块", Icon: SquareCode, run: () => runPanel("insertCard", "codeblock") },
      // 高亮块：内核里是 `execCommand("alert", type)`（不是 insertCard），落盘为 <blockquote class="lake-alert lake-alert-tips">
      { label: "高亮块", Icon: Highlighter, run: () => runPanel("alert", "tips") },
      { label: "状态", Icon: Tag, run: () => runPanel("insertCard", "label") },
    ] },
    { key: "media", items: [
      { label: "音频", Icon: Music, run: () => onInsertAudio?.() },
      { label: "视频", Icon: Video, run: () => onInsertVideo?.() },
    ] },
    { key: "layout", items: [
      // 标签用「分栏」而不是「分栏卡片」：与「媒体」同处一行时每格只有 84px，4 个字会截断（桌面端仍叫分栏卡片）
      { label: "分栏", Icon: Columns2, run: () => runPanel("columns", 2) },
      { label: "折叠块", Icon: FoldVertical, run: () => runPanel("collapse") },
    ] },
    { key: "widget", items: [
      { label: "日期", Icon: CalendarDays, run: () => runPanel("insertCard", "dateCard", { date: Date.now() }, false) },
      { label: "表情", Icon: Smile, run: (anchor) => pickEmoji(anchor) },
      { label: "日历", Icon: Calendar, run: () => runPanel("insertCard", "calendar", { currentDate: dateStamp(), colorIndex: 0, schedules: {}, __spacing: "both" }, true) },
    ] },
    { key: "ref", items: [
      // 链接从「Aa」面板移到这里（用户 261012：链接融合到 + 号里）；点它在本面板内联展开链接编辑行
      { label: "链接", Icon: Link2, run: () => toggleLinkEditor() },
      { label: "文档引用", Icon: FileSymlink, run: () => runPanel("insertCard", "customBlock", { $name: "lake-note-ref", $htmlStr: "", noteId: "", title: "" }, true) },
    ] },
  ];
  /** 分组 → 行（一行最多两卡；「媒体｜布局」那一行是唯一的双卡行）。 */
  const INSERT_ROWS: ReadonlyArray<ReadonlyArray<ReadonlyArray<DockItem>>> = [
    [INSERT_GROUPS[0].items],
    [INSERT_GROUPS[1].items],
    [INSERT_GROUPS[2].items, INSERT_GROUPS[3].items],
    [INSERT_GROUPS[4].items],
    [INSERT_GROUPS[5].items],
  ];
  // 「更多」面板：公式可用；5 项画图/绘图是**占位（置灰）**，待逐项解决移动端编辑（画布覆盖层 + 触摸手势）后放开。
  const moreItems: ReadonlyArray<DockItem> = [
    { label: "公式", Icon: Sigma, run: () => runPanel("insertCard", "math", null, true) },
    { label: "画板", Icon: Shapes, disabled: true },
    { label: "流程图", Icon: Workflow, disabled: true },
    { label: "UML 图", Icon: Network, disabled: true },
    { label: "思维导图", Icon: GitFork, disabled: true },
    { label: "文本绘图", Icon: FileCode2, disabled: true },
    // 撤销/重做从「Aa」面板移到这里（用户 261012：放更多里去）
    ...HISTORY_COMMANDS.map((c) => ({ label: c.label, Icon: COMMAND_ICONS[c.name] ?? Undo, run: () => runPanel(c.name) })),
  ];
  // 工具栏“收起/展开键盘”按钮：无面板 = 按键盘开合切换；有面板 = 收起面板（键盘此前已收起）
  const onKbToggle = () => { if (panelMode) dismissKeyboard(); else if (keyboardOpen) dismissKeyboard(); else showKeyboard(); };
  const kbLabel = panelMode ? "收起面板" : (keyboardOpen ? "收起键盘" : "展开键盘");

  // --kb-offset：无面板 = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；
  // 面板开 = 面板占住的键盘区高度（键盘收起过程中 innerHeight 530→842 时它同步长出来，
  // 工具栏屏幕 Y 恒定、面板"接管"键盘腾出的位置 —— HANDOFF §8.3 原始结论）。
  const isOn = (name: string) => !!activeStates[name];
  /** 「＋ / 更多」面板的插入条目（图标 + 文字）——两个面板共用一套渲染。 */
  const insBtn = ({ label, Icon, run, disabled }: DockItem) => (
    <button
      key={label}
      className="med-ins-item"
      aria-label={label}
      disabled={!!disabled}
      title={disabled ? label + "（移动端暂未支持）" : undefined}
      onClick={run ? (e) => run(e.currentTarget) : undefined}
    >
      <Icon size={22} />
      <span className="med-ins-label">{label}</span>
    </button>
  );

  /** 面板里的命令条目（行内 / 块级 / 历史共用一套渲染，避免三段重复 JSX）。 */
  const cmdBtn = (c: { name: string; label: string }) => {
    const Icon = COMMAND_ICONS[c.name];
    return (
      <button key={c.name} className={"med-f-btn" + (isOn(c.name) ? " med-f-on" : "")} onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>
        {Icon ? <Icon size={17} /> : c.label}
      </button>
    );
  };
  // 「一卡一组、一行最多两卡」的分组（用户 261012 定：照语雀那样拆开排布）
  // 行内标记：加粗/斜体/下划线/删除线/**行内代码**（用户 261012：行内代码恢复，就放在这一行）
  const inlineMarks = MARK_COMMANDS;
  // 列表：与「对齐」同处一行（用户 261012：对齐和列表放一行）
  const listItems = BLOCK_INSERT_COMMANDS.filter((c) => c.name === "unorderedList" || c.name === "orderedList" || c.name === "taskList");
  /** 取值型高亮：对齐（内核默认返回空串 = 左对齐）、字色（空串 = 正文色）、背景色。 */
  const alignActive = (value: string) => (activeValues.alignment || "left") === value;
  const textColorActive = (hex: string) => !!activeValues.color && activeValues.color.toLowerCase() === hex.toLowerCase();
  const noTextColor = !activeValues.color;
  /** 语雀式色板（2 行 × 7 格）的当前态：色块按当前变体（字色/背景色）回显。 */
  const boardColorActive = (hex: string) => {
    const cur = (colorVariant === "text" ? activeValues.color : activeValues.bgColor).toLowerCase();
    return !!cur && cur === hex.toLowerCase();
  };
  /** 首格「无填充/默认」的当前态：字色=没有显式字色；背景色=无填充或 transparent。 */
  const boardClearActive = colorVariant === "text"
    ? !activeValues.color
    : (!activeValues.bgColor || activeValues.bgColor === "transparent");
  /** 色板色块（圆形，照语雀）。 */
  const boardSwatch = (hex: string) => (
    <button
      key={hex}
      className={"med-f-sw" + (boardColorActive(hex) ? " is-on" : "")}
      style={{ background: hex }}
      onClick={() => pickColor(hex)}
      aria-label={"颜色 " + hex}
      title={hex}
    />
  );
  const plusCls = "med-btn med-toggle" + (panelMode === "insert" ? " med-open" : "");
  const aaCls = "med-btn med-toggle med-aa" + (panelMode === "font" ? " med-open" : "");

  return (
    <div ref={dockRef} className="mobile-editor-dock" data-panel={panelMode ?? "none"} style={{ ["--kb-offset" as string]: `${Math.round(usable)}px` } as import("react").CSSProperties}>
      {/* 主工具栏（悬浮输入法上方）；对齐 Lake 官方：类别(+/Aa)展开即变 ×，命令按钮实时高亮 */}
      <div className="med-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button className={plusCls} onClick={() => togglePanel("insert")} aria-label="插入">
          {panelMode === "insert" ? <X size={20} /> : <Plus size={21} />}
        </button>
        <button className={aaCls} onClick={() => togglePanel("font")} aria-label="字体">
          {panelMode === "font" ? <X size={20} /> : <Type size={20} />}
        </button>
        <button className={"med-btn" + (isOn("bold") ? " med-active" : "")} onClick={() => runInline("bold")} aria-label="加粗"><Bold size={19} /></button>
        <button className={"med-btn" + (isOn("unorderedList") ? " med-active" : "")} onClick={() => runInline("unorderedList" as never)} aria-label="列表"><List size={20} /></button>
        <button className={"med-btn" + (isOn("taskList") ? " med-active" : "")} onClick={() => runInline("taskList" as never)} aria-label="待办"><ListTodo size={20} /></button>
        <button className={"med-btn med-toggle" + (panelMode === "more" ? " med-open" : "")} onClick={() => togglePanel("more")} aria-label="更多">
          {panelMode === "more" ? <X size={20} /> : <MoreHorizontal size={20} />}
        </button>
        <button className="med-btn" onClick={onKbToggle} aria-label={kbLabel}><Keyboard size={19} /></button>
      </div>

      {/* 展开面板：占住键盘区（键盘不显示），工具栏停在它上沿；关闭过渡期（closing）继续挂载，
          让键盘上升时那一带仍有面板背景兜着。内容在 .med-panel-inner 里做滑入/滑出。 */}
      {(panelMode || closing) && (
      <div className="med-panel" data-open={panelMode ? "1" : "0"} aria-hidden={!panelMode} onMouseDown={(e) => e.preventDefault()}>
        <div className="med-panel-inner">
          {renderedPanel === "insert" || renderedPanel === "more" ? (
            <>
              {renderedPanel === "insert" ? (
                /* 「＋」面板：一卡一组（用户 261012 定稿的分组排布；「媒体｜布局」是唯一的双卡行） */
                <div className="med-ins-groups">
                  {INSERT_ROWS.map((row, ri) => (
                    <div className={"med-ins-row" + (row.length > 1 ? " med-ins-row--split" : "")} key={ri}>
                      {row.map((items, ci) => (
                        <div className="med-ins-card" key={ci}>{items.map(insBtn)}</div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="med-ins-grid">{moreItems.map(insBtn)}</div>
              )}
              {/* 链接编辑：**在本面板内联展开**（用户 261012：链接融合到 + 号里）。
                  复用内核 .ne-link-editor 的 UI + 共享判定 linkEditor.ts（与桌面浮栏同一份）。 */}
              {linkOpen && (
                <div className="med-f-row">
                  <div className="med-f-card med-f-link">
                    <KLinkEditor
                      text={linkText}
                      src={linkSrc}
                      allowModifyText
                      invalid={linkSrc.trim().length > 0 && !isValidLink(linkSrc.trim())}
                      onChangeText={setLinkText}
                      onChangeSrc={setLinkSrc}
                      onConfirm={confirmLink}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="med-font-panel">
              {/* 段落样式（独占一行） */}
              <div className="med-f-row">
                <div className="med-f-card" data-count={STYLE_BLOCKS.length}>
                  {STYLE_BLOCKS.map((b) => (
                    <button key={b.value} className="med-f-btn" onClick={() => runPanel("style", b.value)} aria-label={b.label} title={b.label}>
                      {b.value === "p" ? <Pilcrow size={17} /> : b.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 行内标记（独占一行）——行内代码/链接按用户 261012 移出本面板：
                  代码块在「+」面板已有，链接融合进「+」面板 */}
              <div className="med-f-row">
                <div className="med-f-card" data-count={inlineMarks.length}>{inlineMarks.map(cmdBtn)}</div>
              </div>

              {/* 列表 ｜ 对齐（用户 261012：对齐和列表放一行）
                  注：「引用 / 分割线」已删（+ 面板已有）、「撤销 / 重做」已移到「更多」面板 */}
              <div className="med-f-row">
                <div className="med-f-card" data-count={listItems.length}>{listItems.map(cmdBtn)}</div>
                <div className="med-f-card" data-count={ALIGN_ITEMS.length}>
                  {ALIGN_ITEMS.map(({ value, label, Icon }) => (
                    <button key={value} className={"med-f-btn" + (alignActive(value) ? " med-f-on" : "")} onClick={() => runPanel("alignment", value)} aria-label={label} title={label}><Icon size={17} /></button>
                  ))}
                </div>
              </div>

              {/* 字色：一排 A（默认 + 常用色）+ 末位背景色入口 —— 语雀那排 A 的口径 */}
              <div className="med-f-row">
                <div className="med-f-card med-f-colors" data-count={QUICK_TEXT_COLORS.length + 2}>
                  <button className={"med-f-btn med-f-a" + (noTextColor && colorVariant === "text" ? " med-f-on" : "")} onClick={() => { setColorVariant("text"); pickColor("", "text"); }} aria-label="默认颜色" title="默认颜色">A</button>
                  {QUICK_TEXT_COLORS.map((c) => (
                    <button key={c} className={"med-f-btn med-f-a" + (colorVariant === "text" && textColorActive(c) ? " med-f-on" : "")} style={{ color: c }} onClick={() => { setColorVariant("text"); pickColor(c, "text"); }} aria-label={"字色 " + c} title={"字色 " + c}>A</button>
                  ))}
                  <button className={"med-f-btn med-f-a med-f-bgentry" + (colorVariant === "bg" ? " med-f-on" : "")} onClick={() => setColorVariant("bg")} aria-label="背景色" title="背景色">
                    <span className="med-f-bgfill" style={isHexColor(activeValues.bgColor) ? { background: activeValues.bgColor, color: contrastTextColor(activeValues.bgColor) } : undefined}>A</span>
                  </button>
                </div>
              </div>

              {/* 色板：**内联展开** + **照抄语雀排布**（用户 261012 定稿）—— 2 行 × 7 格：
                  浅色行首格 = 无填充/默认，其余 6 淡色；第二行 7 实色。颜色全部取内核色阶
                  （core/colorPalette.ts 的 MOBILE_BOARD_*，逐色 ΔE 就近映射，不自己造色）。 */}
              <div className="med-f-row">
                <div className="med-f-card med-f-board" data-variant={colorVariant}>
                  <div className="med-f-board-row">
                    <button
                      className={"med-f-sw med-f-sw--none" + (boardClearActive ? " is-on" : "")}
                      onClick={() => pickColor("")}
                      aria-label={colorVariant === "text" ? "默认颜色" : "无填充"}
                      title={colorVariant === "text" ? "默认颜色" : "无填充"}
                    />
                    {MOBILE_BOARD_LIGHT.map(boardSwatch)}
                  </div>
                  <div className="med-f-board-row">{MOBILE_BOARD_SOLID.map(boardSwatch)}</div>
                </div>
              </div>

              {/* 字号：**放最底部**（用户 261012 定：用得不多） */}
              <div className="med-f-row">
                <div className="med-f-card med-f-sizes" data-count={MOBILE_FONT_SIZES.length}>
                  {MOBILE_FONT_SIZES.map((v) => (
                    <button key={v} className={"med-f-btn" + (activeValues.fontSize === v ? " med-f-on" : "")} onClick={() => runPanel("fontsize", v)} aria-label={v + "px"} title={v + "px"}>{v}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
