// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableField, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";
import { consumeBack } from "../ui/backStack";
import { MobileBitableFieldSheet } from "./MobileBitableFieldSheet";
import { MobileBitableRecordSheet } from "./MobileBitableRecordSheet";

/**
 * MOB-11 收尾：多维表「字段」「记录」面板迁到 MobileSheet 后，
 * 返回栈 / 遮罩 / 关闭 / 内容不丢由原语负责。字段类型渲染仍由
 * mobileBitableRecordSheet.test.ts（静态标记）钉住，这里是接线级真实挂载。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fields = [createBitableField("text", "标题"), createBitableField("number", "数量")];
const table: BitableTable = {
  id: "t1", name: "任务表", activeViewId: "v1",
  views: [{ id: "v1", name: "表格视图", type: "grid", rowHeight: "low" }],
  fields, records: [],
};
const record: BitableRecord = {
  id: "r1", createdAt: "2026-01-01", updatedAt: "2026-01-01",
  values: { [fields[0].id]: "写交接", [fields[1].id]: "3" },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

const renderFieldSheet = (onClose: () => void) => act(() => {
  root.render(createElement(MobileBitableFieldSheet, {
    table, fields, onRename: () => undefined, onDelete: () => undefined, onAdd: () => undefined, onClose,
  }));
});

const renderRecordSheet = (onClose: () => void) => act(() => {
  root.render(createElement(MobileBitableRecordSheet, {
    table, fields, record, ctx: { tables: [table] }, onPatch: () => undefined, onAddOption: () => null, onDelete: () => undefined, onClose,
  }));
});

describe("MobileBitableFieldSheet 迁到 MobileSheet（MOB-11）", () => {
  it("标题类名逐字保留；返回键/遮罩/× 都关面板", () => {
    const onClose = vi.fn();
    renderFieldSheet(onClose);
    expect(host.querySelector(".mb-sheet")).not.toBeNull();
    expect(host.querySelector(".mb-sheet__title")?.className).toBe("mb-sheet__title mb-ellipsis");
    expect(host.querySelector(".mb-sheet__title")?.textContent).toBe("字段：任务表");
    // 无障碍名沿用原手写版的 "字段管理"（标题带表名，不能直接拿标题当 aria-label）
    expect(host.querySelector('[aria-label="字段管理"]')).toBe(host.querySelector(".mb-sheet"));

    let consumed = false;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => { host.querySelector(".mb-scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    act(() => { (host.querySelector('button[aria-label="关闭"]') as HTMLElement | null)?.click(); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("内容不丢：字段行与「添加字段」都在 .mb-sheet__body 里", () => {
    renderFieldSheet(() => undefined);
    expect(host.querySelector(".mb-set-section")?.textContent).toContain("标题");
    expect(host.querySelector(".mb-set-section")?.textContent).toContain("数量");
    expect(host.querySelector(".mbt-field-add .mb-btn")?.textContent).toContain("添加字段");
  });

  it("卸载后不占返回栈", () => {
    renderFieldSheet(() => undefined);
    act(() => root.unmount());
    let consumed = true;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(false);
  });
});

describe("MobileBitableRecordSheet 迁到 MobileSheet（MOB-11）", () => {
  it("标题/正文类名逐字保留；返回键/遮罩/× 都关面板", () => {
    const onClose = vi.fn();
    renderRecordSheet(onClose);
    expect(host.querySelector(".mb-sheet__title")?.className).toBe("mb-sheet__title mb-ellipsis");
    expect(host.querySelector(".mb-sheet__title")?.textContent).toBe("编辑记录：任务表");
    expect(host.querySelector(".mb-sheet__body")?.className).toBe("mb-sheet__body mb-sheet__body--form");

    let consumed = false;
    act(() => { consumed = consumeBack(); });
    expect(consumed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => { host.querySelector(".mb-scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    act(() => { (host.querySelector('button[aria-label="关闭"]') as HTMLElement | null)?.click(); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("内容不丢：字段行与删除入口都在正文里", () => {
    renderRecordSheet(() => undefined);
    const body = host.querySelector(".mb-sheet__body");
    expect(body?.textContent).toContain("标题");
    expect(body?.textContent).toContain("数量");
    expect(body?.textContent).toContain("删除记录");
    expect((host.querySelector('input[aria-label="文本值"]') as HTMLInputElement).value).toBe("写交接");
  });
});
