// @vitest-environment jsdom
/**
 * 日记页（261109 v1）渲染判据：
 *  · 分组**只来自 core.diary.groupDiaryEntries**（组件里不重算）⇒ 年 → 月 两层标题与计数对得上；
 *  · 「写今天」= bridge.diaryOpenDate(今天, "open")（幂等 ensure 在 data 层）→ 进现有工作区（mode=editor）；
 *  · 右上角 ＋ = 今天新建（mode="new"）、日历 = 选任意日期新建（mode="new"）；连点只发一次请求；
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
  // 261110：日记「打开 / 新建」带 mode（"open" 幂等 / "new" 永远新建）。
  diaryOpenDate: vi.fn(async (_dateKey: string, _mode?: "open" | "new") => ({ noteId: "new-note", created: true, notebookId: "nb-diary", duplicates: [] as string[] })),
  getWorkspaceSnapshot: vi.fn(async (_notebookId: string) => ({ notebook: null, tree: [] as Array<{ id: string; parentId: string | null; sortOrder: number; title: string; kind: "group" | "note"; icon: null }> })),
  moveTreeNodeOrdered: vi.fn(async (_id: string, _parentId: string | null, _orderedIds: string[]) => ({})),
  // 261113 task-106：「转为小记」桥（复制正文/媒体到小记作用域 + 原文软删；droppedKinds 由数据层上报）。
  diaryToQuickNote: vi.fn(async (_noteId: string) => ({ quickNoteId: "qn-new", droppedKinds: [] as string[] })),
  confirmMobile: vi.fn(async (_options: { title: string; body?: string; confirmText?: string; danger?: boolean }) => true),
  showToast: vi.fn(),
}));
vi.mock("../bridge", () => ({
  bridge: {
    diaryOpenDate: mocks.diaryOpenDate,
    getWorkspaceSnapshot: mocks.getWorkspaceSnapshot,
    moveTreeNodeOrdered: mocks.moveTreeNodeOrdered,
    diaryToQuickNote: mocks.diaryToQuickNote,
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));

import type { TreeNode } from "../../lib/types";
import { formatDiaryDateKey } from "../../core/diary.js";
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
  mocks.diaryToQuickNote.mockClear();
  mocks.diaryToQuickNote.mockResolvedValue({ quickNoteId: "qn-new", droppedKinds: [] });
  mocks.confirmMobile.mockClear();
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

  it("「写今天」走 bridge.diaryOpenDate(今天, 'open') → 进现有工作区（editor），并刷新目录", async () => {
    await render();
    const write = [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").includes("写今天"));
    expect(write).toBeTruthy();
    await act(async () => { write!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.diaryOpenDate).toHaveBeenCalledTimes(1);
    // 主按钮 = **幂等** open（当天已有就打开最新那篇），不是新建。
    expect(mocks.diaryOpenDate.mock.calls[0][1]).toBe("open");
    expect(onOpenEntry).toHaveBeenCalledWith({ noteId: "new-note", notebookId: "nb-diary", mode: "editor" });
    expect(onChanged).toHaveBeenCalled();
  });

  it("右上角 ＋ = 今天新建（mode='new'）→ 进工作区编辑态", async () => {
    await render();
    const plus = button("今天新建日记");
    expect(plus, "页头右上角必须有「＋ = 今天新建」").toBeTruthy();
    await act(async () => { plus!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.diaryOpenDate).toHaveBeenCalledTimes(1);
    expect(mocks.diaryOpenDate.mock.calls[0][1]).toBe("new");
    expect(onOpenEntry).toHaveBeenCalledWith({ noteId: "new-note", notebookId: "nb-diary", mode: "editor" });
  });

  it("右上角日历 = 选任意日期新建（mode='new'，可多篇）；外壳是既有底部 Sheet + 共享月历", async () => {
    // 今天所在月里已有日记（月历打开时定位到今天的月份）⇒ 该日应打点（hasDot 复用共享原语）。
    const todayKey = formatDiaryDateKey();
    await render([...NODES, node({ id: "d-today", title: todayKey, parentId: "m12" })]);
    const calendar = button("按日期新建日记");
    expect(calendar, "页头右上角必须有日历入口").toBeTruthy();
    await click(calendar!);
    // 共享月历原语：42 格（周一起始，来自 core.calendarMonthDays）
    const cells = [...host.querySelectorAll<HTMLButtonElement>(".mb-calendar-day")];
    expect(cells.length).toBe(42);
    // 已有日记的日期在月历上打点（复用共享原语的 hasDot；不另画一套日历）
    const dotted = [...host.querySelectorAll<HTMLButtonElement>(".mb-calendar-day")].filter((el) => el.querySelector(".mb-calendar-day__dot"));
    expect(dotted.map((el) => el.getAttribute("aria-label"))).toContain(todayKey);
    const cell = cells.find((el) => !el.classList.contains("is-out"))!;
    const dateKey = cell.getAttribute("aria-label")!;
    await act(async () => { cell.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.diaryOpenDate).toHaveBeenCalledTimes(1);
    expect(mocks.diaryOpenDate).toHaveBeenCalledWith(dateKey, "new");
    // 选完即关面板，并直接进工作区
    expect(host.querySelector(".mb-sheet")).toBeNull();
    expect(onOpenEntry).toHaveBeenCalledWith({ noteId: "new-note", notebookId: "nb-diary", mode: "editor" });
  });

  it("连点防重：在途期间再点 ＋ 只发一次写请求（不会一天建出两篇）", async () => {
    await render();
    const plus = button("今天新建日记")!;
    let release: (value: { noteId: string; created: boolean; notebookId: string; duplicates: string[] }) => void = () => {};
    mocks.diaryOpenDate.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => {
      plus.click();
      plus.click();
      plus.click();
      await Promise.resolve();
    });
    expect(mocks.diaryOpenDate).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ noteId: "new-note", created: true, notebookId: "nb-diary", duplicates: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenEntry).toHaveBeenCalledTimes(1);
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

  it("v2 版式：玻璃页头 + 白卡分组（今日卡 / 年段都走 .mb-set-section 原语），不新造页面骨架", async () => {
    await render();
    expect(host.querySelector("header.mobile-page-head.mb-glass.mb-glass--bar"), "页头 = 玻璃条（与标签页同形）").toBeTruthy();
    const write = [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").includes("写今天"))!;
    expect(write.closest(".mb-set-section"), "主按钮在白卡分组（今日卡）里，不再裸放在页面上").toBeTruthy();
    // 今日卡 1 + 年段 1 ⇒ 至少两张分组卡；年段标题仍是 .mb-set-section__title
    expect(host.querySelectorAll(".mb-set-section").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector(".mb-set-section__title")!.textContent).toContain("2025 年（2）");
  });

  it("同日多篇：行内显示时刻区分（docs/DIARY.md 决策 4）", async () => {
    const sameDay: TreeNode[] = [
      ...NODES,
      node({ id: "d1231b", title: "2025-12-31", parentId: "m12", createdAt: "2025-12-31T02:30:00.000Z", updatedAt: "2025-12-31T02:30:00.000Z" }),
    ];
    await render(sameDay);
    const rows = [...host.querySelectorAll(".mb-set-item__main")].map((el) => el.textContent ?? "");
    const sameDayRows = rows.filter((text) => text.includes("12 月 31 日"));
    expect(sameDayRows.length).toBe(2);
    // 同一日期两篇 ⇒ 靠行内时刻区分（不会出现两行一模一样的"更新于 …"）
    expect(new Set(sameDayRows).size).toBe(2);
    expect(sameDayRows.some((text) => /写于 \d{2}:\d{2}/.test(text))).toBe(true);
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
    // 转文档流程的文案 = 调用方传的 title/confirmLabel/description（不再显示「移动到…」）。
    expect(document.body.querySelector(".mb-sheet__title")?.textContent).toBe("转为文档");
    expect(document.body.textContent).toContain("选择目标笔记本");
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")]
      .find((el) => (el.textContent ?? "").trim() === "转为文档");
    expect(confirm, "确认按钮 = 转为文档，不是「移动到此处」").toBeTruthy();
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

  it("条目 ⋯ →「转为小记」：先确认（说明复制+可恢复）⇒ bridge.diaryToQuickNote + 同源提示 + 刷新", async () => {
    await render();
    await click(button("日记操作 2025-12-31")!);
    const item = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-menusheet__item")]
      .find((el) => (el.textContent ?? "").includes("转为小记"));
    expect(item, "菜单里必须有「转为小记」").toBeTruthy();
    await click(item!);
    expect(mocks.confirmMobile).toHaveBeenCalledTimes(1);
    const options = mocks.confirmMobile.mock.calls[0][0] as { title: string; body?: string; confirmText?: string };
    expect(options.title).toContain("转为小记");
    expect(options.body ?? "").toContain("回收站");
    expect(options.body ?? "").toContain("可恢复");
    expect(mocks.diaryToQuickNote).toHaveBeenCalledWith("d1231");
    expect(mocks.showToast).toHaveBeenCalledWith("已转为小记（含图片/附件）；日记已移入回收站，可恢复");
    expect(onChanged).toHaveBeenCalled();
  });

  it("「转为小记」droppedKinds 明说未搬运类型（不静默丢）", async () => {
    mocks.diaryToQuickNote.mockResolvedValueOnce({ quickNoteId: "qn-x", droppedKinds: ["board"] });
    await render();
    await click(button("日记操作 2025-12-30")!);
    const item = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-menusheet__item")]
      .find((el) => (el.textContent ?? "").includes("转为小记"));
    await click(item!);
    expect(mocks.showToast).toHaveBeenCalledWith("已转为小记（含图片/附件）；日记已移入回收站，可恢复；画板未搬运（日记原稿仍在回收站，可恢复）");
  });

  it("「转为小记」失败可见：错误 toast，且不刷新目录/不误报成功", async () => {
    mocks.diaryToQuickNote.mockRejectedValueOnce(new Error("磁盘已满"));
    await render();
    await click(button("日记操作 2025-12-31")!);
    const item = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-menusheet__item")]
      .find((el) => (el.textContent ?? "").includes("转为小记"));
    await click(item!);
    expect(mocks.showToast).toHaveBeenCalledWith("转为小记失败：磁盘已满", { type: "error" });
    expect(onChanged).not.toHaveBeenCalled();
  });
});
