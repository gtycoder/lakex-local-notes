import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import { defineDeviceConformance } from "./deviceConformance.js";

defineDeviceConformance("设备适配器一致性（桌面 store）", async (remote) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-conf-desktop-"));
  const store = new Store(root);
  store.bootstrap();
  // 只在真正要造数据时才建「NB」笔记本：否则第二台设备会凭空多一个本地专属目录，
  // 下一轮被判 upload 造成空发布（conformance 之外也是真实风险）。
  let nbId: string | null = null;
  const ensureNotebook = (): string => { if (!nbId) nbId = store.createNotebook("NB").id; return nbId; };
  const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
  await device.init();
  const engine = new S3v3SyncEngine({ remote, device, deviceId: "desktop-conf-" + Math.random().toString(36).slice(2, 8) });
  return {
    sync: (opts) => engine.sync(opts ?? {}),
    seedNote: async (id, title, body, parentId) => { store.createNoteInAtTopWithContent(parentId ?? ensureNotebook(), title, body, [], id); },
    seedFolder: async (id, title) => {
      // 用 importRemoteFolder 强制指定 id（createNotebook 会生成新 id，跨端 id 保真断言需要）。
      store.importRemoteFolder({ id, title, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: new Date().toISOString() });
    },
    listFolderIds: async () => store.listFoldersForSync().filter((f) => !f.trashedAt).map((f) => f.id).sort(),
    noteParentId: async (id) => store.listNotesSyncMeta().find((n) => n.id === id)?.parentId ?? null,
    deleteFolder: async (id) => { store.deleteTreeNode(id); },
    seedAsset: async (id, filename, bytes) => {
      const dir = path.join(root, "note-assets", id);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), bytes);
    },
    readAsset: async (id, filename) => { const bytes = await device.readAsset(id, filename); return bytes ?? null; },
    editNote: async (id, title, body) => { store.saveNote(id, title, body); },
    // 桌面 listNoteSummaries 含回收站条目（用 trashed_at/parent 过滤），活跃 = 摘要 - 回收站。
    listActiveIds: async () => {
      const trash = new Set(store.listTrash().map((t) => t.id));
      return store.listNoteSummaries().map((s) => s.id).filter((id) => !trash.has(id)).sort();
    },
    listTrashIds: async () => store.listTrash().map((t) => t.id).sort(),
    listCloudDeletedIds: async () => store.listCloudDeletedNoteIds().sort(),
    trashNote: async (id) => { store.deleteTreeNode(id); },
    restoreNote: async (id) => { store.restoreTrashItem(id); },
    purgeNote: async (id) => { store.deleteTreeNode(id); store.purgeTrashItem(id); },
    readBody: async (id) => { const bytes = await device.readBody(id); return bytes ? new TextDecoder().decode(bytes) : null; },
    close: async () => { await fs.rm(root, { recursive: true, force: true }); },
  };
});
