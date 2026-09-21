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
 * 本地资源服务器 canonical URL 生成（桌面/移动端统一）：
 * - note 资源：http://127.0.0.1:{port}/{noteId}/{filename}
 * - quick-notes 资源：http://127.0.0.1:{port}/quick-notes/{noteId}/{filename}
 * port 由调用方决定（桌面 ASSET_PORT 可被 LAKE_ASSET_PORT 覆盖；移动端固定 19876）。
 * 桌面 quickNotes.ts / 移动端 bridge.uploadResource / HomePage 缩略图 / Composer 预览统一走此函数，
 * 保证两端 URL 形态一致（解析侧 parseLocalAssetUrl 同样识别）。
 */
export function localAssetHttpUrl(
  noteId: string,
  filename: string,
  opts: { port?: number; space?: "note" | "quick-notes" } = {},
): string {
  const port = opts.port ?? 19876;
  const prefix = (opts.space ?? "note") === "quick-notes" ? "quick-notes/" : "";
  return `http://127.0.0.1:${port}/${prefix}${noteId}/${filename}`;
}

/**
 * 把 lake-asset 形态转成 http 形态（供复制路径同步拉取 base64 用）。
 * 非 lake-asset 输入原样返回。
 */
export function lakeAssetToHttp(raw: string, port: number): string {
  if (!raw.startsWith(`${NOTE_ASSET_SCHEME}://`)) return raw;
  const ref = parseLocalAssetUrl(raw);
  if (!ref) return raw;
  return localAssetHttpUrl(ref.noteId, ref.filename, { port, space: ref.space });
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

/**
 * 缩略图档位（宽，px）。**离散**是关键：档位固定 ⇒ 同一张图在任何显示宽度下只产生有限的几个 URL，
 * 浏览器的 immutable 缓存与服务端内存缓存都不会被连续值打散（否则「按需缩放」等于没有缓存）。
 * 服务端只认这几个值，其余一律当没传（见 electron/assetServer.ts）。
 */
export const ASSET_THUMB_WIDTHS = [128, 256, 512, 1024] as const;

/**
 * 按目标显示宽度选档位：取**不小于**目标的最接近档位（宁可略大、绝不小到发虚）。
 * 入参单位是**设备像素**（调用方自行乘 DPR）。超过最大档位返回 null = 直接用原图
 * （不为一张几乎等于原图的图白编一次码）。
 */
export function assetThumbWidthFor(targetPx: number): number | null {
  if (!Number.isFinite(targetPx) || targetPx <= 0) return null;
  for (const width of ASSET_THUMB_WIDTHS) {
    if (targetPx <= width) return width;
  }
  return null;
}

/**
 * 给本地资产 URL 加/去 `?w=`（缩略图档位）；`width = null` 表示去掉档位。
 * 非本地资产（data:/外部 http/lake-asset 之外的形态）原样返回——外部图我们无权也无需缩放。
 * 其余 query（如渲染层注入的 token）**保留**，不能被这里冲掉。
 *
 * 落盘安全：`sheetImageDiskSrc` / `parseLocalAssetUrl` 只取路径段、忽略 query，
 * 所以带档位的 URL 存盘时照样换回 filename，正文里永远不会出现 `?w=`。
 */
export function withAssetWidth(raw: string, width: number | null): string {
  if (!parseLocalAssetUrl(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (width == null) parsed.searchParams.delete("w");
    else parsed.searchParams.set("w", String(width));
    return parsed.toString();
  } catch {
    return raw;
  }
}
