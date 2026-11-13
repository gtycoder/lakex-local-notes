import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store 模块加载即需要 electron（safeStorage 解密 S3 密钥、net）；与既有 electron/*.test.ts 同款桩。
const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import Database from "better-sqlite3";
import { Store } from "./store.js";
import { QuickNotesStore } from "./quickNotes.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";
import { convertDiaryNoteToQuickNote } from "./diaryQuickNoteConversion.js";
import { runDesktopDuplicateNotes } from "./ipc/registerDuplicateNotes.js";
import type { SyncFolder, TreeNode } from "./noteQueries.js";

/**
 * 日记本固定不可变（261112 用户裁决，AGENTS §3#25）+ 两个单篇出口回归。
 *
 * 覆盖：
 *  - 删除/彻底删除/清空回收站：日记本一律拒绝（历史脏数据塞进回收站也不得 purge）；
 *  - title/icon/sort_order 经通用 IPC（rename / setNodeIcon / reorder / move）一律拒绝；
 *  - 移动：日记本不能移走、不能作为目标；年/月组不能移；**单篇日记可以移出**（转为文档）；
 *  - 落库侧 space 单调：远端把 diary 发成 null 时 apply/import 都不降级；
 *  - 出口①「转为文档」/ 出口②「转为小记 + 原文软删（可恢复、无墓碑）」。
 */
let root: string;
let store: Store;
let quickNotes: QuickNotesStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-diary-immutable-"));
  store = new Store(root);
  store.bootstrap();
  quickNotes = new QuickNotesStore(root);
});
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  fs.rmSync(root, { recursive: true, force: true });
});

const dbPath = () => path.join(root, "metadata.sqlite3");

function diaryHierarchy() {
  const nodes = store.listTreeNodes();
  const notebook = nodes.find((n) => n.space === "diary");
  expect(notebook, "应有 space=diary 的笔记本").toBeTruthy();
  const year = nodes.find((n) => n.parentId === notebook!.id && n.title === "2026");
  const month = nodes.find((n) => n.parentId === year?.id && n.title === "11");
  return { nodes, notebook: notebook!, year: year!, month: month! };
}

function openDiaryEntry(dateKey = "2026-11-09") {
  const opened = store.openDiaryDate(dateKey);
  return { opened, ...diaryHierarchy() };
}

/** 树行 → 同步端口的 SyncFolder（apply/import 落库路径的输入形状）。 */
const syncFolderOf = (node: TreeNode, over: Partial<SyncFolder> = {}): SyncFolder => ({
  id: node.id,
  title: node.title,
  parentId: node.parentId,
  sortOrder: node.sortOrder,
  nodeType: node.nodeType === "group" ? "group" : "notebook",
  icon: node.icon ?? null,
  updatedAt: node.updatedAt,
  space: (node.space ?? null) as SyncFolder["space"],
  ...over,
});

const spaceOf = (id: string): string | null => {
  const db = new Database(dbPath(), { readonly: true });
  try { return (db.prepare("SELECT space FROM tree_nodes WHERE id=?").get(id) as { space: string | null } | undefined)?.space ?? null; }
  finally { db.close(); }
};

const later = (ms = 10_000) => new Date(Date.now() + ms).toISOString();

describe("日记本固定不可变：删除守卫", () => {
  it("软删日记本被拒（明确文案），行仍在", () => {
    const { notebook } = openDiaryEntry();
    expect(() => store.deleteTreeNode(notebook.id)).toThrow(/日记本.*不能删除/);
    expect(store.listTreeNodes().some((n) => n.id === notebook.id && n.space === "diary")).toBe(true);
  });

  it("历史脏数据让日记本进了回收站：彻底删除被拒，清空回收站跳过而不是整清空失败", () => {
    const { notebook } = openDiaryEntry();
    // 模拟旧包（曾支持整本取消）留下的脏数据：日记本行被塞进回收站容器。
    const db = new Database(dbPath());
    try {
      db.prepare("UPDATE tree_nodes SET parent_id=?, trashed_at=?, deleted_from_parent_id=NULL WHERE id=?")
        .run(TRASH_NOTEBOOK_ID, new Date(Date.now() - 61 * 24 * 3600 * 1000).toISOString(), notebook.id);
    } finally { db.close(); }
    expect(() => store.purgeTrashItem(notebook.id)).toThrow(/日记本.*不能彻底删除/);
    expect(store.listTrash().some((item) => item.id === notebook.id)).toBe(true);
    // 清空回收站：日记本被跳过（其它条目照常），不抛错；计数区分「删除 / 跳过」。
    const cleared = store.emptyTrash();
    expect(cleared).toEqual({ purged: 0, skipped: 1 });
    expect(store.listTrash().some((item) => item.id === notebook.id)).toBe(true);
    const expiry = store.autoPurgeExpiredTrash(1);
    expect(expiry.skipped).toBe(1); // 日记本被跳过（不并入 purged）
    expect(expiry.purged).toBe(0);
    expect(store.listTrash().some((item) => item.id === notebook.id)).toBe(true);
  });
});

describe("日记本固定不可变：通用 IPC 的 title/icon/sort_order 一律拒绝", () => {
  it("日记本与年/月组都不能改名、换图标", () => {
    const { notebook, year, month } = openDiaryEntry();
    for (const id of [notebook.id, year.id, month.id]) {
      expect(() => store.renameTreeNode(id, "改名"), "不能改名: " + id).toThrow(/日记本.*不能改名/);
      expect(() => store.setNodeIcon(id, "X"), "不能换图标: " + id).toThrow(/日记本.*不能换图标/);
    }
    const after = store.listTreeNodes();
    expect(after.find((n) => n.id === notebook.id)!.title).toBe(notebook.title);
    expect(after.find((n) => n.id === year.id)!.title).toBe(year.title);
    expect(spaceOf(notebook.id)).toBe("diary");
  });

  it("排序：日记子树内部排序、根层把日记本排进去都被拒", () => {
    const { notebook, year, month } = openDiaryEntry();
    expect(() => store.reorderTreeNodes(notebook.id, [month.id, year.id])).toThrow(/日记本.*排序/);
    expect(() => store.reorderTreeNodes(year.id, [month.id])).toThrow(/日记本.*排序/);
    // 根层排序：orderedIds 含日记本 ⇒ 拒绝（不能改它的 sort_order）
    expect(() => store.reorderTreeNodes(null, [notebook.id])).toThrow(/日记本.*排序/);
  });

  it("移动：日记本不能移走、不能作为移动目标；年/月组不能移", () => {
    const { notebook, year, opened } = openDiaryEntry();
    const other = store.createNotebook("工作");
    expect(() => store.moveTreeNode(notebook.id, other.id, 0)).toThrow(/日记本.*不能移动/);
    expect(() => store.moveTreeNode(year.id, other.id, 0)).toThrow(/日记.*分组.*不能移动/);
    expect(() => store.moveTreeNode(other.id, notebook.id, 0)).toThrow(/日记本不能作为移动目标/);
    // 批量/有序移动同一条守卫（直接调用防回归）：普通文档移入日记空间也拒绝
    const plain = store.createNoteIn(other.id, "普通文档");
    expect(() => store.moveTreeNodeOrdered(plain.id, notebook.id, [plain.id])).toThrow(/日记本不能作为移动目标/);
    // 日记条目在日记内部换组 = 改位置/排序，同样拒绝（不能只靠「它还是 note」放行）
    expect(() => store.moveTreeNode(opened.noteId, year.id, 0)).toThrow(/日记内容顺序是派生的/);
  });
});

describe("落库侧 space 单调（只升不降）", () => {
  it("applyRemoteFolderMeta：远端把 diary 发成 null 也绝不降级", () => {
    const { notebook } = openDiaryEntry();
    store.applyRemoteFolderMeta(syncFolderOf(notebook, { space: null, updatedAt: later() }));
    expect(spaceOf(notebook.id)).toBe("diary");
  });

  it("applyRemoteFolderMeta：日记本的位置字段固定——远端 parent/trashedAt 不得移动或回收它（261112 F-02）", () => {
    const { notebook } = openDiaryEntry();
    store.applyRemoteFolderMeta(syncFolderOf(notebook, { parentId: "remote-nb", trashedAt: "T9", deletedFromParentId: "remote-nb", updatedAt: later() }));
    const after = store.listFoldersForSync().find((row) => row.id === notebook.id)!;
    expect(after.parentId).toBeNull();
    expect(after.trashedAt ?? null).toBeNull();
  });

  it("importRemoteFolder（同步下载/从云端恢复共用）：远端 null + 更新时间更晚也不降级", () => {
    const { notebook } = openDiaryEntry();
    store.importRemoteFolder(syncFolderOf(notebook, { space: null, updatedAt: later() }));
    expect(spaceOf(notebook.id)).toBe("diary");
  });

  it("正常升级 null → diary 仍然允许（只禁降级）", () => {
    const plain = store.createNotebook("普通本");
    store.applyRemoteFolderMeta(syncFolderOf(plain, { space: "diary", updatedAt: later() }));
    expect(spaceOf(plain.id)).toBe("diary");
  });
});

describe("两个单篇出口（回归，别误伤）", () => {
  it("出口①转为文档：日记条目移动到其他笔记本（同一 note，不删；正文/回收站/索引跟随）", () => {
    const { opened, month } = openDiaryEntry();
    const target = store.createNotebook("工作");
    const targetChildren = store.listTreeNodes().filter((n) => n.parentId === target.id).map((n) => n.id);
    const moved = store.moveTreeNodeOrdered(opened.noteId, target.id, [...targetChildren, opened.noteId]);

    expect(moved.parentId).toBe(target.id);
    // 未删除、未进回收站
    expect(store.listTrash().some((item) => item.id === opened.noteId)).toBe(false);
    expect(store.readNote(opened.noteId).content).toContain("ne-p");
    const db = new Database(dbPath(), { readonly: true });
    try {
      const note = db.prepare("SELECT parent_id,trashed_at FROM notes WHERE id=?").get(opened.noteId) as { parent_id: string; trashed_at: string | null };
      expect(note.parent_id).toBe(target.id);
      expect(note.trashed_at).toBeNull();
      // 不写墓碑
      expect((db.prepare("SELECT COUNT(*) AS c FROM deleted_notes WHERE id=?").get(opened.noteId) as { c: number }).c).toBe(0);
      // 历史表跟随（没有删除该 id 的历史行）
      expect((db.prepare("SELECT COUNT(*) AS c FROM note_history WHERE note_id=?").get(opened.noteId) as { c: number }).c).toBe(0);
    } finally { db.close(); }
    // 日记本本身不受影响
    expect(store.listTreeNodes().some((n) => n.id === month.id)).toBe(true);
  });

  it("出口②转为小记：日期标题进小记第一行，原文软删进回收站（可恢复、不写墓碑、不 purge）", () => {
    const { opened, month, notebook } = openDiaryEntry();
    // 出口② = 主进程转换（正文原样 + 原文软删；task-92 起不再在渲染层手拼小记）
    const converted = convertDiaryNoteToQuickNote(quickNotes, store, opened.noteId);
    const quick = quickNotes.readQuickNote(converted.quickNoteId);
    expect(quick.previewText.startsWith("2026-11-09")).toBe(true);
    expect(store.listTrash().some((item) => item.id === opened.noteId)).toBe(true);
    const db = new Database(dbPath(), { readonly: true });
    try {
      const row = db.prepare("SELECT trashed_at FROM tree_nodes WHERE id=?").get(opened.noteId) as { trashed_at: string | null };
      expect(row.trashed_at).toBeTruthy();
      // 软删不写墓碑
      expect((db.prepare("SELECT COUNT(*) AS c FROM deleted_notes WHERE id=?").get(opened.noteId) as { c: number }).c).toBe(0);
    } finally { db.close(); }

    // 可恢复：恢复后回到日记空间（年/月组原样），日记本仍是 diary
    store.restoreTrashItem(opened.noteId);
    const restored = store.listTreeNodes().find((n) => n.id === opened.noteId)!;
    expect(restored.parentId).toBe(month.id);
    expect(spaceOf(notebook.id)).toBe("diary");
    expect(store.readNote(opened.noteId).content).toContain("ne-p");
  });
});

describe("日记空间入口守卫（task-104 F-05：create / duplicate / import）", () => {
  it("create 系列（新建文档/表格/多维表/画板/手写板/分组）以日记子树为目标一律拒绝", () => {
    const { notebook, month, opened } = openDiaryEntry();
    for (const target of [notebook.id, month.id]) {
      expect(() => store.createNoteIn(target, "x"), "create_note_in " + target).toThrow(/日记本空间不能新建文档/);
      expect(() => store.createUsheetIn(target, "x")).toThrow(/日记本空间不能新建表格/);
      expect(() => store.createBitableIn(target, "x")).toThrow(/日记本空间不能新建多维表/);
      expect(() => store.createBoardIn(target, "x")).toThrow(/日记本空间不能新建画板/);
      expect(() => store.createInkIn(target, "x")).toThrow(/日记本空间不能新建手写板/);
      expect(() => store.createGroup(target, "g")).toThrow(/日记本空间不能新建分组/);
    }
    // 日记条目本身也不能再被当成「父级」建新内容（它不是容器，且换父=改日记结构）。
    expect(() => store.createNoteIn(opened.noteId, "x")).toThrow(/日记本空间不能新建文档/);
  });

  it("create_note 的兜底笔记本不会选到日记本（无父新建不落进日记空间）", () => {
    const { notebook } = openDiaryEntry();
    const doc = store.createNote("无父新建");
    const node = store.listTreeNodes().find((item) => item.noteFileId === doc.id)!;
    expect(node.parentId).not.toBe(notebook.id);
    expect(store.diaryNotebookOfTreeNode(node.parentId)).toBeNull();
  });

  it("duplicate_notes：日记条目不可创建副本（入口层拒绝，reason=unsupported）", async () => {
    const { opened } = openDiaryEntry();
    const result = await runDesktopDuplicateNotes({ ids: [opened.noteId] }, { store });
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ id: opened.noteId, ok: false, reason: "unsupported" });
  });

  it("import 共用入口：导入按 createGroup/createNoteIn 落库 ⇒ 日记目标同样被拒", () => {
    const { notebook } = openDiaryEntry();
    // Markdown/文件导入的 host 就是 native.createGroup + native.createNoteIn（见 markdownImportDesktop）；
    // 两者都在 Store 入口守卫内，因此「导入到日记本」必然被拒（不产生半批行）。
    expect(() => store.createGroup(notebook.id, "2026")).toThrow(/日记本空间不能新建分组/);
    expect(() => store.createNoteIn(notebook.id, "导入文档")).toThrow(/日记本空间不能新建文档/);
  });
});
