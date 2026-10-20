import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FILE_BADGE_MIN_SIZE, FileBadgeIcon, badgeLabelOf } from "./FileBadgeIcon";
import { FileKindIcon } from "./FileKindIcon";

const markup = (name: string, size: number) =>
  renderToStaticMarkup(createElement(FileKindIcon, { name, size }));

describe("附件类型图标（261020：按尺寸分两种画法）", () => {
  it("小尺寸走线性图标：没有文字、仍带类型色类名", () => {
    const svg = markup("报告.docx", 18);
    expect(svg).toContain("bt-file-icon--doc");
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("DOCX");
  });

  it("大尺寸（≥28px）换成纸页 + 扩展名，扩展名直接用文件名里的扩展名", () => {
    const svg = markup("报告.docx", FILE_BADGE_MIN_SIZE);
    expect(svg).toContain("bt-file-badge");
    expect(svg).toContain(">DOCX<");
    expect(svg).toContain("bt-file-icon--doc");
    expect(markup("a.xlsx", 46)).toContain(">XLSX<");
    expect(markup("b.PDF", 46)).toContain(">PDF<");
  });

  it("边界：27px 仍是线性图标，28px 才是纸页", () => {
    expect(markup("a.pdf", 27)).not.toContain("<text");
    expect(markup("a.pdf", 28)).toContain(">PDF<");
  });

  it("没有可用扩展名 / 扩展名过长 / 非字母数字 ⇒ 回落类型标签", () => {
    expect(badgeLabelOf("无扩展名文件")).toBe("FILE");
    expect(badgeLabelOf("a.verylongext")).toBe("FILE");
    expect(badgeLabelOf("b.png")).toBe("PNG");
    expect(badgeLabelOf("c.tar.gz")).toBe("GZ");
    const svg = renderToStaticMarkup(createElement(FileBadgeIcon, { name: "无扩展名文件", size: 46 }));
    expect(svg).toContain(">FILE<");
  });

  it("图片/代码类同样按扩展名显示（IMG 不再需要靠猜）", () => {
    expect(badgeLabelOf("photo.jpeg")).toBe("JPEG");
    expect(badgeLabelOf("index.tsx")).toBe("TSX");
    expect(markup("photo.jpeg", 46)).toContain(">JPEG<");
  });
});
