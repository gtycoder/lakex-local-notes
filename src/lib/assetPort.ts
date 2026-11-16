import { assetThumbWidthFor, withAssetWidth } from "../core/assetUrl.js";

/**
 * 本地资源服务器端口（可由主进程 LAKE_ASSET_PORT 覆盖，多端同机双开用）。
 */
export const ASSET_PORT: number =
  (typeof window !== "undefined" && (window as { lakeNative?: { assetPort?: number } }).lakeNative?.assetPort) || 19876;

/**
 * 按 **CSS 显示宽度**选缩略图档位（自动乘 DPR，上限 3×）。
 *
 * 放在 `src/lib` 而不是 `src/core`：它要读 `devicePixelRatio`（DOM 依赖），core 层禁止 DOM。
 * 渲染层统一入口——别在各调用点自己读 `devicePixelRatio`，否则同一台机器上不同面板会选出不同档位。
 * 入参是 CSS px（`getBoundingClientRect().width` 或 CSS 里写死的显示宽度）。
 * 超过档位表上限返回 null = 用原图（此时多半是"面太大、缩了也不划算"）。
 */
export function assetThumbWidthForCss(cssWidth: number): number | null {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  return assetThumbWidthFor(cssWidth * dpr);
}

/** 本地资源服务器 Origin。 */
export const ASSET_ORIGIN = `http://127.0.0.1:${ASSET_PORT}`;

export const LOCAL_ASSET_PREFIX = `${ASSET_ORIGIN}/`;

type RuntimeAssetTokenSource = { getToken?: () => string };

function currentAssetToken(): string {
  if (typeof window === "undefined") return "";
  return (
    (window as { lakeAssetToken?: RuntimeAssetTokenSource }).lakeAssetToken?.getToken?.() ??
    (window as { lakeNative?: { assetToken?: string } }).lakeNative?.assetToken ??
    ""
  );
}

/** 资产服务器访问令牌（每次启动随机）：CORS 拉取 ?base64=1 时需附带。 */
export function assetToken(): string {
  return currentAssetToken();
}

/** Adds the runtime token to a direct local asset URL (quick-note thumbnails, previews). */
export function withAssetAccessToken(url: string): string {
  const token = currentAssetToken();
  if (!token) return url;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== ASSET_ORIGIN) return url;
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch {
    return url;
  }
}

const LOCAL_ASSET_URL_RE = /https?:\/\/127\.0\.0\.1:\d+\/[^\s"'<>)]*/g;

function mapLocalAssetUrls(content: string, map: (url: URL) => string): string {
  return content.replace(LOCAL_ASSET_URL_RE, (raw) => {
    try {
      const url = new URL(raw);
      if (url.origin !== ASSET_ORIGIN) return raw;
      return map(url);
    } catch {
      return raw;
    }
  });
}

/** Adds the per-process token only to the in-memory editor document. */
export function addAssetAccessToken(content: string): string {
  const token = currentAssetToken();
  if (!token) return content;
  return mapLocalAssetUrls(content, (url) => {
    url.searchParams.set("token", token);
    return url.toString();
  });
}

/** 可走资产服务缩略的图片后缀（与 Android AssetServer.isThumbResizable / 桌面 isThumbResizable 对齐；GIF/SVG 不缩）。 */
const LOCAL_IMAGE_THUMB_EXT_RE = /\.(png|jpe?g|webp)$/i;

/**
 * 【task-26】给**本地资产 + 可缩图片**的显示 URL 加离散缩略档位；其余一律原样返回。
 * - 只认 `ASSET_ORIGIN`（桌面/Android 资产服务），`lake-asset://`/外部 URL/data/blob 都不动；
 * - 保留 token/其它 query（由 withAssetWidth 负责），不会冲掉渲染层注入的访问令牌；
 * - 只用于**显示**（内核 onBeforeRenderImage 出口），不写回正文/模型。
 */
export function withLocalImageThumb(src: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return src;
  if (!src.startsWith(LOCAL_ASSET_PREFIX)) return src;
  try {
    const parsed = new URL(src);
    if (!LOCAL_IMAGE_THUMB_EXT_RE.test(parsed.pathname)) return src;
  } catch {
    return src;
  }
  return withAssetWidth(src, width);
}

/** Removes the transient token before a document is saved or cached. */
export function stripAssetAccessToken(content: string): string {
  const token = currentAssetToken();
  if (!token) return content;
  return mapLocalAssetUrls(content, (url) => {
    url.searchParams.delete("token");
    return url.toString();
  });
}
