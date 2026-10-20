/**
 * 附件「文档类型」的**大尺寸**图标（261020 用户点单）：类型色纸页 + 扩展名文字。
 *
 * 为什么按尺寸分两种画法：18px 里字高只有约 6px，3–4 个字母必然糊成一团（实测三套公开图标集
 * 都做不到，见 HANDOFF）；28px 起字高足够，直接把 `.DOCX` / `.PDF` 印在纸页上比抽象图形更直观。
 * 判定单一来源仍是 core 的 `fileKindOf`；颜色继续走 `--lake-file-*` 令牌（页身用 currentColor 继承），
 * 文字色用 `--lake-text-on-accent`（见 bitableFileIcon.css），**图标内部不写颜色字面量**。
 */
import { fileKindOf, type AssetFileKind } from "../../core/assetNaming.js";
import "./bitableFileIcon.css";

/** 只有 ≥ 这个尺寸才画纸页 + 扩展名；更小的走 FileKindIcon 的线性图标。 */
export const FILE_BADGE_MIN_SIZE = 28;

/** 没有可用扩展名时，按类型回落一个 2–4 字母标签（避免大图标里出现空纸页）。 */
const KIND_LABEL: Record<AssetFileKind, string> = {
  image: "IMG",
  pdf: "PDF",
  doc: "DOC",
  sheet: "XLS",
  slide: "PPT",
  archive: "ZIP",
  audio: "AUD",
  video: "VID",
  code: "CODE",
  text: "TXT",
  file: "FILE",
};

/** 扩展名 → 印在纸页上的标签（≤4 字符，纯字母数字；否则回落类型标签）。 */
export function badgeLabelOf(name: string): string {
  const kind = fileKindOf(name);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
  if (ext && ext.length <= 4 && /^[A-Z0-9]+$/.test(ext)) return ext;
  return KIND_LABEL[kind];
}

/** 字宽越窄字越大：4 字符要压进 36 单位宽的纸页里。 */
function labelFontSize(label: string): number {
  if (label.length >= 4) return 9.5;
  if (label.length === 3) return 10.8;
  if (label.length === 2) return 13;
  return 16;
}

export function FileBadgeIcon({ name, size, className = "" }: { name: string; size: number; className?: string }) {
  const label = badgeLabelOf(name);
  const fontSize = labelFontSize(label);
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={"bt-file-badge" + (className ? " " + className : "")}
      aria-hidden="true"
      focusable="false"
    >
      {/* 纸页：右上角折角，页身用 currentColor（由 .bt-file-icon--<kind> 的 color 令牌决定） */}
      <path
        className="bt-file-badge__page"
        d="M10.5 3h21.5L42 13v27.5A4.5 4.5 0 0 1 37.5 45h-27A4.5 4.5 0 0 1 6 40.5v-33A4.5 4.5 0 0 1 10.5 3Z"
      />
      <path className="bt-file-badge__fold" d="M32 3v10h10Z" />
      <text
        className="bt-file-badge__label"
        x="24"
        y="31"
        fontSize={fontSize}
        textAnchor="middle"
        letterSpacing={label.length >= 4 ? -0.4 : -0.2}
      >{label}</text>
    </svg>
  );
}
