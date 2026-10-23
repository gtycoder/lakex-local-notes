import { describe, expect, it } from "vitest";
import { dataUrlToBytes, imageExtOf, isValidImageRef, mimeOfExt } from "./aiImageStore";

describe("AI 会话图片存档（纯函数）", () => {
  it("mime ↔ ext", () => {
    expect(imageExtOf("image/png")).toBe("png");
    expect(imageExtOf("image/jpeg")).toBe("jpg");
    expect(imageExtOf("image/webp")).toBe("webp");
    expect(mimeOfExt("jpg")).toBe("image/jpeg");
    expect(mimeOfExt("png")).toBe("image/png");
  });

  it("引用校验：拒绝路径穿越/非图片/非法扩展", () => {
    expect(isValidImageRef({ id: "11111111-1111-4111-8111-111111111111", mime: "image/png", ext: "png" })).toBe(true);
    expect(isValidImageRef({ id: "../evil", mime: "image/png", ext: "png" })).toBe(false);
    expect(isValidImageRef({ id: "11111111-1111-4111-8111-111111111111", mime: "text/plain", ext: "txt" })).toBe(false);
    expect(isValidImageRef(null)).toBe(false);
  });

  it("data URL → bytes（非法返回 null）", () => {
    expect(dataUrlToBytes("data:image/png;base64,AAEC")).toEqual(new Uint8Array([0, 1, 2]));
    expect(dataUrlToBytes("not-a-data-url")).toBeNull();
  });
});
