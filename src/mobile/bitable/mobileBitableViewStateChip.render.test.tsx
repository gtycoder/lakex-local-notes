// @vitest-environment jsdom
/**
 * 只读态「视图状态」chip（261103 六批 B1）接线测试。
 *
 * 钉住：
 * - 只读 + 当前视图有筛选/排序/分组 ⇒ 第 2 行出现 chip（文案同面板口径）；点击打开只读面板（落到对应页签）；
 * - 只读 + 无状态 ⇒ 不出现空 chip；
 * - 编辑态 ⇒ 不出现 chip（编辑态已有「筛选」按钮，避免两个入口）；
 * - 只读面板里没有任何可用的编辑动作（删除规则/添加都是禁用/不存在）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBitableFilterRule, createDefaultBitableTable, type BitableTable } from "../../core/bitableDoc";
import { MobileBitableViewer } from "./MobileBitableViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const rule = (fieldId: string) => createBitableFilterRule({ id: fieldId, name: fieldId, type: "text" });
const bodyOf = (table: BitableTable) => JSON.stringify({ kind: "bitable", version: 1, activeTableId: table.id, tables: [table] });

function tableWithState(): BitableTable {
  const table = createDefaultBitableTable("数据表 1");
  table.views[0] = {
    ...table.views[0],
    filters: [rule("f1"), rule("f2")],
    sorts: [{ fieldId: "f1" }],
    groups: [{ fieldId: "f1" }],
  };
  return table;
}

const render = async (editing: boolean, table: BitableTable) => {
  await act(async () => {
    root.render(createElement(MobileBitableViewer, { noteId: "n-state-chip", content: bodyOf(table), editing, onChange: () => undefined }));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
};
const chip = () => host.querySelector<HTMLButtonElement>(".mbt-viewstate-chip");

describe("只读态视图状态 chip（B1）", () => {
  it("只读 + 有筛选/排序/分组：显示摘要 chip，点击打开只读面板并落到筛选页签", async () => {
    await render(false, tableWithState());
    const el = chip();
    expect(el).toBeTruthy();
    expect(el!.textContent).toBe("已筛选 2 · 已排序 1 · 已分组 1");
    expect(el!.getAttribute("aria-label")).toBe("视图状态：已筛选 2 · 已排序 1 · 已分组 1");
    // 第 2 行存在（单视图只读本来不渲染第 2 行，但 chip 需要它）
    expect(host.querySelector(".mbt-header__row2")).toBeTruthy();

    act(() => el!.click());
    expect([...host.querySelectorAll(".mb-sheet__title")].map((n) => n.textContent)).toEqual(["视图配置"]);
    // 落到筛选页签 + 只读说明
    expect(host.querySelector(".mbt-vcfg-tab.is-on")?.textContent).toBe("筛选");
    expect(host.textContent).toContain("只读状态下不能修改筛选");
    // 无可用编辑动作：删除规则按钮不存在，添加按钮是禁用态
    expect(host.querySelector('[aria-label="删除筛选规则"]')).toBeNull();
    const add = [...host.querySelectorAll<HTMLButtonElement>(".mb-sheet button")].find((b) => (b.textContent || "").includes("筛选条件"));
    expect(add?.disabled).toBe(true);
    // 没有保存类入口
    expect([...host.querySelectorAll(".mb-sheet button")].some((b) => (b.textContent || "").trim() === "保存")).toBe(false);
  });

  it("只读 + 无筛选/排序/分组：不显示空 chip（单视图只读第 2 行也不渲染）", async () => {
    await render(false, createDefaultBitableTable("数据表 1"));
    expect(chip()).toBeNull();
    expect(host.querySelector(".mbt-header__row2")).toBeNull();
  });

  it("编辑态：即使有视图状态也不出现 chip（编辑态用第 1 行的「筛选」按钮）", async () => {
    await render(true, tableWithState());
    expect(chip()).toBeNull();
    expect(host.querySelector('button[aria-label="筛选"]')).toBeTruthy();
  });
});
