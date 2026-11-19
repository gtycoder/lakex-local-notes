// @vitest-environment jsdom
/**
 * 261119（lead 裁定收口）：「文本框失焦后不能反复触发键盘」在多维表各面板的**同型排查**（证据先于改动）。
 *
 * 同型判据（表单录屏 form_002–011 证实的机制）：面板里存在**触屏不接焦点的非文本 input 控件**
 * （如 input[type=range] 滑杆），而 pointerdown 处理器（dismissKeyboardOnPointerDown）对任何 input 落点
 * 都早退放行 ⇒ 拖滑杆时文本框**不真失焦**、保留 DOM 焦点，Android 随后交互把软键盘拉回文本框。
 *
 * 排查结论（本文件即证据）：
 * - 记录编辑面板（MobileBitableRecordSheet）：有 input[type=range] + 早退处理器 ⇒ **同型命中**，
 *   已按 FormView 同款本地收紧（bitablePointerFocus.onBitablePointerDown：只在文本输入控件落点放行聚焦）。
 * - 字段面板（MobileBitableFieldSheet）/ 修改字段面板（MobileBitableFieldEditorSheet）：控件全是
 *   文本输入 + 按钮（chips/开关/图标钮），**没有**触屏不接焦点的非文本 input ⇒ 同型触发面不存在；
 *   按钮落点在 FieldEditorSheet 由共享处理器收焦（FieldSheet 无处理器、按钮靠原生 tap 转焦），
 *   均无「回弹」路径 ⇒ **不改**（不许无证据改）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableField, createBitableFieldOptions, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";
import { MobileBitableRecordSheet } from "./MobileBitableRecordSheet";
import { MobileBitableFieldSheet } from "./MobileBitableFieldSheet";
import { MobileBitableFieldEditorSheet } from "./MobileBitableFieldEditorSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-10-20T00:00:00.000Z";
const textInputSel = 'input[aria-label="文本值"]';
const sliderSel = 'input[type="range"]';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const pointerDown = (el: Element) => el.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
const nonTextInputs = () => host.querySelectorAll('input[type="range"], input[type="checkbox"], input[type="radio"], input[type="file"], input[type="color"]');

describe("多维表各面板：拖滑杆/点控件不把焦点拉回文本框（261119 同型排查）", () => {
  it("记录编辑面板（同型命中并已修）：拖进度滑杆前文本框必须真失焦，拖动中/后不回弹；点文本框仍可聚焦", () => {
    const fields = [createBitableField("text", "标题", "f-text"), createBitableField("progress", "进度", "f-prog")];
    const table: BitableTable = { id: "t1", name: "任务表", activeViewId: "v1", views: [], fields, records: [] };
    const record: BitableRecord = { id: "r1", createdAt: ts, updatedAt: ts, values: { "f-text": "写交接", "f-prog": 60 } };
    const onPatch = vi.fn();
    act(() => root.render(createElement(MobileBitableRecordSheet, {
      noteId: "n1", table, fields, record, ctx: { tables: [table] },
      onPatch, onEditField: () => {}, onDelete: () => {}, onClose: () => {},
    })));
    const text = host.querySelector<HTMLInputElement>(textInputSel)!;
    const slider = host.querySelector<HTMLInputElement>(sliderSel)!;
    expect(text).toBeTruthy();
    expect(slider).toBeTruthy();
    // 同型机制复现点：文本框持焦时 pointerdown 落在滑杆上（共享处理器旧口径对 input 落点早退）
    act(() => text.focus());
    expect(document.activeElement).toBe(text);
    act(() => pointerDown(slider));
    // 修复口径：滑杆不是文本输入控件 ⇒ 文本框必须立刻真失焦（否则键盘被拉回）
    expect(document.activeElement).not.toBe(text);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(slider, "80"); slider.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(document.activeElement).not.toBe(text);
    expect(onPatch).toHaveBeenCalledWith("f-prog", 80);
    // 点文本框本身仍可正常聚焦编辑
    act(() => text.focus());
    expect(document.activeElement).toBe(text);
    act(() => pointerDown(text));
    expect(document.activeElement).toBe(text);
  });

  it("字段面板（无需修）：没有触屏不接焦点的非文本 input（同型触发面不存在），文本输入照常聚焦", () => {
    const fields = [createBitableField("text", "标题", "f-text")];
    const table: BitableTable = { id: "t1", name: "任务表", activeViewId: "v1", views: [], fields, records: [] };
    act(() => root.render(createElement(MobileBitableFieldSheet, {
      table, fields, onEdit: () => {}, onDelete: () => {}, onAdd: () => {}, onClose: () => {},
    })));
    // 进入「新建字段」后才有文本输入
    act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent || "").includes("新建字段"))!.click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="新字段名称"]');
    expect(input).toBeTruthy();
    // 结构证据：面板内没有任何滑杆/复选/文件/取色类 input ⇒ 「拖滑杆不拉回文本框」同型无从发生
    expect(nonTextInputs().length).toBe(0);
    // 文本输入照常聚焦（点它本身不受影响）
    act(() => input!.focus());
    expect(document.activeElement).toBe(input);
  });

  it("修改字段面板（无需修）：控件全是按钮/文本输入 —— 非文本 input 为 0；按钮落点收焦、文本落点放行", () => {
    const onSave = vi.fn();
    act(() => root.render(createElement(MobileBitableFieldEditorSheet, {
      open: true,
      field: { ...createBitableField("select", "状态", "f-s"), options: createBitableFieldOptions(["复盘"]) },
      hasData: false, onSave, onClose: () => {},
    })));
    // 结构证据：同型触发面（非文本 input）不存在
    expect(nonTextInputs().length).toBe(0);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="选项 1"]')!;
    expect(input).toBeTruthy();
    // 按钮落点（必填开关）：共享处理器收焦 ⇒ 文本框不留持焦状态
    act(() => input.focus());
    expect(document.activeElement).toBe(input);
    const switchBtn = host.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="必填"]')!;
    act(() => pointerDown(switchBtn));
    expect(document.activeElement).not.toBe(input);
    // 文本落点放行（正常聚焦编辑）
    act(() => input.focus());
    act(() => pointerDown(input));
    expect(document.activeElement).toBe(input);
  });
});
