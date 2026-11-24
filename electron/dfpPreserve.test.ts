/**
 * 261124 A4 查漏回归（桌面侧）：wire 未带 dfp 的 trashed 条目不得把行上的原父冲掉。
 * 链路（审计②P1-2）：移动 deleteNote 曾不写 dfp ⇒ wire dfp=null ⇒ 桌面 applyRemoteNoteMeta/
 * importRemoteNote 旧实现无条件覆盖 null ⇒ 桌面行原父被清 ⇒ 恢复换家「未分类」/purge 漏删子树。
 * 移动侧往返已由 mobilePlatformPort.test 钉住；本文件钉桌面落库侧的 COALESCE/CASE 保留语义。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { Store } from "./store.js";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) { try { await fs.rm(d, { recursive: true, force: true }); } catch { /* 尽力 */ } } });

type RawDb = InstanceType<typeof Database>;
function withRawDb<T>(root: string, fn: (db: RawDb) => T): T {
  const db = new Database(path.join(root, "metadata.sqlite3"));
  try { return fn(db); } finally { db.close(); }
}

describe("A4 桌面侧：trashed 条目 dfp 保留（wire 未带 ⇒ 不覆盖）", () => {
  const metaFor = (over: Record<string, unknown>) => ({
    id: "doc", title: "文档", parentId: "notebook-trash", sortOrder: 0, updatedAt: "2026-11-24T00:00:00.000Z",
    contentHash: "0".repeat(64), isConflict: false, isEditLocked: false, editLockedAt: null, icon: undefined,
    trashedAt: "2026-11-23T00:00:00.000Z", deletedFromParentId: null, ...over,
  }) as never;

  it("applyRemoteNoteMeta：wire dfp=null 保留行上原父（旧实现覆盖 null ⇒ 恢复换家）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dfp-desktop-"));
    dirs.push(root);
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    const doc = store.createNoteIn(nb.id, "文档");
    store.deleteTreeNode(doc.id); // 软删：parent=回收站容器、dfp=nb
    store.applyRemoteNoteMeta(metaFor({ id: doc.id, parentId: "notebook-trash", trashedAt: "2026-11-23T00:00:00.000Z", deletedFromParentId: null }));
    const row = withRawDb(root, (db) => db.prepare("SELECT deleted_from_parent_id, trashed_at FROM tree_nodes WHERE id=?").get(doc.id) as { deleted_from_parent_id: string | null; trashed_at: string | null });
    expect(row.trashed_at).toBeTruthy(); // 生命周期保住
    expect(row.deleted_from_parent_id, "wire 未带 dfp 不得清掉行上原父").toBe(nb.id);
  });

  it("importRemoteNote：同口径（ON CONFLICT 对 trashed 且 dfp 缺失保值；恢复传播仍显式清）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dfp-import-"));
    dirs.push(root);
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    const doc = store.createNoteIn(nb.id, "文档");
    store.deleteTreeNode(doc.id);
    store.importRemoteNote(metaFor({ id: doc.id, parentId: "notebook-trash", trashedAt: "2026-11-23T00:00:00.000Z", deletedFromParentId: null }), Buffer.from("<p>body</p>"), []);
    const row = withRawDb(root, (db) => db.prepare("SELECT deleted_from_parent_id FROM tree_nodes WHERE id=?").get(doc.id) as { deleted_from_parent_id: string | null });
    expect(row.deleted_from_parent_id).toBe(nb.id);
  });
});
