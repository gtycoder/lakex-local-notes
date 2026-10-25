import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { Store } from "../store.js";
import { QuickNotesStore } from "../quickNotes.js";
import sharp from "sharp";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

async function device(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-qn-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const quick = new QuickNotesStore(root);
  const adapter = new DesktopStoreDevice(store, root, { quickNotes: quick, skipQuickNotesGuard: true });
  await adapter.init();
  return { root, store, quick, adapter };
}

describe("桌面小记 v3 适配器（文本）", () => {
  it("A 建小记上传 → B 拉取 → B 编辑 → A 拉取 → B 删除 → A 进回收站", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    const b = await device("b");
    const q = a.quick.createQuickNote({ text: "hello-v3", draftId: "d1", stagedImageIds: [] });
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    expect(b.quick.readQuickNote(q.id).content.text).toBe("hello-v3");

    const tag = a.quick.tags.create("项目");
    a.quick.setQuickNoteTags(q.id, [tag.id]);
    await ea.sync();
    await eb.sync();
    expect(b.quick.listQuickNoteTagIds(q.id)).toEqual([tag.id]);
    expect(b.quick.tags.list().map((t) => t.name)).toContain("项目");

    b.quick.updateQuickNote(q.id, { text: "edited-on-b", draftId: "d2", stagedImageIds: [] });
    await eb.sync();
    await ea.sync();
    expect(a.quick.readQuickNote(q.id).content.text).toBe("edited-on-b");

    b.quick.deleteQuickNote(q.id);
    const rb = await eb.sync();
    console.log("B sync", JSON.stringify(rb));
    const ra = await ea.sync();
    console.log("A sync", JSON.stringify(ra), a.quick.listQuickNotes().map((n) => n.id));
    expect(a.quick.listQuickNotes().some((n) => n.id === q.id)).toBe(false);
    expect(a.quick.listQuickNoteTrash().some((n) => n.id === q.id)).toBe(true);
  }, 120_000);

  it("图片附件随小记上传/下载（声明 + 资产对象）", async () => {
    const remote = new MemoryRemote();
    const a = await device("img-a");
    const b = await device("img-b");
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    const staged = await a.quick.stageImage("d-img", { bytes: png, filename: "a.png" });
    const q = a.quick.createQuickNote({ text: "with-image", draftId: "d-img", stagedImageIds: [staged.id] });
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    await eb.sync();
    const got = b.quick.readQuickNote(q.id);
    expect(got.content.text).toBe("with-image");
    expect(got.content.images.length).toBe(1);
    const filename = got.content.images[0].filename;
    expect(await fs.stat(path.join(b.quick.quickNoteAssetsPathFor(q.id), filename)).then(() => true).catch(() => false)).toBe(true);
  }, 120_000);
});
