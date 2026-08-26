/**
 * Lake file 卡片 value 解析/构建（附件功能共享层，桌面/移动端共用）。
 *
 * Lake 文档里附件表示为：
 *   <card type="block|inline" name="file" value="data:{uri-encoded-json}"></card>
 * value JSON 键（对齐 lakex file-card-data DefaultCardValue）：
 *   src/name/size/ext/type(mime)/status(pending|done|error|uploading|transfering)/
 *   mode(card|embed|title|inline)/download/taskId/taskType/source/id
 *
 * 解析后经 parseLocalAssetUrl 还原出本地资产引用（canonical URL → noteId + filename），
 * 供桌面"点击卡片 → 打开附件"、移动端"文件卡 blob 注入/分享"复用。
 */
import { parseLocalAssetUrl, type LocalAssetRef } from "./assetUrl.js";
import { extOf } from "./assetNaming.js";

export type FileCardStatus = "pending" | "done" | "error" | "uploading" | "transfering";
export type FileCardMode = "card" | "embed" | "title" | "inline";

export interface FileCardValue {
  /** 文件地址：本地资产 canonical URL 或 data:/远程 URL */
  src: string;
  /** 文件名（展示用，可含原始大小写/空格） */
  name: string;
  /** 字节大小 */
  size: number;
  /** 扩展名（小写） */
  ext: string;
  /** MIME */
  type?: string;
  status?: FileCardStatus;
  mode?: FileCardMode;
  download?: boolean;
  taskId?: string;
  taskType?: string;
  source?: string;
  /** 卡片节点 id（与 DOM ne-card id 对应） */
  id?: string;
  [key: string]: unknown;
}

export interface ScannedFileCard {
  /** 完整 <card ...> 元素文本（如需替换） */
  raw: string;
  /** value.id（匹配 DOM ne-card id） */
  cardId: string;
  value: FileCardValue;
  /** 本地资产引用；src 非本地形态为 null */
  ref: LocalAssetRef | null;
}

/** card 元素 value="data:{uri-encoded-json}"（name="file"，block/inline 均可） */
const FILE_CARD_RE = /<card\b[^>]*\bname="file"[^>]*\bvalue="data:([^"]+)"[^>]*>/g;

/** 解码 card value（URI 编码 JSON，容忍 data: 前缀）。失败返回 null。 */
export function decodeCardValue(encoded: string): Record<string, unknown> | null {
  try {
    const json = decodeURIComponent(encoded).replace(/^data:/, "");
    const obj = JSON.parse(json) as unknown;
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 编码 card value（对齐 Lake 序列化：data:{encodeURIComponent(json)}）。 */
export function encodeCardValue(value: Record<string, unknown>): string {
  return "data:" + encodeURIComponent(JSON.stringify(value));
}

/** 解析单个 file 卡片 value；无 src 视为无效返回 null。 */
export function parseFileCardValue(encoded: string): FileCardValue | null {
  const obj = decodeCardValue(encoded);
  if (!obj || typeof obj.src !== "string") return null;
  return obj as FileCardValue;
}

/** 扫描正文中所有 file 卡片，返回解析结果 + 本地资产引用。 */
export function scanFileCards(content: string): ScannedFileCard[] {
  const out: ScannedFileCard[] = [];
  for (const m of content.matchAll(FILE_CARD_RE)) {
    const raw = m[0];
    const encoded = m[1];
    const value = parseFileCardValue(encoded);
    if (!value) continue;
    out.push({
      raw,
      cardId: typeof value.id === "string" ? value.id : "",
      value,
      ref: parseLocalAssetUrl(value.src),
    });
  }
  return out;
}

/** 构建一个"已完成"的 file 卡片 value（本地资产形态；插入/测试/移动端注入用）。 */
export function buildDoneFileCardValue(input: { src: string; name: string; size: number; type?: string; id?: string }): FileCardValue {
  return {
    src: input.src,
    name: input.name,
    size: input.size,
    ext: extOf(input.name).toLowerCase(),
    type: input.type,
    status: "done",
    mode: "card",
    download: true,
    source: "upload",
    ...(input.id ? { id: input.id } : {}),
  };
}

/** 附件类型分流（图标/内联预览决策用）。 */
export type AttachmentKind = "image" | "pdf" | "audio" | "video" | "document" | "archive" | "other";

const KIND_BY_EXT: Record<string, AttachmentKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image",
  bmp: "image", svg: "image", ico: "image", tiff: "image", tif: "image",
  pdf: "pdf",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", flac: "audio", ogg: "audio", wma: "audio",
  mp4: "video", mov: "video", mkv: "video", avi: "video", webm: "video", m4v: "video", wmv: "video", flv: "video",
  doc: "document", docx: "document", xls: "document", xlsx: "document", ppt: "document", pptx: "document",
  txt: "document", md: "document", csv: "document", rtf: "document", key: "document", pages: "document",
  numbers: "document", epub: "document",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", bz2: "archive", xz: "archive",
};

/** 按文件名判定附件类型（默认 other）。 */
export function fileKindOf(filename: string): AttachmentKind {
  const ext = extOf(filename).toLowerCase();
  return KIND_BY_EXT[ext] ?? "other";
}

/** 人类可读文件大小（B/KB/MB/GB，一位小数）。 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let v = bytes;
  for (const u of units) {
    v /= 1024;
    if (v < 1024 || u === "GB") {
      const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      return rounded + " " + u;
    }
  }
  return bytes + " B";
}
