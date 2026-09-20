/**
 * 统一「打开附件」入口（桌面/移动、文档/多维表/小记/未来任意界面共用一套）。
 *
 * 分流（与文档侧既有行为一致）：
 * - 图片        → 应用内 Lightbox（openImagePreview）
 * - 音频 / 视频 → 应用内附件预览，内嵌 <audio>/<video>（openAttachmentPreview）
 * - 其它（pdf/office/zip…）→ 平台动作（默认 native.openAttachment = 系统默认应用）；
 *   传 directOpen:false 时改为打开附件信息预览层（LakeEditor 旧行为）。
 *
 * 边界：本函数只做「类型分流 + 触发共享单例」，**不含** Lake 编辑器 DOM/fiber 的卡片解析
 * （resolveCardAsset / attachFileCardClick）——那是内核渲染层专属，调用方负责先拿到 src/name/size。
 */
import { isMediaFilename } from "../../core/assetNaming.js";
import { native } from "../../lib/native.js";
import { openImagePreview } from "../editor/imagePreview.js";
import { buildAttachmentPreviewItem, openAttachmentPreview, type AttachmentPreviewItem } from "./attachmentPreviewController.js";

export interface OpenAssetActions {
  /** 平台动作：用系统默认应用打开（默认走 native.openAttachment）。 */
  openSystem?: (item: AttachmentPreviewItem) => void;
  /** 平台动作：在文件管理器中显示；传 null 表示该平台无此动作。 */
  showInFolder?: ((item: AttachmentPreviewItem) => void) | null;
  /** 非媒体附件是否直接系统打开（默认 true）。false 时打开附件信息预览层。 */
  directOpen?: boolean;
}

function defaultOpenSystem(item: AttachmentPreviewItem): void {
  if (item.ref) void native.openAttachment(item.ref.noteId, item.ref.filename).then((r) => { if (!r.ok) console.warn("[attach] 打开失败:", r.error); });
}

function defaultShowInFolder(item: AttachmentPreviewItem): void {
  if (item.ref) void native.showAttachmentInFolder(item.ref.noteId, item.ref.filename);
}

/** 按类型分流打开一个附件（src 为可直接 <img>/<audio>/<video> 的 URL）。 */
export function openAssetEntry(src: string, name: string, size = 0, actions: OpenAssetActions = {}): void {
  const item = buildAttachmentPreviewItem(src, name, size);
  const openSystem = actions.openSystem ?? defaultOpenSystem;
  const showInFolder = actions.showInFolder === undefined ? defaultShowInFolder : actions.showInFolder;
  const directOpen = actions.directOpen ?? true;
  if (item.kind === "image") { openImagePreview([{ src, msrc: src }], 0); return; }
  if (item.kind === "audio" || item.kind === "video" || isMediaFilename(name)) {
    openAttachmentPreview(item, openSystem, showInFolder);
    return;
  }
  if (directOpen) { openSystem(item); return; }
  openAttachmentPreview(item, openSystem, showInFolder);
}
