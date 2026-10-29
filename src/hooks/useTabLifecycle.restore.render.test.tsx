// @vitest-environment jsdom
/**
 * DT-15 行为护栏：启动时**批量**恢复标签会话（useTabLifecycle.restoreTabs）。
 *
 * 锁三件事（都是 261027 串行 for await openNote() 的真实缺陷）：
 *   ① 有界并发读正文（不再 N 次串行 IPC 把首屏拉长）；
 *   ② 一批一条 setOpenTabs（不再逐篇提交、途中被 evictTabsForLimit 反复淘汰）；
 *   ③ 会话顺序 / 活动标签 / maxOpenTabs 截断 语义不变。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const nativeMock = vi.hoisted(() => ({ readNote: vi.fn() }));
vi.mock("../lib/native", () => ({ native: { readNote: nativeMock.readNote } }));
vi.mock("../features/editor/editorViewport", () => ({ clearScrollMemory: vi.fn(), locateEditorSearchHit: vi.fn() }));

import { TAB_RESTORE_READ_CONCURRENCY, useTabLifecycle } from "./useTabLifecycle";
import type { OpenTab } from "../desktop/desktopTypes";

type Api = ReturnType<typeof useTabLifecycle>;

let api: Api | null = null;
const setOpenTabs: Mock = vi.fn();
const setActiveNoteId: Mock = vi.fn();
const setError: Mock = vi.fn();
const showNotice: Mock = vi.fn();

function Harness({ maxOpenTabs }: { maxOpenTabs: number }) {
  api = useTabLifecycle({
    settingsMaxOpenTabs: maxOpenTabs,
    pinnedNoteIds: new Set<string>(),
    openTabsRef: { current: [] },
    persistTab: async () => ({ ok: true }),
    scheduleSave: () => {},
    resetRevision: () => {},
    showNotice,
    setError,
    setOpenTabs: setOpenTabs as never,
    setActiveNoteId: setActiveNoteId as never,
    setPinnedNoteIds: () => {},
    setDraftEntries: () => {},
    setSaveState: () => {},
  });
  return null;
}

const note = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: "标题-" + id, content: "c-" + id, updatedAt: "2026-10-28T00:00:00Z", parentId: null, ...over,
});

/** 每次调用都真的"在途"5ms：用来量真实并发峰值。 */
let inFlight = 0;
let peak = 0;
function installReadNote(overrides: Record<string, Record<string, unknown>> = {}, failIds: string[] = []): void {
  inFlight = 0; peak = 0;
  nativeMock.readNote.mockImplementation(async (id: string) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    if (failIds.includes(id)) throw new Error("read failed: " + id);
    return note(id, overrides[id]);
  });
}

/** setOpenTabs 的提交结果（最后一次调用的函数式更新，以空数组求值）。 */
function committedTabs(): OpenTab[] {
  const arg = setOpenTabs.mock.calls.at(-1)?.[0];
  return typeof arg === "function" ? (arg([]) as OpenTab[]) : (arg as OpenTab[]);
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setOpenTabs.mockClear(); setActiveNoteId.mockClear(); setError.mockClear(); showNotice.mockClear();
  nativeMock.readNote.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  api = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(maxOpenTabs: number): Promise<void> {
  await act(async () => { root.render(createElement(Harness, { maxOpenTabs })); });
}

describe("useTabLifecycle.restoreTabs（DT-15 批量恢复标签会话）", () => {
  it("有界并发读正文 + 一次 setOpenTabs，顺序与活动标签保持", async () => {
    installReadNote();
    await mount(8);
    const ids = ["n1", "n2", "n3", "n4", "n5", "n6"];
    let opened = 0;
    await act(async () => { opened = await api!.restoreTabs(ids, "n4"); });

    // ① 并发：6 个任务、上限 4 ⇒ 峰值正好 4（串行实现会恒为 1）。
    expect(peak).toBe(TAB_RESTORE_READ_CONCURRENCY);
    expect(nativeMock.readNote).toHaveBeenCalledTimes(ids.length);
    // ② 一次提交（逐篇 openNote 会是 6 次 setOpenTabs）。
    expect(setOpenTabs).toHaveBeenCalledTimes(1);
    expect(opened).toBe(ids.length);
    // ③ 顺序 = 会话顺序；lastAccessedAt 递增（末尾最新，LRU 淘汰语义不变）。
    const tabs = committedTabs();
    expect(tabs.map((tab) => tab.noteId)).toEqual(ids);
    const accesses = tabs.map((tab) => tab.lastAccessedAt);
    expect([...accesses].sort((a, b) => a - b)).toEqual(accesses);
    expect(new Set(accesses).size).toBe(ids.length);
    expect(setActiveNoteId).toHaveBeenLastCalledWith("n4");
    expect(setError).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("防御性按 maxOpenTabs 截断（只读最近 N 篇）并保留只读/缺正文/类型标记", async () => {
    installReadNote({ n4: { bodyMissing: true, kind: "bitable" }, n5: { parentId: "notebook-trash" } });
    await mount(3);
    let opened = 0;
    await act(async () => { opened = await api!.restoreTabs(["n1", "n2", "n3", "n4", "n5", "n6"], null); });

    // 会话末尾 3 篇 = n4/n5/n6；前面 3 篇根本不读。
    expect((nativeMock.readNote.mock.calls as unknown[][]).map((call) => call[0])).toEqual(["n4", "n5", "n6"]);
    const tabs = committedTabs();
    expect(tabs.map((tab) => tab.noteId)).toEqual(["n4", "n5", "n6"]);
    expect(opened).toBe(3);
    expect(tabs[0].bodyMissing).toBe(true);
    expect(tabs[0].kind).toBe("bitable");
    expect(tabs[1].deleted).toBe(true);
    // 没有"超限自动关闭"提示（截断发生在打开之前，不再出现打开即淘汰）。
    expect(showNotice.mock.calls.map((call) => String(call[0]))).not.toContain("已自动关闭最旧的标签");
    // activeId 缺省 ⇒ 最后一个（最近的标签）。
    expect(setActiveNoteId).toHaveBeenLastCalledWith("n6");
  });

  it("单篇读失败只跳过该篇（顺序仍按会话），错误上报一次", async () => {
    installReadNote({}, ["n5"]);
    await mount(8);
    let opened = 0;
    await act(async () => { opened = await api!.restoreTabs(["n4", "n5", "n6"], "n6"); });

    expect(opened).toBe(2);
    expect(committedTabs().map((tab) => tab.noteId)).toEqual(["n4", "n6"]);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setActiveNoteId).toHaveBeenLastCalledWith("n6");
  });
});
