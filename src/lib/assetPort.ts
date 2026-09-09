/** 本地资源服务器 Origin（端口可由主进程 LAKE_ASSET_PORT 覆盖，多端同机双开用）。 */
export const ASSET_ORIGIN: string = (() => {
  const port = (typeof window !== "undefined" && (window as { lakeNative?: { assetPort?: number } }).lakeNative?.assetPort) || 19876;
  return `http://127.0.0.1:${port}`;
})();

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
