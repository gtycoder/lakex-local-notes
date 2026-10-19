import { describe, expect, it } from "vitest";
import { collectMarkdownImageSources, markdownToDocx, parseMarkdownInline } from "./docx.js";

function unzipStored(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    out.set(name, bytes.slice(start, start + size));
    offset = start + size;
  }
  return out;
}

function xml(files: Map<string, Uint8Array>, name: string): string {
  const bytes = files.get(name);
  if (!bytes) throw new Error("missing entry " + name);
  return new TextDecoder().decode(bytes);
}

const png1x1 = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

describe("Word（DOCX）写入器", () => {
  it("结构块：标题 / 段落 / 粗斜体 / 列表 / 引用 / 代码 / 表格 / 分隔线 / 链接", () => {
    const markdown = [
      "# 标题一",
      "",
      "普通段落，含 **粗体**、*斜体*、~~删除~~、`行内代码` 与 [链接](https://example.com/a?x=1&y=2)。",
      "",
      "- 项目 A",
      "  - 项目 A-1",
      "",
      "1. 第一步",
      "2. 第二步",
      "",
      "另一段：",
      "",
      "1. 另起一段第一步",
      "2. 另起一段第二步",
      "",
      "> 引用内容",
      "",
      "```",
      "const a = 1;",
      "```",
      "",
      "| 姓名 | 分数 |",
      "| --- | --- |",
      "| 小明 | 95 |",
      "",
      "---",
    ].join("\n");
    const result = markdownToDocx(markdown);
    const files = unzipStored(result.bytes);
    const document = xml(files, "word/document.xml");
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain("<w:b/>");
    expect(document).toContain("<w:i/>");
    expect(document).toContain("<w:strike/>");
    expect(document).toContain('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'); // 行内代码 / 代码块
    expect(document).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    expect(document).toContain('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>');
    expect(document).toContain('<w:numId w:val="2"/>');
    expect(document).toContain('<w:numId w:val="3"/>'); // 第二段有序列表独立 numId（从 1 重新编号）
    expect(document).toContain('<w:pStyle w:val="Quote"/>');
    expect(document).toContain("<w:tbl>");
    expect(document).toContain("<w:tblGrid>"); // OOXML 要求；缺了 Word 会报“需要修复”
    expect(document).toContain("姓名");
    expect(document).toContain("小明");
    expect(result.linkCount).toBe(1);
    expect(xml(files, "word/_rels/document.xml.rels")).toContain('Target="https://example.com/a?x=1&amp;y=2" TargetMode="External"');
    expect(xml(files, "word/styles.xml")).toContain('w:styleId="Heading1"');
    const numbering = xml(files, "word/numbering.xml");
    expect(numbering).toContain('w:numId="2"');
    expect(numbering).toContain('w:numId="3"');
    expect(numbering).toContain("<w:startOverride w:val=\"1\"/>");
  });

  it("图片：解析到的内嵌进 media + drawing；解析不到的降级为 [图片] 并计入 skipped", () => {
    const markdown = "![示意图](http://127.0.0.1:19876/n1/a.png)\n\n![远程图](https://example.com/b.png)";
    const result = markdownToDocx(markdown, (src) => (src.endsWith("/a.png") ? { bytes: png1x1, extension: "png", width: 1, height: 1 } : null));
    expect(result.imageCount).toBe(1);
    expect(result.skippedImages).toBe(1);
    const files = unzipStored(result.bytes);
    expect(files.has("word/media/image1.png")).toBe(true);
    const document = xml(files, "word/document.xml");
    expect(document).toContain('<a:blip r:embed="rIdImg1"/>');
    expect(document).toContain("[图片]"); // 远程图降级为文字，不静默消失
    expect(xml(files, "word/_rels/document.xml.rels")).toContain('Target="media/image1.png"');
  });

  it("XML 转义 + 图片源提取 + 行内解析", () => {
    const result = markdownToDocx("a & b < c > d \" e ' f");
    expect(xml(unzipStored(result.bytes), "word/document.xml")).toContain("a &amp; b &lt; c &gt; d &quot; e &apos; f");
    expect(collectMarkdownImageSources("![a](u1) 文本 ![b](u2) ![a](u1)")).toEqual(["u1", "u2"]);
    const nodes = parseMarkdownInline("**粗** 和 *斜*");
    expect(nodes.map((node) => node.type)).toEqual(["bold", "text", "italic"]);
  });
});
