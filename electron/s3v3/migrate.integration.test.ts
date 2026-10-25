import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it as test } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore } from "./fileDeviceStore.js";
import { migrateLegacyManifest } from "./migrate.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

describeIt("真实 S3 · 旧 Manifest 迁移演练", () => {
  test("旧布局对象 → 迁移 → 新设备拉取 → 清理", async () => {
    const settings = {
      endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!,
      accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!,
      prefix: (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_migrate/" + randomUUID(), forcePathStyle: false,
    };
    const remote = new S3v3S3Remote(settings);
    try {
      const body = new TextEncoder().encode("legacy-doc");
      const hash = sha256Hex(body);
      const asset = new TextEncoder().encode("legacy-asset");
      const assetHash = sha256Hex(asset);
      // 旧协议对象布局（正文/附件路径与 v3 相同）
      await remote.put("objects/n1-" + hash + ".lake", body);
      await remote.put("assets/n1/a.png", asset);
      const legacy = {
        notes: [
          { id: "n1", title: "Legacy", parentId: null, sortOrder: 0, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: hash, assets: [{ filename: "a.png", size: asset.length, hash: assetHash }] },
          { id: "n2", title: "Tombstone", parentId: null, sortOrder: 1, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: "a".repeat(64), deleted: true, deletedAt: "2026-10-25T00:00:00.000Z" },
        ],
        folders: [{ id: "f1", title: "NB", parentId: null, sortOrder: 0, nodeType: "notebook" as const, icon: null, updatedAt: "2026-10-25T00:00:00.000Z" }],
      };
      const result = await migrateLegacyManifest(remote, legacy, null, { deviceId: "migration" });
      expect(result.skippedTombstones).toBe(1);
      expect(await remote.list("meta/index/")).toHaveLength(1);
      // 新设备直接拉取
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-mig-it-"));
      const store = new FileDeviceStore(root); await store.init();
      const r = await new S3v3SyncEngine({ remote, device: store, deviceId: "B" }).sync();
      expect(r.warnings).toEqual([]);
      expect(new TextDecoder().decode((await store.readBody("n1"))!)).toBe("legacy-doc");
      expect(new TextDecoder().decode((await store.readAsset("n1", "a.png"))!)).toBe("legacy-asset");
      const state = (await store.loadState())!;
      expect(state.lake.notes.map((n) => n.id)).toEqual(["n1"]);
      expect(state.lake.folders.map((f) => f.id)).toEqual(["f1"]);
      // 孤儿清理演练（模拟迁移前崩溃留下的旧声明）
      await remote.put("meta/assets/n1/" + "f".repeat(64) + ".json", new TextEncoder().encode(JSON.stringify({ assets: [] })));
      const clean = await new S3v3SyncEngine({ remote, device: store, deviceId: "B" }).deepCleanup();
      expect(clean.deleted.length).toBeGreaterThan(0);
      expect(await remote.list("meta/assets/n1/" + "f".repeat(64))).toHaveLength(0);
    } finally {
      await remote.deleteByPrefix("");
    }
  }, 120_000);
});
