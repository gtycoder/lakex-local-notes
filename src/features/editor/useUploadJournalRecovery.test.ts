// @vitest-environment jsdom
/**
 * 上传日志自愈订阅（D-02 收口）的行为护栏：「什么时候自愈 / 什么时候补拉」的判据与退避只许有一份
 * （历史上 EditorTab 与 LakeEditor 各一份逐字复制 = 漂移源，见 docs/audit-261125/02-desktop-ui.md D-02）。
 * 这里直接驱动 attachUploadJournalRecovery：订阅 → 晚到结果触发重建 / error 退避补拉 / cleanup 收口。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 内核只经 lazy 边界进入（AGENTS §4「桌面内核加载边界」）：测试里必须桩掉 lakeRuntime。
vi.mock("./lakeRuntime", () => ({ retryFailedDocumentImageUploads: vi.fn() }));

import { retryFailedDocumentImageUploads } from "./lakeRuntime";
import { attachUploadJournalRecovery } from "./useUploadJournalRecovery";
import {
  __resetUploadJournalCacheForTests,
  recordUploadDone,
  recordUploadError,
  recordUploadPending,
} from "./uploadJournal";

/** 未解决图卡正文（空 src + unknown error = 未解决；与 uploadCardRepair 同判据）。 */
const unresolvedBody = (taskId: string): string =>
  '<card type="inline" name="image" value="data:' +
  encodeURIComponent(JSON.stringify({ src: "", taskId, status: "error", errorMessage: "unknown error" })) +
  '">';
/** 已解决图卡正文（带真实资产 URL）。 */
const resolvedBody = (taskId: string): string =>
  '<card type="inline" name="image" value="data:' +
  encodeURIComponent(JSON.stringify({ src: "http://127.0.0.1:19876/n1/a.png", taskId, status: "done" })) +
  '">';

beforeEach(() => {
  localStorage.clear();
  __resetUploadJournalCacheForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("attachUploadJournalRecovery（订阅 → 重建 / 补拉）", () => {
  it("晚到结果命中正文未解决图卡 ⇒ onNeedRebuild 一次；pending 不触发", () => {
    const onNeedRebuild = vi.fn();
    const cleanup = attachUploadJournalRecovery({
      noteId: "n1",
      enabled: true,
      getLatestDocument: () => unresolvedBody("t1"),
      onNeedRebuild,
    });
    recordUploadPending({ taskId: "t1", noteId: "n1", type: "url", url: "https://cdn.example/a.png" });
    expect(onNeedRebuild).toHaveBeenCalledTimes(0);
    recordUploadDone("t1", { url: "http://127.0.0.1:19876/n1/a.png", filename: "a.png", size: 1, mimeType: "image/png" });
    expect(onNeedRebuild).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("异文档条目忽略；正文里已解决（带真实 src）不再触发重建", () => {
    const onNeedRebuild = vi.fn();
    const cleanup = attachUploadJournalRecovery({
      noteId: "n1",
      enabled: true,
      getLatestDocument: () => resolvedBody("t1"),
      onNeedRebuild,
    });
    recordUploadPending({ taskId: "t2", noteId: "other", type: "url", url: "https://cdn.example/b.png" });
    recordUploadDone("t2", { url: "http://127.0.0.1:19876/other/b.png", filename: "b.png", size: 1, mimeType: "image/png" });
    recordUploadPending({ taskId: "t1", noteId: "n1", type: "url", url: "https://cdn.example/a.png" });
    recordUploadDone("t1", { url: "http://127.0.0.1:19876/n1/a.png", filename: "a.png", size: 1, mimeType: "image/png" });
    expect(onNeedRebuild).toHaveBeenCalledTimes(0);
    cleanup();
  });

  it("error 按退避后台补拉；cleanup 后订阅与定时器一起收", () => {
    const cleanup = attachUploadJournalRecovery({
      noteId: "n1",
      enabled: true,
      getLatestDocument: () => unresolvedBody("t1"),
      onNeedRebuild: () => undefined,
    });
    recordUploadPending({ taskId: "t1", noteId: "n1", type: "url", url: "https://cdn.example/a.png" });
    recordUploadError("t1", "下载超时（15s）");
    expect(retryFailedDocumentImageUploads).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(retryFailedDocumentImageUploads).toHaveBeenCalledWith("n1");
    // cleanup 后新的失败不再排补拉（订阅已退、定时器已清）
    cleanup();
    recordUploadError("t1", "下载超时（15s）");
    vi.advanceTimersByTime(600_000);
    expect(retryFailedDocumentImageUploads).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 不订阅（LakeEditor 的 journalRecovery×mode 判据早退口径）", () => {
    const onNeedRebuild = vi.fn();
    const cleanup = attachUploadJournalRecovery({
      noteId: "n1",
      enabled: false,
      getLatestDocument: () => unresolvedBody("t1"),
      onNeedRebuild,
    });
    recordUploadPending({ taskId: "t1", noteId: "n1", type: "url", url: "https://cdn.example/a.png" });
    recordUploadDone("t1", { url: "http://127.0.0.1:19876/n1/a.png", filename: "a.png", size: 1, mimeType: "image/png" });
    expect(onNeedRebuild).toHaveBeenCalledTimes(0);
    cleanup();
  });
});
