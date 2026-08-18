/** 本地资源服务器 Origin（端口可由主进程 LAKE_ASSET_PORT 覆盖，多端同机双开用）。 */
export const ASSET_ORIGIN: string = (() => {
  const port = (typeof window !== "undefined" && (window as { lakeNative?: { assetPort?: number } }).lakeNative?.assetPort) || 19876;
  return `http://127.0.0.1:${port}`;
})();

export const LOCAL_ASSET_PREFIX = `${ASSET_ORIGIN}/`;

/** 资产服务器访问令牌（preload 注入，每次启动随机）：CORS 拉取 ?base64=1 时需附带。 */
export const ASSET_TOKEN: string =
  (typeof window !== "undefined" && (window as { lakeNative?: { assetToken?: string } }).lakeNative?.assetToken) || "";


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
  if (!ASSET_TOKEN) return content;
  return mapLocalAssetUrls(content, (url) => {
    url.searchParams.set("token", ASSET_TOKEN);
    return url.toString();
  });
}

/** Removes the transient token before a document is saved or cached. */
export function stripAssetAccessToken(content: string): string {
  if (!ASSET_TOKEN) return content;
  return mapLocalAssetUrls(content, (url) => {
    url.searchParams.delete("token");
    return url.toString();
  });
}
