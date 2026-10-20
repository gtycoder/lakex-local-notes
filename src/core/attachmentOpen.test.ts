import { describe, expect, it } from "vitest";
import { ATTACHMENT_ARCHIVE_EXTS, isArchiveAttachment } from "./attachmentOpen";

describe("附件打开策略（压缩包要挪到临时目录）", () => {
  it("压缩包扩展名（含大小写）都识别", () => {
    for (const ext of ATTACHMENT_ARCHIVE_EXTS) {
      expect(isArchiveAttachment("icon_set." + ext)).toBe(true);
      expect(isArchiveAttachment("ICON_SET." + ext.toUpperCase())).toBe(true);
    }
  });

  it("普通附件不当作压缩包（docx 本质是 zip 容器，但系统打开时不会解压）", () => {
    for (const name of ["报告.docx", "预算.xlsx", "合同.pdf", "截图.png", "无扩展名", "a.", ".zip"]) {
      expect(isArchiveAttachment(name)).toBe(false);
    }
  });
});
