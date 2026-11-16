// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getNoteInfo: vi.fn(async () => ({ contentHash: "hash" })),
  listNoteHistory: vi.fn(async () => []),
  listNoteOrphans: vi.fn(async () => [{ filename: "shot.png", size: 1234, mimeType: "image/png", protectedByHistory: false }]),
  previewNoteOrphan: vi.fn(async () => ({ kind: "image", data: "data:image/png;base64,AAAA", size: 1234 })),
  previewHistorySnapshot: vi.fn(async () => null),
  createHistorySnapshot: vi.fn(),
  restoreHistory: vi.fn(),
  deleteHistory: vi.fn(),
  cleanNoteOrphans: vi.fn(),
}));
vi.mock("../../lib/native", () => ({ native: h }));
vi.mock("./HistorySnapshotPreview", () => ({ HistorySnapshotPreview: () => null }));
vi.mock("./NoteDocPreview", () => ({ NoteDocPreview: () => null }));

import { HistoryPanel } from "./HistoryPanel";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const flush = (ms = 20) => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  (h as unknown as { assetToken?: string }).assetToken = "tok";
  (window as unknown as { lakeNative?: unknown }).lakeNative = h;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { lakeNative?: unknown }).lakeNative;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("HistoryPanel · 回收站孤儿图片预览（task-31）", () => {
  it("图片预览走资源服务 ?w=1024 缩略档（含 token），不读 base64；失败回落原图一次后占位", async () => {
    act(() => root.render(createElement(HistoryPanel, { open: true, noteId: "n1", onClose: vi.fn(), onRestored: vi.fn() })));
    await flush();
    const orphanTab = [...document.querySelectorAll<HTMLButtonElement>(".ln-tabs__item")].find((b) => b.textContent?.includes("未引用文件"))!;
    act(() => orphanTab.click());
    await flush();
    const file = [...document.querySelectorAll< HTMLElement >(".ln-list-item__text")].find((e) => e.textContent === "shot.png")!;
    act(() => file.click());
    await flush();

    expect(h.previewNoteOrphan).not.toHaveBeenCalled();
    const img = document.querySelector<HTMLImageElement>(".history-preview-image")!;
    expect(img).not.toBeNull();
    const url = new URL(img.src);
    expect(url.searchParams.get("w")).toBe("1024");
    expect(url.searchParams.get("token")).toBe("tok");

    act(() => img.dispatchEvent(new Event("error", { bubbles: true })));
    const fallback = document.querySelector<HTMLImageElement>(".history-preview-image")!;
    const fallbackUrl = new URL(fallback.src);
    expect(fallbackUrl.searchParams.get("w")).toBeNull();
    expect(fallbackUrl.searchParams.get("token")).toBe("tok");

    act(() => fallback.dispatchEvent(new Event("error", { bubbles: true })));
    await flush();
    expect(document.querySelector(".history-preview-image")).toBeNull();
    expect(document.querySelector(".history-preview-text")?.textContent).toBe("图片加载失败");
  });
});
