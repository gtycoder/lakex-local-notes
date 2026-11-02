// @vitest-environment jsdom
/**
 * 261102 用户点单：移动端多维表「视图操作」= 重命名 / 复制 / 删除。
 *
 * 钉住：
 * - 操作面板三项与重命名提交、复制/删除回调；只读置灰 + 理由；只剩一个视图时删除禁用；
 * - 删除二次确认（写明视图名、说明只删视图配置不动记录）；
 * - viewer 接线：复制后切到副本、删除当前视图后回落到第一个视图（导航 + 正文都正确）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableView, createDefaultBitableTable, type BitableTable } from "../../core/bitableDoc";
import { MobileBitableViewActions } from "./MobileBitableViewActions";
import { MobileBitableViewer } from "./MobileBitableViewer";

const mocks = vi.hoisted(() => ({ confirmMobile: vi.fn() }));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.confirmMobile.mockReset();
  mocks.confirmMobile.mockResolvedValue(true);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const row = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".mbt-action-row")].find((el) => (el.textContent || "").includes(text))!;
const btn = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent || "").trim() === label);
const sheetTitles = () => [...host.querySelectorAll(".mb-sheet__title")].map((el) => el.textContent);
const activeTab = () => host.querySelector(".mbt-viewtab.is-active")?.textContent ?? "";
const bodyOf = (table: BitableTable) => JSON.stringify({ kind: "bitable", version: 1, activeTableId: table.id, tables: [table] });
const viewsOf = (content: string) => (JSON.parse(content) as { tables: BitableTable[] }).tables[0].views;

const setInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

/** 两张视图的表（第一张为当前视图）。 */
function twoViewTable(): BitableTable {
  const table = createDefaultBitableTable("数据表 1");
  table.views = [table.views[0], createBitableView("grid", "备用视图", "v-second")];
  table.activeViewId = table.views[0].id;
  return table;
}

describe("MobileBitableViewActions（视图操作面板）", () => {
  const props = { open: true, viewName: "备用视图", editable: true, canDelete: true, onRename: () => undefined, onDuplicate: () => undefined, onDelete: () => undefined, onClose: () => undefined };
  const render = (patch: Partial<typeof props> = {}) => act(() => { root.render(createElement(MobileBitableViewActions, { ...props, ...patch })); });

  it("菜单三项齐全；重命名进入输入并提交；复制回调", () => {
    const onRename = vi.fn();
    const onDuplicate = vi.fn();
    render({ onRename, onDuplicate });
    expect([...host.querySelectorAll(".mbt-action-row")].map((el) => el.textContent)).toEqual(["重命名", "复制视图", "删除视图"]);
    act(() => row("重命名").click());
    expect(host.textContent).toContain("重命名视图");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="视图名称"]')!;
    expect(input.value).toBe("备用视图");
    setInput(input, "新视图名");
    act(() => btn("确定")!.click());
    expect(onRename).toHaveBeenCalledWith("新视图名");
    // 回到菜单再点复制（真实父级会在回调后关面板）
    act(() => btn("取消")!.click());
    act(() => row("复制视图").click());
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("删除 = 二次确认（写明视图名与「记录不受影响」）后才回调", async () => {
    const onDelete = vi.fn();
    render({ onDelete });
    await act(async () => { row("删除视图").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.confirmMobile).toHaveBeenCalledTimes(1);
    const opts = mocks.confirmMobile.mock.calls[0][0] as { title: string; body: string };
    expect(opts.title).toContain("删除视图");
    expect(opts.body).toContain("备用视图");
    expect(opts.body).toContain("记录本身不受影响");
    expect(onDelete).toHaveBeenCalledTimes(1);
    // 用户取消 ⇒ 不删
    mocks.confirmMobile.mockResolvedValueOnce(false);
    onDelete.mockClear();
    await act(async () => { row("删除视图").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("只读态三项全禁用并写明理由；只剩一个视图时删除禁用并提示", () => {
    render({ editable: false, canDelete: false });
    expect([...host.querySelectorAll<HTMLButtonElement>(".mbt-action-row")].every((el) => el.disabled)).toBe(true);
    expect(host.textContent).toContain("只读状态不能修改视图");
    render({ editable: true, canDelete: false });
    expect(row("删除视图").disabled).toBe(true);
    expect(host.textContent).toContain("至少保留一个视图");
  });
});

describe("MobileBitableViewer（视图操作接线）", () => {
  it("⋯ 打开操作面板；复制后切到副本；删除当前视图后回落到第一个视图", async () => {
    const table = twoViewTable();
    const onChange = vi.fn();
    act(() => root.render(createElement(MobileBitableViewer, { noteId: "n-view-actions", content: bodyOf(table), editing: true, onChange })));

    // ⋯ → 操作面板（261102：打开操作面板时视图列表先关闭，避免两个 sheet 叠着）
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图列表"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图操作 备用视图"]')!.click());
    expect(sheetTitles()).toEqual(["备用视图"]);

    // 复制 = 新视图 + 名称「 副本」+ 自动切过去
    act(() => row("复制视图").click());
    let views = viewsOf(onChange.mock.calls.at(-1)?.[0] ?? "{}");
    expect(views).toHaveLength(3);
    expect(views[2].name).toBe("备用视图 副本");
    expect(host.querySelectorAll(".mbt-viewtab")).toHaveLength(3);
    expect(activeTab()).toBe("备用视图 副本");
    expect(sheetTitles()).toEqual([]);

    // 删除刚复制的当前视图 ⇒ 回落到第一个视图
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图列表"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图操作 备用视图 副本"]')!.click());
    await act(async () => { row("删除视图").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.confirmMobile).toHaveBeenCalledTimes(1);
    views = viewsOf(onChange.mock.calls.at(-1)?.[0] ?? "{}");
    expect(views).toHaveLength(2);
    expect(views.map((view) => view.name)).toEqual(["表格视图", "备用视图"]);
    expect(host.querySelectorAll(".mbt-viewtab")).toHaveLength(2);
    expect(activeTab()).toBe("表格视图");
    expect(sheetTitles()).toEqual([]);
  });

  it("重命名写回正文（视图名是文档数据），操作面板关闭、重开列表能看到新名字", () => {
    const table = twoViewTable();
    const onChange = vi.fn();
    act(() => root.render(createElement(MobileBitableViewer, { noteId: "n-view-rename", content: bodyOf(table), editing: true, onChange })));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图列表"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图操作 表格视图"]')!.click());
    act(() => row("重命名").click());
    setInput(host.querySelector<HTMLInputElement>('input[aria-label="视图名称"]')!, "内容视图");
    act(() => btn("确定")!.click());

    const views = viewsOf(onChange.mock.calls.at(-1)?.[0] ?? "{}");
    expect(views[0].name).toBe("内容视图");
    // 只关操作面板（打开操作面板时列表已关闭）；重开列表能看到新名字
    expect(sheetTitles()).toEqual([]);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="视图列表"]')!.click());
    expect(host.querySelector(".mbt-viewlist-rows")?.textContent).toContain("内容视图");
  });
});
