import { describe, expect, it } from "vitest";
import { formatImportBytes, inkImageImportNotice, inkPdfImportNotice } from "./inkImportNotice";

describe("手写板导入完成提示（261103 十三批 P2）", () => {
  it("体积格式化：KB / MB 两位口径；0/非法 → 0 KB", () => {
    expect(formatImportBytes(0)).toBe("0 KB");
    expect(formatImportBytes(null)).toBe("0 KB");
    expect(formatImportBytes(512)).toBe("1 KB");
    expect(formatImportBytes(1536)).toBe("2 KB");
    expect(formatImportBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("图片页：带体积与首次同步说明；0 页返回空串", () => {
    expect(inkImageImportNotice(0, 100)).toBe("");
    expect(inkImageImportNotice(3, 0)).toBe("已导入 3 页");
    expect(inkImageImportNotice(3, 1536 * 1024)).toBe("已导入 3 页，图片约 1.5 MB（首次同步会一起上传）");
  });

  it("PDF：截断时带「共 N 页」；未截断只报导入页数", () => {
    expect(inkPdfImportNotice(12, 20, 0, true)).toBe("已导入 12 页（共 20 页）");
    expect(inkPdfImportNotice(12, 20, 2048 * 1024, true)).toBe("已导入 12 页（共 20 页），图片约 2.0 MB（首次同步会一起上传）");
    expect(inkPdfImportNotice(5, 5, 1024, false)).toContain("已导入 5 页，图片约 1 KB");
  });
});
