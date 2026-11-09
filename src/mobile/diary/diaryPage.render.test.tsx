// @vitest-environment jsdom
/**
 * 日记页（261109 v1）渲染判据：
 *  · 分组**只来自 core.diary.groupDiaryEntries**（组件里不重算）⇒ 年 → 月 两层标题与计数对得上；
 *  · 「写今天」= bridge.diaryOpenDate（幂等 ensure 在 data 层）→ 进现有工作区（mode=editor）；
 *  · 点条目 → 现有工作区（mode=viewer）；
 *  · 条目 ⋯ →「转为文档…」= **移动**到选中笔记本：调 bridge.moveTreeNodeOrdered，orderedIds =
 *    目标笔记本现有子节点排序 + 本条追加末尾（与 useTreeActions.moveTreeNode 的 inside 同口径）；
 *  · 目标列表只来自 core.diaryConvertTargets ⇒ **不含日记本、不含分组**；
 *  · **不打标**：页内没有任何标签入口。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  diaryOpenDate: vi.fn(async (_dateKey: string) => ({ noteId: "new-note", created: true, notebookId: "nb-diary", duplicates: [] as string[] })),
  getWorkspaceSnapshot: vi.fn(async (_notebookId: string) => ({ notebook: null, tree: [] as Array<{ id: string; parentId: string | null; sortOrder: number; title: string; kind: "group" | "note"; icon: null }> })),
  moveTreeNodeOrdered: vi.fn(async (_id: string, _parentId: string | null, _orderedIds: string[]) => ({})),
  showToast: vi.fn(),
}));
vi.mock("../bridge", () => ({
  bridge: {
    diaryOpenDate: mocks.diaryOpenDate,
    getWorkspaceSnapshot: mocks.getWorkspaceSnapshot,
    moveTreeNodeOrdered: mocks.moveTreeNodeOrdered,
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));

import type { TreeNode } from "../../lib/types";
import { DiaryPage } from "./DiaryPage";

const T = "2025-12-31T09:00:00.000Z";
const node = (over: Partial<TreeNode> & { id: string; title: string }): TreeNode => ({
  workspaceId: "mobile", parentId: null, nodeType: "note", noteFileId: over.id, sortOrder: 0,
  createdAt: T, updatedAt: T, isConflict: false, icon: null, space: null, ...over,
});

const NODES: TreeNode[] = [
  node({ id: "nb-diary", title: "日记", nodeType: "notebook", noteFileId: null, space: "diary" }),
  node({ id: "y2025", title: "2025", nodeType: "group", parentId: "nb-diary", noteFileId: null }),
  node({ id: "m12", title: "12", nodeType: "group", parentId: "y2025", noteFileId: null }),
  node({ id: "d1231", title: "2025-12-31", parentId: "m12" }),
  node({ id: "d1230", title: "2025-12-30", parentId: "m12" }),
  // 同名但不在日记本里的文档：不进日记列表（判据按日记本子树/日期键）
  node({ id: "plain", title: "2025-12-29", parentId: null }),
  // 转为文档的目标笔记本（普通知识库）+ 它已有的子文档（orderedIds 的既有排序位）
  node({ id: "nb-work", title: "工作", nodeType: "notebook", noteFileId: null }),
  node({ id: "work-child", title: "周报", parentId: "nb-work" }),
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onOpenEntry = vi.fn();
const onOpenSearch = vi.fn();
const onChanged = vi.fn(async () => undefined);

const render = async (nodes: TreeNode[] = NODES): Promise<void> => {
  await act(async () => {
    root.render(createElement(DiaryPage, { nodes, onOpenEntry, onOpenSearch, onChanged }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const text = (): string => host.textContent ?? "";
const button = (label: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.getAttribute("aria-label") ?? "") === label);
/** 点一下并让 effect/微任务跑完（弹层有位移动画，但不依赖动画结束）。 */
const click = async (el: Element): Promise<void> => {
  await act(async () => { (el as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onOpenEntry.mockReset();
  onOpenSearch.mockReset();
  mocks.diaryOpenDate.mockClear();
  mocks.getWorkspaceSnapshot.mockClear();
  mocks.moveTreeNodeOrdered.mockClear();
  mocks.getWorkspaceSnapshot.mockResolvedValue({
    notebook: null,
    tree: [{ id: "work-child", parentId: "nb-work", sortOrder: 0, title: "周报", kind: "note", icon: null }],
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("日记页（移动端 v1）", () => {
  it("年/月分组来自 core.diary：年段带计数，月小节在年段内", async () => {
    await render();
    expect(text()).toContain("2025 年（2）");
    expect(text()).toContain("12 月");
    // 两条日记都在（日期标签来自日期键）
    expect(text()).toContain("12 月 31 日");
    expect(text()).toContain("12 月 30 日");
    // 不在日记本里的同名文档不进列表
    expect(text()).not.toContain("12 月 29 日");
  });

  it("「写今天」走 bridge.diaryOpenDate → 进现有工作区（editor），并刷新目录", async () => {
    await render();
    const write = [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").includes("写今天"));
    expect(write).toBeTruthy();
    await act(async () => { write!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.diaryOpenDate).toHaveBeenCalledTimes(1);
    expect(onOpenEntry).toHaveBeenCalledWith({ noteId: "new-note", notebookId: "nb-diary", mode: "editor" });
    expect(onChanged).toHaveBeenCalled();
  });

  it("点条目 → 现有工作区（viewer）；搜索入口在页内头部", async () => {
    await render();
    const row = button("打开 2025-12-31 的日记");
    expect(row).toBeTruthy();
    await act(async () => { row!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(onOpenEntry).toHaveBeenCalledWith({ noteId: "d1231", notebookId: "nb-diary", mode: "viewer" });
    const search = button("搜索日记");
    expect(search).toBeTruthy();
    await act(async () => { search!.click(); });
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("不打标：页内没有任何标签入口", async () => {
    await render();
    expect(text()).not.toContain("添加标签");
    const tagButtons = [...host.querySelectorAll("button")].filter((el) => (el.getAttribute("aria-label") ?? "").includes("标签"));
    expect(tagButtons).toEqual([]);
  });

  it("空态：没有日记时给一句引导（不做缺天提示）", async () => {
    await render([]);
    expect(text()).toContain("还没有日记");
  });

  it("条目 ⋯ →「转为文档…」→ 选笔记本 ⇒ bridge.moveTreeNodeOrdered(条目, 笔记本, 既有子节点 + 本条)", async () => {
    await render();
    const more = button("日记操作 2025-12-31");
    expect(more, "条目不只要有内容，还要有可点的操作入口").toBeTruthy();
    await click(more!);
    const convertItem = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-menusheet__item")]
      .find((el) => (el.textContent ?? "").includes("转为文档"));
    expect(convertItem, "菜单里必须有「转为文档…」").toBeTruthy();
    await click(convertItem!);

    // 目标列表 = 普通笔记本（不含日记本）；选中「工作」并确认。
    const target = [...document.body.querySelectorAll<HTMLElement>(".mb-row")]
      .find((el) => (el.textContent ?? "").includes("工作"));
    expect(target, "目标列表应出现普通笔记本「工作」").toBeTruthy();
    await click(target!);
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((el) => (el.textContent ?? "").includes("移动到此处"));
    expect(confirm).toBeTruthy();
    await act(async () => { confirm!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(mocks.getWorkspaceSnapshot).toHaveBeenCalledWith("nb-work");
    // orderedIds = 目标笔记本现有子节点排序（work-child）+ 本条追加末尾；只传 [id] 会被 assertOrderedChildren 拒绝。
    expect(mocks.moveTreeNodeOrdered).toHaveBeenCalledWith("d1231", "nb-work", ["work-child", "d1231"]);
    expect(mocks.showToast).toHaveBeenCalledWith("已转为文档：《工作》");
    expect(onChanged).toHaveBeenCalled();
  });

  it("目标列表不含日记本、不含分组（判据 = core.diaryConvertTargets）", async () => {
    await render();
    await click(button("日记操作 2025-12-30")!);
    const convertItem = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-menusheet__item")]
      .find((el) => (el.textContent ?? "").includes("转为文档"));
    await click(convertItem!);
    const rows = [...document.body.querySelectorAll<HTMLElement>(".mb-row")].map((el) => (el.textContent ?? ""));
    expect(rows.some((row) => row.includes("工作"))).toBe(true);
    expect(rows.some((row) => row.includes("日记")), "日记本不能出现在目标列表").toBe(false);
    // 分组（2025 / 12）也不在目标里
    expect(rows.some((row) => row.includes("2025"))).toBe(false);
  });
});
