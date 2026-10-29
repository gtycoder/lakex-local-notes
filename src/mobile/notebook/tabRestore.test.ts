// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ maxOpenTabs: 0 }));

vi.mock("../../lib/settings", () => ({
  loadSettings: () => ({ maxOpenTabs: settings.maxOpenTabs }),
}));

import type { LocalNote } from "../data/noteRepository";
import { notebookTabsStorageKey, useNotebookTabs } from "./useNotebookTabs";

type Session = ReturnType<typeof useNotebookTabs>;

const KEY = notebookTabsStorageKey("nb-1");
const note = (id: string): LocalNote => ({
  id,
  title: id,
  content: `<p>${id}</p>`,
  updatedAt: "2026-10-22T00:00:00.000Z",
  parentId: null,
  kind: "doc",
});

let session: Session;
let readBody: (id: string) => Promise<LocalNote | null>;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

function Harness() {
  session = useNotebookTabs({
    notebookId: "nb-1",
    initialNoteId: null,
    getTitle: (id) => `title-${id}`,
    readBody,
    onReadError: vi.fn(),
    onMissing: vi.fn(),
  });
  return null;
}

function mount(): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Harness)));
}

function unmount(): void {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  settings.maxOpenTabs = 0;
  localStorage.clear();
  readBody = vi.fn(async (id: string) => note(id)) as unknown as (id: string) => Promise<LocalNote | null>;
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe("标签恢复（MOB-12：显式 restore + initial state，不靠 effect 顺序）", () => {
  it("首挂不覆盖存档：initial state 直接来自存档，首帧写回同一份", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", "b"]));
    mount();
    // 首帧（未经任何 restore）就按存档恢复，且写回内容不变
    expect(session.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    expect(session.activeId).toBe("b");
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(["a", "b"]));
  });

  it("恢复 N 个标签：顺序稳定（不被活动页插队），活动页可指定", () => {
    mount();
    act(() => session.restore(["c", "a", "b"], "a"));
    expect(session.tabs.map((tab) => tab.id)).toEqual(["c", "a", "b"]);
    expect(session.activeId).toBe("a");
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(["c", "a", "b"]));
    // 恢复只建占位，不并发读正文（活动页正文由工作区的懒加载 effect 补）
    expect(readBody).not.toHaveBeenCalled();
  });

  it("关闭全部后存档为 []，重新挂载恢复为空", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", "b"]));
    mount();
    act(() => session.clearTabs());
    expect(localStorage.getItem(KEY)).toBe("[]");
    expect(session.tabs).toEqual([]);
    expect(session.activeId).toBeNull();

    // 再次调用 restore([]) 仍是空；重新挂载（模拟重启）也从空存档开始
    act(() => session.restore([], null));
    expect(session.tabs).toEqual([]);
    expect(session.activeId).toBeNull();
    unmount();
    mount();
    expect(session.tabs).toEqual([]);
    expect(session.activeId).toBeNull();
  });
});
