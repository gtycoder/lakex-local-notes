// @vitest-environment jsdom
/**
 * 记录面板单选/多选折叠式选择器（261117 用户点单重做）：
 * 折叠只显示已选 → 点摘要展开候选 → 单选点选即收起 / 多选连选 → 新建选项跳字段编辑器；
 * 选中态 = 勾选 + 主色选中三件套（不再被选项色底淹没）。
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
const multiField = { ...createBitableField("multiSelect", "标签", "f-multi"), options: createBitableFieldOptions(["重要", "紧急"]) };
const table: BitableTable = { id: "t1", name: "任务表", activeViewId: "v1", views: [{ id: "v1", name: "表格", type: "grid", rowHeight: "low" }], fields: [selectField, multiField], records: [] };
const record: BitableRecord = {
  id: "r1", createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
  values: { [selectField.id]: selectField.options?.[0].id ?? "", [multiField.id]: [multiField.options?.[1].id ?? ""] },
};

const render = async (onPatch = vi.fn(), onEditField = vi.fn()) => {
  await act(async () => {
    root.render(createElement(MobileBitableRecordSheet, {
      noteId: "n1", table, fields: [selectField, multiField], record, ctx: { tables: [table] },
      onPatch, onEditField, onDelete: () => {}, onClose: () => {},
    }));
  });
  return { onPatch, onEditField };
};
const summaryOf = (name: string) => [...host.querySelectorAll<HTMLButtonElement>(".mbt-select__summary")]
  .find((b) => b.getAttribute("aria-label")?.startsWith(name + "："))!;
const optionsOpen = () => host.querySelectorAll(".mbt-select__options").length;

describe("记录面板单选/多选折叠式选择器", () => {
  it("默认折叠只显示已选值；点摘要展开候选（未选中的不平铺）", async () => {
    await render();
    expect(optionsOpen()).toBe(0);
    expect(summaryOf("状态").textContent).toContain("进行中");
    expect(host.textContent).not.toContain("已完成");
    await act(async () => { summaryOf("状态").click(); });
    expect(optionsOpen()).toBe(1);
    expect(host.textContent).toContain("已完成");
  });

  it("选中态 = 勾选 + is-on（不被选项色底淹没）；单选点选即完成并收起", async () => {
    const { onPatch } = await render();
    await act(async () => { summaryOf("状态").click(); });
    const chosen = host.querySelector<HTMLButtonElement>('.mbt-select__options [role="radio"][aria-checked="true"]')!;
    expect(chosen.className).toContain("is-on");
    expect(chosen.querySelector("svg.lucide-check")).not.toBeNull();
    expect(chosen.getAttribute("style")).toBeNull(); // 选中不铺选项色底
    const option2 = [...host.querySelectorAll<HTMLButtonElement>('.mbt-select__options [role="radio"]')][1];
    await act(async () => { option2.click(); });
    expect(onPatch).toHaveBeenCalledWith("f-sel", expect.any(String));
    expect(optionsOpen(), "单选点选即收起").toBe(0);
  });

  it("多选可连选不自动收起；再点摘要收起；新建选项跳字段编辑器", async () => {
    const { onPatch, onEditField } = await render();
    await act(async () => { summaryOf("标签").click(); });
    const boxes = [...host.querySelectorAll<HTMLButtonElement>('.mbt-select__options [role="checkbox"]')];
    await act(async () => { boxes[0].click(); });
    expect(onPatch).toHaveBeenCalledWith("f-multi", expect.arrayContaining([expect.any(String)]));
    expect(optionsOpen(), "多选保持展开").toBe(1);
    await act(async () => { summaryOf("标签").click(); });
    expect(optionsOpen()).toBe(0);
    await act(async () => { summaryOf("标签").click(); });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>(".mbt-select__options button")].find((b) => b.textContent?.includes("新建选项"))!.click(); });
    expect(onEditField).toHaveBeenCalledWith("f-multi");
    expect(optionsOpen(), "跳编辑器时收起").toBe(0);
  });
});
