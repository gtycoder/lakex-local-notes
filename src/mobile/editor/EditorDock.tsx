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
 * - 底部被占高度（面板/键盘）由**外壳高度**承担（`--mb-app-h` = 稳定外壳高 − 占用，见 viewportShell.ts），
 *   编辑面的滚动容器只留工具栏的固定留白（80px）⇒ 面板⇄输入法切换时内容盒高度不变（不跳）。
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListTodo, Keyboard, X, Image as ImageIcon, Camera, Paperclip, Table2, Quote, Minus, Code, SquareCode, Music, Video, Highlighter, Tag, Undo, Redo, Pilcrow, Type, MoreHorizontal, Columns2, FoldVertical, Calendar, CalendarDays, Smile, FileSymlink, Sigma, AlignLeft, AlignCenter, AlignRight, Link2, Superscript, Subscript, IndentIncrease, IndentDecrease, Paintbrush, Eraser, ArrowRightFromLine } from "lucide-react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { execEditorCommand } from "./execCommand";
import { useSnapshotUndo } from "./useSnapshotUndo";
import type { StackLimits } from "./snapshotUndoModel";
import { MARK_COMMANDS, BLOCK_INSERT_COMMANDS, STYLE_BLOCKS, FONT_SIZE_OPTIONS } from "../../features/editor/editorCommands";
import { QUICK_TEXT_COLORS, MOBILE_BOARD_LIGHT, MOBILE_BOARD_SOLID } from "../../core/colorPalette";
// 「Aa」面板的取值型命令（字号/对齐/字色/背景色）与链接，全部复用既有单一来源（本文不另造一套）
// 注：移动端**色板**不再走内核色卡适配器 LakeColorBoard，而是照语雀排布自己画 2×7 圆点格
//（用户 261012 定稿「色板照抄语雀、不用那么多颜色」）；颜色仍全部取自 core/colorPalette.ts 的内核色阶。
import { normalTextColor, paletteDefaultValue, persistentColor, rememberColor, type ColorVariant } from "../../features/editor/selectionToolbar/colorMemory";
import { colorApplyCommand, toFontSize, unwrapValue } from "../../features/editor/selectionToolbar/selectionToolbarModel";
import { applyTextLink, captureLinkTarget, isValidLink, type LinkEditorTarget } from "../../features/editor/selectionToolbar/linkEditor";
import { KLinkEditor } from "../../features/editor/selectionToolbar/kernelUiAtoms";
// 「编辑面」的口径：算术在 editSurfaceModel.ts（纯函数 + CI 单测），owner（外壳高 / 面板状态机 / 输入法 / 焦点守卫）在 useEditSurface.ts
import { useEditSurface } from "./useEditSurface";
// 表情选择器与小记写作卡**共用同一套**（AGENTS §3#14：同一交互语义只有一套）；这里只复用它的实现。
import { EmojiPanel } from "../ui/EmojiPanel";
// 原生弹键盘兜底（261015）：WebView 里程序化 focus 不保证弹软键盘，点「⌨ 展开键盘」时用它补一次。
import { showNativeKeyboard } from "../native/nativeKeyboard";

type PanelMode = "insert" | "font" | "more" | "emoji" | null;

/** dock 面板条目的动作；`anchor` = 触发按钮（表情选择器要锚定它）。 */
type DockAction = (anchor?: HTMLElement | null) => void;
/** 面板条目形状（`+ ` /「更多」两个网格共用，保证几何与置灰态单一来源）。
 *  `glyph` = 用数字/字形代替图标（B6：行高 6 档没有专属图标，直接显示 1 / 1.15 / …） */
type DockItem = { label: string; Icon?: typeof ImageIcon; glyph?: string; run?: DockAction; disabled?: boolean };

/** 行高档位：**直接取内核 lineHeight 命令的取值域**（bundle `Ik.values = [1, 1.15, 1.5, 2, 2.5, 3]`）。 */
const LINE_HEIGHT_VALUES = [1, 1.15, 1.5, 2, 2.5, 3] as const;

/** 选区/焦点节点是否属于编辑器正文（面板命令只认正文选区） */
function isEditorNode(node: Node | null): boolean {
  let el: Element | null = node ? (node.nodeType === 1 ? (node as Element) : (node as ChildNode).parentElement) : null;
  while (el) { if (el.nodeType === 1 && (el as HTMLElement).isContentEditable) return true; el = el.parentElement; }
  return false;
}

// 输入法抑制（setbackIme）与焦点守卫已迁到 useEditSurface.ts —— 261014 P2 收口：
// 「外壳高度 / 输入法抑制 / 焦点守卫」三件事只有那一处实现，本组件只负责面板状态与渲染。

/** 格式命令 → lucide 图标（正文面板用图标而非文字，对齐思源移动端） */
const COMMAND_ICONS: Record<string, typeof Bold> = {
  // 行内代码用 \`</>\`（Code），与「＋」面板的**代码块卡片**（SquareCode，方框内 code）一眼可辨（用户 261012）
  bold: Bold, italic: Italic, underline: Underline, strikethrough: Strikethrough, code: Code,
  quote: Quote, unorderedList: List, orderedList: ListOrdered, taskList: ListTodo,
  hr: Minus, undo: Undo, redo: Redo,
  // B6（261017）：清除格式放进行内标记行（与 B/I/U/S/行内代码同一行）
  clearFormat: Eraser,
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
/** 需要监测「可用态」（按钮置灰）的命令：历史命令用 queryCommandEnabled，不是 state/active。 */
const ENABLED_COMMANDS = ["undo", "redo"] as const;

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
function isCommandEnabled(editor: LakeEditorInstance | null, name: string): boolean {
  if (!editor) return false;
  const ed = editor as unknown as {
    queryCommandEnabled?: (n: string) => unknown;
    renderer?: { queryCommandEnabled?: (n: string) => unknown };
  };
  try {
    const v = ed.queryCommandEnabled?.(name) ?? ed.renderer?.queryCommandEnabled?.(name);
    return v === true;
  } catch {
    return false;
  }
}

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
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<SelectionValues>(EMPTY_VALUES);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const refresh = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const next: Record<string, boolean> = {};
    for (const name of STATE_COMMANDS) next[name] = isCommandActive(ed, name);
    setStates((prev) => (STATE_COMMANDS.some((k) => prev[k] !== next[k]) ? next : prev));
    const nextEnabled: Record<string, boolean> = {};
    for (const name of ENABLED_COMMANDS) nextEnabled[name] = isCommandEnabled(ed, name);
    setEnabled((prev) => (ENABLED_COMMANDS.some((k) => prev[k] !== nextEnabled[k]) ? nextEnabled : prev));
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
  return { states, enabled, values, refresh };
}

export interface EditorDockProps {
  editor: LakeEditorInstance | null;
  /** 编辑态才渲染 */
  editing: boolean;
  /** 撤销后端：`kernel` = 内核 history；`snapshot` = 前端快照栈（小记与文档都走它：逐段撤销 + 光标还原）。 */
  undoBackend?: "kernel" | "snapshot";
  /** snapshot 后端的容量上限（文档用更保守的 DOC_LIMITS）。 */
  undoLimits?: StackLimits;
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

/** 执行 Lake 命令（**统一走 execEditorCommand**：renderer 缺失时回退实例 execCommand，
 *  文档编辑器就是这种形态；editor 未就绪静默）。
 *  ⚠️ **必须回传内核返回值**：链接的「这条不行就换另一条」判定靠它（linkEditor.ts），
 *  吞掉返回值会退化成"两条都算成功" = 静默 no-op。 */
function useEditorExec(editor: LakeEditorInstance | null) {
  return (cmd: string, ...args: unknown[]) => execEditorCommand(editor, cmd, ...args);
}

export function EditorDock({ editor, editing, undoBackend = "kernel", undoLimits, onInsertImage, onInsertCamera, onInsertAttachment, onInsertAudio, onInsertVideo, onInsertTable }: EditorDockProps) {
  /**
   * 「Aa」面板内的**内联展开**件（用户 261012 定：全套走语雀方式 —— 都在面板内展开，不弹层、不做二级面板）：
   *   - 颜色：**两行各自独立**（用户 261014 定）—— 上排 A = 文字色、下面色板 = 背景色，
   *     不再共用"变体"状态（那样两行会互相回显，用户看到的"串联"）；
   *   - linkOpen：链接编辑行是否展开（复用内核 .ne-link-editor 那套 UI 与共享判定 linkEditor.ts）。
   */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkSrc, setLinkSrc] = useState("");
  const linkTargetRef = useRef<LinkEditorTarget>({ range: null, selected: "" });

  /** 面板打开期间的选区快照：命令执行前后都还原，才能连续加粗→倾斜→下划线 */
  const savedRangeRef = useRef<Range | null>(null);
  /**
   * 输入法**组合中**（候选未上屏）：内核 history 还没有这一笔，此时点撤销/重做会完全无反应
   * —— 用户 261017 报「打字快了能撤、慢一点撤不了」的根因（实测：composing 时连点 3 次撤销都不动）。
   * 处理：执行工具栏命令前先 blur→focus 触发 compositionend 提交，再执行命令。
   */
  const composingRef = useRef(false);
  const dockRef = useRef<HTMLDivElement>(null);
  /**
   * **编辑面 owner**（261014 P2/P3 收口）：外壳高度 + 面板状态机 + 输入法抑制 + 焦点守卫全在 useEditSurface.ts，
   * 几何算术在 editSurfaceModel.ts（纯函数 + CI 单测）。本组件只剩：渲染 + 命令 + 选区/内联件的簿记。
   * restoreFocus 走 ref —— focusEditor 定义在早退之后，而 hook 调用必须在早退之前。
   */
  const focusEditorRef = useRef<() => void>(() => {});
  const surface = useEditSurface({ editing, dockRef, restoreFocus: () => focusEditorRef.current() });
  const { panelMode, renderedPanel, closing, openPanel, closePanel } = surface;
  const usable = surface.kbOffset;
  const keyboardOpen = surface.keyboardOpen;
  const exec = useEditorExec(editor);
  const execRef = useRef(exec);
  execRef.current = exec;
  const { states: activeStates, enabled: commandEnabled, values: activeValues, refresh: refreshActive } = useActiveCommandStates(editor);
  /** 前端兜底撤销栈（思源 LocalUndo 式）：仅小记等 kernel history 不可用的编辑器启用。 */
  const snapshotUndo = useSnapshotUndo(editor, undoBackend === "snapshot", undoLimits);

  // 输入法组合态跟踪（document 捕获阶段：软键盘的 composition 事件都冒泡到这里）
  useEffect(() => {
    const onStart = () => { composingRef.current = true; };
    const onEnd = () => { composingRef.current = false; };
    document.addEventListener("compositionstart", onStart, true);
    document.addEventListener("compositionend", onEnd, true);
    return () => {
      document.removeEventListener("compositionstart", onStart, true);
      document.removeEventListener("compositionend", onEnd, true);
    };
  }, []);

  // 收起面板（切换/关闭）时复位两个内联件：色板回到文字色、链接编辑器收起并清空草稿。
  useEffect(() => {
    if (!panelMode) { setLinkOpen(false); setLinkText(""); setLinkSrc(""); }
  }, [panelMode]);

  // 注：原先的「面板⇄输入法硬互斥兜底」已删除——那条规则是"面板占键盘区"时代的补丁
  // （键盘被顶回来会把面板压成细条）。新口径下面板挂在工具栏上沿、键盘本就常驻，
  // 内核命令后重聚焦正文只会让键盘保持原样，不再需要 blur 兜底（blur 反而会引出输入法动画）。

  // 面板占位 / 收起的时序（含"等键盘真的回来再清占位"）与 --mb-app-h 都由 useEditSurface 负责。

  // 编辑态常驻底部工具栏（完成/插入/字体等）；键盘弹出时悬浮在键盘上方。
  if (!editing) return null;

  const focusEditor = () => {
    // 输入法由 useEditSurface 的 restoreIme() 放回（它就在 closePanel 里）；这里只把**焦点**交还正文。
    try { const ce = document.querySelector<HTMLElement>(".doc-pane.active [contenteditable]"); ce?.focus(); } catch { /* 忽略 */ }
    try { execRef.current("focus"); } catch { /* 忽略 */ }
  };
  focusEditorRef.current = focusEditor;
  /** 收起输入法（面板要占键盘区）：**保留焦点与光标**（口径见 useEditSurface.ts） */
  const dismissIme = () => surface.suppressIme();
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
   * 展开/收起面板（面板占住键盘区；同一帧挂面板、下一帧才收输入法 —— 键盘从铺满的面板背后滑走，不与面板对撞）。
   * 状态机在 useEditSurface：`closePanel` 是唯一收口（动画 + 放回输入法 + 等键盘真回来再清占位），
   * `openPanel` 负责"从关到开时捕获键盘区高度 / 面板间切换沿用原高度"。
   * 这里只补本组件的簿记：切面板前先记选区（面板项命令靠它还回去）。
   */
  const togglePanel = (mode: Exclude<PanelMode, null>) => {
    if (panelMode === mode) { closePanel(); return; }                 // 再点一次 = 关面板并放回键盘
    snapshotSelection();
    openPanel(mode);
  };

  // 工具栏行内命令（bold/列表/待办/撤销/重做）：按钮 onMouseDown preventDefault 不抢焦点 →
  // 焦点/选区留在正文，命令作用在正确位置，键盘不收；执行后再记一次选区，供面板连续使用。
  // ⚠️ 输入法组合中先提交（blur→focus → compositionend）：否则 history 里没有这一笔，撤销/重做会静默无效。
  const runInline = (cmd: string, ...args: unknown[]) => {
    if (composingRef.current) {
      const active = document.activeElement as HTMLElement | null;
      try { active?.blur(); } catch { /* 忽略 */ }
      composingRef.current = false;
      // 等一拍让内核收到 compositionend 并记账，再执行命令并交还焦点
      window.setTimeout(() => {
        try { active?.focus(); } catch { /* 忽略 */ }
        exec(cmd, ...args);
        snapshotSelection();
        refreshActive();
      }, 60);
      return;
    }
    exec(cmd, ...args);
    snapshotSelection();
    refreshActive();
  };
  // 面板项命令：**还原选区 → 执行 → 再记选区 → 面板保持打开**（加粗后还能接着点倾斜/下划线）。
  // dismissIme：面板占着键盘区，命令后内核会异步重聚焦正文把键盘顶回来，必须再收一次（260911 修过）。
  const runPanel = (cmd: string, ...args: unknown[]) => {
    restoreSelection();
    exec(cmd, ...args);
    snapshotSelection();
    dismissIme();
    refreshActive();
  };
  /** 同 runPanel，但执行后**收起面板并放回输入法** —— 用于「格式刷」这类需要下一步去点正文两步命令（B6）。 */
  const runPanelAndClose = (cmd: string, ...args: unknown[]) => {
    restoreSelection();
    exec(cmd, ...args);
    snapshotSelection();
    refreshActive();
    closePanel();
  };

  // 收起键盘：手动收起（编辑态保留）。有关闭面板则先收起面板 —— **不放回输入法**（hide 档），光标留住。
  // 261015 用户点单：**点 ⌨ 要连带展开区一切收起**（面板关 + 键盘放回来）。
  //  原先这里走 `closePanel("hide")`（只收键盘、留住光标）—— 面板虽然关了，但它的占位要等 2.5s 兜底才释放，
  //  且键盘不会回来 ⇒ 用户看到一块**空白**（实测：点后 0.3s/1.2s 都是 `--kb-offset:280px`、`--mb-app-h:562px`、
  //  `inputmode:none`，直到 3.0s 才复位）。⇒ 改走 `closePanel("restore")`（与 × / 点正文同一条路：关面板 + 放回输入法）。
  /**
   * 展开键盘（261015 修：用户报「能收起不能展开」）。
   * 根因：收键盘走的是 `suppressIme()` —— 它给正文宿主写 `inputmode="none"`（这是"留住光标"的关键），
   * 展开时**没有摘掉**该属性 ⇒ 系统认定这个宿主不接受软键盘，`focus()` 也不会弹（实测两轮点击后 ih 仍 842、inputmode 仍 none）。
   * 顺序必须是：**先 restoreIme() 摘属性，再聚焦**；再用原生插件兜一次（程序化 focus 在 WebView 里不保证弹，见 nativeKeyboard.ts）。
   */
  const showKeyboard = () => {
    surface.restoreIme();
    focusEditor();
    window.setTimeout(showNativeKeyboard, 300);
  };

  /** 内核日历卡 `currentDate` 形态 = YYYYMMDD 整数（HANDOFF §0(五) 实测）。 */
  const dateStamp = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  /** 表情：选中后按内核原意插**文本**（`unicodeEmoji` 卡是死占位，见 LAKEX-CONTRACT §5.29）。
   *  面板本身在 `.med-panel` 里就地渲染（EmojiPanel fill），所以这里只负责插。 */
  const insertEmoji = (emoji: string) => runPanel("insertAtSelection", "text/lake", `<span>${emoji}</span>`);

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
   * 「＋」面板的插入项清单（用户 261015 亲自指定顺序与分组）。
   *
   * **两组（8 + 10）**：① 拍照 图片 附件 音频 视频 表情 状态 日期；② 表格 引用 分割线 代码块 高亮块 分栏 折叠块 链接 文档引用 日历。
   * **4 列**下：① 8 项 = 2 行**零空洞**；② 10 项 = 3 行（末行 2 项、2 个空位）。两组之间用更大的间距分隔。
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
      // 高亮块：内核里是 `execCommand("alert", type)`（不是 insertCard），落盘为 <blockquote class="lake-alert lake-alert-tips">
      { label: "高亮块", Icon: Highlighter, run: () => runPanel("alert", "tips") },
      // 标签用「分栏」而不是「分栏卡片」：窄格下 4 个字会被省略号截断（桌面端仍叫分栏卡片）
      { label: "分栏", Icon: Columns2, run: () => runPanel("columns", 2) },
      { label: "折叠块", Icon: FoldVertical, run: () => runPanel("collapse") },
      // 链接从「Aa」面板移到这里（用户 261012：链接融合到 + 号里）；点它在本面板内联展开链接编辑行
      { label: "链接", Icon: Link2, run: () => toggleLinkEditor() },
      { label: "文档引用", Icon: FileSymlink, run: () => runPanel("insertCard", "customBlock", { $name: "lake-note-ref", $htmlStr: "", noteId: "", title: "" }, true) },
      // 日历从第一组挪到这里（用户 261015：「把日历放到第二组」）
      { label: "日历", Icon: Calendar, run: () => runPanel("insertCard", "calendar", { currentDate: dateStamp(), colorIndex: 0, schedules: {}, __spacing: "both" }, true) },
    ] },
  ];
  // 「更多」面板：**按行分组**（261017 二改用户点单）——公式/上下标/格式刷一行、缩进三项一行、行高一行、画图占位一行。
  // 文本增强命令全部走内核 `renderer.execCommand`；行高档位 = 内核 `lineHeight` 的取值域（[1, 1.15, 1.5, 2, 2.5, 3]）。
  // ⚠️ 撤销/重做已移到**主工具栏**（261017：工具栏最右、更多之后、键盘之前），不再在本面板。
  const moreRows: ReadonlyArray<{ key: string; label?: string; items: ReadonlyArray<DockItem> }> = [
    { key: "inline", items: [
      { label: "公式", Icon: Sigma, run: () => runPanel("insertCard", "math", null, true) },
      { label: "上标", Icon: Superscript, run: () => runPanel("sup") },
      { label: "下标", Icon: Subscript, run: () => runPanel("sub") },
      // 格式刷是「取格式 → 点目标」的两步模式：**激活后必须收面板、放回输入法**，否则用户无法点目标
      { label: "格式刷", Icon: Paintbrush, run: () => runPanelAndClose("paintFormat") },
    ] },
    { key: "indent", items: [
      { label: "首行缩进", Icon: ArrowRightFromLine, run: () => runPanel("firstIndent") },
      { label: "减少缩进", Icon: IndentDecrease, run: () => runPanel("outdent") },
      { label: "增加缩进", Icon: IndentIncrease, run: () => runPanel("indent") },
    ] },
    // 行高：行首给「行高」标签（用户 261017：第三行需要知道是行高），6 个档位只显示数值。
    { key: "line-height", label: "行高", items: LINE_HEIGHT_VALUES.map((v) => ({ label: "行高", glyph: String(v), run: () => runPanel("lineHeight", v) })) },
    // 画图占位：图标太抽象 ⇒ **纯文字**（用户 261017），置灰但写清是什么。
    { key: "drawing", items: [
      { label: "画板", disabled: true },
      { label: "流程图", disabled: true },
      { label: "UML 图", disabled: true },
      { label: "思维导图", disabled: true },
      { label: "文本绘图", disabled: true },
    ] },
  ];
  // 工具栏“收起/展开键盘”按钮：无面板 = 按键盘开合切换；有面板 = 收起面板（键盘此前已收起）
  // ⌨：三种状态三条路（261015 定）——
  //   ① 面板开着 ⇒ `closePanel("restore")`：**面板与展开区一起收、键盘放回来**（不留空白；与 × 同一条路）；
  //   ② 无面板有键盘 ⇒ `dismissIme()`：只收键盘、**留住光标**（不走 closePanel —— 那会把 closing 置真却等不到"键盘回来"）；
  //   ③ 无面板无键盘 ⇒ `showKeyboard()`：先 restoreIme 摘抑制再聚焦（+ 原生兜底）。
  const onKbToggle = () => { if (panelMode) closePanel("restore"); else if (keyboardOpen) dismissIme(); else showKeyboard(); };
  const kbLabel = panelMode ? "收起面板" : (keyboardOpen ? "收起键盘" : "展开键盘");

  // --kb-offset：无面板 = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；
  // 面板开 = 面板占住的键盘区高度（键盘收起过程中 innerHeight 530→842 时它同步长出来，
  // 工具栏屏幕 Y 恒定、面板"接管"键盘腾出的位置 —— HANDOFF §8.3 原始结论）。
  const isOn = (name: string) => !!activeStates[name];
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
  const plusCls = "med-btn med-toggle" + (panelMode === "insert" ? " med-open" : "");
  const aaCls = "med-btn med-toggle med-aa" + (panelMode === "font" ? " med-open" : "");

  return (
    <div ref={dockRef} className="mobile-editor-dock" data-panel={panelMode ?? "none"} style={{ ["--kb-offset" as string]: `${Math.round(usable)}px` } as import("react").CSSProperties}>
      {/* 主工具栏（悬浮输入法上方）；对齐 Lake 官方：类别(+/Aa)展开即变 ×，命令按钮实时高亮 */}
      <div className="med-toolbar" data-prevent-swipe onMouseDown={(e) => e.preventDefault()}>
        {/* 中间按钮可左右滑动；键盘键**固定在最右**（261017 用户点单 B 方案） */}
        <div className="med-toolbar-scroll">
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
          {/* 撤销 / 重做（261017 用户点单：从「更多」面板移到主工具栏，键盘之前）。
              后端二选一：文档 = 内核 history（可用态走 queryCommandEnabled，不可用置灰）；
              小记 = 前端快照栈（note-mini 键入不进内核 history，见 useSnapshotUndo 头注释）。 */}
          <button
            className="med-btn"
            disabled={undoBackend === "snapshot" ? !snapshotUndo.canUndo : !commandEnabled.undo}
            onClick={() => (undoBackend === "snapshot" ? snapshotUndo.undo() : runInline("undo"))}
            aria-label="撤销"
          ><Undo size={19} /></button>
          <button
            className="med-btn"
            disabled={undoBackend === "snapshot" ? !snapshotUndo.canRedo : !commandEnabled.redo}
            onClick={() => (undoBackend === "snapshot" ? snapshotUndo.redo() : runInline("redo"))}
            aria-label="重做"
          ><Redo size={19} /></button>
        </div>
        <button className="med-btn med-btn--kb" onClick={onKbToggle} aria-label={kbLabel}><Keyboard size={19} /></button>
      </div>

      {/* 展开面板：占住键盘区（键盘不显示），工具栏停在它上沿；关闭过渡期（closing）继续挂载，
          让键盘上升时那一带仍有面板背景兜着。内容在 .med-panel-inner 里做滑入/滑出。 */}
      {(panelMode || closing) && (
      <div className="med-panel" data-open={panelMode ? "1" : "0"} data-kind={renderedPanel ?? "none"} aria-hidden={!panelMode} onMouseDown={(e) => e.preventDefault()}>
        <div className="med-panel-inner">
          {renderedPanel === "emoji" ? (
            /* 表情：**占满面板区**（输入法式；.med-panel 已是固定高）——不弹浮层、不随内容跳高度。 */
            <EmojiPanel bucket="input" fill onPick={insertEmoji} onBack={() => togglePanel("insert")} />
          ) : renderedPanel === "insert" || renderedPanel === "more" ? (
            <>
              {/* 「＋」= **方块网格**（261015 用户点单：照图1 的方块样式；两组 8+10、3 列）。
                  「更多」= **分行白卡**（261017 二改用户点单：公式/上下标/格式刷一行、缩进三项一行、行高一行、画图占位一行）。 */}
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
                      <div className="med-f-card" data-count={row.items.length}>
                        {row.label ? <span className="med-f-rowlabel">{row.label}</span> : null}
                        {row.items.map(rowBtn)}
                      </div>
                    </div>
                  ))}
                </div>
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
