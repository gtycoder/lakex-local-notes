import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { createLakeDocument, destroyLakeEditor, refreshTocSidebar, retryFailedDocumentImageUploads, resumePendingDocumentImageUploads, type LakeEditorInstance, type LakeEditorPrefs } from "./lakeRuntime";
import { hasUnresolvedImageTask, repairUploadCards } from "./uploadCardRepair";
import { subscribeUploadJournal } from "./uploadJournal";
import { uploadRetryDelayForEntry } from "./uploadRetryScheduler";
import { upgradePastedHtml } from "./clipboardHtml";
import { attachSelectionClipboard } from "./selectionClipboard";
import { addAssetAccessToken, stripAssetAccessToken } from "../../lib/assetPort";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { shouldAcceptEditorChange } from "../../core/editorChangeGuard";
import { attachImagePreviewClick, extractImagesFromContent } from "./imagePreview";
import { attachFileCardClick, buildAttachmentPreviewItem, createCardHoverResidueCleaner, resolveCardAsset, findCardData, type AttachmentPreviewItem } from "../attachment/attachmentPreviewController";
import { openAssetEntry } from "../attachment/openAssetEntry";
import { CardContextMenu, cutCardElement } from "./CardContextMenu";
import { AssetRenameDialog } from "./AssetRenameDialog";
import { attachLongPress } from "./longPress";
import { installMediaCardCategoryRouter } from "./mediaCardRouting";
import { isDesktop, native } from "../../lib/native";
// 书签卡浮动工具条：vendor 包装层实现，内核本版无原生卡工具条；宿主不挂载就是无菜单死卡。
import { BookmarkToolbar } from "@dlient/lakex-doc-react";
import { useKernelDarkTheme } from "./useKernelDarkTheme";

/** 预览宿主固定阅读档字号（Q05B）：移动回收站/历史/桌面 NoteDocPreview 同语义同值。
 *  权威比较由 src/features/editor/lakeEditorInteraction.test.ts 钉住（两边都是字面量，测试防漂移）。 */
export const LAKE_PREVIEW_FONT_SIZE = 16;

/** 宿主交互档（Q07A）：
 *  - "editor"（默认，= 现状）：卡片长按菜单 + copy/cut 接管 + 图片预览 + file 卡打开；
 *  - "preview"：只读预览宿主 —— 跳过卡片长按菜单（重命名/剪切/另存）与 copy/cut 接管，
 *    保留 tap 图片预览与 file 卡打开（移动回收站/历史快照用）。 */
export type LakeEditorInteraction = "editor" | "preview";

interface LakeEditorProps {
  noteId: string;
  content: string;
  mode?: "viewer" | "editor";
  /** 交互档；缺省 "editor"（默认值回退，见 Q07A）。 */
  interaction?: LakeEditorInteraction;
  tocEnabled: boolean;
  onChange: (content: string) => void;
  prefs?: LakeEditorPrefs;
  /** 真实滚动容器（虚拟渲染/大纲定位用）。可传 getter：宿主 ref 首帧才有值。缺省走 lakeRuntime 回退。 */
  scrollNode?: HTMLElement | (() => HTMLElement | null) | null;
  /** 宿主元素的额外类名：两端各自的外观由**各端自己的样式**定义（移动端传自有前缀，见 MOBILE-TECH-STACK §一）。 */
  hostClassName?: string;
  /**
   * 可恢复图片上传（261114 二批，移动端文档编辑器开启）：
   * 挂载时按 uploadJournal 回填失败/待上传图卡、重下 pending/可重试失败项，并订阅晚到结果重建一次。
   * 桌面文档编辑器走 EditorTab 的同款三件套，不传本开关。
   */
  journalRecovery?: boolean;
  onEditorReady?: (noteId: string, editor: LakeEditorInstance | null) => void;
}

export function LakeEditor({ noteId, content, mode = "editor", interaction = "editor", tocEnabled, onChange, prefs, scrollNode, onEditorReady, hostClassName, journalRecovery = false }: LakeEditorProps) {
  const previewOnly = interaction === "preview";
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const latestDocumentRef = useRef("");
  const onChangeRef = useRef(onChange);
  const onEditorReadyRef = useRef(onEditorReady);
  const [error, setError] = useState<string | null>(null);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; item: AttachmentPreviewItem; el: HTMLElement } | null>(null);
  const [renameItem, setRenameItem] = useState<{ item: AttachmentPreviewItem; el: HTMLElement } | null>(null);
  /** journalRecovery 下「晚到/补拉结果需要重建一次」的 tick（与 EditorTab 同判据）。 */
  const [recoveryTick, setRecoveryTick] = useState(0);
  // 书签卡工具条需要编辑器实例（ref 变化不触发渲染，所以额外存一份 state）。
  const [editorInstance, setEditorInstance] = useState<LakeEditorInstance | null>(null);
  const kernelDark = useKernelDarkTheme();
  const retryTimersRef = useRef<Set<number>>(new Set());
  onChangeRef.current = onChange;
  onEditorReadyRef.current = onEditorReady;

  // 移动端：长按卡片 → 卡片菜单（触屏没有右键；桌面此处由 EditorTab 的右键处理）。
  // preview 档（Q07A）：只读宿主不提供菜单（重命名/剪切/另存都是写操作）。
  /**
   * 可恢复图片上传（261114 二批，移动端文档编辑器 journalRecovery=true）：
   * 晚到的下载结果 → 正文仍存在同一 taskId 的未解决图卡时重建一次；失败项按退避后台补拉。
   * 判据与桌面 EditorTab 完全同源，避免两端对「什么时候自愈」有两套口径。
   */
  useEffect(() => {
    if (!journalRecovery || mode !== "editor") return;
    const timers = retryTimersRef.current;
    const off = subscribeUploadJournal((entry) => {
      if (entry.noteId !== noteId) return;
      if (entry.status === "error") {
        const delay = uploadRetryDelayForEntry(entry);
        if (delay != null) {
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            retryFailedDocumentImageUploads(noteId);
          }, delay);
          timers.add(timer);
        }
      }
      if (entry.status === "pending") return;
      if (!hasUnresolvedImageTask(latestDocumentRef.current, entry.taskId)) return;
      setRecoveryTick((tick) => tick + 1);
    });
    return () => {
      off();
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, [journalRecovery, mode, noteId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || previewOnly) return;
    return attachLongPress(host, (x, y, target) => {
      const el = target as HTMLElement;
      const item = resolveCardAsset(el);
      const card = el.closest?.("ne-card") as HTMLElement | null;
      if (item && card) setCardMenu({ x, y, item, el: card });
    });
  }, [previewOnly]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // 复制/剪切 = 应用侧统一管线（图片来源见 selectionClipboard.ts 文件头；单一来源，别在这里再写一份）。
    // preview 档（Q07A）：只读预览不接管 copy/cut（内核原生只读选区行为保留）。
    const detachSelectionClipboard = previewOnly ? () => undefined : attachSelectionClipboard(host);
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
    host.addEventListener("paste", pasteHandler, true);
    // 点击任意位置清理 Lake 卡片 hover 残留（打开系统应用/遮罩时 mouseleave 可能被吞）
    const detachHoverCleaner = createCardHoverResidueCleaner(host);
    // 图片点击放大预览（桌面/移动端共用）：捕获阶段监听 img.ne-image 点击，
    // 收集文档内全部图片（画廊）打开共享 Lightbox。不 preventDefault——
    // Lake 自身的卡片选中/编辑行为照常，预览作为叠加层展示。
    // 注：不依赖 Lake 内置 allowClickToMaximize（该选项在本构建未传导到渲染层，实测无效）。
    // 列表取自**正文**（latestDocumentRef 每次 contentchange 都刷新）：虚拟渲染下 DOM 只有视口内的图，
    // 数不到全部图片就没法左右切换（260928 实测）。
    // 触发方式（261112 用户定稿：**点击看图片、双击编辑**）：
    // - 桌面：双击预览（单击留给内核选中图片/拖角改尺寸 —— 用户此前确认过的桌面口径）；
    // - 移动端：单击预览、双击 = 编辑（交给内核；双击判定窗在 imagePreview 里统一实现）。
    const tapToPreview = !isDesktop();
    const detachImagePreview = attachImagePreviewClick(
      host,
      () => extractImagesFromContent(latestDocumentRef.current),
      { tap: tapToPreview },
    );
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
      }, tocEnabled, noteId, scrollNode ?? undefined, prefs);
      // 可恢复图片上传：挂载时先按 journal 回填「空 src 的未完成图卡」，再交给内核渲染。
      let nextDocument = content;
      let repairedChanged = false;
      if (journalRecovery && mode === "editor") {
        const repaired = repairUploadCards(stripAssetAccessToken(content), noteId);
        if (repaired.changed) {
          nextDocument = repaired.content;
          repairedChanged = true;
        }
      }
      latestDocumentRef.current = stripAssetAccessToken(nextDocument);
      editor.setDocument("text/lake", addAssetAccessToken(nextDocument));
      if (journalRecovery && mode === "editor") resumePendingDocumentImageUploads(noteId);
      // 修复：Lake TOC 侧边栏创建时用空 toc 渲染，setDocument 后补一次数据同步。
      // 该补偿有重试定时器，必须跟随实例一起清理。
      tocRefreshTimer = window.setTimeout(() => {
        disposeTocRefresh = refreshTocSidebar(editor);
      }, 0);
      setting = false;
      // 回填了失联图片：标脏一次，让正常保存管线把修好的正文落盘（与 EditorTab 同口径）。
      if (repairedChanged) onChangeRef.current(stripAssetAccessToken(nextDocument));
      editorRef.current = editor;
      setEditorInstance(editor);
      if (mode === "editor") detachMediaCardRouter = installMediaCardCategoryRouter(editor);
      onEditorReadyRef.current?.(noteId, editor);
      setError(null);
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
    return () => {
      host.removeEventListener("mousedown", preventCardBlur, true);
      detachSelectionClipboard();
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
      setEditorInstance(null);
      host.replaceChildren();
    };
  }, [noteId, mode, previewOnly, tocEnabled, prefs?.fontSize, prefs?.showToolbar, journalRecovery, recoveryTick]);

  if (error) {
    return <div className="editor-error"><AlertCircle size={18} /><span>{error}</span></div>;
  }
  // 预览事件由 envAdapter 转发到共享控制器，UI 只由应用根挂载。
  const attachmentPrefs = prefs?.attachment;
  const openOriginalFromMenu = (it: AttachmentPreviewItem): void => {
    if (attachmentPrefs?.onOpenAttachment) attachmentPrefs.onOpenAttachment(it);
    else if (it.ref) void native.openAttachment(it.ref.noteId, it.ref.filename)
      .then((r) => { if (!r.ok) setError(r.error || "打开附件失败"); })
      .catch((reason) => setError(getNativeErrorMessage(reason)));
  };
  return (
    <>
      <div className={"lake-editor lake-" + mode + (hostClassName ? " " + hostClassName : "")} ref={hostRef} />
      {editorInstance && (
        <BookmarkToolbar containerRef={hostRef} editor={editorInstance} language="zh-cn" dark={kernelDark} />
      )}
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