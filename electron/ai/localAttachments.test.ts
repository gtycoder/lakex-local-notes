import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ extractPdfText: vi.fn(), AI_PDF_MAX_BYTES: 32 * 1024 * 1024 }));
// 限额常量也走 mock：本模块要 import AI_PDF_MAX_BYTES（P0-1 先 stat 判限额），漏了它会整体 mock 失败。
vi.mock("./pdfText.js", () => ({ extractPdfText: h.extractPdfText, AI_PDF_MAX_BYTES: h.AI_PDF_MAX_BYTES }));

const {
  AI_PASTED_IMAGE_MAX_AGE_MS,
  cleanupPastedImages,
  configurePastedImageDir,
  heicConversionHint,
  localAttachmentImageSource,
  localAttachmentKindOf,
  pdfAttachmentErrorMessage,
  readRegisteredLocalFile,
  registerPickedLocalFile,
  registeredLocalFileReader,
  resetLocalAttachmentRegistryForTest,
  resetPastedImageDirForTest,
  savePastedImage,
  statRegisteredLocalFile,
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

  it("P0-2：HEIC/HEIF 不算图片（主进程解不了），并给「先转 JPEG/PNG」的出口", () => {
    // 与 core/assetNaming 的 MIME 表同一裁决；sharp 的 heif 输入只支持 avif（实测）。
    expect(localAttachmentKindOf("IMG_0001.HEIC")).toBe("unsupported");
    expect(localAttachmentKindOf("IMG_0001.heif")).toBe("unsupported");
    expect(heicConversionHint("IMG_0001.HEIC")).toMatch(/请先转换为 JPEG 或 PNG/);
    expect(heicConversionHint("shot.png")).toBeNull();
  });

  it("普通文件登记后只回引用与元数据；token 能读回字节（路径不出注册表）", async () => {
    const file = tempFile("main.ts", "export const x = 1;\n");
    const picked = (await registerPickedLocalFile(file))!;
    expect(picked.kind).toBe("text");
    expect(picked.ref.name).toBe("main.ts");
    expect(picked.ref.token).toMatch(/^loc-/);
    expect(JSON.stringify(picked.ref)).not.toContain(os.tmpdir());
    expect((await readRegisteredLocalFile(picked.ref))!.toString("utf8")).toContain("export const x");
  });

  it("PDF 选择时解析一次：ref 带页数、注册表缓存文本（发送复用不再解析）", async () => {
    h.extractPdfText.mockResolvedValue({ text: "PDF 正文内容", pages: 4, truncated: false });
    const file = tempFile("report.pdf", "%PDF-1.4 fake");
    const picked = (await registerPickedLocalFile(file))!;
    expect(picked.kind).toBe("pdf");
    expect(picked.ref.pages).toBe(4);
    const stat = statRegisteredLocalFile(picked.ref)!;
    expect(stat.pdf).toEqual({ text: "PDF 正文内容", pages: 4, truncated: false });
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

  it("P0-1：选 PDF 时先按 32MB 限额拒绝（**不读盘**），不让超大文件先进内存", async () => {
    h.extractPdfText.mockClear();
    // 稀疏文件：33MB 但不真占磁盘
    const file = tempFile("huge.pdf", "%PDF");
    fs.truncateSync(file, 32 * 1024 * 1024 + 1);
    const readSpy = vi.spyOn(fs.promises, "readFile");
    try {
      await expect(registerPickedLocalFile(file)).rejects.toThrow(/PDF 文件过大：huge\.pdf（上限 32MB）/);
      expect(readSpy, "超限必须在读字节之前拒绝").not.toHaveBeenCalled();
      expect(h.extractPdfText).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });

  it("空文件/目录/不存在的路径 → null（不登记坏引用）", async () => {
    expect(await registerPickedLocalFile(tempFile("empty.txt", ""))).toBeNull();
    expect(await registerPickedLocalFile(os.tmpdir())).toBeNull();
    expect(await registerPickedLocalFile(path.join(os.tmpdir(), "definitely-missing-" + Date.now()))).toBeNull();
  });

  it("重启语义：不存在的 token → 读不到（resolver 会报「附件已失效」）", async () => {
    expect(await readRegisteredLocalFile({ kind: "local", token: "loc-missing", name: "x.txt", size: 1, mimeType: "text/plain" })).toBeNull();
    expect(statRegisteredLocalFile({ kind: "local", token: "loc-missing", name: "x.txt", size: 1, mimeType: "text/plain" })).toBeNull();
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

  it("写盘到 <dir>/paste-<uuid>.<ext> 并回引用；非图片/过大/空拒绝", async () => {
    const ref = await savePastedImage({ bytes: PNG, mimeType: "image/png", name: "截图.png" });
    expect(ref.kind).toBe("local");
    expect(ref.token.startsWith("paste-")).toBe(true);
    expect(ref.token.endsWith(".png")).toBe(true);
    expect(fs.existsSync(path.join(dir, ref.token.slice("paste-".length)))).toBe(true);
    expect(ref.size).toBe(PNG.length);
    await expect(savePastedImage({ bytes: PNG, mimeType: "text/plain" })).rejects.toThrow(/不支持的粘贴类型/);
    await expect(savePastedImage({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1), mimeType: "image/png" })).rejects.toThrow(/粘贴图片过大/);
    await expect(savePastedImage({ bytes: Buffer.alloc(0), mimeType: "image/png" })).rejects.toThrow(/为空/);
    // P0-2：HEIC 粘贴也给「先转换」的出口，不是只报不支持
    await expect(savePastedImage({ bytes: PNG, mimeType: "image/heic" })).rejects.toThrow(/HEIC\/HEIF 请先转换为 JPEG\/PNG/);
  });

  it("P0-1：并发粘贴（8 张）全部落盘、无 .tmp 残留（异步写盘不串名/不半成品）", async () => {
    const refs = await Promise.all(Array.from({ length: 8 }, (_, i) => savePastedImage({ bytes: PNG, mimeType: "image/png", name: "shot" + i + ".png" })));
    expect(new Set(refs.map((ref) => ref.token)).size).toBe(8);
    for (const ref of refs) expect(fs.existsSync(path.join(dir, ref.token.slice("paste-".length)))).toBe(true);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")), "并发写不应留下 .tmp").toEqual([]);
    // 每张都能读回（stat + 异步读）
    expect((await readRegisteredLocalFile(refs[0]))!.equals(PNG)).toBe(true);
    expect(statRegisteredLocalFile(refs[0])!.size).toBe(PNG.length);
  });

  it("P0-1：写盘失败时清掉半成品 .tmp（rename 失败路径）", async () => {
    const original = fs.promises.rename;
    const spy = vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(Object.assign(new Error("EXDEV"), { code: "EXDEV" }));
    try {
      await expect(savePastedImage({ bytes: PNG, mimeType: "image/png", name: "x.png" })).rejects.toThrow(/写盘失败（磁盘空间或权限）/);
    } finally {
      spy.mockRestore();
    }
    expect(original).toBe(fs.promises.rename);
    expect(fs.readdirSync(dir), "失败后不应留下 .tmp 或半成品").toEqual([]);
  });

  it("重启回落：清空注册表后，stat/read 与预览仍能按 token 读盘", async () => {
    const ref = await savePastedImage({ bytes: PNG, mimeType: "image/png", name: "截图.png" });
    resetLocalAttachmentRegistryForTest(); // 模拟应用重启（进程内存注册表清空）
    expect((await readRegisteredLocalFile(ref))!.equals(PNG)).toBe(true);
    expect(statRegisteredLocalFile(ref)!.name).toBe("截图.png");
    const preview = localAttachmentImageSource(ref.token)!;
    expect(preview.mimeType).toBe("image/png");
    expect(fs.existsSync(preview.path)).toBe(true);
    // 非 paste token 保持现状：重启后失效
    expect(await readRegisteredLocalFile({ kind: "local", token: "loc-dead", name: "x.png", size: 1, mimeType: "image/png" })).toBeNull();
  });

  it("启动清理：只删「无引用且超过 7 天」的粘贴图", async () => {
    const oldRef = await savePastedImage({ bytes: PNG, mimeType: "image/png", name: "old.png" });
    const oldFile = path.join(dir, oldRef.token.slice("paste-".length));
    const oldTime = new Date(Date.now() - AI_PASTED_IMAGE_MAX_AGE_MS - 1000);
    fs.utimesSync(oldFile, oldTime, oldTime);
    const keptRef = await savePastedImage({ bytes: PNG, mimeType: "image/png", name: "kept.png" });
    const recentRef = await savePastedImage({ bytes: PNG, mimeType: "image/png", name: "recent.png" });
    const removed = cleanupPastedImages(new Set([keptRef.token]));
    expect(removed).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(path.join(dir, keptRef.token.slice("paste-".length)))).toBe(true); // 有引用：保留（即使旧）
    expect(fs.existsSync(path.join(dir, recentRef.token.slice("paste-".length)))).toBe(true); // 未过期：保留
  });

  it("启动清理：老化的 .tmp 半成品也回收（写盘中断残留不会永久堆积）", async () => {
    const staleTmp = path.join(dir, "11111111-1111-1111-1111-111111111111.png.tmp");
    fs.writeFileSync(staleTmp, "half");
    const oldTime = new Date(Date.now() - AI_PASTED_IMAGE_MAX_AGE_MS - 1000);
    fs.utimesSync(staleTmp, oldTime, oldTime);
    const freshTmp = path.join(dir, "22222222-2222-2222-2222-222222222222.png.tmp");
    fs.writeFileSync(freshTmp, "half");
    cleanupPastedImages(new Set());
    expect(fs.existsSync(staleTmp)).toBe(false);
    expect(fs.existsSync(freshTmp)).toBe(true);
  });

  it("registeredLocalFileReader：与具名导出等价（IPC 装配用的就是这个对象）", async () => {
    const ref = await savePastedImage({ bytes: PNG, mimeType: "image/png", name: "r.png" });
    expect(registeredLocalFileReader.statLocalFile(ref)).toEqual(statRegisteredLocalFile(ref));
    expect((await registeredLocalFileReader.readLocalFile(ref))!.equals(PNG)).toBe(true);
  });
});
