// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { convertHtmlToLake } from "./htmlImportPipeline";
import type { MarkdownKernelHandle } from "./markdownImportPipeline";

function stubKernel(onSet: (type: string, content: string) => void) {
  let lake = "";
  const kernel = {
    setDocument(type: string, content: string) {
      onSet(type, content);
      lake = '<p data-lake-id="x">' + (content.includes("图片") ? "已导入" : "正文") + "</p>";
    },
    getDocument() { return lake; },
  };
  const handle: MarkdownKernelHandle = { kernel, dispose: () => undefined };
  return handle;
}

describe("261108 Word(HTML) → lake 导入管线", () => {
  it("上传 data 图片为资产 URL，再交给内核 setDocument('text/html')", async () => {
    const seen: Array<{ type: string; content: string }> = [];
    const images: Array<{ mimeType: string; filename: string; bytes: number }> = [];
    const result = await convertHtmlToLake({
      html: '<h1>标题</h1><p>正文</p><img src="data:image/png;base64,AAAA">',
      uploadDataImage: async (image) => {
        images.push({ mimeType: image.mimeType, filename: image.filename, bytes: image.bytes.byteLength });
        return "http://127.0.0.1:19876/n/word-image-1.png";
      },
      createKernel: () => stubKernel((type, content) => seen.push({ type, content })),
      renderTimeoutMs: 500,
    });
    expect(result.body).toContain("data-lake-id");
    expect(result.imageCount).toBe(1);
    expect(images[0]).toMatchObject({ mimeType: "image/png", filename: "word-image-1.png" });
    expect(seen[0].type).toBe("text/html");
    expect(seen[0].content).toContain("http://127.0.0.1:19876/n/word-image-1.png");
    expect(seen[0].content).not.toContain("base64");
  });

  it("空内容不启内核（返回空正文 + 告警）", async () => {
    const result = await convertHtmlToLake({ html: "<p> </p>", warnings: ["mammoth: 未识别"] });
    expect(result.body).toBe("");
    expect(result.warnings).toContain("Word 内容为空，已生成空文档");
  });
});