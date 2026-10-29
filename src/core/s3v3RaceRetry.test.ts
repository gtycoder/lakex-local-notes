import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { indexHashOf, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { indexKey, lakeBodyKey } from "./s3v3/protocol/s3v3Keys.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-27T00:00:00.000Z";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  /** pointer 前 N 次读取返回 null（模拟「对端刚传完对象、pointer 还没发布」）。 */
  hidePointerGets = 0;
  pointerGets = 0;
  async get(key: string): Promise<Uint8Array | null> {
    if (key === "meta/pointer.json") {
      this.pointerGets++;
      if (this.hidePointerGets > 0) { this.hidePointerGets--; return null; }
    }
    return this.objects.get(key) ?? null;
  }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

class RecDevice implements S3v3DeviceStore {
  state: DeviceState = {
    lake: { v: 3, space: "lake", notes: [], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [] }, folders: [], intents: [], pending: [],
    remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
  };
  writtenBodies: string[] = [];
  async init(): Promise<void> {}
  async loadState(): Promise<DeviceState | null> { return this.state; }
  async saveState(s: DeviceState): Promise<void> { this.state = s; }
  async loadBaseline(): Promise<null> { return null; }
  async saveBaseline(): Promise<void> {}
  async readBody(): Promise<Uint8Array | null> { return null; }
  async writeBody(id: string): Promise<void> { this.writtenBodies.push(id); }
  async deleteBody(): Promise<void> {}
  async writeHistory(): Promise<string> { return "skip"; }
  async archiveBody(): Promise<void> {}
  async listAssets(): Promise<string[]> { return []; }
  async readAsset(): Promise<Uint8Array | null> { return null; }
  async writeAsset(): Promise<void> {}
  async deleteAssetsDir(): Promise<void> {}
  async readQuickBody(): Promise<Uint8Array | null> { return null; }
  async writeQuickBody(): Promise<void> {}
  async deleteQuickBody(): Promise<void> {}
  async listQuickAssets(): Promise<string[]> { return []; }
  async readQuickAsset(): Promise<Uint8Array | null> { return null; }
  async writeQuickAsset(): Promise<void> {}
  async deleteQuickAssetsDir(): Promise<void> {}
}

function seedCloud(remote: MemRemote, withPointer: boolean): void {
  const body = "body-a";
  const lake: LakeIndex = {
    v: 3, space: "lake", folders: [],
    notes: [{ id: "n1", title: "N", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H(body) }],
  };
  const lakeSer = serializeLakeIndex(lake);
  const commit = indexHashOf(lakeSer);
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [] };
  const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
  remote.put(indexKey("lake", commit), enc(lakeSer));
  remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(serializeQuickNotesIndex(quick)));
  remote.put(lakeBodyKey("n1", H(body)), enc(body));
  if (withPointer) remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));
}

describe("首轮并发首传竞态（261027）", () => {
  it("首轮读到 pointer=null 但云端已有对象 → 自动重试一轮后正常拉取（不再抛 action-required）", async () => {
    const remote = new MemRemote();
    seedCloud(remote, true);
    remote.hidePointerGets = 1; // 第一次读 pointer 时对端还没发布
    const device = new RecDevice();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "race-dev" });
    const report = await engine.sync({ onEmptyCloud: "upload" });
    expect(report.downloadedNotes).toBe(1);
    expect(device.writtenBodies).toContain("n1");
    expect(remote.pointerGets).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("真正的 pointer 损坏（对象在、pointer 永远缺失）仍抛 pointer-corrupt（重试不掩盖问题）", async () => {
    const remote = new MemRemote();
    seedCloud(remote, false);
    const device = new RecDevice();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "corrupt-dev" });
    await expect(engine.sync({ onEmptyCloud: "upload" })).rejects.toThrow(/pointer 缺失但云端已有对象/);
  }, 60_000);
});
