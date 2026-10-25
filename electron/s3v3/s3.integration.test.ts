import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it as test } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function device(name: string) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-it-" + name + "-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
async function addDoc(store: FileDeviceStore, id: string, body: string, assets: Record<string, string> = {}) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  for (const [fn, content] of Object.entries(assets)) await store.writeAsset(id, fn, new TextEncoder().encode(content));
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), { id, title: id, parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) }];
  await store.saveState(state);
}

describeIt("真实 S3 集成（七牛，新前缀）", () => {
  test("初始化/双端增量/附件/彻底删除零痕迹/深度清理", async () => {
    const settings = {
      endpoint: process.env.S3V3_ENDPOINT!,
      region: process.env.S3V3_REGION || "cn-north-1",
      bucket: process.env.S3V3_BUCKET!,
      accessKeyId: process.env.S3V3_AK!,
      secretAccessKey: process.env.S3V3_SK!,
      prefix: (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_it/" + randomUUID(),
      forcePathStyle: false,
    };
    const remote = new S3v3S3Remote(settings);
    const a = await device("a"); const b = await device("b");
    const t0 = Date.now();
    try {
      await addDoc(a.store, "n1", "hello-real-s3", { "a.png": "PNG-A" });
      await addDoc(a.store, "n2", "purge-me", { "x.bin": "X-BIN" });
      const r1 = await new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      expect(r1.published).toBe(true);
      expect((await remote.list("objects/")).length).toBe(2);
      expect((await remote.list("assets/n1/")).length).toBe(1);

      const r2 = await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
      expect(r2.downloadedNotes).toBe(2);
      expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("hello-real-s3");
      expect(new TextDecoder().decode((await b.store.readAsset("n1", "a.png"))!)).toBe("PNG-A");

      // A 改，B 拉
      await addDoc(a.store, "n1", "hello-real-s3-v2");
      await new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" }).sync();
      await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
      expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("hello-real-s3-v2");

      // A 彻底删除 n2
      const sa = (await a.store.loadState())!;
      const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { epoch: string; generation: number };
      sa.lake.notes = sa.lake.notes.filter((n) => n.id !== "n2");
      sa.intents = [{ noteId: "n2", targetEpoch: pointer.epoch, targetGeneration: pointer.generation, purgedAt: new Date().toISOString() }];
      await a.store.saveState(sa);
      await a.store.deleteBody("n2"); await a.store.deleteAssetsDir("n2");
      await new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" }).sync();

      expect(await remote.list("objects/n2-")).toHaveLength(0);
      expect(await remote.list("assets/n2/")).toHaveLength(0);
      expect(await remote.list("meta/assets/n2/")).toHaveLength(0);

      // B 同步后本地保留回收站副本（正文仍在本地）
      await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
      const sb = (await b.store.loadState())!;
      expect(sb.lake.notes.find((n) => n.id === "n2")?.trashedAt).toBeTruthy();
      expect(await b.store.readBody("n2")).not.toBeNull();

      // 深度清理（应无事可删，因为引擎定向删除已覆盖）
      const clean = await new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" }).deepCleanup();
      expect(clean.deleted.length).toBe(0);
      console.log("[it] elapsedMs=" + (Date.now() - t0), "objects=" + (await remote.list("")).length);
    } finally {
      await remote.deleteByPrefix("");
    }
  }, 180_000);
});
