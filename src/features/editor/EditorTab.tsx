import { useEffect, useRef } from "react";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance } from "./lakeRuntime";
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
    const initialContent = content;
    try {
      editor = createLakeDocument(host, "editor", () => {
        if (!editor) return;
        const current = editor.getDocument("text/lake");
        if (current === initialContent) return;
        onChangeRef.current(current);
      }, tocEnabled, noteId);
      editor.setDocument("text/lake", content);
      editorRef.current = editor;
    } catch (reason) {
      console.error("Failed to create editor for tab", noteId, reason);
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
