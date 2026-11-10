// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickNoteFilterDialog } from "./QuickNoteFilterDialog";
import type { QuickNoteFilterState } from "./QuickNoteFilterDialog";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";

/**
 * 快捷筛选对话框（261110 第二批按钮审计）：时间/类型/标签包含/排除四排 chip 全部迁到 kit 的
 * .ln-chip（普通 / 选中 / 危险排除三形态）；页脚与关闭钮沿用 ln-btn 梯队 / ln-iconbtn。
 */
const tags: QuickNoteTagSummary[] = [
  { id: "t1", name: "灵感", createdAt: "T", updatedAt: "T", count: 3 },
  { id: "t2", name: "项目", createdAt: "T", updatedAt: "T", count: 1 },
];
const value: QuickNoteFilterState = { time: { kind: "any" } as QuickNoteFilterState["time"], type: "all", tagFilter: { kind: "all" } };

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(onApply = vi.fn(), onClose = vi.fn()) {
  act(() => root.render(createElement(QuickNoteFilterDialog, { open: true, tags, value, onApply, onClose })));
  return { onApply, onClose };
}
const chips = (): HTMLButtonElement[] => [...document.body.querySelectorAll<HTMLButtonElement>("button.ln-chip")];
const chipByText = (text: string): HTMLButtonElement => chips().find((btn) => (btn.textContent ?? "").includes(text))!;
const classesOf = (el: Element): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
/** 类名只含 ln-*（状态类 is-* 不算视觉来源）；登记的 JSX 钩子除外。 */
const onlyPrimitive = (el: Element): boolean => classesOf(el).every((name) => name.startsWith("ln-") || name.startsWith("is-"));

describe("QuickNoteFilterDialog（261110 第二批）", () => {
  it("四组 chip 全是 kit 原语：类名只含 ln-*（排除档带 ln-chip--danger）", () => {
    render();
    const all = [...document.body.querySelectorAll<HTMLElement>(".quick-note-filter-dialog__chips button")];
    expect(all.length).toBeGreaterThanOrEqual(4 + 2 + 2 + 2);
    for (const btn of all) expect(onlyPrimitive(btn)).toBe(true);
    expect(document.body.querySelectorAll(".quick-note-tag")).toHaveLength(0);
    expect(document.body.querySelectorAll(".ln-chip--danger").length).toBeGreaterThanOrEqual(2);
  });

  it("时间档 / 类型档点击后 is-selected（同一时间只有一档选中）", () => {
    const { onApply } = render();
    act(() => chipByText("今天").click());
    act(() => chipByText("图片").click());
    expect(chipByText("今天").className).toContain("is-selected");
    expect(chipByText("全部").className).not.toContain("is-selected");
    // 应用后回灌：time/type 都按选中档给出
    act(() => [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-filter-dialog button")].find((b) => (b.textContent ?? "") === "应用")!.click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "image" }));
  });

  it("标签包含 / 排除互斥（同一标签不会同时出现在两段）", () => {
    const { onApply } = render();
    const includeRow = document.body.querySelectorAll<HTMLElement>(".quick-note-filter-dialog__chips")[2]!;
    const excludeRow = document.body.querySelectorAll<HTMLElement>(".quick-note-filter-dialog__chips")[3]!;
    act(() => [...includeRow.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").includes("灵感"))!.click());
    expect([...includeRow.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").includes("灵感"))!.className).toContain("is-selected");
    act(() => [...excludeRow.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").includes("灵感"))!.click());
    // include 里那个已被移除（不再是 is-selected）
    expect([...includeRow.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").includes("灵感"))!.className).not.toContain("is-selected");
    act(() => [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-filter-dialog button")].find((b) => (b.textContent ?? "") === "应用")!.click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ tagFilter: { kind: "selection", include: [], exclude: ["t1"] } }));
  });

  it("页脚 = ln-btn 梯队（重置 ghost / 应用 primary），关闭 = ln-iconbtn", () => {
    render();
    const reset = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-filter-dialog button")].find((b) => (b.textContent ?? "") === "重置")!;
    const apply = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-filter-dialog button")].find((b) => (b.textContent ?? "") === "应用")!;
    expect(reset.className).toContain("ln-btn--ghost");
    expect(apply.className).toContain("ln-btn--primary");
    const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!;
    expect(close.className).toContain("ln-iconbtn");
  });
});
