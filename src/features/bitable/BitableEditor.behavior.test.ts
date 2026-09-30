// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeImagePreview } from "../editor/imagePreview";
import { BitableEditor, type BitableEditorProps } from "./BitableEditor";

const ts = "2026-09-01T00:00:00.000Z";
function body(prefix: string): string {
  return JSON.stringify({ kind: "bitable", version: 1, activeTableId: prefix + "t", tables: [{
    id: prefix + "t", name: prefix,
    fields: [{ id: prefix + "f", name: "文本", type: "text" }],
    records: [{ id: prefix + "r", values: { [prefix + "f"]: "原值" }, createdAt: ts, updatedAt: ts }],
    views: [{ id: prefix + "v1", name: "视图一", type: "grid" }, { id: prefix + "v2", name: "视图二", type: "grid" }],
    activeViewId: prefix + "v1",
  }] });
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => closeImagePreview()); act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function props(prefix: string, overrides: Partial<BitableEditorProps> = {}): BitableEditorProps {
  return { noteId: prefix, content: body(prefix), visible: true, readOnly: false, onChange: vi.fn(), ...overrides };
}
function selectCell(editor: Element): void {
  act(() => {
    editor.querySelector("td[data-field-id]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}
function shortcut(key: string, target: EventTarget = document): void {
  act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true })); });
}
function input(text: string, editor: Element = host): void {
  const el = editor.querySelector<HTMLInputElement>(".bt-cell-input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function savedValue(change: ReturnType<typeof vi.fn>, fieldId: string): string {
  return JSON.parse(change.mock.calls.at(-1)![0]).tables[0].records[0].values[fieldId];
}

describe("多维表编辑会话行为", () => {
  it("有旧选区的隐藏标签不能与活动网格一起粘贴", async () => {
    const onA = vi.fn(), onB = vi.fn();
    const a = props("a", { onChange: onA }), b = props("b", { onChange: onB });
    const render = (activeA: boolean) => root.render(createElement("div", {},
      createElement(BitableEditor, { ...a, visible: activeA, key: "a" }),
      createElement(BitableEditor, { ...b, visible: !activeA, key: "b" })));
    act(() => render(true));
    const editors = host.querySelectorAll(".bitable-editor");
    selectCell(editors[0]); act(() => render(false)); selectCell(editors[1]);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: vi.fn().mockResolvedValue("粘贴值") } });
    await act(async () => shortcut("v"));
    act(() => vi.advanceTimersByTime(801));
    expect(onA).not.toHaveBeenCalled();
    expect(savedValue(onB, "bf")).toBe("粘贴值");
  });
  it("只读后不能撤销记录；只读导航和卸载不能发布正文", () => {
    const change = vi.fn(); const p = props("a", { onChange: change });
    act(() => root.render(createElement(BitableEditor, p)));
    input("改后"); act(() => vi.advanceTimersByTime(801)); change.mockClear();
    act(() => root.render(createElement(BitableEditor, { ...p, readOnly: true })));
    shortcut("z");
    expect(host.querySelector<HTMLInputElement>(".bt-cell-input")!.value).toBe("改后");
    act(() => host.querySelectorAll<HTMLButtonElement>(".bt-view-name")[1].click());
    act(() => root.render(null));
    expect(change).not.toHaveBeenCalled();
  });
  it("切换视图不消耗记录编辑的撤销步数，撤销保持当前视图", () => {
    act(() => root.render(createElement(BitableEditor, props("a"))));
    input("改后");
    act(() => host.querySelectorAll<HTMLButtonElement>(".bt-view-name")[1].click());
    shortcut("z");
    expect(host.querySelector<HTMLInputElement>(".bt-cell-input")!.value).toBe("原值");
    expect(host.querySelector(".bt-view-tab.active")!.textContent).toContain("视图二");
  });

  it("只读切换前的输入交给草稿回调一次，不调用正文 onChange", () => {
    const change = vi.fn(), preserve = vi.fn();
    const p = props("a", { onChange: change, onPreserveDraft: preserve });
    act(() => root.render(createElement(BitableEditor, p)));
    input("未发布输入");
    act(() => root.render(createElement(BitableEditor, { ...p, readOnly: true })));
    expect(change).not.toHaveBeenCalled();
    expect(savedValue(preserve, "af")).toBe("未发布输入");
    act(() => root.render(null));
    expect(change).not.toHaveBeenCalled(); expect(preserve).toHaveBeenCalledTimes(1);
  });
  it("没有正文编辑的只读视图切换不产生恢复草稿", () => {
    const change = vi.fn(), preserve = vi.fn();
    act(() => root.render(createElement(BitableEditor, props("a", { readOnly: true, onChange: change, onPreserveDraft: preserve }))));
    act(() => host.querySelectorAll<HTMLButtonElement>(".bt-view-name")[1].click());
    act(() => root.render(null));
    expect(change).not.toHaveBeenCalled(); expect(preserve).not.toHaveBeenCalled();
  });
  it("一次列宽连续拖动只占一个撤销步骤", () => {
    act(() => root.render(createElement(BitableEditor, props("a"))));
    input("改后");
    const grip = host.querySelector('[aria-label="调整列宽"]') ?? host.querySelector('.bt-col-resize');
    expect(grip).not.toBeNull();
    act(() => grip!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200 })));
    act(() => document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 240 })));
    act(() => document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 300 })));
    act(() => document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })));
    shortcut("z");
    expect(host.querySelector<HTMLTableColElement>("col[style]")!.style.width).toBe("180px");
    expect(host.querySelector<HTMLInputElement>(".bt-cell-input")!.value).toBe("改后");
    shortcut("z");
    expect(host.querySelector<HTMLInputElement>(".bt-cell-input")!.value).toBe("原值");
  });

  it("有网格选区时，弹窗/表单输入的快捷键不能写正文", async () => {
    const readText = vi.fn().mockResolvedValue("不能粘到网格");
    const change = vi.fn();
    act(() => root.render(createElement(BitableEditor, props("a", { onChange: change }))));
    selectCell(host);
    const overlay = document.createElement("div"); overlay.setAttribute("role", "dialog");
    const button = document.createElement("button"); overlay.append(button); document.body.append(overlay);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    await act(async () => shortcut("v", button));
    act(() => vi.advanceTimersByTime(801));
    expect(readText).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
    overlay.remove();
  });
  it("异步剪贴板读取期间切换表，不能写新表或旧表", async () => {
    let finish!: (value: string) => void;
    const readText = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const change = vi.fn(); const data = JSON.parse(body("a"));
    const second = JSON.parse(body("b")).tables[0]; data.tables.push(second);
    act(() => root.render(createElement(BitableEditor, props("a", { content: JSON.stringify(data), onChange: change }))));
    selectCell(host);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    await act(async () => shortcut("v"));
    act(() => host.querySelectorAll<HTMLElement>(".bt-table-item")[1].click());
    await act(async () => finish("迟到粘贴"));
    act(() => vi.advanceTimersByTime(801));
    const saved = JSON.parse(change.mock.calls.at(-1)![0]);
    expect(saved.tables[0].records[0].values.af).toBe("原值");
    expect(saved.tables[1].records[0].values.bf).toBe("原值");
  });

  it("隐藏 Lake 内核提前 preventDefault 时，活动网格撤销仍只由本表处理", () => {
    act(() => root.render(createElement(BitableEditor, props("a"))));
    input("改后");
    const blocked = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", blocked, true);
    try {
      shortcut("z");
      expect(host.querySelector<HTMLInputElement>(".bt-cell-input")!.value).toBe("原值");
    } finally { document.removeEventListener("keydown", blocked, true); }
  });

  it("网格选区用行列索引命中：单击一格四边齐全（AR-F5）", () => {
    act(() => root.render(createElement(BitableEditor, props("a"))));
    selectCell(host);
    const td = host.querySelector<HTMLTableCellElement>(".bt-td.cell-selected");
    expect(td).not.toBeNull();
    expect(td!.className).toContain("sel-top");
    expect(td!.className).toContain("sel-bottom");
    expect(td!.className).toContain("sel-left");
    expect(td!.className).toContain("sel-right");
  });

});

it("应用只挂一个共享预览，两个多维表标签只前进一张图片", async () => {
  const { ImageLightbox } = await import("../editor/ImageLightbox");
  const { openImagePreview, closeImagePreview } = await import("../editor/imagePreview");
  act(() => root.render(createElement("div", {},
    createElement(ImageLightbox), createElement(BitableEditor, { ...props("a"), key: "a" }),
    createElement(BitableEditor, { ...props("b", { visible: false }), key: "b" }))));
  act(() => openImagePreview([{ src: "a.png" }, { src: "b.png" }, { src: "c.png" }], 0));
  expect(document.querySelectorAll(".image-lightbox")).toHaveLength(1);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.querySelector(".image-lightbox__toolbar")!.textContent).toContain("2 / 3");
  act(() => closeImagePreview());
});
