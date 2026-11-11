// @vitest-environment jsdom
/**
 * AI 助手会话（261107 P2 单会话 → 261110 按作用域挂起）：
 * 每个作用域（空间 + 活动文档）最多一份；切走挂起、切回恢复；不同作用域互不影响。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiScopeNoteId, closeAiAssistant, closeAllAiAssistants, getAiAssistantSession, getAiAssistantSessions, openAiAssistant, readAiScope } from "./aiAssistantSession";
import type { AiAssistantRequest } from "./aiAssistantRequest";

const request = (): AiAssistantRequest => ({
  context: { kind: "none" },
  placement: { kind: "floating" },
  outputs: [],
  applyOutput: () => false,
});

/** 造作用域：空间态类 + 活动文档（data-active / data-note-id）。 */
function setScope(space: string, noteId: string): void {
  document.body.innerHTML = "<div class=\"app-shell\"></div>";
  const shell = document.body.firstElementChild as HTMLElement;
  if (space !== "library") shell.className = "app-shell " + space;
  if (noteId) {
    const tab = document.createElement("div");
    tab.className = "lake-editor-tab";
    tab.setAttribute("data-active", "true");
    tab.setAttribute("data-note-id", noteId);
    document.body.append(tab);
  }
}

beforeEach(() => {
  closeAllAiAssistants();
  document.body.innerHTML = "";
});

describe("AI 助手作用域", () => {
  it("readAiScope / aiScopeNoteId 取显式信号（空间态类 + 活动文档 id）", () => {
    setScope("library", "note-a");
    expect(readAiScope()).toBe("library::note-a");
    expect(aiScopeNoteId(readAiScope())).toBe("note-a");
    setScope("quick-notes-active", "");
    expect(readAiScope()).toBe("quick-notes-active::");
    expect(aiScopeNoteId(readAiScope())).toBe("");
  });

  it("同一作用域再开会替换旧的那份；dismiss 幂等且只清自己", () => {
    setScope("library", "note-a");
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    openAiAssistant(request(), firstCleanup);
    expect(getAiAssistantSessions()).toHaveLength(1);
    const second = openAiAssistant(request(), secondCleanup);
    expect(getAiAssistantSession()).toBe(second);
    expect(getAiAssistantSessions()).toHaveLength(1);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    second.dismiss();
    expect(getAiAssistantSession()).toBeNull();
    second.dismiss(); // 幂等
    expect(secondCleanup).toHaveBeenCalledTimes(2);
  });

  it("切到别的文档/空间时**不销毁**原会话（挂起），切回作用域仍能取到原来那份", () => {
    setScope("library", "note-a");
    const aCleanup = vi.fn();
    const a = openAiAssistant(request(), aCleanup);
    setScope("library", "note-b");
    expect(getAiAssistantSession()).toBeNull(); // B 里没有会话（B 打开才是 B 自己的）
    expect(getAiAssistantSessions().map((s) => s.scope)).toEqual(["library::note-a"]); // A 仍挂着
    setScope("quick-notes-active", "");
    expect(getAiAssistantSessions()).toHaveLength(1);
    setScope("library", "note-a"); // 回到 A
    expect(getAiAssistantSession()).toBe(a);
    expect(aCleanup).not.toHaveBeenCalled();
  });

  it("在 B 打开是 B 自己的新会话，A 的挂起份不受影响", () => {
    setScope("library", "note-a");
    const aCleanup = vi.fn();
    openAiAssistant(request(), aCleanup);
    setScope("library", "note-b");
    const bCleanup = vi.fn();
    const b = openAiAssistant(request(), bCleanup);
    expect(getAiAssistantSession()).toBe(b);
    expect(getAiAssistantSessions()).toHaveLength(2);
    expect(aCleanup).not.toHaveBeenCalled();
    // 关掉当前（B）只清 B
    closeAiAssistant();
    expect(bCleanup).toHaveBeenCalledTimes(1);
    expect(aCleanup).not.toHaveBeenCalled();
    expect(getAiAssistantSessions().map((s) => s.scope)).toEqual(["library::note-a"]);
  });
});