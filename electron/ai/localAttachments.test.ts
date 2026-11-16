import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ extractPdfText: vi.fn() }));
vi.mock("./pdfText.js", () => ({ extractPdfText: h.extractPdfText }));

const {
  AI_PASTED_IMAGE_MAX_AGE_MS,
  cleanupPastedImages,
  configurePastedImageDir,
  localAttachmentImageSource,
  localAttachmentKindOf,
  pdfAttachmentErrorMessage,
  readRegisteredLocalFile,
  registerPickedLocalFile,
  resetLocalAttachmentRegistryForTest,
  resetPastedImageDirForTest,
  savePastedImage,
} = await import("./localAttachments.js");

const dirs: string[] = [];
function tempFile(name: string, content: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-local-att-"));
  dirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

beforeEach(() => { h.extractPdfText.mockReset(); });
afterEach(() => {
  resetLocalAttachmentRegistryForTest();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("本机文件附件注册表（261116 Phase 2）", () => {
  it("扩展名判据：图片 / 文本代码 / PDF / 其它", () => {
    expect(localAttachmentKindOf("a.PNG")).toBe("image");
    expect(localAttachmentKindOf("main.ts")).toBe("text");
    expect(localAttachmentKindOf("doc.pdf")).toBe("pdf");
    expect(localAttachmentKindOf("noext")).toBe("unsupported");
  });

  it("普通文件登记后只回引用与元数据；token 能读回字节（路径不出注册表）", async () => {
    const file = tempFile("main.ts", "export const x = 1;\n");
    const picked = (await registerPickedLocalFile(file))!;
    expect(picked.kind).toBe("text");
    expect(picked.ref.name).toBe("main.ts");
    expect(picked.ref.token).toMatch(/^loc-/);
    expect(JSON.stringify(picked.ref)).not.toContain(os.tmpdir());
    expect(readRegisteredLocalFile(picked.ref)!.bytes.toString("utf8")).toContain("export const x");
  });

  it("PDF 选择时解析一次：ref 带页数、注册表缓存文本（发送复用不再解析）", async () => {
    h.extractPdfText.mockResolvedValue({ text: "PDF 正文内容", pages: 4, truncated: false });
    const file = tempFile("report.pdf", "%PDF-1.4 fake");
    const picked = (await registerPickedLocalFile(file))!;
    expect(picked.kind).toBe("pdf");
    expect(picked.ref.pages).toBe(4);
    const read = readRegisteredLocalFile(picked.ref)!;
    expect(read.pdf).toEqual({ text: "PDF 正文内容", pages: 4, truncated: false });
    expect(h.extractPdfText).toHaveBeenCalledTimes(1);
  });

  it("PDF 扫描件/加密/坏文件 → 可执行中文错误（不静默跳过）", async () => {
    h.extractPdfText.mockRejectedValue(new Error("PDF 里没有可提取的文字（可能是扫描件）"));
    await expect(registerPickedLocalFile(tempFile("scan.pdf", "%PDF"))).rejects.toThrow(/PDF 解析失败：scan\.pdf（没有可提取文字（可能是扫描件））/);

    h.extractPdfText.mockRejectedValue(new Error("PasswordException: password required"));
    await expect(registerPickedLocalFile(tempFile("locked.pdf", "%PDF"))).rejects.toThrow(/文件已加密（需要密码）/);

    h.extractPdfText.mockRejectedValue(new Error("InvalidPDFException: bad xref"));
    await expect(registerPickedLocalFile(tempFile("broken.pdf", "%PDF"))).rejects.toThrow(/文件损坏或不是有效的 PDF/);
  });

  it("pdfAttachmentErrorMessage 不吞原分类", () => {
    expect(pdfAttachmentErrorMessage("a.pdf", new Error("读取 PDF 超时"))).toContain("解析超时");
    expect(pdfAttachmentErrorMessage("a.pdf", new Error("PDF 文件过大（上限 32MB）"))).toContain("文件超过解析上限");
  });

  it("空文件/目录/不存在的路径 → null（不登记坏引用）", async () => {
    expect(await registerPickedLocalFile(tempFile("empty.txt", ""))).toBeNull();
    expect(await registerPickedLocalFile(os.tmpdir())).toBeNull();
    expect(await registerPickedLocalFile(path.join(os.tmpdir(), "definitely-missing-" + Date.now()))).toBeNull();
  });

  it("重启语义：不存在的 token → 读不到（resolver 会报「附件已失效」）", () => {
    expect(readRegisteredLocalFile({ kind: "local", token: "loc-missing", name: "x.txt", size: 1, mimeType: "text/plain" })).toBeNull();
  });
});


describe("粘贴图片（261116 用户需求）", () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  let dir = "";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-paste-"));
    configurePastedImageDir(dir);
  });
  afterEach(() => {
    resetPastedImageDirForTest();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("写盘到 <dir>/paste-<uuid>.<ext> 并回引用；非图片/过大/空拒绝", () => {
    const ref = savePastedImage({ bytes: PNG, mimeType: "image/png", name: "截图.png" });
    expect(ref.kind).toBe("local");
    expect(ref.token.startsWith("paste-")).toBe(true);
    expect(ref.token.endsWith(".png")).toBe(true);
    expect(fs.existsSync(path.join(dir, ref.token.slice("paste-".length)))).toBe(true);
    expect(ref.size).toBe(PNG.length);
    expect(() => savePastedImage({ bytes: PNG, mimeType: "text/plain" })).toThrow(/不支持的粘贴类型/);
    expect(() => savePastedImage({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1), mimeType: "image/png" })).toThrow(/粘贴图片过大/);
    expect(() => savePastedImage({ bytes: Buffer.alloc(0), mimeType: "image/png" })).toThrow(/为空/);
  });

  it("重启回落：清空注册表后，读取与预览仍能按 token 读盘", () => {
    const ref = savePastedImage({ bytes: PNG, mimeType: "image/png", name: "截图.png" });
    resetLocalAttachmentRegistryForTest(); // 模拟应用重启（进程内存注册表清空）
    const read = readRegisteredLocalFile(ref)!;
    expect(read.bytes.equals(PNG)).toBe(true);
    expect(read.name).toBe("截图.png");
    const preview = localAttachmentImageSource(ref.token)!;
    expect(preview.mimeType).toBe("image/png");
    expect(fs.existsSync(preview.path)).toBe(true);
    // 非 paste token 保持现状：重启后失效
    expect(readRegisteredLocalFile({ kind: "local", token: "loc-dead", name: "x.png", size: 1, mimeType: "image/png" })).toBeNull();
  });

  it("启动清理：只删「无引用且超过 7 天」的粘贴图", () => {
    const oldRef = savePastedImage({ bytes: PNG, mimeType: "image/png", name: "old.png" });
    const oldFile = path.join(dir, oldRef.token.slice("paste-".length));
    const oldTime = new Date(Date.now() - AI_PASTED_IMAGE_MAX_AGE_MS - 1000);
    fs.utimesSync(oldFile, oldTime, oldTime);
    const keptRef = savePastedImage({ bytes: PNG, mimeType: "image/png", name: "kept.png" });
    const recentRef = savePastedImage({ bytes: PNG, mimeType: "image/png", name: "recent.png" });
    const removed = cleanupPastedImages(new Set([keptRef.token]));
    expect(removed).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(path.join(dir, keptRef.token.slice("paste-".length)))).toBe(true); // 有引用：保留（即使旧）
    expect(fs.existsSync(path.join(dir, recentRef.token.slice("paste-".length)))).toBe(true); // 未过期：保留
  });
});
