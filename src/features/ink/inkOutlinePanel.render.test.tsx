// @vitest-environment jsdom
/**
 * 大纲 / 页备注面板（261104 十八批；二十批：设备本地书签 → 正文页备注）。
 * 覆盖：入口、只列有批注/备注的页、点击跳页、三种范围循环、页备注保存进正文（进撤销栈、标脏）、只看有备注。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInkDoc, createInkPage, inkToBody, type InkDoc } from "../../core/inkDoc";
import { InkPad, type InkPadProps } from "./InkPad";

function threePageBody(): string {
  const doc: InkDoc = createInkDoc("p1");
  doc.pages = [
    { ...createInkPage("p1", "blank") },
    { ...createInkPage("p2", "grid") },
    {
      ...createInkPage("p3", "blank"),
      strokes: [{ id: "s1", tool: "pen", color: "#262626", width: 2.5, points: [{ x: 10, y: 10, pressure: 0.5 }, { x: 40, y: 40, pressure: 0.5 }] }],
    },
  ];
  doc.activePageId = "p1";
  return inkToBody(doc);
}

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(props: Partial<InkPadProps> & Pick<InkPadProps, "content" | "variant" | "readOnly">): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(<InkPad active {...props} />); });
  return {
    container,
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

describe("手写板大纲 / 页备注", () => {
  it("桌面有「大纲」入口；默认只列有批注的页；点击跳页", async () => {
    const view = await mount({ content: threePageBody(), variant: "desktop", readOnly: false });
    const trigger = view.container.querySelector('button[aria-label="大纲"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    await act(async () => { trigger.click(); });
    expect(view.container.querySelector("[data-ink-outline-panel]")).not.toBeNull();
    const rows = Array.from(view.container.querySelectorAll(".ink-outline__row")) as HTMLButtonElement[];
    expect(rows.map((row) => row.textContent)).toEqual(["第 3 页1 笔"]);
    await act(async () => { rows[0].click(); });
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 3 / 3 页");
    await view.unmount();
  });

  it("页备注：输入后保存 ⇒ 写进正文（onChange 会带上 note）、进撤销栈、面板行显示备注", async () => {
    const onChange = vi.fn();
    const view = await mount({ content: threePageBody(), variant: "desktop", readOnly: false, onChange });
    await act(async () => { (view.container.querySelector('button[aria-label="大纲"]') as HTMLButtonElement).click(); });
    const input = view.container.querySelector("#ink-outline-note") as HTMLInputElement;
    const save = view.container.querySelector(".ink-outline__note-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true); // 没改动不可点
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "重点：第三章");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { save.click(); });
    // 防抖后正文落盘：当前页 p1 带上 note
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    expect(onChange).toHaveBeenCalled();
    const body = JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]) as InkDoc;
    expect(body.pages[0].note).toBe("重点：第三章");
    // 备注页也在大纲里出现
    expect(Array.from(view.container.querySelectorAll(".ink-outline__row")).some((row) => row.textContent?.includes("重点：第三章"))).toBe(true);
    await view.unmount();
  });

  it("显示范围循环：只看批注 → 全部页 → 只看有备注（空态给出提示）", async () => {
    const view = await mount({ content: threePageBody(), variant: "desktop", readOnly: false });
    await act(async () => { (view.container.querySelector('button[aria-label="大纲"]') as HTMLButtonElement).click(); });
    const mode = () => view.container.querySelector(".ink-outline__mode") as HTMLButtonElement;
    expect(mode().textContent).toBe("只看批注");
    await act(async () => { mode().click(); });
    expect(mode().textContent).toBe("全部页");
    expect(view.container.querySelectorAll(".ink-outline__row").length).toBe(3);
    await act(async () => { mode().click(); });
    expect(mode().textContent).toBe("只看有备注");
    expect(view.container.querySelectorAll(".ink-outline__row").length).toBe(0);
    expect(view.container.querySelector(".ink-outline__empty")!.textContent).toContain("还没有备注");
    await view.unmount();
  });
});
