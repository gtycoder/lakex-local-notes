import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { createLakeDocument, destroyLakeEditor, refreshTocSidebar, type LakeEditorInstance, type LakeEditorPrefs } from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";

interface LakeEditorProps {
  noteId: string;
  content: string;
  mode?: "viewer" | "editor";
  tocEnabled: boolean;
  onChange: (content: string) => void;
  prefs?: LakeEditorPrefs;
  onEditorReady?: (noteId: string, editor: LakeEditorInstance | null) => void;
}

export function LakeEditor({ noteId, content, mode = "editor", tocEnabled, onChange, prefs, onEditorReady }: LakeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const onEditorReadyRef = useRef(onEditorReady);
  const [error, setError] = useState<string | null>(null);
  onChangeRef.current = onChange;
  onEditorReadyRef.current = onEditorReady;

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
    // 防失焦：表情框（.ne-card-unicode-emoji）和公式框（.ne-math-entry）刚插入后，
    // mousedown 的浏览器默认行为会让编辑器失焦/折叠选区，导致 Lake 卡片第一次点击
    // 无法被聚焦（选择器/编辑器面板不打开），必须点别处再点一次才生效。
    // 在捕获阶段 preventDefault，保留编辑器选区，使卡片首次点击即可打开。
    const preventCardBlur = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === "function") {
        if (target.closest(".ne-card-unicode-emoji, .ne-math-entry")) event.preventDefault();
      }
    };
    host.addEventListener("mousedown", preventCardBlur, true);
    host.addEventListener("copy", copyRichSelection, true);
    host.addEventListener("paste", pasteHandler, true);

    let editor: LakeEditorInstance | null = null;
    let disposeTocRefresh: (() => void) | null = null;
    let tocRefreshTimer: number | undefined;
    let setting = true;
    try {
      editor = createLakeDocument(host, mode, () => {
        if (editor && !setting) onChangeRef.current(stripAssetAccessToken(editor.getDocument("text/lake")));
      }, tocEnabled, noteId, undefined, prefs);
      editor.setDocument("text/lake", addAssetAccessToken(content));
      // 修复：Lake TOC 侧边栏创建时用空 toc 渲染，setDocument 后补一次数据同步。
      // 该补偿有重试定时器，必须跟随实例一起清理。
      tocRefreshTimer = window.setTimeout(() => {
        disposeTocRefresh = refreshTocSidebar(editor);
      }, 0);
      setting = false;
      editorRef.current = editor;
      onEditorReadyRef.current?.(noteId, editor);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    return () => {
      host.removeEventListener("mousedown", preventCardBlur, true);
      host.removeEventListener("copy", copyRichSelection, true);
      host.removeEventListener("paste", pasteHandler, true);
      window.clearTimeout(tocRefreshTimer);
      disposeTocRefresh?.();
      onEditorReadyRef.current?.(noteId, null);
      destroyLakeEditor(editor);
      editorRef.current = null;
      host.replaceChildren();
    };
  }, [noteId, mode, tocEnabled, prefs?.fontSize, prefs?.showToolbar]);

  if (error) {
    return <div className="editor-error"><AlertCircle size={18} /><span>{error}</span></div>;
  }
  return <div className={`lake-editor lake-${mode}`} ref={hostRef} />;
}
