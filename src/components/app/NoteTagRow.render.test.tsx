// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listQuickNoteTags: vi.fn(),
  createQuickNoteTag: vi.fn(),
  listNoteTagLinks: vi.fn(),
  setNoteTags: vi.fn(),
}));
vi.mock("../../lib/native", () => ({ native: h }));

import { NoteTagRow } from "./NoteTagRow";

/**
 * 文档属性面板「标签」编辑行（P1）：chips 顺序 = 本机 position（主进程返回顺序原样采用）、
 * 移除即整组重写、添加复用标签选择器语汇（新增排最前）。
 */
// 标签 id 是派生 ID（t_ + 16 hex）；组件走 core 的 add/removeQuickNoteTagId，会校验形态。
const TAG_INSPIRATION = "t_0000000000000001";
const TAG_PROJECT = "t_0000000000000002";
const tag = (id: string, name: string) => ({ id, name, createdAt: "T", updatedAt: "T" });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  (window as unknown as { lakeNative?: unknown }).lakeNative = h;
  h.listQuickNoteTags.mockResolvedValue([tag(TAG_INSPIRATION, "灵感"), tag(TAG_PROJECT, "项目")]);
  h.listNoteTagLinks.mockResolvedValue({ n1: [TAG_INSPIRATION] });
  h.setNoteTags.mockImplementation(async (_noteId: string, ids: string[]) => ids);
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
async function flush(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}
const chipNames = () => [...document.body.querySelectorAll(".note-info-tag-chip")].map((el) => el.querySelector(".ln-ellipsis")?.textContent);

describe("NoteTagRow（属性面板标签行）", () => {
  it("按本机 position 展示 chips（主进程返回顺序原样采用，不重排）", async () => {
    h.listNoteTagLinks.mockResolvedValue({ n1: [TAG_PROJECT, TAG_INSPIRATION] });
    act(() => root.render(createElement(NoteTagRow, { noteId: "n1" })));
    await flush();
    expect(chipNames()).toEqual(["项目", "灵感"]);
    expect(document.body.textContent).not.toContain("读取标签");
  });

  it("移除：整组重写并采用主进程回传的新顺序", async () => {
    act(() => root.render(createElement(NoteTagRow, { noteId: "n1" })));
    await flush();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="移除标签 灵感"]')!.click();
      await Promise.resolve();
    });
    expect(h.setNoteTags).toHaveBeenCalledWith("n1", []);
    expect(chipNames()).toEqual([]);
    expect(document.body.textContent).toContain("还没有标签");
  });

  it("添加：复用标签选择器，新标签排最前（最近添加在前）", async () => {
    act(() => root.render(createElement(NoteTagRow, { noteId: "n1" })));
    await flush();
    act(() => document.body.querySelector<HTMLButtonElement>('button[aria-label="添加标签"]')!.click());
    const option = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-tag-picker__list button.ln-menu__item")].find((btn) => (btn.textContent ?? "").includes("项目"))!;
    expect(option).toBeTruthy();
    await act(async () => { option.click(); await Promise.resolve(); });
    expect(h.setNoteTags).toHaveBeenCalledWith("n1", [TAG_PROJECT, TAG_INSPIRATION]);
  });

  it("数据层不可用：给可读提示而不是报错", () => {
    delete (window as unknown as { lakeNative?: unknown }).lakeNative;
    act(() => root.render(createElement(NoteTagRow, { noteId: "n1" })));
    expect(document.body.textContent).toContain("标签数据暂不可用");
    expect(h.listNoteTagLinks).not.toHaveBeenCalled();
  });
});
