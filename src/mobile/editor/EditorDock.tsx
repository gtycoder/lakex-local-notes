/**
 * 移动端编辑态底部 dock（app 化适配，对齐 prototype/index.html 编辑态交互）：
 * - 主工具栏悬浮在输入法上方：插入(+)、Aa（字体）、B、列表、待办、更多、收起键盘
 * - 展开面板覆盖输入法区域：insert（图片/附件/表格/引用/分割线/代码块）+ font（块级/行内/对齐/颜色/背景）
 * - 键盘收起（dock 隐藏 + 右下角重显按钮）
 * 格式命令走 Lake renderer.execCommand（文本 ne-* 属性；块级 style "h1"/"p" 等）。
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Type, Bold, List, ListTodo, MoreHorizontal, Keyboard, X, Image as ImageIcon, Paperclip, Table2, Quote, Minus, Code2, ChevronDown } from "lucide-react";
import { lakeBridge, type LakeEditorInstance } from "../../features/editor/lakeRuntime";

type PanelMode = "insert" | "font" | null;

export interface EditorDockProps {
  editor: LakeEditorInstance | null;
  /** 编辑态才渲染 */
  editing: boolean;
  /** 触发图片插入（选文件 → 上传 → 插入 Lake） */
  onInsertImage?: () => void;
  /** 触发附件插入 */
  onInsertAttachment?: () => void;
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

export function EditorDock({ editor, editing, onInsertImage, onInsertAttachment, onInsertTable }: EditorDockProps) {
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [dockHidden, setDockHidden] = useState(false);
  const exec = useEditorExec(editor);
  const execRef = useRef(exec);
  execRef.current = exec;

  // 退出编辑态时复位
  useEffect(() => {
    if (!editing) { setPanelMode(null); setDockHidden(false); }
  }, [editing]);

  if (!editing) return null;

  const focusEditor = () => { try { lakeBridge(editor ?? undefined).renderer?.execCommand?.("focus" as never); } catch { /* 忽略 */ } };
  const togglePanel = (mode: Exclude<PanelMode, null>) => setPanelMode((p) => (p === mode ? null : mode));
  const run = (cmd: string, ...args: unknown[]) => { exec(cmd, ...args); focusEditor(); };

  const hideKeyboard = () => {
    setPanelMode(null);
    setDockHidden(true);
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { /* 忽略 */ }
  };
  const showKeyboard = () => {
    setDockHidden(false);
    focusEditor();
  };

  const plusCls = "med-btn" + (panelMode === "insert" ? " med-active" : "");
  const aaCls = "med-btn med-aa" + (panelMode === "font" ? " med-active" : "");

  return (
    <div className="mobile-editor-dock" data-panel={panelMode ?? "none"} data-hidden={dockHidden ? "1" : "0"}>
      {/* 主工具栏（悬浮输入法上方） */}
      <div className="med-toolbar">
        <button className={plusCls} onClick={() => togglePanel("insert")} aria-label="插入">
          {panelMode === "insert" ? <X size={20} /> : <Plus size={21} />}
        </button>
        <button className={aaCls} onClick={() => togglePanel("font")} aria-label="字体">Aa</button>
        <button className="med-btn med-b" onClick={() => run("bold")} aria-label="加粗"><Bold size={19} /></button>
        <button className="med-btn" onClick={() => run("insertUnorderedList" as never)} aria-label="列表"><List size={20} /></button>
        <button className="med-btn" onClick={() => run("taskList" as never)} aria-label="待办"><ListTodo size={20} /></button>
        <button className="med-btn" onClick={() => togglePanel("font")} aria-label="更多"><MoreHorizontal size={20} /></button>
        <button className="med-btn" onClick={hideKeyboard} aria-label="收起键盘"><Keyboard size={19} /></button>
      </div>

      {/* 展开面板（覆盖输入法区域） */}
      {panelMode && (
        <div className="med-panel">
          {panelMode === "insert" ? (
            <div className="med-ins-grid">
              <button className="med-ins-item" onClick={() => { onInsertImage?.(); }}><ImageIcon size={20} /><span>图片</span></button>
              <button className="med-ins-item" onClick={() => { onInsertAttachment?.(); }}><Paperclip size={20} /><span>附件</span></button>
              <button className="med-ins-item" onClick={() => { onInsertTable?.(); }}><Table2 size={20} /><span>表格</span></button>
              <button className="med-ins-item" onClick={() => run("quote")}><Quote size={20} /><span>引用</span></button>
              <button className="med-ins-item" onClick={() => run("hr")}><Minus size={20} /><span>分割线</span></button>
              <button className="med-ins-item" onClick={() => run("code")}><Code2 size={20} /><span>代码块</span></button>
            </div>
          ) : (
            <div className="med-font-panel">
              <div className="med-f-row">
                {["p", "h1", "h2", "h3", "h4"].map((b) => (
                  <button key={b} className="med-f-btn" onClick={() => run("style" as never, b)}>{b === "p" ? "正文" : b.toUpperCase()}</button>
                ))}
              </div>
              <div className="med-f-row">
                <button className="med-f-btn med-b" onClick={() => run("bold")}>B</button>
                <button className="med-f-btn med-i" onClick={() => run("italic")}>I</button>
                <button className="med-f-btn med-s" onClick={() => run("strikethrough")}>S</button>
                <button className="med-f-btn med-u" onClick={() => run("underline")}>U</button>
                <button className="med-f-btn" onClick={() => run("clearFormat" as never)}>清除</button>
              </div>
              <div className="med-f-row">
                <button className="med-f-btn" onClick={() => run("indent")}>缩进</button>
                <button className="med-f-btn" onClick={() => run("outdent")}>减少</button>
                <button className="med-f-btn" onClick={() => run("undo")}>撤销</button>
                <button className="med-f-btn" onClick={() => run("redo" as never)}>重做</button>
              </div>
              <div className="med-f-row med-f-align">
                <button className="med-f-btn" onClick={() => run("justifyLeft" as never)}>左</button>
                <button className="med-f-btn" onClick={() => run("justifyCenter" as never)}>中</button>
                <button className="med-f-btn" onClick={() => run("justifyRight" as never)}>右</button>
                <button className="med-f-btn" onClick={() => run("fontsize" as never, 2)}><ChevronDown size={16} />Aa</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 键盘收起后的重显按钮 */}
      {dockHidden && (
        <button className="med-kb-reshow" onClick={showKeyboard} aria-label="展开工具栏"><Keyboard size={20} /></button>
      )}
    </div>
  );
}