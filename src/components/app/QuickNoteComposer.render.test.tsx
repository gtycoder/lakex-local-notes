// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 写作区 = Lake 内核实例（懒加载）：本用例只验动作行按钮，编辑器桩掉。
vi.mock("../../features/quickNotes/QuickNoteEditor", () => ({
  QuickNoteEditor: () => createElement("div", { className: "quick-note-editor-stub" }),
}));

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
