import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it as test } from "vitest";
import { Store } from "../store.js";
import { ObjectStore } from "../s3Store.js";
import { createS3StoreAdapter, createStoreSyncPort } from "../syncAdapters.js";
import { syncNow as oldSyncNow } from "../../src/core/syncEngine.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";

const enabled = process.env.S3V3_AB === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;
const DOCS = Number(process.env.S3V3_AB_DOCS || 100);

async function makeStore(docs: number): Promise<{ root: string; store: Store }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-ab-"));
  const store = new Store(root);
  store.bootstrap();
  const nb = store.createNotebook("AB");
  for (let i = 0; i < docs; i++) {
    const id = "ab" + String(i).padStart(4, "0");
    store.createNoteInAtTopWithContent(nb.id, "Doc " + i, "body-" + id + "-" + "x".repeat(900), [], id);
  }
  return { root, store };
}

function settings(basePrefix: string, suffix: string) {
  return { endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix: basePrefix + "/_ab/" + suffix + "-" + randomUUID(), forcePathStyle: false };
}

describeIt("master 旧同步 vs v3（真实 S3，A/B 指标）", () => {
  test("初始/空跑/增量/删除 的耗时与对象数", async () => {
    const basePrefix = process.env.S3V3_PREFIX || "lake-notes-v3-dev1";
    const oldStore = await makeStore(DOCS);
    const v3Store = await makeStore(DOCS);
    const oldSettings = settings(basePrefix, "old");
    const v3Settings = settings(basePrefix, "v3");
    const oldRemote = new ObjectStore(oldSettings as never, oldStore.store.logScopes);
    const cfg = { endpoint: oldSettings.endpoint, region: oldSettings.region, bucket: oldSettings.bucket, accessKeyId: oldSettings.accessKeyId, secretAccessKey: oldSettings.secretAccessKey, prefix: oldSettings.prefix };
    const s3 = createS3StoreAdapter(oldRemote, oldSettings.prefix);
    const port = createStoreSyncPort(oldStore.store);
    const v3Remote = new S3v3S3Remote(v3Settings as never);
    const v3Device = new DesktopStoreDevice(v3Store.store, v3Store.root, { skipQuickNotesGuard: true });
    await v3Device.init();
    const v3Engine = new S3v3SyncEngine({ remote: v3Remote, device: v3Device, deviceId: "ab-v3" });
    const stats = async (remote: S3v3S3Remote) => { const items = await remote.list(""); return { objects: items.length, bytes: items.reduce((s, x) => s + x.size, 0) }; };
    try {
      let t = Date.now();
      const oldR1 = await oldSyncNow(cfg as never, s3, port);
      const oldInit = Date.now() - t;
      t = Date.now();
      const v3R1 = await v3Engine.sync({ onEmptyCloud: "upload" });
      const v3Init = Date.now() - t;
      const oldStats = await (async () => { const remote = new S3v3S3Remote(oldSettings as never); const s = await stats(remote); await remote.deleteByPrefix(""); return s; })();
      const v3Stats = await stats(v3Remote);
      t = Date.now(); await oldSyncNow(cfg as never, s3, port); const oldNoop = Date.now() - t;
      t = Date.now(); await v3Engine.sync(); const v3Noop = Date.now() - t;
      // 增量：各改 5 篇
      for (let i = 0; i < 5; i++) {
        oldStore.store.saveNote("ab" + String(i).padStart(4, "0"), "Doc " + i, "edited-old-" + i + "-" + "y".repeat(900));
        v3Store.store.saveNote("ab" + String(i).padStart(4, "0"), "Doc " + i, "edited-v3-" + i + "-" + "y".repeat(900));
      }
      t = Date.now(); await oldSyncNow(cfg as never, s3, port); const oldInc = Date.now() - t;
      t = Date.now(); await v3Engine.sync(); const v3Inc = Date.now() - t;
      const out = {
        docs: DOCS, old: { init: oldInit, noop: oldNoop, inc: oldInc, uploaded: oldR1.uploaded, objects: oldStats.objects, bytes: oldStats.bytes },
        v3: { init: v3Init, noop: v3Noop, inc: v3Inc, uploaded: v3R1.uploadedNotes, objects: v3Stats.objects, bytes: v3Stats.bytes },
      };
      console.log(JSON.stringify(out));
      expect(oldR1.uploaded).toBeGreaterThan(0);
      expect(v3R1.uploadedNotes).toBeGreaterThan(0);
      // 清理
      await new S3v3S3Remote(oldSettings as never).deleteByPrefix("");
      await v3Remote.deleteByPrefix("");
    } finally {
      await new S3v3S3Remote(oldSettings as never).deleteByPrefix("").catch(() => {});
      await v3Remote.deleteByPrefix("").catch(() => {});
    }
  }, 600_000);
});
