// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickNoteCard } from "./QuickNoteCard";
import type { QuickNoteDocument } from "../../core/sharedTypes";

/**
 * 小记卡片（261110 第二批）：勾选框 = ln-check、动作钮 = ln-iconbtn--compact（删除 = ln-iconbtn--danger）、
 * 卡片标签 = ln-chip。
 */
const item = {
  id: "q1", createdAt: "2026-11-10T10:00:00.000Z", updatedAt: "2026-11-10T10:00:00.000Z",
  previewText: "买牛奶", imageCount: 0, contentHash: "h", syncState: "synced", isConflict: false,
  content: { version: 2, text: "买牛奶", body: "买牛奶", images: [], tagIds: ["t1"], tags: ["灵感"] },
} as unknown as QuickNoteDocument;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const classesOf = (el: Element): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
/** 类名只含 ln-*（状态类 is-* + 已登记的布局/测试钩子除外）。 */
const HOOKS = new Set(["quick-note-select"]);
const onlyPrimitive = (el: Element): boolean => classesOf(el).every((name) => name.startsWith("ln-") || name.startsWith("is-") || HOOKS.has(name));

function render(overrides: Partial<Parameters<typeof QuickNoteCard>[0]> = {}) {
  const props = {
    item, onNeedDetail: vi.fn(), revealed: false, deletePending: false, selecting: false, checked: false,
    onToggleSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onConvert: vi.fn(),
    onAddTag: vi.fn(), onFilterTag: vi.fn(), onToggleTask: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(QuickNoteCard, props)));
  return props;
}

describe("QuickNoteCard（261110 第二批）", () => {
  it("勾选框 = ln-check；卡片标签 = ln-chip（类名只含 ln-*）", () => {
    render();
    const check = document.body.querySelector<HTMLButtonElement>(".quick-note-select")!;
    expect(check.className).toContain("ln-check");
    const chips = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-card-tags button")];
    expect(chips).toHaveLength(1);
    expect(chips[0]!.className).toContain("ln-chip");
    expect(onlyPrimitive(chips[0]!)).toBe(true);
  });

  it("四个动作钮 = ln-iconbtn--compact（类名只含 ln-*），删除带 ln-iconbtn--danger", () => {
    const props = render();
    const actions = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-card-actions button")];
    expect(actions.map((b) => b.getAttribute("aria-label"))).toEqual(["添加标签", "转为正式笔记", "编辑小记", "删除小记"]);
    for (const btn of actions) {
      expect(onlyPrimitive(btn)).toBe(true);
      expect(btn.className).toContain("ln-iconbtn--compact");
    }
    expect(actions[3]!.className).toContain("ln-iconbtn--danger");
    act(() => actions[2]!.click());
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    act(() => actions[3]!.click());
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("已选态勾选框带 is-on 且只渲染 ln-*", () => {
    render({ checked: true });
    const check = document.body.querySelector<HTMLButtonElement>(".quick-note-select")!;
    expect(check.className).toContain("is-on");
    expect(onlyPrimitive(check)).toBe(true);
  });
});
