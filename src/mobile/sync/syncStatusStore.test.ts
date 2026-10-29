import { describe, expect, it } from "vitest";
import { describeSyncBreakdown, type MobileSyncStatus } from "./syncStatusStore";

/** 261028：设置页「上传/下载细分」一行（文档/目录/小记/字节；旧记录缺细分返回 null）。 */
describe("describeSyncBreakdown", () => {
  const base: MobileSyncStatus = { at: "2026-10-28T14:00:00.000Z", ok: true, message: "ok" };

  it("完整细分：文档/目录/小记/字节 全量展示", () => {
    const text = describeSyncBreakdown({
      ...base,
      uploadedDocuments: 2, uploadedFolders: 1, uploadedQuickNotes: 0, uploadedBytes: 1536,
      downloadedDocuments: 0, downloadedFolders: 0, downloadedQuickNotes: 1, downloadedBytes: 340,
    });
    expect(text).toContain("上传 2/1/0");
    expect(text).toContain("下载 0/0/1");
    expect(text).toContain("文档/目录/小记");
    expect(text).toMatch(/1\.5 KB|1,536 B/);
  });

  it("0 也显示（用户要求始终展示）", () => {
    const text = describeSyncBreakdown({
      ...base,
      uploadedDocuments: 0, uploadedFolders: 0, uploadedQuickNotes: 0, uploadedBytes: 0,
      downloadedDocuments: 0, downloadedFolders: 0, downloadedQuickNotes: 0, downloadedBytes: 0,
    });
    expect(text).toContain("上传 0/0/0");
    expect(text).toContain("下载 0/0/0");
  });

  it("旧记录（没有细分字段）返回 null，不显示空行", () => {
    expect(describeSyncBreakdown(base)).toBeNull();
  });
});
