// @vitest-environment jsdom
/**
 * 移动端「文档引用」的底部 Sheet（261120 用户点单三条）：
 * ① 打开 = **直接列出全部文档**，搜索框**不自动聚焦**（不许默认拉起键盘）；
 * ② 弹层 = MobileSheet（.mb-sheet 原语，头部可拖动调高）而不是桌面锚定 Popover；
 * ③ 行/输入/底栏全部走 `mb-*` 原语（旧实现是 ln-* 桌面外观）。
 *
 * 这是结构 + 交互护栏；设备级观感与"点击后编辑区不滚"由真机验收。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteRefPickerSheet, NoteRefEditorSheet } from "./NoteRefSheets";
import { setNoteRefHost } from "../../features/editor/noteRef";
import type { NoteSummary } from "../../lib/types";

const note = (id: string, title: string, kind: "doc" | "usheet" = "doc"): NoteSummary => ({
  id, title, parentId: "nb-1", updatedAt: "2026-11-20T00:00:00.000Z",
  sortOrder: 0, isConflict: false, kind,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setNoteRefHost({ listNotes: () => [note("n1", "会议纪要"), note("n2", "项目计划"), note("n3", "读书笔记")], openNote: () => {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setNoteRefHost(null);
  vi.unstubAllGlobals();
});

const render = async (el: ReturnType<typeof createElement>) => { await act(async () => { root.render(el); }); };

describe("移动端文档引用 Sheet", () => {
  it("打开即列出全部文档；搜索框不自动聚焦；点行回传所选文档", async () => {
    const onPick = vi.fn();
    await render(createElement(NoteRefPickerSheet, { open: true, onPick, onClose: () => {} }));
    // 弹层是 mb-sheet 原语（portal 到 body），不是桌面 .ln-dialog/.ln-popover
    const sheet = document.body.querySelector<HTMLElement>(".mb-sheet");
    expect(sheet).toBeTruthy();
    expect(document.body.querySelector(".ln-dialog, .ln-popover")).toBeNull();
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-row")];
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("会议纪要"),
      expect.stringContaining("项目计划"),
      expect.stringContaining("读书笔记"),
    ]);
    // 用户点单「不应该默认筛选拉起键盘」：打开后焦点不在输入框
    const input = document.body.querySelector<HTMLInputElement>('.mb-note-ref__search input');
    expect(input).toBeTruthy();
    expect(document.activeElement).not.toBe(input);
    act(() => { rows[1].click(); });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe("n2");
  });

  it("搜索按标题过滤（默认态是全部文档）", async () => {
    await render(createElement(NoteRefPickerSheet, { open: true, onPick: () => {}, onClose: () => {} }));
    const input = document.body.querySelector<HTMLInputElement>('.mb-note-ref__search input')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "计划");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = [...document.body.querySelectorAll(".mb-row")];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("项目计划");
  });

  it("编辑 Sheet：无引用时「确定」禁用；选完文档回填标题并可确定回传 noteId", async () => {
    const onSave = vi.fn();
    await render(createElement(NoteRefEditorSheet, { open: true, value: {}, onSave, onClose: () => {} }));
    const text = document.body.querySelector<HTMLInputElement>('input[aria-label="文本"]')!;
    expect(text.value).toBe("");
    const confirm = (): HTMLButtonElement => [...document.body.querySelectorAll<HTMLButtonElement>(".mb-sheet__foot button")].find((b) => b.textContent === "确定")!;
    expect(confirm().disabled).toBe(true);
    // 点「链接」→ 在编辑 Sheet 之上开选文档 Sheet
    act(() => { document.body.querySelector<HTMLButtonElement>('button[aria-label="选择文档"]')!.click(); });
    const picker = [...document.body.querySelectorAll<HTMLElement>(".mb-sheet")];
    expect(picker.length).toBe(2);
    const row = [...document.body.querySelectorAll<HTMLButtonElement>(".mb-row")].find((r) => r.textContent?.includes("项目计划"))!;
    act(() => { row.click(); });
    expect(confirm().disabled).toBe(false);
    act(() => { confirm().click(); });
    expect(onSave).toHaveBeenCalledWith({ noteId: "n2", title: "项目计划" });
  });
});
