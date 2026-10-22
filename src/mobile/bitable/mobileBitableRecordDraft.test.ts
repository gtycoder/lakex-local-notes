// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableField, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";

vi.mock("../ui/backStack", () => ({ pushBackHandler: () => () => undefined }));
vi.mock("../ui/useSwipeToClose", () => ({ useSwipeToClose: () => undefined }));

import { MobileBitableRecordSheet } from "./MobileBitableRecordSheet";

const fields = [createBitableField("text", "标题"), createBitableField("number", "数量")];
const table: BitableTable = {
  id: "t1", name: "任务表", activeViewId: "v1",
  views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
  fields, records: [],
};
const record: BitableRecord = {
  id: "r1", createdAt: "2026-01-01", updatedAt: "2026-01-01",
  values: { [fields[0].id]: "旧值", [fields[1].id]: "1" },
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("多维表记录面板 draft", () => {
  it("连续输入不逐字符上提，停顿 250ms 后只提交最终文本", () => {
    const onPatch = vi.fn();
    act(() => root.render(createElement(MobileBitableRecordSheet, {
      table, fields, record, ctx: { tables: [table] }, onPatch, onAddOption: () => null, onDelete: () => {}, onClose: () => {},
    })));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="文本值"]')!;
    act(() => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "新");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(input, "新值");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onPatch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(249));
    expect(onPatch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith(fields[0].id, "新值");
  });
});
