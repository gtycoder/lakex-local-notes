import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { createLakeDocument, destroyLakeEditor, refreshTocSidebar, type LakeEditorInstance, type LakeEditorPrefs } from "./lakeRuntime";
import { normalizeClipboardHtml, upgradePastedHtml } from "./clipboardHtml";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { shouldAcceptEditorChange } from "../../core/editorChangeGuard";
import { ImageLightbox } from "./ImageLightbox";
import { attachImagePreviewClick, extractImagesFromContent } from "./imagePreview";
import { attachFileCardClick, buildAttachmentPreviewItem, createCardHoverResidueCleaner, resolveCardAsset, findCardData, type AttachmentPreviewItem } from "../attachment/attachmentPreviewController";
import { openAssetEntry } from "../attachment/openAssetEntry";
import { CardContextMenu, cutCardElement } from "./CardContextMenu";
import { AssetRenameDialog } from "./AssetRenameDialog";
import { attachLongPress } from "./longPress";
import { installMediaCardCategoryRouter } from "./mediaCardRouting";
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
  const latestDocumentRef = useRef("");
  const onChangeRef = useRef(onChange);
  const onEditorReadyRef = useRef(onEditorReady);
  const [error, setError] = useState<string | null>(null);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; item: AttachmentPreviewItem; el: HTMLElement } | null>(null);
  const [renameItem, setRenameItem] = useState<{ item: AttachmentPreviewItem; el: HTMLElement } | null>(null);
  onChangeRef.current = onChange;
  onEditorReadyRef.current = onEditorReady;

  // 移动端：长按卡片 → 卡片菜单（触屏没有右键；桌面此处由 EditorTab 的右键处理）。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return attachLongPress(host, (x, y, target) => {
      const el = target as HTMLElement;
      const item = resolveCardAsset(el);
      const card = el.closest?.("ne-card") as HTMLElement | null;
      if (item && card) setCardMenu({ x, y, item, el: card });
    });
  }, []);

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
    const cutRichSelection = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!event.clipboardData || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!host.contains(range.commonAncestorContainer)) return;
      event.clipboardData.setData("text/html", normalizeClipboardHtml(range.cloneContents(), document));
      event.clipboardData.setData("text/plain", selection.toString());
      event.preventDefault();
      event.stopImmediatePropagation();
      try { document.execCommand("delete"); } catch { /* 忽略 */ }
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
    host.addEventListener("cut", cutRichSelection, true);
    host.addEventListener("paste", pasteHandler, true);
    // 点击任意位置清理 Lake 卡片 hover 残留（打开系统应用/遮罩时 mouseleave 可能被吞）
    const detachHoverCleaner = createCardHoverResidueCleaner(host);
    // 图片点击放大预览（桌面/移动端共用）：捕获阶段监听 img.ne-image 点击，
    // 收集文档内全部图片（画廊）打开共享 Lightbox。不 preventDefault——
    // Lake 自身的卡片选中/编辑行为照常，预览作为叠加层展示。
    // 注：不依赖 Lake 内置 allowClickToMaximize（该选项在本构建未传导到渲染层，实测无效）。
    // 列表取自**正文**（latestDocumentRef 每次 contentchange 都刷新）：虚拟渲染下 DOM 只有视口内的图，
    // 数不到全部图片就没法左右切换（260928 实测）。
    const detachImagePreview = attachImagePreviewClick(host, () => extractImagesFromContent(latestDocumentRef.current));
    // 附件：file 卡片点击 → 打开（桌面/移动端共用，媒体内嵌播放、非媒体系统打开）。
    // - 媒体附件（音频/视频）：应用内嵌播放 overlay（AudioPreview 内联 <audio>/<video>，不跳系统浏览器）
    // - 非媒体附件（PDF/Office/zip 等）：点击直接系统应用打开（跳过预览弹窗——本地文件无需中间层）
    // - 桌面默认 directOpen（isDesktop）；移动端显式传 attachment.directOpen=true
    const attachment = prefs?.attachment;
    const openAttachmentDefault = (it: AttachmentPreviewItem): void => {
      if (it.ref) void native.openAttachment(it.ref.noteId, it.ref.filename)
        .then((r) => { if (!r.ok) setError(r.error || "打开附件失败"); })
        .catch((reason) => setError(getNativeErrorMessage(reason)));
    };
    const showInFolder = (it: AttachmentPreviewItem): void => {
      if (it.ref) void native.showAttachmentInFolder(it.ref.noteId, it.ref.filename)
        .catch((reason) => setError(getNativeErrorMessage(reason)));
    };
    const directOpen = attachment?.directOpen ?? isDesktop();
    const detachFileCard = attachFileCardClick(host, (src, name, size) => {
      const base = buildAttachmentPreviewItem(src, name, size);
      const displaySrc = (attachment?.resolveDisplayUrl && base.ref)
        ? (attachment.resolveDisplayUrl(base.ref) ?? base.src)
        : base.src;
      // 公共入口：媒体→内嵌预览；非媒体→directOpen ? 系统打开 : 信息预览层
      openAssetEntry(displaySrc, name, size, {
        openSystem: attachment?.onOpenAttachment ?? openAttachmentDefault,
        showInFolder: isDesktop() ? showInFolder : null,
        directOpen,
      });
    });

    let editor: LakeEditorInstance | null = null;
    let detachMediaCardRouter: (() => void) | undefined;
    let disposeTocRefresh: (() => void) | null = null;
    let tocRefreshTimer: number | undefined;
    let setting = true;
    try {
      editor = createLakeDocument(host, mode, () => {
        if (!editor) return;
        const next = stripAssetAccessToken(editor.getDocument("text/lake"));
        if (!shouldAcceptEditorChange({ initializing: setting, previous: latestDocumentRef.current, next })) return;
        latestDocumentRef.current = next;
        onChangeRef.current(next);
      }, tocEnabled, noteId, undefined, prefs);
      latestDocumentRef.current = stripAssetAccessToken(content);
      editor.setDocument("text/lake", addAssetAccessToken(content));
      // 修复：Lake TOC 侧边栏创建时用空 toc 渲染，setDocument 后补一次数据同步。
      // 该补偿有重试定时器，必须跟随实例一起清理。
      tocRefreshTimer = window.setTimeout(() => {
        disposeTocRefresh = refreshTocSidebar(editor);
      }, 0);
      setting = false;
      editorRef.current = editor;
      if (mode === "editor") detachMediaCardRouter = installMediaCardCategoryRouter(editor);
      onEditorReadyRef.current?.(noteId, editor);
      setError(null);
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
    return () => {
      host.removeEventListener("mousedown", preventCardBlur, true);
      host.removeEventListener("copy", copyRichSelection, true);
      host.removeEventListener("cut", cutRichSelection, true);
      host.removeEventListener("paste", pasteHandler, true);
      detachHoverCleaner();
      detachImagePreview();
      detachFileCard();
      window.clearTimeout(tocRefreshTimer);
      disposeTocRefresh?.();
      onEditorReadyRef.current?.(noteId, null);
      detachMediaCardRouter?.();
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
  const attachmentPrefs = prefs?.attachment;
  const openOriginalFromMenu = (it: AttachmentPreviewItem): void => {
    if (attachmentPrefs?.onOpenAttachment) attachmentPrefs.onOpenAttachment(it);
    else if (it.ref) void native.openAttachment(it.ref.noteId, it.ref.filename)
      .then((r) => { if (!r.ok) setError(r.error || "打开附件失败"); })
      .catch((reason) => setError(getNativeErrorMessage(reason)));
  };
  return (
    <>
      <div className={`lake-editor lake-${mode}`} ref={hostRef} />
      <ImageLightbox />
      <AttachmentPreview />
      {cardMenu && (
        <CardContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          item={cardMenu.item}
          actions={{
            openOriginal: openOriginalFromMenu,
            cut: () => { cutCardElement(cardMenu.el); },
            rename: (it) => { setRenameItem({ item: it, el: cardMenu.el }); },
            copyName: (it) => { void navigator.clipboard.writeText(it.name).catch(() => undefined); },
            saveAs: (it) => { if (it.ref) void native.saveAssetAs(it.ref.noteId, it.ref.filename, it.name)
              .catch((reason) => setError(getNativeErrorMessage(reason))); },
          }}
          onClose={() => setCardMenu(null)}
        />
      )}
      {renameItem && (
        <AssetRenameDialog
          initial={renameItem.item.name}
          onCancel={() => setRenameItem(null)}
          onConfirm={(newName) => {
            const picked = renameItem;
            setRenameItem(null);
            const cardData = findCardData(picked.el);
            if (cardData?.setName) { cardData.setName(newName); cardData.sync?.(true); }
          }}
        />
      )}
    </>
  );
}
