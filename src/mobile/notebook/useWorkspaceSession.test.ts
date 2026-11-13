// @vitest-environment jsdom
/**
 * 保存屏障的 gone 处置（261114 移动端同类缺陷修复）：
 * 打开中的文档被删进回收站（本机删笔记本/分组级联、他端删除传播）后，写边界会永久拒绝保存
 * ⇒ 旧实现让 closeTab / 返回首页 / 完成编辑 全部失败（tab 关不掉、工作区退不出）。
 * 现在屏障先按 core.isGoneNote({parentId, trashedAt, syncState}) 判定，命中则走 discardTab
 * （取消待保存 + 移除标签 + 可见提示），不再拿保存去撞写边界。
 */
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveNote: vi.fn(async () => {}),
  noteGoneState: vi.fn(),
  showToast: vi.fn(),
  report: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: { saveNote: mocks.saveNote, noteGoneState: mocks.noteGoneState },
}));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("../lib/reportMobileActionError", () => ({ reportMobileActionError: mocks.report }));
vi.mock("../ui/haptics", () => ({ successFeedback: vi.fn() }));

import { useWorkspaceSession } from "./useWorkspaceSession";
import type { NotebookTab } from "./useNotebookTabs";

const GONE = { parentId: "nb1", syncState: "local", trashedAt: "2026-11-13T08:43:44.205Z" };
const ACTIVE = { parentId: "nb1", syncState: "local", trashedAt: null };

const tab = (id: string, overrides: Partial<NotebookTab> = {}): NotebookTab => ({
  id,
  title: id,
  content: "<p>v1</p>",
  editing: false,
  loaded: true,
  lastAccessedAt: 1,
  kind: "doc",
  ...overrides,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: ReturnType<typeof useWorkspaceSession>;
let latestTabs: NotebookTab[] = [];
let onBack: ReturnType<typeof vi.fn>;
let onSwitchNotebook: ReturnType<typeof vi.fn>;

function Harness({ initialTabs }: { initialTabs: NotebookTab[] }) {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeId] = useState(initialTabs[0]?.id ?? null);
  const tabsRef = useRef<NotebookTab[]>(tabs);
  tabsRef.current = tabs;
  latestTabs = tabs;
  const editorsRef = useRef(new Map());
  const liveBodyCapturesRef = useRef(new Map());
  api = useWorkspaceSession({
    tabsRef,
    active: tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null,
    updateTab: (id, patch) => setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    removeTab: (id) => setTabs((prev) => prev.filter((t) => t.id !== id)),
    clearTabs: () => setTabs([]),
    closeOverlay: vi.fn(),
    onBack: onBack as unknown as () => void,
    onSwitchNotebook: onSwitchNotebook as unknown as (id: string) => void,
    notebookId: "nb1",
    editorsRef,
    liveBodyCapturesRef,
  });
  return null;
}

const render = (initialTabs: NotebookTab[]) => {
  act(() => root.render(createElement(Harness, { initialTabs })));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  latestTabs = [];
  mocks.saveNote.mockResolvedValue(undefined);
  mocks.noteGoneState.mockImplementation(async (id: string) => (id === "n-gone" ? GONE : ACTIVE));
  onBack = vi.fn();
  onSwitchNotebook = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useWorkspaceSession 保存屏障的 gone 处置", () => {
  it("活跃文档：仍走保存屏障，保存成功后才关闭标签", async () => {
    render([tab("n1")]);
    act(() => { api.scheduleAutoSave("n1", "n1", "<p>edited</p>"); });
    await act(async () => { await api.closeTab("n1"); });
    expect(mocks.saveNote).toHaveBeenCalledWith("n1", "n1", "<p>edited</p>", null, undefined);
    expect(latestTabs).toHaveLength(0);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("gone 文档（parent 不变、只有 trashed_at）：关闭标签直接 discardTab，不拿保存撞写边界", async () => {
    render([tab("n-gone")]);
    // 编辑中被级联删除：失效前已排入一条待保存快照（旧实现会带着它去保存 ⇒ 被拒 ⇒ tab 关不掉）。
    act(() => { api.scheduleAutoSave("n-gone", "n-gone", "<p>dirty</p>"); });
    await act(async () => { await api.closeTab("n-gone"); });
    expect(mocks.saveNote).not.toHaveBeenCalled();
    expect(latestTabs).toHaveLength(0);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("回收站"), expect.objectContaining({ type: "info" }));
  });

  it("purge 后行已不存在（noteGoneState=null）：同样丢弃标签而不是去写墓碑", async () => {
    mocks.noteGoneState.mockResolvedValue(null);
    render([tab("n-purged")]);
    await act(async () => { await api.closeTab("n-purged"); });
    expect(mocks.saveNote).not.toHaveBeenCalled();
    expect(latestTabs).toHaveLength(0);
  });

  it("返回首页的保存屏障：gone 标签被丢弃并取消待保存，其它标签照常保存后放行", async () => {
    mocks.noteGoneState.mockImplementation(async (id: string) => (id === "n-gone" ? GONE : ACTIVE));
    render([tab("n-gone"), tab("n2")]);
    act(() => {
      api.scheduleAutoSave("n-gone", "n-gone", "<p>dirty</p>");
      api.scheduleAutoSave("n2", "n2", "<p>edited</p>");
    });
    await act(async () => { await api.handleBack(); });
    expect(mocks.saveNote).toHaveBeenCalledTimes(1);
    expect(mocks.saveNote).toHaveBeenCalledWith("n2", "n2", "<p>edited</p>", null, undefined);
    expect(latestTabs.map((t) => t.id)).toEqual(["n2"]);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("非 gone 的保存失败仍保留标签并给出可见原因（gone 处置不吞其它失败）", async () => {
    mocks.saveNote.mockRejectedValueOnce(new Error("磁盘已满"));
    render([tab("n1")]);
    act(() => { api.scheduleAutoSave("n1", "n1", "<p>edited</p>"); });
    await act(async () => { await api.closeTab("n1"); });
    expect(latestTabs.map((t) => t.id)).toEqual(["n1"]);
    expect(mocks.report).toHaveBeenCalled();
  });

  it("完成编辑（toggleEdit）：gone 文档不再尝试显式保存，直接丢弃标签并明说", async () => {
    render([tab("n-gone", { editing: true })]);
    await act(async () => { await api.toggleEdit(); });
    expect(mocks.saveNote).not.toHaveBeenCalled();
    expect(latestTabs).toHaveLength(0);
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("回收站"), expect.objectContaining({ type: "info" }));
  });
});
