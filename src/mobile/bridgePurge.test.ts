import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineTreeBehaviorContract, type TreeBehaviorAdapter } from "../core/treeBehaviorContract.js";
import { defineResourceBehaviorContract, type ResourceBehaviorAdapter } from "../core/resourceBehaviorContract.js";

vi.mock("./data/persistence", () => ({
  loadSnapshot: vi.fn(async () => null),
}));

vi.mock("./native/nativeSqliteDb.js", async () =>
  (await import("./native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

vi.mock("./native/nativeSqliteMigration", () => ({
  DEFAULT_MOBILE_DATABASE: "lake-notes-mobile",
  migrateSnapshotToNativeSqlite: vi.fn(async () => ({
    status: "no-snapshot",
    databaseName: "lake-notes-mobile",
  })),
}));

vi.mock("./native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

import { bridge } from "./bridge.js";

function createMobileAdapter(): TreeBehaviorAdapter {
  return {
    async createNotebook(title) {
      return (await bridge.createNotebook({ title, icon: null })).id;
    },
    async createGroup(parentId, title) {
      return (await bridge.createGroup(parentId, title)).id;
    },
    async createNote(parentId, title) {
      return (await bridge.createNote(title, parentId)).id;
    },
    async trashTree(rootId) {
      await bridge.trashTreeItem(rootId, "folder");
    },
    async restoreTree(rootId) {
      await bridge.restoreTreeItem(rootId, "folder");
    },
    async notebookTreeIds(notebookId) {
      return (await bridge.listNotebookTree(notebookId)).map((item) => item.id);
    },
    async isNoteTrashed(noteId) {
      return (await bridge.listTrashTree()).some((item) => item.id === noteId);
    },
    async noteParentId(noteId) {
      return (await bridge.noteGoneState(noteId))?.parentId ?? null;
    },
    async noteSyncState(noteId) {
      return (await bridge.noteGoneState(noteId))?.syncState ?? "";
    },
  };
}

defineTreeBehaviorContract("Mobile", createMobileAdapter);

function createMobileResourceAdapter(): ResourceBehaviorAdapter {
  return {
    upload: (input, noteId) => bridge.uploadResource(input, noteId),
  };
}

defineResourceBehaviorContract("Mobile", createMobileResourceAdapter);

/**
 * 移动端 purge 删除传播回归测试：
 * - purgeTreeItem 必须物理删除行（回收站不再残留）+ 写 deleted_notes 墓碑（purged_at + node_type）；
 * - 墓碑经 listDeletedNotesForSync 供 syncEngine 发布 deleted:true → 删除传播到其他端（桌面已修同款 bug）；
 * - folder 墓碑（purged_at）供 isFolderPurged 下载过滤（防远端文件夹重新导入复活）。
 */
describe("mobile purge 删除传播", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("purge note：物理删行（回收站消失）+ 写 note 墓碑，墓碑可被同步读取", async () => {
    const NID = "purge-note-1";
    await bridge.saveNote(NID, "待彻底删", "<p>内容</p>", null);
    await bridge.trashNote(NID);
    expect((await bridge.listTrashTree()).some((t) => t.id === NID)).toBe(true);

    await bridge.purgeTreeItem(NID, "note");

    // 行已物理删除：回收站不再残留（此前 sync_state='purged' 行保留 → 回收站仍显示 = 删不掉）
    expect((await bridge.listTrashTree()).some((t) => t.id === NID)).toBe(false);
    expect((await bridge.listNotes()).some((n) => n.id === NID)).toBe(false);

    // 墓碑写入 deleted_notes（node_type='note'），供 syncEngine 发布 deleted:true 传播删除
    const tombstones = await bridge.listDeletedNotesForSync();
    const tomb = tombstones.find((t) => t.id === NID);
    expect(tomb).toBeDefined();
    expect(tomb!.nodeType).toBe("note");
    expect(tomb!.deletedAt).toBeTruthy();
    // purge 后内容已删：墓碑发布走占位符路径（引擎不传空对象）
    expect(await bridge.readDeletedContent(NID)).toBeNull();
  });

  it("purge folder 子树：folders/notes 全删 + folder 墓碑（isFolderPurged 防复活）+ 子树 note 墓碑", async () => {
    const nb = await bridge.createNotebook({ title: "待彻底删笔记本", icon: null });
    const group = await bridge.createGroup(nb.id, "子分组");
    const NID = "purge-folder-note-1";
    await bridge.saveNote(NID, "子文档", "<p>内容</p>", group.id);

    await bridge.purgeTreeItem(nb.id, "folder");

    // 物理删除
    expect((await bridge.listNotebookTree(nb.id)).length).toBe(0);
    expect((await bridge.listNotes()).some((n) => n.id === NID)).toBe(false);

    // folder 墓碑：isFolderPurged 生效（下载远端 folders 时过滤，防复活）
    expect(await bridge.isFolderPurged(nb.id)).toBe(true);
    // 子树 note 墓碑：发布 deleted:true 传播
    const tombstones = await bridge.listDeletedNotesForSync();
    expect(tombstones.find((t) => t.id === nb.id)?.nodeType).toBe("folder");
    expect(tombstones.find((t) => t.id === NID)?.nodeType).toBe("note");
  });

  it("markTombstonesPublished 幂等：purge 墓碑发布标记不改变 deletedAt", async () => {
    const NID = "purge-note-2";
    await bridge.saveNote(NID, "待删", "<p>内容</p>", null);
    await bridge.trashNote(NID);
    await bridge.purgeTreeItem(NID, "note");
    const tombBefore = (await bridge.listDeletedNotesForSync()).find((t) => t.id === NID);
    await bridge.markTombstonesPublished([NID]);
    const tombAfter = (await bridge.listDeletedNotesForSync()).find((t) => t.id === NID);
    expect(tombAfter!.deletedAt).toBe(tombBefore!.deletedAt);
  });

  it("trashTreeItem(folder)：整棵子树（深层 folders + 子树 notes）进回收站，同步列表带 trashedAt", async () => {
    const nbRow = await bridge.createNotebook({ title: "待删库", icon: null });
    const grp = await bridge.createGroup(nbRow.id, "内层分组");
    const nid = "trash-note-sub-" + Date.now();
    await bridge.saveNote(nid, "子笔记", "<p>内容</p>", grp.id);
    // 删整棵 notebook
    await bridge.trashTreeItem(nbRow.id, "folder");
    const trash = await bridge.listTrashTree();
    expect(trash.some((t) => t.id === nbRow.id && t.kind === "folder")).toBe(true);
    // 子树 folders 级联进回收站
    expect(trash.some((t) => t.id === grp.id && t.kind === "folder")).toBe(true);
    // 子树 notes 级联进回收站
    expect(trash.some((t) => t.id === nid && t.kind === "note")).toBe(true);
    // 已移出可见树（trashed_at 标记生效）
    const visible = await bridge.listTreeNodes();
    expect(visible.some((n) => n.id === nbRow.id)).toBe(false);
    // 回收站条目带删除时间（deletedAt = trashed_at，同步传播载体）
    const trashNb = trash.find((t) => t.id === nbRow.id);
    expect(trashNb?.deletedAt).toBeTruthy();
  });

  it("restoreNote：updated_at 必须 bump 到恢复时刻（恢复传播 LWW 依赖；否则他端判定相等不跟随，恢复被墓碑压回）", async () => {
    // 假时钟拉开 save/trash 与 restore 的间隔（否则同毫秒内三操作时间戳相等，无法区分 bump 与否）
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00.000Z") });
    try {
      const NID = "restore-bump-note-1";
      const nbRow = await bridge.createNotebook({ title: "恢复传播测试本", icon: null });
      await bridge.saveNote(NID, "恢复传播", "<p>内容</p>", nbRow.id);
      await bridge.trashNote(NID);
      const trashAt = (await bridge.listTrashTree()).find((t) => t.id === NID)!.deletedAt!;
      expect(trashAt).toBeTruthy();

      vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
      await bridge.restoreNote(NID);

      // 恢复后回到可见列表，且 updated_at bump 到恢复时刻（严格晚于删除时刻）
      const restored = (await bridge.listNotes()).find((n) => n.id === NID);
      expect(restored).toBeDefined();
      expect(restored!.updatedAt > trashAt).toBe(true);
      expect(restored!.updatedAt).toBe("2026-01-01T00:00:05.000Z");
      // parent_id 回原位（远端学来的删除 parent=TRASH 容器 → 恢复必须移回，否则他端"跟随恢复"卡在回收站）
      expect(restored!.parentId).toBe(nbRow.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("trashTreeItem(note)：单条进回收站，不连累其它笔记", async () => {
    const A = "trash-note-a";
    const B = "trash-note-b";
    await bridge.saveNote(A, "A", "<p>a</p>", "notebook-personal");
    await bridge.saveNote(B, "B", "<p>b</p>", "notebook-personal");
    await bridge.trashTreeItem(A, "note");
    const trash = await bridge.listTrashTree();
    expect(trash.some((t) => t.id === A && t.kind === "note")).toBe(true);
    expect(trash.some((t) => t.id === B)).toBe(false);
  });

  it("purge folder 为嵌套文档写墓碑并物理删除", async () => {
    const nb = await bridge.createNotebook({ title: "嵌套子树删除", icon: null });
    const group = await bridge.createGroup(nb.id, "嵌套分组");
    await bridge.saveNote("purge-nested-parent", "父文档", "<p>p</p>", group.id);
    await bridge.saveNote("purge-nested-child", "子文档", "<p>c</p>", "purge-nested-parent");
    await bridge.trashTreeItem(nb.id, "folder");

    await bridge.purgeTreeItem(nb.id, "folder");

    const notes = await bridge.listNotes();
    expect(notes.some((note) => note.id === "purge-nested-parent")).toBe(false);
    expect(notes.some((note) => note.id === "purge-nested-child")).toBe(false);

    const tombstones = await bridge.listDeletedNotesForSync();
    expect(tombstones.find((item) => item.id === "purge-nested-parent")?.nodeType).toBe("note");
    expect(tombstones.find((item) => item.id === "purge-nested-child")?.nodeType).toBe("note");
  });

  it("审计 F06：purge 后晚到保存不复活文档（墓碑守卫），也不做 upsert 自愈", async () => {
    const NID = "purge-resurrect-guard";
    await bridge.saveNote(NID, "已彻底删", "<p>v1</p>", null);
    await bridge.trashNote(NID);
    await bridge.purgeTreeItem(NID, "note");
    expect((await bridge.listNotes()).some((n) => n.id === NID)).toBe(false);

    await expect(bridge.saveNote(NID, "晚到保存", "<p>v2</p>", null)).rejects.toThrow();
    // 未被复活：行仍是物理删除，墓碑仍在（删除继续传播）
    expect((await bridge.listNotes()).some((n) => n.id === NID)).toBe(false);
    expect((await bridge.listDeletedNotesForSync()).some((t) => t.id === NID)).toBe(true);
  });
});
