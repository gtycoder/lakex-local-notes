import { useEffect, useRef, useState } from "react";
import {
  createLakeDocument,
  destroyLakeEditor,
  resolveScrollNode,
  type LakeEditorInstance,
  type LakeEditorPrefs,
} from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";
import { ListTree } from "lucide-react";
import type { OutlineMode } from "../outline/OutlineController";
import { OutlinePanel } from "../outline/OutlinePanel";
import { useOutline } from "../outline/useOutline";

export interface EditorTabProps {
  noteId: string;
  content: string;
  visible: boolean;
  tocEnabled: boolean;
  onChange: (content: string) => void;
  prefs?: LakeEditorPrefs;
  /** 编辑器实例就绪回调（导出 md 等需要访问 editor 实例的场景） */
  onEditorReady?: (noteId: string, editor: LakeEditorInstance | null) => void;
}

function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}

export function EditorTab({ noteId, content, visible, tocEnabled, onChange, prefs, onEditorReady }: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorMountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const [editorState, setEditorState] = useState<LakeEditorInstance | null>(null);
  const [outlineMode, setOutlineMode] = useState<OutlineMode>(tocEnabled ? "docked" : "hidden");
  const onChangeRef = useRef(onChange);
  const onEditorReadyRef = useRef(onEditorReady);
  onChangeRef.current = onChange;
  onEditorReadyRef.current = onEditorReady;

  const controller = useOutline(editorState, hostRef.current, noteId, tocEnabled, visible);

  // 设置里关闭「显示文档大纲」时隐藏面板（重新打开后保持用户当前形态）
  useEffect(() => {
    if (!tocEnabled) setOutlineMode("hidden");
  }, [tocEnabled]);

  useEffect(() => {
    const host = hostRef.current;
    const mount = editorMountRef.current;
    if (!host || !mount) return;

    const copyHandler = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!event.clipboardData || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!host.contains(range.commonAncestorContainer)) return;
      const plainText = selection.toString();
      const html = normalizeClipboardHtml(range.cloneContents(), document);
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", plainText);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const pasteHandler = (event: ClipboardEvent) => {
      const dt = event.clipboardData;
      if (!dt) return;
      const html = dt.getData("text/html");
      if (!html) return;
      const upgraded = upgradePastedHtml(html);
      if (upgraded !== html) dt.setData("text/html", upgraded);
    };
    host.addEventListener("copy", copyHandler, true);
    host.addEventListener("paste", pasteHandler, true);

    let editor: LakeEditorInstance | null = null;
    // 与 LakeEditor 保持一致：setDocument 初始化期间也会触发 contentchange，
    // 若此时回调里同步 getDocument() 会把整篇大文档（含图片/OCR JSON）序列化一遍，
    // 在主线程上额外叠加耗时；用 setting 标志屏蔽初始化阶段的重复序列化。
    let setting = true;
    if (typeof performance !== "undefined") performance.mark("lake:tab-init:start");
    try {
      editor = createLakeDocument(
        mount,
        "editor",
        () => {
          if (editor && !setting) onChangeRef.current(editor.getDocument("text/lake"));
        },
        tocEnabled,
        noteId,
        host,
        { ...prefs, disableNativeToc: true }
      );
      editor.setDocument("text/lake", content);
      setting = false;
      editorRef.current = editor;
      setEditorState(editor);
      onEditorReadyRef.current?.(noteId, editor);
    } catch (reason) {
      console.error("Failed to create editor for tab", noteId, reason);
    } finally {
      if (typeof performance !== "undefined" && performance.getEntriesByName("lake:tab-init:start").length) {
        performance.mark("lake:tab-init:end");
        try { performance.measure("lake:tab-init:create+setDocument", "lake:tab-init:start", "lake:tab-init:end"); } catch { /* 忽略 */ }
      }
    }

    return () => {
      host.removeEventListener("copy", copyHandler, true);
      host.removeEventListener("paste", pasteHandler, true);
      onEditorReadyRef.current?.(noteId, null);
      destroyLakeEditor(editor);
      editorRef.current = null;
      setEditorState(null);
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, tocEnabled, prefs?.fontSize, prefs?.showToolbar]);

  const handleOutlineNavigate = (id: string): void => {
    const editor = editorRef.current;
    const host = hostRef.current;
    if (!editor || !host) return;
    // 折叠标题先展开（接管原生 tocPositionChange → headingUnfold 链路）
    try {
      (editor as any)?.renderer?.execCommand?.("headingUnfold", id);
    } catch { /* 忽略 */ }
    try {
      (editor as any)?.renderer?.scrollByNodeId?.(id);
    } catch { /* 忽略 */ }
    // 懒卡片占位高度导致的偏差在渲染/水合稳定后校正两次
    const scroller = resolveScrollNode(host);
    const correct = (): void => {
      const el = host.querySelector(`[id="${escapeId(id)}"]`) as HTMLElement | null;
      if (!el || !scroller) return;
      const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      if (Math.abs(delta) > 2) scroller.scrollTop += delta;
    };
    window.setTimeout(correct, 50);
    window.setTimeout(correct, 200);
  };

  return (
    <div
      ref={hostRef}
      className="lake-editor lake-editor-tab"
      style={{ display: visible ? "flex" : "none", width: "100%" }}
      data-note-id={noteId}
    >
      <div ref={editorMountRef} className="lake-editor-main" />
      {outlineMode !== "hidden" ? (
        <OutlinePanel
          controller={controller}
          mode={outlineMode}
          onNavigate={handleOutlineNavigate}
          onModeChange={setOutlineMode}
        />
      ) : (
        tocEnabled && (
          <button
            className="outline-reopen-btn"
            title="显示大纲"
            onClick={() => setOutlineMode("docked")}
          >
            <ListTree size={14} />
            <span>大纲</span>
          </button>
        )
      )}
    </div>
  );
}
