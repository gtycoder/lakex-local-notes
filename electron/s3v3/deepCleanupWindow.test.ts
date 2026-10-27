import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

const DAY = 86_400_000;
const enc = (s: string) => new TextEncoder().encode(s);

/** 带可控 lastModified 的假 S3（deepCleanup 需要「对象年龄」才能判窗口）。 */
class MtimeRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean; mtime?: number }>();
  async get(key: string): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip, mtime: Date.now() });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, o]) => ({ key, size: o.bytes.length, ...(o.mtime !== undefined ? { lastModified: o.mtime } : {}) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
  /** 直接种一个对象（可指定年龄；mtime undefined = provider 不返回 lastModified）。 */
  add(key: string, text: string, mtime?: number): void { this.objects.set(key, { bytes: enc(text), gzip: false, ...(mtime !== undefined ? { mtime } : {}) }); }
}

const tmp = async (name: string) => fs.mkdtemp(path.join(os.tmpdir(), "s3v3-gc-" + name + "-"));
async function device(name: string) { const root = await tmp(name); const store = new FileDeviceStore(root); await store.init(); return store; }
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function addDoc(store: FileDeviceStore, id: string, body: string, assets: Record<string, string> = {}) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = enc(body);
  await store.writeBody(id, bytes);
  for (const [fn, content] of Object.entries(assets)) await store.writeAsset(id, fn, enc(content));
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), { id, title: id, parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) }];
  await store.saveState(state);
  return sha256Hex(bytes);
}
const engine = (remote: MtimeRemote, store: FileDeviceStore, id: string) => new S3v3SyncEngine({ remote, device: store, deviceId: id });

describe("v3 深度清理保护（parity F3/F4）", () => {
  it("历史引用/上一版索引/窗口内对象都保留；窗口外未引用才删；dryRun 不动对象", async () => {
    const remote = new MtimeRemote();
    const a = await device("a");
    await addDoc(a, "n1", "x", { "a.png": "PNG-A" });
    await engine(remote, a, "A").sync({ onEmptyCloud: "upload" });

    const now = Date.now();
    const old = now - 10 * DAY;
    const recent = now - 1 * DAY;
    remote.add("assets/orphan-old/o.png", "old", old);
    remote.add("assets/orphan-recent/r.png", "recent", recent);
    remote.add("assets/n1/history-only.png", "hist", old); // 只被本机历史引用
    remote.add("meta/index/" + "c".repeat(64) + ".json", "{}", old);       // 更早的未引用索引
    remote.add("meta/index/" + "d".repeat(64) + ".json", "{}", recent);    // 最近未引用索引（上一版保护）
    remote.add("objects/no-age-" + "e".repeat(64) + ".lake", "noage");     // provider 不返回 lastModified

    const extraKeep = new Set(["assets/n1/history-only.png"]);
    const dry = await engine(remote, a, "A").deepCleanup({ dryRun: true, extraKeep });
    expect(dry.dryRun).toBe(true);
    expect(dry.deleted).toContain("assets/orphan-old/o.png");
    expect(dry.deleted).not.toContain("assets/orphan-recent/r.png");
    expect(dry.deleted).not.toContain("assets/n1/history-only.png");
    expect(dry.deleted).not.toContain("meta/index/" + "d".repeat(64) + ".json");
    expect(dry.deleted).toContain("meta/index/" + "c".repeat(64) + ".json");
    expect(dry.ageUnknown).toBe(1);
    expect(dry.skippedRecent).toBeGreaterThanOrEqual(1);
    expect(dry.previousIndexes).toContain("meta/index/" + "d".repeat(64) + ".json");
    // dryRun 不删
    expect(remote.objects.has("assets/orphan-old/o.png")).toBe(true);

    const real = await engine(remote, a, "A").deepCleanup({ extraKeep });
    expect(real.deleted.sort()).toEqual(dry.deleted.sort());
    expect(remote.objects.has("assets/orphan-old/o.png")).toBe(false);
    expect(remote.objects.has("assets/orphan-recent/r.png")).toBe(true);
    expect(remote.objects.has("assets/n1/history-only.png")).toBe(true);
    expect(remote.objects.has("meta/index/" + "d".repeat(64) + ".json")).toBe(true);
    expect(remote.objects.has("objects/no-age-" + "e".repeat(64) + ".lake")).toBe(true);
  });

  it("retentionDays=0（手动显式清理）：窗口内未引用也删，但显式 keep 仍保留", async () => {
    const remote = new MtimeRemote();
    const a = await device("b");
    await addDoc(a, "n1", "x", { "a.png": "PNG-A" });
    await engine(remote, a, "A").sync({ onEmptyCloud: "upload" });
    const recent = Date.now() - 1000;
    remote.add("assets/orphan-recent/r.png", "recent", recent);
    remote.add("assets/n1/history-only.png", "hist", recent);
    const result = await engine(remote, a, "A").deepCleanup({ retentionDays: 0, extraKeep: ["assets/n1/history-only.png"] });
    expect(result.deleted).toContain("assets/orphan-recent/r.png");
    expect(result.deleted).not.toContain("assets/n1/history-only.png");
    expect(remote.objects.has("assets/orphan-recent/r.png")).toBe(false);
    expect(remote.objects.has("assets/n1/history-only.png")).toBe(true);
  });
});
