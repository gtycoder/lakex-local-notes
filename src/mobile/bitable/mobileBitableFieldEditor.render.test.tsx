// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableFieldEditorSheet } from "./MobileBitableFieldEditorSheet";
import { createBitableField } from "../../core/bitableDoc";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (field: ReturnType<typeof createBitableField>, onSave: (patch: unknown, nextType?: string) => void, hasData = false) =>
  act(() => root.render(createElement(MobileBitableFieldEditorSheet, { open: true, field, hasData, onSave, onClose: () => {} })));
const text = () => host.textContent ?? "";
const btnByText = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent || "").trim() === label);

describe("MobileBitableFieldEditorSheet（修改字段）", () => {
  it("日期：标题/类型/三态默认值/必填；选「添加记录当天」→ 确认写 dateAutoFill", () => {
    const onSave = vi.fn();
    render({ ...createBitableField("date", "日期", "f-date"), defaultValue: "2026-06-09" }, onSave);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="字段标题"]')!.value).toBe("日期");
    expect(text()).toContain("日期");
    expect(btnByText("无")).toBeTruthy();
    expect(btnByText("指定日期")).toBeTruthy();
    act(() => btnByText("添加记录当天")!.click());
    act(() => btnByText("确认")!.click());
    expect(onSave).toHaveBeenCalledWith({ name: "日期", required: false, defaultValue: undefined, dateAutoFill: true }, undefined);
  });

  it("显示格式（日期/数字）：选中即写入 patch.format", () => {
    const onSave = vi.fn();
    render(createBitableField("date", "日期", "f-date"), onSave);
    expect(text()).toContain("显示格式");
    act(() => btnByText("6月9日")!.click());
    act(() => btnByText("确认")!.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ format: "md" }), undefined);

    const numSave = vi.fn();
    act(() => root.render(createElement(MobileBitableFieldEditorSheet, {
      open: true, field: createBitableField("number", "数字", "f-num"), hasData: false, onSave: numSave, onClose: () => {},
    })));
    act(() => btnByText("2 位小数")!.click());
    act(() => btnByText("确认")!.click());
    expect(numSave).toHaveBeenCalledWith(expect.objectContaining({ format: "decimal2" }), undefined);
  });

  it("类型：没数据时可互转（回调第二个参数）；有数据时只读并说明原因", () => {
    const onSave = vi.fn();
    render(createBitableField("text", "内容", "f-text"), onSave);
    expect(host.querySelectorAll(".mb-chip").length).toBeGreaterThan(3);
    act(() => btnByText("日期")!.click());
    act(() => btnByText("确认")!.click());
    expect(onSave.mock.calls[0][1]).toBe("date");

    act(() => root.render(createElement(MobileBitableFieldEditorSheet, {
      open: true, field: createBitableField("date", "日期", "f-date"), hasData: true, onSave: () => {}, onClose: () => {},
    })));
    expect(host.textContent).toContain("该字段已有数据，不能修改类型");
    // 有数据时不出现类型候选 chips（只剩默认值三态里的按钮）
    expect(btnByText("文本")).toBeUndefined();
  });

  it("换类型时清掉旧类型草稿（默认值/格式不带到新字段）", () => {
    const onSave = vi.fn();
    render({ ...createBitableField("date", "日期", "f-date"), defaultValue: "2026-06-09", format: "md" }, onSave);
    act(() => btnByText("文本")!.click());
    act(() => btnByText("确认")!.click());
    const patch = onSave.mock.calls[0][0] as { defaultValue?: unknown; format?: unknown };
    expect(patch.defaultValue).toBeUndefined();
    expect(patch.format).toBeUndefined();
    expect(onSave.mock.calls[0][1]).toBe("text");
  });

  it("必填开关与文本默认值一起写回", () => {
    const onSave = vi.fn();
    render(createBitableField("text", "内容", "f-text"), onSave);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="默认值"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "默认文本");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="必填"]')!.click());
    act(() => btnByText("确认")!.click());
    expect(onSave).toHaveBeenCalledWith({ name: "内容", required: true, defaultValue: "默认文本" }, undefined);
  });

  it("单选：选项可增删改名，「无」默认值；类型/关联等说明只读提示", () => {
    const onSave = vi.fn();
    render({ ...createBitableField("select", "类型", "f-type"), options: [{ id: "o1", name: "复盘", color: "green" }] }, onSave);
    expect(host.querySelectorAll(".mbt-feditor__option").length).toBe(1);
    act(() => btnByText("添加选项")!.click());
    expect(host.querySelectorAll(".mbt-feditor__option").length).toBe(2);
    const second = host.querySelectorAll<HTMLInputElement>('.mbt-feditor__option input')[1];
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(second, "提问");
      second.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => btnByText("确认")!.click());
    const patch = onSave.mock.calls[0][0] as { options: Array<{ name: string }> };
    expect(patch.options.map((o) => o.name)).toEqual(["复盘", "提问"]);
    // 关联/AI 这类字段只给说明、不给半截设置
    act(() => root.render(createElement(MobileBitableFieldEditorSheet, {
      open: true, field: { ...createBitableField("relationOneWay", "关联", "f-rel") }, hasData: false, onSave: () => {}, onClose: () => {},
    })));
    expect(host.textContent).toContain("请在桌面端修改");
  });
});
