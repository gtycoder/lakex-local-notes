import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it as test } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";

const enabled = process.env.S3V3_SCALE === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;
const DOCS = Number(process.env.S3V3_SCALE_DOCS || 200);
const ASSETS = Number(process.env.S3V3_SCALE_ASSETS || 10);
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function device(name: string) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-scale-" + name + "-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }

describeIt("真实 S3 大规模（可配置，默认 200 文档 × 10 附件）", () => {
  test("初始化上传 + 对端全量拉取 + 增量 + 彻底删除", async () => {
    const settings = {
      endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!,
      accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!,
      prefix: (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_scale/" + randomUUID(), forcePathStyle: false,
    };
    const remote = new S3v3S3Remote(settings);
    const a = await device("a"); const b = await device("b");
    const t0 = Date.now();
    let bytes = 0;
    try {
      // 本地造数：DOCS 篇，每篇 ASSETS 个附件
      const state = emptyState();
      for (let i = 0; i < DOCS; i++) {
        const id = "n" + String(i).padStart(5, "0");
        const body = new TextEncoder().encode("body-" + id + "-" + "x".repeat(180));
        bytes += body.length;
        await a.store.writeBody(id, body);
        for (let k = 0; k < ASSETS; k++) {
          const data = new TextEncoder().encode("asset-" + id + "-" + k + "-" + "y".repeat(48));
          bytes += data.length;
          await a.store.writeAsset(id, "f" + k + ".png", data);
        }
        state.lake.notes.push({ id, title: "Doc " + i, parentId: null, sortOrder: i, updatedAt: new Date().toISOString(), contentHash: sha256Hex(body) });
      }
      await a.store.saveState(state);
      const tInit = Date.now();
      const r1 = await new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
      const initMs = Date.now() - tInit;
      expect(r1.published).toBe(true);

      const tPull = Date.now();
      const r2 = await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
      const pullMs = Date.now() - tPull;
      expect(r2.downloadedNotes).toBe(DOCS);
      expect((await b.store.readBody("n00000"))).not.toBeNull();

      // 增量：改一篇
      const sa = (await a.store.loadState())!;
      const body = new TextEncoder().encode("edited-" + "z".repeat(200));
      await a.store.writeBody("n00001", body);
      sa.lake.notes = sa.lake.notes.map((n) => n.id === "n00001" ? { ...n, contentHash: sha256Hex(body), updatedAt: new Date(Date.now() + 1000).toISOString() } : n);
      await a.store.saveState(sa);
      const tInc = Date.now();
      await new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" }).sync();
      const incMs = Date.now() - tInc;
      await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
      expect(new TextDecoder().decode((await b.store.readBody("n00001"))!)).toContain("edited-");

      // 彻底删除一篇（含附件）
      const sa2 = (await a.store.loadState())!;
      const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { epoch: string; generation: number };
      sa2.lake.notes = sa2.lake.notes.filter((n) => n.id !== "n00002");
      sa2.intents = [{ noteId: "n00002", targetEpoch: pointer.epoch, targetGeneration: pointer.generation, purgedAt: new Date().toISOString() }];
      await a.store.saveState(sa2);
      await a.store.deleteBody("n00002"); await a.store.deleteAssetsDir("n00002");
      const tPurge = Date.now();
      await new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" }).sync();
      const purgeMs = Date.now() - tPurge;
      expect(await remote.list("objects/n00002-")).toHaveLength(0);
      expect(await remote.list("assets/n00002/")).toHaveLength(0);

      const objects = await remote.list("");
      console.log(JSON.stringify({ docs: DOCS, assetsPerDoc: ASSETS, payloadBytes: bytes, objects: objects.length, initMs, pullMs, incMs, purgeMs, elapsedMs: Date.now() - t0 }));
      expect(objects.length).toBeGreaterThan(DOCS * ASSETS);
    } finally {
      await remote.deleteByPrefix("");
    }
  }, 900_000);
});
