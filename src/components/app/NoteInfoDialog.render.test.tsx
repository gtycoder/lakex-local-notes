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
import { assetThumbWidthForCss } from "../../lib/assetPort";

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
  (h as unknown as { assetToken?: string }).assetToken = "tok";
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
    act(() => document.body.querySelector<HTMLButtonElement>("button[aria-controls=\"note-info-history-panel\"]")!.click());
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
    act(() => document.body.querySelector<HTMLButtonElement>("button[aria-controls=\"note-info-assets-panel\"]")!.click());
    await flush();
    const asset = document.body.querySelector<HTMLButtonElement>(".note-info-asset")!;
    expect(asset).not.toBeNull();
    expect(asset.className).toContain("note-info-asset");
    // 动作按钮（打开文件位置 / 附件文件夹 / 复制 ID / 打开历史版本）仍是 ln-btn 梯队
    const secondary = [...document.body.querySelectorAll<HTMLButtonElement>(".note-info-actions button")];
    expect(secondary.length).toBeGreaterThanOrEqual(3);
    for (const btn of secondary) expect(btn.className).toContain("ln-btn--secondary");
  });
});

describe("NoteInfoDialog · 附件网格缩略图（task-31）", () => {
  const renderDialog = async (data: Record<string, unknown>, expandAttachments = true) => {
    h.getNoteInfo.mockResolvedValue(data);
    act(() => root.render(createElement(NoteInfoDialog, { note: { noteFileId: "n1", title: "文档一" }, onClose: vi.fn(), onOpenHistory: vi.fn() })));
    await flush();
    if (expandAttachments) {
      act(() => document.body.querySelector<HTMLButtonElement>("button[aria-controls=\"note-info-assets-panel\"]")!.click());
      await flush();
    }
  };
  const image = (filename: string) => ({ filename, size: 100, kind: "image" });

  it("默认收起：两段标题仍显示摘要，收起态 0 img / 0 网格 / 0 历史行；点击展开、再点收起", async () => {
    await renderDialog({ ...info, assets: [image("a.png"), image("b.png")], assetTotalBytes: 512 }, false);
    const assetsToggle = document.body.querySelector<HTMLButtonElement>("button[aria-controls=\"note-info-assets-panel\"]")!;
    const historyToggle = document.body.querySelector<HTMLButtonElement>("button[aria-controls=\"note-info-history-panel\"]")!;
    expect(assetsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(historyToggle.getAttribute("aria-expanded")).toBe("false");
    expect(assetsToggle.tagName).toBe("BUTTON");
    expect(assetsToggle.textContent).toContain("附件 2 个，512 B");
    expect(historyToggle.textContent).toContain("历史版本 1 个");
    expect(document.querySelector(".note-info-assets")).toBeNull();
    expect(document.querySelector(".note-info-history")).toBeNull();
    expect(document.querySelectorAll(".note-info-asset img")).toHaveLength(0);
    expect(h.readAssetPreview).not.toHaveBeenCalled();
    assetsToggle.focus();
    expect(document.activeElement).toBe(assetsToggle);

    act(() => assetsToggle.click());
    await flush();
    expect(assetsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll(".note-info-asset img")).toHaveLength(2);
    expect(assetsToggle.textContent).toContain("附件 2 个，512 B");

    act(() => assetsToggle.click());
    await flush();
    expect(assetsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".note-info-assets")).toBeNull();
    expect(document.querySelectorAll(".note-info-asset img")).toHaveLength(0);

    // 历史版本同一折叠口径：默认收起；展开有列表，再收起 DOM 消失，摘要不变
    act(() => historyToggle.click());
    await flush();
    expect(historyToggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".note-info-history")).not.toBeNull();
    act(() => historyToggle.click());
    await flush();
    expect(historyToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".note-info-history")).toBeNull();
    expect(historyToggle.textContent).toContain("历史版本 1 个");
  });

  it("所有图片都走缩略档位 URL（含 token），不再 base64 预览、不再被 24 张截断", async () => {
    const assets = Array.from({ length: 30 }, (_, i) => image("img-" + i + ".png"));
    await renderDialog({ ...info, assets, assetTotalBytes: 3000 });
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".note-info-asset img")];
    expect(imgs).toHaveLength(30);
    const width = assetThumbWidthForCss(56)!;
    for (const img of imgs) {
      const src = new URL(img.src);
      expect(src.searchParams.get("w")).toBe(String(width));
      expect(src.searchParams.get("token")).toBe("tok");
      expect(img.getAttribute("width")).toBe("56");
      expect(img.getAttribute("height")).toBe("56");
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
    }
    expect(h.readAssetPreview).not.toHaveBeenCalled();
  });

  it("缩略图 onError 回落原图一次，再失败显示明确占位（不无限重试）", async () => {
    await renderDialog({ ...info, assets: [image("broken.png")], assetTotalBytes: 100 });
    const first = document.querySelector<HTMLImageElement>(".note-info-asset img")!;
    expect(first).not.toBeNull();
    act(() => first.dispatchEvent(new Event("error", { bubbles: true })));
    const fallback = document.querySelector<HTMLImageElement>(".note-info-asset img")!;
    expect(fallback).not.toBeNull();
    const fallbackUrl = new URL(fallback.src);
    expect(fallbackUrl.searchParams.get("w")).toBeNull();
    expect(fallbackUrl.searchParams.get("token")).toBe("tok");

    act(() => fallback.dispatchEvent(new Event("error", { bubbles: true })));
    expect(document.querySelector(".note-info-asset img")).toBeNull();
    const glyph = document.querySelector(".note-info-asset-glyph")!;
    expect(glyph.getAttribute("title")).toBe("图片加载失败");
    expect(glyph.getAttribute("aria-label")).toBe("图片加载失败");
  });

  it("非图片附件保持文件图标，不受缩略图逻辑影响", async () => {
    await renderDialog({ ...info, assets: [{ filename: "a.pdf", size: 100, kind: "file" }], assetTotalBytes: 100 });
    expect(document.querySelector(".note-info-asset img")).toBeNull();
    expect(document.querySelectorAll(".note-info-asset-glyph")).toHaveLength(1);
  });
});
