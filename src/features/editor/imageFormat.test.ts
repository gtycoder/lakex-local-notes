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
});
