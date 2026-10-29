/** 同步工具测试：isNoSuchKey 的 404 语义（CORE-05 后 syncUtils 只剩两端在用的通用工具）。 */
import { describe, expect, it } from "vitest";
import { isNoSuchKey } from "./syncUtils.js";

describe("isNoSuchKey", () => {
  it("recognizes GetObject missing (NoSuchKey)", () => {
    const e = new Error("The specified key does not exist.");
    e.name = "NoSuchKey";
    expect(isNoSuchKey(e)).toBe(true);
  });

  it("recognizes HeadObject missing (NotFound name, UnknownError message)", () => {
    // 七牛 Kodo HeadObject 缺失：name=NotFound、message=UnknownError（实测）
    const e = new Error("UnknownError");
    e.name = "NotFound";
    expect(isNoSuchKey(e)).toBe(true);
  });

  it("rejects real errors", () => {
    const e = new Error("network timeout");
    e.name = "TimeoutError";
    expect(isNoSuchKey(e)).toBe(false);
    expect(isNoSuchKey(new Error("AccessDenied: denied"))).toBe(false);
  });
});
