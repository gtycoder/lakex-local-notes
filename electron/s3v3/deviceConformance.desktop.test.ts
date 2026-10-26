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
    listNoteIds: async () => store.listNoteSummaries().map((s) => s.id).sort(),
    readBody: async (id) => { const bytes = await device.readBody(id); return bytes ? new TextDecoder().decode(bytes) : null; },
    close: async () => { await fs.rm(root, { recursive: true, force: true }); },
  };
});
