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
import { createDefaultBitableTable, type BitableTable } from "../../core/bitableDoc";
import { MobileBitableViewListSheet } from "./MobileBitableViewListSheet";
import { MobileBitableViewer } from "./MobileBitableViewer";

// 本文件验**手机**（compact）的工具条/面板语义：jsdom 默认 1024 宽会命中平板 expanded 分支（9 项工具条），
// 这里把视口钉到 412。
Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 412 });
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
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图操作 表格视图"]')!.click());
    expect(onViewActions).toHaveBeenCalledWith(table.activeViewId);
    expect(onSelect).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="选择视图 表格视图"]')!.click());
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
