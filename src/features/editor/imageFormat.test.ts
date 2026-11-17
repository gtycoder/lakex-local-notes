import { describe, expect, it } from "vitest";
import { normalizeImageInput, sniffImageFormat } from "./imageFormat";

describe("image format preservation", () => {
  it("keeps GIF and WebP extensions based on magic bytes", () => {
    const gif = new Uint8Array(Buffer.from("GIF89a", "ascii"));
    const webp = new Uint8Array(Buffer.from("RIFF1234WEBP", "ascii"));

    expect(sniffImageFormat(gif)).toEqual({ mimeType: "image/gif", extension: "gif" });
    expect(sniffImageFormat(webp)).toEqual({ mimeType: "image/webp", extension: "webp" });
    expect(normalizeImageInput(gif, "paste.jpg").filename).toBe("paste.gif");
    expect(normalizeImageInput(webp, "paste.png").filename).toBe("paste.webp");
  });

  it("本地图片遵循调用方传入的上限", () => {
    const png = new Uint8Array(128);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => normalizeImageInput(png, "big.png", 64)).toThrow(/无法插入.*big\.png.*附件上限/);
  });
});
