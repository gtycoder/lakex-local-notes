// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getNoteInfo: vi.fn(),
  readAssetPreview: vi.fn(),
  previewHistorySnapshot: vi.fn(),
  openAttachment: vi.fn(),
  listQuickNoteTags: vi.fn(),
  createQuickNoteTag: vi.fn(),
  listNoteTagLinks: vi.fn(),
  setNoteTags: vi.fn(),
}));
vi.mock("../../lib/native", () => ({ native: h }));
// 属性清单/格式化走 core 单一来源，这里只验按钮迁移 ⇒ 桩成最小数据。
vi.mock("./HistorySnapshotPreview", () => ({ HistorySnapshotPreview: () => null }));
vi.mock("./NoteDocPreview", () => ({ NoteDocPreview: () => null }));
vi.mock("../../core/noteInfo.js", () => ({
  noteInfoRows: () => [],
  formatNoteInfoSize: (n: number) => n + " B",
  formatNoteInfoTime: (t: string) => t,
}));

import { NoteInfoDialog } from "./NoteInfoDialog";

/**
 * 文档属性弹窗（261110 第二批）：历史版本行 = kit 的 .ln-row（按钮即行）；
 * 面包屑（.note-info-crumb，行内文本链接）与 56px 附件缩略格（.note-info-asset）
 * 是**登记的例外**（几何由该表面规格决定，与 AGENTS「面包屑不并入 ln-row/ln-input」同口径）。
 */
const info = {
  id: "n1", title: "文档一", parents: [{ id: "p1", title: "笔记本 A" }],
  lakePath: "/tmp/a.lake", assetsDir: "/tmp/assets", assets: [{ filename: "a.png", size: 1024, kind: "image" }],
  assetTotalBytes: 1024, history: [{ id: 1, createdAt: "2026-11-01", size: 12, contentHash: "x" }],
  cardStats: [], contentHash: "x",
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  h.getNoteInfo.mockResolvedValue(info);
  h.readAssetPreview.mockResolvedValue({ supported: false });
  h.previewHistorySnapshot.mockResolvedValue({ id: 1, kind: "doc", html: "" });
  h.listQuickNoteTags.mockResolvedValue([]);
  h.listNoteTagLinks.mockResolvedValue({});
  h.setNoteTags.mockImplementation(async (_id: string, ids: string[]) => ids);
  (window as unknown as { lakeNative?: unknown }).lakeNative = h;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { lakeNative?: unknown }).lakeNative; vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function flush(): Promise<void> { await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }); }

describe("NoteInfoDialog（261110 第二批）", () => {
  it("历史版本行 = ln-row（按钮即行），类名里只有 ln- + 登记的钩子", async () => {
    act(() => root.render(createElement(NoteInfoDialog, { note: { noteFileId: "n1", title: "文档一" }, onClose: vi.fn(), onOpenHistory: vi.fn(), onJumpToNode: vi.fn() })));
    await flush();
    const row = document.body.querySelector<HTMLButtonElement>(".note-info-history-row")!;
    expect(row).not.toBeNull();
    expect(row.className).toContain("ln-row");
    expect(row.className.split(/\s+/).filter((n) => n && !n.startsWith("ln-") && n !== "note-info-history-row" && !n.startsWith("is-"))).toEqual([]);
  });

  it("登记例外：面包屑 = 行内链接、附件缩略格 = 56px 媒体格（不并按钮梯队）", async () => {
    act(() => root.render(createElement(NoteInfoDialog, { note: { noteFileId: "n1", title: "文档一" }, onClose: vi.fn(), onOpenHistory: vi.fn(), onJumpToNode: vi.fn(), onRevealNoteFile: vi.fn(), onOpenAssetsDir: vi.fn() })));
    await flush();
    const crumb = document.body.querySelector<HTMLButtonElement>(".note-info-crumb")!;
    expect(crumb).not.toBeNull();
    expect(crumb.className).toContain("note-info-crumb");
    const asset = document.body.querySelector<HTMLButtonElement>(".note-info-asset")!;
    expect(asset).not.toBeNull();
    expect(asset.className).toContain("note-info-asset");
    // 动作按钮（打开文件位置 / 附件文件夹 / 复制 ID / 打开历史版本）仍是 ln-btn 梯队
    const secondary = [...document.body.querySelectorAll<HTMLButtonElement>(".note-info-actions button")];
    expect(secondary.length).toBeGreaterThanOrEqual(3);
    for (const btn of secondary) expect(btn.className).toContain("ln-btn--secondary");
  });
});
