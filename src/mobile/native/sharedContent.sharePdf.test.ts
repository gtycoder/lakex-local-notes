// @vitest-environment jsdom
/**
 * 261102 T2-C/T2-D：分享 PDF/文件不得静默当图片进小记；PDF 字节读取 helper（分享→自动导入）。
 * 覆盖：① 分类函数（原生 kind 优先，旧 APK 按 mime/后缀兜底）；② 可见提示文案；
 * ③ seed 守卫（只有 image 才读 shared-inbox；pdf 返回 null 但**不删**文件，交给 readSharedContentBytes）；
 * ④ readSharedContentBytes（读成功后才删、读失败/空文件保留、非 pdf/file 不碰）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: {
    readFile: (...args: unknown[]) => mocks.readFile(...args),
    deleteFile: (...args: unknown[]) => mocks.deleteFile(...args),
  },
  Directory: { Data: "DATA" },
}));

import {
  SHARED_FILE_UNSUPPORTED_HINT,
  SHARED_PDF_IMPORT_HINT,
  readSharedContentBytes,
  sharedContentKind,
  sharedContentToSeed,
  sharedContentUnsupportedHint,
  type SharedContent,
} from "./sharedContent";

const base64 = (text: string): string => btoa(text);

beforeEach(() => {
  mocks.readFile.mockReset();
  mocks.deleteFile.mockReset();
  mocks.deleteFile.mockResolvedValue(undefined);
});

describe("分享内容分类（261102 T2-C）", () => {
  it("原生 kind 优先（显式分类，JS 不猜）", () => {
    expect(sharedContentKind({ kind: "pdf", filename: "a.bin", mimeType: "application/octet-stream" })).toBe("pdf");
    expect(sharedContentKind({ kind: "file", imageFilename: "a.png", mimeType: "image/png" })).toBe("file");
    expect(sharedContentKind({ kind: "image", filename: "a.bin" })).toBe("image");
  });

  it("旧 APK 没有 kind：按 mime 兜底（pdf / image / file）", () => {
    // 旧原生只给 imageFilename（uuid.bin）+ mimeType
    expect(sharedContentKind({ imageFilename: "u.bin", mimeType: "application/pdf" })).toBe("pdf");
    expect(sharedContentKind({ imageFilename: "u.bin", mimeType: "image/jpeg" })).toBe("image");
    expect(sharedContentKind({ imageFilename: "u.bin", mimeType: "application/zip" })).toBe("file");
  });

  it("旧 APK + octet-stream：按文件名后缀兜底（.pdf 不再当图片）", () => {
    expect(sharedContentKind({ filename: "讲义.PDF", mimeType: "application/octet-stream" })).toBe("pdf");
    expect(sharedContentKind({ filename: "photo.JPG", mimeType: "application/octet-stream" })).toBe("image");
    expect(sharedContentKind({ filename: "archive.zip", mimeType: "application/octet-stream" })).toBe("file");
    expect(sharedContentKind({})).toBe("file");
  });

  it("pdf/file 给可见提示，image 不给", () => {
    expect(sharedContentUnsupportedHint({ kind: "pdf" })).toBe(SHARED_PDF_IMPORT_HINT);
    expect(sharedContentUnsupportedHint({ kind: "file" })).toBe(SHARED_FILE_UNSUPPORTED_HINT);
    expect(sharedContentUnsupportedHint({ kind: "image" })).toBeNull();
    // 提示里必须指出替代入口（用户知道去哪导入 PDF）
    expect(SHARED_PDF_IMPORT_HINT).toContain("导入 PDF");
  });
});

describe("分享 → 小记 seed 守卫（只有 image 才读字节）", () => {
  it("pdf：不读 shared-inbox、不建小记，且**不删文件**（留给 readSharedContentBytes 消费）", async () => {
    const content: SharedContent = { kind: "pdf", filename: "abc.pdf", mimeType: "application/pdf" };
    await expect(sharedContentToSeed(content)).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("file（旧 APK 无 kind、octet-stream）同样不当图片", async () => {
    const content: SharedContent = { imageFilename: "u.bin", mimeType: "application/octet-stream" };
    await expect(sharedContentToSeed(content)).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.deleteFile).toHaveBeenCalledWith({ path: "shared-inbox/u.bin", directory: "DATA" });
  });

  it("image：读字节进 seed，读完清理临时文件", async () => {
    mocks.readFile.mockResolvedValue({ data: base64("hi") });
    const content: SharedContent = { kind: "image", filename: "pic.png", mimeType: "image/png" };
    const seed = await sharedContentToSeed(content);
    expect(mocks.readFile).toHaveBeenCalledWith({ path: "shared-inbox/pic.png", directory: "DATA" });
    expect(seed?.images).toHaveLength(1);
    expect(seed?.images[0].mimeType).toBe("image/png");
    expect(Array.from(seed!.images[0].bytes)).toEqual([104, 105]);
    expect(mocks.deleteFile).toHaveBeenCalledWith({ path: "shared-inbox/pic.png", directory: "DATA" });
  });

  it("image 读失败：退回纯文本 seed（不抛错）", async () => {
    mocks.readFile.mockRejectedValue(new Error("读不到"));
    const seed = await sharedContentToSeed({ kind: "image", filename: "pic.png", text: "  " });
    expect(seed).toBeNull();
    const seedWithText = await sharedContentToSeed({ kind: "image", filename: "pic.png", text: "说明" });
    expect(seedWithText).toEqual({ text: "说明", images: [] });
  });
});

describe("readSharedContentBytes（分享 PDF/文件 → 字节；读成功后才删）", () => {
  it("pdf：读到字节 → 先读后删，返回 { bytes, filename }", async () => {
    const order: string[] = [];
    mocks.readFile.mockImplementation(async () => { order.push("read"); return { data: base64("PDFBYTES") }; });
    mocks.deleteFile.mockImplementation(async () => { order.push("delete"); });
    const out = await readSharedContentBytes({ kind: "pdf", filename: "abc.pdf", mimeType: "application/pdf" });
    expect(out?.filename).toBe("abc.pdf");
    expect(Array.from(out!.bytes)).toEqual(Array.from(new TextEncoder().encode("PDFBYTES")));
    expect(mocks.readFile).toHaveBeenCalledWith({ path: "shared-inbox/abc.pdf", directory: "DATA" });
    expect(mocks.deleteFile).toHaveBeenCalledWith({ path: "shared-inbox/abc.pdf", directory: "DATA" });
    // 删除时机：**读成功之后**（顺序断言，防以后改成先删后读）
    expect(order).toEqual(["read", "delete"]);
  });

  it("pdf 读失败：返回 null 且**保留**文件（不删，便于排查/重试）", async () => {
    mocks.readFile.mockRejectedValue(new Error("读不到"));
    await expect(readSharedContentBytes({ kind: "pdf", filename: "abc.pdf" })).resolves.toBeNull();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("空文件：返回 null 且保留（不当成有效 PDF 消费掉）", async () => {
    mocks.readFile.mockResolvedValue({ data: "" });
    await expect(readSharedContentBytes({ kind: "pdf", filename: "empty.pdf" })).resolves.toBeNull();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("file：也允许读（同一消费语义），读成功后才删", async () => {
    mocks.readFile.mockResolvedValue({ data: base64("raw") });
    const out = await readSharedContentBytes({ kind: "file", filename: "u.bin" });
    expect(out?.filename).toBe("u.bin");
    expect(mocks.deleteFile).toHaveBeenCalledWith({ path: "shared-inbox/u.bin", directory: "DATA" });
  });

  it("删除失败不影响返回（字节已到手）", async () => {
    mocks.readFile.mockResolvedValue({ data: base64("ok") });
    mocks.deleteFile.mockRejectedValue(new Error("删不掉"));
    const out = await readSharedContentBytes({ kind: "pdf", filename: "a.pdf" });
    expect(Array.from(out!.bytes)).toEqual(Array.from(new TextEncoder().encode("ok")));
  });

  it("image / 纯文本 / 无文件名：返回 null 且完全不碰 shared-inbox", async () => {
    await expect(readSharedContentBytes({ kind: "image", filename: "pic.png" })).resolves.toBeNull();
    await expect(readSharedContentBytes({ text: "只有文字" })).resolves.toBeNull();
    await expect(readSharedContentBytes({ kind: "pdf" })).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
