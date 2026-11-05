import { describe, expect, it } from "vitest";
import {
  SYNC_CONFLICT_MAX_ROWS,
  SYNC_CONFLICT_RETENTION_DAYS,
  saveExternalChangedEvent,
  selectConflictsToPrune,
  selectConflictEvents,
  unackedConflictCount,
} from "./syncConflictLog.js";
import type { WriteOp } from "./s3v3/plan/types.js";

const AT = "2026-11-05T08:00:00.000Z";

describe("syncConflictLog（第 4 项：同步覆盖/冲突账本纯逻辑）", () => {
  it("只记三类高价值事件：远端覆盖本地（archive-local/remote-wins）、他端 purge、他端删除小记", () => {
    const writes: WriteOp[] = [
      { kind: "archive-local", space: "lake", id: "n1", reason: "remote-wins" },
      { kind: "apply-remote", space: "lake", id: "n2", meta: { id: "n2" }, bodyHash: "h" },
      { kind: "archive-local", space: "lake", id: "n3", reason: "cloud-absent" },
      { kind: "set-lifecycle", space: "lake", id: "n4", lifecycle: "cloud-deleted" },
      { kind: "set-lifecycle", space: "lake", id: "n5", lifecycle: "trashed" },
      { kind: "quick-soft-delete", space: "quickNotes", id: "q1" },
      { kind: "quick-purge", space: "quickNotes", id: "q2" },
    ];
    const events = selectConflictEvents({ writes }, {
      at: AT,
      titleOf: (space, id) => (space === "lake" && id === "n1" ? "被覆盖的笔记" : undefined),
    });
    expect(events.map((e) => [e.space, e.noteId, e.kind])).toEqual([
      ["lake", "n1", "remote_wins"],
      ["lake", "n4", "remote_purged"],
      ["quickNotes", "q1", "remote_purged"],
      ["quickNotes", "q2", "remote_purged"],
    ]);
    expect(events[0].title).toBe("被覆盖的笔记");
    expect(events[0].at).toBe(AT);
    // 其余两类事件没有 title 时字段缺省（不要塞 undefined 键）
    expect("title" in events[1]).toBe(false);
  });

  it("同一轮内同一 (space,id,kind) 只记一条（plan 可能产生多笔写）", () => {
    const writes: WriteOp[] = [
      { kind: "archive-local", space: "lake", id: "n1", reason: "remote-wins" },
      { kind: "archive-local", space: "lake", id: "n1", reason: "remote-wins" },
      { kind: "set-lifecycle", space: "lake", id: "n1", lifecycle: "cloud-deleted" },
    ];
    const events = selectConflictEvents({ writes }, { at: AT });
    expect(events).toHaveLength(2); // remote_wins + remote_purged（kind 不同）
  });

  it("historyRef 提供时带给「恢复本地版」用；不提供则缺省", () => {
    const writes: WriteOp[] = [{ kind: "archive-local", space: "lake", id: "n1", reason: "remote-wins" }];
    const withRef = selectConflictEvents({ writes }, { at: AT, historyRefOf: () => "hist-42" });
    expect(withRef[0].historyRef).toBe("hist-42");
    const withoutRef = selectConflictEvents({ writes }, { at: AT });
    expect("historyRef" in withoutRef[0]).toBe(false);
  });

  it("保存守卫的磁盘冲突以审计事件入账（space=lake，independent of sync writes）", () => {
    const e = saveExternalChangedEvent({ noteId: "n1", at: AT, title: "T", localHash: "a", remoteHash: "b" });
    expect(e).toMatchObject({ noteId: "n1", space: "lake", kind: "save_external_changed", at: AT, title: "T", localHash: "a", remoteHash: "b" });
  });

  it("轮转：超过 500 条或超过 90 天的旧记录被裁掉（输入按时间倒序，非法时间保守保留）", () => {
    const now = new Date("2026-11-05T00:00:00.000Z");
    const dayMs = 86_400_000;
    const rows = [
      { id: "a", at: new Date(now.getTime() - 1 * dayMs).toISOString() },
      { id: "b", at: new Date(now.getTime() - (SYNC_CONFLICT_RETENTION_DAYS + 1) * dayMs).toISOString() },
      { id: "c", at: "not-a-date" },
    ];
    expect(selectConflictsToPrune(rows, now)).toEqual(["b"]);
    // 上限：新表按 maxRows 裁（保留最新）
    const many = Array.from({ length: SYNC_CONFLICT_MAX_ROWS + 2 }, (_, i) => ({
      id: "r" + i, at: new Date(now.getTime() - i * 1000).toISOString(),
    }));
    const drop = selectConflictsToPrune(many, now);
    expect(drop).toEqual(["r" + SYNC_CONFLICT_MAX_ROWS, "r" + (SYNC_CONFLICT_MAX_ROWS + 1)]);
    // 可配更小的上限
    expect(selectConflictsToPrune(many.slice(0, 5), now, { maxRows: 3 })).toEqual(["r3", "r4"]);
  });

  it("角标计数只看未 ack 的记录", () => {
    expect(unackedConflictCount([{ ackedAt: null }, {}, { ackedAt: "T" }])).toBe(2);
    expect(unackedConflictCount([])).toBe(0);
  });
});
