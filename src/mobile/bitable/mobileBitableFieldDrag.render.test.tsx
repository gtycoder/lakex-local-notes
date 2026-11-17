// @vitest-environment jsdom
/**
 * P1-4（b）字段拖拽重排（261117）：「字段」面板长按行拖动 = **视图字段顺序**（view.fieldOrder，视图级配置）。
 * 手势 = useBitableOrderDrag（与视图列表同一份实现：长按 ui/useLongPress、document move/up/cancel、
 * 行中线判 before/after、拖完吞一次 click）；写回 = mobileBitableFieldOrder 纯函数（桌面同语义）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableField, type BitableField, type BitableTable } from "../../core/bitableDoc";
import { MobileBitableFieldSheet } from "./MobileBitableFieldSheet";
import { MobileBitableViewer } from "./MobileBitableViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-01-01T00:00:00.000Z";
const fields: BitableField[] = [
  createBitableField("text", "标题", "fld_a"),
  createBitableField("number", "数量", "fld_b"),
  createBitableField("date", "日期", "fld_c"),
];
const table: BitableTable = {
  id: "tbl_a", name: "任务表", activeViewId: "vew_a",
  views: [{ id: "vew_a", name: "表格视图", type: "grid", rowHeight: "low" }],
  fields, records: [{ id: "rec_1", createdAt: ts, updatedAt: ts, values: { fld_a: "写交接" } }],
};
const bodyOf = (value: BitableTable) => JSON.stringify({ kind: "bitable", version: 1, activeTableId: value.id, tables: [value] });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

/** jsdom 没有 Touch/TouchEvent：手工造一个带 touches 的原生事件（与视图拖拽同一套测试口径）。 */
function dispatchTouch(target: EventTarget, type: string, clientY: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: 10, clientY, identifier: 1 }],
    configurable: true,
  });
  target.dispatchEvent(event);
}

/** 长按 + 拖到目标行（dropY 与目标行中线决定 before/after）；元素命中用 elementFromPoint 的桩。 */
async function longPressDrag(sourceRow: HTMLElement, overRow: HTMLElement, dropY: number): Promise<void> {
  const original = document.elementFromPoint;
  Object.defineProperty(document, "elementFromPoint", { value: () => overRow, configurable: true });
  try {
    Object.defineProperty(overRow, "getBoundingClientRect", {
      value: () => ({ top: 0, height: 52, bottom: 52, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    });
    await act(async () => { dispatchTouch(sourceRow, "touchstart", 5); });
    // 长按阈值 350ms（ui/useLongPress 的唯一实现）
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 380)); });
    await act(async () => { dispatchTouch(document, "touchmove", dropY); });
    await act(async () => { dispatchTouch(document, "touchend", dropY); });
  } finally {
    Object.defineProperty(document, "elementFromPoint", { value: original, configurable: true });
  }
}

const rows = () => [...host.querySelectorAll<HTMLElement>("[data-field-id]")];

describe("MobileBitableFieldSheet（字段长按拖拽重排）", () => {
  const renderSheet = (extra: Record<string, unknown> = {}, list: BitableField[] = fields) => act(() => {
    root.render(createElement(MobileBitableFieldSheet, {
      table, fields: list, onEdit: () => undefined, onDelete: () => undefined, onAdd: () => undefined,
      onReorderFields: () => undefined, onClose: () => undefined, ...extra,
    }));
  });

  it("行按传入顺序渲染（= 视图字段顺序）并给「长按拖动可排序」提示；单字段不起手", () => {
    renderSheet();
    expect(rows().map((row) => row.getAttribute("data-field-id"))).toEqual(["fld_a", "fld_b", "fld_c"]);
    expect(host.textContent).toContain("长按拖动可排序");

    renderSheet({}, [fields[0]]);
    expect(host.textContent).not.toContain("长按拖动可排序");
  });

  it("长按第三行拖到第一行上方 ⇒ onReorderFields(第三, 第一, before)；拖完补发的 click 被吞（不误触铅笔）", async () => {
    const onReorderFields = vi.fn();
    const onEdit = vi.fn();
    renderSheet({ onReorderFields, onEdit });
    await longPressDrag(rows()[2], rows()[0], 5);
    expect(onReorderFields).toHaveBeenCalledWith("fld_c", "fld_a", "before");

    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="修改字段 标题"]')!.click(); });
    expect(onEdit).not.toHaveBeenCalled();

    // 普通点击（没过长按阈值）照常触发
    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="修改字段 标题"]')!.click(); });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("拖到目标行下半 ⇒ after", async () => {
    const onReorderFields = vi.fn();
    renderSheet({ onReorderFields });
    await longPressDrag(rows()[0], rows()[2], 40);
    expect(onReorderFields).toHaveBeenCalledWith("fld_a", "fld_c", "after");
  });
});

describe("MobileBitableViewer（字段拖拽写回 view.fieldOrder）", () => {
  it("字段面板拖拽后，正文里当前视图的 fieldOrder 变了（列顺序 = 视图级配置）", async () => {
    const onChange = vi.fn();
    act(() => root.render(createElement(MobileBitableViewer, {
      noteId: "n-field-drag", content: bodyOf(table), editing: true, onChange,
    })));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="字段管理"]')!.click());
    await longPressDrag(rows()[2], rows()[0], 5);

    const body = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "{}") as { tables: BitableTable[] };
    expect(body.tables[0].views[0].fieldOrder).toEqual(["fld_c", "fld_a", "fld_b"]);
    // 全局字段顺序不动（列顺序是视图级配置）
    expect(body.tables[0].fields.map((field) => field.id)).toEqual(["fld_a", "fld_b", "fld_c"]);
  });
});
