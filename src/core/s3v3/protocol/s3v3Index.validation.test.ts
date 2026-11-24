import { describe, expect, it } from "vitest";
import { validateLakeIndex, validateQuickNotesIndex } from "./s3v3Index.js";

const H = (ch: string): string => ch.repeat(64);
const TS = "2026-11-24T00:00:00.000Z";

/**
 * 261124 P3-4/P3-5（审计③发现 4/5）：线格式最后防线的两处破洞 ——
 * ① folders 循环只查不加 ⇒ 两条 folder 同 id 通过校验（违反 §5.4「键内唯一」，下游 Map 静默去重）；
 * ② quick 的 tagIds/tagsUpdatedAt 硬化弱于 lake ⇒ 坏 tagsUpdatedAt 永久压制小记标签 LWW。
 */
describe("P3-4/P3-5：索引校验补洞", () => {
  const folder = (id: string) => ({ id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: TS, space: null });

  it("P3-4：两条 folder 同 id 必须拒绝（此前只查不加 ⇒ 通过）", () => {
    expect(() => validateLakeIndex({ v: 3, space: "lake", notes: [], folders: [folder("a"), folder("a")] })).toThrow(/重复/);
  });

  it("P3-4 对照：note/folder 跨类同 id 仍拒；正常目录通过", () => {
    expect(() => validateLakeIndex({ v: 3, space: "lake", notes: [{ id: "a", title: "n", parentId: null, sortOrder: 0, updatedAt: TS, contentHash: H("a") }], folders: [folder("a")] })).toThrow(/重复/);
    expect(() => validateLakeIndex({ v: 3, space: "lake", notes: [], folders: [folder("a"), folder("b")] })).not.toThrow();
  });

  it("P3-5：quick 的垃圾 tagsUpdatedAt 拒绝（此前通过 ⇒ 永久压制标签 LWW）", () => {
    const item = { id: "q1", createdAt: TS, updatedAt: TS, contentHash: H("a"), tagsUpdatedAt: "zzz" };
    expect(() => validateQuickNotesIndex({ v: 3, space: "quickNotes", items: [item], tags: [] })).toThrow(/tagsUpdatedAt/);
  });

  it("P3-5：quick tagIds 去重 + 上限（与 lake 同口径）", () => {
    const dup = { id: "q1", createdAt: TS, updatedAt: TS, contentHash: H("a"), tagIds: ["t1", "t1"], tagsUpdatedAt: TS };
    expect(() => validateQuickNotesIndex({ v: 3, space: "quickNotes", items: [dup], tags: [] })).toThrow(/重复/);
    const many = { id: "q1", createdAt: TS, updatedAt: TS, contentHash: H("a"), tagIds: Array.from({ length: 65 }, (_, i) => "t" + i), tagsUpdatedAt: TS };
    expect(() => validateQuickNotesIndex({ v: 3, space: "quickNotes", items: [many], tags: [] })).toThrow(/过多/);
    const ok = { id: "q1", createdAt: TS, updatedAt: TS, contentHash: H("a"), tagIds: ["t1"], tagsUpdatedAt: TS };
    expect(() => validateQuickNotesIndex({ v: 3, space: "quickNotes", items: [ok], tags: [] })).not.toThrow();
  });
});
