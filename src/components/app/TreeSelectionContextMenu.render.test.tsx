
// @vitest-environment jsdom
/** 多选右键菜单（261106 task-88；261106 副本追加第 4 项）：恰好四项、顺序、能力禁用、busy、回调。 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement("div", { role: "menu" }, children),
}));

import { TreeSelectionContextMenu } from "./TreeSelectionContextMenu";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(overrides: Partial<Parameters<typeof TreeSelectionContextMenu>[0]> = {}) {
  const props = {
    x: 40,
    y: 50,
    count: 2,
    actions: { duplicate: true, trash: true, move: true, export: true, pin: true },
    pinnedAll: false,
    onPin: vi.fn(),
    onDuplicate: vi.fn(),
    onTrash: vi.fn(),
    onMove: vi.fn(),
    onExport: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(TreeSelectionContextMenu, props)));
  return props;
}
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];

describe("多选右键菜单", () => {
  it("五项，顺序 = 置顶 / 创建副本 / 移动… / 导出… / 移入回收站（危险项在最后、红色样式）", () => {
    render();
    expect(items().map((btn) => (btn.textContent ?? "").trim())).toEqual(["置顶", "创建副本", "移动…", "导出…", "移入回收站"]);
    expect(items()).toHaveLength(5);
    // 与普通右键「删除」同 class（.danger 危险红）
    expect(items()[4].className).toContain("danger");
    expect(items()[0].className).not.toContain("danger");
  });

  it("选区全部已置顶 ⇒ 标签变「取消置顶」", () => {
    render({ pinnedAll: true });
    expect(items()[0].textContent).toContain("取消置顶");
  });

  it("分组/混选：创建副本禁用并给原因；移入回收站禁用；移动/导出仍可用", () => {
    render({ actions: { duplicate: false, trash: false, move: true, export: true, pin: true } });
    expect(items()[1].disabled).toBe(true);
    expect(items()[1].getAttribute("title")).toContain("只有文档可以创建副本");
    expect(items()[4].disabled).toBe(true);
    expect(items()[4].getAttribute("title")).toContain("分组不能移入回收站");
    expect(items()[2].disabled).toBe(false);
    expect(items()[3].disabled).toBe(false);
    expect(items()[0].disabled).toBe(false);
  });

  it("全选文档（duplicate 可用）时创建副本可点", () => {
    render({ actions: { duplicate: true, trash: true, move: true, export: true, pin: true } });
    expect(items()[1].disabled).toBe(false);
    expect(items()[1].getAttribute("title")).toBeNull();
  });

  it("busy 时五项全部禁用", () => {
    render({ busy: true });
    expect(items().every((btn) => btn.disabled)).toBe(true);
  });

  it("动作回调 + 关闭：点任一项先执行再 onClose", () => {
    const props = render();
    act(() => { items()[0].click(); });
    expect(props.onPin).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    act(() => { items()[1].click(); });
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);
    act(() => { items()[2].click(); });
    expect(props.onMove).toHaveBeenCalledTimes(1);
    act(() => { items()[3].click(); });
    expect(props.onExport).toHaveBeenCalledTimes(1);
    act(() => { items()[4].click(); });
    expect(props.onTrash).toHaveBeenCalledTimes(1);
  });
});