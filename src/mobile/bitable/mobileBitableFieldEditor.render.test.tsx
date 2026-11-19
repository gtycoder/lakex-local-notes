// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableFieldEditorSheet } from "./MobileBitableFieldEditorSheet";
import { createBitableField, BITABLE_OPTION_PALETTE, BITABLE_PROGRESS_QUICK_COLORS } from "../../core/bitableDoc";
import { COLOR_BOARD_VALUES, DEFAULT_LIGHT_COLORS, OPTION_COLOR_BOARD_GROUPS, OPTION_COLOR_BOARD_VALUES } from "../../core/colorPalette";

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
    act(() => btnByText("新建选项")!.click());
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

  it("选项回车 = 完成当前并跳下一个；末尾回车 = 新增并聚焦；IME 组字回车不流转（261117 用户点单）", async () => {
    const onSave = vi.fn();
    render({ ...createBitableField("select", "类型", "f-type"), options: [
      { id: "o1", name: "复盘", color: "green" },
      { id: "o2", name: "提问", color: "blue" },
    ] }, onSave);
    const inputs = () => host.querySelectorAll<HTMLInputElement>(".mbt-feditor__option input");
    const pressEnter = async (input: HTMLInputElement, extra: KeyboardEventInit = {}) => {
      await act(async () => {
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...extra }));
        // 新增行的挂载/聚焦可能退避几帧 ⇒ 多等几帧
        for (let i = 0; i < 4; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    };
    // 中间项回车 ⇒ 聚焦下一项
    await pressEnter(inputs()[0]);
    expect(document.activeElement).toBe(inputs()[1]);
    // 末尾项回车 ⇒ 新增第 3 项并聚焦
    await pressEnter(inputs()[1]);
    expect(inputs().length).toBe(3);
    expect(document.activeElement).toBe(inputs()[2]);
    // IME 组字中的回车不触发（core/ime 守卫）：不新增、不跳
    await pressEnter(inputs()[2], { isComposing: true });
    expect(inputs().length).toBe(3);
    expect(document.activeElement).toBe(inputs()[2]);
    // 收尾：提交的选项名不丢
    act(() => btnByText("确认")!.click());
    const patch = onSave.mock.calls[0][0] as { options: Array<{ name: string }> };
    expect(patch.options.map((o) => o.name)).toEqual(["复盘", "提问", "选项 3"]);
  });

  it("选项色点可改色：点色点展开同款色板（候选 = 桌面选项色板同一来源的 2 行深浅档），选色落 option.color", () => {
    const onSave = vi.fn();
    render({ ...createBitableField("select", "状态", "f-status"), options: [{ id: "o1", name: "复盘", color: "green" }] }, onSave);
    // 色点 = 可点按钮（旧实现是 aria-hidden 的 span，改不了色）
    const swatch = host.querySelector<HTMLButtonElement>('button[aria-label="选项颜色：复盘"]');
    expect(swatch).toBeTruthy();
    expect(swatch!.getAttribute("aria-expanded")).toBe("false");
    // 点色点 → 展开本面板同款 .mbt-feditor__colors 色板（与「进度条颜色」同一原语）
    act(() => swatch!.click());
    expect(swatch!.getAttribute("aria-expanded")).toBe("true");
    const palette = host.querySelector('[role="group"][aria-label="选项颜色：复盘"]');
    expect(palette).toBeTruthy();
    expect(palette!.className).toContain("mbt-feditor__group");
    // 「默认颜色」清空项保留首位：独立占第一行，20 色随后排进 10 列网格（上下同列同色相）
    const rows = [...palette!.querySelectorAll(".mbt-feditor__colors")];
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('button[aria-label="默认颜色"]')).toBeTruthy();
    // 候选色集合 = OPTION_COLOR_BOARD_VALUES（core/colorPalette 选项色板 2 行 × 10；桌面端字段编辑器
    // 选项色板 ColorPalette 同一数据源，不自造色值）；行优先 = 上浅档行、下深档行
    const candidates = [...rows[1].querySelectorAll<HTMLButtonElement>('button[aria-label^="颜色 "]')]
      .map((b) => b.getAttribute("aria-label")!.slice("颜色 ".length));
    expect(candidates).toEqual([...OPTION_COLOR_BOARD_VALUES]);
    expect(candidates.slice(0, 10)).toEqual([...OPTION_COLOR_BOARD_GROUPS[0]]);
    expect(candidates.slice(10)).toEqual([...OPTION_COLOR_BOARD_GROUPS[1]]);
    // 候选全部属于桌面支持集 COLOR_BOARD_VALUES（20 = 2 行 × 10，不自造色值）
    expect(candidates.length).toBe(20);
    expect(candidates.every((c) => COLOR_BOARD_VALUES.includes(c))).toBe(true);
    // 选色 → 确认后 patch.options[0].color = 该 hex（optionColorHex 原样透传）
    act(() => rows[1].querySelector<HTMLButtonElement>('button[aria-label="颜色 #FF4D4F"]')!.click());
    act(() => btnByText("确认")!.click());
    expect((onSave.mock.calls[0][0] as { options: Array<{ color?: string }> }).options)
      .toEqual([{ id: "o1", name: "复盘", color: "#FF4D4F" }]);
  });

  it("选项色板只收「选项色」的候选：进度条颜色色板原样保留（防误伤其它色板）", () => {
    render({ ...createBitableField("progress", "进度", "f-prog"), defaultValue: "50" }, vi.fn());
    const palette = host.querySelector('.mbt-feditor__colors');
    expect(palette).toBeTruthy();
    const candidates = [...palette!.querySelectorAll<HTMLButtonElement>('button[aria-label^="颜色 "]')]
      .map((b) => b.getAttribute("aria-label")!.slice("颜色 ".length));
    // 进度条快捷 8 色 = BITABLE_PROGRESS_QUICK_COLORS（最浅档前 8；261119 拆常量，锁「进度色板候选不变」不被选项轮转池带走）
    expect(candidates).toEqual(BITABLE_PROGRESS_QUICK_COLORS.slice());
    expect(BITABLE_PROGRESS_QUICK_COLORS).toEqual(DEFAULT_LIGHT_COLORS.slice(0, 8));
    expect(palette!.querySelector('button[aria-label="默认颜色"]')).toBeTruthy();
  });

  it("新建选项默认色分配 = 单源 BITABLE_OPTION_PALETTE（移动端与 core/bitable/body.ts 同一常量，261119）", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/mobile/bitable/MobileBitableFieldEditorSheet.tsx"), "utf8");
    // 新建选项的默认色必须走共享轮转池常量（⊆ OPTION_COLOR_BOARD_VALUES，见 colorPalette.test.ts ④），
    // 不许在移动端另起一套分配点/色值。
    expect(src).toContain("color: BITABLE_OPTION_PALETTE[prev.length % BITABLE_OPTION_PALETTE.length]");
    expect(src).not.toContain("DEFAULT_LIGHT_COLORS");
    expect([...BITABLE_OPTION_PALETTE].every((hex) => OPTION_COLOR_BOARD_VALUES.includes(hex))).toBe(true);
  });

  it("选项色点：旧命名色经 optionColorHex 回显；「默认颜色」清掉 option.color", () => {
    const onSave = vi.fn();
    render({ ...createBitableField("select", "状态", "f-status"), options: [{ id: "o1", name: "复盘", color: "green" }] }, onSave);
    // 旧命名色（green = #d3f0df）在色点上按 optionColorHex 回显（它不在 70 色板里，与桌面 ColorPalette 同口径）
    const swatch = host.querySelector<HTMLButtonElement>('button[aria-label="选项颜色：复盘"]')!;
    expect(swatch.style.background).toBe("rgb(211, 240, 223)");
    act(() => swatch.click());
    const palette = host.querySelector('[role="group"][aria-label="选项颜色：复盘"]')!;
    act(() => palette.querySelector<HTMLButtonElement>('button[aria-label="默认颜色"]')!.click());
    act(() => btnByText("确认")!.click());
    expect((onSave.mock.calls[0][0] as { options: Array<{ color?: string }> }).options)
      .toEqual([{ id: "o1", name: "复盘", color: undefined }]);
  });
});
