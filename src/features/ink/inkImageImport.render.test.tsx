// @vitest-environment jsdom
/**
 * 手写板 v2「图片页」渲染与导入入口行为护栏（两端共用 InkPad）。
 *
 * 钉住：
 * ① 有 backgroundImage 的页在 SVG 里画 <image>（pointer-events:none + 按 fit 映射 preserveAspectRatio），
 *    并且不再叠纸张底纹（无 InkPaper 的 rect/pattern）——图片本身就是纸面；
 * ② 无背景图时行为不变（不渲染 <image>）；
 * ③ 移动端导入入口只在编辑态的全局预览面板里；导入后追加成页、切到第一张新页、关闭预览；
 * ④ 桌面导入入口在工具条（编辑态），导入后同样成页；
 * ⑤ 导入错误给可见横幅（role=alert）。
 * 为什么手写 createRoot + act：仓内没有 @testing-library/react（先例见 multiTabHost.render.test.tsx）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { localAssetHttpUrl } from "../../core/assetUrl";
import { createInkDoc, inkToBody, type InkBackgroundImage, type InkPage } from "../../core/inkDoc";
import { InkPad, type InkPadProps } from "./InkPad";
import { inkImagePage } from "./inkImageImport";

const IMAGE_URL = localAssetHttpUrl("note-1", "1700000000000_abcdef12.png");

function imageBody(fit: InkBackgroundImage["fit"] = "contain", source?: InkBackgroundImage["source"]): string {
  const doc = createInkDoc("p1");
  doc.pages[0] = {
    ...doc.pages[0],
    backgroundImage: { url: IMAGE_URL, fit, pixelWidth: 1200, pixelHeight: 1600, ...(source ? { source } : {}) },
  };
  return inkToBody(doc);
}

interface Mounted {
  container: HTMLElement;
  root: Root;
  unmount: () => Promise<void>;
}

async function mount(props: Partial<InkPadProps> & Pick<InkPadProps, "content" | "variant" | "readOnly">): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<InkPad active {...props} />);
  });
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

function byLabel(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
}

/** 编辑态纸张行点一项（背景图片 / 背景 PDF 与纸张同一排；261104 二十五批从 ＋ 菜单移出）。 */
async function importFromBackgroundRow(container: HTMLElement, label: string): Promise<void> {
  await act(async () => { byLabel(container, label)!.click(); });
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

describe("图片页渲染", () => {
  it("有背景图：SVG 内渲染 <image>（pointer-events:none、contain=meet），纸张底纹在图片下面", async () => {
    const view = await mount({ content: imageBody("contain", "image"), variant: "mobile", readOnly: true });
    const svg = view.container.querySelector(".ink-page-svg")!;
    const image = svg.querySelector("image");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("href")).toBe(IMAGE_URL);
    expect(image!.getAttribute("pointer-events")).toBe("none");
    expect(image!.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(image!.getAttribute("width")).toBe("794");
    expect(image!.getAttribute("height")).toBe("1123");
    // 261103 十五批：纸张底纹**始终**画，且必须在图片**之前**（图片未铺满时留白处要能看到网格/点阵；
    // 此前「有图就不画底纹」⇒ 用户切网格/点阵完全没反应，图片页永远白纸）
    const rect = svg.querySelector("rect");
    expect(rect).not.toBeNull();
    expect(rect!.compareDocumentPosition(image!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await view.unmount();
  });

  it("PDF 导入页（source=pdf-page）：纸张切换禁用，点了也不标脏（页图铺满整页，切了看不见）", async () => {
    const onDirty = vi.fn();
    const onChange = vi.fn();
    const view = await mount({ content: imageBody("contain", "pdf-page"), variant: "mobile", readOnly: false, onDirty, onChange });
    const papers = Array.from(view.container.querySelectorAll(".ink-backgrounds button")) as HTMLButtonElement[];
    expect(papers.length).toBeGreaterThan(0);
    for (const button of papers) expect(button.disabled).toBe(true);
    await act(async () => { papers[2].click(); });
    expect(onDirty).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("fit 映射：cover=slice / stretch=none", async () => {
    for (const [fit, expected] of [["cover", "xMidYMid slice"], ["stretch", "none"]] as const) {
      const view = await mount({ content: imageBody(fit), variant: "mobile", readOnly: true });
      expect(view.container.querySelector(".ink-page-svg image")!.getAttribute("preserveAspectRatio")).toBe(expected);
      await view.unmount();
    }
  });

  it("无背景图：不渲染 <image>，纸张底纹照旧", async () => {
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: true });
    const svg = view.container.querySelector(".ink-page-svg")!;
    expect(svg.querySelector("image")).toBeNull();
    expect(svg.querySelector("rect")).not.toBeNull();
    await view.unmount();
  });

  it("缩略图（全局预览）用 ?w=256 低清档而不是原图整张解码", async () => {
    const view = await mount({ content: imageBody(), variant: "mobile", readOnly: true });
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    const thumb = view.container.querySelector('[data-overlay="preview"] .ink-page-thumb__paper image');
    expect(thumb).not.toBeNull();
    expect(thumb!.getAttribute("href")).toBe(IMAGE_URL + "?w=256");
    await view.unmount();
  });
});

describe("导入图片入口", () => {
  it("移动端：入口在编辑态纸张行（背景图片）；导入后追加成页、切到新页", async () => {
    const imported: InkPage = inkImagePage({ url: localAssetHttpUrl("note-1", "1700000000001_abcdef13.png"), fit: "contain" }, "imported-1");
    const onImportImages = vi.fn(async () => ({ pages: [imported], errors: [] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportImages });

    // 工具坞里有「插入」且排在第一位；预览面板里不再有导入入口
    const toolRow = view.container.querySelector('[data-overlay="dock"] .ink-toolbar[aria-label="画笔工具"]')!;
    expect(toolRow.querySelector("button")!.getAttribute("aria-label")).toBe("插入");
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    expect(view.container.querySelector('[data-overlay="preview"] button[aria-label="背景图片"]')).toBeNull();
    expect(view.container.querySelector("[data-ink-import]")).toBeNull();
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    // 背景来源与纸张同一排（不是 ＋ 菜单里）
    const paperRow = view.container.querySelector('[data-overlay="dock"] [aria-label="纸张"]')!;
    expect(paperRow.querySelector('button[aria-label="背景图片"]')).not.toBeNull();

    await importFromBackgroundRow(view.container, "背景图片");
    const menu = view.container.querySelector('[data-overlay="insert"]');
    expect(menu).toBeNull(); // 选完即关
    expect(onImportImages).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".ink-pages span")!.textContent).toBe("2 / 2");
    expect(view.container.querySelector(".ink-page-svg image")!.getAttribute("href")).toBe(imported.backgroundImage!.url);
    await view.unmount();
  });

  it("移动端阅读态：没有「插入」、没有背景图片入口（正文写操作只在编辑态）", async () => {
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: true, onImportImages: async () => null });
    expect(byLabel(view.container, "插入")).toBeUndefined();
    expect(byLabel(view.container, "背景图片")).toBeUndefined();
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    expect(byLabel(view.container, "背景图片")).toBeUndefined();
    await view.unmount();
  });

  it("桌面：背景图片入口在底栏纸张之后（编辑态），导入后同样成页", async () => {
    const imported: InkPage = inkImagePage({ url: localAssetHttpUrl("note-1", "1700000000002_abcdef14.png"), fit: "contain" }, "imported-2");
    const onImportImages = vi.fn(async () => ({ pages: [imported], errors: [] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: false, onImportImages });
    const button = byLabel(view.container, "背景图片");
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    expect(onImportImages).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".ink-pages span")!.textContent).toBe("第 2 / 2 页");
    await view.unmount();
  });

  it("移动端注入 onTransientMessage ⇒ 瞬时失败走气泡通道（板内不占位）", async () => {
    const onTransientMessage = vi.fn();
    const onImportImages = vi.fn(async () => ({ pages: [], errors: ["big.png：超过 25 MiB 上限"] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportImages, onTransientMessage });
    await importFromBackgroundRow(view.container, "背景图片");
    expect(onTransientMessage).toHaveBeenCalledWith("导入图片失败：big.png：超过 25 MiB 上限", "error");
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.querySelector(".ink-invalid-banner")).toBeNull();
    await view.unmount();

    // 插入贴图失败（1×1）：同样只走气泡
    const onInsertPageImage = vi.fn(async (): Promise<{ url: string } | null> => { throw new Error("图片太小（1×1），无法作为贴图"); });
    const toast = vi.fn();
    const view2 = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onInsertPageImage, onTransientMessage: toast });
    await act(async () => { (view2.container.querySelector('button[aria-label="插入"]') as HTMLButtonElement).click(); });
    await act(async () => { (view2.container.querySelector('[data-overlay="insert"] button[aria-label="插入贴图"]') as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(toast).toHaveBeenCalledWith("插入图片失败：图片太小（1×1），无法作为贴图", "error");
    expect(view2.container.querySelector('[role="alert"]')).toBeNull();
    await view2.unmount();
  });

  it("导入失败：给可见错误横幅（role=alert），不成页", async () => {
    const onImportImages = vi.fn(async () => ({ pages: [], errors: ["big.png：超过 25 MiB 上限"] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportImages });
    await importFromBackgroundRow(view.container, "背景图片");
    const alert = view.container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("超过 25 MiB 上限");
    expect(view.container.querySelector(".ink-pages span")!.textContent).toBe("1 / 1");
    await view.unmount();
  });
});
