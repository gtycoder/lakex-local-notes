import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

// 资产存储：conformance 里每台「设备」一份内存资产表（模拟 assetFs；真实设备走原生/Filesystem）。
const assetState = vi.hoisted(() => ({ current: new Map<string, Uint8Array>() }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetState.current.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetState.current.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetState.current.delete(key); },
  listNoteAssetKeysFs: async (noteId: string) => [...assetState.current.keys()].filter((k) => k.startsWith(noteId + "/")),
  listQuickNoteAssetKeysFs: async (id: string) => [...assetState.current.keys()].filter((k) => k.startsWith("quick-notes/" + id + "/")),
  listAssetKeysFs: async () => [...assetState.current.keys()],
}));
import { defineDeviceConformance, type HarnessFactory } from "../../../electron/s3v3/deviceConformance.js";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, listTrashed, saveNote, trashNote } from "../data/noteRepository.js";
import { trashTreeItem } from "../data/trashRepository.js";
import { purgeTreeItem, restoreTreeItem } from "../data/trashRepository.js";
import { setBodyStoreBackendForTest, type BodyStoreBackend } from "../native/bodyStore.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { S3v3SyncEngine } from "../../core/s3v3Engine.js";

/** 每个「设备」一个独立文件后端（测试内存后端是模块级共享，多设备会串正文）。 */
function fsBackend(dir: string): BodyStoreBackend {
  const abs = (rel: string): string => path.join(dir, rel);
  const backend: BodyStoreBackend = {
    async readText(rel) { try { return await fs.readFile(abs(rel), "utf8"); } catch { return null; } },
    async writeText(rel, text) { await fs.mkdir(path.dirname(abs(rel)), { recursive: true }); await fs.writeFile(abs(rel), text, "utf8"); return Buffer.byteLength(text); },
    async writeTextMany(items) { let bytes = 0; for (const i of items) { await fs.mkdir(path.dirname(abs(i.path)), { recursive: true }); await fs.writeFile(abs(i.path), i.text, "utf8"); bytes += Buffer.byteLength(i.text); } return bytes; },
    async readTextMany(paths) { return Promise.all(paths.map((p) => backend.readText(p))); },
    async statTextMany(paths) { return Promise.all(paths.map((p) => backend.stat(p))); },
    async remove(rel) { await fs.rm(abs(rel), { force: true }); },
    async stat(rel) { try { const st = await fs.stat(abs(rel)); return { exists: true, size: st.size }; } catch { return { exists: false, size: 0 }; } },
    async readSnapshot(rel) { return backend.readText(rel); },
    async writeSnapshot(rel, text) { return backend.writeText(rel, text); },
  };
  return backend;
}

const mobileFactory: HarnessFactory = async (remote) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-conf-mobile-"));
  const backend = fsBackend(root);
  const assetStore = new Map<string, Uint8Array>();
  setBodyStoreBackendForTest(backend);
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const device = new MobileDeviceStore(db);
  await device.init();
  const engine = new S3v3SyncEngine({ remote, device, deviceId: "mobile-conf-" + Math.random().toString(36).slice(2, 8) });
  const use = async <T>(fn: () => Promise<T>): Promise<T> => {
    setBodyStoreBackendForTest(backend);
    assetState.current = assetStore;
    return await fn();
  };
  return {
    sync: (opts) => use(() => engine.sync(opts ?? {})),
    seedNote: (id, title, body, parentId) => use(() => createNote(db, id, title, body, parentId ?? null, new Map())),
    seedFolder: (id, title) => use(async () => {
      await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty) VALUES (?,?,NULL,0,'notebook',NULL,?,1)").run(id, title, new Date().toISOString());
    }),
    listFolderIds: () => use(async () => { const rows = await db.prepare("SELECT id FROM folders WHERE trashed_at IS NULL ORDER BY id").all() as Array<{ id: string }>; return rows.map((r) => r.id); }),
    noteParentId: (id) => use(async () => { const row = await db.prepare("SELECT parent_id FROM notes WHERE id=?").get(id) as { parent_id: string | null } | undefined; return row?.parent_id ?? null; }),
    deleteFolder: (id) => use(() => trashTreeItem(db, id, "folder")),
    seedAsset: (id, filename, bytes) => use(() => device.writeAsset(id, filename, bytes)),
    readAsset: (id, filename) => use(() => device.readAsset(id, filename)),
    editNote: (id, title, body) => use(async () => { await saveNote(db, id, title, body, null, new Map()); }),
    listActiveIds: () => use(async () => { const rows = await db.prepare("SELECT id FROM notes WHERE trashed_at IS NULL ORDER BY id").all() as Array<{ id: string }>; return rows.map((r) => r.id); }),
    listTrashIds: () => use(async () => (await listTrashed(db)).map((n) => n.id).sort()),
    listCloudDeletedIds: () => use(async () => { const rows = await db.prepare("SELECT id FROM notes WHERE cloud_deleted=1 ORDER BY id").all() as Array<{ id: string }>; return rows.map((r) => r.id); }),
    trashNote: (id) => use(() => trashNote(db, id)),
    restoreNote: (id) => use(() => restoreTreeItem(db, id, "note", () => Promise.resolve())),
    purgeNote: (id) => use(async () => { await trashNote(db, id); await purgeTreeItem(db, id, "note"); }),
    readBody: (id) => use(async () => { const bytes = await device.readBody(id); return bytes ? new TextDecoder().decode(bytes) : null; }),
    close: async () => { await db.close(); setBodyStoreBackendForTest(null); await fs.rm(root, { recursive: true, force: true }); },
  };
};
// 261027：移动端缺口已修（trashRepository.resolveRestoreParent 校验原父并回落兜底笔记本）⇒ 场景转正。
defineDeviceConformance("设备适配器一致性（移动 store）", mobileFactory);
