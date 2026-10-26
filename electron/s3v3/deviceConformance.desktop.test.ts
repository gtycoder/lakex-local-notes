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
  const nb = store.createNotebook("NB");
  const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
  await device.init();
  const engine = new S3v3SyncEngine({ remote, device, deviceId: "desktop-conf-" + Math.random().toString(36).slice(2, 8) });
  return {
    sync: (opts) => engine.sync(opts ?? {}),
    seedNote: async (id, title, body) => { store.createNoteInAtTopWithContent(nb.id, title, body, [], id); },
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
