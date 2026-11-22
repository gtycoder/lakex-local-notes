// @vitest-environment jsdom
/** 261122 用户报「移动端打开笔记本每次都把上次的标签清空」：
 *  初次进入的恢复决策必须等目录加载完成（treeReady），否则空树会把存档标签全判成已删 → restore([]) 清空。 */
import { act, createElement, useState } from "react";
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
describe("目录就绪后必须补读活动页正文（261122 真机：骨架卡住、再点一下才加载）", () => {
  /** 有状态宿主：restore 真的换掉 tabs/active（与真实 hook 同形），否则测不出「恢复后 active 未变」这个坑。 */
  function StatefulHarness(props: { tree: UseWorkspaceAssembleOptions["tree"]; treeReady: boolean; loadTabBody: () => Promise<void> }) {
    const [tabs, setTabs] = useState([{ id: "d2", loaded: false }]);
    const [activeId, setActiveId] = useState<string | null>("d2");
    useWorkspaceAssemble({
      tree: props.tree,
      treeReady: props.treeReady,
      savedTabIds: ["d2"],
      savedTabActiveId: "d2",
      initialNoteId: null,
      initialMode: "viewer",
      restore: (ids, nextActiveId) => {
        setTabs(ids.map((id) => ({ id, loaded: false })));
        setActiveId(nextActiveId);
      },
      openTab: async () => {},
      active: (tabs.find((tab) => tab.id === activeId) ?? null) as unknown as UseWorkspaceAssembleOptions["active"],
      loadTabBody: props.loadTabBody,
    });
    return null;
  }

  it("treeReady 翻真 → 恢复 → 必须为活动页发起 loadTabBody", async () => {
    const loadTabBody = vi.fn(async () => {});
    await act(async () => { root.render(createElement(StatefulHarness, { tree: [], treeReady: false, loadTabBody })); });
    expect(loadTabBody).not.toHaveBeenCalled();
    await act(async () => {
      root.render(createElement(StatefulHarness, { tree: [note("d2")], treeReady: true, loadTabBody }));
    });
    expect(loadTabBody).toHaveBeenCalledWith("d2");
  });
});
