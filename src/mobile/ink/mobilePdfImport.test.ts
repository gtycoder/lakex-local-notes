/**
 * 移动端 PDF 导入适配器（mobilePdfImport.ts）纯逻辑测试。
 *
 * 覆盖：插件页尺寸映射（逻辑尺寸 vs 位图像素）、分享文件名 → 标题、默认笔记本选择、
 * 分享编排（createInk → importIntoNote → 成功返回 / 失败 trash 回滚）。
 * 分享编排用注入 deps，不碰真实 bridge/文件系统。
 */
import { describe, expect, it, vi } from "vitest";
import { createInkDoc } from "../../core/inkDoc";
import type { PdfImportOutcome } from "../../features/ink/pdfImport";
import {
  importSharedPdfAsInkNote,
  pdfPageSizes,
  sharedPdfImportToast,
  sharedPdfNotebookId,
  sharedPdfTitle,
  type SharedPdfImportDeps,
} from "./mobilePdfImport";

function pageOutcome(pages = 1): PdfImportOutcome {
  const page = createInkDoc("p").pages[0];
  return {
    pages: Array.from({ length: pages }, (_, index) => ({ ...page, id: "imp-" + index })),
    sourcePdf: { name: "讲义.pdf", pageCount: pages },
    pageCount: pages,
    importedPageCount: pages,
    truncated: false,
    cancelled: false,
    errors: [],
  };
}

function makeDeps(overrides: Partial<SharedPdfImportDeps> = {}) {
  const createInk = vi.fn(async (_title: string, parentId: string | null) => ({ id: "note-1", parentId }));
  const importIntoNote = vi.fn(async () => pageOutcome(2));
  const trashNote = vi.fn(async () => undefined);
  const resolveNotebookId = vi.fn(async () => "nb-1");
  const deps: SharedPdfImportDeps = { createInk, importIntoNote, trashNote, resolveNotebookId, ...overrides };
  return { deps, createInk, importIntoNote, trashNote, resolveNotebookId };
}

describe("pdfPageSizes（插件页 → 导入页尺寸）", () => {
  it("逻辑尺寸用 width/height，位图尺寸用 pixelWidth/pixelHeight", () => {
    expect(pdfPageSizes({ width: 794, height: 1123, pixelWidth: 1600, pixelHeight: 2264 })).toEqual({
      width: 794,
      height: 1123,
      pixelWidth: 1600,
      pixelHeight: 2264,
    });
  });

  it("旧 APK 没有 pixel 字段：回落 width/height（不把 width 当像素）", () => {
    expect(pdfPageSizes({ width: 595, height: 842 })).toEqual({ width: 595, height: 842, pixelWidth: 595, pixelHeight: 842 });
  });
});

describe("sharedPdfTitle（文件名 → 标题）", () => {
  it("去 .pdf 扩展名、去路径、去首尾空白；空则给默认标题", () => {
    expect(sharedPdfTitle("讲义.pdf")).toBe("讲义");
    expect(sharedPdfTitle("A.PDF")).toBe("A");
    expect(sharedPdfTitle("/downloads/期末 复习.pdf")).toBe("期末 复习");
    expect(sharedPdfTitle("  report.Pdf  ")).toBe("report");
    expect(sharedPdfTitle("")).toBe("导入的 PDF");
    expect(sharedPdfTitle(".pdf")).toBe("导入的 PDF");
  });
});

describe("sharedPdfNotebookId（默认笔记本）", () => {
  it("优先 notebook-personal；否则第一个 nodeType=notebook；都没有返回 null", () => {
    expect(sharedPdfNotebookId([
      { id: "nb-other", nodeType: "notebook" },
      { id: "notebook-personal", nodeType: "notebook" },
    ])).toBe("notebook-personal");
    expect(sharedPdfNotebookId([{ id: "nb-2", nodeType: "notebook" }])).toBe("nb-2");
    expect(sharedPdfNotebookId([{ id: "note-1", nodeType: "note" }])).toBeNull();
    expect(sharedPdfNotebookId([])).toBeNull();
    expect(sharedPdfNotebookId(null)).toBeNull();
  });
});

describe("importSharedPdfAsInkNote（分享 → 新建手写板并导入）", () => {
  it("成功：先建空手写板（标题派生、默认笔记本），再把字节交给导入，返回新文档路由参数", async () => {
    const { deps, createInk, importIntoNote, trashNote, resolveNotebookId } = makeDeps();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await importSharedPdfAsInkNote({ bytes, filename: "讲义.pdf" }, deps);
    expect(resolveNotebookId).toHaveBeenCalledTimes(1);
    expect(createInk).toHaveBeenCalledWith("讲义", "nb-1");
    expect(importIntoNote).toHaveBeenCalledWith(expect.objectContaining({ noteId: "note-1", bytes, filename: "讲义.pdf" }));
    expect(result).toEqual({
      noteId: "note-1",
      notebookId: "nb-1",
      title: "讲义",
      pageCount: 2,
      importedPageCount: 2,
      truncated: false,
      errors: [],
    });
    expect(trashNote).not.toHaveBeenCalled();
  });

  it("导入失败（页面为空/加密）：抛可见错误并把刚建的空文档移入回收站", async () => {
    const failure = { ...pageOutcome(0), errors: ["PDF 已加密，暂不支持导入受密码保护的 PDF"] };
    const { deps, createInk, trashNote } = makeDeps({ importIntoNote: vi.fn(async () => failure) });
    await expect(importSharedPdfAsInkNote({ bytes: new Uint8Array([1]), filename: "a.pdf" }, deps)).rejects.toThrow("已加密");
    expect(createInk).toHaveBeenCalledTimes(1);
    expect(trashNote).toHaveBeenCalledWith("note-1");
  });

  it("取消：同样回滚（不留空文档）", async () => {
    const cancelled = { ...pageOutcome(0), cancelled: true };
    const { deps, trashNote } = makeDeps({ importIntoNote: vi.fn(async () => cancelled) });
    await expect(importSharedPdfAsInkNote({ bytes: new Uint8Array([1]), filename: "a.pdf" }, deps)).rejects.toThrow("已取消");
    expect(trashNote).toHaveBeenCalledWith("note-1");
  });

  it("连建文档都失败：直接抛，不调用 trash（没有可回收的文档）", async () => {
    const { deps, trashNote } = makeDeps({ createInk: vi.fn(async () => { throw new Error("建库失败"); }) });
    await expect(importSharedPdfAsInkNote({ bytes: new Uint8Array([1]), filename: "a.pdf" }, deps)).rejects.toThrow("建库失败");
    expect(trashNote).not.toHaveBeenCalled();
  });

  it("note.parentId 为空时 notebookId 回落到 resolve 结果（路由一定有 notebookId）", async () => {
    const { deps } = makeDeps({ createInk: vi.fn(async () => ({ id: "note-2", parentId: null })) });
    const result = await importSharedPdfAsInkNote({ bytes: new Uint8Array([1]), filename: "a.pdf" }, deps);
    expect(result.notebookId).toBe("nb-1");
  });

  it("截断 / 部分页失败：结果带上 importedPageCount、pageCount、truncated、errors（不再只返回成功页数）", async () => {
    const outcome = {
      ...pageOutcome(3),
      pageCount: 320,
      importedPageCount: 3,
      truncated: true,
      errors: ["第 4 页：图片编码失败"],
    };
    const { deps } = makeDeps({ importIntoNote: vi.fn(async () => outcome) });
    const result = await importSharedPdfAsInkNote({ bytes: new Uint8Array([1]), filename: "a.pdf" }, deps);
    expect(result).toMatchObject({
      pageCount: 320,
      importedPageCount: 3,
      truncated: true,
      errors: ["第 4 页：图片编码失败"],
    });
  });
});

describe("sharedPdfImportToast（一句话说清 成功 / 截断 / 部分失败）", () => {
  const base = { pageCount: 5, importedPageCount: 5, truncated: false, errors: [] as string[] };

  it("全部成功：已导入 N 页 PDF", () => {
    expect(sharedPdfImportToast(base)).toBe("已导入 5 页 PDF");
  });

  it("截断：PDF 共 M 页，仅导入前 N 页（上限 300 页）", () => {
    expect(sharedPdfImportToast({ pageCount: 320, importedPageCount: 300, truncated: true, errors: [] }))
      .toBe("PDF 共 320 页，仅导入前 300 页（上限 300 页）");
  });

  it("部分页失败：N 页导入成功，K 页失败（第一页失败原因：…）", () => {
    expect(sharedPdfImportToast({
      pageCount: 5,
      importedPageCount: 3,
      truncated: false,
      errors: ["第 2 页：图片编码失败", "第 4 页：上传失败"],
    })).toBe("3 页导入成功，2 页失败（第一页失败原因：图片编码失败）");
  });

  it("截断 + 部分失败：两段用「；」连成一句话（只弹一个 toast）", () => {
    expect(sharedPdfImportToast({
      pageCount: 320,
      importedPageCount: 300,
      truncated: true,
      errors: ["第 2 页：上传失败"],
    })).toBe("PDF 共 320 页，仅导入前 300 页（上限 300 页）；300 页导入成功，1 页失败（第一页失败原因：上传失败）");
    // 一句话：不含换行 / 不弹多条
    expect(sharedPdfImportToast({ pageCount: 320, importedPageCount: 300, truncated: true, errors: ["x"] })).not.toContain("\n");
  });

  it("失败原因为空/过长：兜底「未知原因」、超长截断加省略号", () => {
    expect(sharedPdfImportToast({ pageCount: 2, importedPageCount: 1, truncated: false, errors: [""] }))
      .toBe("1 页导入成功，1 页失败（第一页失败原因：未知原因）");
    const long = "x".repeat(120);
    const text = sharedPdfImportToast({ pageCount: 2, importedPageCount: 1, truncated: false, errors: [long] });
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(160);
  });
});
