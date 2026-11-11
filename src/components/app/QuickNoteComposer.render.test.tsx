// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 写作区 = Lake 内核实例（懒加载）：默认桩成普通 div；需要验 fallback 时把桩改成"挂起"。
const suspendState = vi.hoisted(() => ({ suspend: false }));
vi.mock("../../features/quickNotes/QuickNoteEditor", () => {
  const pending = new Promise<void>(() => { /* 永不 resolve：模拟 chunk 未到 */ });
  return {
    QuickNoteEditor: () => {
      if (suspendState.suspend) throw pending;
      return createElement("div", { className: "quick-note-editor-stub" });
    },
  };
});

import { QuickNoteComposer } from "./QuickNoteComposer";

/**
 * 小记写作卡（261110 第二批）：主按钮/保存并同步/取消已在第一批落 ln-btn；
 * 本轮把「＋添加标签」= ln-chip--add、标签 chip = ln-chip--static（移除钮 = ln-iconbtn--compact）。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const classesOf = (el: Element): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const onlyPrimitive = (el: Element): boolean => classesOf(el).every((name) => name.startsWith("ln-") || name.startsWith("is-"));

function render(onTagIdsChange = vi.fn(), onSave = vi.fn()) {
  const props = {
    draft: { id: "d1", text: "", body: "", images: [], tagIds: ["t_0000000000000001"], baseline: { text: "", body: "", imageCount: 0, tagIds: [] } },
    saving: false, syncing: false, cloudReady: true, variant: "pane" as const,
    uploadResource: vi.fn(), tagOptions: [{ id: "t_0000000000000001", name: "灵感", createdAt: "T", updatedAt: "T", count: 1 }],
    onTextChange: vi.fn(), onTagIdsChange, onCreateTag: vi.fn(async () => "t2"), onEditorReady: vi.fn(),
    onSave, onSaveAndSync: vi.fn(), onCancel: vi.fn(),
  };
  act(() => root.render(createElement(QuickNoteComposer, props)));
  return props;
}

describe("QuickNoteComposer（261110 第二批）", () => {
  it("懒加载挂起时 = 编辑器骨架 fallback（composer 变体），不再是一行裸文字", () => {
    suspendState.suspend = true;
    try {
      render();
      // 复用 .quick-note-editor 既有 flex/min-height 槽位，骨架自己不带固定高
      const slot = document.body.querySelector<HTMLElement>(".quick-note-composer .quick-note-editor");
      expect(slot).not.toBeNull();
      const fallback = slot!.querySelector<HTMLElement>(".editor-skeleton--composer");
      expect(fallback).not.toBeNull();
      expect(fallback!.querySelector(".editor-skeleton__toolbar")).toBeNull();
      expect(fallback!.querySelectorAll(".editor-skeleton__line").length).toBeGreaterThanOrEqual(4);
      // 可访问文案保留（视觉隐藏）
      expect(fallback!.querySelector(".a11y-visually-hidden")?.textContent).toBe("正在加载编辑器…");
    } finally {
      suspendState.suspend = false;
    }
  });

  it("「添加标签」= ln-chip--add；标签 chip = ln-chip--static + ln-iconbtn 移除钮", () => {
    render();
    const add = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-tags button")].find((b) => (b.textContent ?? "").includes("添加标签"))!;
    expect(add.className).toContain("ln-chip");
    expect(add.className).toContain("ln-chip--add");
    expect(onlyPrimitive(add)).toBe(true);
    const chip = document.body.querySelector<HTMLElement>(".quick-note-tags .ln-chip--static")!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("灵感");
    expect(chip.className.split(/\s+/).every((name) => name.startsWith("ln-"))).toBe(true);
    const remove = chip.querySelector<HTMLButtonElement>('button[aria-label="移除标签 灵感"]')!;
    expect(remove.className).toContain("ln-iconbtn");
    expect(remove.className).toContain("ln-iconbtn--compact");
    expect(onlyPrimitive(remove)).toBe(true);
  });

  it("移除钮点击 = 从 tagIds 移除；主按钮仍是 ln-btn--primary", () => {
    const { onTagIdsChange } = render();
    const remove = document.body.querySelector<HTMLButtonElement>('button[aria-label="移除标签 灵感"]')!;
    act(() => remove.click());
    expect(onTagIdsChange).toHaveBeenCalledWith([]);
    const publish = [...document.body.querySelectorAll<HTMLButtonElement>(".quick-note-composer-actions button")].find((b) => (b.textContent ?? "") === "小记一下")!;
    expect(publish.className).toContain("ln-btn--primary");
  });
});
