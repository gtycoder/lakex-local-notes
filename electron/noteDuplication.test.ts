import { describe, expect, it, vi } from "vitest";
import {
  commitPreparedDuplicateRecord,
  duplicateFailure,
  prepareDuplicateRecord,
  type DuplicatePreparePort,
  type PreparedDuplicate,
} from "./noteDuplication.js";

const SELF = "11111111-1111-4111-8111-111111111111";

function port(over: Partial<DuplicatePreparePort> = {}): DuplicatePreparePort {
  return {
    findSource: () => ({ title: "原文", parent_id: "nb", sort_order: 3, kind: "doc", trashed_at: null, node_type: "note", node_deleted_at: null }),
    bodyPathFor: () => "/body.lake",
    exists: () => true,
    readText: () => '<p data-lake-id="u1">hello</p>',
    collectAssets: () => [{ filename: "a.png", sourcePath: "/assets/a.png" }],
    getTagIds: () => ["tag-1"],
    ...over,
  };
}

describe("261108 创建副本纯编排（存储端口）", () => {
  it("prepare：校验/标题/正文改写/资产/标签快照；不依赖 Store", () => {
    const p = prepareDuplicateRecord(port(), SELF, { now: new Date("2026-11-07T08:00:00Z") });
    expect(p.sourceId).toBe(SELF);
    expect(p.title).toMatch(/^原文 副本 /);
    expect(p.content).toContain("data-lake-id");
    expect(p.assets).toEqual([{ filename: "a.png", sourcePath: "/assets/a.png" }]);
    expect(p.tagIds).toEqual(["tag-1"]);
    expect(p.kind).toBe("doc");
  });

  it("prepare：回收站/非文档/缺正文分别给契约 reason", () => {
    const reasonOf = (fn: () => unknown): unknown => { try { fn(); return null; } catch (error) { return (error as { duplicateReason?: unknown }).duplicateReason; } };
    expect(reasonOf(() => prepareDuplicateRecord(port({ findSource: () => ({ title: "x", parent_id: "notebook-trash", sort_order: 0, kind: "doc", trashed_at: null, node_type: "note", node_deleted_at: null }) }), SELF))).toBe("already-trashed");
    expect(reasonOf(() => prepareDuplicateRecord(port({ findSource: () => ({ title: "x", parent_id: "nb", sort_order: 0, kind: "doc", trashed_at: null, node_type: "group", node_deleted_at: null }) }), SELF))).toBe("unsupported");
    expect(reasonOf(() => prepareDuplicateRecord(port({ exists: () => false }), SELF))).toBe("body-missing");
  });

  it("commit：重读父级/sort_order，新建后补缓存/标签", () => {
    const prepared: PreparedDuplicate = {
      sourceId: SELF, newId: "22222222-2222-4222-8222-222222222222", title: "副本", kind: "doc",
      content: '<p data-lake-id="u2">x</p>', assets: [], tagIds: ["t"],
    };
    const create = vi.fn((_item, parentId: string | null, afterSortOrder: number) => ({ id: "created", parentId, sortOrder: afterSortOrder }));
    const afterCreate = vi.fn();
    const created = commitPreparedDuplicateRecord({
      findFresh: () => ({ parent_id: "nb2", sort_order: 9, trashed_at: null }),
      create,
      afterCreate,
    }, prepared);
    expect(created).toEqual({ id: "created", parentId: "nb2", sortOrder: 9 });
    expect(create).toHaveBeenCalledWith(prepared, "nb2", 9);
    expect(afterCreate).toHaveBeenCalledWith(created, prepared);
  });

  it("commit：源已进回收站 ⇒ already-trashed，不落库", () => {
    const create = vi.fn();
    let reason: unknown = null;
    try {
      commitPreparedDuplicateRecord({
        findFresh: () => ({ parent_id: null, sort_order: 0, trashed_at: "2026-11-07" }),
        create,
        afterCreate: vi.fn(),
      }, { sourceId: SELF, newId: "n", title: "t", kind: "doc", content: "", assets: [], tagIds: [] } as PreparedDuplicate);
    } catch (error) { reason = (error as { duplicateReason?: unknown }).duplicateReason; }
    expect(reason).toBe("already-trashed");
    expect(create).not.toHaveBeenCalled();
    expect(duplicateFailure("failed", "x")).toMatchObject({ duplicateReason: "failed" });
  });
});