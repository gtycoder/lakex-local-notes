import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore } from "./fileDeviceStore.js";
import { migrateLegacyManifest } from "./migrate.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

describe("旧 Manifest → v3 迁移", () => {
  it("保留正文/附件/回收站/标签，丢弃墓碑，设备可直接拉取", async () => {
    const remote = new MemoryRemote();
    const body1 = new TextEncoder().encode("doc1");
    const hash1 = sha256Hex(body1);
    const asset = new TextEncoder().encode("img");
    const assetHash = sha256Hex(asset);
    const qbody = new TextEncoder().encode("qn");
    const qhash = sha256Hex(qbody);
    await remote.put("objects/n1-" + hash1 + ".lake", body1);
    await remote.put("assets/n1/a.png", asset);
    await remote.put("quick-notes/objects/" + qhash + ".qnote", qbody);
    const pointer = await migrateLegacyManifest(remote, {
      notes: [
        { id: "n1", title: "Doc1", parentId: null, sortOrder: 0, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: hash1, assets: [{ filename: "a.png", size: asset.length, hash: assetHash }] },
        { id: "n2", title: "Deleted", parentId: null, sortOrder: 1, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: "c".repeat(64), deleted: true, deletedAt: "2026-10-25T00:00:00.000Z" },
      ],
      folders: [{ id: "f1", title: "NB", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-10-25T00:00:00.000Z" }],
    }, {
      items: [{ id: "q1", createdAt: "c", updatedAt: "u", contentHash: qhash, tagIds: ["t1"] }],
      tags: [{ id: "t1", name: "tag", createdAt: "c", updatedAt: "u", order: 0 }],
    });
    expect(pointer.skippedTombstones).toBe(1);
    expect(pointer.lake.notes.map((n) => n.id)).toEqual(["n1"]);
    expect(pointer.lake.notes[0].assetsHash).toBeTruthy();
    // 新设备直接拉取
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-mig-"));
    const store = new FileDeviceStore(root);
    await store.init();
    const r = await new S3v3SyncEngine({ remote, device: store, deviceId: "B" }).sync();
    expect(r.warnings.length).toBe(0);
    expect(new TextDecoder().decode((await store.readBody("n1"))!)).toBe("doc1");
    expect(new TextDecoder().decode((await store.readAsset("n1", "a.png"))!)).toBe("img");
    expect((await store.loadState())!.quickNotes.tags?.[0].id).toBe("t1");
  });
});
