// @vitest-environment jsdom
/** 261122 用户报「移动端打开笔记本每次都把上次的标签清空」：
 *  初次进入的恢复决策必须等目录加载完成（treeReady），否则空树会把存档标签全判成已删 → restore([]) 清空。 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceAssemble, type UseWorkspaceAssembleOptions } from "./useWorkspaceAssemble";

function Harness(props: UseWorkspaceAssembleOptions) {
  useWorkspaceAssemble(props);
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const note = (id: string) => ({ id, title: id, kind: "note" as const, parentId: "nb1", sortOrder: 0, noteKind: "doc", icon: null });

const base = (over: Partial<UseWorkspaceAssembleOptions>): UseWorkspaceAssembleOptions => ({
  tree: [],
  treeReady: false,
  savedTabIds: [],
  savedTabActiveId: null,
  initialNoteId: null,
  initialMode: "viewer",
  restore: vi.fn(),
  openTab: vi.fn(async () => {}),
  active: null,
  loadTabBody: vi.fn(async () => {}),
  ...over,
});

const render = async (props: UseWorkspaceAssembleOptions) => {
  await act(async () => { root.render(createElement(Harness, props)); });
};

describe("工作区首次组装：目录未就绪时不许清空上次标签", () => {
  it("treeReady=false：不恢复也不清空（存档标签保持原样）", async () => {
    const restore = vi.fn();
    await render(base({ restore, savedTabIds: ["d1", "d2"], savedTabActiveId: "d2" }));
    expect(restore).not.toHaveBeenCalled();
  });

  it("treeReady 翻真后按存档恢复（顺序与活动页交给 restore）", async () => {
    const restore = vi.fn();
    const props = base({ restore, savedTabIds: ["d1", "d2"], savedTabActiveId: "d2" });
    await render(props);
    expect(restore).not.toHaveBeenCalled();
    await render({ ...props, tree: [note("d1"), note("d2")], treeReady: true });
    expect(restore).toHaveBeenCalledWith(["d1", "d2"], "d2");
  });

  it("树就绪且存档标签全失效：才允许清空（这是真的删光了）", async () => {
    const restore = vi.fn();
    await render(base({ restore, savedTabIds: ["gone"], tree: [note("d1")], treeReady: true }));
    expect(restore).toHaveBeenCalledWith([], null);
  });
});
