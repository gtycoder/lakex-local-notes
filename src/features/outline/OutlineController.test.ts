import { describe, expect, it } from "vitest";
import { OutlineController, type OutlineEntry, type OutlineStorage } from "./OutlineController";

function memoryStorage(): OutlineStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function h(id: string, level: number, depth: number, text = id): OutlineEntry {
  return { id, text, level, depth, type: `h${level}` };
}

describe("OutlineController", () => {
  it("builds nested tree from flat toc by compressed depth", () => {
    const c = new OutlineController("doc1", memoryStorage());
    c.updateToc([
      h("a", 1, 1, "A"),
      h("a1", 2, 2, "A1"),
      h("a1x", 3, 3, "A1X"),
      h("a2", 2, 2, "A2"),
      h("b", 1, 1, "B"),
    ]);
    const roots = c.getRootItems();
    expect(roots.map((n) => n.id)).toEqual(["a", "b"]);
    expect(roots[0].children.map((n) => n.id)).toEqual(["a1", "a2"]);
    expect(roots[0].children[0].children.map((n) => n.id)).toEqual(["a1x"]);
    expect(roots[0].children[0].parentId).toBe("a");
    // 可见条目默认全部展开
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "a1", "a1x", "a2", "b"]);
  });

  it("clamps abnormal depth to 1..6", () => {
    const c = new OutlineController("doc-clamp", memoryStorage());
    c.updateToc([
      h("a", 1, 9999, "A"),
      h("a1", 2, -3, "A1"),
      h("a2", 2, Number.NaN, "A2"),
      h("a1x", 3, 4, "A1X"),
    ]);
    // 深度 9999 被收敛为 6；负数 / NaN 收敛为 1；正常 4 保持不变
    const roots = c.getRootItems();
    expect(roots.map((n) => n.depth)).toEqual([6, 1, 1]);
    expect(roots[2].children[0].depth).toBe(4);
  });

  it("dedupes repeated ids and tolerates empty input", () => {
    const c = new OutlineController("doc2", memoryStorage());
    c.updateToc([h("a", 1, 1), h("a", 1, 1), h("b", 2, 2)]);
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "b"]);
    c.updateToc([]);
    expect(c.getVisibleItems()).toEqual([]);
    expect(c.getSelectedId()).toBeNull();
  });

  it("keeps selected and collapsed state across toc updates when ids survive", () => {
    const c = new OutlineController("doc3", memoryStorage());
    c.updateToc([h("a", 1, 1), h("a1", 2, 2), h("b", 1, 1)]);
    c.setSelected("a1");
    c.setCollapsed("a", true);
    c.updateToc([h("a", 1, 1), h("a1", 2, 2, "A1-改"), h("c", 1, 1)]);
    expect(c.getSelectedId()).toBe("a1");
    expect(c.isCollapsed("a")).toBe(true);
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "c"]);
    // 删除后状态清除
    c.updateToc([h("x", 1, 1)]);
    expect(c.getSelectedId()).toBeNull();
    expect(c.isCollapsed("a")).toBe(false);
  });

  it("collapse/expand visibility semantics", () => {
    const c = new OutlineController("doc4", memoryStorage());
    c.updateToc([h("a", 1, 1), h("a1", 2, 2), h("a2", 2, 2)]);
    c.setCollapsed("a", true);
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a"]);
    c.toggleCollapsed("a");
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "a1", "a2"]);
  });

  it("collapseAll / expandAll / expandToLevel", () => {
    const c = new OutlineController("doc5", memoryStorage());
    c.updateToc([h("a", 1, 1), h("a1", 2, 2), h("a1x", 3, 3), h("b", 1, 1)]);
    c.expandToLevel(1);
    expect(c.isCollapsed("a")).toBe(true);
    expect(c.isCollapsed("a1")).toBe(true);
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "b"]);
    c.expandToLevel(2);
    expect(c.isCollapsed("a")).toBe(false);
    expect(c.isCollapsed("a1")).toBe(true);
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "a1", "b"]);
    c.expandAll();
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "a1", "a1x", "b"]);
    c.collapseAll();
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("expandAncestorsOf opens collapsed ancestors", () => {
    const c = new OutlineController("doc6", memoryStorage());
    c.updateToc([h("a", 1, 1), h("a1", 2, 2), h("a1x", 3, 3)]);
    c.setCollapsed("a", true);
    c.setCollapsed("a1", true);
    c.expandAncestorsOf("a1x");
    expect(c.isCollapsed("a")).toBe(false);
    expect(c.isCollapsed("a1")).toBe(false);
  });

  it("persists collapsed ids across instances via storage", () => {
    const storage = memoryStorage();
    const c1 = new OutlineController("doc7", storage);
    c1.updateToc([h("a", 1, 1), h("a1", 2, 2)]);
    c1.setCollapsed("a", true);
    const c2 = new OutlineController("doc7", storage);
    c2.updateToc([h("a", 1, 1), h("a1", 2, 2)]);
    expect(c2.isCollapsed("a")).toBe(true);
    // 清空折叠后移除存储
    c2.expandAll();
    expect(storage.getItem("lakex-local-notes:outline:collapsed:doc7")).toBeNull();
  });

  it("notifies subscribers and guards subscriber errors", () => {
    const c = new OutlineController("doc8", memoryStorage());
    c.updateToc([h("a", 1, 1)]);
    let count = 0;
    const unsubscribe = c.subscribe(() => {
      count += 1;
    });
    const bad = c.subscribe(() => {
      throw new Error("boom");
    });
    c.setSelected("a");
    expect(count).toBe(1);
    unsubscribe();
    bad();
    c.setSelected(null);
    expect(count).toBe(1);
  });
});

describe("OutlineController phase-2 features", () => {
  it("filters visible items to matches + ancestors", () => {
    const c = new OutlineController("doc-f", memoryStorage());
    c.updateToc([
      h("a", 1, 1, "第一章"),
      h("a1", 2, 2, "第一节"),
      h("a2", 2, 2, "第二节"),
      h("b", 1, 1, "第二章"),
    ]);
    c.setFilterText("第二节");
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "a2"]);
    c.setFilterText(""); // 清空恢复
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "a1", "a2", "b"]);
  });

  it("filter ignores collapse state (ancestors auto-expanded)", () => {
    const c = new OutlineController("doc-g", memoryStorage());
    c.updateToc([h("a", 1, 1, "第一章"), h("a1", 2, 2, "隐藏小节"), h("b", 1, 1, "第二章")]);
    c.setCollapsed("a", true);
    c.setFilterText("隐藏");
    expect(c.getVisibleItems().map((n) => n.id)).toEqual(["a", "a1"]);
  });

  it("keepCurrentExpand persists via storage", () => {
    const storage = memoryStorage();
    const c1 = new OutlineController("doc-h", storage);
    expect(c1.isKeepCurrentExpand()).toBe(false);
    c1.setKeepCurrentExpand(true);
    const c2 = new OutlineController("doc-h", storage);
    expect(c2.isKeepCurrentExpand()).toBe(true);
  });

});
