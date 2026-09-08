/**
 * 移动端编辑态底部 dock（app 化适配，对齐 prototype/index.html 编辑态交互）：
 * - 主工具栏悬浮在输入法上方：插入(+)、Aa（字体）、B、列表、待办、更多、收起键盘
 * - 展开面板覆盖输入法区域：insert（图片/附件/表格/引用/分割线/代码块）+ font（块级/行内/对齐/颜色/背景）
 * - 键盘收起（dock 隐藏 + 右下角重显按钮）
 * 格式命令走 Lake renderer.execCommand（文本 ne-* 属性；块级 style "h1"/"p" 等）。
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Type, Bold, List, ListTodo, Keyboard, X, Check, Image as ImageIcon, Paperclip, Table2, Quote, Minus, Code2, Music, Video } from "lucide-react";
import { lakeBridge, type LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { MARK_COMMANDS, BLOCK_INSERT_COMMANDS, HISTORY_COMMANDS, STYLE_BLOCKS } from "../../features/editor/editorCommands";
import { useKeyboard } from "../useKeyboard";

type PanelMode = "insert" | "font" | null;

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
  // 面板打开时占用「键盘空间」的高度：打开瞬间捕获键盘实际高度（height），随后收起键盘（不需要打字了）
  const [panelHeight, setPanelHeight] = useState(0);
  const { base, innerHeight, offset, height, keyboardOpen } = useKeyboard();
  const exec = useEditorExec(editor);
  const execRef = useRef(exec);
  execRef.current = exec;

  // 退出编辑态时复位
  useEffect(() => {
    if (!editing) { setPanelMode(null); setPanelHeight(0); }
  }, [editing]);

  // 用户点击可编辑正文（要打字）→ 立即收起面板、恢复输入法键盘，绝不让「面板展开 + 键盘」同时出现。
  // 面板项按钮已 onMouseDown preventDefault 不抢焦点，故焦点落回 contenteditable 只可能是用户点了编辑区。
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== "function") return;
      if (t.closest('[contenteditable="true"]')) { setPanelMode(null); setPanelHeight(0); }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // 编辑态常驻底部工具栏（完成/插入/字体等）；键盘弹出时悬浮在键盘上方。
  if (!editing) return null;

  const focusEditor = () => {
    try { const ce = document.querySelector<HTMLElement>(".doc-pane.active [contenteditable]"); ce?.focus(); } catch { /* 忽略 */ }
    try { lakeBridge(editor ?? undefined).renderer?.execCommand?.("focus" as never); } catch { /* 忽略 */ }
  };
  // 切换展开面板：打开时把键盘高度捕获为面板占用空间，并收起键盘（用工具时不打字，直接占键盘空间）
  const togglePanel = (mode: Exclude<PanelMode, null>) => {
    if (panelMode === mode) {                                     // 关闭面板 → 自动恢复键盘（不需要手动）
      setPanelMode(null);
      setPanelHeight(0);
      focusEditor();
      return;
    }
    if (!panelMode) {                                             // 仅从关闭态打开：捕获键盘高度（此后工具栏不抖）
      setPanelHeight(Math.max(Math.round(height), 280));
      // 立即收起键盘（不再 setTimeout 延迟）：面板打开即代表不再打字，键盘必须马上让位，避免两者同现。
      try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* 忽略 */ }
    }                                                             // 面板间切换(insert<->font)保持原高度 → 工具栏不抖
    setPanelMode(mode);
  };
  // 工具栏行内命令（bold/列表/待办）：按钮已用 onMouseDown preventDefault 防止抢焦点，
  // 编辑器保持焦点 + 选区/光标保留 → 命令作用于正确位置，键盘也不被收起（继续打字）。
  const runInline = (cmd: string, ...args: unknown[]) => { exec(cmd, ...args); };
  // 面板项命令（正文/标题/引用/分割线/代码/字体等）：只执行，不聚焦 → 不重开输入法（面板已占用键盘空间）
  const runPanel = (cmd: string, ...args: unknown[]) => { exec(cmd, ...args); };

  // 收起键盘：手动收起（编辑态保留）。有关闭面板则先收起面板（不恢复键盘——用户明确要收起）。
  const dismissKeyboard = () => {
    setPanelMode(null);
    setPanelHeight(0);
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* 忽略 */ }
  };
  const showKeyboard = () => { focusEditor(); };
  // 工具栏“收起/展开键盘”按钮：无面板 = 按键盘开合切换；有面板 = 收起面板（键盘此前已收起）
  const onKbToggle = () => { if (panelMode) dismissKeyboard(); else if (keyboardOpen) dismissKeyboard(); else showKeyboard(); };
  const kbLabel = panelMode ? "收起面板" : (keyboardOpen ? "收起键盘" : "展开键盘");
  const exitEdit = () => { onToggleEdit?.(); dismissKeyboard(); };

  // 工具栏底部基准：无面板 = 键盘上移量(offset，adjustResize=0)；有面板 = 面板占用的键盘高度
  // 工具栏 bottom 基准（--kb-offset，CSS 再加 4px）：
  //  - 无面板：键盘开合由 WebView 自身处理（adjustResize 下 innerHeight 已缩，offset=0 → 贴底即为键盘上方）。
  //  - 有面板：用 innerHeight-base+panelHeight，让工具栏屏幕 Y 恒定在「键盘/面板上方」——键盘收起、innerHeight
  //    530→842 的过程中 toolbar 的位置不跳（原先直接用 panelHeight 会在视图仍 530 时闪到屏幕中间）。
  // 有面板：面板以固定高度占满底部（>= 键盘高度），且面板打开即收起键盘 → 面板与输入法键盘绝不叠加。
  // 不用 innerHeight-base+panelHeight（键盘未收时 innerHeight<base 会让面板高度算成 0 → 面板不可见 + 键盘仍显示）。
  const usable = panelMode ? Math.max(0, panelHeight) : offset;
  const plusCls = "med-btn" + (panelMode === "insert" ? " med-active" : "");
  const aaCls = "med-btn med-aa" + (panelMode === "font" ? " med-active" : "");

  return (
    <div className="mobile-editor-dock" data-panel={panelMode ?? "none"} style={{ ["--kb-offset" as string]: `${usable}px` } as import("react").CSSProperties}>
      {/* 主工具栏（悬浮输入法上方） */}
      <div className="med-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button className={plusCls} onClick={() => togglePanel("insert")} aria-label="插入">
          {panelMode === "insert" ? <X size={20} /> : <Plus size={21} />}
        </button>
        <button className={aaCls} onClick={() => togglePanel("font")} aria-label="字体">Aa</button>
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
              <button className="med-ins-item" onClick={() => { onInsertImage?.(); }}><ImageIcon size={20} /><span>图片</span></button>
              <button className="med-ins-item" onClick={() => { onInsertAttachment?.(); }}><Paperclip size={20} /><span>附件</span></button>
              <button className="med-ins-item" onClick={() => { onInsertAudio?.(); }}><Music size={20} /><span>音频</span></button>
              <button className="med-ins-item" onClick={() => { onInsertVideo?.(); }}><Video size={20} /><span>视频</span></button>
              <button className="med-ins-item" onClick={() => { onInsertTable?.(); }}><Table2 size={20} /><span>表格</span></button>
              <button className="med-ins-item" onClick={() => runPanel("quote")}><Quote size={20} /><span>引用</span></button>
              <button className="med-ins-item" onClick={() => runPanel("hr")}><Minus size={20} /><span>分割线</span></button>
              <button className="med-ins-item" onClick={() => runPanel("code")}><Code2 size={20} /><span>代码块</span></button>
            </div>
          ) : (
            <div className="med-font-panel">
              {/* 块级样式（style 命令：光标在段内即可执行，面板 blur 后仍有效） */}
              <div className="med-f-row">
                {STYLE_BLOCKS.map((b) => (
                  <button key={b.value} className="med-f-btn" onClick={() => runPanel("style", b.value)}>{b.label}</button>
                ))}
              </div>
              {/* 行内标记（需先选中文本；主工具栏 B/列表/待办走 runInline 保选区更可靠） */}
              <div className="med-f-row">
                {MARK_COMMANDS.map((c) => (
                  <button key={c.name} className={"med-f-btn" + (c.name === "bold" ? " med-b" : "")} onClick={() => runPanel(c.name)}>{c.label}</button>
                ))}
              </div>
              {/* 块级/插入命令 */}
              <div className="med-f-row">
                {BLOCK_INSERT_COMMANDS.map((c) => (
                  <button key={c.name} className="med-f-btn" onClick={() => runPanel(c.name)}>{c.label}</button>
                ))}
              </div>
              {/* 历史 */}
              <div className="med-f-row">
                {HISTORY_COMMANDS.map((c) => (
                  <button key={c.name} className="med-f-btn" onClick={() => runPanel(c.name)}>{c.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}