// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MobileBitableFormView } from "./MobileBitableFormView";
import { createBitableField, createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

function fixture() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    { ...createBitableField("select", "类型", "f-type"), required: true, options: [{ id: "o1", name: "复盘", color: "green" }] },
    { ...createBitableField("text", "内容", "f-content"), required: true },
    createBitableField("attachment", "附件", "f-file"),
    createBitableField("image", "图片", "f-image"),
  ];
  const view = { ...createBitableView("form", "表单", "v-form"), formFieldIds: ["f-type", "f-content", "f-file", "f-image"], formTitle: "观点收集" };
  table.views = [view];
  table.records = [];
  table.activeViewId = view.id;
  return { table, view };
}

const render = () => {
  const { table, view } = fixture();
  return renderToStaticMarkup(createElement(MobileBitableFormView, {
    noteId: "n1", table, view, ctx: { tables: [table] }, onSubmit: async () => true,
  }));
};

describe("MobileBitableFormView（填写态）", () => {
  it("渲染字段/必填标记/折叠式选择器/提交条（无封面与重复标题）", () => {
    const html = render();
    expect(html).toContain("mbt-form-fields");
    expect(html).not.toContain("mbt-form-cover");
    expect(html).not.toContain("收集表");
    expect(html).toContain('aria-label="必填"');
    // 261117 推广：表单视图与记录面板同一「项移动」选择器 —— 默认折叠（只显示已选/占位），候选不平铺
    expect(html).toContain("mbt-select");
    expect(html).toContain("未选择");
    expect(html).not.toContain("mbt-select__options");
    expect(html).toContain(">提交<");
    expect(html).toContain("已提交 0 条");
  });

  it("附件/图片字段现在可上传（不再是「只能查看」的说明）", () => {
    const html = render();
    expect(html).toContain("上传附件");
    expect(html).toContain("上传图片");
    expect(html).not.toContain("移动端暂只能查看");
  });
});

describe("MobileBitableFormView（焦点/键盘不回弹，261119 用户点单）", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const renderFocusFixture = () => {
    const table = createDefaultBitableTable("收集表");
    table.fields = [
      createBitableField("text", "内容", "f-content"),
      createBitableField("progress", "进度", "f-progress"),
    ];
    const view = { ...createBitableView("form", "表单", "v-form"), formFieldIds: ["f-content", "f-progress"] };
    table.views = [view];
    table.records = [];
    table.activeViewId = view.id;
    act(() => root.render(createElement(MobileBitableFormView, {
      noteId: "n-focus", table, view, ctx: { tables: [table] }, onSubmit: async () => true,
    })));
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="内容"]')!;
    const slider = host.querySelector<HTMLInputElement>('input[type="range"][aria-label="进度"]')!;
    expect(textarea).toBeTruthy();
    expect(slider).toBeTruthy();
    return { textarea, slider };
  };
  const pointerDown = (el: Element) => el.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
  const dragSlider = (slider: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(slider, value);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("拖「进度」滑杆 = 文本框真失焦，且全程不把焦点/键盘拉回文本框；点文本框本身仍可聚焦", () => {
    const { textarea, slider } = renderFocusFixture();
    // 聚焦文本框后拖滑杆（pointerdown 落在滑杆上）⇒ 立刻真失焦（旧实现：文本框保留 DOM 焦点，
    // Android 每次调完进度都把软键盘拉回文本框 —— 录屏 form_005/011）
    act(() => textarea.focus());
    expect(document.activeElement).toBe(textarea);
    act(() => pointerDown(slider));
    expect(document.activeElement).not.toBe(textarea);
    act(() => dragSlider(slider, "70"));
    expect(document.activeElement).not.toBe(textarea);
    expect(host.querySelector<HTMLSpanElement>(".mbt-form-progress__value")!.textContent).toBe("70%");
    // 显式 blur 之后再拖（用户诉求的主场景）：同样不回弹
    act(() => textarea.blur());
    act(() => pointerDown(slider));
    act(() => dragSlider(slider, "30"));
    expect(document.activeElement).not.toBe(textarea);
    // 点文本框本身仍可正常聚焦编辑（不误伤）
    act(() => textarea.focus());
    expect(document.activeElement).toBe(textarea);
    act(() => pointerDown(textarea));
    expect(document.activeElement).toBe(textarea);
  });

  it("点表单空白/其它控件（按钮、复选类）也收文本焦点：不留下「可编辑仍持焦」状态", () => {
    const { textarea } = renderFocusFixture();
    act(() => textarea.focus());
    expect(document.activeElement).toBe(textarea);
    // 空白处（.mbt-form-scroll）
    act(() => pointerDown(host.querySelector(".mbt-form-scroll")!));
    expect(document.activeElement).not.toBe(textarea);
    // 提交按钮（按钮类落点）
    act(() => textarea.focus());
    const submit = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent || "").trim() === "提交")!;
    act(() => pointerDown(submit));
    expect(document.activeElement).not.toBe(textarea);
  });
});
