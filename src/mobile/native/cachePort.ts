/**
 * 移动端 CachePort（Phase 0B-3，§17.4 缓存边界）。
 * 只清理可重建派生数据；绝不清理：native SQLite 主库/正文/未同步修改/.lake/历史快照/待上传资源/仍被引用的本地资源。
 * 分类：runtimeBlob（blob URL 运行时）/ downloadable（已下载资源，仅二次确认）。
 * （IndexedDB 旧资产迁移残留分类已于 2026-08-28 清理——资产全走 Filesystem 文件，无 IndexedDB 资产。）
 */
import type { CachePort, CacheSummary, ClearCacheResult } from "../../core/ports.js";
import { listAssetKeysFs } from "./assetFs.js";

export const mobileCachePort: CachePort = {
  async getCacheSummary(): Promise<CacheSummary> {
    let downloadableAssetBytes = 0;
    try {
      const fsKeys = await listAssetKeysFs();
      downloadableAssetBytes = fsKeys.length;
    } catch { /* Filesystem 不可用时忽略 */ }
    return {
      // 运行时 blob（图片预览）由**创建者自己**在卸载/替换时 revoke（如附件/图片预览组件 的
      // urlsRef），不经过这里登记 ⇒ 恒为 0。保留字段是为了满足 CacheSummary 契约。
      runtimeBlobBytes: 0,
      tempFileBytes: 0,
      downloadableAssetBytes,
      pendingUploadBytes: 0, // 未同步资源不可清理，始终报告 0（不误导）
    };
  },

  async clearDerivedCaches(): Promise<ClearCacheResult> {
    // 无「由本端口持有」的可清理派生物：运行时 blob 由创建者自己 revoke（见 getCacheSummary 注释），
    // 已下载资源属可重建但需二次确认的范畴，本接口不动它们。
    return { cleared: { runtimeBlobBytes: 0, tempFileBytes: 0, downloadableAssetBytes: 0, pendingUploadBytes: 0 } };
  },
};
