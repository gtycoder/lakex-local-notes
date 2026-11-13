// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetUploadJournalCacheForTests,
  getUploadEntry,
  pendingUploadsForNote,
  recordUploadDone,
  recordUploadError,
  recordUploadPending,
  subscribeUploadJournal,
  uploadsForNote,
} from "./uploadJournal";

const storageKey = "lakex-local-notes.image-upload-journal.v1";

beforeEach(() => {
  localStorage.clear();
  __resetUploadJournalCacheForTests();
});

afterEach(() => {
  __resetUploadJournalCacheForTests();
  vi.restoreAllMocks();
});

describe("uploadJournal", () => {
  it("记录 pending → done：按 taskId 保留原 URL 与真实资产元信息", () => {
    recordUploadPending({ taskId: "u1", noteId: "n1", type: "url", url: "https://cdn.example/a.png" });
    const pending = getUploadEntry("u1");
    expect(pending?.status).toBe("pending");
    expect(pending?.url).toBe("https://cdn.example/a.png");

    recordUploadDone("u1", { url: "http://127.0.0.1:19876/n1/abc.png", filename: "abc.png", size: 123, mimeType: "image/png" });
    const done = getUploadEntry("u1");
    expect(done?.status).toBe("done");
    expect(done?.output).toEqual({ url: "http://127.0.0.1:19876/n1/abc.png", filename: "abc.png", size: 123, mimeType: "image/png" });
    expect(done?.url).toBe("https://cdn.example/a.png");
    expect(JSON.parse(localStorage.getItem(storageKey) || "[]")).toHaveLength(1);
  });

  it("失败保留原 URL 并写真实原因；pendingUploadsForNote 只返回未完成 URL 项", () => {
    recordUploadPending({ taskId: "u1", noteId: "n1", type: "url", url: "https://cdn.example/a.png" });
    recordUploadPending({ taskId: "u2", noteId: "n1", type: "file" });
    recordUploadError("u1", "下载超时（15s）");
    expect(getUploadEntry("u1")?.status).toBe("error");
    expect(getUploadEntry("u1")?.error).toBe("下载超时（15s）");
    expect(pendingUploadsForNote("n1")).toEqual([]);
    expect(uploadsForNote("n1")).toHaveLength(2);
  });

  it("订阅变更：完成时通知订阅方；退订后不再通知", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeUploadJournal((entry) => seen.push(entry.taskId + ":" + entry.status));
    recordUploadPending({ taskId: "u1", noteId: "n1", type: "url", url: "https://x/a.png" });
    recordUploadDone("u1", { url: "http://local/a.png", filename: "a.png", size: 1, mimeType: "image/png" });
    unsubscribe();
    recordUploadDone("u1", { url: "http://local/a.png", filename: "a.png", size: 1, mimeType: "image/png" });
    expect(seen).toEqual(["u1:pending", "u1:done"]);
  });

  it("localStorage 不可用/内容损坏时静默降级（不抛错）", () => {
    const broken = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => "{not json");
    expect(() => recordUploadPending({ taskId: "u1", noteId: "n1", type: "url", url: "https://x/a.png" })).not.toThrow();
    expect(pendingUploadsForNote("n1").map((entry) => entry.taskId)).toEqual(["u1"]);
    broken.mockRestore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => recordUploadDone("u1", { url: "http://local/a.png", filename: "a.png", size: 1, mimeType: "image/png" })).not.toThrow();
    expect(getUploadEntry("u1")?.status).toBe("done");
  });

  it("超过 7 天的条目在读取时清理", () => {
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(storageKey, JSON.stringify([{ taskId: "old", noteId: "n1", type: "url", url: "https://x/a.png", createdAt: old, status: "pending" }]));
    __resetUploadJournalCacheForTests();
    expect(pendingUploadsForNote("n1")).toEqual([]);
  });
});
