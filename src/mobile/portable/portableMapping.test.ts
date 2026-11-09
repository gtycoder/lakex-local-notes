import { describe, expect, it } from "vitest";
import {
  mapDesktopQuickData,
  mapDesktopTree,
  mapOrphanNoteRow,
  mapQuickNoteRow,
  mapTagLinkRow,
  mapTagRow,
  parsePortableBaseline,
  parsePortableContentHashes,
  type ParsedPortableBaseline,
} from "./portableMapping";

const H = (ch: string): string => ch.repeat(64);
const TS = "2026-11-09T00:00:00.000Z";

const baselineJson = () => ({
  epoch: "epoch-1",
  generation: 3,
  lakeCommit: H("c"),
  quickNotesCommit: H("d"),
  lake: {
    v: 3,
    space: "lake",
    notes: [
      { id: "n1", title: "文档1", parentId: "nb1", sortOrder: 0, updatedAt: TS, contentHash: H("a"), kind: "doc" },
    ],
    folders: [
      { id: "nb1", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: TS },
    ],
  },
  quickNotes: {
    v: 3,
    space: "quickNotes",
    items: [{ id: "q1", createdAt: TS, updatedAt: TS, contentHash: H("b") }],
  },
});

const baseline = (): ParsedPortableBaseline => parsePortableBaseline(baselineJson());

describe("便携包同步基线解析（core 索引校验单一来源）", () => {
  it("解析出 MobileV3Baseline 与 id→contentHash 映射", () => {
    const parsed = baseline();
    expect(parsed.baseline?.epoch).toBe("epoch-1");
    expect(parsed.lakeHashById.get("n1")).toBe(H("a"));
    expect(parsed.quickHashById.get("q1")).toBe(H("b"));
  });

  it("离线内容哈希：localOnly + notes/quickNotes 映射，baseline=null", () => {
    const parsed = parsePortableContentHashes({ localOnly: true, notes: { n1: H("a") }, quickNotes: { q1: H("b") } });
    expect(parsed.baseline).toBeNull();
    expect(parsed.lakeHashById.get("n1")).toBe(H("a"));
    expect(parsed.quickHashById.get("q1")).toBe(H("b"));
  });

  it("坏基线直接抛错（不进入导入事务）", () => {
    expect(() => parsePortableBaseline(null)).toThrow();
    expect(() => parsePortableBaseline({ ...baselineJson(), lake: { v: 9, space: "lake", notes: [], folders: [] } })).toThrow();
    expect(() => parsePortableBaseline({ ...baselineJson(), quickNotes: { v: 3, space: "lake", items: [] } })).toThrow();
  });
});

describe("tree_nodes + notes → folders/notes（含回收站与彻底删除）", () => {
  const treeRows = [
    { id: "nb1", parent_id: null, node_type: "notebook", title: "个人笔记", sort_order: 0, updated_at: TS },
    { id: "grp1", parent_id: "nb1", node_type: "group", title: "分组", sort_order: 1, updated_at: TS, icon: "📁" },
    { id: "tree-n1", parent_id: "nb1", node_type: "note", title: "文档1", note_file_id: "n1", sort_order: 2, updated_at: TS, trashed_at: null },
    { id: "tree-n2", parent_id: "nb1", node_type: "note", title: "回收站里的", note_file_id: "n2", sort_order: 3, updated_at: TS, trashed_at: "2026-11-08T00:00:00.000Z", deleted_from_parent_id: "nb1" },
    { id: "tree-n3", parent_id: "nb1", node_type: "note", title: "彻底删除", note_file_id: "n3", sort_order: 4, updated_at: TS, is_purged: 1 },
    { id: "grp-purged", parent_id: "nb1", node_type: "group", title: "彻底删除的分组", sort_order: 5, updated_at: TS, is_purged: 1 },
  ];
  const noteRows = [
    { id: "n1", title: "文档1", parent_id: "nb1", sort_order: 2, updated_at: TS, kind: "usheet", is_conflict: 0 },
    { id: "n2", title: "回收站里的", parent_id: "nb1", sort_order: 3, updated_at: TS, kind: "doc", deleted_at: "2026-11-08T00:00:00.000Z" },
    { id: "n3", title: "彻底删除", parent_id: "nb1", sort_order: 4, updated_at: TS, kind: "doc", is_purged: 1, deleted_at: TS },
    { id: "orphan", title: "没有树节点的回收站文档", parent_id: null, deleted_at: "2026-11-07T00:00:00.000Z", kind: "doc" },
  ];

  it("目录保留 notebook/group，is_dirty=0", () => {
    const mapped = mapDesktopTree(treeRows, noteRows, baseline());
    const ids = mapped.folders.map((f) => f.id);
    expect(ids).toContain("nb1");
    expect(ids).toContain("grp1");
    expect(ids).not.toContain("grp-purged");
    const nb = mapped.folders.find((f) => f.id === "nb1")!;
    expect(nb.node_type).toBe("notebook");
    expect(nb.is_dirty).toBe(0);
    expect(mapped.tombstones.some((t) => t.id === "grp-purged" && t.node_type === "folder")).toBe(true);
  });

  it("note 业务 id = note_file_id；kind→doc_kind；content_hash 取基线", () => {
    const mapped = mapDesktopTree(treeRows, noteRows, baseline());
    const n1 = mapped.notes.find((n) => n.id === "n1")!;
    expect(n1.doc_kind).toBe("usheet");
    expect(n1.content_hash).toBe(H("a"));
    expect(n1.is_dirty).toBe(0);
    expect(n1.parent_id).toBe("nb1");
  });

  it("回收站语义：trashed_at/deleted_from_parent_id 保留；彻底删除只留墓碑", () => {
    const mapped = mapDesktopTree(treeRows, noteRows, baseline());
    const n2 = mapped.notes.find((n) => n.id === "n2")!;
    expect(n2.trashed_at).toBe("2026-11-08T00:00:00.000Z");
    expect(n2.deleted_from_parent_id).toBe("nb1");
    expect(mapped.notes.some((n) => n.id === "n3")).toBe(false);
    const tomb = mapped.tombstones.find((t) => t.id === "n3")!;
    expect(tomb.node_type).toBe("note");
    expect(tomb.purged_at.length).toBeGreaterThan(0);
  });

  it("只有 notes 行的孤儿：未彻底删除的搬为回收站可见，彻底删除的写墓碑", () => {
    const mapped = mapDesktopTree([], [{ id: "x", title: "孤儿", updated_at: TS, is_purged: 0, deleted_at: TS }, { id: "y", title: "已删", updated_at: TS, is_purged: 1, deleted_at: TS }], baseline());
    expect(mapped.notes.map((n) => n.id)).toEqual(["x"]);
    expect(mapped.notes[0].trashed_at).toBe(TS);
    expect(mapped.tombstones.map((t) => t.id)).toEqual(["y"]);
  });

  it("mapOrphanNoteRow 拒绝空 id", () => {
    expect(mapOrphanNoteRow({}, baseline())).toBeNull();
  });
});

describe("quick-notes 库映射", () => {
  it("小记 content_hash 取基线；deleted_at 保留；is_dirty=0", () => {
    const mapped = mapDesktopQuickData({
      quickNotes: [{ id: "q1", created_at: TS, updated_at: TS, preview_text: "预览", image_count: 2, deleted_at: null }],
      quickNoteDeleted: [{ id: "q9", created_at: TS, updated_at: TS, deleted_at: TS, purged_at: TS }],
      tags: [
        { id: "t1", name: "标签1", sort_order: 1, created_at: TS, updated_at: TS },
        { id: "t2", name: "旧墓碑", sort_order: 2, created_at: TS, updated_at: TS, deleted_at: TS },
      ],
      tagLinks: [
        { target_kind: "note", target_id: "n1", tag_id: "t1", position: 0 },
        { target_kind: "quickNote", target_id: "q1", tag_id: "t1", position: 0 },
        { target_kind: "v2", target_id: "z", tag_id: "t1" },
        { target_kind: "note", target_id: "n1", tag_id: "t1", position: 0 },
      ],
      tagLinkVersions: [
        { target_kind: "note", target_id: "n1", links_updated_at: TS },
        { target_kind: "note", target_id: "n1", links_updated_at: TS },
      ],
      baseline: baseline(),
    });
    const q = mapped.quickNotes[0];
    expect(q.id).toBe("q1");
    expect(q.content_hash).toBe(H("b"));
    expect(q.is_dirty).toBe(0);
    expect(q.ready_to_sync).toBe(1);
    expect(mapped.quickNoteDeleted.map((r) => r.id)).toEqual(["q9"]);
    expect(mapped.tags.map((t) => t.id)).toEqual(["t1"]);
    // 去重：note|n1|t1 只留一条；非法 kind 计入 skipped
    expect(mapped.tagLinks).toHaveLength(2);
    expect(mapped.tagLinkVersions).toHaveLength(1);
    expect(mapped.skipped).toBeGreaterThanOrEqual(1);
  });

  it("mapQuickNoteRow 缺 id 返回 null；mapTagLinkRow 非法 kind 返回 null", () => {
    expect(mapQuickNoteRow({}, baseline())).toBeNull();
    expect(mapTagLinkRow({ target_kind: "bad", target_id: "a", tag_id: "b" })).toBeNull();
  });

  it("mapTagRow 只收 active 行", () => {
    expect(mapTagRow({ id: "t", name: "n", deleted_at: TS })).toBeNull();
    expect(mapTagRow({ id: "t", name: "n", created_at: TS })).toMatchObject({ id: "t", name: "n" });
  });
});
