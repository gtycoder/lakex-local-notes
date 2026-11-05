// @vitest-environment jsdom
/**
 * 「同步记录」列表页（261105 P1 第 4 项）：
 * 类型文案/时间/标题、未读角标、只给该行真能做的动作（打开笔记 / 恢复本地被覆盖版）、
 * ack 与「全部已读」、恢复必须二次确认且失败明确报错、空态与不可用降级。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSyncConflicts: vi.fn(),
  ackSyncConflicts: vi.fn(),
  restoreSyncConflict: vi.fn(),
  confirmMobile: vi.fn(async () => true),
  showToast: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    listSyncConflicts: mocks.listSyncConflicts,
    ackSyncConflicts: mocks.ackSyncConflicts,
    restoreSyncConflict: mocks.restoreSyncConflict,
  },
}));
vi.mock("../ui/ConfirmDialog", () => ({ confirmMobile: mocks.confirmMobile }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));
vi.mock("../ui/MobileSheet", () => ({
  MobileSheet: ({ children, title }: { children: unknown; title?: unknown }) => (
    <div data-testid="sheet"><div>{String(title ?? "")}</div>{children as never}</div>
  ),
}));

import { SyncConflictsEntry, SyncConflictsSheet, conflictKindLabel, canRestoreConflict, conflictTitle } from "./SyncConflictsSheet";

const AT = "2026-11-05T10:30:00.000Z";
const row = (over: Record<string, unknown>) => ({
  id: "c1", noteId: "n1", space: "lake", kind: "remote_wins", at: AT, title: "周报",
  localHash: "h-local", remoteHash: "h-remote", historyRef: "12", ackedAt: null, resolvedAt: null, resolution: null,
  ...over,
});
const ROWS = [
  row({}),
  row({ id: "c2", noteId: "n2", kind: "remote_purged", title: "被删文档", historyRef: null, ackedAt: AT }),
  row({ id: "c3", noteId: "n3", kind: "save_external_changed", title: "", historyRef: null }),
  row({ id: "c4", noteId: "q1", space: "quickNotes", kind: "remote_wins", title: "一条小记" }),
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;
const opened: string[] = [];
const changed: number[] = [];

async function renderSheet(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <SyncConflictsSheet
        open
        onClose={() => undefined}
        onOpenNote={(id) => opened.push(id)}
        onChanged={() => changed.push(1)}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const buttons = (text: string): HTMLButtonElement[] =>
  [...host.querySelectorAll("button")].filter((el) => (el.textContent ?? "").trim().includes(text)) as HTMLButtonElement[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  opened.length = 0;
  changed.length = 0;
  mocks.listSyncConflicts.mockReset().mockResolvedValue({ items: ROWS, unacked: 3 });
  mocks.ackSyncConflicts.mockReset().mockResolvedValue({ acked: 1, unacked: 2 });
  mocks.restoreSyncConflict.mockReset().mockResolvedValue({ ok: true, noteId: "n1", restoredFromHistory: true });
  mocks.confirmMobile.mockReset().mockResolvedValue(true);
  mocks.showToast.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("SyncConflictsSheet 列表", () => {
  it("每类事件都有中文类型文案；显示标题/时间；缺标题有兜底", async () => {
    await renderSheet();
    expect(host.textContent).toContain("远端覆盖本地");
    expect(host.textContent).toContain("他端删除");
    expect(host.textContent).toContain("保存时磁盘被改");
    expect(host.textContent).toContain("周报");
    expect(host.textContent).toContain("（无标题文档）");
    expect(host.textContent).toContain("2026");
    expect(conflictKindLabel("remote_wins")).toBe("远端覆盖本地");
  });

  it("只给该行真能做的动作：打开笔记=文档行；恢复=远端覆盖本地的文档行；小记行只读", async () => {
    await renderSheet();
    const open = buttons("打开笔记");
    expect(open.length).toBe(3); // c1/c2/c3 都是 lake
    expect(buttons("恢复本地被覆盖版").length).toBe(1); // 只有 c1 (remote_wins+lake)
    expect(host.textContent).toContain("小记的同步记录仅可查看");
    expect(canRestoreConflict(row({}) as never)).toBe(true);
    expect(canRestoreConflict(row({ space: "quickNotes" }) as never)).toBe(false);
    expect(canRestoreConflict(row({ kind: "remote_purged" }) as never)).toBe(false);
    expect(conflictTitle(row({ title: " " }) as never)).toBe("（无标题文档）");
  });

  it("未读数 > 0 时给「全部已读（N）」；点击调用 ack 并刷新列表 + 通知父层", async () => {
    await renderSheet();
    const all = buttons("全部已读（3）")[0];
    expect(all).toBeTruthy();
    mocks.listSyncConflicts.mockResolvedValue({ items: ROWS.map((r) => ({ ...r, ackedAt: AT })), unacked: 0 });
    await act(async () => { all.click(); await Promise.resolve(); });
    expect(mocks.ackSyncConflicts).toHaveBeenCalledWith(undefined);
    expect(mocks.listSyncConflicts).toHaveBeenCalledTimes(2);
    expect(changed.length).toBe(1);
  });

  it("单条「标记已读」用 ids 调用 ack", async () => {
    await renderSheet();
    const one = buttons("标记已读")[0];
    await act(async () => { one.click(); await Promise.resolve(); });
    expect(mocks.ackSyncConflicts).toHaveBeenCalledWith(["c1"]);
  });

  it("打开笔记：回调携带 noteId", async () => {
    await renderSheet();
    await act(async () => { buttons("打开笔记")[0].click(); });
    expect(opened).toEqual(["n1"]);
  });
});

describe("SyncConflictsSheet 恢复", () => {
  it("必须二次确认；确认后调 restore，成功提示「会覆盖云端」并刷新", async () => {
    await renderSheet();
    await act(async () => { buttons("恢复本地被覆盖版")[0].click(); await Promise.resolve(); });
    expect(mocks.confirmMobile).toHaveBeenCalledTimes(1);
    const confirmArgs = (mocks.confirmMobile.mock.calls[0] as unknown[])[0] as { body?: string };
    expect(String(confirmArgs.body)).toContain("覆盖云端的远端版本");
    expect(mocks.restoreSyncConflict).toHaveBeenCalledWith("c1");
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("下次同步会覆盖云端"));
    expect(changed.length).toBe(1);
  });

  it("取消确认 ⇒ 不调用恢复", async () => {
    mocks.confirmMobile.mockResolvedValue(false);
    await renderSheet();
    await act(async () => { buttons("恢复本地被覆盖版")[0].click(); await Promise.resolve(); });
    expect(mocks.restoreSyncConflict).not.toHaveBeenCalled();
  });

  it("恢复失败（历史过期）⇒ 明确报错，不静默、不刷新计数", async () => {
    mocks.restoreSyncConflict.mockResolvedValue({ ok: false, reason: "history-expired", message: "历史快照已过期或被清理，无法恢复" });
    await renderSheet();
    await act(async () => { buttons("恢复本地被覆盖版")[0].click(); await Promise.resolve(); });
    expect(mocks.showToast).toHaveBeenCalledWith("历史快照已过期或被清理，无法恢复", { type: "error" });
    expect(changed.length).toBe(0);
  });

  it("P2-D already-resolved ⇒ 中性提示（不报错）+ 刷新列表，不谎称「已恢复」", async () => {
    mocks.restoreSyncConflict.mockResolvedValue({ ok: false, reason: "already-resolved", message: "这条同步记录已经处理过（无需重复恢复）" });
    await renderSheet();
    await act(async () => { buttons("恢复本地被覆盖版")[0].click(); await Promise.resolve(); });
    expect(mocks.showToast).toHaveBeenCalledWith("这条同步记录已经处理过（无需重复恢复）");
    // 不是 error 类型（用户没有做错事）
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.anything(), { type: "error" });
    expect(changed.length).toBe(1);
  });
});

describe("P2-D alive guard（关闭/卸载后不再 setState）", () => {
  it("列表请求晚于卸载返回 ⇒ 不抛错、不写状态", async () => {
    let resolveList: ((value: unknown) => void) | null = null;
    mocks.listSyncConflicts.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderSheet();
    await act(async () => { root?.unmount(); });
    root = null;
    await act(async () => {
      resolveList!({ items: ROWS, unacked: 3 });
      await Promise.resolve(); await Promise.resolve();
    });
    // React 18 对卸载后的 setState 不再告警，但「晚到结果被丢弃」仍应表现为没有任何错误输出。
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("SyncConflictsSheet 空态/降级 + 入口角标", () => {
  it("无记录 ⇒ 空态文案", async () => {
    mocks.listSyncConflicts.mockResolvedValue({ items: [], unacked: 0 });
    await renderSheet();
    expect(host.textContent).toContain("还没有同步记录");
    expect(buttons("全部已读").length).toBe(0);
  });

  it("账本不可用 ⇒ 如实提示（不假装空列表）", async () => {
    mocks.listSyncConflicts.mockRejectedValue(new Error("数据库未打开"));
    await renderSheet();
    expect(host.textContent).toContain("同步记录暂不可用");
    expect(host.textContent).toContain("数据库未打开");
    expect(host.textContent).not.toContain("还没有同步记录");
  });

  it("入口：有未读显示「N 处覆盖/删除」，0 不渲染", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const r = createRoot(container);
    await act(async () => {
      r.render(<div><SyncConflictsEntry count={0} onOpen={() => undefined} /><SyncConflictsEntry count={4} onOpen={() => undefined} /></div>);
    });
    expect(container.textContent).toContain("最近同步有 4 处覆盖/删除");
    expect(container.textContent).not.toContain("0 处");
    await act(async () => r.unmount());
    container.remove();
  });
});
