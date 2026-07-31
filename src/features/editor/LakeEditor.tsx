import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance } from "./lakeRuntime";
import { normalizeClipboardHtml } from "./clipboardHtml";

interface LakeEditorProps {
  noteId: string;
  content: string;
  mode?: "viewer" | "editor";
  tocEnabled: boolean;
  onChange: (content: string) => void;
}

export function LakeEditor({ noteId, content, mode = "editor", tocEnabled, onChange }: LakeEditorProps) {
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
      
      // Set clipboard data synchronously
      const plainText = selection.toString();
      const html = normalizeClipboardHtml(range.cloneContents(), document);
      event.clipboardData.setData("text/html", html);
      event.clipboardData.setData("text/plain", plainText);
      event.preventDefault();
    };
    host.addEventListener("copy", copyRichSelection);

    let editor: LakeEditorInstance | null = null;
    let setting = true;
    try {
      editor = createLakeDocument(host, mode, () => {
        if (editor && !setting) onChangeRef.current(editor.getDocument("text/lake"));
      }, tocEnabled, noteId);
      editor.setDocument("text/lake", content);
      setting = false;
      editorRef.current = editor;
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    return () => {
      host.removeEventListener("copy", copyRichSelection);
      destroyLakeEditor(editor);
      editorRef.current = null;
      host.replaceChildren();
    };
  }, [noteId, mode, tocEnabled]);

  if (error) {
    return <div className="editor-error"><AlertCircle size={18} /><span>{error}</span></div>;
  }
  return <div className={`lake-editor lake-${mode}`} ref={hostRef} />;
}
