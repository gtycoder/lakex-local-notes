/**
 * 清缓存语义（261105）：从「恒清 0 项」的 no-op 改成真的清派生数据。
 * 判据：① 清派生搜索缓存 + PDF 临时缓存；② 绝不碰已下载资源/正文（summary 口径不变）；
 * ③ DB 打不开（坏库）时如实抛错，由坏库页给「从云端恢复」出口，不静默成功。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clearSearch: vi.fn(async () => ({ notes: 5, quickNotes: 2 })),
  reconcile: vi.fn(async () => undefined),
  cleanPdf: vi.fn(async () => undefined),
  listAssets: vi.fn(async () => ["a", "b", "c"]),
  ensureDb: vi.fn(async () => ({ fake: true })),
}));

vi.mock("../bridge/context", () => ({ ensureDb: state.ensureDb }));
vi.mock("../data/derivedSearchCache", () => ({ clearSearchDerivedCache: state.clearSearch }));
vi.mock("../data/searchIndex", () => ({ reconcileIndex: state.reconcile }));
vi.mock("./pdfRender", () => ({ cleanupPdfRenderCache: state.cleanPdf }));
vi.mock("./assetFs", () => ({ listAssetKeysFs: state.listAssets }));

import { mobileCachePort } from "./cachePort";

beforeEach(() => {
  vi.clearAllMocks();
  state.ensureDb.mockResolvedValue({ fake: true });
  state.clearSearch.mockResolvedValue({ notes: 5, quickNotes: 2 });
});

describe("mobileCachePort", () => {
  it("clearDerivedCaches 真的清：派生索引 + PDF 临时缓存，并在后台重建索引", async () => {
    const result = await mobileCachePort.clearDerivedCaches();
    expect(state.ensureDb).toHaveBeenCalledTimes(1);
    expect(state.clearSearch).toHaveBeenCalledTimes(1);
    expect(state.cleanPdf).toHaveBeenCalledTimes(1);
    // 清完必须重建（否则搜索暂时无结果）：不阻塞清理调用本身
    expect(state.reconcile).toHaveBeenCalledTimes(1);
    expect(result.cleared).toMatchObject({ tempFileBytes: 7, downloadableAssetBytes: 0, pendingUploadBytes: 0 });
  });

  it("getCacheSummary 保守：已下载资源只报数量（不清），运行时 blob / 待上传恒 0", async () => {
    await expect(mobileCachePort.getCacheSummary()).resolves.toEqual({
      runtimeBlobBytes: 0,
      tempFileBytes: 0,
      downloadableAssetBytes: 3,
      pendingUploadBytes: 0,
    });
  });

  it("坏库（DB 打不开）⇒ 如实抛错，不伪装成清理成功", async () => {
    state.ensureDb.mockRejectedValueOnce(new Error("database disk image is malformed"));
    await expect(mobileCachePort.clearDerivedCaches()).rejects.toThrow("malformed");
    expect(state.clearSearch).not.toHaveBeenCalled();
    expect(state.cleanPdf).not.toHaveBeenCalled();
  });

  it("PDF 临时缓存清理失败不阻断主流程（纯临时文件）", async () => {
    state.cleanPdf.mockRejectedValueOnce(new Error("目录不可写"));
    await expect(mobileCachePort.clearDerivedCaches()).resolves.toBeTruthy();
    expect(state.clearSearch).toHaveBeenCalledTimes(1);
  });
});
