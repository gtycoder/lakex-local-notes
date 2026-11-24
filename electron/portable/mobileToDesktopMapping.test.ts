import { describe, expect, it } from "vitest";
import { mapMobileToDesktop } from "./mobileToDesktopMapping.js";

const TS = "2026-11-22T02:00:00.000Z";

describe("mapMobileToDesktop（手机快照行 → 桌面两库行）", () => {
  it("folder → tree_nodes：notebook 保 diary space、group 恒 null；坏 node_type 跳过", () => {
    const out = mapMobileToDesktop({
      folders: [
        { id: "nb1", title: "日记本", parent_id: null, sort_order: 0, node_type: "notebook", space: "diary", icon: null, updated_at: TS },
        { id: "g1", title: "分组", parent_id: "nb1", sort_order: 1, node_type: "group", space: "diary", icon: "📁", updated_at: TS },
        { id: "bad", title: "坏", parent_id: null, sort_order: 0, node_type: "weird", updated_at: TS },
      ],
      notes: [], deletedNotes: [], quickNotes: [], quickNoteDeleted: [], tags: [], tagLinks: [], tagLinkVersions: [],
    });
    expect(out.treeNodes).toHaveLength(2);
    expect(out.treeNodes[0]).toMatchObject({ id: "nb1", workspace_id: "default", node_type: "notebook", space: "diary", note_file_id: null, created_at: TS });
    expect(out.treeNodes[1]).toMatchObject({ id: "g1", node_type: "group", space: null, icon: "📁", parent_id: "nb1" });
    expect(out.skipped).toBe(1);
  });

  it("note → tree_nodes(tree id == note id，261124 A9 不变量) + notes 两行；doc_kind 非法回退 doc；is_purged 只留墓碑", () => {
    const out = mapMobileToDesktop({
      folders: [],
      notes: [
        { id: "n1", title: "文档", parent_id: "nb1", sort_order: 3, updated_at: TS, doc_kind: "ink", is_locked: 1, locked_at: TS, trashed_at: TS, deleted_from_parent_id: "nb0" },
        { id: "n2", title: "坏 kind", parent_id: null, sort_order: 0, updated_at: TS, doc_kind: "alien" },
        { id: "n3", title: "已 purge", parent_id: null, sort_order: 0, updated_at: TS, doc_kind: "doc", is_purged: 1, deleted_at: TS },
      ],
      deletedNotes: [], quickNotes: [], quickNoteDeleted: [], tags: [], tagLinks: [], tagLinkVersions: [],
    });
    expect(out.treeNodes).toHaveLength(2);
    expect(out.treeNodes[0]).toMatchObject({ id: "n1", node_type: "note", note_file_id: "n1", title: "文档", trashed_at: TS, deleted_from_parent_id: "nb0" });
    expect(out.notes).toHaveLength(2);
    expect(out.notes[0]).toMatchObject({ id: "n1", kind: "ink", is_locked: 1, trashed_at: TS });
    expect(out.notes[1]).toMatchObject({ id: "n2", kind: "doc" });
    expect(out.tombstones).toEqual([
      { id: "n3", title: "已 purge", parent_id: null, sort_order: 0, updated_at: TS, deleted_at: TS, node_type: "note", purged_at: TS },
    ]);
  });

  it("A9：文档做父的子文档不断链（tree id == note id ⇒ 子级 parent/dfp 原地解析；261124 审计⑤P2-1）", () => {
    const out = mapMobileToDesktop({
      folders: [{ id: "nb1", title: "笔记本", parent_id: null, sort_order: 0, node_type: "notebook", space: null, icon: null, updated_at: TS }],
      notes: [
        { id: "p1", title: "父文档", parent_id: "nb1", sort_order: 0, updated_at: TS },
        { id: "c1", title: "子文档", parent_id: "p1", sort_order: 1, updated_at: TS },
        { id: "c2", title: "被删子文档", parent_id: "p1", sort_order: 2, updated_at: TS, trashed_at: TS, deleted_from_parent_id: "p1" },
      ],
      deletedNotes: [], quickNotes: [], quickNoteDeleted: [], tags: [], tagLinks: [], tagLinkVersions: [],
    });
    const p1 = out.treeNodes.find((t) => t.note_file_id === "p1")!;
    const c1 = out.treeNodes.find((t) => t.note_file_id === "c1")!;
    const c2 = out.treeNodes.find((t) => t.note_file_id === "c2")!;
    // 树 id == 笔记 id（与 store.createNote / remoteImportRepository 同不变量）
    expect(p1.id).toBe("p1");
    // 子文档 parent 指向父的树 id（不换 id ⇒ 原地解析，级联 CTE 不断链）
    expect(c1.parent_id).toBe("p1");
    expect(c2.deleted_from_parent_id).toBe("p1");
    // notes 行同口径（业务 id 空间与树 id 空间重合）
    expect(out.notes.find((n) => n.id === "c1")!.parent_id).toBe("p1");
    expect(out.notes.find((n) => n.id === "c2")!.deleted_from_parent_id).toBe("p1");
  });

  it("手机 deleted_notes 墓碑 1:1（folder 墓碑保 node_type）", () => {
    const out = mapMobileToDesktop({
      folders: [], notes: [],
      deletedNotes: [
        { id: "t1", title: "删了", parent_id: null, sort_order: 0, updated_at: TS, deleted_at: TS, node_type: "folder", purged_at: TS },
        { id: "t2", title: "缺 deleted_at", parent_id: null, sort_order: 0, updated_at: TS },
      ],
      quickNotes: [], quickNoteDeleted: [], tags: [], tagLinks: [], tagLinkVersions: [],
    });
    expect(out.tombstones).toEqual([
      { id: "t1", title: "删了", parent_id: null, sort_order: 0, updated_at: TS, deleted_at: TS, node_type: "folder", purged_at: TS },
    ]);
    expect(out.skipped).toBe(1);
  });

  it("小记：deleted_at 行只进 quick_note_deleted 账本（与账本行按 id 去重）；活跃行进 quick_notes", () => {
    const out = mapMobileToDesktop({
      folders: [], notes: [], deletedNotes: [],
      quickNotes: [
        { id: "q1", created_at: TS, updated_at: TS, preview_text: "hi", image_count: 1, content_hash: "h1" },
        { id: "q2", created_at: TS, updated_at: TS, preview_text: "gone", image_count: 0, content_hash: "h2", deleted_at: TS },
        { id: "q3", created_at: TS, updated_at: TS, preview_text: "gone2", image_count: 0, content_hash: "h3", deleted_at: TS },
      ],
      quickNoteDeleted: [
        { id: "q3", created_at: TS, updated_at: TS, deleted_at: TS, purged_at: TS },
      ],
      tags: [], tagLinks: [], tagLinkVersions: [],
    });
    expect(out.quickNotes).toEqual([
      { id: "q1", created_at: TS, updated_at: TS, preview_text: "hi", image_count: 1, content_hash: "h1", is_dirty: 0, is_conflict: 0, cloud_deleted: 0 },
    ]);
    expect(out.quickNoteDeleted).toHaveLength(2);
    const q2 = out.quickNoteDeleted.find((row) => row.id === "q2")!;
    expect(q2).toMatchObject({ id: "q2", deleted_at: TS, purged_at: null, ready_to_sync: 1 });
    // 账本行优先（带 purged_at），不被行内派生覆盖
    const q3 = out.quickNoteDeleted.find((row) => row.id === "q3")!;
    expect(q3).toMatchObject({ id: "q3", purged_at: TS });
  });

  it("标签域：1:1 + 关系/版本去重 + 坏 kind 跳过", () => {
    const out = mapMobileToDesktop({
      folders: [], notes: [], deletedNotes: [], quickNotes: [], quickNoteDeleted: [],
      tags: [
        { id: "t1", name: "标签", sort_order: 2, created_at: TS, updated_at: TS },
        { id: "", name: "无 id" },
      ],
      tagLinks: [
        { target_kind: "note", target_id: "n1", tag_id: "t1", position: 1 },
        { target_kind: "note", target_id: "n1", tag_id: "t1", position: 9 },
        { target_kind: "weird", target_id: "n2", tag_id: "t1", position: 0 },
      ],
      tagLinkVersions: [
        { target_kind: "quickNote", target_id: "q1", links_updated_at: TS },
        { target_kind: "quickNote", target_id: "q1", links_updated_at: TS },
      ],
    });
    expect(out.tags).toEqual([{ id: "t1", name: "标签", sort_order: 2, created_at: TS, updated_at: TS }]);
    expect(out.tagLinks).toEqual([{ target_kind: "note", target_id: "n1", tag_id: "t1", position: 1 }]);
    expect(out.tagLinkVersions).toEqual([{ target_kind: "quickNote", target_id: "q1", links_updated_at: TS }]);
    // skipped 只计「映射不出行」的坏数据（坏 tag 行 + 坏 kind 关系）；去重静默丢弃与正向同口径
    expect(out.skipped).toBe(2);
  });
});
