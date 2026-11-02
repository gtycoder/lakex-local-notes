// @vitest-environment jsdom
/**
 * PDF 导入两端入口 / 进度 / 取消 / 错误的渲染行为（InkPad 共用；宿主注入 onImportPdf）。
 *
 * 覆盖：移动端入口在编辑态工具坞「插入」菜单（旧全局预览入口已移除）；阅读态没有入口；导入中显示「第 n/N 页」+ 取消；
 * 取消后给可见提示；成功导入替换空白首页并切到第一页；截断提示；错误横幅；桌面工具条入口。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { localAssetHttpUrl } from "../../core/assetUrl";
import { createInkDoc, inkToBody, type InkPage } from "../../core/inkDoc";
import { InkPad, type InkPadProps } from "./InkPad";
import type { PdfImportOutcome } from "./pdfImport";

const PDF_URL = localAssetHttpUrl("note-1", "1700000000000_abcdef12.pdf");
const pageUrl = (page: number): string => localAssetHttpUrl("note-1", `${1700000000010 + page}_abcdef1${page}.webp`);

function pdfPage(page: number, pageCount: number): InkPage {
  const base = createInkDoc("p").pages[0];
  return {
    ...base,
    id: `pdf-${page}`,
    backgroundImage: {
      url: pageUrl(page),
      fit: "contain",
      source: "pdf-page",
      pdf: { url: PDF_URL, page, pageCount },
    },
  };
}

function outcome(pages: InkPage[], extra: Partial<PdfImportOutcome> = {}): PdfImportOutcome {
  return {
    pages,
    sourcePdf: { url: PDF_URL, pageCount: extra.pageCount ?? pages.length },
    pageCount: pages.length,
    importedPageCount: pages.length,
    truncated: false,
    cancelled: false,
    errors: [],
    ...extra,
  };
}

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function mount(props: Partial<InkPadProps> & Pick<InkPadProps, "content" | "variant" | "readOnly">): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(<InkPad active {...props} />); });
  return {
    container,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

function byLabel(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
}

/** 编辑态工具坞「插入」→ 悬浮菜单里点「导入 PDF」。 */
async function importPdfFromInsert(container: HTMLElement): Promise<void> {
  await act(async () => { byLabel(container, "插入")!.click(); });
  await act(async () => { byLabel(container, "导入 PDF")!.click(); });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub {
    observe() { /* no-op */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

describe("PDF 导入入口", () => {
  it("移动端：编辑态工具坞「插入」菜单里有「导入 PDF」；阅读态没有（正文写操作只在编辑态）", async () => {
    const onImportPdf = vi.fn(async () => outcome([pdfPage(1, 1)]));
    const edit = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportPdf });
    expect(byLabel(edit.container, "插入")).not.toBeUndefined();
    await act(async () => { byLabel(edit.container, "插入")!.click(); });
    expect(byLabel(edit.container, "导入 PDF")).not.toBeUndefined();
    // 菜单位于坞上方（data-overlay="insert"），入口已从全局预览面板移走
    expect(edit.container.querySelector('[data-overlay="insert"]')).not.toBeNull();
    await edit.unmount();

    const read = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: true, onImportPdf });
    expect(byLabel(read.container, "插入")).toBeUndefined();
    await act(async () => { byLabel(read.container, "全局预览")!.click(); });
    expect(byLabel(read.container, "导入 PDF")).toBeUndefined();
    await read.unmount();
  });

  it("桌面：工具条「导入 PDF」在编辑态可用、阅读态禁用；导入成功替换空白首页并切到第一页", async () => {
    const onChange = vi.fn();
    const onImportPdf = vi.fn(async () => outcome([pdfPage(1, 3), pdfPage(2, 3)], { pageCount: 3 }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: false, onImportPdf, onChange });
    const button = byLabel(view.container, "导入 PDF");
    expect(button).not.toBeUndefined();
    await act(async () => { button!.click(); });
    expect(onImportPdf).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 1 / 2 页");
    // 500ms 防抖后落正文：sourcePdf + pdf-page 背景图进 body（不新增 kind）
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    const body = JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]);
    expect(body.sourcePdf).toEqual({ url: PDF_URL, pageCount: 3 });
    expect(body.pages).toHaveLength(2);
    expect(body.pages[0].backgroundImage.source).toBe("pdf-page");
    expect(body.pages[0].backgroundImage.pdf.page).toBe(1);
    await view.unmount();

    const readonly = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: true, onImportPdf });
    expect(byLabel(readonly.container, "导入 PDF")!.disabled).toBe(true);
    await readonly.unmount();
  });
});

describe("插入菜单（图片 + PDF 两项在同一入口）", () => {
  it("两项都在坞上方菜单里；导入进行中两项 disabled（防重复触发）", async () => {
    let release: (() => void) | null = null;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const onImportImages = vi.fn(async () => ({ pages: [], errors: [] }));
    const onImportPdf = vi.fn(async () => {
      await pending;
      return outcome([pdfPage(1, 1)]);
    });
    const view = await mount({
      content: inkToBody(createInkDoc("p1")),
      variant: "mobile",
      readOnly: false,
      onImportImages,
      onImportPdf,
    });

    await act(async () => { byLabel(view.container, "插入")!.click(); });
    expect(view.container.querySelector('[data-overlay="insert"]')).not.toBeNull();
    expect(byLabel(view.container, "导入图片")).not.toBeUndefined();
    expect(byLabel(view.container, "导入 PDF")).not.toBeUndefined();

    // 发起 PDF 导入（挂起）后，再开菜单：两项都 disabled
    await act(async () => { byLabel(view.container, "导入 PDF")!.click(); });
    await act(async () => { byLabel(view.container, "插入")!.click(); });
    expect(byLabel(view.container, "导入图片")!.disabled).toBe(true);
    expect(byLabel(view.container, "导入 PDF")!.disabled).toBe(true);

    await act(async () => { release!(); await pending; });
    await view.unmount();
  });
});

describe("PDF 导入进度 / 取消 / 错误", () => {
  it("导入中显示「第 n/N 页」+ 取消；取消后给可见提示且不产出页", async () => {
    const onImportPdf = vi.fn(({ onProgress, signal }: {
      onProgress: (done: number, total: number) => void;
      signal: AbortSignal;
    }) => new Promise<PdfImportOutcome>((resolve) => {
      onProgress(1, 3);
      signal.addEventListener("abort", () => resolve(outcome([], { cancelled: true, pageCount: 3 })));
    }));
    const onChange = vi.fn();
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportPdf, onChange });
    await importPdfFromInsert(view.container);

    const progress = view.container.querySelector('[data-ink-pdf-progress]');
    expect(progress).not.toBeNull();
    expect(progress!.textContent).toContain("第 1 / 3 页");
    const cancel = byLabel(view.container, "取消 PDF 导入");
    expect(cancel).not.toBeUndefined();

    await act(async () => { cancel!.click(); });
    expect(view.container.querySelector('[data-ink-pdf-progress]')).toBeNull();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain("已取消");
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 1 / 1 页");
    await view.unmount();
  });

  it("超过 300 页：给截断提示（导入前 300 页）", async () => {
    const onImportPdf = vi.fn(async () => outcome([pdfPage(1, 500)], { pageCount: 500, importedPageCount: 1, truncated: true }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportPdf });
    await importPdfFromInsert(view.container);
    const alert = view.container.querySelector('[role="alert"]');
    expect(alert!.textContent).toContain("上限 300 页");
    await view.unmount();
  });

  it("错误（加密/上传失败）以 role=alert 可见提示", async () => {
    const onImportPdf = vi.fn(async () => outcome([], { errors: ["第 2 页：磁盘写入失败"] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportPdf });
    await importPdfFromInsert(view.container);
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain("磁盘写入失败");
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 1 / 1 页");
    await view.unmount();
  });
});
