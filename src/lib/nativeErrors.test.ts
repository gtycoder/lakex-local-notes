import { describe, expect, it } from "vitest";
import { getNativeErrorCode, getNativeErrorMessage } from "./nativeErrors";

describe("native IPC errors", () => {
  it("reads code from cloned error message when contextBridge drops custom fields", () => {
    const error = new Error("[LAKE_IPC_CODE:NOT_FOUND] 笔记不存在");
    expect(getNativeErrorCode(error)).toBe("NOT_FOUND");
    expect(getNativeErrorMessage(error)).toBe("笔记不存在");
  });
});
