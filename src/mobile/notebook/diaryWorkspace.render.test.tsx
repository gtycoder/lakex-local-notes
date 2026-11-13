// @vitest-environment jsdom
/**
 * 日记空间的工作区收敛（261113 用户裁决，AGENTS §3#25②）——用户能点到的入口：
 *  · 日记本**节点本身**的行菜单只留「重命名 / 设置图标」（其余约束照旧：不可删/移/排序/作目标）；
 *  · 日记子树（年/月分组、日记条目）的行菜单只留只读项 —— 不得出现重命名/图标/移动/删除；
 *  · 日记条目的顶栏标题锁：判据 = 工作区自己的 space（此前用已过滤掉日记本的 notebooks 列表 ⇒ 恒 false）。
 * 判据单一来源 = `notebookSpace`（useNotebookTreeData，与数据层 diaryNotebookOf 同口径）；本文件不另写判据。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../bridge", () => ({
  bridge: {
    createGroup: vi.fn(), createNote: vi.fn(), duplicateNotes: vi.fn(),
    createUsheet: vi.fn(), createBitable: vi.fn(), createBoard: vi.fn(), createInk: vi.fn(),
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: vi.fn() }));

import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { useWorkspaceActions } from "./useWorkspaceActions";

const node = (id: string, kind: "group" | "note", title = id): NotebookTreeItem => ({
  id, title, kind, parentId: "nb1", sortOrder: 0, icon: null,
});

const TREE = [node("n1", "note", "2026-11-09"), node("g1", "group", "2026")];

type Api = ReturnType<typeof useWorkspaceActions>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
let api: Api;

const calls = {
  openOverlay: vi.fn(), closeOverlay: vi.fn(), setRenamingId: vi.fn(), setRenameValue: vi.fn(),
  loadTree: vi.fn(async () => TREE), expandGroup: vi.fn(),
  applyMove: vi.fn(async () => undefined), applyDelete: vi.fn(async () => undefined),
  applyIcon: vi.fn(async () => null), loadHistory: vi.fn(async () => undefined),
  restoreHistoryVersion: vi.fn(async () => true), openTab: vi.fn(async () => undefined),
  switchNotebook: vi.fn(async () => undefined), flushSaves: vi.fn(async () => undefined),
};

function Harness({ menuFor, notebookSpace }: { menuFor: NotebookTreeItem | null; notebookSpace: string | null }): null {
  api = useWorkspaceActions({
    tree: TREE,
    title: "日记",
    notebookId: "nb1",
    notebookSpace,
    padTwoPane: false,
    createParent: "nb1",
    menuFor,
    itemById: (id) => TREE.find((n) => n.id === id),
    openOverlay: calls.openOverlay,
    closeOverlay: calls.closeOverlay,
    setRenamingId: calls.setRenamingId,
    setRenameValue: calls.setRenameValue,
    applyMove: calls.applyMove,
    applyDelete: calls.applyDelete,
    applyIcon: calls.applyIcon,
    loadHistory: calls.loadHistory,
    restoreHistoryVersion: calls.restoreHistoryVersion,
    openTab: calls.openTab,
    loadTree: calls.loadTree,
    switchNotebook: calls.switchNotebook,
    expandGroup: calls.expandGroup,
    flushSaves: calls.flushSaves,
  });
  return null;
}

async function render(menuFor: NotebookTreeItem | null = null, notebookSpace: string | null = null): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Harness, { menuFor, notebookSpace })); });
}

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

const FORBIDDEN_IN_DIARY_SUBTREE = ["重命名", "设置图标", "移动到…", "移入回收站", "删除分组", "创建副本", "置顶"];

describe("日记子树的行菜单 = 只读", () => {
  it("日记条目：只剩「历史版本 / 属性」，没有任何写动作", async () => {
    await render(node("n1", "note"), "diary");
    const labels = api.treeMenuItems(node("n1", "note")).map((it) => it.label);
    expect(labels).toEqual(["历史版本", "属性"]);
    for (const forbidden of FORBIDDEN_IN_DIARY_SUBTREE) expect(labels).not.toContain(forbidden);
  });

  it("年/月分组：没有任何可写动作（只给一条只读说明，不留空菜单）", async () => {
    await render(node("g1", "group"), "diary");
    const items = api.treeMenuItems(node("g1", "group"));
    expect(items.map((it) => it.label)).toEqual(["日记的年/月分组由日期自动生成"]);
    expect(items[0].disabled).toBe(true);
    for (const forbidden of FORBIDDEN_IN_DIARY_SUBTREE) expect(items.map((it) => it.label)).not.toContain(forbidden);
  });
});

describe("日记本节点本身：只留「重命名 / 设置图标」", () => {
  it("菜单只有这两项（删除/移动/排序入口不出现）", async () => {
    await render(null, "diary");
    const labels = api.treeMenuItems(node("nb1", "group", "日记")).map((it) => it.label);
    expect(labels).toEqual(["重命名", "设置图标"]);
    expect(labels).not.toContain("移动到…");
    expect(labels).not.toContain("删除分组");
  });
});

describe("非日记空间：菜单维持原样（回归，别误伤）", () => {
  it("普通笔记本里的条目仍有重命名/图标/移动/回收站", async () => {
    await render(node("n1", "note"), null);
    const labels = api.treeMenuItems(node("n1", "note")).map((it) => it.label);
    for (const label of ["重命名", "设置图标", "移动到…", "移入回收站", "创建副本", "标签…"]) {
      expect(labels).toContain(label);
    }
  });
});

describe("日记条目标题锁（NotebookWorkspace，源码护栏）", () => {
  const WS = readFileSync(path.join(process.cwd(), "src/mobile/notebook/NotebookWorkspace.tsx"), "utf8");
  /** 去注释版：判「源码里没有旧判据」时必须排除说明文字（注释里会写旧写法做对照）。 */
  const CODE = WS.replace(/\/\*[\s\S]*?\*\//g, "");

  it("判据 = 工作区自己的 space（不再查已过滤掉日记本的 notebooks 列表）", () => {
    expect(WS).toContain('const isDiaryNotebook = notebookSpace === "diary";');
    expect(CODE).not.toContain("notebooks.some(");
    // 单一判据同时喂「顶栏只读」与「改名拦截」两处
    expect(WS).toContain("titleReadOnly={isDiaryNotebook}");
    expect(WS).toContain("if (isDiaryNotebook) { showToast(\"日记标题就是日期，不能改\"); return; }");
    // notebookSpace 来自 useNotebookTreeData（与数据层 diaryNotebookOf 同口径的单一来源）
    expect(WS).toContain("} = useNotebookTreeData(notebookId);");
  });
});
