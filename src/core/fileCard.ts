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
 * 供桌面"点击卡片 → 打开附件"、移动端"文件卡打开/分享"复用。
 */
import { parseLocalAssetUrl, type LocalAssetRef } from "./assetUrl.js";
import { extOf, fileKindOf as assetFileKindOf, type AssetFileKind } from "./assetNaming.js";

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

export interface ScannedAssetCard {
  /** 卡片名：image / video / audio / file */
  cardName: string;
  /** 本地资产引用；src 非本地形态为 null */
  ref: LocalAssetRef | null;
  /** 展示文件名（优先 ref.filename） */
  filename: string;
  size: number;
  mimeType?: string;
  /** 原始 src（非本地形态时有值） */
  src: string;
}

const ASSET_CARD_RE = /<card\b[^>]*\bname="([^"]+)"[^>]*\bvalue="data:([^"]+)"/g;

/** 扫描正文中的本地资产卡（image/video/audio/file），供文档属性统计 / 复制使用。 */
export function scanAssetCards(content: string): ScannedAssetCard[] {
  const out: ScannedAssetCard[] = [];
  for (const m of content.matchAll(new RegExp(ASSET_CARD_RE.source, "g"))) {
    const cardName = m[1];
    if (cardName !== "image" && cardName !== "video" && cardName !== "audio" && cardName !== "file") continue;
    const value = decodeCardValue(m[2]);
    if (!value) continue;
    const src = typeof value.src === "string" ? value.src : "";
    const ref = src ? parseLocalAssetUrl(src) : null;
    out.push({
      cardName,
      ref,
      filename: ref?.filename ?? (typeof value.name === "string" ? value.name : ""),
      size: typeof value.size === "number" ? value.size : 0,
      mimeType: typeof value.type === "string" ? value.type : undefined,
      src,
    });
  }
  return out;
}

/**
 * 重命名 file 卡的**展示名**（只改 value.name，src 不变）；扩展名锁定为存储文件的扩展名。
 * 返回新正文；没有匹配到目标卡片时原样返回。桌面/移动端共用（渲染层原地更新 + 主进程兜底）。
 */
export function renameFileCardDisplay(content: string, noteId: string, filename: string, newName: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot) : "";
  const displayName = newName.trim().replace(/\.[^./\\]*$/, "") + ext;
  return content.replace(/<card\b[^>]*\bname="file"[^>]*\bvalue="data:([^"]+)"/g, (whole, encoded: string) => {
    const value = decodeCardValue(encoded);
    if (!value || typeof value.src !== "string") return whole;
    const ref = parseLocalAssetUrl(value.src);
    if (!ref || ref.noteId !== noteId || ref.filename !== filename) return whole;
    const nextEncoded = encodeCardValue({ ...value, name: displayName }).replace(/^data:/, "");
    return whole.replace(`value="data:${encoded}"`, `value="data:${nextEncoded}"`);
  });
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

/**
 * 附件**预览分流**类型（打开方式/内联预览决策用）。
 *
 * 这是 [AssetFileKind] 的**投影**，不是第二套扩展名表（CORE-07）：图标分流用
 * `assetNaming.fileKindOf`（11 类），预览分流只需要更少的桶；两者同源才不会出现
 * 「列表里显示代码文件图标、点开却按『其他』处理」。新增扩展名**只改 assetNaming 一张表**。
 */
export type AttachmentKind = "image" | "pdf" | "audio" | "video" | "document" | "archive" | "other";

const PREVIEW_KIND_BY_ASSET_KIND: Record<AssetFileKind, AttachmentKind> = {
  image: "image",
  pdf: "pdf",
  audio: "audio",
  video: "video",
  archive: "archive",
  // 文档类：doc/sheet/slide 都走「信息 + 系统应用打开」；code/text 同样是信息预览，
  // 但图标仍按 11 类细分为代码/文本（图标页不需要再分桶）。
  doc: "document",
  sheet: "document",
  slide: "document",
  code: "document",
  text: "document",
  file: "other",
};

/** 按文件名判定附件预览类型（派生自 assetNaming.fileKindOf；未知扩展名 → other）。 */
export function fileKindOf(filename: string): AttachmentKind {
  return PREVIEW_KIND_BY_ASSET_KIND[assetFileKindOf(filename)];
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
