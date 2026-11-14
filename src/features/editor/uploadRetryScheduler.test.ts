// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { uploadRetryDelayForEntry } from "./uploadRetryScheduler";
import type { UploadJournalEntry } from "./uploadJournal";

function entry(patch: Partial<UploadJournalEntry> = {}): UploadJournalEntry {
  return { taskId: "t1", noteId: "n1", type: "url", url: "https://x/a.png", createdAt: Date.now(), status: "error", attempts: 1, ...patch };
}

describe("失败图后台补拉调度（261114 二批）", () => {
  it("error 项按已失败次数退避：3s → 10s → 30s → 2min → 10min", () => {
    expect([1, 2, 3, 4, 5].map((attempts) => uploadRetryDelayForEntry(entry({ attempts })))).toEqual([3_000, 10_000, 30_000, 120_000, 600_000]);
  });

  it("超预算 / pending / done / 无 URL 一律不补拉", () => {
    expect(uploadRetryDelayForEntry(entry({ attempts: 6 }))).toBeNull();
    expect(uploadRetryDelayForEntry(entry({ status: "pending", attempts: 1 }))).toBeNull();
    expect(uploadRetryDelayForEntry(entry({ status: "done", attempts: 1 }))).toBeNull();
    expect(uploadRetryDelayForEntry(entry({ url: undefined }))).toBeNull();
  });
});
