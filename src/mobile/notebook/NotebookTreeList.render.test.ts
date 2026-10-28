// @vitest-environment jsdom
/**
 * 抽屉树虚拟窗口化渲染护栏：
 * - 2000 节点时只挂视口窗口（~35 行）而不是 2000 个 <button>；
 * - 小树保持全量渲染，行语义（data-node-id / data-depth / 选中 / chevron / 图标 / ⋮＋ / 长按 / 重命名）不变。
 * useVirtualizer 的 stub 姿势与 src/mobile/home/quickNotesVirtualList.render.test.ts 一致。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const virtualMock = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>> }));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (config: Record<string, unknown>) => {
    virtualMock.configs.push(config);
    const count = (config.count as number) ?? 0;
    const items = count > 0
      ? Array.from({ length: Math.min(6, count) }, (_, index) => ({ index, key: "v" + index, start: index * 44, size: 44 }))
      : [];
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * 44,
      measureElement: () => undefined,
      getOffsetForIndex: (index: number) => [index * 44, "start"] as const,
    };
  },
}));

import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { buildNotebookTreeIndex, flattenVisibleRows } from "./notebookTreeIndex";
import { NotebookTreeList, TREE_VIRTUAL_THRESHOLD } from "./NotebookTreeList";

const node = (id: string, parentId: string | null, sortOrder: number, over: Partial<NotebookTreeItem> = {}): NotebookTreeItem =>
  ({ id, title: "标题-" + id, kind: "note", parentId, sortOrder, icon: null, ...over });

const rowsFor = (tree: NotebookTreeItem[], expanded: string[] = ["nb1"]) =>
  flattenVisibleRows(buildNotebookTreeIndex(tree), "nb1", new Set(expanded));

const longPress = {
  onTouchStart: vi.fn(),
  onTouchMove: vi.fn(),
  onTouchEnd: vi.fn(),
  onTouchCancel: vi.fn(),
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  virtualMock.configs.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const renderList = async (props: Partial<Parameters<typeof NotebookTreeList>[0]> & { rows: ReturnType<typeof rowsFor> }) => {
  const defaults = {
    expanded: new Set(["nb1"]),
    hasChildren: (id: string) => props.rows.some((row) => row.item.parentId === id),
    activeId: null,
    drag: null,
    renamingId: null,
    renameValue: "",
    onRenameChange: () => {},
    onRenameCommit: () => {},
    onRenameCancel: () => {},
    longPress,
    onPressRow: () => {},
    onActivate: () => {},
    onOpenMenu: () => {},
    onOpenCreate: () => {},
  } satisfies Omit<Parameters<typeof NotebookTreeList>[0], "rows">;
  await act(async () => { root.render(createElement(NotebookTreeList, { ...defaults, ...props } as Parameters<typeof NotebookTreeList>[0])); });
};

describe("目录抽屉树窗口化", () => {
  it("2000 节点只挂视口窗口的行，而不是 2000 个按钮", async () => {
    const tree = Array.from({ length: 2000 }, (_, i) => node("fx" + i, "nb1", i));
    await renderList({ rows: rowsFor(tree) });

    const mounted = host.querySelectorAll(".side-panel-body [data-node-id]").length;
    expect(mounted).toBe(6); // stub 的窗口大小；真机 ≈ 视口 19 + 2×overscan 8
    expect(mounted).toBeLessThan(2000);

    const config = virtualMock.configs[virtualMock.configs.length - 1];
    expect(config.count).toBe(2000);
    expect(config.enabled).toBe(true);
    expect(config.overscan).toBe(8);
    expect((config.estimateSize as () => number)()).toBe(44);
    expect((config.getItemKey as (i: number) => string)(1999)).toBe("fx1999");
    expect(host.querySelector("[data-index]")).not.toBeNull();
  });

  it("超过阈值的边界：60 行不虚拟化、61 行虚拟化", async () => {
    await renderList({ rows: rowsFor(Array.from({ length: TREE_VIRTUAL_THRESHOLD }, (_, i) => node("a" + i, "nb1", i))) });
    expect(virtualMock.configs[virtualMock.configs.length - 1].enabled).toBe(false);
    expect(host.querySelectorAll("[data-node-id]").length).toBe(TREE_VIRTUAL_THRESHOLD);

    await renderList({ rows: rowsFor(Array.from({ length: TREE_VIRTUAL_THRESHOLD + 1 }, (_, i) => node("b" + i, "nb1", i))) });
    expect(virtualMock.configs[virtualMock.configs.length - 1].enabled).toBe(true);
  });

  it("59/60/61 行阈值切换不丢展开态（虚不虚拟只影响挂载数量）", async () => {
    // 60 个可见行 = 1 个分组 + 59 篇文档；展开该分组 = 61 行 ⇒ 跨过阈值转虚拟化。
    const tree = [
      node("g1", "nb1", 0, { kind: "group", title: "分组" }),
      node("c1", "g1", 0),
      ...Array.from({ length: 59 }, (_, i) => node("n" + i, "nb1", i + 1)),
    ];
    const collapsed = rowsFor(tree);
    expect(collapsed).toHaveLength(60);
    await renderList({ rows: collapsed });
    expect(virtualMock.configs[virtualMock.configs.length - 1].enabled).toBe(false);
    expect(host.querySelector(".mb-chevron.open")).toBeNull();
    expect(host.querySelectorAll("[data-node-id]")).toHaveLength(60);

    const expanded = rowsFor(tree, ["nb1", "g1"]);
    expect(expanded).toHaveLength(61);
    await renderList({ rows: expanded, expanded: new Set(["nb1", "g1"]) });
    expect(virtualMock.configs[virtualMock.configs.length - 1].enabled).toBe(true);
    // 展开态没被阈值切换吃掉：分组仍是 open，子行还在窗口里（stub 前 6 条含 index 1）
    expect(host.querySelector(".mb-chevron.open")).not.toBeNull();
    expect(host.querySelector('[data-node-id="c1"]')).not.toBeNull();
  });

  it("重命名中的行滚出窗口仍保留输入框（pin 一行，不破坏窗口化）", async () => {
    const tree = Array.from({ length: 2000 }, (_, i) => node("fx" + i, "nb1", i));
    await renderList({ rows: rowsFor(tree), renamingId: "fx1999", renameValue: "改名中" });
    // stub 窗口 = 6 行 + pin 的重命名行
    expect(host.querySelectorAll("[data-node-id]")).toHaveLength(7);
    const input = host.querySelector('[data-node-id="fx1999"] input.mb-input') as HTMLInputElement | null;
    expect(input?.value).toBe("改名中");
  });

  it("行变化（展开/折叠）不重挂滚动容器：scrollTop 与虚拟窗口状态得以保留", async () => {
    const tree = [
      node("g1", "nb1", 0, { kind: "group" }),
      node("c1", "g1", 0),
      ...Array.from({ length: 100 }, (_, i) => node("n" + i, "nb1", i + 1)),
    ];
    await renderList({ rows: rowsFor(tree) });
    const scroller = host.querySelector(".side-panel-body");
    expect(scroller).not.toBeNull();
    await renderList({ rows: rowsFor(tree, ["nb1", "g1"]), expanded: new Set(["nb1", "g1"]) });
    expect(host.querySelector(".side-panel-body")).toBe(scroller);
  });

  it("小树全量渲染：data-node-id / data-depth / 选中态 / 图标 / chevron / ⋮＋ 都在", async () => {
    const tree = [
      node("g1", "nb1", 1, { kind: "group", title: "分组", icon: "😀" }),
      node("n1", "g1", 1),
      node("n2", "nb1", 2),
    ];
    await renderList({ rows: rowsFor(tree, ["nb1", "g1"]), expanded: new Set(["nb1", "g1"]), activeId: "g1" });

    const group = host.querySelector('[data-node-id="g1"]') as HTMLElement;
    const child = host.querySelector('[data-node-id="n1"]') as HTMLElement;
    expect(group.dataset.depth).toBe("0");
    expect(child.dataset.depth).toBe("1");
    expect(group.className).toContain("mb-row");
    expect(group.className).toContain("is-selected");
    expect(group.className).not.toContain("nb-dragging");
    expect(group.className).toContain("mb-indent");
    expect(group.querySelector(".mb-chevron.open")).not.toBeNull();
    expect(child.querySelector(".mb-chevron-spacer")).not.toBeNull();
    expect(group.querySelector(".mb-row__title")?.textContent).toBe("分组");
    expect(group.querySelector(".mb-tree-icon")).not.toBeNull();
    expect(group.querySelectorAll(".nb-tree-action")).toHaveLength(2);
    expect(host.querySelectorAll("[data-node-id]")).toHaveLength(3);
  });

  it("行内动作 / 行点击 / 长按按下都走原回调（拖拽与菜单接线不变）", async () => {
    const onOpenMenu = vi.fn();
    const onOpenCreate = vi.fn();
    const onActivate = vi.fn();
    const onPressRow = vi.fn();
    await renderList({ rows: rowsFor([node("n1", "nb1", 1)]), onOpenMenu, onOpenCreate, onActivate, onPressRow });

    const row = host.querySelector('[data-node-id="n1"]') as HTMLElement;
    const [menuBtn, createBtn] = Array.from(row.querySelectorAll(".nb-tree-action")) as HTMLElement[];

    await act(async () => { menuBtn.click(); });
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onOpenMenu.mock.calls[0][0].id).toBe("n1");
    await act(async () => { createBtn.click(); });
    expect(onOpenCreate).toHaveBeenCalledTimes(1);
    await act(async () => { row.click(); });
    expect(onActivate).toHaveBeenCalledTimes(1);
    await act(async () => { row.dispatchEvent(new Event("touchstart", { bubbles: true })); });
    expect(onPressRow).toHaveBeenCalledTimes(1);
    expect(onPressRow.mock.calls[0][0].id).toBe("n1");
  });

  it("拖拽落点类与长按态按 drag 渲染（落点线仍挂在 .mb-row 上）", async () => {
    const tree = [node("n1", "nb1", 1), node("n2", "nb1", 2)];
    await renderList({ rows: rowsFor(tree), drag: { id: "n1", overId: "n2", position: "after" } });
    expect((host.querySelector('[data-node-id="n1"]') as HTMLElement).className).toContain("nb-dragging");
    expect((host.querySelector('[data-node-id="n2"]') as HTMLElement).className).toContain("drop-line-after");

    await renderList({ rows: rowsFor(tree), drag: { id: "n1", overId: "n2", position: "inside" } });
    expect((host.querySelector('[data-node-id="n2"]') as HTMLElement).className).toContain("drop-parent");
  });

  it("重命名输入框走原回调；空列表显示空态文案", async () => {
    const onRenameChange = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    await renderList({
      rows: rowsFor([node("n1", "nb1", 1)]),
      renamingId: "n1",
      renameValue: "新名字",
      onRenameChange,
      onRenameCommit,
      onRenameCancel,
    });
    const input = host.querySelector("input.mb-input") as HTMLInputElement;
    expect(input.value).toBe("新名字");
    await act(async () => {
      input.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(onRenameCommit).toHaveBeenCalledTimes(1);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);

    await act(async () => { root.render(createElement(NotebookTreeList, {
      rows: [],
      expanded: new Set(["nb1"]),
      hasChildren: () => false,
      activeId: null,
      drag: null,
      renamingId: null,
      renameValue: "",
      onRenameChange: () => {},
      onRenameCommit: () => {},
      onRenameCancel: () => {},
      longPress,
      onPressRow: () => {},
      onActivate: () => {},
      onOpenMenu: () => {},
      onOpenCreate: () => {},
    })); });
    expect(host.querySelector(".mb-empty")?.textContent).toContain("暂无文档");
  });
});
