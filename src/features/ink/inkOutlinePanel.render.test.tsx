// @vitest-environment jsdom
/**
 * 大纲 / 书签面板（261104 十八批）：入口、只列有批注或书签的页、点击跳页、加/取消书签（设备本地）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInkDoc, createInkPage, inkToBody, type InkDoc } from "../../core/inkDoc";
import { readInkBookmarks } from "./inkBookmarks";
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

beforeEach(() => { localStorage.clear(); });

describe("手写板大纲 / 书签", () => {
  it("桌面有「大纲」入口；默认只列有批注的页；点击跳页", async () => {
    const view = await mount({ content: threePageBody(), variant: "desktop", readOnly: false });
    const trigger = view.container.querySelector('button[aria-label="大纲"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    await act(async () => { trigger.click(); });
    const panel = view.container.querySelector('[aria-label="大纲"] [role="dialog"], [data-ink-outline-panel]');
    expect(panel).not.toBeNull();
    const rows = Array.from(view.container.querySelectorAll(".ink-outline__row")) as HTMLButtonElement[];
    // 第 2 页有网格底纹但没笔迹：annotated 模式下不列（只有第 3 页有笔迹）
    expect(rows.map((row) => row.textContent)).toEqual(["第 3 页1 笔"]);
    await act(async () => { rows[0].click(); });
    expect(view.container.querySelector(".ink-pages span")!.textContent).toContain("第 3 / 3 页");
    await view.unmount();
  });

  it("加书签：写设备本地、面板摘要 +1、再点取消；书签页在 annotated 模式下也出现", async () => {
    const view = await mount({ content: threePageBody(), variant: "desktop", readOnly: false, noteId: "note-1" });
    await act(async () => { (view.container.querySelector('button[aria-label="大纲"]') as HTMLButtonElement).click(); });
    const bookmark = view.container.querySelector(".ink-outline__bookmark") as HTMLButtonElement;
    expect(bookmark.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { bookmark.click(); });
    // 设备本地：当前页（p1，空白页）被加进书签
    expect(readInkBookmarks("note-1").map((item) => item.pageId)).toEqual(["p1"]);
    expect(view.container.querySelector(".ink-outline__head")!.textContent).toContain("1 个书签");
    // 书签页即使没有笔迹也出现在列表里
    const rows = Array.from(view.container.querySelectorAll(".ink-outline__row")) as HTMLButtonElement[];
    expect(rows.some((row) => row.textContent?.startsWith("第 1 页"))).toBe(true);
    await act(async () => { (view.container.querySelector(".ink-outline__bookmark") as HTMLButtonElement).click(); });
    expect(readInkBookmarks("note-1")).toEqual([]);
    await view.unmount();
  });

  it("没有 noteId 时不写设备本地（纯视图不炸）", async () => {
    const view = await mount({ content: threePageBody(), variant: "desktop", readOnly: false });
    await act(async () => { (view.container.querySelector('button[aria-label="大纲"]') as HTMLButtonElement).click(); });
    await act(async () => { (view.container.querySelector(".ink-outline__bookmark") as HTMLButtonElement).click(); });
    expect(readInkBookmarks(null)).toEqual([]);
    await view.unmount();
  });

  it("没有 noteId 的只读场景：面板仍可用（纯视图，不写任何东西）", async () => {
    const view = await mount({ content: threePageBody(), variant: "desktop", readOnly: true });
    await act(async () => { (view.container.querySelector('button[aria-label="大纲"]') as HTMLButtonElement).click(); });
    expect(view.container.querySelector(".ink-outline__list")).not.toBeNull();
    await view.unmount();
  });
});
