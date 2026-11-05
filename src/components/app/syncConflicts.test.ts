import { describe, expect, it } from "vitest";
import {
  SYNC_CONFLICT_KIND_LABEL,
  canRestoreSyncConflict,
  restoreFailureText,
  sortConflictsNewestFirst,
  syncConflictKindHint,
  syncConflictTitle,
} from "./syncConflicts";
import type { SyncConflictRow } from "../../lib/types";

const row = (over: Partial<SyncConflictRow> = {}): SyncConflictRow => ({
  id: "c1", noteId: "n1", space: "lake", kind: "remote_wins", at: "2026-11-05T00:00:00.000Z", ...over,
});

describe("同步记录 UI 文案与判据（P1 第 4 项）", () => {
  it("三类事件各有一句唯一文案 + 补充说明", () => {
    expect(SYNC_CONFLICT_KIND_LABEL).toEqual({
      remote_wins: "远端覆盖本地",
      remote_purged: "他端已删除",
      save_external_changed: "保存时磁盘被改",
    });
    for (const kind of ["remote_wins", "remote_purged", "save_external_changed"] as const) {
      expect(syncConflictKindHint(kind).length).toBeGreaterThan(0);
    }
    expect(syncConflictKindHint("remote_wins")).toContain("历史");
    expect(syncConflictKindHint("save_external_changed")).toContain("未写盘");
  });

  it("恢复入口只在 remote_wins / remote_purged 且未处理时出现（保存拦截无恢复目标）", () => {
    expect(canRestoreSyncConflict(row())).toBe(true);
    expect(canRestoreSyncConflict(row({ kind: "remote_purged" }))).toBe(true);
    expect(canRestoreSyncConflict(row({ kind: "save_external_changed" }))).toBe(false);
    expect(canRestoreSyncConflict(row({ resolvedAt: "2026-11-05T01:00:00.000Z" }))).toBe(false);
    // 小记没有历史快照：只有 remote_purged 能走回收站恢复
    expect(canRestoreSyncConflict(row({ space: "quickNotes", kind: "remote_purged" }))).toBe(true);
    expect(canRestoreSyncConflict(row({ space: "quickNotes", kind: "save_external_changed" }))).toBe(false);
  });

  it("列表按时间倒序（主进程已排好也要兜一次）", () => {
    const rows = [row({ id: "a", at: "2026-11-01T00:00:00.000Z" }), row({ id: "c", at: "2026-11-05T00:00:00.000Z" }), row({ id: "b", at: "2026-11-03T00:00:00.000Z" })];
    expect(sortConflictsNewestFirst(rows).map((item) => item.id)).toEqual(["c", "b", "a"]);
    // 同一毫秒按 id 兜底，结果稳定
    const same = sortConflictsNewestFirst([row({ id: "b", at: "T" }), row({ id: "a", at: "T" })]);
    expect(same.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("标题快照缺失时用 noteId 兜底，绝不空行", () => {
    expect(syncConflictTitle(row({ title: "周报" }))).toBe("周报");
    expect(syncConflictTitle(row({ title: "   " }))).toBe("n1");
    expect(syncConflictTitle(row({ title: null }))).toBe("n1");
  });

  it("恢复失败按 reason 给明确文案（历史缺失/过期/不支持/内部）", () => {
    expect(restoreFailureText({ ok: false, reason: "history-missing" })).toContain("没有可用的历史快照");
    expect(restoreFailureText({ ok: false, reason: "history-expired" })).toContain("已过期");
    expect(restoreFailureText({ ok: false, reason: "not-found" })).toContain("已不存在");
    expect(restoreFailureText({ ok: false, reason: "unsupported" })).toContain("不支持");
    expect(restoreFailureText({ ok: false, reason: "not-in-trash" })).toContain("回收站");
    expect(restoreFailureText({ ok: false, reason: "internal", message: "磁盘满" })).toContain("磁盘满");
    expect(restoreFailureText({ ok: false, reason: "weird" })).toContain("weird");
  });
});
