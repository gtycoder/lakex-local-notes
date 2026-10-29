import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { indexHashOf, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "../../src/core/s3v3/protocol/s3v3Index.js";
import { lakeBodyKey } from "../../src/core/s3v3/protocol/s3v3Keys.js";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

const enc = (s: string) => new TextEncoder().encode(s);
const ISO = "2026-10-25T00:00:00.000Z";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, lastModified: 0 })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

async function dev(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-rem-" + name + "-"));
  const store = new Store(root); store.bootstrap();
  const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
  await device.init();
  return { root, store, device };
}
const engine = (r: MemoryRemote, d: DesktopStoreDevice, id: string) => new S3v3SyncEngine({ remote: r, device: d, deviceId: id });

describe("目录恢复传播（D4，桌面双端）", () => {
  it("A 彻底删除目录 → B 进回收站；B 恢复后重新发布，A 拉回为活跃目录", async () => {
    const remote = new MemoryRemote();
    const a = await dev("a"); const b = await dev("b");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc", "<p>hi</p>", [], "n1");
    await engine(remote, a.device, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.device, "B").sync();
    // A 删目录（进回收站）并发布
    a.store.deleteTreeNode(nb.id);
    await engine(remote, a.device, "A").sync();
    await engine(remote, b.device, "B").sync();
    // A 彻底删除目录（墓碑）
    a.store.purgeTrashItem(nb.id);
    const purge = await engine(remote, a.device, "A").sync();
    expect(purge.published).toBe(true);
    // B 跟随删除：目录进回收站（不再出现在活跃列表）
    await engine(remote, b.device, "B").sync();
    expect(b.store.listFoldersForSync().find((f) => f.id === nb.id)?.trashedAt).toBeTruthy();
    // B 显式恢复目录
    b.store.restoreTrashItem(nb.id);
    const restore = await engine(remote, b.device, "B").sync();
    expect(restore.published).toBe(true);
    // A 拉回：目录重新活跃
    await engine(remote, a.device, "A").sync();
    const back = a.store.listFoldersForSync().find((f) => f.id === nb.id);
    expect(back).toBeTruthy();
    expect(back?.trashedAt ?? null).toBeNull();
  }, 120_000);
});

describe("父目录兜底（C5，桌面）", () => {
  it("远端 parent 指向本机不存在的目录：不写非法 parent，回落到兜底笔记本", async () => {
    const remote = new MemoryRemote();
    const body = enc("hello");
    const hash = sha256Hex(body);
    const lake: LakeIndex = {
      v: 3, space: "lake", folders: [
        { id: "g1", title: "G", parentId: "ghost-parent", sortOrder: 0, nodeType: "group", icon: null, updatedAt: ISO },
      ],
      notes: [{ id: "n1", title: "N", parentId: "ghost-parent", sortOrder: 0, updatedAt: ISO, contentHash: hash }],
    };
    const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [] };
    const lakeSerialized = serializeLakeIndex(lake);
    const quickSerialized = serializeQuickNotesIndex(quick);
    const lakeCommit = indexHashOf(lakeSerialized);
    const quickCommit = indexHashOf(quickSerialized);
    await remote.put("meta/index/" + lakeCommit + ".json", enc(lakeSerialized), { gzip: true });
    await remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(quickSerialized), { gzip: true });
    await remote.put(lakeBodyKey("n1", hash), body);
    await remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch: "33333333-3333-4333-8333-333333333333", generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));

    const b = await dev("b");
    await engine(remote, b.device, "B").sync();
    const meta = b.store.listNotesSyncMeta().find((n) => n.id === "n1");
    expect(meta).toBeTruthy();
    expect(meta?.parentId).not.toBe("ghost-parent");
    expect(meta?.parentId ? b.store.hasTreeNode(meta.parentId) : false).toBe(true);
    const folder = b.store.listFoldersForSync().find((f) => f.id === "g1");
    expect(folder).toBeTruthy();
    expect(folder?.parentId).not.toBe("ghost-parent");
    expect(folder?.parentId ? b.store.hasTreeNode(folder.parentId) : false).toBe(true);
    expect(b.store.readNote("n1").content).toBe("hello");
  }, 120_000);
});