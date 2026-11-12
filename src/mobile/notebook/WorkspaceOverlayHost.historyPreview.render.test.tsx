// @vitest-environment jsdom
/**
 * 移动历史版本快照预览（Q03，261112 第二轮）：移动端不再「盲恢复」。
 *  · 历史列表行点击 = 看快照（与桌面 HistoryPanel 同语义：行=预览、恢复/删除=显式动作）；
 *  · doc 快照 → 只读 LakeEditor（interaction="preview"）；非 doc → 结构化摘要（core/historyPreview）；
 *  · 预览是叠在列表之上的第二个 Sheet（MobileSheet 原语，返回键/滚动锁由它保证）。
 * 内核无法在 vitest 里实例化 ⇒ mock LakeEditor / MobileSheet，只验接线与渲染分支。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({ previewHistorySnapshot: vi.fn(), readNote: vi.fn() }));
const lakeProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock("../bridge", () => ({ bridge: bridgeMock }));
vi.mock("../../features/editor/LakeEditor", () => ({
  LAKE_PREVIEW_FONT_SIZE: 16,
  LakeEditor: (props: Record<string, unknown>) => { lakeProps.current = props; return <div data-testid="history-doc-preview" />; },
}));
vi.mock("../ui/MobileSheet", () => ({
  MobileSheet: ({ open, title, children }: { open?: boolean; title?: unknown; children: unknown }) => (
    open === false ? null : <div data-testid="sheet" data-title={String(title ?? "")}>{children as never}</div>
  ),
}));
vi.mock("../ui/MobileSheetMenu", () => ({
  MobileSheetMenu: ({ open }: { open?: boolean }) => (open ? <div data-testid="sheet-menu" /> : null),
}));

import { WorkspaceOverlayHost } from "./WorkspaceOverlayHost";

const historyFor = { id: "n1", title: "文档一", kind: "note" as const, parentId: "nb1", sortOrder: 0, icon: null };
const historyList = [{ id: 7, title: "2026-11-12 10:00", createdAt: "2026-11-12T10:00:00.000Z" }];

function baseProps(list = historyList) {
  return {
    createOpen: false, onCreateSelect: vi.fn(), onCloseCreate: vi.fn(),
    tabsOpen: false, tabs: [], activeId: null, tabIconOf: () => null,
    onOpenTab: vi.fn(), onCloseTab: vi.fn(), onCloseAllTabs: vi.fn(), onCloseTabs: vi.fn(), onOpenDocPicker: vi.fn(),
    notebookSwitchOpen: false, notebooks: [], notebookId: "nb1", onSwitchNotebook: vi.fn(), onCloseNotebookSwitch: vi.fn(),
    menuFor: null, treeMenuItemsFor: () => [], onTreeMenuSelect: vi.fn(), onCloseMenu: vi.fn(),
    infoFor: null, onCloseInfo: vi.fn(), onOpenHistoryFromInfo: vi.fn(),
    iconFor: null, onPickIcon: vi.fn(), onCloseIcon: vi.fn(),
    noteTagsFor: null, onCloseNoteTags: vi.fn(),
    historyFor, historyList: list,
    onRestoreHistory: vi.fn(), onDeleteHistory: vi.fn(), onCloseHistory: vi.fn(),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  bridgeMock.previewHistorySnapshot.mockReset();
  bridgeMock.readNote.mockReset();
  lakeProps.current = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("移动历史快照预览（Q03）", () => {
  it("doc 快照：行点击 → 只读 LakeEditor（interaction=preview + 预览档字号 + 无写回调）", async () => {
    bridgeMock.previewHistorySnapshot.mockResolvedValue({ html: "<p>旧正文</p>", plain: "旧正文", createdAt: "", contentHash: "" });
    bridgeMock.readNote.mockResolvedValue({ id: "n1", kind: "doc", content: "<p>新正文</p>", title: "文档一" });
    act(() => root.render(<WorkspaceOverlayHost {...baseProps()} />));
    const row = container.querySelector(".mb-row");
    expect(row?.textContent).toContain("2026-11-12 10:00");
    await act(async () => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });

    expect(bridgeMock.previewHistorySnapshot).toHaveBeenCalledWith(7);
    const props = lakeProps.current;
    expect(props).toBeTruthy();
    expect(props?.interaction).toBe("preview");
    expect(props?.noteId).toBe("n1");
    expect(props?.content).toBe("<p>旧正文</p>");
    expect((props?.prefs as { fontSize?: number }).fontSize).toBe(16);
    // 预览里没有写路径：onChange 必须是 no-op
    expect((props?.onChange as () => void)()).toBeUndefined();
    expect(container.querySelector("[data-testid=history-doc-preview]")).toBeTruthy();
  });

  it("非 doc 快照：不挂内核，给结构化摘要（core/historyPreview 的块）", async () => {
    // 正文不是可解析的多维表 JSON ⇒ 结构化模型给「无法解析」的 empty 块（不是 JSON 原文、也不是空白）。
    bridgeMock.previewHistorySnapshot.mockResolvedValue({ html: "{}", plain: "", createdAt: "", contentHash: "" });
    bridgeMock.readNote.mockResolvedValue({ id: "n1", kind: "bitable", content: "{}", title: "多维表一" });
    act(() => root.render(<WorkspaceOverlayHost {...baseProps()} />));
    const row = container.querySelector(".mb-row");
    await act(async () => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });

    expect(lakeProps.current).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("多维表快照");
    // 预览行带「恢复」按钮（显式动作仍在）
    expect(text).toContain("恢复");
  });

  it("恢复/删除仍是显式动作：行点击不再直接恢复", async () => {
    const props = baseProps();
    bridgeMock.previewHistorySnapshot.mockResolvedValue({ html: "<p>x</p>", plain: "x", createdAt: "", contentHash: "" });
    bridgeMock.readNote.mockResolvedValue({ id: "n1", kind: "doc", content: "<p>y</p>", title: "文档一" });
    act(() => root.render(<WorkspaceOverlayHost {...props} />));
    const row = container.querySelector(".mb-row");
    await act(async () => { row?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    // 行点击只预览
    expect(props.onRestoreHistory).not.toHaveBeenCalled();
    const restoreBtn = container.querySelector("[aria-label='恢复此版本']");
    expect(restoreBtn).toBeTruthy();
    await act(async () => { restoreBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(props.onRestoreHistory).toHaveBeenCalledWith(7);
  });
});