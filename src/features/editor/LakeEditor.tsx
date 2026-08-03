import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { createLakeDocument, destroyLakeEditor, refreshTocSidebar, type LakeEditorInstance, type LakeEditorPrefs } from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";

interface LakeEditorProps {
  noteId: string;
  content: string;
  mode?: "viewer" | "editor";
  tocEnabled: boolean;
  onChange: (content: string) => void;
  prefs?: LakeEditorPrefs;
}

export function LakeEditor({ noteId, content, mode = "editor", tocEnabled, onChange, prefs }: LakeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const [error, setError] = useState<string | null>(null);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const copyRichSelection = (event: ClipboardEvent) => {
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
    host.addEventListener("copy", copyRichSelection, true);
    host.addEventListener("paste", pasteHandler, true);

    let editor: LakeEditorInstance | null = null;
    let setting = true;
    try {
      editor = createLakeDocument(host, mode, () => {
        if (editor && !setting) onChangeRef.current(editor.getDocument("text/lake"));
      }, tocEnabled, noteId, undefined, prefs);
      editor.setDocument("text/lake", content);
      // 修复：Lake TOC 侧边栏创建时用空 toc 渲染，setDocument 后补一次数据同步
      setTimeout(() => refreshTocSidebar(editor), 0);
      setting = false;
      editorRef.current = editor;
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    return () => {
      host.removeEventListener("copy", copyRichSelection, true);
      host.removeEventListener("paste", pasteHandler, true);
      destroyLakeEditor(editor);
      editorRef.current = null;
      host.replaceChildren();
    };
  }, [noteId, mode, tocEnabled, prefs?.fontSize, prefs?.showToolbar, prefs?.dark]);

  if (error) {
    return <div className="editor-error"><AlertCircle size={18} /><span>{error}</span></div>;
  }
  return <div className={`lake-editor lake-${mode}`} ref={hostRef} />;
}
