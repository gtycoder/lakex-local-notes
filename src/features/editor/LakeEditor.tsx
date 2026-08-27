import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { createLakeDocument, destroyLakeEditor, refreshTocSidebar, type LakeEditorInstance, type LakeEditorPrefs } from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { ImageLightbox } from "./ImageLightbox";
import { attachImagePreviewClick } from "./imagePreview";
import { attachFileCardClick, buildAttachmentPreviewItem, openAttachmentPreview, type AttachmentPreviewItem } from "../attachment/attachmentPreviewController";
import { AttachmentPreview } from "../attachment/AttachmentPreview";
import { isDesktop, native } from "../../lib/native";

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
    // 图片点击放大预览（桌面/移动端共用）：捕获阶段监听 img.ne-image 点击，
    // 收集文档内全部图片（画廊）打开共享 Lightbox。不 preventDefault——
    // Lake 自身的卡片选中/编辑行为照常，预览作为叠加层展示。
    // 注：不依赖 Lake 内置 allowClickToMaximize（该选项在本构建未传导到渲染层，实测无效）。
    const detachImagePreview = attachImagePreviewClick(host);
    // 附件：file 卡片点击 → 打开（桌面/移动端共用，媒体内嵌播放、非媒体系统打开）。
    // - 媒体附件（音频/视频）：应用内嵌播放 overlay（AudioPreview 内联 <audio>/<video>，不跳系统浏览器）
    // - 非媒体附件（PDF/Office/zip 等）：点击直接系统应用打开（跳过预览弹窗——本地文件无需中间层）
    // - 桌面默认 directOpen（isDesktop）；移动端显式传 attachment.directOpen=true
    const attachment = prefs?.attachment;
    const openAttachmentDefault = (it: AttachmentPreviewItem): void => {
      if (it.ref) void native.openAttachment(it.ref.noteId, it.ref.filename).then((r) => { if (!r.ok) console.warn("[attach] 打开失败:", r.error); });
    };
    const showInFolder = (it: AttachmentPreviewItem): void => {
      if (it.ref) void native.showAttachmentInFolder(it.ref.noteId, it.ref.filename);
    };
    const directOpen = attachment?.directOpen ?? isDesktop();
    const MEDIA_EXT_RE = /\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov|mkv|avi|webm|m4v|wma|midi?)$/i;
    const detachFileCard = attachFileCardClick(host, (src, name, size) => {
      const base = buildAttachmentPreviewItem(src, name, size);
      const displaySrc = (attachment?.resolveDisplayUrl && base.ref)
        ? (attachment.resolveDisplayUrl(base.ref) ?? base.src)
        : base.src;
      const item = { ...base, src: displaySrc };
      // 媒体附件：内嵌播放 overlay（不跳系统浏览器）
      if (MEDIA_EXT_RE.test(name)) {
        openAttachmentPreview(item, attachment?.onOpenAttachment ?? openAttachmentDefault, isDesktop() ? showInFolder : null);
        return;
      }
      // 非媒体附件：直接系统应用打开
      if (directOpen) {
        (attachment?.onOpenAttachment ?? openAttachmentDefault)(base);
        return;
      }
      openAttachmentPreview(item, attachment?.onOpenAttachment ?? openAttachmentDefault, isDesktop() ? showInFolder : null);
    });

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
      setError(getNativeErrorMessage(reason));
    }
    return () => {
      host.removeEventListener("mousedown", preventCardBlur, true);
      host.removeEventListener("copy", copyRichSelection, true);
      host.removeEventListener("paste", pasteHandler, true);
      detachImagePreview();
      detachFileCard();
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
  // ImageLightbox：图片点击放大预览（桌面/移动端共用）。单例控制器，任何 LakeEditor
  // 实例挂载即提供预览 UI；previewImgs 事件由 envAdapter 转发到控制器。
  return (
    <>
      <div className={`lake-editor lake-${mode}`} ref={hostRef} />
      <ImageLightbox />
      <AttachmentPreview />
    </>
  );
}
