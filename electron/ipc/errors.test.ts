import { describe, expect, it } from "vitest";
import { IpcInputError } from "../ipcLimits";
import { AppError } from "../../src/core/storeErrors.js";
import { IPC_ERROR_MARKER, encodeIpcError, parseIpcError, toIpcErrorPayload } from "./errors";

describe("IPC error payloads", () => {
  it("preserves domain error codes", () => {
    expect(toIpcErrorPayload(new AppError("NotFound", "文档不存在"))).toEqual({
      name: "AppError", message: "文档不存在", code: "NOT_FOUND",
    });
    expect(toIpcErrorPayload(new IpcInputError("参数无效"))).toEqual({
      name: "IpcInputError", message: "参数无效", code: "INVALID_INPUT",
    });
    expect(toIpcErrorPayload(new AppError("NotConfigured", "尚未配置云同步"))).toEqual({
      name: "AppError", message: "尚未配置云同步", code: "NOT_CONFIGURED",
    });
  });

  it("normalizes unknown errors to INTERNAL without leaking extra fields", () => {
    expect(toIpcErrorPayload(new Error("网络失败"))).toEqual({
      name: "Error", message: "网络失败", code: "INTERNAL",
    });
    expect(toIpcErrorPayload({ message: "坏请求", code: "INVALID_INPUT", secret: "do not serialize" })).toEqual({
      name: "IpcError", message: "坏请求", code: "INVALID_INPUT",
    });
  });

  it("encodes the envelope in an Error for Electron invoke serialization", () => {
    const encoded = encodeIpcError(new AppError("NotConfigured", "尚未配置云同步"));
    expect(parseIpcError(encoded.message)).toMatchObject({ code: "NOT_CONFIGURED", message: "尚未配置云同步" });
    expect(parseIpcError("Error invoking remote method 'read_note': [LAKE_IPC_CODE:NOT_FOUND] 笔记不存在")).toMatchObject({ code: "NOT_FOUND", message: "笔记不存在" });
  });

  it("透传同步域错误码与分类（261028 P1：可重试 vs 需人工处理）", () => {
    const lockBusy = withSyncFields(new Error("另一台设备正在发布同步，请稍后重试"), "lock-busy", "retryable");
    expect(toIpcErrorPayload(lockBusy)).toEqual({
      name: "Error", message: "另一台设备正在发布同步，请稍后重试", code: "INTERNAL",
      syncCode: "lock-busy", syncClass: "retryable",
    });
    // encode → parse（Electron invoke 的实际路径）
    expect(parseIpcError(encodeIpcError(lockBusy).message)).toMatchObject({ code: "INTERNAL", syncCode: "lock-busy", syncClass: "retryable" });
    // marker JSON 分支（已编码消息直接解）
    const marker = IPC_ERROR_MARKER + JSON.stringify({ name: "Error", message: "云端是另一套数据", code: "INTERNAL", syncCode: "epoch-mismatch", syncClass: "action-required" });
    expect(parseIpcError("[LAKE_IPC_CODE:INTERNAL] 云端是另一套数据 " + marker)).toMatchObject({
      syncCode: "epoch-mismatch", syncClass: "action-required", message: "云端是另一套数据",
    });
    // 前缀兜底路径没有同步字段（老格式消息）
    expect(parseIpcError("Error invoking remote method 'sync_now': [LAKE_IPC_CODE:INTERNAL] 同步失败")).toEqual({
      name: "IpcError", message: "同步失败", code: "INTERNAL",
    });
  });

  it("非法或超长的同步字段不透传（白名单，不泄漏额外字段）", () => {
    const tooLong = withSyncFields(new Error("坏码"), "x".repeat(65), "retryable");
    // 超长 code 丢弃，但分类本身合法仍保留（分类是 UI 分流的关键，不被坏 code 连坐）。
    expect(toIpcErrorPayload(tooLong)).toEqual({ name: "Error", message: "坏码", code: "INTERNAL", syncClass: "retryable" });
    const badClass = withSyncFields(new Error("坏分类"), "lock-busy", "maybe");
    expect(toIpcErrorPayload(badClass)).toEqual({ name: "Error", message: "坏分类", code: "INTERNAL", syncCode: "lock-busy" });
    const badCode = withSyncFields(new Error("坏 code"), 42, "fatal");
    expect(toIpcErrorPayload(badCode)).toEqual({ name: "Error", message: "坏 code", code: "INTERNAL", syncClass: "fatal" });
    // marker 里的非法值同样被丢弃
    const marker = IPC_ERROR_MARKER + JSON.stringify({ name: "Error", message: "x", code: "INTERNAL", syncCode: "", syncClass: "retry" });
    expect(parseIpcError("[LAKE_IPC_CODE:INTERNAL] x " + marker)).toEqual({ name: "Error", message: "x", code: "INTERNAL" });
  });
});

/** 构造带同步字段的 Error（模拟 desktopSync catch 里 annotateSyncError 的产物）。 */
function withSyncFields(error: Error, syncCode: unknown, syncClass: unknown): Error {
  const target = error as Error & { syncCode?: unknown; syncClass?: unknown };
  target.syncCode = syncCode;
  target.syncClass = syncClass;
  return target;
}
