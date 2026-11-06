// @vitest-environment jsdom
/**
 * 261030 用户点单：移动端多维表「新建视图」（优先表单）+「新增字段后自动进入修改字段」。
 *
 * 这里钉的是**交互行为**（真实挂载）：
 * - 视图面板：编辑态有「新建视图」入口，表单排第一且做成主按钮；只读态禁用并写明原因；
 * - 新建表单视图可用：建完自动切过去，且 formFieldIds 未配置时默认展示全部可填字段（可直接填写/提交）；
 * - 新增字段：创建后自动打开「修改字段」面板编辑新字段（字段面板保持打开，同铅笔路径层序）；
 * - 视图行 ⋯（261102）：打开「视图操作」面板（不触发切换）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableView, createDefaultBitableTable, type BitableTable } from "../../core/bitableDoc";
import { MobileBitableViewListSheet } from "./MobileBitableViewListSheet";
import { MobileBitableViewer } from "./MobileBitableViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const btn = (label: string, scope: ParentNode = host) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent || "").trim() === label);
const sheetTitles = () => [...host.querySelectorAll(".mb-sheet__title")].map((el) => el.textContent);

const baseTable = (): BitableTable => createDefaultBitableTable("数据表 1");
const bodyOf = (table: BitableTable) => JSON.stringify({ kind: "bitable", version: 1, activeTableId: table.id, tables: [table] });

const setInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

describe("MobileBitableViewListSheet（视图面板 + 新建视图）", () => {
  const table = baseTable();
  const renderSheet = (props: Partial<Parameters<typeof MobileBitableViewListSheet>[0]> = {}) => act(() => {
    root.render(createElement(MobileBitableViewListSheet, {
      open: true, table, activeViewId: table.activeViewId, editable: true,
      onSelect: () => undefined, onAddView: () => undefined, onViewActions: () => undefined, onClose: () => undefined, ...props,
    }));
  });

  it("只读态：新建视图禁用 + 明写原因（触屏没有 hover）", () => {
    renderSheet({ editable: false });
    expect(btn("新建视图")?.disabled).toBe(true);
    expect(host.textContent).toContain("只读状态不能新建视图");
  });

  it("编辑态：入口 → 5 种类型（表单主按钮排第一）→ 点选回调类型", () => {
    const onAddView = vi.fn();
    renderSheet({ onAddView });
    act(() => btn("新建视图")!.click());
    // 表单 = 主按钮（优先项），其余四种 = mb-chip
    expect(btn("新建表单视图")).toBeTruthy();
    expect([...host.querySelectorAll(".mb-chip")].map((chip) => chip.textContent)).toEqual([
      "表格视图", "看板视图", "画册视图", "日历视图",
    ]);
    act(() => btn("新建表单视图")!.click());
    expect(onAddView).toHaveBeenCalledWith("form");

    act(() => btn("新建视图")!.click());
    act(() => btn("看板视图")!.click());
    expect(onAddView).toHaveBeenLastCalledWith("kanban");
  });

  it("行内 ⋯ 打开「视图操作」（不触发切换）；选择按钮切视图", () => {
    const onViewActions = vi.fn();
    const onSelect = vi.fn();
    renderSheet({ onViewActions, onSelect });
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图操作 表格"]')!.click());
    expect(onViewActions).toHaveBeenCalledWith(table.activeViewId);
    expect(onSelect).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="选择视图 表格"]')!.click());
    expect(onSelect).toHaveBeenCalledWith(table.activeViewId);
  });
});

describe("MobileBitableViewer（新建表单视图 / 新增字段进编辑）", () => {
  it("编辑态单视图也有视图列表入口；新建表单视图后自动切过去，默认展示全部可填字段且能直接提交", async () => {
    const table = baseTable();
    const onChange = vi.fn();
    const onPersistNow = vi.fn(async (_content: string) => {});
    act(() => root.render(createElement(MobileBitableViewer, {
      noteId: "n-view-create", content: bodyOf(table), editing: true, onChange, onPersistNow,
    })));
    // 入口：单视图 + 编辑态 ⇒ 页签行出现（viewTabs.length > 1 || editable）
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图列表"]')!.click());
    act(() => btn("新建视图")!.click());
    act(() => btn("新建表单视图")!.click());

    const next = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "{}") as { tables: BitableTable[] };
    const views = next.tables[0].views;
    expect(views).toHaveLength(2);
    expect(views[1].type).toBe("form");
    // 不写默认题目：formFieldIds 缺省 = 未配置 ⇒ 两端默认展示全部可填字段
    expect(views[1].formFieldIds).toBeUndefined();

    // 自动切到新视图 + 页签行两枚；表单直接可用（字段 + 提交按钮）
    expect(host.querySelectorAll(".mbt-viewtab")).toHaveLength(2);
    expect(host.querySelector(".mbt-form-fields")).not.toBeNull();
    expect(host.querySelectorAll(".mbt-field")).toHaveLength(1);
    const area = host.querySelector<HTMLTextAreaElement>(".mbt-form-textarea")!;
    expect(area).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setter.call(area, "第一条"); area.dispatchEvent(new Event("input", { bubbles: true })); });
    const submit = btn("提交")!;
    await act(async () => { submit.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    // 建完即可填：提交 = 新增一条记录并立即落盘
    expect(onPersistNow).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(onPersistNow.mock.calls[0][0]) as { tables: BitableTable[] };
    expect(persisted.tables[0].records).toHaveLength(4); // 默认 3 行空记录 + 本次提交 1 行
    expect(persisted.tables[0].records.at(-1)?.values[persisted.tables[0].fields[0].id]).toBe("第一条");
  });

  it("新增字段后自动打开「修改字段」编辑新字段（先落字段、字段面板保持打开）", () => {
    const table = baseTable();
    const onChange = vi.fn();
    act(() => root.render(createElement(MobileBitableViewer, {
      noteId: "n-field-add", content: bodyOf(table), editing: true, onChange,
    })));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="字段管理"]')!.click());
    expect(sheetTitles()).toEqual(["字段：数据表 1"]);

    act(() => btn("添加字段")!.click());
    setInput(host.querySelector<HTMLInputElement>('input[aria-label="新字段名称"]')!, "截止日");
    act(() => btn("添加")!.click());

    // 字段已落库（commit 立即回调 onChange）
    const next = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "{}") as { tables: BitableTable[] };
    expect(next.tables[0].fields).toHaveLength(2);
    expect(next.tables[0].fields[1].name).toBe("截止日");
    expect(next.tables[0].fields[1].type).toBe("text");

    // 「修改字段」已打开并带着新字段（字段面板仍在下面一层，关闭后回到它）
    expect(sheetTitles()).toEqual(["字段：数据表 1", "修改字段"]);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="字段标题"]')!.value).toBe("截止日");
  });
});

// ---- 261105 P1：视图长按拖拽排序 ----

/** 三视图的表（grid / kanban / gallery ⇒ vew_a / vew_b / vew_c）。 */
function threeViewTable(): BitableTable {
  const table = createDefaultBitableTable("数据表 1", "tbl_a");
  const views = [
    createBitableView("grid", "表格", "vew_a"),
    createBitableView("kanban", "看板", "vew_b"),
    createBitableView("gallery", "画册", "vew_c"),
  ];
  return { ...table, views, activeViewId: views[0].id };
}

/** jsdom 没有 Touch/TouchEvent：手工造一个带 touches 的原生事件（React 委托在根容器上，泡泡能到）。 */
function dispatchTouch(target: EventTarget, type: string, clientY: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: 10, clientY, identifier: 1 }],
    configurable: true,
  });
  target.dispatchEvent(event);
}

/** 长按 + 拖到目标行（落点由 dropY 与目标行中线决定）；元素命中用 elementFromPoint 的桩。 */
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

describe("MobileBitableViewListSheet（视图长按拖拽排序）", () => {
  it("行带 data-view-id 且顺序 = 文档顺序；编辑态给「长按拖动可排序」提示", () => {
    const table = threeViewTable();
    act(() => {
      root.render(createElement(MobileBitableViewListSheet, {
        open: true, table, activeViewId: table.activeViewId, editable: true,
        onSelect: () => undefined, onAddView: () => undefined, onViewActions: () => undefined,
        onReorderViews: () => undefined, onClose: () => undefined,
      }));
    });
    expect([...host.querySelectorAll("[data-view-id]")].map((el) => el.getAttribute("data-view-id"))).toEqual([
      "vew_a", "vew_b", "vew_c",
    ]);
    expect(host.textContent).toContain("长按拖动可排序");
  });

  it("只读态 / 单视图：不起手、也不显示排序提示（视图顺序属正文）", () => {
    const table = threeViewTable();
    const single = { ...table, views: [table.views[0]], activeViewId: table.views[0].id };
    act(() => {
      root.render(createElement(MobileBitableViewListSheet, {
        open: true, table: single, activeViewId: single.activeViewId, editable: true,
        onSelect: () => undefined, onAddView: () => undefined, onViewActions: () => undefined, onClose: () => undefined,
      }));
    });
    expect(host.textContent).not.toContain("长按拖动可排序");

    act(() => {
      root.render(createElement(MobileBitableViewListSheet, {
        open: true, table, activeViewId: table.activeViewId, editable: false,
        onSelect: () => undefined, onAddView: () => undefined, onViewActions: () => undefined,
        onReorderViews: () => undefined, onClose: () => undefined,
      }));
    });
    expect(host.textContent).not.toContain("长按拖动可排序");
  });

  it("长按第二行拖到第一行上方 ⇒ onReorderViews(第二, 第一, before)；拖完不触发切换", async () => {
    const table = threeViewTable();
    const onReorderViews = vi.fn();
    const onSelect = vi.fn();
    act(() => {
      root.render(createElement(MobileBitableViewListSheet, {
        open: true, table, activeViewId: table.activeViewId, editable: true,
        onSelect, onAddView: () => undefined, onViewActions: () => undefined,
        onReorderViews, onClose: () => undefined,
      }));
    });
    const rows = () => [...host.querySelectorAll<HTMLElement>("[data-view-id]")];
    await longPressDrag(rows()[1], rows()[0], 10); // 10 < 中线 26 ⇒ before
    expect(onReorderViews).toHaveBeenCalledWith("vew_b", "vew_a", "before");
    // 拖拽那一次抬手后的 click 被吞掉（不会顺手切视图）
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="选择视图 看板"]')!.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("拖到目标行下半 ⇒ after；普通点击（没过长按阈值）照常切换", async () => {
    const table = threeViewTable();
    const onReorderViews = vi.fn();
    const onSelect = vi.fn();
    act(() => {
      root.render(createElement(MobileBitableViewListSheet, {
        open: true, table, activeViewId: table.activeViewId, editable: true,
        onSelect, onAddView: () => undefined, onViewActions: () => undefined,
        onReorderViews, onClose: () => undefined,
      }));
    });
    const rows = () => [...host.querySelectorAll<HTMLElement>("[data-view-id]")];
    await longPressDrag(rows()[0], rows()[2], 45); // 45 > 26 ⇒ after
    expect(onReorderViews).toHaveBeenCalledWith("vew_a", "vew_c", "after");
    // 真实点击 = 先 touchstart（复位"吞 click"标记）再 click ⇒ 正常切换
    await act(async () => { dispatchTouch(host.querySelector<HTMLElement>('button[aria-label="选择视图 看板"]')!, "touchstart", 5); });
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="选择视图 看板"]')!.click());
    expect(onSelect).toHaveBeenCalledWith("vew_b");
  });
});
describe("MobileBitableViewer（视图排序写回正文）", () => {
  it("面板里长按拖拽后，onChange 的正文 views 顺序变了（顺序属文档数据，不是设备本地偏好）", async () => {
    const table = threeViewTable();
    const onChange = vi.fn();
    act(() => root.render(createElement(MobileBitableViewer, {
      noteId: "n-view-order", content: bodyOf(table), editing: true, onChange,
    })));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图列表"]')!.click());
    const rows = () => [...host.querySelectorAll<HTMLElement>("[data-view-id]")];
    expect(rows().map((el) => el.getAttribute("data-view-id"))).toEqual(["vew_a", "vew_b", "vew_c"]);

    await longPressDrag(rows()[0], rows()[2], 45); // 拖到最后一行下半 ⇒ after
    const next = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "{}") as { tables: BitableTable[] };
    expect(next.tables[0].views.map((view) => view.id)).toEqual(["vew_b", "vew_c", "vew_a"]);
    // 页签顺序跟着正文顺序走（重开文档也从正文读）
    expect([...host.querySelectorAll(".mbt-viewtab")].map((el) => el.textContent)).toEqual(["看板", "画册", "表格"]);
  });
});
