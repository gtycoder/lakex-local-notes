import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeSyncBreakdown, MAX_PERSISTED_SYNC_WARNINGS, readSyncStatus, writeSyncStatus, type MobileSyncStatus } from "./syncStatusStore";
import type { SyncWarning } from "../../core/sharedTypes";

/** node 测试环境没有 DOM 的 localStorage：本文件只验落盘/解析，给一个最小内存实现即可。 */
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => memory.get(key) ?? null,
      setItem: (key: string, value: string): void => { memory.set(key, String(value)); },
      removeItem: (key: string): void => { memory.delete(key); },
      clear: (): void => { memory.clear(); },
    },
  });
}

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

/**
 * task-67：跳过项摘要随「上次同步」落盘（重启不丢）。
 * 落盘只留前 20 条（localStorage 体积），但分组计数按**完整列表**算 ⇒ 摘要行不因截断而撒谎。
 */
describe("上次同步的跳过项摘要落盘（task-67）", () => {
  const KEY = "lakex-local-notes-mobile.lastSync";
  const warning = (index: number): SyncWarning => ({
    kind: index % 2 === 0 ? "local_body_missing" : "remote_incomplete",
    noteId: "note-" + index,
    title: "文档 " + index,
    message: "e".repeat(500),
  });

  beforeEach(() => { localStorage.removeItem(KEY); });

  it("上限 20 条 + 计数按完整列表 + 单条 message 截断", () => {
    writeSyncStatus({ at: "2026-11-12T10:00:00.000Z", ok: true, message: "ok", warnings: Array.from({ length: 25 }, (_, i) => warning(i)) });
    const status = readSyncStatus();
    expect(status?.warnings).toHaveLength(MAX_PERSISTED_SYNC_WARNINGS);
    expect(status?.warningSummary).toEqual({ total: 25, needsAction: 13, retryable: 12 });
    expect(status?.warnings?.[0].message.length).toBeLessThanOrEqual(200);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").warnings).toHaveLength(MAX_PERSISTED_SYNC_WARNINGS);
  });

  it("重新解析 localStorage（= App 重启）仍能恢复摘要；未知 kind 丢弃、缺字段容错", async () => {
    localStorage.setItem(KEY, JSON.stringify({
      at: "2026-11-12T10:00:00.000Z", ok: true, message: "ok",
      warnings: [{ kind: "未知kind", noteId: "bad" }, { kind: "apply_skipped", noteId: "n1", title: "文档 1", message: "x" }],
      warningSummary: { total: 3, needsAction: 1, retryable: 2 },
    }));
    vi.resetModules();
    const fresh = await import("./syncStatusStore");
    const status = fresh.readSyncStatus();
    expect(status?.warnings).toEqual([{ kind: "apply_skipped", noteId: "n1", title: "文档 1", message: "x" }]);
    expect(status?.warningSummary).toEqual({ total: 3, needsAction: 1, retryable: 2 });
  });

  it("失败轮不写 warnings ⇒ 旧摘要不残留（本轮没跳过项就是没有）", () => {
    writeSyncStatus({ at: "2026-11-12T10:00:00.000Z", ok: true, message: "ok", warnings: [warning(1)] });
    expect(readSyncStatus()?.warnings).toHaveLength(1);
    writeSyncStatus({ at: "2026-11-12T10:05:00.000Z", ok: false, message: "网络错误" });
    expect(readSyncStatus()?.warnings).toBeUndefined();
    expect(readSyncStatus()?.warningSummary).toBeUndefined();
  });
});
