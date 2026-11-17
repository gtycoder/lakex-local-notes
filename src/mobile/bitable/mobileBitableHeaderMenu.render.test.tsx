// @vitest-environment jsdom
/**
 * P1-4（a）列头排序/筛选快捷入口（261117）：点列头弹菜单（升序/降序/筛选此字段）——
 * 落到现有视图状态模型（排序 = view.sorts 文档数据、筛选 = view.filters 视图配置数据），
 * 写回合成复用 core 纯函数（applySortMode / createBitableFilterRule，mobileBitableQuickActions）。
 *
 * 钉的行为：
 * - 编辑态列头可点（快捷入口；只读态列头保持纯展示，不给假入口）；
 * - 升序/降序：该列没有规则 ⇒ 插到最前当主排序键；已有规则 ⇒ 只换方式；
 * - 已排序列给「当前」标记与「清除排序」；单选/多选另给选项语义序；
 * - 「筛选此字段」= 追加一条共享默认规则（与视图配置「+ 字段」同一来源）并打开共享筛选编辑器。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createBitableField, type BitableTable, type BitableSortRule } from "../../core/bitableDoc";
import { MobileBitableViewer } from "./MobileBitableViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-01-01T00:00:00.000Z";
function tableWith(sorts?: BitableSortRule[]): BitableTable {
  const fields = [
    createBitableField("text", "标题", "fld_text"),
    createBitableField("select", "状态", "fld_sel"),
    createBitableField("date", "日期", "fld_date"),
  ];
  return {
    id: "tbl_a", name: "任务表", activeViewId: "vew_a",
    views: [{ id: "vew_a", name: "表格视图", type: "grid", rowHeight: "low", ...(sorts ? { sorts } : {}) }],
    fields,
    records: [
      { id: "rec_1", createdAt: ts, updatedAt: ts, values: { fld_text: "写交接" } },
      { id: "rec_2", createdAt: ts, updatedAt: ts, values: { fld_text: "对方案" } },
    ],
  };
}
const bodyOf = (table: BitableTable) => JSON.stringify({ kind: "bitable", version: 1, activeTableId: table.id, tables: [table] });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const headerBtn = (name: string) => host.querySelector<HTMLButtonElement>('button[aria-label="排序与筛选 ' + name + '"]');
const menuItem = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".mb-menusheet__item")].find((b) => b.querySelector(".mb-menusheet__label")?.textContent === label);
const menuLabels = () => [...host.querySelectorAll(".mb-menusheet__item .mb-menusheet__label")].map((el) => el.textContent);
const lastSorts = (onChange: Mock): BitableSortRule[] => {
  const body = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "{}") as { tables: BitableTable[] };
  return body.tables[0].views[0].sorts ?? [];
};

const renderViewer = (table: BitableTable, onChange: Mock) => act(() => {
  root.render(createElement(MobileBitableViewer, {
    noteId: "n-quick", content: bodyOf(table), editing: true, onChange,
  }));
});

describe("MobileBitableViewer（列头排序/筛选快捷入口）", () => {
  it("点列头弹菜单：升序/降序/筛选此字段；单选列另给选项语义序", async () => {
    const onChange = vi.fn();
    renderViewer(tableWith(), onChange);
    act(() => headerBtn("标题")!.click());
    expect(menuLabels()).toEqual(["升序", "降序", "筛选此字段"]);
    act(() => menuItem("升序")!.click());
    // 菜单关闭（.mb-menusheet 退场有 170ms 过渡，等它卸载）+ 升序写进 view.sorts（该列成为唯一/主排序键）
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    expect(host.querySelector(".mb-menusheet")).toBeNull();
    expect(lastSorts(onChange)).toEqual([{ fieldId: "fld_text", desc: false }]);

    act(() => headerBtn("状态")!.click());
    expect(menuLabels()).toEqual(["升序", "降序", "选项顺序", "选项逆序", "筛选此字段"]);
  });

  it("已有其它排序时点新列升序 = 该列升为主排序键（记录顺序真的会变）", () => {
    const onChange = vi.fn();
    renderViewer(tableWith([{ fieldId: "fld_date", desc: true }]), onChange);
    act(() => headerBtn("标题")!.click());
    act(() => menuItem("升序")!.click());
    expect(lastSorts(onChange).map((rule) => rule.fieldId)).toEqual(["fld_text", "fld_date"]);
  });

  it("已排序列：菜单标「当前」+「清除排序」；降序换方式；清除删规则", () => {
    const onChange = vi.fn();
    renderViewer(tableWith([{ fieldId: "fld_text" }]), onChange);
    act(() => headerBtn("标题")!.click());
    expect(menuLabels()).toEqual(["升序", "降序", "筛选此字段", "清除排序"]);
    expect(menuItem("升序")!.textContent).toContain("当前");

    act(() => menuItem("降序")!.click());
    expect(lastSorts(onChange)).toEqual([{ fieldId: "fld_text", desc: true }]);

    act(() => headerBtn("标题")!.click());
    act(() => menuItem("清除排序")!.click());
    expect(lastSorts(onChange)).toEqual([]);
  });

  it("「筛选此字段」= 追加共享默认规则并打开视图配置「筛选」页签（条件值走共享编辑器）", () => {
    const onChange = vi.fn();
    renderViewer(tableWith(), onChange);
    act(() => headerBtn("标题")!.click());
    act(() => menuItem("筛选此字段")!.click());
    const body = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "{}") as { tables: BitableTable[] };
    const filters = body.tables[0].views[0].filters ?? [];
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({ fieldId: "fld_text" });
    // 共享筛选编辑器（视图配置「筛选」页签）已打开
    expect(host.querySelector(".mb-sheet__title")?.textContent).toBe("视图配置");
    const filterTab = [...host.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "筛选");
    expect(filterTab?.getAttribute("aria-selected")).toBe("true");
  });

  it("只读态列头保持纯展示（无快捷入口，只读文档不写正文）", () => {
    const table = tableWith();
    act(() => {
      root.render(createElement(MobileBitableViewer, { noteId: "n-ro", content: bodyOf(table) }));
    });
    expect(headerBtn("标题")).toBeNull();
    expect(host.querySelector(".mbt-grid thead")?.textContent).toContain("标题");
  });
});
