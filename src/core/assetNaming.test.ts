import { describe, expect, it } from "vitest";
import {
  ASSET_NAME_RE,
  buildAssetFilename,
  extractAssetRefs,
  isAssetExtension,
  isAssetFilename,
  isImageExtension,
  isMediaFilename,
  mediaKindOfFilename,
} from "./assetNaming.js";

describe("assetNaming", () => {
  it("extracts image AND attachment asset refs, keeping unrelated strings out", () => {
    const content = [
      "1234567890123_deadbeef.png",   // 图片
      "1234567890123_deadbeef.png",   // 去重
      "1234567890123_deadbeef.webp",
      "1234567890123_cafe0001.pdf",   // 附件：PDF
      "1234567890123_cafe0002.docx",  // 附件：Office
      "1234567890123_cafe0003.mp4",   // 附件：视频
      "not-a-lake-asset.png",
      "1234567890123_DEADBEEF.png",   // 大写 hex 不匹配
    ].join(" ");
    expect([...extractAssetRefs(content)]).toEqual([
      "1234567890123_deadbeef.png",
      "1234567890123_deadbeef.webp",
      "1234567890123_cafe0001.pdf",
      "1234567890123_cafe0002.docx",
      "1234567890123_cafe0003.mp4",
    ]);
  });

  it("matches asset filenames via regex contract", () => {
    expect(ASSET_NAME_RE.test("1787733338672_05581394.png")).toBe(true);
    expect(ASSET_NAME_RE.test("1787733338672_05581394.tar.gz")).toBe(false); // 多扩展名不匹配（上传归一化单扩展）
    expect(ASSET_NAME_RE.test("123_deadbeef.png")).toBe(false); // 时间戳不足 13 位
  });

  it("classifies image vs attachment extensions", () => {
    expect(isImageExtension("PNG")).toBe(true);
    expect(isImageExtension(".webp")).toBe(true);
    expect(isImageExtension("pdf")).toBe(false);
    expect(isAssetExtension("pdf")).toBe(true);
    expect(isAssetExtension("docx")).toBe(true);
    expect(isAssetExtension("mp4")).toBe(true);
    expect(isAssetExtension("xyzzy")).toBe(false);
  });

  it("detects asset filenames", () => {
    expect(isAssetFilename("1787733338672_05581394.pdf")).toBe(true);
    expect(isAssetFilename("1787733338672_05581394.png")).toBe(true);
    expect(isAssetFilename("report.pdf")).toBe(false);
  });

  it("builds asset filenames with normalized lowercase extension", () => {
    const name = buildAssetFilename("合同.PDF", 1787733338672);
    expect(name).toMatch(/^1787733338672_[0-9a-f]{8}\.pdf$/);
    const noExt = buildAssetFilename("no-extension", 1787733338673);
    expect(noExt).toMatch(/^1787733338673_[0-9a-f]{8}\.bin$/);
    const weird = buildAssetFilename("a.!!!", 1787733338674);
    expect(weird).toMatch(/^1787733338674_[0-9a-f]{8}\.bin$/);
  });

  it("classifies media filenames into audio/video/image/null (Lake acceptance)", () => {
    expect(mediaKindOfFilename("song.mp3")).toBe("audio");
    expect(mediaKindOfFilename("song.M4A")).toBe("audio");
    expect(mediaKindOfFilename("voice.wav")).toBe("audio");
    expect(mediaKindOfFilename("voice.flac")).toBe("audio");
    expect(mediaKindOfFilename("clip.mp4")).toBe("video");
    expect(mediaKindOfFilename("clip.MOV")).toBe("video");
    expect(mediaKindOfFilename("clip.webm")).toBe("video");
    expect(mediaKindOfFilename("clip.mkv")).toBe("video");
    expect(mediaKindOfFilename("clip.avi")).toBe("video");
    expect(mediaKindOfFilename("photo.png")).toBe("image");
    expect(mediaKindOfFilename("photo.JPG")).toBe("image");
    expect(mediaKindOfFilename("photo.bmp")).toBe("image");
    expect(mediaKindOfFilename("photo.svg")).toBe("image");
    expect(mediaKindOfFilename("photo.tiff")).toBe("image");
    // Lake reader 不认的格式：不参与分发（否则插入失败），返回 null
    expect(mediaKindOfFilename("voice.aac")).toBeNull();
    expect(mediaKindOfFilename("voice.ogg")).toBeNull();
    expect(mediaKindOfFilename("voice.opus")).toBeNull();
    expect(mediaKindOfFilename("voice.wma")).toBeNull();
    expect(mediaKindOfFilename("clip.ogv")).toBeNull();
    expect(mediaKindOfFilename("clip.3g2")).toBeNull();
    expect(mediaKindOfFilename("photo.avif")).toBeNull();
    expect(mediaKindOfFilename("photo.apng")).toBeNull();
    expect(mediaKindOfFilename("photo.ico")).toBeNull();
    expect(mediaKindOfFilename("doc.pdf")).toBeNull();
    expect(mediaKindOfFilename("archive.zip")).toBeNull();
    expect(mediaKindOfFilename("no-extension")).toBeNull();
    expect(mediaKindOfFilename("")).toBeNull();
  });

  it("keeps isMediaFilename consistent with mediaKindOfFilename", () => {
    expect(isMediaFilename("song.mp3")).toBe(true);
    expect(isMediaFilename("clip.mp4")).toBe(true);
    expect(isMediaFilename("doc.pdf")).toBe(false);
    // 图片不是"媒体附件"（图片本就内嵌显示，不走点击预览路径）
    expect(isMediaFilename("photo.png")).toBe(false);
    // Lake 实测接受的媒体格式都应被识别（其余格式不参与分发，返回 null）
    for (const ext of ["mp3", "wav", "m4a", "flac", "mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv", "mpeg", "mpg", "3gp", "ts"]) {
      expect(mediaKindOfFilename(`x.${ext}`)).not.toBeNull();
    }
  });
});
