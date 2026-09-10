/**
 * 移动端 CachePort（Phase 0B-3，§17.4 缓存边界）。
 * 只清理可重建派生数据；绝不清理：native SQLite 主库/正文/未同步修改/.lake/历史快照/待上传资源/仍被引用的本地资源。
 * 分类：runtimeBlob（blob URL 运行时）/ downloadable（已下载资源，仅二次确认）。
 * （IndexedDB 旧资产迁移残留分类已于 2026-08-28 清理——资产全走 Filesystem 文件，无 IndexedDB 资产。）
 */
import type { CachePort, CacheSummary, ClearCacheResult } from "../core/ports.js";
import { listAssetKeysFs } from "./assetFs.js";

/** 内存 blob 注册表：运行时 blob URL（供统计与"清缓存"revoke 清理）。 */
const runtimeBlobRegistry = new Set<string>();

/** 登记一个运行时 blob URL。 */
export function registerRuntimeBlob(url: string): void {
  runtimeBlobRegistry.add(url);
}

/** 注销一个运行时 blob URL（revoke 后调用）。 */
export function unregisterRuntimeBlob(url: string): void {
  runtimeBlobRegistry.delete(url);
}

/** blob 字节数无法直接统计（URL 不携带长度）；返回条目数作为近似指标。 */
function runtimeBlobCount(): number {
  return runtimeBlobRegistry.size;
}

export const mobileCachePort: CachePort = {
  async getCacheSummary(): Promise<CacheSummary> {
    let downloadableAssetBytes = 0;
    try {
      const fsKeys = await listAssetKeysFs();
      downloadableAssetBytes = fsKeys.length;
    } catch { /* Filesystem 不可用时忽略 */ }
    return {
      runtimeBlobBytes: runtimeBlobCount(),
      tempFileBytes: 0,
      downloadableAssetBytes,
      pendingUploadBytes: 0, // 未同步资源不可清理，始终报告 0（不误导）
    };
  },

  async clearDerivedCaches(): Promise<ClearCacheResult> {
    // 1) 清理运行时 blob URL（可重建：下次渲染重新注入）
    let runtimeBlobBytes = 0;
    for (const url of runtimeBlobRegistry) {
      try { URL.revokeObjectURL(url); runtimeBlobBytes += 1; } catch { /* 忽略 */ }
    }
    runtimeBlobRegistry.clear();
    return { cleared: { runtimeBlobBytes, tempFileBytes: 0, downloadableAssetBytes: 0, pendingUploadBytes: 0 } };
  },
};
