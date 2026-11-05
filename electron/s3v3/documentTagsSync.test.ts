/**
 * 261105 P1：文档标签端到端（桌面 A→B）。
 * 目录随 quick-notes 索引同步；文档关系随 lake 索引 tagIds/tagsUpdatedAt 同步。
 * 护栏：A 给文档打标签 → 发布 → B 拉取后关系正确；B 本机顺序保留、远端新增插最前。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { Store } from "../store.js";
import { QuickNotesStore } from "../quickNotes.js";
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-doctags-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const quick = new QuickNotesStore(root);
  const adapter = new DesktopStoreDevice(store, root, { quickNotes: quick, skipQuickNotesGuard: true });
  await adapter.init();
  return { root, store, quick, adapter };
}

async function remoteLakeNotes(remote: MemoryRemote) {
  const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { lake: { commit: string } };
  const index = JSON.parse(new TextDecoder().decode((await remote.get("meta/index/" + pointer.lake.commit + ".json"))!)) as { notes: Array<{ id: string; tagIds?: string[]; tagsUpdatedAt?: string }> };
  return index.notes;
}

describe("桌面文档标签同步（261105 P1）", () => {
  it("A 给文档打标签 → 发布 → B 拉取后关系正确；顺序=本机保留、远端新增插最前", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    const b = await device("b");
    const tag1 = a.quick.tags.create("项目");
    const tag2 = a.quick.tags.create("重要");
    const nb = a.store.createNotebook("NB");
    const doc = a.store.createNoteInAtTopWithContent(nb.id, "带标签文档", "<p>x</p>", [], "doc-tagged");
    const T1 = "2026-11-01T00:00:00.000Z";
    a.store.documentTags.setNoteTags(doc.id, [tag1.id, tag2.id], T1);
    const ea = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    const eb = new S3v3SyncEngine({ remote, device: b.adapter, deviceId: "B" });
    await ea.sync({ onEmptyCloud: "upload" });
    // 发布侧的 tagIds 必须是排序集合
    const published = (await remoteLakeNotes(remote)).find((n) => n.id === doc.id)!;
    expect(published.tagIds).toEqual([tag1.id, tag2.id].sort());
    expect(published.tagsUpdatedAt).toBe(T1);

    await eb.sync();
    expect(b.store.documentTags.getDocumentTagIds(doc.id)).toEqual([tag1.id, tag2.id]);
    expect(b.store.documentTags.tagsUpdatedAt(doc.id)).toBe(T1);

    // B 本机改顺序（关系版本更晚前先记一次 T0？）——直接以 B 自己的版本 T_B 落盘；
    // A 再追加 tag3（版本 T_A > T_B）⇒ B 拉取时保留本机顺序、远端新增插最前。
    const tag3 = a.quick.tags.create("新增");
    const TB = "2026-11-02T00:00:00.000Z";
    const TA = "2026-11-03T00:00:00.000Z";
    b.store.documentTags.setNoteTags(doc.id, [tag2.id, tag1.id], TB);
    a.store.documentTags.setNoteTags(doc.id, [tag1.id, tag2.id, tag3.id], TA);
    await ea.sync();
    await eb.sync();
    // 远端有 tag3（新增）⇒ 插最前；本机顺序 [tag2, tag1] 保留 ⇒ [tag3, tag2, tag1]
    expect(b.store.documentTags.getDocumentTagIds(doc.id)).toEqual([tag3.id, tag2.id, tag1.id]);
    // 目录也随 quick-notes 索引同步到了 B
    expect(b.quick.tags.list().map((t) => t.id).sort()).toEqual([tag1.id, tag2.id, tag3.id].sort());
  }, 120_000);
});
