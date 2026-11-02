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

function imageBody(fit: InkBackgroundImage["fit"] = "contain"): string {
  const doc = createInkDoc("p1");
  doc.pages[0] = {
    ...doc.pages[0],
    backgroundImage: { url: IMAGE_URL, fit, pixelWidth: 1200, pixelHeight: 1600 },
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

/** 编辑态工具坞「插入」→ 悬浮菜单里点一项（图片/PDF 两个入口都收在这里）。 */
async function importFromInsertMenu(container: HTMLElement, label: string): Promise<void> {
  await act(async () => { byLabel(container, "插入")!.click(); });
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
  it("有背景图：SVG 内渲染 <image>（pointer-events:none、contain=meet），且不叠纸张底纹", async () => {
    const view = await mount({ content: imageBody("contain"), variant: "mobile", readOnly: true });
    const svg = view.container.querySelector(".ink-page-svg")!;
    const image = svg.querySelector("image");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("href")).toBe(IMAGE_URL);
    expect(image!.getAttribute("pointer-events")).toBe("none");
    expect(image!.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(image!.getAttribute("width")).toBe("794");
    expect(image!.getAttribute("height")).toBe("1123");
    // 图片即纸面：不再画 InkPaper（无 rect / pattern）
    expect(svg.querySelector("rect")).toBeNull();
    expect(svg.querySelector("pattern")).toBeNull();
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
  it("移动端：入口在编辑态工具坞的「插入」菜单；导入后追加成页、切到新页并关菜单", async () => {
    const imported: InkPage = inkImagePage({ url: localAssetHttpUrl("note-1", "1700000000001_abcdef13.png"), fit: "contain" }, "imported-1");
    const onImportImages = vi.fn(async () => ({ pages: [imported], errors: [] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportImages });

    // 工具坞里有「插入」且排在第一位；预览面板里不再有导入入口
    const toolRow = view.container.querySelector('[data-overlay="dock"] .ink-toolbar[aria-label="画笔工具"]')!;
    expect(toolRow.querySelector("button")!.getAttribute("aria-label")).toBe("插入");
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    expect(byLabel(view.container, "导入图片")).toBeUndefined();
    expect(view.container.querySelector("[data-ink-import]")).toBeNull();
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });

    await importFromInsertMenu(view.container, "导入图片");
    const menu = view.container.querySelector('[data-overlay="insert"]');
    expect(menu).toBeNull(); // 选完即关
    expect(onImportImages).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 2 / 2 页");
    expect(view.container.querySelector(".ink-page-svg image")!.getAttribute("href")).toBe(imported.backgroundImage!.url);
    await view.unmount();
  });

  it("移动端阅读态：没有「插入」、预览里也没有导入入口（正文写操作只在编辑态）", async () => {
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: true, onImportImages: async () => null });
    expect(byLabel(view.container, "插入")).toBeUndefined();
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    expect(byLabel(view.container, "导入图片")).toBeUndefined();
    await view.unmount();
  });

  it("桌面：导入入口在工具条（编辑态），导入后同样成页", async () => {
    const imported: InkPage = inkImagePage({ url: localAssetHttpUrl("note-1", "1700000000002_abcdef14.png"), fit: "contain" }, "imported-2");
    const onImportImages = vi.fn(async () => ({ pages: [imported], errors: [] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: false, onImportImages });
    const button = byLabel(view.container, "导入图片");
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    expect(onImportImages).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 2 / 2 页");
    await view.unmount();
  });

  it("导入失败：给可见错误横幅（role=alert），不成页", async () => {
    const onImportImages = vi.fn(async () => ({ pages: [], errors: ["big.png：超过 25 MiB 上限"] }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false, onImportImages });
    await importFromInsertMenu(view.container, "导入图片");
    const alert = view.container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("超过 25 MiB 上限");
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 1 / 1 页");
    await view.unmount();
  });
});
