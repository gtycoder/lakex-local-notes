/**
 * syncDecisions 表驱动测试（Step B）：6 判定 + G1 条目构造（v4 编码逐字段断言）+ G2 记账 + G5 行映射。
 * 输入输出对照 electron/sync.ts 原内联逻辑（行为零变化护栏）。
 */
import { describe, expect, it } from "vitest";
import {
  TRASH_NOTEBOOK_ID,
  decidePurge, decideLocalTombstone, decideTrashCross, decideMetaApply,
  decideTrashYield, decideTombstoneYield,
  buildUploadEntry, buildTombstoneEntry, computeBookkeeping, rowToLocalState,
  type LocalNoteState,
} from "./syncDecisions.js";

const T0 = "2026-08-22T00:00:00.000Z";
const T1 = "2026-08-22T01:00:00.000Z";

function mkLocal(over: Partial<LocalNoteState> = {}): LocalNoteState {
  return { id: "n1", title: "t", parentId: null, sortOrder: 0, updatedAt: T0, syncState: "local", isConflict: false, ...over };
}

function mkRemote(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "n1", title: "t", parentId: null, sortOrder: 0, updatedAt: T0, contentHash: "a".repeat(64), isConflict: false, assets: [], ...over };
}

describe("decidePurge", () => {
  it("本地有副本 + 无恢复标记 → apply-purge", () => {
    expect(decidePurge(mkLocal(), false)).toBe("apply-purge");
  });
  it("本地有副本 + restore-pending → skip", () => {
    expect(decidePurge(mkLocal(), true)).toBe("skip-restore-pending");
  });
  it("本地无 → remember-deleted（防复活）", () => {
    expect(decidePurge(null, false)).toBe("remember-deleted");
  });
});

describe("decideLocalTombstone", () => {
  it("无本地墓碑 → none", () => {
    expect(decideLocalTombstone(T1, undefined)).toBe("none");
  });
  it("远端恢复较新 → revoke", () => {
    expect(decideLocalTombstone(T1, T0)).toBe("revoke");
  });
  it("本地删除较新 → keep-local-delete", () => {
    expect(decideLocalTombstone(T0, T1)).toBe("keep-local-delete");
  });
  it("时间相等 → 本地删除优先（非严格大于）", () => {
    expect(decideLocalTombstone(T0, T0)).toBe("keep-local-delete");
  });
});

describe("decideTrashCross", () => {
  it("两端回收站状态一致 → no-cross", () => {
    expect(decideTrashCross(mkLocal({ parentId: TRASH_NOTEBOOK_ID }), mkRemote({ parentId: TRASH_NOTEBOOK_ID }) as never, false)).toBe("no-cross");
  });
  it("远端入回收站 + 本地 active → move-to-trash（删除压编辑）", () => {
    expect(decideTrashCross(mkLocal(), mkRemote({ parentId: TRASH_NOTEBOOK_ID, trashedAt: T1 }) as never, false)).toBe("move-to-trash");
  });
  it("远端入回收站 + restore-pending → skip（恢复例外）", () => {
    expect(decideTrashCross(mkLocal(), mkRemote({ parentId: TRASH_NOTEBOOK_ID }) as never, true)).toBe("skip-restore-pending");
  });
  it("本地回收站 + 远端恢复较新 → restore（跟随恢复）", () => {
    expect(decideTrashCross(mkLocal({ parentId: TRASH_NOTEBOOK_ID, trashedAt: T0 }), mkRemote({ updatedAt: T1 }) as never, false)).toBe("restore");
  });
  it("本地回收站 + 远端旧 → keep-trash（本地删除较新）", () => {
    expect(decideTrashCross(mkLocal({ parentId: TRASH_NOTEBOOK_ID, trashedAt: T1 }), mkRemote({ updatedAt: T0 }) as never, false)).toBe("keep-trash");
  });
  it("无本地 → no-cross", () => {
    expect(decideTrashCross(null, mkRemote() as never, false)).toBe("no-cross");
  });
});

describe("decideMetaApply", () => {
  it("无基线 → 应用远端", () => {
    expect(decideMetaApply(T1, null)).toBe(true);
  });
  it("远端新于基线 → 应用", () => {
    expect(decideMetaApply(T1, T0)).toBe(true);
  });
  it("远端旧于基线 → 保留本地", () => {
    expect(decideMetaApply(T0, T1)).toBe(false);
  });
});

describe("decideTrashYield", () => {
  it("远端 active 且更新 → 让位", () => {
    expect(decideTrashYield(mkLocal({ trashedAt: T0 }), mkRemote({ parentId: null, updatedAt: T1 }) as never)).toBe(true);
  });
  it("远端也是回收站 → 不让位", () => {
    expect(decideTrashYield(mkLocal({ trashedAt: T0 }), mkRemote({ parentId: TRASH_NOTEBOOK_ID, updatedAt: T1 }) as never)).toBe(false);
  });
  it("远端 deleted → 不让位", () => {
    expect(decideTrashYield(mkLocal({ trashedAt: T0 }), mkRemote({ deleted: true, updatedAt: T1 }) as never)).toBe(false);
  });
  it("远端旧 → 不让位", () => {
    expect(decideTrashYield(mkLocal({ trashedAt: T1 }), mkRemote({ updatedAt: T0 }) as never)).toBe(false);
  });
});

describe("decideTombstoneYield", () => {
  it("远端 active 且更新 → 墓碑让位", () => {
    expect(decideTombstoneYield(T0, mkRemote({ updatedAt: T1 }) as never)).toBe(true);
  });
  it("远端 deleted/旧 → 不让位", () => {
    expect(decideTombstoneYield(T1, mkRemote({ updatedAt: T0 }) as never)).toBe(false);
    expect(decideTombstoneYield(T0, mkRemote({ deleted: true }) as never)).toBe(false);
    expect(decideTombstoneYield(T0, null)).toBe(false);
  });
});

// ---- G1: v4 编码逐字段断言（防旧 C1 编码漂移） ----
describe("buildUploadEntry（v4 编码）", () => {
  it("正常上传（非回收站）：无 trashedAt/deletedFromParentId/deleted 字段", () => {
    const entry = buildUploadEntry({ note: mkLocal(), contentHash: "b".repeat(64), assets: [{ filename: "x.png", size: 1, hash: "c".repeat(64) }] });
    expect(entry.parentId).toBeNull();
    expect(entry.trashedAt).toBeUndefined();
    expect(entry.deletedFromParentId).toBeUndefined();
    expect(entry.deleted).toBeUndefined();
    expect(entry.contentHash).toBe("b".repeat(64));
    expect(entry.isLocked).toBe(false);
    expect(entry.icon).toBeNull();
  });

  it("skip-fast 形态（远端 assets 复用 + 远端 trashedAt）", () => {
    const note = mkLocal({ parentId: TRASH_NOTEBOOK_ID, trashedAt: T1 });
    const entry = buildUploadEntry({ note, contentHash: "b".repeat(64), assets: [], trashedAt: T1, deletedFromParentId: "orig-parent" });
    expect(entry.parentId).toBe(TRASH_NOTEBOOK_ID);
    expect(entry.trashedAt).toBe(T1);
    expect(entry.deletedFromParentId).toBe("orig-parent");
    expect(entry.deleted).toBeUndefined();
  });

  it("正常上传（回收站条目）：本地 trashedAt 入条目", () => {
    const note = mkLocal({ parentId: TRASH_NOTEBOOK_ID, trashedAt: T1 });
    const entry = buildUploadEntry({ note, contentHash: "b".repeat(64), assets: [], trashedAt: T1, deletedFromParentId: "orig" });
    expect(entry.trashedAt).toBe(T1);
  });

  it("锁/图标字段透传", () => {
    const entry = buildUploadEntry({ note: mkLocal({ isLocked: true, lockedAt: T1, icon: "📁" }), contentHash: "b".repeat(64), assets: [] });
    expect(entry.isLocked).toBe(true);
    expect(entry.lockedAt).toBe(T1);
    expect(entry.icon).toBe("📁");
  });
});

describe("buildTombstoneEntry", () => {
  it("墓碑编码：deleted:true + deletedAt，不携带资源", () => {
    const entry = buildTombstoneEntry({ id: "n1", title: "gone", parentId: null, sortOrder: 0, updatedAt: T0, deletedAt: T1 }, "tomb-hash");
    expect(entry.deleted).toBe(true);
    expect(entry.deletedAt).toBe(T1);
    expect(entry.contentHash).toBe("tomb-hash");
    expect(entry.assets).toEqual([]);
  });
});

// ---- G2 ----
describe("computeBookkeeping", () => {
  it("deleted 墓碑跳过（不产生 lastUploadedHash 记账）", () => {
    const items = computeBookkeeping([
      { id: "a", title: "a", parentId: null, sortOrder: 0, updatedAt: T0, contentHash: "a".repeat(64), isConflict: false, assets: [] },
      { id: "b", title: "b", parentId: null, sortOrder: 0, updatedAt: T0, contentHash: "placeholder", isConflict: false, assets: [], deleted: true, deletedAt: T1 },
    ]);
    expect(items.map((i) => i.id)).toEqual(["a"]);
  });

  it("快照 = manifest 字段（V5 §5.2）", () => {
    const items = computeBookkeeping([
      { id: "a", title: "标题", parentId: "p", sortOrder: 3, updatedAt: T1, contentHash: "a".repeat(64), isConflict: false, assets: [], isLocked: true, lockedAt: T1, icon: "i" },
    ]);
    expect(items[0].snapshot).toEqual({
      contentHash: "a".repeat(64), updatedAt: T1, title: "标题", parentId: "p", sortOrder: 3,
      isLocked: true, lockedAt: T1, icon: "i",
    });
  });
});

// ---- G5 ----
describe("rowToLocalState", () => {
  it("snake_case 行 → LocalState 字段映射", () => {
    const state = rowToLocalState({
      id: "n1", title: "t", parent_id: "p", sort_order: 2, updated_at: T1, sync_state: "synced",
      is_conflict: 1, is_locked: 1, locked_at: T1, icon: "📁", trashed_at: null, deleted_from_parent_id: null,
    });
    expect(state).toEqual({
      id: "n1", title: "t", parentId: "p", sortOrder: 2, updatedAt: T1, syncState: "synced",
      isConflict: true, isLocked: true, lockedAt: T1, icon: "📁", trashedAt: null, deletedFromParentId: null,
    });
  });
});
