import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";

/**
 * P1-4 正文突变保护（桌面端到端）：
 * 正文文件被外部损坏/替换后，hash 实算会变，但 App 没写过 DB 行 ⇒ 判据识别为「不可解释的突变」并**不上传**，
 * 旧正文对象与云端索引保持原样（只能由用户从历史/云端恢复），而不是用坏内容覆盖云端。
 */
class CountingRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  puts: string[] = [];
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.puts.push(key); this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
  reset() { this.puts = []; }
  pointer() { return JSON.parse(new TextDecoder().decode(this.objects.get("meta/pointer.json")!.bytes)) as { generation: number; lake: { commit: string } }; }
}

async function device(label: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-suspicious-" + label + "-"));
  const store = new Store(root);
  store.bootstrap();
  const adapter = new DesktopStoreDevice(store, root);
  await adapter.init();
  return { root, store, adapter };
}

describe("P1-4 正文突变保护（桌面端到端）", () => {
  it("正文被外部写成二进制 ⇒ 不上传、不发布、留档历史 + warning；随后正常编辑照常上传", async () => {
    const remote = new CountingRemote();
    const a = await device("a");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc1", "hello-body-1", [], "n1");
    const engine = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    await engine.sync({ onEmptyCloud: "upload" });
    const gen = remote.pointer().generation;
    const oldBodyKey = [...remote.objects.keys()].find((k) => k.startsWith("objects/n1-"))!;
    expect(oldBodyKey).toBeTruthy();

    // 外部损坏：直接覆盖正文文件（App 完全不知情，DB 行的 updatedAt 不变）
    await fs.writeFile(a.store.getNotePaths("n1").lakePath, Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00]));

    remote.reset();
    const corrupted = await engine.sync();
    expect(corrupted.uploadedNotes).toBe(0);
    expect(remote.puts.filter((k) => k.startsWith("objects/"))).toEqual([]);
    expect(remote.pointer().generation).toBe(gen); // 索引不变（不拿可疑内容覆盖云端）
    expect(remote.objects.has(oldBodyKey)).toBe(true); // 旧正文对象也还在
    expect(corrupted.warningDetails.some((w) => w.kind === "body_suspicious_external_change" && w.noteId === "n1")).toBe(true);
    // 本地字节已留档为历史快照（用户可从历史恢复）
    expect(a.store.listNoteHistory("n1").length).toBeGreaterThan(0);

    // 正常编辑（App 内保存：bump updatedAt + 写合法正文）⇒ 不再被判可疑，照常上传
    a.store.saveNote("n1", "Doc1", "<p>用户改过的正文</p>");
    remote.reset();
    const edited = await engine.sync();
    expect(edited.uploadedNotes).toBe(1);
    const newPuts = remote.puts.filter((k) => k.startsWith("objects/"));
    expect(newPuts.length).toBe(1);
    expect(newPuts[0]).not.toBe(oldBodyKey);
    expect(edited.warningDetails.some((w) => w.kind === "body_suspicious_external_change")).toBe(false);
    expect(remote.pointer().generation).toBeGreaterThan(gen);
  }, 60_000);

  it("正常本地编辑（行 updatedAt 前进）不被拦：照常 PUT + 发布", async () => {
    const remote = new CountingRemote();
    const a = await device("a2");
    const nb = a.store.createNotebook("NB");
    a.store.createNoteInAtTopWithContent(nb.id, "Doc2", "hello-2", [], "n2");
    const engine = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "A" });
    await engine.sync({ onEmptyCloud: "upload" });
    remote.reset();
    a.store.saveNote("n2", "Doc2", "<p>normal edit</p>");
    const r = await engine.sync();
    expect(r.uploadedNotes).toBe(1);
    expect(remote.puts.filter((k) => k.startsWith("objects/n2-")).length).toBe(1);
    expect(r.warningDetails.some((w) => w.kind === "body_suspicious_external_change")).toBe(false);
  }, 60_000);
});
