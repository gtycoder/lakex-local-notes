import { describe, expect, it } from "vitest";
import { getNativeErrorCode, getNativeErrorMessage } from "./nativeErrors";

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
