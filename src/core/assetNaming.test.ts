import { describe, expect, it } from "vitest";
import {
  ASSET_NAME_RE,
  buildAssetFilename,
  extractAssetRefs,
  isAssetExtension,
  isSafeShellOpenFilename,
  isAssetFilename,
  isImageExtension,
  isMediaFilename,
  mediaKindOfFilename,
  fileKindOf,
  mimeTypeForFilename,
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

  it("isSafeShellOpenFilename：可执行/未知默认拒绝，文档媒体放行", () => {
    expect(isSafeShellOpenFilename("1787733338672_05581394.pdf")).toBe(true);
    expect(isSafeShellOpenFilename("1787733338672_05581394.png")).toBe(true);
    expect(isSafeShellOpenFilename("1787733338672_05581394.mp4")).toBe(true);
    expect(isSafeShellOpenFilename("1787733338672_05581394.zip")).toBe(true);
    expect(isSafeShellOpenFilename("1787733338672_05581394.pdf")).toBe(true);
    expect(isSafeShellOpenFilename("1787733338672_05581394.command")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.exe")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.bat")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.sh")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.xyzzy")).toBe(false);
    expect(isSafeShellOpenFilename("noext")).toBe(false);
  });

  it("isSafeShellOpenFilename（DS 复核 A4 边界）：apk/bin/svg/大写/双扩展/宏文档/lnk", () => {
    expect(isSafeShellOpenFilename("1787733338672_05581394.apk")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.bin")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.svg")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.EXE")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.PDF")).toBe(true);
    expect(isSafeShellOpenFilename("x.pdf.command")).toBe(false);
    expect(isSafeShellOpenFilename("x.command.pdf")).toBe(true);
    expect(isSafeShellOpenFilename("1787733338672_05581394.docm")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.lnk")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.desktop")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.url")).toBe(false);
    expect(isSafeShellOpenFilename("1787733338672_05581394.reg")).toBe(false);
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

  it("按扩展名给 MIME，未知扩展名不瞎猜（共用单一事实源的唯一副本）", () => {
    expect(mimeTypeForFilename("photo.JPEG")).toBe("image/jpeg");
    expect(mimeTypeForFilename("diagram.svg")).toBe("image/svg+xml");
    expect(mimeTypeForFilename("报告.pdf")).toBe("application/pdf");
    expect(mimeTypeForFilename("archive.bin")).toBe("application/octet-stream");
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

  it("fileKindOf：附件文档类型（文件类型图标的分流口径，用户 260930）", () => {
    // 图片走 isImageExtension 的既有清单（不在这里重复维护）
    expect(fileKindOf("a.PNG")).toBe("image");
    expect(fileKindOf("a.webp")).toBe("image");
    // 文件名与裸扩展名都能吃；大写归一
    expect(fileKindOf("【期神笔记】2024.pdf")).toBe("pdf");
    expect(fileKindOf(".PDF")).toBe("pdf");
    expect(fileKindOf("2月18日三合一.doc")).toBe("doc");
    expect(fileKindOf("x.docx")).toBe("doc");
    expect(fileKindOf("表.xlsx")).toBe("sheet");
    expect(fileKindOf("x.csv")).toBe("sheet");
    expect(fileKindOf("趋势线战法.pptx")).toBe("slide");
    expect(fileKindOf("x.zip")).toBe("archive");
    expect(fileKindOf("歌.mp3")).toBe("audio");
    expect(fileKindOf("片.mp4")).toBe("video");
    expect(fileKindOf("main.ts")).toBe("code");
    expect(fileKindOf("notes.md")).toBe("text");
    // 无扩展名 / 不认识的一律回落通用类型，不瞎猜
    expect(fileKindOf("README")).toBe("file");
    expect(fileKindOf("x.qqq")).toBe("file");
    expect(fileKindOf("")).toBe("file");
  });
});
