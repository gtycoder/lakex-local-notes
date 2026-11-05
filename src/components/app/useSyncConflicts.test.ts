// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listSyncConflicts: vi.fn(),
  ackSyncConflicts: vi.fn(),
  restoreSyncConflict: vi.fn(),
}));
vi.mock("../../lib/native", () => ({ native: h }));

import { useSyncConflicts, type SyncConflictsController } from "./useSyncConflicts";

/** 「同步记录」控制器（P1）：账本读数 / ack / 恢复成功失败路径。 */
const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", noteId: "n1", space: "lake", kind: "remote_wins", at: "2026-11-05T00:00:00.000Z", title: "周报", ...over,
});

let api: SyncConflictsController;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
function Harness({ enabled, syncToken }: { enabled: boolean; syncToken: string }) {
  api = useSyncConflicts({ enabled, syncToken });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window as unknown as { lakeNative?: unknown }).lakeNative = { listSyncConflicts: () => {}, ackSyncConflicts: () => {}, restoreSyncConflict: () => {} };
  // c1 较新（主进程也按 at 倒序返回；UI 再兜一次排序）。第一次是未读态；ack 后的重读返回已读态。
  const unread = {
    items: [row({ id: "c1", at: "2026-11-06T00:00:00.000Z" }), row({ id: "c2", at: "2026-11-05T00:00:00.000Z", kind: "remote_purged", title: "被删" })],
    unacked: 2,
  };
  const acked = {
    items: [
      row({ id: "c1", at: "2026-11-06T00:00:00.000Z", ackedAt: "2026-11-06T01:00:00.000Z" }),
      row({ id: "c2", at: "2026-11-05T00:00:00.000Z", kind: "remote_purged", title: "被删", ackedAt: "2026-11-06T01:00:00.000Z" }),
    ],
    unacked: 0,
  };
  // mockReset 清掉上一个用例没消费掉的 "Once"（测试隔离：否则 once 队列会串到下一条用例）
  h.listSyncConflicts.mockReset().mockResolvedValueOnce(unread).mockResolvedValue(acked);
  h.ackSyncConflicts.mockReset().mockResolvedValue({ acked: 2, unacked: 0 });
  h.restoreSyncConflict.mockResolvedValue({ ok: true, noteId: "n1", restoredFromHistory: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { lakeNative?: unknown }).lakeNative;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function flush(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}
async function render(enabled = true) {
  act(() => root.render(createElement(Harness, { enabled, syncToken: "T1" })));
  await flush();
}

describe("useSyncConflicts（同步记录控制器）", () => {
  it("可见时拉账本：items 按时间倒序 + 未读数", async () => {
    await render();
    expect(h.listSyncConflicts).toHaveBeenCalledTimes(1);
    expect(api.items.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(api.unacked).toBe(2);
    expect(api.error).toBeNull();
  });

  it("不可见（keep-alive 的非活动顶栏）不拉账本", async () => {
    await render(false);
    expect(h.listSyncConflicts).not.toHaveBeenCalled();
    expect(api.unacked).toBe(0);
  });

  it("ack：全部标记已读 → 未读归零、已读时间补齐、重读账本", async () => {
    await render();
    await act(async () => { await api.ackAll(); await Promise.resolve(); });
    expect(h.ackSyncConflicts).toHaveBeenCalledTimes(1);
    expect(h.ackSyncConflicts).toHaveBeenCalledWith();
    expect(api.unacked).toBe(0);
    expect(api.items.every((item) => !!item.ackedAt)).toBe(true);
    expect(h.listSyncConflicts).toHaveBeenCalledTimes(2);
  });

  it("恢复成功：提示「已恢复…下次同步按本机版本上传」并重读", async () => {
    await render();
    await act(async () => { await api.restore(api.items[0]); await Promise.resolve(); });
    expect(h.restoreSyncConflict).toHaveBeenCalledWith("c1");
    expect(api.statusText).toContain("已恢复本地版本");
    expect(api.statusText).toContain("历史快照");
    expect(api.busyId).toBeNull();
    expect(h.listSyncConflicts).toHaveBeenCalledTimes(2);
  });

  it("恢复失败：按 reason 给明确文案（历史过期），不静默", async () => {
    h.restoreSyncConflict.mockResolvedValue({ ok: false, reason: "history-expired" });
    await render();
    await act(async () => { await api.restore(api.items[0]); await Promise.resolve(); });
    expect(api.statusText).toContain("已过期");
    expect(api.busyId).toBeNull();
  });

  it("恢复在途时 busyId 指向该行；完成后清空", async () => {
    let release!: (value: unknown) => void;
    h.restoreSyncConflict.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await render();
    let pending!: Promise<void>;
    act(() => { pending = api.restore(api.items[0]); });
    expect(api.busyId).toBe("c1");
    await act(async () => { release({ ok: true, noteId: "n1", restoredFromHistory: false }); await pending; });
    expect(api.busyId).toBeNull();
    expect(api.statusText).toContain("回收站副本");
  });

  it("打开/关闭面板：打开时清掉上一次的状态文案", async () => {
    h.restoreSyncConflict.mockResolvedValue({ ok: false, reason: "history-missing" });
    await render();
    await act(async () => { await api.restore(api.items[0]); await Promise.resolve(); });
    expect(api.statusText).toBeTruthy();
    act(() => api.openPanel());
    expect(api.panelOpen).toBe(true);
    expect(api.statusText).toBeNull();
    act(() => api.closePanel());
    expect(api.panelOpen).toBe(false);
  });
});
