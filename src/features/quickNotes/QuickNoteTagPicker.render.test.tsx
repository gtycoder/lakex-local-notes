// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickNoteTagPicker } from "./QuickNoteTagPicker";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";

/**
 * 标签选择器（261110 第二批）：候选行 / 新建行 = kit 的 .ln-menu__item（菜单行身份）；
 * 输入框沿用 .ln-input 原语（uiPrimitives.test.ts 也钉着这两个类名）。
 */
const options: QuickNoteTagSummary[] = [
  { id: "t_0000000000000001", name: "灵感", createdAt: "T", updatedAt: "T", count: 3 },
  { id: "t_0000000000000002", name: "项目", createdAt: "T", updatedAt: "T", count: 1 },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let anchor: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  anchor = document.createElement("button");
  document.body.append(anchor);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); anchor.remove(); vi.unstubAllGlobals(); });

function render(onAdd = vi.fn(), onCreate = vi.fn(async () => "t_0000000000000003")) {
  act(() => root.render(createElement(QuickNoteTagPicker, { anchor, options, selected: ["t_0000000000000001"], onAdd, onCreate, onClose: vi.fn() })));
  return { onAdd, onCreate };
}
const classesOf = (el: Element): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
/** 类名只含 ln-*（状态类 is-* 不算视觉来源）。 */
const onlyPrimitive = (el: Element): boolean => classesOf(el).every((name) => name.startsWith("ln-") || name.startsWith("is-"));
const items = (): HTMLButtonElement[] => [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-tag-picker__list button.ln-menu__item")];

describe("QuickNoteTagPicker（261110 第二批）", () => {
  it("候选行 = ln-menu__item（类名只含 ln-* / 已选带 is-selected + is-disabled 并禁用）", () => {
    render();
    expect(items()).toHaveLength(2);
    for (const item of items()) {
      expect(onlyPrimitive(item)).toBe(true);
      expect(item.className).toContain("ln-menu__item");
    }
    const selected = items().find((b) => (b.textContent ?? "").includes("灵感"))!;
    expect(selected.disabled).toBe(true);
    expect(selected.className).toContain("is-selected");
    expect(selected.className).toContain("is-disabled");
  });

  it("选中项显示勾、未选中项显示计数；点未选中项 = onAdd(id)", () => {
    const { onAdd } = render();
    const item = items().find((b) => (b.textContent ?? "").includes("项目"))!;
    expect(item.textContent).toContain("1");
    act(() => item.click());
    expect(onAdd).toHaveBeenCalledWith("t_0000000000000002");
  });

  it("输入新名字 ⇒ 新建行出现且也是 ln-menu__item；点击调 onCreate", async () => {
    const { onCreate } = render();
    const input = document.body.querySelector<HTMLInputElement>(".quick-note-tag-picker__input input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "新标签");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-tag-picker button.ln-menu__item")]
      .find((b) => (b.textContent ?? "").includes("创建标签"))!;
    expect(create).not.toBeNull();
    expect(create.className).toContain("ln-menu__item");
    expect(onlyPrimitive(create)).toBe(true);
    await act(async () => { create.click(); await Promise.resolve(); });
    expect(onCreate).toHaveBeenCalledWith("新标签");
  });
});
