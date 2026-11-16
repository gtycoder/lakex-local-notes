// @vitest-environment jsdom
/**
 * AI 写作图片选择器（261116 Phase 1）：
 * ① 源 = 已选资料文档里的图片（只列 kind:"note"；小记图片下一批）；
 * ② 多选受剩余槽位限制、已添加的标灰不可重复选；
 * ③ 确认只回传新选的引用（{noteId, filename, name}），不读字节。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ listNoteImageAssets: vi.fn(), listAllNoteImages: vi.fn() }));
vi.mock("../../lib/native", () => ({ native: { listNoteImageAssets: h.listNoteImageAssets, listAllNoteImages: h.listAllNoteImages } }));

import { AiImagePicker } from "./AiImagePicker";
import type { AiWritingDocRef } from "../../core/aiWriting";

class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

const doc = (overrides: Partial<AiWritingDocRef> = {}): AiWritingDocRef => ({ kind: "note", id: "note-1", title: "文档一", ...overrides });

function render(options: { docs?: AiWritingDocRef[]; selected?: Array<{ noteId: string; filename: string }> } = {}) {
  const onAdd = vi.fn();
  const onDismiss = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <AiImagePicker
        open
        anchor={null}
        docs={options.docs ?? []}
        selected={options.selected ?? []}
        onAdd={onAdd}
        onDismiss={onDismiss}
      />,
    );
  });
  return { onAdd, onDismiss };
}

const cell = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".aiw-pick__cell")].find((el) => el.getAttribute("aria-label") === label)!;

beforeEach(() => { h.listNoteImageAssets.mockReset(); h.listAllNoteImages.mockReset(); });
afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  document.body.innerHTML = "";
});

describe("AiImagePicker · 源与选择", () => {
  it("没选资料文档：说明先选文档，不发请求", async () => {
    render();
    await flush();
    expect(document.body.textContent).toContain("先选择一篇文档");
    expect(h.listNoteImageAssets).not.toHaveBeenCalled();
  });

  it("列出资料文档的图片；选中后确认回传引用", async () => {
    h.listNoteImageAssets.mockResolvedValue([{ filename: "a.png", size: 2048, mimeType: "image/png" }]);
    const { onAdd, onDismiss } = render({ docs: [doc()] });
    await flush();
    expect(h.listNoteImageAssets).toHaveBeenCalledWith("note-1");
    const target = cell("选择：a.png");
    expect(target).toBeTruthy();
    act(() => { target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(document.body.textContent).toContain("已选 1");
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => (el.textContent || "").includes("添加 1 张"))!;
    act(() => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(onAdd).toHaveBeenCalledWith([{ noteId: "note-1", filename: "a.png", name: "a.png" }]);
    expect(onDismiss).toHaveBeenCalled();
  });

  it("已添加的图片标灰不可重复选", async () => {
    h.listNoteImageAssets.mockResolvedValue([{ filename: "a.png", size: 1024, mimeType: "image/png" }]);
    render({ docs: [doc()], selected: [{ noteId: "note-1", filename: "a.png" }] });
    await flush();
    const target = cell("已选：a.png");
    expect(target.disabled).toBe(true);
    expect(document.body.textContent).toContain("已添加");
  });

  it("只选了小记文档：提示小记图片下一批支持", async () => {
    render({ docs: [doc({ kind: "quick-note", id: "qn-1", title: "小记" })] });
    await flush();
    expect(document.body.textContent).toContain("小记图片下一批支持");
    expect(h.listNoteImageAssets).not.toHaveBeenCalled();
  });
});
