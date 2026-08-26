import { describe, expect, it } from "vitest";
import {
  ASSET_NAME_RE,
  buildAssetFilename,
  extractAssetRefs,
  isAssetExtension,
  isAssetFilename,
  isImageExtension,
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
});
