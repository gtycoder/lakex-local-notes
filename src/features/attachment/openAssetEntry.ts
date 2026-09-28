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
import { reportNativeActionError } from "../../lib/nativeErrors.js";
import { fileKindOf } from "../../core/fileCard.js";
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
  /** 类型判定用的文件名（默认用 name）：展示名被改成没有扩展名时传**磁盘名**，避免误判成「其他文件」。 */
  kindFrom?: string;
}

function defaultOpenSystem(item: AttachmentPreviewItem): void {
  if (item.ref) void native.openAttachment(item.ref.noteId, item.ref.filename).then((r) => { if (!r.ok) console.warn("[attach] 打开失败:", r.error); }).catch((error) => reportNativeActionError("打开附件", error));
}

function defaultShowInFolder(item: AttachmentPreviewItem): void {
  if (item.ref) void native.showAttachmentInFolder(item.ref.noteId, item.ref.filename).catch((error) => reportNativeActionError("在文件夹中显示附件", error));
}

/** 按类型分流打开一个附件（src 为可直接 <img>/<audio>/<video> 的 URL）。 */
export function openAssetEntry(src: string, name: string, size = 0, actions: OpenAssetActions = {}): void {
  const item = buildAttachmentPreviewItem(src, name, size);
  // 展示名只管标题；类型一律按 kindFrom（磁盘名）判定——音视频/图片不能被改过的名字拖去走系统应用。
  const probeName = actions.kindFrom && actions.kindFrom !== name ? actions.kindFrom : name;
  const kind = probeName === name ? item.kind : fileKindOf(probeName || src);
  const target = kind === item.kind ? item : { ...item, kind };
  const openSystem = actions.openSystem ?? defaultOpenSystem;
  const showInFolder = actions.showInFolder === undefined ? defaultShowInFolder : actions.showInFolder;
  const directOpen = actions.directOpen ?? true;
  if (target.kind === "image") { openImagePreview([{ src, msrc: src }], 0); return; }
  if (target.kind === "audio" || target.kind === "video" || isMediaFilename(probeName)) {
    openAttachmentPreview(target, openSystem, showInFolder);
    return;
  }
  if (directOpen) { openSystem(target); return; }
  openAttachmentPreview(target, openSystem, showInFolder);
}
