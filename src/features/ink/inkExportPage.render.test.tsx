// @vitest-environment jsdom
/**
 * 单页导出入口（261104 十七批）：工具栏**只有一个**按钮，点开再选格式（PDF / PNG / SVG）。
 * 覆盖：只有一处入口、菜单三项、回调带上当前页 id、成功提示、点完关菜单、没有注入就没有入口。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInkDoc, inkToBody } from "../../core/inkDoc";
import { InkPad, type InkPadProps } from "./InkPad";

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

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub {
    observe() { /* no-op */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

describe("手写板单页导出入口", () => {
  it("只有一个「导出」按钮，点开是三格式菜单；选一项回调当前页 id 并关菜单", async () => {
    const onExportPage = vi.fn(async (_input: { pageIds: string[]; format: string }) => ({ exportPath: "/tmp/第1页.pdf" }));
    const view = await mount({
      content: inkToBody(createInkDoc("p1")),
      variant: "desktop",
      readOnly: false,
      onExportPage,
    });

    const triggers = view.container.querySelectorAll('button[aria-label="导出"]');
    expect(triggers.length).toBe(1); // 用户定稿：只新增一个按钮，不要三个

    await act(async () => { (triggers[0] as HTMLButtonElement).click(); });
    const menu = view.container.querySelector('[aria-label="导出当前页"]');
    expect(menu).not.toBeNull();
    const items = Array.from(menu!.querySelectorAll("[role=menuitem]")) as HTMLButtonElement[];
    expect(items.map((item) => item.textContent)).toEqual(["当前页 PDF", "当前页 PNG", "当前页 SVG"]);

    await act(async () => { items[0].click(); });
    expect(onExportPage).toHaveBeenCalledTimes(1);
    expect(onExportPage.mock.calls[0][0]).toEqual({ pageIds: ["p1"], format: "pdf" });
    // 菜单点完自己关掉
    expect(view.container.querySelector('[aria-label="导出当前页"]')).toBeNull();
    await view.unmount();
  });

  it("没有注入 onExportPage（移动端 / 阅读态）：工具条里没有导出入口", async () => {
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false });
    expect(view.container.querySelector('button[aria-label="导出"]')).toBeNull();
    await view.unmount();
  });

  it("导出失败：横幅给可见错误（不静默吞掉）", async () => {
    const onExportPage = vi.fn(async (_input: { pageIds: string[]; format: string }): Promise<{ exportPath: string }> => { throw new Error("目录不可写"); });
    const view = await mount({
      content: inkToBody(createInkDoc("p1")),
      variant: "desktop",
      readOnly: false,
      onExportPage,
    });
    await act(async () => { (view.container.querySelector('button[aria-label="导出"]') as HTMLButtonElement).click(); });
    const items = Array.from(view.container.querySelectorAll("[role=menuitem]")) as HTMLButtonElement[];
    await act(async () => { items[1].click(); });
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain("导出失败");
    await view.unmount();
  });
});
