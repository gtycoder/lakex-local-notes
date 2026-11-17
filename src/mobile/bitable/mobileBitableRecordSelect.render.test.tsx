// @vitest-environment jsdom
/**
 * 记录面板单选/多选选择器（261117 用户点单重做，二稿「项移动」模型）：
 * 折叠只显示已选 → 点箭头/行展开候选 → **选中的项移动到上方已选区、候选区只留未选中**（不重复）；
 * 点候选 = 移上来（单选取代/多选追加）、点已选 = 移回下方；「新建选项」跳字段编辑器。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBitableField, createBitableFieldOptions, type BitableRecord, type BitableTable } from "../../core/bitableDoc.js";
import { MobileBitableRecordSheet } from "./MobileBitableRecordSheet";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const selectField = { ...createBitableField("select", "状态", "f-sel"), options: createBitableFieldOptions(["进行中", "已完成"]) };
const multiField = { ...createBitableField("multiSelect", "标签", "f-multi"), options: createBitableFieldOptions(["重要", "紧急", "一般"]) };
const table: BitableTable = { id: "t1", name: "任务表", activeViewId: "v1", views: [{ id: "v1", name: "表格", type: "grid", rowHeight: "low" }], fields: [selectField, multiField], records: [] };
const valueFor = (select: string, multi: string[]): BitableRecord => ({
  id: "r1", createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
  values: { [selectField.id]: select, [multiField.id]: multi },
});

const render = async (record: BitableRecord, onPatch = vi.fn(), onEditField = vi.fn()) => {
  await act(async () => {
    root.render(createElement(MobileBitableRecordSheet, {
      noteId: "n1", table, fields: [selectField, multiField], record, ctx: { tables: [table] },
      onPatch, onEditField, onDelete: () => {}, onClose: () => {},
    }));
  });
  return { onPatch, onEditField };
};
const selectChosen = () => [...host.querySelectorAll<HTMLButtonElement>('.mbt-select__chosen [aria-label^="取消 "]')].map((b) => b.getAttribute("aria-label")!.replace("取消 ", ""));
const candidateNames = () => [...host.querySelectorAll<HTMLButtonElement>(".mbt-select__options button")].map((b) => (b.textContent || "").trim());
const toggleOf = (index: number) => host.querySelectorAll<HTMLButtonElement>(".mbt-select__toggle")[index];
const ensureOpen = async (index = 0) => { if (!host.querySelector(".mbt-select__options")) await act(async () => { toggleOf(index).click(); }); };

describe("记录面板选择器（项移动模型）", () => {
  it("折叠只显示已选；展开后候选区只留未选中（同一选项不重复出现）", async () => {
    await render(valueFor(selectField.options?.[0].id ?? "", [multiField.options?.[1].id ?? ""]));
    expect(selectChosen()).toEqual(["进行中", "紧急"]);
    expect(host.textContent).not.toContain("已完成");
    expect(host.textContent).not.toContain("重要");
    await act(async () => { toggleOf(0).click(); });
    // 去重：已选的（进行中）不在候选区；候选只有未选中（已完成）+ 新建选项
    expect(candidateNames()).toEqual(["已完成", "新建选项"]);
  });

  it("点候选 = 移上来（单选取代：旧项移回下方）；点已选 = 移回下方", async () => {
    const { onPatch } = await render(valueFor(selectField.options?.[0].id ?? "", []));
    await act(async () => { toggleOf(0).click(); });
    // 项移动后候选区只有一个未选中项（进行中已上移）
    expect(candidateNames()).toEqual(["已完成", "新建选项"]);
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('.mbt-select__options [role="radio"]')][0].click(); });
    expect(onPatch).toHaveBeenCalledWith("f-sel", selectField.options?.[1].id);
    // 用新值重渲染 ⇒ 项移动：已完成上移、进行中回到候选（沿用同一个 mock）
    await render(valueFor(selectField.options?.[1].id ?? "", []), onPatch);
    await ensureOpen(0);
    expect(selectChosen()).toEqual(["已完成"]);
    expect(candidateNames()).toContain("进行中");
    // 点已选项 = 取消
    await act(async () => { host.querySelector<HTMLButtonElement>('.mbt-select__chosen [aria-label^="取消 "]')!.click(); });
    expect(onPatch).toHaveBeenLastCalledWith("f-sel", "");
  });

  it("多选点候选追加、点已选移除；新建选项跳字段编辑器并收起", async () => {
    const { onPatch, onEditField } = await render(valueFor("", [multiField.options?.[1].id ?? ""]));
    await act(async () => { toggleOf(1).click(); }); // 第二个字段（标签）的选择器
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('.mbt-select__options [role="checkbox"]')][0].click(); });
    expect(onPatch).toHaveBeenCalledWith("f-multi", expect.arrayContaining([expect.any(String)]));
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('.mbt-select__chosen [aria-label^="取消 "]')].find((b) => b.getAttribute("aria-label") === "取消 紧急")!.click(); });
    expect(onPatch).toHaveBeenLastCalledWith("f-multi", expect.not.arrayContaining([multiField.options?.[1].id ?? ""]));
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>(".mbt-select__options button")].find((b) => b.textContent?.includes("新建选项"))!.click(); });
    expect(onEditField).toHaveBeenCalledWith("f-multi");
    expect(host.querySelector(".mbt-select__options"), "跳编辑器时收起").toBeNull();
  });
});
