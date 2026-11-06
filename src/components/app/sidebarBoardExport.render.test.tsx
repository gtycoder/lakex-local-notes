
// @vitest-environment jsdom
/**
 * 批量导出接画板（261106 task-96）：pickExportDir → 串行收集画板字节（已打开 readBoardBytes 优先，
 * 否则 readNote + renderBoardSnapshotBytes 离屏）→ exportNotesBatch({ ids, dirPath, boardImages })。
 * 覆盖：两条字节路径、取消目录、取消准备阶段、非 board 不收集、分组展开收集、快照失败 ⇒ 跳过原因。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

const nativeMocks = vi.hoisted(() => ({
  pickExportDir: vi.fn(),
  exportNotesBatch: vi.fn(),
  readNote: vi.fn(),
  openExportDir: vi.fn(),
  batchNotes: vi.fn(),
}));
vi.mock("../../lib/native", () => ({ native: nativeMocks }));
const boardMocks = vi.hoisted(() => ({ readBoardBytes: vi.fn(), renderBoardSnapshotBytes: vi.fn() }));
vi.mock("../../features/board/boardExport", () => ({ readBoardBytes: boardMocks.readBoardBytes }));
vi.mock("../../features/board/boardSnapshot", () => ({ renderBoardSnapshotBytes: boardMocks.renderBoardSnapshotBytes }));

vi.mock("../ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement("div", { role: "menu" }, children),
  Popover: ({ children }: { children: ReactNode }) => children,
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) => (open === false ? null : createElement("div", { role: "dialog" }, children)),
  Submenu: ({ label, children }: { label: ReactNode; children: ReactNode }) => createElement("div", { "data-submenu": "" }, label, children),
}));

import { Sidebar } from "./Sidebar";

type Props = Parameters<typeof Sidebar>[0];
const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder = 0, title = id, kind?: TreeNode["kind"]): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title, kind,
  noteFileId: nodeType === "note" ? id : null, sortOrder, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);
const NODES = [
  node("nb", "notebook", null, 0, "笔记本"),
  node("g1", "group", "nb", 0, "分组一"),
  node("b1", "note", "g1", 0, "画板一", "board"),
  node("d1", "note", "g1", 1, "文档一", "doc"),
  node("g2", "group", "nb", 1, "分组二"),
  node("b2", "note", "g2", 0, "画板二", "board"),
];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let host: HTMLDivElement;
let root: Root;
let props: Props;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  for (const fn of Object.values(nativeMocks)) fn.mockReset();
  for (const fn of Object.values(boardMocks)) fn.mockReset();
  nativeMocks.pickExportDir.mockResolvedValue("/tmp/out");
  nativeMocks.readNote.mockResolvedValue({ content: '{"version":2,"engine":"drawnix","elements":[]}' });
  nativeMocks.exportNotesBatch.mockResolvedValue({
    ok: true, results: [], summary: { total: 0, done: 0, failed: 0, skipped: 0 }, dirPath: "/tmp/out",
  });
  nativeMocks.openExportDir.mockResolvedValue({ ok: true, path: "/tmp/out" });
  boardMocks.readBoardBytes.mockResolvedValue(null);
  boardMocks.renderBoardSnapshotBytes.mockResolvedValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    nodes: NODES, activeId: null, search: "", mode: "docked", width: 220, minWidth: 160, maxWidth: 400,
    lockedNoteIds: new Set<string>(), revealNodeId: null, pendingRenameId: null,
    onSelect: vi.fn(), onSearch: vi.fn(), onRefreshTree: vi.fn(async () => {}), onCreate: vi.fn(async () => "nb-new"),
    onRename: vi.fn(), onMoveNode: vi.fn(), onRequestDelete: vi.fn(), onCopyMarkdown: vi.fn(),
    onExportAs: vi.fn(), onCopyPaths: vi.fn(), onSetIcon: vi.fn(), onShowInfo: vi.fn(), onOpenHistory: vi.fn(),
    onToggleLockNote: vi.fn(), onRevealConsumed: vi.fn(), onPendingRenameConsumed: vi.fn(),
    onPreviewEnter: vi.fn(), onPreviewLeave: vi.fn(), onResizeActiveChange: vi.fn(),
    onWidthChange: vi.fn(), onWidthCommit: vi.fn(), onTagsChanged: vi.fn(),
  } as unknown as Props;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const render = () => act(() => root.render(createElement(Sidebar, props)));
const row = (id: string): HTMLElement => document.querySelector<HTMLElement>('[data-tree-node-id="' + id + '"]')!;
const clickRow = (id: string, mods: { metaKey?: boolean } = {}) => act(() => { row(id).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mods })); });
const openBatchMenu = (id: string) => act(() => { row(id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })); });
const exportItem = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((btn) => (btn.textContent ?? "").trim() === "导出…")!;
const noticeText = () => document.querySelector(".tree-selection-bar__notice")?.textContent ?? null;
const runExport = async () => act(async () => { exportItem().click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

describe("批量导出接画板（task-96）", () => {
  it("已打开的画板：readBoardBytes 优先 → boardImages 随 exportNotesBatch 传出", async () => {
    boardMocks.readBoardBytes.mockResolvedValue({ bytes: PNG, format: "png" });
    render();
    clickRow("b1", { metaKey: true });
    openBatchMenu("b1");
    await runExport();
    expect(nativeMocks.pickExportDir).toHaveBeenCalledTimes(1);
    expect(boardMocks.readBoardBytes).toHaveBeenCalledWith("b1");
    expect(boardMocks.renderBoardSnapshotBytes).not.toHaveBeenCalled();
    expect(nativeMocks.exportNotesBatch).toHaveBeenCalledWith({
      ids: ["b1"], dirPath: "/tmp/out", boardImages: { b1: { bytes: PNG, format: "png" } },
    });
    // 顺序：目录 → 收集 → 导出
    const order = [nativeMocks.pickExportDir, boardMocks.readBoardBytes, nativeMocks.exportNotesBatch]
      .map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("未打开的画板：readNote 正文 + 离屏快照兜底", async () => {
    boardMocks.readBoardBytes.mockResolvedValue(null);
    boardMocks.renderBoardSnapshotBytes.mockResolvedValue({ bytes: PNG, format: "png" });
    render();
    clickRow("b1", { metaKey: true });
    openBatchMenu("b1");
    await runExport();
    expect(nativeMocks.readNote).toHaveBeenCalledWith("b1");
    expect(boardMocks.renderBoardSnapshotBytes).toHaveBeenCalledWith('{"version":2,"engine":"drawnix","elements":[]}');
    expect(nativeMocks.exportNotesBatch.mock.calls[0][0].boardImages.b1.bytes).toBe(PNG);
  });

  it("快照失败 ⇒ 该画板按「跳过」展示原因（画板快照失败/超时）", async () => {
    nativeMocks.exportNotesBatch.mockResolvedValue({
      ok: true,
      results: [{ id: "b1", ok: false, skipped: true, reason: "缺少画板图像字节（画板未渲染或渲染失败）" }],
      summary: { total: 1, done: 0, failed: 0, skipped: 1 },
      dirPath: "/tmp/out",
    });
    render();
    clickRow("b1", { metaKey: true });
    openBatchMenu("b1");
    await runExport();
    expect(nativeMocks.exportNotesBatch).toHaveBeenCalledWith({ ids: ["b1"], dirPath: "/tmp/out" });
    expect(noticeText()).toContain("导出 0 项");
    expect(noticeText()).toContain("跳过 1");
    expect(noticeText()).toContain("画板快照失败/超时");
  });

  it("非画板不收集字节（文档直接导出）", async () => {
    render();
    clickRow("d1", { metaKey: true });
    openBatchMenu("d1");
    await runExport();
    expect(boardMocks.readBoardBytes).not.toHaveBeenCalled();
    expect(boardMocks.renderBoardSnapshotBytes).not.toHaveBeenCalled();
    expect(nativeMocks.exportNotesBatch).toHaveBeenCalledWith({ ids: ["d1"], dirPath: "/tmp/out" });
  });

  it("选中分组 ⇒ 展开其下画板一起收集（ids 仍传分组，由主进程展开导出）", async () => {
    boardMocks.readBoardBytes.mockResolvedValue({ bytes: PNG, format: "png" });
    render();
    clickRow("g1", { metaKey: true });
    openBatchMenu("g1");
    await runExport();
    expect(boardMocks.readBoardBytes).toHaveBeenCalledWith("b1");
    expect(nativeMocks.exportNotesBatch.mock.calls[0][0]).toMatchObject({
      ids: ["g1"], dirPath: "/tmp/out", boardImages: { b1: { bytes: PNG, format: "png" } },
    });
  });

  it("准备阶段可取消：显示「正在准备画板 N/M」，取消后不导出", async () => {
    let release!: (value: null) => void;
    boardMocks.readBoardBytes.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render();
    clickRow("b1", { metaKey: true });
    openBatchMenu("b1");
    act(() => { exportItem().click(); });
    await act(async () => { await Promise.resolve(); });
    expect(noticeText()).toContain("正在准备画板 1/1");
    const cancel = [...document.querySelectorAll<HTMLButtonElement>(".tree-selection-bar__notice-row button")].find((btn) => (btn.textContent ?? "").trim() === "取消")!;
    expect(cancel).toBeTruthy();
    await act(async () => { cancel.click(); release(null); await Promise.resolve(); await Promise.resolve(); });
    expect(nativeMocks.exportNotesBatch).not.toHaveBeenCalled();
    expect(noticeText()).toBeNull();
  });
});
