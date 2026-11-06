
// @vitest-environment jsdom
/** 多选右键菜单（261106 task-88）：恰好三项、能力禁用、busy、回调。 */
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
    actions: { trash: true, move: true, export: true },
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
  it("恰好三项，顺序 = 移入回收站 / 移动… / 导出…", () => {
    render();
    expect(items().map((btn) => (btn.textContent ?? "").trim())).toEqual(["移入回收站", "移动…", "导出…"]);
    expect(items()).toHaveLength(3);
  });

  it("分组/混选：移入回收站禁用并给原因，移动/导出仍可用", () => {
    render({ actions: { trash: false, move: true, export: true } });
    expect(items()[0].disabled).toBe(true);
    expect(items()[0].getAttribute("title")).toContain("分组不能移入回收站");
    expect(items()[1].disabled).toBe(false);
    expect(items()[2].disabled).toBe(false);
  });

  it("busy 时三项全部禁用", () => {
    render({ busy: true });
    expect(items().every((btn) => btn.disabled)).toBe(true);
  });

  it("动作回调 + 关闭：点任一项先执行再 onClose", () => {
    const props = render();
    act(() => { items()[2].click(); });
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    act(() => { items()[1].click(); });
    expect(props.onMove).toHaveBeenCalledTimes(1);
    act(() => { items()[0].click(); });
    expect(props.onTrash).toHaveBeenCalledTimes(1);
  });
});
