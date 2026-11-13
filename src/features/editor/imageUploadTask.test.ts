// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetImageUploadTasksForTests,
  createImageUploadTask,
  getActiveImageUploadTask,
  resumePendingImageUploads,
} from "./imageUploadTask";
import {
  __resetUploadJournalCacheForTests,
  getUploadEntry,
  recordUploadPending,
} from "./uploadJournal";

const pngOutput = { url: "http://127.0.0.1:19876/n1/abc.png", resourceRef: "abc.png", filename: "abc.png", mimeType: "image/png", size: 321 };

beforeEach(() => {
  localStorage.clear();
  __resetUploadJournalCacheForTests();
  __resetImageUploadTasksForTests();
});
afterEach(() => {
  __resetImageUploadTasksForTests();
  __resetUploadJournalCacheForTests();
});

describe("ImageUploadTask（内核 createUploadTask 契约）", () => {
  it("成功：start/success 事件、status=success、日志写回资产；run 幂等", async () => {
    const perform = vi.fn(async () => pngOutput);
    const events: string[] = [];
    const task = createImageUploadTask({
      taskId: "u1",
      noteId: "n1",
      type: "url",
      data: "https://cdn.example/a.png",
      perform,
      journal: true,
    });
    task.on("start", () => events.push("start"));
    task.on("success", () => events.push("success"));
    expect(task.getStatus()).toBe("pending");
    const first = await task.run();
    const second = await task.run();
    expect(first).toEqual(pngOutput);
    expect(second).toEqual(pngOutput);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["start", "success"]);
    expect(task.getStatus()).toBe("success");
    // 内核卡片 UI/管理器会调 WY 同款判据与 on/off（缺一个 render 直接 TypeError/assert）
    expect(task.isSuccess()).toBe(true);
    expect(task.isError()).toBe(false);
    expect(typeof task.off).toBe("function");
    expect(typeof task.on).toBe("function");
    expect(typeof task.getResourceURL).toBe("function");
    expect(getUploadEntry("u1")?.status).toBe("done");
    expect(getUploadEntry("u1")?.output?.filename).toBe("abc.png");
    expect(getActiveImageUploadTask("u1")).toBe(task);
  });

  it("失败：error 事件带真实 Error、status=error、run 不 reject、日志写真实原因", async () => {
    const perform = vi.fn(async () => { throw new Error("下载超时（15s）"); });
    const task = createImageUploadTask({
      taskId: "u2",
      noteId: "n1",
      type: "url",
      data: "https://cdn.example/b.png",
      perform,
      journal: true,
    });
    const errors: string[] = [];
    task.on("error", (error) => errors.push((error as Error).message));
    const result = await task.run();
    expect(result).toMatchObject({ error: expect.any(Error) });
    expect(task.getStatus()).toBe("error");
    expect(errors).toEqual(["下载超时（15s）"]);
    expect(getUploadEntry("u2")?.error).toBe("下载超时（15s）");
  });

  it("完成后再注册 success 监听也会补发（内核重建后新卡片能接到结果）", async () => {
    const task = createImageUploadTask({
      taskId: "u3",
      noteId: "n1",
      type: "url",
      data: "https://cdn.example/c.png",
      perform: async () => pngOutput,
      journal: true,
    });
    await task.run();
    const received = await new Promise((resolve) => task.on("success", resolve));
    expect(received).toEqual(pngOutput);
  });

  it("非 URL 上传不写持久日志（file/base64 无法跨重启恢复）", async () => {
    const task = createImageUploadTask({
      taskId: "u4",
      noteId: "n1",
      type: "file",
      data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      perform: async () => pngOutput,
      journal: true,
    });
    await task.run();
    expect(getUploadEntry("u4")).toBeUndefined();
  });

  it("resumePendingImageUploads：重启后按原 taskId 重新下载并写回日志", async () => {
    recordUploadPending({ taskId: "u5", noteId: "n1", type: "url", url: "https://cdn.example/d.png" });
    const perform = vi.fn(async () => pngOutput);
    const resumed = resumePendingImageUploads(
      "n1",
      perform,
      [{ taskId: "u5", url: "https://cdn.example/d.png", type: "url", status: "pending" }],
    );
    expect(resumed).toHaveLength(1);
    await resumed[0].run();
    expect(perform).toHaveBeenCalledTimes(1);
    expect(getUploadEntry("u5")?.status).toBe("done");
  });
});
