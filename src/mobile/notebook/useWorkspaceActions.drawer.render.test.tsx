// @vitest-environment jsdom
/**
 * 261105 晚用户验收（移动端目录）：
 * ① 新建分组 / 重命名目录时**目录抽屉保持弹出**（复用一个 ensureTreeVisible 判据，不另造状态）；
 * ② 目录行 ⋯ 菜单「打标签…」**仅文档行**，选中后打开标签弹层（overlay.noteTags）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    createGroup: mocks.createGroup,
    createNote: mocks.createNote,
    createUsheet: vi.fn(), createBitable: vi.fn(), createBoard: vi.fn(), createInk: vi.fn(),
  },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));

import { readFileSync } from "node:fs";
import path from "node:path";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { useWorkspaceActions } from "./useWorkspaceActions";

const node = (id: string, kind: "group" | "note", parentId = "nb1", title = id): NotebookTreeItem => ({
  id, title, kind, parentId, sortOrder: 0, icon: null,
});

const TREE = [node("n1", "note"), node("g1", "group")];

type Api = ReturnType<typeof useWorkspaceActions>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
let api: Api;
const calls = {
  openOverlay: vi.fn(),
  closeOverlay: vi.fn(),
  setRenamingId: vi.fn(),
  setRenameValue: vi.fn(),
  ensureTreeVisible: vi.fn(),
  loadTree: vi.fn(async () => TREE),
  expandGroup: vi.fn(),
  applyMove: vi.fn(async () => undefined),
  applyDelete: vi.fn(async () => undefined),
  applyIcon: vi.fn(async () => null),
  loadHistory: vi.fn(async () => undefined),
  restoreHistoryVersion: vi.fn(async () => true),
  openTab: vi.fn(async () => undefined),
  switchNotebook: vi.fn(async () => undefined),
};

function Harness({ menuFor }: { menuFor: NotebookTreeItem | null }): null {
  api = useWorkspaceActions({
    tree: TREE,
    title: "笔记本",
    notebookId: "nb1",
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
    ensureTreeVisible: calls.ensureTreeVisible,
  });
  return null;
}

async function render(menuFor: NotebookTreeItem | null = null): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Harness, { menuFor })); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const fn of Object.values(calls)) fn.mockClear();
  mocks.createGroup.mockReset().mockResolvedValue({ id: "ng", title: "新建分组", kind: "group", parentId: "nb1", sortOrder: 0, icon: null });
  mocks.showToast.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("目录行菜单（打标签）", () => {
  it("「打标签…」只出现在文档行，分组行没有", async () => {
    await render();
    expect(api.treeMenuItems(node("n1", "note")).map((it) => it.label)).toContain("打标签…");
    expect(api.treeMenuItems(node("g1", "group")).map((it) => it.label)).not.toContain("打标签…");
  });

  it("选中「打标签…」⇒ 打开 noteTags 浮层（不进入重命名）", async () => {
    const target = node("n1", "note");
    await render(target);
    await act(async () => { api.onTreeMenuSelect({ id: "tags", label: "打标签…" }, [{ id: "tags", label: "打标签…" }]); });
    expect(calls.closeOverlay).toHaveBeenCalledWith("menu");
    expect(calls.openOverlay).toHaveBeenCalledWith({ kind: "noteTags", node: target });
    expect(calls.setRenamingId).not.toHaveBeenCalled();
  });
});

describe("抽屉保持弹出（新建/重命名）", () => {
  it("重命名：先把目录树拉出来（ensureTreeVisible），再进行内编辑", async () => {
    const target = node("g1", "group");
    await render(target);
    await act(async () => { api.onTreeMenuSelect({ id: "rename", label: "重命名" }, [{ id: "rename", label: "重命名" }]); });
    expect(calls.ensureTreeVisible).toHaveBeenCalledTimes(1);
    expect(calls.setRenamingId).toHaveBeenCalledWith("g1");
    expect(calls.setRenameValue).toHaveBeenCalledWith("g1");
  });

  it("新建分组：建完保持抽屉可见并直接进入重命名（输入框可见）", async () => {
    await render();
    await act(async () => { api.selectCreateItem({ id: "group", label: "新建分组" }); });
    expect(mocks.createGroup).toHaveBeenCalledWith("nb1", "新建分组");
    expect(calls.ensureTreeVisible).toHaveBeenCalledTimes(1);
    expect(calls.setRenamingId).toHaveBeenCalledWith("ng");
    expect(calls.setRenameValue).toHaveBeenCalledWith("新建分组");
    expect(calls.expandGroup).toHaveBeenCalledWith("nb1");
  });

  it("新建文档仍按原逻辑（打开标签，不进入重命名）", async () => {
    mocks.createNote.mockResolvedValue({ id: "n9", title: "无标题文档" });
    await render();
    await act(async () => { api.selectCreateItem({ id: "note", label: "新建文档" }); });
    expect(calls.setRenamingId).not.toHaveBeenCalled();
    expect(calls.openTab).toHaveBeenCalledWith("n9", { enterEditor: false });
  });
});

describe("工作区接线（抽屉派生 + 弹层宿主）", () => {
  const WS = readFileSync(path.join(process.cwd(), "src/mobile/notebook/NotebookWorkspace.tsx"), "utf8");
  const HOST = readFileSync(path.join(process.cwd(), "src/mobile/notebook/WorkspaceOverlayHost.tsx"), "utf8");

  it("左抽屉打开态由现有 overlay 判据派生（create 期间继续渲染，不新增第二份状态）", () => {
    expect(WS).toContain('const sidebarOpen = overlayKind === "sidebar" || overlayKind === "create";');
    expect(WS).toContain("const noteTagsFor = overlay?.kind === \"noteTags\"");
  });

  it("弹层宿主挂 NoteTagsSheet，关闭走 closeOverlay(\"noteTags\")", () => {
    expect(WS).toContain("onCloseNoteTags={() => closeOverlay(\"noteTags\")}");
    expect(HOST).toContain("<NoteTagsSheet open note={props.noteTagsFor}");
  });
});