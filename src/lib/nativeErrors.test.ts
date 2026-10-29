import { describe, expect, it } from "vitest";
import { getNativeErrorCode, getNativeErrorMessage, getNativeSyncErrorInfo } from "./nativeErrors";

describe("native IPC errors", () => {
  it("reads code from cloned error message when contextBridge drops custom fields", () => {
    const error = new Error("[LAKE_IPC_CODE:NOT_FOUND] 笔记不存在");
    expect(getNativeErrorCode(error)).toBe("NOT_FOUND");
    expect(getNativeErrorMessage(error)).toBe("笔记不存在");
  });

  it("V5 Phase 3 增量错误码：CONFLICT / NETWORK_TIMEOUT / CANCELLED（CANCELLED 不弹 toast 的判据）", () => {
    expect(getNativeErrorCode(new Error("[LAKE_IPC_CODE:CONFLICT] 双端修改"))).toBe("CONFLICT");
    expect(getNativeErrorCode(new Error("[LAKE_IPC_CODE:NETWORK_TIMEOUT] 网络超时"))).toBe("NETWORK_TIMEOUT");
    expect(getNativeErrorCode(new Error("[LAKE_IPC_CODE:CANCELLED] 用户取消"))).toBe("CANCELLED");
    expect(getNativeErrorMessage(new Error("[LAKE_IPC_CODE:CANCELLED] 用户取消"))).toBe("用户取消");
  });

  it("code 属性优先于消息前缀", () => {
    expect(getNativeErrorCode({ code: "INTERNAL", message: "[LAKE_IPC_CODE:NOT_FOUND] x" })).toBe("INTERNAL");
  });
});

/** 构造带 IPC 透传字段的 Error（preload 解包后的形态，261028 P1）。 */
function syncError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("另一台设备正在发布同步，请稍后重试"), fields);
}

describe("getNativeSyncErrorInfo（同步错误码 + 分类，261028 P1）", () => {
  it("读到合法的同步码与分类", () => {
    expect(getNativeSyncErrorInfo(syncError({ syncCode: "lock-busy", syncClass: "retryable" }))).toEqual({
      code: "lock-busy", className: "retryable",
    });
    expect(getNativeSyncErrorInfo(syncError({ syncCode: "epoch-mismatch", syncClass: "action-required" }))).toEqual({
      code: "epoch-mismatch", className: "action-required",
    });
    expect(getNativeSyncErrorInfo(syncError({ syncCode: "pointer-corrupt", syncClass: "fatal" }))).toEqual({
      code: "pointer-corrupt", className: "fatal",
    });
  });

  it("没有同步字段的普通错误返回 null（走原来的错误路径）", () => {
    expect(getNativeSyncErrorInfo(new Error("offline"))).toBeNull();
    expect(getNativeSyncErrorInfo({ code: "INTERNAL", message: "普通 IPC 错误" })).toBeNull();
    expect(getNativeSyncErrorInfo(null)).toBeNull();
    expect(getNativeSyncErrorInfo("字符串错误")).toBeNull();
  });

  it("非法值不认（两个字段都合法才返回）", () => {
    expect(getNativeSyncErrorInfo(syncError({ syncCode: "", syncClass: "retryable" }))).toBeNull();
    expect(getNativeSyncErrorInfo(syncError({ syncCode: "x".repeat(65), syncClass: "retryable" }))).toBeNull();
    expect(getNativeSyncErrorInfo(syncError({ syncCode: 42, syncClass: "retryable" }))).toBeNull();
    expect(getNativeSyncErrorInfo(syncError({ syncCode: "lock-busy", syncClass: "maybe" }))).toBeNull();
    expect(getNativeSyncErrorInfo(syncError({ syncCode: "lock-busy" }))).toBeNull();
    expect(getNativeSyncErrorInfo(syncError({ syncClass: "retryable" }))).toBeNull();
  });
});
