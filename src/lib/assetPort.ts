/** 本地资源服务器 Origin（端口可由主进程 LAKE_ASSET_PORT 覆盖，多端同机双开用）。 */
export const ASSET_ORIGIN: string = (() => {
  const port = (typeof window !== "undefined" && (window as { lakeNative?: { assetPort?: number } }).lakeNative?.assetPort) || 19876;
  return `http://127.0.0.1:${port}`;
})();

export const LOCAL_ASSET_PREFIX = `${ASSET_ORIGIN}/`;
