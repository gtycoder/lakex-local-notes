// @vitest-environment jsdom
/**
 * DT-15 行为护栏：useBootstrap 恢复标签会话的**计划**阶段。
 * 锁：① 恢复前按 maxOpenTabs 截断（只恢复最近 N 个，不再全开再淘汰）；
 *     ② 注入了 restoreTabs 时只调用一次（批量），不再逐篇 openNote；
 *     ③ 未注入时保持旧的逐篇行为（兼容）；全部恢复失败才回落冷启动落点。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const settingsMock = vi.hoisted(() => ({ current: { clearTabsOnExit: false, maxOpenTabs: 3 } }));
const nativeMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  getSyncSettings: vi.fn(),
  getS3Settings: vi.fn(),
  getSyncStatus: vi.fn(),
  getSyncPendingSummary: vi.fn(),
  listDraftJournals: vi.fn(),
  listTreeNodes: vi.fn(),
  noteBodyMissing: vi.fn(),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));
vi.mock("../lib/settings", () => ({ loadSettings: () => settingsMock.current }));

import { TAB_SESSION_KEY } from "../desktop/tabSession";
import { useBootstrap } from "./useBootstrap";

const NOTES = Array.from({ length: 10 }, (_, index) => ({
  id: "n" + (index + 1),
  title: "文档" + (index + 1),
  updatedAt: "2026-10-28T00:00:00Z",
  kind: "doc",
}));

interface HarnessProps {
  restoreTabs?: (ids: string[], activeId: string | null) => Promise<number>;
  openNote: Mock;
}

function Harness({ restoreTabs, openNote }: HarnessProps) {
  useBootstrap({
    setWorkspace: () => undefined,
    setNotes: () => undefined,
    setSync: () => undefined,
    setCloudEnabled: () => undefined,
    setS3Settings: () => undefined,
    setCloudConfigured: () => undefined,
    setConflictSnapshotNotice: () => undefined,
    setPendingSummary: () => undefined,
    setDraftEntries: () => undefined,
    setTreeNodes: () => undefined,
    setError: () => undefined,
    openNote,
    restoreTabs,
    showNotice: () => undefined,
  });
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  settingsMock.current = { clearTabsOnExit: false, maxOpenTabs: 3 };
  localStorage.clear();
  // 会话 = 10 个标签（打开顺序），活动标签是老的 n2（会被截断掉）。
  localStorage.setItem(TAB_SESSION_KEY, JSON.stringify({ ids: NOTES.map((note) => note.id), activeId: "n2" }));
  nativeMock.bootstrap.mockResolvedValue({ notes: NOTES, sync: {}, lastOpenedNoteId: "n5" });
  nativeMock.getSyncSettings.mockResolvedValue({ enabled: false });
  nativeMock.getS3Settings.mockResolvedValue(null);
  nativeMock.getSyncStatus.mockResolvedValue({ lastResult: null });
  nativeMock.getSyncPendingSummary.mockResolvedValue({ changes: 0 });
  nativeMock.listDraftJournals.mockResolvedValue([]);
  nativeMock.listTreeNodes.mockResolvedValue([]);
  nativeMock.noteBodyMissing.mockResolvedValue(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (check()) return;
    await flush();
  }
  throw new Error("等待超时：" + label);
}

async function render(props: HarnessProps): Promise<void> {
  await act(async () => { root.render(createElement(Harness, props)); });
}

describe("useBootstrap 标签会话恢复（DT-15）", () => {
  it("按 maxOpenTabs 截断后只调用一次 restoreTabs（最近 N 个 + 活动 id 回退），不再逐篇 openNote", async () => {
    const restoreTabs = vi.fn(async (_ids: string[], _activeId: string | null) => 3);
    const openNote = vi.fn(async (_id: string) => true);
    await render({ restoreTabs, openNote });
    await waitFor(() => restoreTabs.mock.calls.length > 0, "批量恢复被调用");
    await flush();

    expect(restoreTabs).toHaveBeenCalledTimes(1);
    // 会话末尾 3 个 = n8/n9/n10；活动 id n2 已被截断 ⇒ 回退到最后一个。
    expect(restoreTabs.mock.calls[0]).toEqual([["n8", "n9", "n10"], "n10"]);
    // 批量路径下 bootstrap 不再自己逐篇打开，也不走冷启动落点。
    expect(openNote).not.toHaveBeenCalled();
  });

  it("restoreTabs 一篇都没恢复时才回落冷启动落点（上次打开的文档）", async () => {
    const restoreTabs = vi.fn(async (_ids: string[], _activeId: string | null) => 0);
    const openNote = vi.fn(async (_id: string) => true);
    await render({ restoreTabs, openNote });
    await waitFor(() => openNote.mock.calls.length > 0, "冷启动落点打开文档");
    await flush();

    expect(restoreTabs).toHaveBeenCalledTimes(1);
    expect(openNote).toHaveBeenCalledWith("n5");
  });

  it("未注入 restoreTabs 时保持旧行为：按截断后的顺序逐篇 openNote，再激活活动标签", async () => {
    const openNote = vi.fn(async (_id: string) => true);
    await render({ openNote });
    await waitFor(() => openNote.mock.calls.length >= 4, "逐篇恢复 3 篇 + 激活");
    await flush();

    expect(openNote.mock.calls.map((call) => call[0])).toEqual(["n8", "n9", "n10", "n10"]);
  });
});
