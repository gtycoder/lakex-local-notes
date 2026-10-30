// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableTableActions } from "./MobileBitableTableActions";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const props = { open: true, tableName: "观点收集", recordCount: 7, editable: true, canDelete: true, onRename: () => {}, onDuplicate: () => {}, onDelete: () => {}, onClose: () => {} };
const row = (text: string) => [...host.querySelectorAll<HTMLButtonElement>(".mbt-action-row")].find((r) => (r.textContent || "").includes(text))!;

describe("MobileBitableTableActions（重命名 / 复制 / 删除）", () => {
  it("菜单三项齐全；重命名进入输入并回写；复制回调", () => {
    const onRename = vi.fn();
    const onDuplicate = vi.fn();
    act(() => root.render(createElement(MobileBitableTableActions, { ...props, onRename, onDuplicate })));
    expect([...host.querySelectorAll(".mbt-action-row")].map((r) => r.textContent)).toEqual(["重命名", "复制数据表", "删除数据表"]);
    act(() => row("重命名").click());
    expect(host.textContent).toContain("重命名数据表");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="数据表名称"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "新表名");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "确定")!.click());
    expect(onRename).toHaveBeenCalledWith("新表名");
    // 回到菜单再点复制（真实父级会在回调后关闭面板）
    act(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "取消")!.click());
    act(() => row("复制数据表").click());
    expect(onDuplicate).toHaveBeenCalled();
  });

  it("只读态三项全禁用并写明理由；只剩一张表时删除禁用", () => {
    act(() => root.render(createElement(MobileBitableTableActions, { ...props, editable: false, canDelete: false })));
    expect([...host.querySelectorAll<HTMLButtonElement>(".mbt-action-row")].every((r) => r.disabled)).toBe(true);
    expect(host.textContent).toContain("只读状态不能修改数据表");
    act(() => root.render(createElement(MobileBitableTableActions, { ...props, editable: true, canDelete: false })));
    expect(row("删除数据表").disabled).toBe(true);
    expect(host.textContent).toContain("至少保留一张数据表");
  });
});
