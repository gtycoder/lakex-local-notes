// @vitest-environment jsdom
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableFormView } from "./MobileBitableFormView";
import { createBitableField, createBitableView, createDefaultBitableTable } from "../../core/bitableDoc";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function fixture() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    createBitableField("select", "类型", "f-type"),
    createBitableField("text", "内容", "f-content"),
    createBitableField("date", "日期", "f-date"),
  ];
  const view = { ...createBitableView("form", "表单", "v-form"), formFieldIds: ["f-type", "f-content"] };
  table.views = [view];
  table.activeViewId = view.id;
  table.records = [];
  return { table, view };
}

describe("表单编辑态（261030 P2）", () => {
  it("只读文档不出现「编辑表单」入口", () => {
    const { table, view } = fixture();
    act(() => root.render(createElement(MobileBitableFormView, {
      noteId: "n1", table, view, ctx: { tables: [table] }, onSubmit: async () => true,
    })));
    expect(host.textContent).not.toContain("编辑表单");
  });

  it("编辑态可改标题/说明/题目（题目写回 formFieldIds）", () => {
    const onUpdateView = vi.fn();
    const { table, view } = fixture();
    act(() => root.render(createElement(MobileBitableFormView, {
      noteId: "n1", table, view, ctx: { tables: [table] }, onSubmit: async () => true, editable: true, onUpdateView,
    })));
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent === "编辑表单")!;
    expect(toggle).toBeTruthy();
    act(() => toggle.click());
    expect(host.textContent).toContain("题目");
    expect(host.textContent).toContain("返回填写");
    // 261030：标题/说明已从填写态移除，编辑态也不再提供（避免"改了看不见"）
    expect(host.textContent).not.toContain("表单标题");
    // 未勾选的「日期」勾上 ⇒ formFieldIds 追加
    const dateCheckbox = [...host.querySelectorAll('input[type="checkbox"]')].find((i) => (i.getAttribute("aria-label") || "") === "题目 日期") as HTMLInputElement;
    expect(dateCheckbox.checked).toBe(false);
    act(() => dateCheckbox.click());
    expect(onUpdateView).toHaveBeenCalledWith({ formFieldIds: ["f-type", "f-content", "f-date"] });
  });
});
