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

import { NoteTagDialog } from "./NoteTagDialog";

/**
 * 目录右键「打标签…」弹层（P1 三修③）：复用属性面板的标签编辑行（NoteTagRow）——
 * 增/删/新建都走同一条通路；保存后 onChanged 通知宿主刷新标签空间/筛选数据。
 */
const TAG_A = "t_0000000000000001";
const TAG_B = "t_0000000000000002";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  (window as unknown as { lakeNative?: unknown }).lakeNative = h;
  h.listQuickNoteTags.mockResolvedValue([
    { id: TAG_A, name: "灵感", createdAt: "T", updatedAt: "T" },
    { id: TAG_B, name: "项目", createdAt: "T", updatedAt: "T" },
  ]);
  h.listNoteTagLinks.mockResolvedValue({ n1: [TAG_A] });
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

describe("NoteTagDialog（目录右键打标签弹层）", () => {
  it("展示目标文档标题 + 复用标签行（现有 chips 按本机顺序）", async () => {
    act(() => root.render(createElement(NoteTagDialog, { open: true, noteId: "n1", title: "周报", onClose: () => {} })));
    await flush();
    expect(document.body.textContent).toContain("打标签");
    expect(document.body.textContent).toContain("周报");
    expect(chipNames()).toEqual(["灵感"]);
  });

  it("移除标签：整组重写并触发 onChanged（宿主据此刷新标签空间）", async () => {
    const onChanged = vi.fn();
    act(() => root.render(createElement(NoteTagDialog, { open: true, noteId: "n1", title: "周报", onClose: () => {}, onChanged })));
    await flush();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="移除标签 灵感"]')!.click();
      await Promise.resolve();
    });
    expect(h.setNoteTags).toHaveBeenCalledWith("n1", []);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("添加标签：新标签排最前（最近添加在前）", async () => {
    act(() => root.render(createElement(NoteTagDialog, { open: true, noteId: "n1", title: "周报", onClose: () => {} })));
    await flush();
    act(() => document.body.querySelector<HTMLButtonElement>('button[aria-label="添加标签"]')!.click());
    const option = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-tag-picker__item")].find((btn) => (btn.textContent ?? "").includes("项目"))!;
    await act(async () => { option.click(); await Promise.resolve(); });
    expect(h.setNoteTags).toHaveBeenCalledWith("n1", [TAG_B, TAG_A]);
  });

  it("关闭按钮回调 onClose；open=false 不渲染", async () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(NoteTagDialog, { open: true, noteId: "n1", title: "周报", onClose })));
    await flush();
    act(() => document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭打标签"]')!.click());
    expect(onClose).toHaveBeenCalled();
    act(() => root.render(createElement(NoteTagDialog, { open: false, noteId: "n1", title: "周报", onClose })));
    expect(document.body.querySelector('button[aria-label="关闭打标签"]')).toBeNull();
  });
});
