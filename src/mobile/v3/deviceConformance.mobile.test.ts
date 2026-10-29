import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, vi } from "vitest";

// 资产存储：conformance 里每台「设备」一份内存资产表（模拟 assetFs；真实设备走原生/Filesystem）。
const assetState = vi.hoisted(() => ({ current: new Map<string, Uint8Array>() }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetState.current.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetState.current.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetState.current.delete(key); },
  listNoteAssetKeysFs: async (noteId: string) => [...assetState.current.keys()].filter((k) => k.startsWith(noteId + "/")),
  listQuickNoteAssetKeysFs: async (id: string) => [...assetState.current.keys()].filter((k) => k.startsWith("quick-notes/" + id + "/")),
  listAssetKeysFs: async () => [...assetState.current.keys()],
  // 彻底删除清目录（MOB-06）：内存表按前缀整份删，语义与 assetFs.removeNoteAssetsDirFs 一致
  removeNoteAssetsDirFs: async (noteId: string) => {
    for (const key of [...assetState.current.keys()]) if (key.startsWith(noteId + "/")) assetState.current.delete(key);
  },
  removeQuickNoteAssetsDirFs: async (id: string) => {
    for (const key of [...assetState.current.keys()]) if (key.startsWith("quick-notes/" + id + "/")) assetState.current.delete(key);
  },
}));
import { defineDeviceContract, type ContractHarnessFactory } from "../../../electron/s3v3/deviceConformance.js";
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

const mobileFactory: ContractHarnessFactory = async (remote) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-conf-mobile-"));
  const backend = fsBackend(root);
  const assetStore = new Map<string, Uint8Array>();
  // 每个用例从干净全局开始（上一个用例的弱网/资产状态不得串味）。
  assetState.current = new Map();
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
    resetFromCloud: () => use(() => engine.resetFromCloud()),
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
    // 移动端没有「文档锁定」UI（src/core/repositoryCapabilities.ts：移动端不提供）⇒ 直接写 DB 列，
    // 模拟「平台若提供锁」时的本地状态；用于钉住 MobileDeviceStore 丢弃 locked_at 的当前行为。
    setEditLock: (id, locked) => use(async () => {
      await db.prepare("UPDATE notes SET is_locked=?, locked_at=? WHERE id=?").run(locked ? 1 : 0, locked ? new Date().toISOString() : null, id);
    }),
    // 故意读 DB 原始列（不是 device.loadState）：这样「DB 有 locked_at、同步状态里被丢成 null」的漂移可见。
    readEditLock: (id) => use(async () => {
      const row = await db.prepare("SELECT is_locked, locked_at FROM notes WHERE id=?").get(id) as { is_locked?: number; locked_at?: string | null } | undefined;
      return { locked: !!row?.is_locked, lockedAt: row?.locked_at ?? null };
    }),
    close: async () => {
      await db.close();
      setBodyStoreBackendForTest(null);
      // 显式清空共享的资产 mock 状态：避免上一个用例的资产（尤其 weak-net 残���）串到下一个用例。
      assetState.current = new Map();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
};
// E2-4 phase C-3c：本套规格已改为「单实现契约」（共享编排 + 端口语义），**只跑一次**（本文件）。
// 桌面薄壳（DesktopStoreDevice + desktopPlatformPort）由 deviceConformance.mixed（跨端混合）与
// electron/s3v3/desktopStoreAdapter.test.ts / electron/store.test.ts 覆盖。
// 剩余**端口级差异**（移动 locked_at 丢弃、移动 quick purge 保留副本、回收站 parent、trash 时间戳、
// 批写窗口、原生资产路径）登记在 docs/SYNC-DEVICE-CONTRACT.md §5；本契约不为此写条件分支。
// 每个用例前干净全局（移动端 mock 资产/正文后端是模块级共享状态，串味会让用例互相影响）。
beforeEach(() => {
  assetState.current = new Map();
  setBodyStoreBackendForTest(null);
});

defineDeviceContract("设备存储单实现契约（移动端口 harness）", mobileFactory);
