import { describe, expect, it } from "vitest";
import { sniffImageMime, toImageDataUrl } from "./aiImages.js";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("图片嗅探与 data URL", () => {
  it("按内容识别 4 种受支持格式，其余返回 null", () => {
    expect(sniffImageMime(PNG_1PX)).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    expect(sniffImageMime(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("not an image at all"))).toBeNull();
  });

  it("受支持格式且尺寸 / 字节在限内 → 原样透传（不重编码）", async () => {
    const url = await toImageDataUrl(PNG_1PX, "a.png");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(url).toContain(PNG_1PX.toString("base64"));
  });

  it("不可解码的内容明确报错", async () => {
    await expect(toImageDataUrl(Buffer.from("garbage-bytes"), "a.bin")).rejects.toThrow(/无法读取图片/);
  });
});
