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
import { Plus, Bold, Italic, Underline, List, ListOrdered, ListTodo, Keyboard, X, Image as ImageIcon, Camera, Paperclip, Table2, Quote, Minus, Code2, Music, Video, Highlighter, Tag, Undo, Redo, Pilcrow, Type } from "lucide-react";
import { lakeBridge, type LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { MARK_COMMANDS, BLOCK_INSERT_COMMANDS, HISTORY_COMMANDS, STYLE_BLOCKS } from "../../features/editor/editorCommands";
import { useKeyboard } from "../useKeyboard";

type PanelMode = "insert" | "font" | null;

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
  bold: Bold, italic: Italic, underline: Underline, code: Code2,
  quote: Quote, unorderedList: List, orderedList: ListOrdered, taskList: ListTodo,
  hr: Minus, undo: Undo, redo: Redo,
};

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

/** 光标/选区变化时刷新各命令生效状态（selectionchange + 命令执行后主动 refresh）。 */
function useActiveCommandStates(editor: LakeEditorInstance | null) {
  const [states, setStates] = useState<Record<string, boolean>>({});
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const refresh = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const next: Record<string, boolean> = {};
    for (const name of STATE_COMMANDS) next[name] = isCommandActive(ed, name);
    setStates((prev) => (STATE_COMMANDS.some((k) => prev[k] !== next[k]) ? next : prev));
  }, []);
  useEffect(() => {
    const onSel = () => refresh();
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [refresh]);
  // editor 就绪/切换时刷新一次（selectionchange 不会为首次光标触发）
  useEffect(() => { if (editor) refresh(); }, [editor, refresh]);
  return { states, refresh };
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

/** 执行 Lake 命令（renderer 通道；editor 未就绪静默）。 */
function useEditorExec(editor: LakeEditorInstance | null) {
  return (cmd: string, ...args: unknown[]) => {
    try {
      const renderer = lakeBridge(editor ?? undefined).renderer;
      renderer?.execCommand?.(cmd as never, ...args);
    } catch { /* 命令失败不阻断 */ }
  };
}

export function EditorDock({ editor, editing, onInsertImage, onInsertCamera, onInsertAttachment, onInsertAudio, onInsertVideo, onInsertTable }: EditorDockProps) {
  const [panelMode, setPanelMode] = useState<PanelMode>(null);

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
  const { states: activeStates, refresh: refreshActive } = useActiveCommandStates(editor);

  // 退出编辑态时复位
  useEffect(() => {
    if (!editing) setPanelMode(null);
  }, [editing]);

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

  // 插入面板条目（对齐语雀移动端：图标 + 文字，两列）。顺序＝使用频次从高到低。
  const insertItems: ReadonlyArray<{ label: string; Icon: typeof ImageIcon; run: () => void }> = [
    { label: "图片", Icon: ImageIcon, run: () => onInsertImage?.() },
    { label: "拍照", Icon: Camera, run: () => onInsertCamera?.() },
    { label: "附件", Icon: Paperclip, run: () => onInsertAttachment?.() },
    { label: "表格", Icon: Table2, run: () => onInsertTable?.() },
    { label: "音频", Icon: Music, run: () => onInsertAudio?.() },
    { label: "视频", Icon: Video, run: () => onInsertVideo?.() },
    // 高亮块：内核里是 `execCommand("alert", type)`（不是 insertCard），落盘为 <blockquote class="lake-alert lake-alert-tips">
    { label: "高亮块", Icon: Highlighter, run: () => runPanel("alert", "tips") },
    { label: "状态", Icon: Tag, run: () => runPanel("insertCard", "label") },
    { label: "引用", Icon: Quote, run: () => runPanel("quote") },
    { label: "分割线", Icon: Minus, run: () => runPanel("hr") },
    { label: "代码块", Icon: Code2, run: () => runPanel("insertCard", "codeblock") },
  ];
  // 工具栏“收起/展开键盘”按钮：无面板 = 按键盘开合切换；有面板 = 收起面板（键盘此前已收起）
  const onKbToggle = () => { if (panelMode) dismissKeyboard(); else if (keyboardOpen) dismissKeyboard(); else showKeyboard(); };
  const kbLabel = panelMode ? "收起面板" : (keyboardOpen ? "收起键盘" : "展开键盘");

  // --kb-offset：无面板 = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；
  // 面板开 = 面板占住的键盘区高度（键盘收起过程中 innerHeight 530→842 时它同步长出来，
  // 工具栏屏幕 Y 恒定、面板"接管"键盘腾出的位置 —— HANDOFF §8.3 原始结论）。
  const isOn = (name: string) => !!activeStates[name];
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
        <button className="med-btn" onClick={onKbToggle} aria-label={kbLabel}><Keyboard size={19} /></button>
      </div>

      {/* 展开面板：占住键盘区（键盘不显示），工具栏停在它上沿；关闭过渡期（closing）继续挂载，
          让键盘上升时那一带仍有面板背景兜着。内容在 .med-panel-inner 里做滑入/滑出。 */}
      {(panelMode || closing) && (
      <div className="med-panel" data-open={panelMode ? "1" : "0"} aria-hidden={!panelMode} onMouseDown={(e) => e.preventDefault()}>
        <div className="med-panel-inner">
          {renderedPanel === "insert" ? (
            <div className="med-ins-grid">
              {insertItems.map(({ label, Icon, run }) => (
                <button key={label} className="med-ins-item" aria-label={label} onClick={run}>
                  <Icon size={22} />
                  <span className="med-ins-label">{label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="med-font-panel">
              {/* 块级样式（style 命令：光标在段内即可执行，面板 blur 后仍有效） */}
              <div className="med-f-row">
                {STYLE_BLOCKS.map((b) => (
                  <button key={b.value} className="med-f-btn" onClick={() => runPanel("style", b.value)} aria-label={b.label} title={b.label}>
                    {b.value === "p" ? <Pilcrow size={16} /> : b.label}
                  </button>
                ))}
              </div>
              {/* 行内标记（需先选中文本；主工具栏 B/列表/待办走 runInline 保选区更可靠） */}
              <div className="med-f-row">
                {MARK_COMMANDS.map((c) => {
                  const Icon = COMMAND_ICONS[c.name];
                  return <button key={c.name} className={"med-f-btn" + (isOn(c.name) ? " med-f-on" : "")} onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>{Icon ? <Icon size={17} /> : c.label}</button>;
                })}
              </div>
              {/* 块级/插入命令 */}
              <div className="med-f-row">
                {BLOCK_INSERT_COMMANDS.map((c) => {
                  const Icon = COMMAND_ICONS[c.name];
                  return <button key={c.name} className={"med-f-btn" + (isOn(c.name) ? " med-f-on" : "")} onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>{Icon ? <Icon size={17} /> : c.label}</button>;
                })}
              </div>
              {/* 历史 */}
              <div className="med-f-row">
                {HISTORY_COMMANDS.map((c) => {
                  const Icon = COMMAND_ICONS[c.name];
                  return <button key={c.name} className={"med-f-btn" + (isOn(c.name) ? " med-f-on" : "")} onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>{Icon ? <Icon size={17} /> : c.label}</button>;
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
