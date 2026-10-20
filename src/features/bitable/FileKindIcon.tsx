/**
 * 附件「文档类型」图标（用户 260930：附件不再展示名称/缩略图，直接展示类型）。
 *
 * 为什么不用云端的图标：语雀那套彩色「页」图标**不在内核 bundle 里**（实测内核 sprite 325 个 symbol
 * 无一个 file/pdf/doc 系；`ne-card[data-card-name='file']` 只用一个通用 `note-file`，而它连 symbol 都缺、
 * 由我们 `ensureNoteFileIcon()` 自补）⇒ 只能用**我们自己的图标库**（lucide-react，全站同一套线性图标）
 * 按类型分色。类型判定走 core 的单一事实源 `fileKindOf`。
 */
import {
  File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileType, FileVideo, Presentation,
  type LucideIcon,
} from "lucide-react";
import { fileKindOf, type AssetFileKind } from "../../core/assetNaming.js";
import { FILE_BADGE_MIN_SIZE, FileBadgeIcon } from "./FileBadgeIcon.js";
import "./bitableFileIcon.css";

/** 类型 → 图标。`text` 与 `pdf` 同用文件页图标（靠颜色区分：灰 vs 红），其余各用专属字形。 */
const KIND_ICON: Record<AssetFileKind, LucideIcon> = {
  image: FileImage,
  pdf: FileText,
  doc: FileType,
  sheet: FileSpreadsheet,
  slide: Presentation,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  code: FileCode,
  text: FileText,
  file: File,
};

/** 颜色按类型走 `--lake-file-*` 令牌（定义在 `styles/themes/*`）；`aria-hidden` 由外层带名称的控件负责。
 *
 * 261020 起按**尺寸**分两种画法（用户点单「大尺寸能看出扩展名」）：
 * · ≥ 28px（多维表附件卡片 46px / 预览台）⇒ 类型色纸页 + 扩展名文字（FileBadgeIcon）；
 * · < 28px（表格芯片 18px 等）⇒ 仍是线性图标：这个尺寸里印字必然糊，形状+类型色才可辨。
 */
export function FileKindIcon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  const kind = fileKindOf(name);
  const cls = "bt-file-icon bt-file-icon--" + kind + (className ? " " + className : "");
  if (size >= FILE_BADGE_MIN_SIZE) return <FileBadgeIcon name={name} size={size} className={cls} />;
  const Icon = KIND_ICON[kind];
  return <Icon size={size} className={cls} aria-hidden="true" />;
}
