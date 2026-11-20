// @vitest-environment jsdom
/**
 * 移动端知识库「已收起」笔记本分组（261120 用户点单）：
 * 收起项从主列表消失、落到「笔记本」下方的折叠分组（默认收起、可展开）、展开态记忆；
 * 特殊本（回收站/未分类/日记本）逻辑排除，永远留在主列表。
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

const mocks = vi.hoisted(() => ({ readQuickNote: vi.fn(async () => null), showToast: vi.fn() }));
vi.mock("../../features/editor/imagePreview", () => ({ openImagePreview: vi.fn() }));
vi.mock("../../features/quickNotes/QuickNotePreview", () => ({ QuickNotePreview: () => createElement("div") }));
vi.mock("../bridge", () => ({
  bridge: {
    readQuickNote: mocks.readQuickNote,
    listNoteTagLinks: vi.fn(async () => ({})),
    setQuickNoteTags: vi.fn(),
    setNoteTags: vi.fn(),
    batchNotes: vi.fn(),
    listQuickNoteTags: vi.fn(async () => []),
    listQuickNotes: vi.fn(async () => []),
    listNotes: vi.fn(async () => []),
    getWorkspaceSnapshot: vi.fn(async () => ({ notebook: { id: "nb", title: "nb", icon: null }, tree: [] })),
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
// NotebookGrid 是 React.lazy：测试只关心「传哪些本、落在哪个分区」，用同构桩替换（避免等懒 chunk）。
vi.mock("./NotebookGrid", () => ({
  NotebookGrid: (props: { notebooks: Array<{ id: string; title: string }>; view: string }) =>
    createElement(
      "div",
      { className: "nb-shelf" },
      props.notebooks.map((nb) => createElement("span", { key: nb.id, className: "nb-shelf-name" }, nb.title)),
    ),
}));

import { HomePage } from "./HomePage";

const T = "2026-11-20T10:00:00.000Z";
const notebook = (id: string, extra: Partial<TreeNode> = {}): TreeNode => ({
  id, workspaceId: "default", parentId: null, nodeType: "notebook", title: id,
  noteFileId: null, sortOrder: 0, createdAt: T, updatedAt: T, isConflict: false, ...extra,
} as TreeNode);

class IntersectionObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const renderHome = async (notebooks: TreeNode[]) => {
  await act(async () => {
    root.render(createElement(HomePage, {
      tab: "library",
      notebooks, notes: [], quickNotes: [],
      tagDirectory: [], docCounts: {},
      onTabChange: () => {}, onOpenNotebook: () => {}, onOpenNote: () => {}, onOpenQuickNote: () => {},
      onTagsChanged: async () => undefined, onOpenDrawer: () => {}, onOpenSearch: () => {},
      onCreateNotebook: () => {}, onCreateNote: () => {}, onTreeChanged: async () => {},
      onQuickNotesChanged: async () => {}, onQuickNoteTagsChanged: async () => undefined,
    }));
    // NotebookGrid 是 React.lazy：把微任务/动态 import 冲干净
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
/** 卡片标题 = 夹具里的笔记本 id（NotebookGrid 没有 data 属性，按标题文本取）。 */
const cardIds = (): string[] => [...host.querySelectorAll<HTMLElement>(".nb-shelf-name, .nb-row__title")].map((el) => (el.textContent ?? "").trim());
const header = (): HTMLElement | null => host.querySelector<HTMLElement>(".home-collapsed .home-section__toggle");

describe("知识库「已收起」笔记本分组", () => {
  it("默认：没有分组，笔记本都在主列表", async () => {
    await renderHome([notebook("nb1"), notebook("nb2")]);
    expect(header()).toBeNull();
    expect(cardIds()).toContain("nb1");
    expect(cardIds()).toContain("nb2");
  });

  it("有收起项：主列表少一个、下方出现「已收起」分组（默认收起）", async () => {
    localStorage.setItem("lakex-local-notes-mobile.collapsed-notebooks", JSON.stringify(["nb2"]));
    await renderHome([notebook("nb1"), notebook("nb2")]);
    expect(cardIds()).toEqual(["nb1"]);
    expect(header()).not.toBeNull();
    expect(host.querySelector(".home-collapsed .home-section__count")?.textContent).toBe("1");
  });

  it("展开分组后才渲染收起笔记本；展开态写入本地（记忆）", async () => {
    localStorage.setItem("lakex-local-notes-mobile.collapsed-notebooks", JSON.stringify(["nb2"]));
    await renderHome([notebook("nb1"), notebook("nb2")]);
    expect(cardIds()).toEqual(["nb1"]);
    await act(async () => { header()?.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(cardIds()).toContain("nb2");
    expect(localStorage.getItem("lakex-local-notes-mobile.collapsedOpen")).toBe("1");
  });

  it("全部收起：主列表显示指向「已收起」的提示，不显示「暂无知识库」", async () => {
    localStorage.setItem("lakex-local-notes-mobile.collapsed-notebooks", JSON.stringify(["nb1", "nb2"]));
    await renderHome([notebook("nb1"), notebook("nb2")]);
    expect(cardIds()).toEqual([]);
    const libraryText = host.querySelector(".mobile-library")?.textContent ?? "";
    expect(libraryText).toContain("已收起");
    expect(libraryText).not.toContain("暂无知识库");
    expect(header()).not.toBeNull();
  });

  it("长按菜单口径：可收起本才有「收起/取消收起」，特殊本连入口都不给", () => {
    // jsdom 环境下 import.meta.url 不是 file: 协议 ⇒ 用仓库根相对路径读源码（vitest cwd = 仓库根）
    const src = readFileSync("src/mobile/home/HomePage.tsx", "utf8");
    expect(src).toContain('id: "collapse"');
    expect(src).toContain("canCollapseNotebook(nbMenuFor)");
    expect(src).toContain('collapsedNotebookIdSet.has(nbMenuFor.id) ? "取消收起" : "收起"');
    expect(src).toContain("toggleNotebookCollapse(nb)");
  });

  it("特殊本逻辑排除：即使被写进本地表也留在主列表（不渲染分组）", async () => {
    localStorage.setItem("lakex-local-notes-mobile.collapsed-notebooks",
      JSON.stringify(["notebook-trash", "notebook-uncategorized", "nb-diary"]));
    await renderHome([
      notebook("notebook-trash"),
      notebook("notebook-uncategorized"),
      notebook("nb-diary", { space: "diary" }),
      notebook("nb1"),
    ]);
    expect(header()).toBeNull();
    expect(cardIds()).toContain("notebook-trash");
    expect(cardIds()).toContain("nb-diary");
  });
});
