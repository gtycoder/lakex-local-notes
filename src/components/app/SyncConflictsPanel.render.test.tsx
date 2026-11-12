// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncConflictsPanel, type SyncConflictsPanelProps } from "./SyncConflictsPanel";
import { SYNC_CONFLICT_KIND_LABEL } from "./syncConflicts";
import type { SyncConflictRow } from "../../lib/types";

/**
 * 「同步记录」页（P1 第 4 项）：列表/空态/分类文案、ack、恢复二次确认与成功失败路径、跳转回调、a11y。
 * 恢复动作本身由 App/主进程做，这里只锁 UI 契约（按钮出现条件 + 确认文案 + 回调入参）。
 */
const row = (over: Partial<SyncConflictRow> = {}): SyncConflictRow => ({
  id: "c1", noteId: "n1", space: "lake", kind: "remote_wins",
  at: "2026-11-05T00:00:00.000Z", title: "周报", ...over,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false); });

function render(overrides: Partial<SyncConflictsPanelProps> = {}) {
  const props: SyncConflictsPanelProps = {
    open: true,
    items: [row(), row({ id: "c2", noteId: "n2", kind: "remote_purged", title: "被删文档", at: "2026-11-04T00:00:00.000Z" }), row({ id: "c3", noteId: "n3", kind: "save_external_changed", title: "磁盘被改", at: "2026-11-03T00:00:00.000Z" })],
    onClose: vi.fn(),
    onAckAll: vi.fn(),
    onRestore: vi.fn(),
    onOpenNote: vi.fn(),
    onViewHistory: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(SyncConflictsPanel, props)));
  return props;
}
const byAria = (label: string): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');

describe("SyncConflictsPanel（同步记录页）", () => {
  it("列表：时间倒序、三类文案、标题、未读标记", () => {
    render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("同步记录");
    expect(text).toContain(SYNC_CONFLICT_KIND_LABEL.remote_wins);
    expect(text).toContain(SYNC_CONFLICT_KIND_LABEL.remote_purged);
    expect(text).toContain(SYNC_CONFLICT_KIND_LABEL.save_external_changed);
    expect(text).toContain("周报");
    expect(document.body.querySelectorAll(".sync-conflicts__row.is-unread")).toHaveLength(3);
  });

  it("空态：最近没有同步记录；全部标记已读在无未读时禁用", () => {
    render({ items: [] });
    expect(document.body.textContent).toContain("最近没有同步记录");
    render({ items: [row({ ackedAt: "2026-11-05T02:00:00.000Z" })] });
    const ack = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").includes("全部标记已读"))!;
    expect(ack.disabled).toBe(true);
  });

  it("全部标记已读：有未读时可用并回调整体 ack", () => {
    const props = render();
    const ack = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").includes("全部标记已读"))!;
    expect(ack.disabled).toBe(false);
    act(() => ack.click());
    expect(props.onAckAll).toHaveBeenCalledTimes(1);
  });

  it("恢复入口只在可恢复类型上出现；保存拦截 / 已处理 / 小记行没有恢复", () => {
    render({
      items: [
        row(),
        row({ id: "c4", kind: "remote_wins", resolvedAt: "2026-11-05T01:00:00.000Z", resolution: "restored" }),
        row({ id: "c5", kind: "save_external_changed" }),
        row({ id: "c6", space: "quickNotes", kind: "remote_purged", title: "小记一条" }),
      ],
    });
    // 第一条（lake remote_wins，未处理）+ 小记 remote_purged（走回收站恢复）可恢复；
    // 已处理 / save_external_changed 不可恢复。
    expect(byAria("恢复本地被覆盖版 周报")).toBeTruthy();
    expect(byAria("恢复本地被覆盖版 小记一条")).toBeTruthy();
    expect(document.body.querySelectorAll('button[aria-label^="恢复本地被覆盖版"]')).toHaveLength(2);
    // 已处理行有「已处理」标记
    expect(document.body.textContent).toContain("已处理");
    // 小记行：不给「打开笔记/查看历史」（导航在另一套空间），给明确说明
    expect(document.body.textContent).toContain("小记空间：到「小记」里查看");
    expect(byAria("打开笔记 小记一条")).toBeNull();
    expect(byAria("查看历史 小记一条")).toBeNull();
  });

  it("恢复是二次确认：文案写明覆盖云端远端版本 + 按本机版本重传；确认后才回调", async () => {
    const props = render();
    act(() => byAria("恢复本地被覆盖版 周报")!.click());
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("恢复本地被覆盖版");
    expect(bodyText).toContain("按本机版本重新上传");
    expect(props.onRestore).not.toHaveBeenCalled();
    await act(async () => {
      const confirmBtn = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "") === "恢复本地版");
      confirmBtn?.click();
      await Promise.resolve();
    });
    expect(props.onRestore).toHaveBeenCalledTimes(1);
    expect(props.onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("打开笔记 / 查看历史：把该行传给回调", () => {
    const props = render();
    act(() => byAria("打开笔记 周报")!.click());
    expect(props.onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", noteId: "n1" }));
    act(() => byAria("查看历史 周报")!.click());
    expect(props.onViewHistory).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("恢复中/状态行：busy 行按钮禁用并显示「恢复中…」；失败/成功文案原样展示", () => {
    render({ busyId: "c1", statusText: "历史快照已过期或被清理，无法恢复本地被覆盖版。" });
    const restoreBtn = byAria("恢复本地被覆盖版 周报")!;
    expect(restoreBtn.disabled).toBe(true);
    expect(restoreBtn.textContent).toContain("恢复中…");
    expect(document.body.textContent).toContain("历史快照已过期");
  });

  it("读取失败：展示可读错误；关闭按钮回调", () => {
    const props = render({ error: "标签数据暂不可用（示例）" });
    expect(document.body.textContent).toContain("标签数据暂不可用（示例）");
    act(() => byAria("关闭同步记录")?.click());
    expect(props.onClose).toHaveBeenCalled();
  });
});
