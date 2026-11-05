import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_NOTE_TAG_LENGTH,
  compareQuickNoteTagVersion,
  MAX_QUICK_NOTE_TAGS,
  addQuickNoteTagId,
  buildQuickNoteTagIndex,
  buildQuickNoteTagOptions,
  filterQuickNotesByTag,
  mergeQuickNoteTags,
  normalizeQuickNoteTag,
  normalizeQuickNoteTagEntity,
  normalizeQuickNoteTagIds,
  quickNoteTagId,
  moveQuickNoteTagOrder,
  removeQuickNoteTagId,
  sameQuickNoteTagDirectory,
  type QuickNoteTag,
} from "./quickNoteTags";

const tag = (name: string, patch: Partial<QuickNoteTag> = {}): QuickNoteTag => ({
  id: quickNoteTagId(name),
  name,
  createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
  deletedAt: null,
  ...patch,
});

describe("quickNoteTags", () => {
  it("归一标签名并拒绝空名、保留筛选名与超长名", () => {
    expect(normalizeQuickNoteTag("  aaa   bbb  ")).toBe("aaa bbb");
    expect(normalizeQuickNoteTag("e\u0301")).toBe("é");
    expect(() => normalizeQuickNoteTag("   ")).toThrow("标签名不能为空");
    expect(() => normalizeQuickNoteTag("无标签")).toThrow("筛选状态");
    expect(() => normalizeQuickNoteTag("x".repeat(MAX_QUICK_NOTE_TAG_LENGTH + 1))).toThrow("不能超过");
  });

  it("标签 ID 由名称稳定派生（同名同 ID，改名后 ID 不变）", () => {
    expect(quickNoteTagId("灵感")).toMatch(/^t_[a-f0-9]{16}$/);
    expect(quickNoteTagId("灵感")).toBe(quickNoteTagId(" 灵感 "));
    expect(quickNoteTagId("灵感")).not.toBe(quickNoteTagId("待办"));
  });

  it("标签 ID 列表去重、保持顺序并限制每条上限", () => {
    const a = quickNoteTagId("灵感");
    const b = quickNoteTagId("待办");
    expect(normalizeQuickNoteTagIds(undefined)).toEqual([]);
    expect(normalizeQuickNoteTagIds([a, b, a])).toEqual([a, b]);
    expect(() => normalizeQuickNoteTagIds(Array.from({ length: MAX_QUICK_NOTE_TAGS + 1 }, (_, i) => quickNoteTagId(`t${i}`)))).toThrow("最多");
    expect(() => normalizeQuickNoteTagIds(["not-an-id"])).toThrow("标签 ID");
  });

  it("新标签插到最前；重复添加不改变顺序", () => {
    const a = quickNoteTagId("待办");
    const b = quickNoteTagId("灵感");
    expect(addQuickNoteTagId([a], b)).toEqual([b, a]);
    expect(addQuickNoteTagId([b, a], b)).toEqual([b, a]);
    expect(removeQuickNoteTagId([b, a], b)).toEqual([a]);
  });

  it("标签目录实体校验：墓碑归一（顺序/置顶已不在模型内）", () => {
    const entity = normalizeQuickNoteTagEntity({ ...tag("灵感"), deletedAt: null });
    expect(entity).toMatchObject({ name: "灵感", deletedAt: null });
    expect("pinned" in entity).toBe(false);
    expect("sortOrder" in entity).toBe(false);
    expect(() => normalizeQuickNoteTagEntity({ ...tag("灵感"), id: "bad" })).toThrow("标签 ID");
  });

  it("目录 + 小记引用 → 计数与无标签数量（顺序由调用方目录顺序决定，core 不再排序）", () => {
    const a = tag("待办");
    const b = tag("灵感");
    const index = buildQuickNoteTagIndex(
      [{ tagIds: [a.id, b.id] }, { tagIds: [a.id] }, { tagIds: [] }],
      [b, a],
    );
    expect(index.tags.map((entry) => [entry.name, entry.count])).toEqual([["灵感", 1], ["待办", 2]]);
    expect(index.untaggedCount).toBe(1);
  });

  it("选择器/管理页选项含 0 条小记的标签（写作区曾因过滤掉而显示了 ID）", () => {
    const used = tag("灵感");
    const fresh = tag("新建未用");
    const deleted = tag("已删", { deletedAt: "2026-10-25T00:00:00.000Z" });
    const index = buildQuickNoteTagIndex([{ tagIds: [used.id] }], [used, fresh, deleted]);
    expect(index.tags.map((entry) => entry.name)).toEqual(["灵感"]);
    expect(buildQuickNoteTagOptions([used, fresh, deleted], index.tags)).toEqual([
      { ...used, count: 1 },
      { ...fresh, count: 0 },
    ]);
  });

  it("标签筛选支持全部、单标签、无标签与多选包含/排除", () => {
    const a = quickNoteTagId("待办");
    const b = quickNoteTagId("灵感");
    const c = quickNoteTagId("项目");
    const notes = [
      { id: "a", tagIds: [a, b] },
      { id: "b", tagIds: [a] },
      { id: "c", tagIds: [] },
    ];
    expect(filterQuickNotesByTag(notes, { kind: "all" }).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(filterQuickNotesByTag(notes, { kind: "tag", id: b }).map((n) => n.id)).toEqual(["a"]);
    expect(filterQuickNotesByTag(notes, { kind: "untagged" }).map((n) => n.id)).toEqual(["c"]);
    expect(filterQuickNotesByTag(notes, { kind: "selection", include: [a, b], exclude: [] }).map((n) => n.id)).toEqual(["a"]);
    expect(filterQuickNotesByTag(notes, { kind: "selection", include: [a], exclude: [b] }).map((n) => n.id)).toEqual(["b"]);
    expect(filterQuickNotesByTag(notes, { kind: "selection", include: [], exclude: [c] }).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("目录合并按 ID + updatedAt LWW（远端更新覆盖本地、墓碑同样生效）", () => {
    const local = tag("灵感", { updatedAt: "2026-10-24T00:00:00.000Z" });
    const remoteNewer = { ...local, name: "灵感库", updatedAt: "2026-10-25T00:00:00.000Z" };
    const merged = mergeQuickNoteTags([local], [remoteNewer]);
    expect(merged.map((entry) => entry.name)).toEqual(["灵感库"]);
    const mergedOlder = mergeQuickNoteTags([local], [{ ...local, name: "旧名", updatedAt: "2026-10-23T00:00:00.000Z" }]);
    expect(mergedOlder.map((entry) => entry.name)).toEqual(["灵感"]);
    const deleted = mergeQuickNoteTags([local], [{ ...local, updatedAt: "2026-10-25T00:00:00.000Z", deletedAt: "2026-10-25T00:00:00.000Z" }]);
    expect(deleted[0].deletedAt).toBe("2026-10-25T00:00:00.000Z");
  });

  it("目录等价比较：字段级、忽略顺序；任一字段变化即不等价（同步不做无谓重建）", () => {
    const a = tag("灵感");
    const b = tag("待办");
    expect(sameQuickNoteTagDirectory([a, b], [b, a])).toBe(true);
    expect(sameQuickNoteTagDirectory([a, b], [a])).toBe(false);
    expect(sameQuickNoteTagDirectory([a], [{ ...a, name: "灵感库" }])).toBe(false);
    expect(sameQuickNoteTagDirectory([a], [{ ...a, deletedAt: "2026-10-25T00:00:00.000Z" }])).toBe(false);
  });

  it("本机拖拽排序（纯函数）：前/后插入、未知 id 原样返回", () => {
    expect(moveQuickNoteTagOrder(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(moveQuickNoteTagOrder(["a", "b", "c"], "a", "b", "after")).toEqual(["b", "a", "c"]);
    expect(moveQuickNoteTagOrder(["a", "b", "c"], "x", "b", "after")).toEqual(["a", "b", "c"]);
    expect(moveQuickNoteTagOrder(["a", "b"], "a", "a", "before")).toEqual(["a", "b"]);
  });

  it("同一 updatedAt 用确定性 tie-break：两端合并必须选出同一赢家（否则改名/删除永不收敛）", () => {
    const local = tag("A");
    const remote = { ...local, name: "B" }; // updatedAt 相同、字段不同
    const ab = mergeQuickNoteTags([local], [remote]);
    const ba = mergeQuickNoteTags([remote], [local]);
    expect(ab.map((entry) => entry.name)).toEqual(ba.map((entry) => entry.name));
    expect(compareQuickNoteTagVersion(local, remote)).toBe(-compareQuickNoteTagVersion(remote, local));
    expect(compareQuickNoteTagVersion(local, { ...local })).toBe(0);
  });
});
