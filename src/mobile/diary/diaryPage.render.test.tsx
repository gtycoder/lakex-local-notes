// @vitest-environment jsdom
/**
 * 日记页（261109 v1）渲染判据：
 *  · 分组**只来自 core.diary.groupDiaryEntries**（组件里不重算）⇒ 年 → 月 两层标题与计数对得上；
 *  · 「写今天」= bridge.diaryOpenDate（幂等 ensure 在 data 层）→ 进现有工作区（mode=editor）；
 *  · 点条目 → 现有工作区（mode=viewer）；
 *  · **不打标**：页内没有任何标签入口。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  diaryOpenDate: vi.fn(async (_dateKey: string) => ({ noteId: "new-note", created: true, notebookId: "nb-diary", duplicates: [] as string[] })),
  showToast: vi.fn(),
}));
vi.mock("../bridge", () => ({ bridge: { diaryOpenDate: mocks.diaryOpenDate } }));
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onOpenEntry.mockReset();
  onOpenSearch.mockReset();
  mocks.diaryOpenDate.mockClear();
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
});
