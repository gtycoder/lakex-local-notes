// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { uploadBitableAttachments } from "./mobileBitableAttachments";

function fileOf(name: string, body: string): File {
  return new File([body], name, { type: "application/octet-stream" });
}

describe("uploadBitableAttachments（表单附件上传映射）", () => {
  it("url 里的磁盘名 → file；原始文件名 → name；size 取上传结果", async () => {
    const upload = vi.fn(async ({ filename }: { filename: string }) => ({
      url: "http://127.0.0.1:19876/n1/1790700946314_ab12cd34.pdf",
      filename,
      size: 42,
    }));
    const out = await uploadBitableAttachments([fileOf("复盘笔记.pdf", "x")], upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ file: "1790700946314_ab12cd34.pdf", name: "复盘笔记.pdf", size: 42 }]);
  });

  it("url 解析不出磁盘名时回落上传结果的 filename；空文件名回落磁盘名；size 非法回落字节数", async () => {
    const out = await uploadBitableAttachments([fileOf("   ", "abc")], async ({ filename }) => ({
      url: "not-a-local-asset-url",
      filename,
      size: -1,
    }));
    expect(out[0].file).toBe("   ");
    expect(out[0].name).toBe("   ");
    expect(out[0].size).toBe(3);
  });

  it("多文件按顺序逐个上传；任一失败整体抛出（调用方不落半截）", async () => {
    const calls: string[] = [];
    const upload = async ({ filename }: { filename: string }) => {
      calls.push(filename);
      if (filename === "b.pdf") throw new Error("磁盘满");
      return { url: "http://127.0.0.1:19876/n1/" + filename, filename, size: 1 };
    };
    await expect(uploadBitableAttachments([fileOf("a.pdf", "1"), fileOf("b.pdf", "2"), fileOf("c.pdf", "3")], upload))
      .rejects.toThrow("磁盘满");
    expect(calls).toEqual(["a.pdf", "b.pdf"]);
  });
});
