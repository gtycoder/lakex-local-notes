/**
 * 移动端 CachePort（Phase 0B-3，§17.4 缓存边界）—— 261105 起**真的会清**。
 *
 * 旧实现 `clearDerivedCaches()` 恒返回「清 0 项」= no-op（容错审计 Top10 #3：坏库/启动失败页的
 * 「清理缓存后重试」实际什么都不做）。现在清两块**可再生**数据，其余一律不动：
 *  ① 派生搜索缓存（FTS + 搜索账本，见 data/derivedSearchCache.ts）—— 清完在后台重建索引；
 *  ② PDF 渲染临时缓存目录（native/pdfRender.ts 的 cleanupPdfRenderCache）。
 *
 * 永远不清：SQLite 主库/正文/未同步修改/.lake/历史快照/回收站/待上传资源/仍被引用的本地资源。
 * 运行时 blob 由创建者自己 revoke（见 getCacheSummary 注释），不在这里登记。
 */
import type { CachePort, CacheSummary, ClearCacheResult } from "../../core/ports.js";
import { ensureDb } from "../bridge/context";
import { clearSearchDerivedCache } from "../data/derivedSearchCache";
import { reconcileIndex } from "../data/searchIndex";
import { cleanupPdfRenderCache } from "./pdfRender";
import { listAssetKeysFs } from "./assetFs";

/** 清缓存后的后台重建去重：连点不叠两份 reconcile（两份并发会互抢 fts_rowid）。 */
let searchRebuildInFlight = false;

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
    // ① 派生搜索缓存：清空 + 后台全量重建（清空后不重建 = 搜索暂时无结果）。
    //    DB 打不开（坏库）时这里会抛 —— 坏库页另有「从云端恢复（换机/坏库）」出口，UI 如实显示原因。
    const d = await ensureDb();
    const clearedIndex = await clearSearchDerivedCache(d);
    // 后台重建（不阻塞点击）。连点「清理缓存」不叠加重建：同一时刻只跑一份（跑完自动复位）。
    if (!searchRebuildInFlight) {
      searchRebuildInFlight = true;
      void reconcileIndex(d)
        .catch((error) => console.warn("[cache] 搜索索引后台重建失败（下次启动/同步会继续补）", error))
        .finally(() => { searchRebuildInFlight = false; });
    }
    // ② PDF 渲染临时缓存：失败不影响主流程（纯临时文件）。
    await cleanupPdfRenderCache().catch((error) => {
      console.warn("[cache] PDF 渲染缓存清理失败（下次启动会再清）", error);
    });
    // 返回「真正清掉的可再生数据量」：账本+FTS 行数记在 tempFileBytes（UI 只用于展示，不参与任何判据）。
    return { cleared: { runtimeBlobBytes: 0, tempFileBytes: clearedIndex.notes + clearedIndex.quickNotes, downloadableAssetBytes: 0, pendingUploadBytes: 0 } };
  },
};
