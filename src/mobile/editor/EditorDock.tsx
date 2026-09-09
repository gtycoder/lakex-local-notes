/**
 * 移动端编辑态底部 dock（app 化适配，对齐 prototype/index.html 编辑态交互）：
 * - 主工具栏悬浮在输入法上方：插入(+)、Aa（字体）、B、列表、待办、收起键盘
 * - 展开面板覆盖输入法区域：insert（图片/附件/表格/引用/分割线/代码块）+ font（块级/行内/对齐/颜色/背景）
 * - 键盘收起（dock 隐藏 + 右下角重显按钮）
 * 格式命令走 Lake renderer.execCommand（文本 ne-* 属性；块级 style "h1"/"p" 等）。
 *
 * 2026-09 修订（对齐 Lake 官方移动工具栏）：
 * - 类别按钮（+ / Aa）展开面板时变成 ×（关闭）并触发触感反馈；
 * - 命令按钮（B/列表/待办 及面板内 mark/block）随光标/选区**实时高亮**（queryCommandState + getSelectionAttrs）；
 * - 修复展开面板导致的正文区抖动：`--mobile-dock-space` 改由动画中的 `usable`（kb-offset）驱动，
 *   使文档底部留白随面板/键盘收起动画同步增长，正文可视区尺寸全程恒定（不再从 530 骤缩再弹回）。
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Bold, Italic, Underline, List, ListOrdered, ListTodo, Keyboard, X, Image as ImageIcon, Paperclip, Table2, Quote, Minus, Code2, Music, Video, Undo2, Redo2, Pilcrow, Type } from "lucide-react";
import { lakeBridge, type LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { MARK_COMMANDS, BLOCK_INSERT_COMMANDS, HISTORY_COMMANDS, STYLE_BLOCKS } from "../../features/editor/editorCommands";
import { useKeyboard } from "../useKeyboard";
import { tapFeedback } from "../ui/haptics";

type PanelMode = "insert" | "font" | null;

/** 选区/焦点节点是否属于编辑器正文（面板命令只认正文选区） */
function isEditorNode(node: Node | null): boolean {
  let el: Element | null = node ? (node.nodeType === 1 ? (node as Element) : (node as ChildNode).parentElement) : null;
  while (el) { if (el.nodeType === 1 && (el as HTMLElement).isContentEditable) return true; el = el.parentElement; }
  return false;
}

/** 格式命令 → lucide 图标（正文面板用图标而非文字，对齐思源移动端） */
const COMMAND_ICONS: Record<string, typeof Bold> = {
  bold: Bold, italic: Italic, underline: Underline, code: Code2,
  quote: Quote, unorderedList: List, orderedList: ListOrdered, taskList: ListTodo,
  hr: Minus, undo: Undo2, redo: Redo2,
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

export function EditorDock({ editor, editing, onToggleEdit, onInsertImage, onInsertAttachment, onInsertAudio, onInsertVideo, onInsertTable }: EditorDockProps) {
  const [panelMode, setPanelMode] = useState<PanelMode>(null);

  /** 面板打开期间的选区快照：命令执行前后都还原，才能连续加粗→倾斜→下划线 */
  const savedRangeRef = useRef<Range | null>(null);
  /** 只有"用户手指点在正文里"才关面板；程序性 focusin（Lake 命令内部重新聚焦）不算 */
  const userTappedEditorRef = useRef(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const { base, innerHeight, offset, height, keyboardOpen } = useKeyboard();
  // 面板打开时占住的「键盘区」高度（打开瞬间捕获，之后不随键盘动画变）
  const [panelHeight, setPanelHeight] = useState(0);
  // --kb-offset 基准：无面板 = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；
  // 有面板 = innerHeight - base + panelHeight —— 键盘收起中（innerHeight 530→842）工具栏屏幕 Y 恒定，面板占住键盘区向下展开。
  const usable = panelMode ? Math.max(0, Math.round(innerHeight - base + panelHeight)) : offset;
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

  // 把 dock 占用的底部空间暴露给正文容器，让正文底部留白（光标不被工具栏/面板盖住）。
  // 面板开时 = 面板实际占住的键盘区高度（跟随键盘收起动画的 usable）+ 工具栏高；
  // 关键：用「动画中」的 usable 而非固定 panelHeight → 正文可视区不随键盘收起突跳（修复抖动）。
  //   - 打开瞬间 usable≈0 → 留白仍=工具栏（正文不动）；键盘收起时 usable 0→panelHeight，留白同步增长。
  // 作用域放到 dock 的父容器（.doc-pane / .mobile-document），而非全局 documentElement——避免多 tab 实例互相覆盖。
  useEffect(() => {
    if (!editing) return;
    const toolbar = 54; // .med-toolbar 高 48 + 与面板的 6px 间隙
    // 统一口径：底部被占空间 = 当前 --kb-offset（面板=键盘区高 或 键盘上移量）+ 工具栏。
    // 面板开时 usable 0→panelHeight 随键盘收起动画增长 → 正文留白同步、可视区恒定（修复抖动）；
    // 面板关时 usable=offset（adjustResize 恒 0；edge-to-edge=键盘高）→ 正文正确让开键盘/工具栏。
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
  const dismissIme = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && typeof el.closest === "function" && el.closest('[contenteditable="true"]')) { try { el.blur(); } catch { /* 忽略 */ } }
  };
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
   * 展开面板：**面板向下展开、占住输入法键盘区，工具栏屏幕位置保持不变**（用户 260909 要求）。
   * 关键顺序：同一帧里挂面板 + 把工具栏 bottom 抬到"键盘区高度"，**下一帧才 blur 收键盘** ——
   * 这样键盘是从面板背后滑走的，不存在"面板与键盘对撞"的闪烁；
   * 打字需求随时可切回：手指点正文（pointerdown 落在 contenteditable）即关面板并恢复键盘。
   */
  const togglePanel = (mode: Exclude<PanelMode, null>) => {
    tapFeedback();                                                    // 展开/收起类别面板 → 轻触感
    if (panelMode === mode) {                                         // 再点一次 = 关面板并回到打字
      setPanelMode(null);
      setPanelHeight(0);
      focusEditor();
      return;
    }
    snapshotSelection();
    if (!panelMode) setPanelHeight(Math.max(Math.round(height), 280));   // 只在"从关到开"时捕获键盘高度
    setPanelMode(mode);                                               // insert ↔ font 切换沿用原高度 → 工具栏不抖
    requestAnimationFrame(() => { if (panelMode || true) dismissIme(); });
  };

  // 工具栏行内命令（bold/列表/待办）：按钮 onMouseDown preventDefault 不抢焦点 →
  // 焦点/选区留在正文，命令作用在正确位置，键盘不收；执行后再记一次选区，供面板连续使用。
  const runInline = (cmd: string, ...args: unknown[]) => { exec(cmd, ...args); snapshotSelection(); refreshActive(); };
  // 面板项命令：**还原选区 → 执行 → 再记选区 → 面板保持打开**（加粗后还能接着点倾斜/下划线），
  // 且命令若把焦点抢回正文（会顶出输入法、把面板挤掉）就在下一帧再收一次键盘。
  const runPanel = (cmd: string, ...args: unknown[]) => {
    restoreSelection();
    exec(cmd, ...args);
    snapshotSelection();
    dismissIme();                                                  // 面板占着键盘区，命令后别把键盘顶回来
    refreshActive();
  };

  // 收起键盘：手动收起（编辑态保留）。有关闭面板则先收起面板（不恢复键盘——用户明确要收起）。
  const dismissKeyboard = () => {
    setPanelMode(null);
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* 忽略 */ }
  };
  const showKeyboard = () => { focusEditor(); };
  // 工具栏“收起/展开键盘”按钮：无面板 = 按键盘开合切换；有面板 = 收起面板（键盘此前已收起）
  const onKbToggle = () => { if (panelMode) dismissKeyboard(); else if (keyboardOpen) dismissKeyboard(); else showKeyboard(); };
  const kbLabel = panelMode ? "收起面板" : (keyboardOpen ? "收起键盘" : "展开键盘");

  // --kb-offset：无面板 = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；
  // 有面板 = innerHeight - base + panelHeight —— 键盘正在收起的过程中（innerHeight 530→842），
  // 工具栏的**屏幕 Y 恒定**（HANDOFF §8.3 的原始结论），面板则占住腾出来的键盘区 = 向下展开。
  const isOn = (name: string) => !!activeStates[name];
  const plusCls = "med-btn med-toggle" + (panelMode === "insert" ? " med-open" : "");
  const aaCls = "med-btn med-toggle med-aa" + (panelMode === "font" ? " med-open" : "");

  return (
    <div ref={dockRef} className="mobile-editor-dock" data-panel={panelMode ?? "none"} style={{ ["--kb-offset" as string]: `${usable}px` } as import("react").CSSProperties}>
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

      {/* 展开面板（覆盖输入法区域） */}
      {panelMode && (
        <div className="med-panel" onMouseDown={(e) => e.preventDefault()}>
          {panelMode === "insert" ? (
            <div className="med-ins-grid">
              <button className="med-ins-item" onClick={() => { onInsertImage?.(); }} title="图片" aria-label="图片"><ImageIcon size={20} /></button>
              <button className="med-ins-item" onClick={() => { onInsertAttachment?.(); }} title="附件" aria-label="附件"><Paperclip size={20} /></button>
              <button className="med-ins-item" onClick={() => { onInsertAudio?.(); }} title="音频" aria-label="音频"><Music size={20} /></button>
              <button className="med-ins-item" onClick={() => { onInsertVideo?.(); }} title="视频" aria-label="视频"><Video size={20} /></button>
              <button className="med-ins-item" onClick={() => { onInsertTable?.(); }} title="表格" aria-label="表格"><Table2 size={20} /></button>
              <button className="med-ins-item" onClick={() => runPanel("quote")} title="引用" aria-label="引用"><Quote size={20} /></button>
              <button className="med-ins-item" onClick={() => runPanel("hr")} title="分割线" aria-label="分割线"><Minus size={20} /></button>
              <button className="med-ins-item" onClick={() => runPanel("insertCard", "codeblock")} title="代码块" aria-label="代码块"><Code2 size={20} /></button>
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
      )}

    </div>
  );
}
