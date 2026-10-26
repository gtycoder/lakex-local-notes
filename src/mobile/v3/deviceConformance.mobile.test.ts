import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineDeviceConformance } from "../../../electron/s3v3/deviceConformance.js";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, saveNote } from "../data/noteRepository.js";
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

defineDeviceConformance("设备适配器一致性（移动 store）", async (remote) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-conf-mobile-"));
  const backend = fsBackend(root);
  setBodyStoreBackendForTest(backend);
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const device = new MobileDeviceStore(db);
  await device.init();
  const engine = new S3v3SyncEngine({ remote, device, deviceId: "mobile-conf-" + Math.random().toString(36).slice(2, 8) });
  const use = async <T>(fn: () => Promise<T>): Promise<T> => { setBodyStoreBackendForTest(backend); return await fn(); };
  return {
    sync: (opts) => use(() => engine.sync(opts ?? {})),
    seedNote: (id, title, body) => use(() => createNote(db, id, title, body, null, new Map())),
    editNote: (id, title, body) => use(async () => { await saveNote(db, id, title, body, null, new Map()); }),
    listNoteIds: () => use(async () => { const rows = await db.prepare("SELECT id FROM notes ORDER BY id").all() as Array<{ id: string }>; return rows.map((r) => r.id); }),
    readBody: (id) => use(async () => { const bytes = await device.readBody(id); return bytes ? new TextDecoder().decode(bytes) : null; }),
    close: async () => { await db.close(); setBodyStoreBackendForTest(null); await fs.rm(root, { recursive: true, force: true }); },
  };
});
