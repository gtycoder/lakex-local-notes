/**
 * 本地资产 URL 解析器（lake-core 纯逻辑，V5 轻量协议调研）。
 *
 * 统一识别两种本地资产引用形态：
 *   1. http 形态（现状 canonical）：http://127.0.0.1:{port}/{noteId}/{filename}
 *   2. lake-asset 形态（轻量协议候选）：lake-asset://{noteId}/{filename}
 *
 * 消费者（复制/导出/token 注入/渲染排除）共用本解析器，避免散落的 http 正则
 * 不认识 lake-asset 导致复制丢图、导出漏图的问题。
 */

export interface LocalAssetRef {
  /** 资源所属空间：note 或 quick-notes */
  space: "note" | "quick-notes";
  /** 笔记/小记 ID（URL 中的 noteId；staging 草稿为 draftId） */
  noteId: string;
  /** 文件名 */
  filename: string;
  /** 是否为小记草稿暂存（/quick-notes/staging/{draftId}/{file}） */
  staging?: boolean;
}

const NOTE_ASSET_SCHEME = "lake-asset";

/** 解析 http://127.0.0.1:{port}/{noteId}/{file} 形态（现状），支持 quick-notes 前缀与 staging 草稿段。 */
const HTTP_ASSET_RE = /^https?:\/\/127\.0\.0\.1:\d+\/((?:quick-notes\/staging\/|quick-notes\/)?[^/]+)\/([^/?#\s]+)/;

/** 解析 lake-asset://{noteId}/{file} 形态（轻量协议候选），支持 quick-notes 前缀与 staging 草稿段。 */
const LAKE_ASSET_RE = /^lake-asset:\/\/((?:quick-notes\/staging\/|quick-notes\/)?[^/]+)\/([^/?#\s]+)/;

/**
 * 解析本地资产 URL，返回结构化引用；非本地资源返回 null。
 * 同时识别 http://127.0.0.1:{port}/ 与 lake-asset:// 两种形态。
 */
export function parseLocalAssetUrl(raw: string): LocalAssetRef | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const match = HTTP_ASSET_RE.exec(trimmed) ?? LAKE_ASSET_RE.exec(trimmed);
  if (!match) return null;
  const pathPart = match[1];
  const filename = match[2];
  if (pathPart.startsWith("quick-notes/staging/")) {
    const noteId = pathPart.slice("quick-notes/staging/".length);
    if (!noteId || !filename) return null;
    return { space: "quick-notes", noteId, filename, staging: true };
  }
  if (pathPart.startsWith("quick-notes/")) {
    const noteId = pathPart.slice("quick-notes/".length);
    if (!noteId || !filename) return null;
    return { space: "quick-notes", noteId, filename };
  }
  return { space: "note", noteId: pathPart, filename };
}

/** 判断是否为本地资产 URL（http 或 lake-asset 形态）。 */
export function isLocalAssetUrl(raw: string): boolean {
  return parseLocalAssetUrl(raw) !== null;
}

/**
 * 把 lake-asset 形态转成 http 形态（供复制路径同步拉取 base64 用）。
 * 非 lake-asset 输入原样返回。
 */
export function lakeAssetToHttp(raw: string, port: number): string {
  if (!raw.startsWith(`${NOTE_ASSET_SCHEME}://`)) return raw;
  const ref = parseLocalAssetUrl(raw);
  if (!ref) return raw;
  const prefix = ref.space === "quick-notes" ? "quick-notes/" : "";
  return `http://127.0.0.1:${port}/${prefix}${ref.noteId}/${ref.filename}`;
}

/**
 * 把 http 形态转成 lake-asset 形态（渲染层注入用）。
 * 非 http 本地形态原样返回。
 */
export function httpToLakeAsset(raw: string): string {
  const ref = parseLocalAssetUrl(raw);
  if (!ref) return raw;
  const prefix = ref.space === "quick-notes" ? "quick-notes/" : "";
  return `${NOTE_ASSET_SCHEME}://${prefix}${ref.noteId}/${ref.filename}`;
}
