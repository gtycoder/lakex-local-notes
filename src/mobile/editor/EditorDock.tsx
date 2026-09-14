/**
 * 移动端编辑态底部 dock（app 化适配，对齐 prototype/index.html 编辑态交互）：
 * - 主工具栏悬浮在输入法上方：插入(+)、Aa（字体）、B、列表、待办、收起键盘
 * - 展开面板在**输入法键盘之上**展开（不动键盘）：insert（图片/拍照/附件/表格/音频/视频/高亮块/状态/引用/分割线/代码块）+ font（块级/行内/对齐/颜色/背景）
 * - 键盘收起（dock 隐藏 + 右下角重显按钮）
 * 格式命令走 Lake renderer.execCommand（文本 ne-* 属性；块级 style "h1"/"p" 等）。
 *
 * 2026-09 修订（对齐 Lake 官方移动工具栏）：
 * - 类别按钮（+ / Aa）展开面板时变成 ×（关闭）并触发触感反馈；
 * - 命令按钮（B/列表/待办 及面板内 mark/block）随光标/选区**实时高亮**（queryCommandState + getSelectionAttrs）；
 * - `--mobile-dock-space` = 键盘上移量 + 工具栏 + **实测面板高度**（ResizeObserver），正文底部留白始终正确。
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
  onToggleEdit?: () => void;
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

export function EditorDock({ editor, editing, onToggleEdit, onInsertImage, onInsertCamera, onInsertAttachment, onInsertAudio, onInsertVideo, onInsertTable }: EditorDockProps) {
  const [panelMode, setPanelMode] = useState<PanelMode>(null);

  /** 面板打开期间的选区快照：命令执行前后都还原，才能连续加粗→倾斜→下划线 */
  const savedRangeRef = useRef<Range | null>(null);
  /** 只有"用户手指点在正文里"才关面板；程序性 focusin（Lake 命令内部重新聚焦）不算 */
  const userTappedEditorRef = useRef(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { offset, keyboardOpen } = useKeyboard();
  /**
   * 展开面板的高度（实测，0=已收起）。
   *
   * 交互口径（用户 260914 定稿）：**面板在输入法键盘之上展开，键盘全程不动**。
   * 旧实现是"面板接管键盘区"——打开时 blur 收键盘、收起时 focusEditor 弹回键盘，
   * 于是每次开合都能看到输入法的弹出加载动画（用户明确不要）。现在键盘不再被收，
   * 面板贴在工具栏上沿（bottom = 键盘上移量 + 工具栏高）向上展开，正文可视区相应缩短。
   */
  const [panelH, setPanelH] = useState(0);
  /** 面板内容：退场动画期间继续用上一次的模式渲染，否则收起瞬间内容先消失、滑动看不见 */
  const [renderedPanel, setRenderedPanel] = useState<Exclude<PanelMode, null>>("insert");
  useEffect(() => {
    if (panelMode) setRenderedPanel(panelMode);
  }, [panelMode]);
  // 实测面板高度，供正文底部留白使用（面板高度随内容/机型变化，不能写死）
  useEffect(() => {
    const el = panelRef.current;
    if (!panelMode || !el) { setPanelH(0); return; }
    const measure = () => setPanelH(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); };
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
  // 底部被占 = 键盘上移量（adjustResize 恒 0 / edge-to-edge = 键盘高）+ 工具栏 + 展开面板实测高度。
  // 作用域放到 dock 的父容器（.doc-pane / .mobile-document），而非全局 documentElement——避免多 tab 实例互相覆盖。
  useEffect(() => {
    if (!editing) return;
    const toolbar = 54; // .med-toolbar 高 48 + 与面板的 6px 间隙
    const space = Math.round(offset) + toolbar + (panelMode ? panelH : 0);
    const root = dockRef.current?.parentElement ?? document.documentElement;
    root.style.setProperty("--mobile-dock-space", `${space}px`);
    return () => { root.style.removeProperty("--mobile-dock-space"); };
  }, [editing, panelMode, panelH, offset]);

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
   * 展开/收起面板：**面板在输入法键盘之上展开，键盘全程不收不弹**（用户 260914 定稿）。
   * 旧实现开面板就 blur 收键盘、关面板再 focusEditor 弹回，那两步正是用户看到的"输入法弹出加载过程"。
   * 现在开合都不碰焦点：键盘原地不动，面板在工具栏上沿滑出/滑回（CSS transform），自然且无 IME 动画。
   * 打字需求随时可切回：手指点正文（pointerdown 落在 contenteditable）即关面板，键盘本来就在。
   */
  const togglePanel = (mode: Exclude<PanelMode, null>) => {
    if (panelMode === mode) {                                         // 再点一次 = 关面板（键盘不动）
      setPanelMode(null);
      return;
    }
    snapshotSelection();
    setPanelMode(mode);                                               // insert ↔ font 直接切换，键盘与工具栏都不动
  };

  // 工具栏行内命令（bold/列表/待办）：按钮 onMouseDown preventDefault 不抢焦点 →
  // 焦点/选区留在正文，命令作用在正确位置，键盘不收；执行后再记一次选区，供面板连续使用。
  const runInline = (cmd: string, ...args: unknown[]) => { exec(cmd, ...args); snapshotSelection(); refreshActive(); };
  // 面板项命令：**还原选区 → 执行 → 再记选区 → 面板保持打开**（加粗后还能接着点倾斜/下划线）。
  // 不再 dismissIme：键盘本来就该常驻（收它=又出现输入法动画），命令后内核重聚焦正文也无需干预。
  const runPanel = (cmd: string, ...args: unknown[]) => {
    restoreSelection();
    exec(cmd, ...args);
    snapshotSelection();
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

  // --kb-offset = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；面板挂在它 + 工具栏之上。
  const isOn = (name: string) => !!activeStates[name];
  const plusCls = "med-btn med-toggle" + (panelMode === "insert" ? " med-open" : "");
  const aaCls = "med-btn med-toggle med-aa" + (panelMode === "font" ? " med-open" : "");

  return (
    <div ref={dockRef} className="mobile-editor-dock" data-panel={panelMode ?? "none"} style={{ ["--kb-offset" as string]: `${Math.round(offset)}px` } as import("react").CSSProperties}>
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

      {/* 展开面板：贴在工具栏上沿（键盘之上）展开；常挂载 + data-open 切换，才能有滑出/滑回的过渡 */}
      <div ref={panelRef} className="med-panel" data-open={panelMode ? "1" : "0"} aria-hidden={!panelMode} onMouseDown={(e) => e.preventDefault()}>
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
  );
}
