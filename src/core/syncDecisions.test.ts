/**
 * syncDecisions 表驱动测试（Step B）：purge 判定 + 行映射 + 「已删除」判定。
 * 261028：manifest v2 的 7 个 legacy 决策（含 v4 条目编码/记账）已删，对应断言同批移除。
 */
import { describe, expect, it } from "vitest";
import {
  TRASH_NOTEBOOK_ID,
  decidePurge, rowToLocalState, isGoneNote,
  type LocalNoteState,
} from "./syncDecisions.js";

const T0 = "2026-08-22T00:00:00.000Z";
const T1 = "2026-08-22T01:00:00.000Z";

function mkLocal(over: Partial<LocalNoteState> = {}): LocalNoteState {
  return { id: "n1", title: "t", parentId: null, sortOrder: 0, updatedAt: T0, syncState: "local", isConflict: false, ...over };
}

describe("TRASH_NOTEBOOK_ID", () => {
  // CORE-09：单一来源 = 这里；桌面 store.ts 再导出同一个常量（不再各写一份字面量）。
  // 字面量是持久化契约（历史行/云端索引按它判定）⇒ 断言住，改动必须当数据迁移处理。
  it("字面量冻结为 notebook-trash（改动 = 数据迁移）", () => {
    expect(TRASH_NOTEBOOK_ID).toBe("notebook-trash");
  });
});

describe("decidePurge", () => {
  it("本地有副本 + 无恢复标记 → apply-purge", () => {
    expect(decidePurge(mkLocal(), false)).toBe("apply-purge");
  });
  it("本地有副本 + restore-pending → skip", () => {
    expect(decidePurge(mkLocal(), true)).toBe("skip-restore-pending");
  });
  it("本地行已标 purged（移动端行保留表示）→ skip-already-purged（幂等）", () => {
    expect(decidePurge(mkLocal({ syncState: "purged" }), false)).toBe("skip-already-purged");
  });
  it("本地行已标 purged + restore-pending → 恢复优先", () => {
    expect(decidePurge(mkLocal({ syncState: "purged" }), true)).toBe("skip-restore-pending");
  });
  it("本地无 → remember-deleted（防复活）", () => {
    expect(decidePurge(null, false)).toBe("remember-deleted");
  });
});

// ---- G5 ----
describe("rowToLocalState", () => {
  it("snake_case 行 → LocalState 字段映射", () => {
    const state = rowToLocalState({
      id: "n1", title: "t", parent_id: "p", sort_order: 2, updated_at: T1, is_dirty: 0,
      is_conflict: 1, is_locked: 1, locked_at: T1, icon: "📁", trashed_at: null, deleted_from_parent_id: null,
    });
    expect(state).toEqual({
      id: "n1", title: "t", parentId: "p", sortOrder: 2, updatedAt: T1, syncState: "synced",
      isConflict: true, isEditLocked: true, editLockedAt: T1, icon: "📁", trashedAt: null, deletedFromParentId: null,
      kind: "doc",
    });
  });

  it("kind 归一：usheet/bitable/board/ink 原样保留，未知值回退 doc", () => {
    const kindOf = (raw: string | null) => rowToLocalState({
      id: "n1", title: "t", parent_id: null, sort_order: 0, updated_at: T0, is_dirty: 1,
      is_conflict: 0, is_locked: 0, locked_at: null, icon: null, trashed_at: null, deleted_from_parent_id: null,
      kind: raw,
    }).kind;
    expect(kindOf("board")).toBe("board");
    expect(kindOf("usheet")).toBe("usheet");
    expect(kindOf("legacy-kind")).toBe("doc");   // 未知 / 已废弃 kind：不做迁移 / 兼容（AGENTS §3#7），一律回退 doc
    expect(kindOf("bitable")).toBe("bitable");
    expect(kindOf("ink")).toBe("ink");
    expect(kindOf("gantt")).toBe("doc");
    expect(kindOf(null)).toBe("doc");
  });
});

describe("isGoneNote（打开与同步共用的「已删除」判定）", () => {
  const mk = (parentId: string | null, syncState: string) => ({ parentId, syncState });
  it("回收站里的文档 = 已删除（不得再编辑保存）", () => {
    expect(isGoneNote(mk(TRASH_NOTEBOOK_ID, "local"))).toBe(true);
    expect(isGoneNote(mk(TRASH_NOTEBOOK_ID, "synced"))).toBe(true);
  });
  it("被他端 purge 的文档 = 已删除", () => {
    expect(isGoneNote(mk("notebook-a", "purged"))).toBe(true);
  });
  it("普通文档（含根层与未分类兜底父）不算已删除", () => {
    expect(isGoneNote(mk("notebook-a", "synced"))).toBe(false);
    expect(isGoneNote(mk("notebook-a", "local"))).toBe(false);
    expect(isGoneNote(mk(null, "local"))).toBe(false);
  });
});
