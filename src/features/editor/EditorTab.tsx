import { useEffect, useRef } from "react";
import { createLakeDocument, destroyLakeEditor, refreshTocSidebar, type LakeEditorInstance } from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";

export interface EditorTabProps {
  noteId: string;
  content: string;
  visible: boolean;
  tocEnabled: boolean;
  onChange: (content: string) => void;
}

export function EditorTab({ noteId, content, visible, tocEnabled, onChange }: EditorTabProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 性能排查探针：记录标签页可见性变化，用于对齐图片懒加载（IntersectionObserver）
  // 与 display:none 容器的关系（显示：不可见容器内元素不会触发交叉回调）
  useEffect(() => {
    console.log(`[lake-perf] tab visible ${noteId.slice(0, 8)} visible=${visible} @${Math.round(performance.now())}ms`);
  }, [noteId, visible]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

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
      editor = createLakeDocument(host, "editor", () => {
        if (editor && !setting) onChangeRef.current(editor.getDocument("text/lake"));
      }, tocEnabled, noteId, host);
      editor.setDocument("text/lake", content);
      // 试验修复：Lake TOC 侧边栏创建时用空 toc 渲染，补一次数据同步
      setTimeout(() => refreshTocSidebar(editor), 0);
      setting = false;
      editorRef.current = editor;
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
      destroyLakeEditor(editor);
      editorRef.current = null;
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  return (
    <div
      ref={hostRef}
      className="lake-editor lake-editor-tab"
      style={{ display: visible ? "block" : "none", width: "100%" }}
      data-note-id={noteId}
    />
  );
}
