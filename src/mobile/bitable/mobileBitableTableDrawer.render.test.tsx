// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableTableDrawer } from "./MobileBitableTableDrawer";
import { createDefaultBitableTable } from "../../core/bitableDoc";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const tables = [createDefaultBitableTable("1 财智复盘", "t1"), createDefaultBitableTable("2 资料收集", "t2")];
const props = { open: true, tables, activeTableId: "t2", editable: false, onSelect: () => {}, onCreate: () => {}, onActions: () => {}, onClose: () => {} };

describe("MobileBitableTableDrawer（多数据表切换，对齐钉钉）", () => {
  it("打开时列出全部数据表、当前项高亮、可搜索、点行切换", () => {
    const onSelect = vi.fn();
    act(() => root.render(createElement(MobileBitableTableDrawer, { ...props, onSelect })));
    expect(host.querySelector('[role="dialog"][aria-label="数据表"]')).toBeTruthy();
    const rows = [...host.querySelectorAll<HTMLElement>(".mbt-drawer__row")];
    expect(rows.map((r) => r.querySelector(".mbt-drawer__name")?.textContent)).toEqual(["1 财智复盘", "2 资料收集"]);
    expect(rows[1].className).toContain("is-on");
    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索数据表"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "资料");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll(".mbt-drawer__row").length).toBe(1);
    act(() => host.querySelector<HTMLElement>(".mbt-drawer__row")!.click());
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("只读态新建数据表禁用并写明理由；编辑态可点", () => {
    const onCreate = vi.fn();
    act(() => root.render(createElement(MobileBitableTableDrawer, { ...props, activeTableId: "t1", onCreate })));
    const createBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent || "").includes("新建数据表"))!;
    expect(createBtn.disabled).toBe(true);
    expect(host.textContent).toContain("只读状态不能新建数据表");
    act(() => root.render(createElement(MobileBitableTableDrawer, { ...props, activeTableId: "t1", editable: true, onCreate })));
    const enabled = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent || "").includes("新建数据表"))!;
    expect(enabled.disabled).toBe(false);
    act(() => enabled.click());
    expect(onCreate).toHaveBeenCalled();
  });

  it("行内 ⋮ 把表 id 交给父级（操作面板在外层，避免与抽屉抢层序）", () => {
    const onActions = vi.fn();
    act(() => root.render(createElement(MobileBitableTableDrawer, { ...props, editable: true, onActions })));
    const more = host.querySelector<HTMLButtonElement>(".mbt-drawer__more")!;
    expect(more.getAttribute("aria-label")).toContain("数据表操作");
    act(() => more.click());
    expect(onActions).toHaveBeenCalledWith("t1");
  });
});
