// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiaryWorkspace, type DiaryWorkspaceProps } from "./DiaryWorkspace";
import { formatDiaryDateKey } from "../../core/diary";
import type { TreeNode } from "../../lib/types";

/**
 * 日记空间（桌面片B）：左栏「年 → 月」清单、空态「写今天」、条目点击、搜索入口、日记本设置。
 *
 * 为什么这里不挂内核：DiaryWorkspace 的 EditorTab 是 React.lazy（内核边界），用例只在
 * 「没有活动日记标签」的路径上跑 ⇒ 不会动态加载 EditorTab；有无 EditorTab 由接线用例按源码钉住。
 */
const today = formatDiaryDateKey();
const todayYear = today.slice(0, 4);
const todayMonth = today.slice(5, 7);
const node = (patch: Partial<TreeNode> & Pick<TreeNode, "id" | "parentId" | "nodeType" | "title">): TreeNode => ({
  workspaceId: "ws", noteFileId: null, sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", isConflict: false,
  ...patch,
});

/** 日记本 + 今天（本年本月）+ 去年一篇（跨年跨月分组都要能看见）。 */
const tree = (withToday: boolean, withNotebook = true): TreeNode[] => {
  const nodes: TreeNode[] = [node({ id: "nb-doc", parentId: null, nodeType: "notebook", title: "知识库" })];
  if (!withNotebook) return nodes;
  nodes.push(
    node({ id: "nb-diary", parentId: null, nodeType: "notebook", title: "日记", space: "diary" }),
    node({ id: "y-old", parentId: "nb-diary", nodeType: "group", title: "2025" }),
    node({ id: "m-old", parentId: "y-old", nodeType: "group", title: "12" }),
    node({ id: "e-old", parentId: "m-old", nodeType: "note", title: "2025-12-31", noteFileId: "note-old" }),
  );
  if (withToday) {
    nodes.push(
      node({ id: "y-now", parentId: "nb-diary", nodeType: "group", title: todayYear }),
      node({ id: "m-now", parentId: "y-now", nodeType: "group", title: todayMonth }),
      node({ id: "e-today", parentId: "m-now", nodeType: "note", title: today, noteFileId: "note-today" }),
    );
  }
  return nodes;
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function props(overrides: Partial<DiaryWorkspaceProps> = {}): DiaryWorkspaceProps {
  return {
    active: true,
    treeNodes: tree(true),
    activeNoteId: null,
    tabs: [],
    lockedNoteIds: new Set<string>(),
    tocEnabled: true,
    outlineEnhance: false,
    editorPrefs: { fontSize: 14 },
    onConvertEntry: vi.fn(),
    onConvertToQuickNote: vi.fn(),
    onCreateEntry: vi.fn(),
    onOpenEntry: vi.fn(),
    onWriteToday: vi.fn(),
    onOpenSearch: vi.fn(),
    onRenameNotebook: vi.fn(),
    onSetNotebookIcon: vi.fn(),
    onContentChange: vi.fn(),
    onEditorReady: vi.fn(),
    onReloadNote: vi.fn(),
    ...overrides,
  };
}
const render = (overrides: Partial<DiaryWorkspaceProps> = {}) => {
  const merged = props(overrides);
  act(() => root.render(createElement(DiaryWorkspace, merged)));
  return merged;
};
const byAria = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const allText = () => document.body.textContent ?? "";

describe("日记空间（桌面）", () => {
  it("左栏按 core 的年/月分组渲染（跨年、跨月都来自 groupDiaryEntries）", () => {
    render({ treeNodes: tree(true) });
    const text = allText();
    expect(text).toContain(todayYear);
    expect(text).toContain("2025");
    expect(text).toContain(todayMonth + " 月");
    expect(text).toContain("12 月");
    // 条目用日期键当标题（标题即日期）
    expect(text).toContain(today);
    expect(text).toContain("2025-12-31");
  });

  it("今天已经写过 ⇒ 进入空间自动打开今天那篇（不建文档、不抢别的条目）", () => {
    const merged = render({ treeNodes: tree(true) });
    expect(merged.onOpenEntry).toHaveBeenCalledWith("note-today");
  });

  it("今天没写 ⇒ 停空态，只有用户点「写今天」才发起建/开（不在进入时静默建文档）", () => {
    const merged = render({ treeNodes: tree(false) });
    expect(merged.onOpenEntry).not.toHaveBeenCalled();
    expect(allText()).toContain("今天还没有写");
    const writeToday = [...document.body.querySelectorAll<HTMLElement>("button")].find((el) => (el.textContent ?? "").includes("写今天"));
    expect(writeToday).toBeTruthy();
    act(() => writeToday!.click());
    expect(merged.onWriteToday).toHaveBeenCalledWith(today);
  });

  it("没有日记本 ⇒ 空态文案说明会自动建本；按钮仍可点（建本 + 建文档都由主进程单事务负责）", () => {
    const merged = render({ treeNodes: tree(false, false) });
    expect(allText()).toContain("还没有日记本");
    const writeToday = [...document.body.querySelectorAll<HTMLElement>("button")].find((el) => (el.textContent ?? "").includes("写今天"));
    act(() => writeToday!.click());
    expect(merged.onWriteToday).toHaveBeenCalledWith(today);
  });

  it("点条目 = 打开该篇；点年/月 = 只折叠清单（不打开文档）", () => {
    // 用本地 spy：既断言参数，也能数「折叠有没有顺带打开文档」
    const onOpenEntry = vi.fn();
    render({ treeNodes: tree(true), onOpenEntry });
    const entry = [...document.body.querySelectorAll<HTMLElement>(".diary-entry")]
      .find((el) => (el.textContent ?? "").includes("2025-12-31"));
    expect(entry).toBeTruthy();
    act(() => entry!.click());
    expect(onOpenEntry).toHaveBeenCalledWith("note-old");

    // 年份按条目日期倒序 ⇒ 2025 那一组的箭头是最后一个（按文本定位，不依赖下标）
    const yearHead = [...document.body.querySelectorAll<HTMLElement>(".diary-year__head")]
      .find((el) => (el.textContent ?? "").trim().startsWith("2025"));
    expect(yearHead).toBeTruthy();
    // 折叠前记下次数：折叠只改可见性，不能顺带打开文档
    // （进入空间时"今天已存在 ⇒ 自动打开"已经算过一次调用，这里只证折叠不再增加）
    const callsBeforeCollapse = onOpenEntry.mock.calls.length;
    act(() => yearHead!.click());
    expect(allText()).not.toContain("2025-12-31");
    expect(onOpenEntry.mock.calls.length).toBe(callsBeforeCollapse);
  });

  it("右键条目 →「转为文档…」：目标只列文档空间的笔记本（不含日记本），确认后交给宿主执行移动", () => {
    const onConvertEntry = vi.fn();
    render({ treeNodes: tree(true), onConvertEntry });
    const entry = [...document.body.querySelectorAll<HTMLElement>(".diary-entry")]
      .find((el) => (el.textContent ?? "").includes("2025-12-31"));
    expect(entry).toBeTruthy();
    act(() => {
      entry!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    });

    const menuItem = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((el) => (el.textContent ?? "").trim() === "转为文档…");
    expect(menuItem).toBeTruthy();
    act(() => menuItem!.click());

    // 目标树：只有「知识库」这一本（日记本已被 core.diaryConvertTargets 排除）
    const targetTree = document.body.querySelector<HTMLElement>("[role='tree'][aria-label='目标位置']");
    expect(targetTree).toBeTruthy();
    expect(targetTree!.textContent).toContain("知识库");
    expect(targetTree!.textContent).not.toContain("日记");

    const targetRow = [...targetTree!.querySelectorAll<HTMLElement>("button")]
      .find((el) => (el.textContent ?? "").includes("知识库"));
    expect(targetRow).toBeTruthy();
    act(() => targetRow!.click());

    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((el) => (el.textContent ?? "").trim() === "移动到此处");
    expect(confirm).toBeTruthy();
    act(() => confirm!.click());
    expect(onConvertEntry).toHaveBeenCalledWith("e-old", "nb-doc");
  });

  it("加号 = 今天新建；日历 = 选任意日期新建（一天多篇，走 mode:new）", () => {
    const onCreateEntry = vi.fn();
    render({ treeNodes: tree(true), onCreateEntry });
    act(() => byAria("新建今天的日记")!.click());
    expect(onCreateEntry).toHaveBeenCalledWith(formatDiaryDateKey());

    act(() => byAria("选择日期新建日记")!.click());
    const input = document.body.querySelector<HTMLInputElement>("input[type='date']")!;
    expect(input).toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2025-12-30");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const create = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent ?? "").trim() === "新建")!;
    act(() => create.click());
    expect(onCreateEntry).toHaveBeenCalledWith("2025-12-30");
  });

  it("右键「转为小记」：把该条目的树节点 id 交给宿主（组合/落库在 App + 主进程）", () => {
    const onConvertToQuickNote = vi.fn();
    render({ treeNodes: tree(true), onConvertToQuickNote });
    const entry = [...document.body.querySelectorAll<HTMLElement>(".diary-entry")]
      .find((el) => (el.textContent ?? "").includes("2025-12-31"));
    expect(entry).toBeTruthy();
    act(() => { entry!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    const item = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((el) => (el.textContent ?? "").trim() === "转为小记");
    expect(item).toBeTruthy();
    act(() => item!.click());
    expect(onConvertToQuickNote).toHaveBeenCalledWith("e-old");
  });

  it("搜索入口 = 打开现有全局搜索面板（不在日记里另造搜索）；标题里写明范围是全库", () => {
    const merged = render();
    const search = byAria("搜日记（全库范围，含日记）");
    expect(search).toBeTruthy();
    act(() => search!.click());
    expect(merged.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("日记本设置：重命名走既有 NamePromptDialog；换图标先摆出图标入口（未点不加载表情源）", () => {
    const merged = render({ treeNodes: tree(true) });
    expect(allText()).toContain("日记");
    const rename = byAria("重命名日记本");
    expect(rename).toBeTruthy();
    act(() => rename!.click());
    const input = document.body.querySelector<HTMLInputElement>("input[aria-label=\"日记本名称\"]");
    expect(input).toBeTruthy();
    // React 受控输入：必须走原生 value setter + input 事件（直接赋 value 不会触发 onChange）
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "每日记录");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...document.body.querySelectorAll<HTMLElement>("button")].find((el) => (el.textContent ?? "").trim() === "保存");
    expect(submit).toBeTruthy();
    act(() => submit!.click());
    expect(merged.onRenameNotebook).toHaveBeenCalledWith("每日记录");
    expect(byAria("换日记本图标")).toBeTruthy();
  });

  it("活动笔记是日记条目但标签还没打开 ⇒ 仍显示空态（不渲染无正文的编辑器）", () => {
    render({ activeNoteId: "note-today", tabs: [] });
    expect(allText()).toContain("今天还没有写");
  });
});
