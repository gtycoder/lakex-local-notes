/**
 * 移动端编辑态底部 dock（app 化适配，对齐 prototype/index.html 编辑态交互）：
 * - 主工具栏悬浮在输入法上方：插入(+)、Aa（字体）、B、列表、待办、更多、收起键盘
 * - 展开面板覆盖输入法区域：insert（图片/附件/表格/引用/分割线/代码块）+ font（块级/行内/对齐/颜色/背景）
 * - 键盘收起（dock 隐藏 + 右下角重显按钮）
 * 格式命令走 Lake renderer.execCommand（文本 ne-* 属性；块级 style "h1"/"p" 等）。
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Bold, Italic, Underline, List, ListOrdered, ListTodo, Keyboard, X, Check, Image as ImageIcon, Paperclip, Table2, Quote, Minus, Code2, Music, Video, Undo2, Redo2, Pilcrow, Type } from "lucide-react";
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

/** 格式命令 → lucide 图标（正文面板用图标而非文字，对齐思源移动端） */
const COMMAND_ICONS: Record<string, typeof Bold> = {
  bold: Bold, italic: Italic, underline: Underline, code: Code2,
  quote: Quote, unorderedList: List, orderedList: ListOrdered, taskList: ListTodo,
  hr: Minus, undo: Undo2, redo: Redo2,
};

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
  const exec = useEditorExec(editor);
  const execRef = useRef(exec);
  execRef.current = exec;

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
  // 面板开 = 面板高 + 工具栏高；面板关（编辑态）= 工具栏高。
  useEffect(() => {
    const toolbar = 54; // .med-toolbar 高 48 + 与面板的 6px 间隙
      const space = editing ? (panelMode ? panelHeight + toolbar : toolbar) : 0;
    // 作用域放到 dock 的父容器（.doc-pane / .mobile-document），而非全局 documentElement——避免多 tab 实例互相覆盖
    const root = dockRef.current?.parentElement ?? document.documentElement;
    root.style.setProperty("--mobile-dock-space", `${space}px`);
    return () => { root.style.removeProperty("--mobile-dock-space"); };
  }, [editing, panelMode, panelHeight]);

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
    if (panelMode === mode) {                                      // 再点一次 = 关面板并回到打字
      setPanelMode(null);
      setPanelHeight(0);
      focusEditor();
      return;
    }
    snapshotSelection();
    if (!panelMode) setPanelHeight(Math.max(Math.round(height), 280));   // 只在"从关到开"时捕获键盘高度
    setPanelMode(mode);                                            // insert ↔ font 切换沿用原高度 → 工具栏不抖
    requestAnimationFrame(() => { if (panelMode || true) dismissIme(); });
  };

  // 工具栏行内命令（bold/列表/待办）：按钮 onMouseDown preventDefault 不抢焦点 →
  // 焦点/选区留在正文，命令作用在正确位置，键盘不收；执行后再记一次选区，供面板连续使用。
  const runInline = (cmd: string, ...args: unknown[]) => { exec(cmd, ...args); snapshotSelection(); };
  // 面板项命令：**还原选区 → 执行 → 再记选区 → 面板保持打开**（加粗后还能接着点倾斜/下划线），
  // 且命令若把焦点抢回正文（会顶出输入法、把面板挤掉）就在下一帧再收一次键盘。
  const runPanel = (cmd: string, ...args: unknown[]) => {
    restoreSelection();
    exec(cmd, ...args);
    snapshotSelection();
    dismissIme();                                                  // 面板占着键盘区，命令后别把键盘顶回来
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
  const exitEdit = () => { onToggleEdit?.(); dismissKeyboard(); };

  // --kb-offset：无面板 = 键盘上移量（adjustResize 恒 0；edge-to-edge = 键盘高度）；
  // 有面板 = innerHeight - base + panelHeight —— 键盘正在收起的过程中（innerHeight 530→842），
  // 工具栏的**屏幕 Y 恒定**（HANDOFF §8.3 的原始结论），面板则占住腾出来的键盘区 = 向下展开。
  const usable = panelMode ? Math.max(0, Math.round(innerHeight - base + panelHeight)) : offset;
  const plusCls = "med-btn" + (panelMode === "insert" ? " med-active" : "");
  const aaCls = "med-btn med-aa" + (panelMode === "font" ? " med-active" : "");

  return (
    <div ref={dockRef} className="mobile-editor-dock" data-panel={panelMode ?? "none"} style={{ ["--kb-offset" as string]: `${usable}px` } as import("react").CSSProperties}>
      {/* 主工具栏（悬浮输入法上方） */}
      <div className="med-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button className={plusCls} onClick={() => togglePanel("insert")} aria-label="插入">
          {panelMode === "insert" ? <X size={20} /> : <Plus size={21} />}
        </button>
        <button className={aaCls} onClick={() => togglePanel("font")} aria-label="字体"><Type size={20} /></button>
        <button className="med-btn med-b" onClick={() => runInline("bold")} aria-label="加粗"><Bold size={19} /></button>
        <button className="med-btn" onClick={() => runInline("unorderedList" as never)} aria-label="列表"><List size={20} /></button>
        <button className="med-btn" onClick={() => runInline("taskList" as never)} aria-label="待办"><ListTodo size={20} /></button>
        <button className="med-btn" onClick={onKbToggle} aria-label={kbLabel}><Keyboard size={19} /></button>
        <button className="med-btn med-done" onClick={exitEdit} aria-label="完成"><Check size={20} /></button>
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
                  return <button key={c.name} className="med-f-btn" onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>{Icon ? <Icon size={17} /> : c.label}</button>;
                })}
              </div>
              {/* 块级/插入命令 */}
              <div className="med-f-row">
                {BLOCK_INSERT_COMMANDS.map((c) => {
                  const Icon = COMMAND_ICONS[c.name];
                  return <button key={c.name} className="med-f-btn" onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>{Icon ? <Icon size={17} /> : c.label}</button>;
                })}
              </div>
              {/* 历史 */}
              <div className="med-f-row">
                {HISTORY_COMMANDS.map((c) => {
                  const Icon = COMMAND_ICONS[c.name];
                  return <button key={c.name} className="med-f-btn" onClick={() => runPanel(c.name)} aria-label={c.label} title={c.label}>{Icon ? <Icon size={17} /> : c.label}</button>;
                })}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}