import { assetThumbWidthFor } from "../core/assetUrl.js";

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

/** Removes the transient token before a document is saved or cached. */
export function stripAssetAccessToken(content: string): string {
  const token = currentAssetToken();
  if (!token) return content;
  return mapLocalAssetUrls(content, (url) => {
    url.searchParams.delete("token");
    return url.toString();
  });
}
