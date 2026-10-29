import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

class CountingRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  puts: string[] = [];
  gets: string[] = [];
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; this.gets.push(key); return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.puts.push(key); this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
  reset() { this.puts = []; this.gets = []; }
  pointer() { return JSON.parse(new TextDecoder().decode(this.objects.get("meta/pointer.json")!.bytes)) as { generation: number; lake: { commit: string } }; }
}
async function device(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-mbody-" + label + "-"));
  const store = new Store(root); store.bootstrap();
  const adapter = new DesktopStoreDevice(store, root);
  await adapter.init();
  return { root, store, adapter };
}

describe("P0 v3 本地正文缺失（.lake 被删）", () => {
  it("云端有副本 ⇒ 自动拉回并给 local_body_restored 警告；不上传空正文", async () => {
    const remote = new CountingRemote();
    const a = await device("a"); const b = await device("b");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc1", "hello-body-1", [], "n1");
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    const gen = remote.pointer().generation;
    await fs.unlink(a.store.getNotePaths("n1").lakePath);
    a.store.listMissingBodies(); // 事件驱动：体检/打开发现缺正文才入队，同步本身不扫描
    remote.reset();
    const r = await ea.sync();
    expect(r.downloadedNotes).toBe(1);
    expect(r.uploadedNotes).toBe(0);
    expect(remote.puts.filter((k) => k.startsWith("objects/"))).toEqual([]);
    expect(r.warningDetails.some((w) => w.kind === "local_body_restored" && w.noteId === "n1")).toBe(true);
    expect(new TextDecoder().decode((await a.adapter.readBody("n1"))!)).toBe("hello-body-1");
    expect(remote.pointer().generation).toBe(gen);
    const again = await ea.sync();
    expect(again.warningDetails).toEqual([]);
    expect(again.downloadedNotes).toBe(0);
  }, 60_000);

  it("云端也没有正文对象 ⇒ local_body_missing，不 PUT、不把条目从云端索引删掉", async () => {
    const remote = new CountingRemote();
    const a = await device("a2"); const b = await device("b2");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc2", "hello-body-2", [], "n2");
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    const gen = remote.pointer().generation;
    const bodyKey = [...remote.objects.keys()].find((k) => k.startsWith("objects/n2-"))!;
    await fs.unlink(a.store.getNotePaths("n2").lakePath);
    a.store.listMissingBodies();
    remote.objects.delete(bodyKey);
    remote.reset();
    const r = await ea.sync();
    expect(r.uploadedNotes).toBe(0);
    expect(remote.puts.filter((k) => k.startsWith("objects/"))).toEqual([]);
    expect(r.warningDetails.some((w) => w.kind === "local_body_missing" && w.noteId === "n2")).toBe(true);
    expect(remote.pointer().generation).toBe(gen);
    const idx = JSON.parse(new TextDecoder().decode((await remote.get("meta/index/" + remote.pointer().lake.commit + ".json"))!)) as { notes: Array<{ id: string }> };
    expect(idx.notes.some((n) => n.id === "n2")).toBe(true);
  }, 60_000);
});
