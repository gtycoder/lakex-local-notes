import { describe, expect, it } from "vitest";
import { S3v3SyncError } from "../../src/core/s3v3Engine.js";
import { annotateSyncError, readSyncErrorInfo } from "./syncErrorInfo.js";

describe("同步错误码/分类的读取与挂载（261028 P1）", () => {
  it("S3v3SyncError 的 code 决定分类", () => {
    expect(readSyncErrorInfo(new S3v3SyncError("lock-busy", "另一台设备正在发布同步，请稍后重试"))).toEqual({
      code: "lock-busy", className: "retryable",
    });
    expect(readSyncErrorInfo(new S3v3SyncError("epoch-mismatch", "云端是另一套数据"))).toEqual({
      code: "epoch-mismatch", className: "action-required",
    });
    expect(readSyncErrorInfo(new S3v3SyncError("pointer-corrupt", "指针损坏"))).toEqual({
      code: "pointer-corrupt", className: "fatal",
    });
  });

  it("未知错误按引擎口径 = retryable + unknown（网络/未知不阻断下一轮）", () => {
    expect(readSyncErrorInfo(new Error("socket hang up"))).toEqual({ code: "unknown", className: "retryable" });
  });

  it("已挂过的字段优先（避免二次读时分类漂移）", () => {
    const annotated = annotateSyncError(new Error("云端为空"), { code: "empty-cloud", className: "action-required" });
    expect(readSyncErrorInfo(annotated)).toEqual({ code: "empty-cloud", className: "action-required" });
  });

  it("挂到 Error 上是可枚举字段（IPC envelope 能读到）", () => {
    const annotated = annotateSyncError(new S3v3SyncError("lock-busy", "锁忙"));
    const fields = Object.fromEntries(Object.entries(annotated).filter(([key]) => key === "syncCode" || key === "syncClass"));
    expect(fields).toEqual({ syncCode: "lock-busy", syncClass: "retryable" });
  });

  it("非 Error 先包成 Error 并保留 message", () => {
    const annotated = annotateSyncError({ message: "坏对象", code: "cloud-changed" });
    expect(annotated).toBeInstanceOf(Error);
    expect(annotated.message).toBe("坏对象");
    expect(readSyncErrorInfo(annotated)).toEqual({ code: "cloud-changed", className: "retryable" });
  });
});
