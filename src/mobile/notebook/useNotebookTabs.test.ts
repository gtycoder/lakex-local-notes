// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ maxOpenTabs: 0 }));

vi.mock("../../lib/settings", () => ({
  loadSettings: () => ({ maxOpenTabs: settings.maxOpenTabs }),
}));

import type { LocalNote } from "../data/noteRepository";
import { useNotebookTabs } from "./useNotebookTabs";

type Session = ReturnType<typeof useNotebookTabs>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const note = (id: string, title = id): LocalNote => ({
  id,
  title,
  content: `<p>${id}</p>`,
  updatedAt: "2026-10-22T00:00:00.000Z",
  parentId: null,
  kind: "doc",
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let session: Session;

function Harness(props: {
  readBody: (id: string) => Promise<LocalNote | null>;
  onDrop?: (id: string) => void;
  onMissing?: () => void;
}) {
  session = useNotebookTabs({
    notebookId: "nb-1",
    initialNoteId: null,
    getTitle: (id) => `title-${id}`,
    readBody: props.readBody,
    onReadError: vi.fn(),
    onMissing: props.onMissing ?? (() => {}),
    onDrop: props.onDrop,
  });
  return null;
}

const render = (props: Parameters<typeof Harness>[0]) => {
  act(() => root.render(createElement(Harness, props)));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  settings.maxOpenTabs = 0;
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useNotebookTabs 行为", () => {
  it("只读活动页正文；非活动历史标签保持未加载占位，切回后才挂载并保持 keep-alive", async () => {
    const readBody = vi.fn(async (id: string) => note(id));
    render({ readBody });

    await act(async () => { await session.openTab("a"); });
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(session.tabs.find((tab) => tab.id === "a")?.loaded).toBe(true);
    expect(session.mountedIds.has("a")).toBe(true);

    await act(async () => { await session.openTab("b", { activate: false, load: false }); });
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(session.tabs.find((tab) => tab.id === "b")?.loaded).toBe(false);
    expect(session.mountedIds.has("b")).toBe(false);

    await act(async () => { await session.openTab("b"); });
    expect(readBody).toHaveBeenCalledTimes(2);
    expect(session.activeId).toBe("b");
    expect(session.mountedIds.has("a")).toBe(true);
    expect(session.mountedIds.has("b")).toBe(true);
  });

  it("超过标签上限时按 LRU 淘汰非活动页，并释放外部资源", async () => {
    settings.maxOpenTabs = 2;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
    const onDrop = vi.fn();
    render({ readBody: async (id) => note(id), onDrop });

    await act(async () => { await session.openTab("a", { load: false }); });
    vi.setSystemTime(new Date("2026-10-22T00:00:01.000Z"));
    await act(async () => { await session.openTab("b", { load: false }); });
    vi.setSystemTime(new Date("2026-10-22T00:00:02.000Z"));
    await act(async () => { await session.openTab("c", { load: false }); });

    expect(session.tabs.map((tab) => tab.id)).toEqual(["b", "c"]);
    expect(onDrop).toHaveBeenCalledWith("a");
    expect(session.activeId).toBe("c");
  });

  it("关闭活动标签后选择相邻标签；删空后 activeId 收回 null", async () => {
    render({ readBody: async (id) => note(id) });
    await act(async () => {
      await session.openTab("a", { load: false });
      await session.openTab("b", { load: false });
    });
    expect(session.activeId).toBe("b");

    act(() => session.removeTab("b"));
    expect(session.activeId).toBe("a");
    act(() => session.removeTab("a"));
    expect(session.activeId).toBeNull();
    expect(session.tabs).toEqual([]);
  });

  it("关闭全部会丢弃在途 readNote 的回包，不允许异步把标签加回来", async () => {
    const pending = deferred<LocalNote | null>();
    const onDrop = vi.fn();
    render({ readBody: () => pending.promise, onDrop });

    let opening!: Promise<void>;
    act(() => { opening = session.openTab("a"); });
    expect(session.tabs.map((tab) => tab.id)).toEqual(["a"]);

    act(() => session.clearTabs());
    await act(async () => { pending.resolve(note("a")); await opening; });

    expect(session.tabs).toEqual([]);
    expect(session.activeId).toBeNull();
    expect(session.mountedIds.size).toBe(0);
    expect(onDrop).toHaveBeenCalledWith("a");
  });

  it("正文读回空时退出占位并收回 activeId", async () => {
    const onMissing = vi.fn();
    render({ readBody: async () => null, onMissing });
    await act(async () => { await session.openTab("missing"); });
    expect(session.tabs).toEqual([]);
    expect(session.activeId).toBeNull();
    expect(onMissing).toHaveBeenCalledTimes(1);
  });
});
