import { describe, expect, it } from "vitest";
import { mimeTypeForFilename, readImageDimensions, sniffImageFormat } from "./imageUtils";

describe("imageUtils", () => {
  it("sniffs supported image magic bytes", () => {
    expect(sniffImageFormat(Buffer.from("89504e470d0a1a0a", "hex"))).toEqual({ mimeType: "image/png", extension: "png" });
    expect(sniffImageFormat(Buffer.from("ffd8ff", "hex"))).toEqual({ mimeType: "image/jpeg", extension: "jpg" });
    expect(sniffImageFormat(Buffer.from("GIF89a", "ascii"))).toEqual({ mimeType: "image/gif", extension: "gif" });
    expect(sniffImageFormat(Buffer.from("RIFF1234WEBP", "ascii"))).toEqual({ mimeType: "image/webp", extension: "webp" });
    expect(sniffImageFormat(Buffer.from("xxxxftypavif", "ascii"))).toEqual({ mimeType: "image/avif", extension: "avif" });
    expect(sniffImageFormat(Buffer.from("not-an-image"))).toBeNull();
  });

  it("maps file extensions without trusting unknown extensions", () => {
    expect(mimeTypeForFilename("photo.JPEG")).toBe("image/jpeg");
    expect(mimeTypeForFilename("diagram.svg")).toBe("image/svg+xml");
    expect(mimeTypeForFilename("archive.bin")).toBe("application/octet-stream");
  });

  it("reads PNG and GIF dimensions without decoding the image", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(320, 16); png.writeUInt32BE(200, 20);
    expect(readImageDimensions(png)).toEqual({ width: 320, height: 200 });

    const gif = Buffer.from("GIF89a", "ascii");
    const gifHeader = Buffer.concat([gif, Buffer.alloc(4)]);
    gifHeader.writeUInt16LE(64, 6); gifHeader.writeUInt16LE(48, 8);
    expect(readImageDimensions(gifHeader)).toEqual({ width: 64, height: 48 });
  });
});
