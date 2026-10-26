import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, indexHashOf, serializeDeclaration, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3Index.js";
import { indexKey } from "./s3v3Keys.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-25T00:00:00.000Z";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

class ResumeDevice implements S3v3DeviceStore {
  archived: string[] = [];
  constructor(public bodies: Map<string, Uint8Array>, public state: DeviceState) {}
  async init(): Promise<void> {}
  async loadState(): Promise<DeviceState | null> { return this.state; }
  async saveState(): Promise<void> {}
  async loadBaseline(): Promise<null> { return null; }
  async saveBaseline(): Promise<void> {}
  async readBody(id: string): Promise<Uint8Array | null> { return this.bodies.get(id) ?? null; }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> { this.bodies.set(id, bytes); }
  async deleteBody(): Promise<void> {}
  async writeHistory(id: string): Promise<string> { this.archived.push(id); return id; }
  async archiveBody(id: string, bytes: Uint8Array | null): Promise<void> { if (bytes) await this.writeHistory(id); }
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

function cloudWith(noteIds: string[], bodyFor: (id: string) => string) {
  const remote = new MemRemote();
  const lake: LakeIndex = {
    v: 3, space: "lake", folders: [],
    notes: noteIds.map((id) => ({ id, title: "T" + id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H(bodyFor(id)) })),
  };
  const lakeSer = serializeLakeIndex(lake);
  const commit = indexHashOf(lakeSer);
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [] };
  const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
  remote.put(indexKey("lake", commit), enc(lakeSer));
  remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(serializeQuickNotesIndex(quick)));
  for (const id of noteIds) remote.put("objects/" + id + "-" + H(bodyFor(id)) + ".lake", enc(bodyFor(id)));
  remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));
  return { remote, lake };
}

function localState(lake: LakeIndex): DeviceState {
  return {
    lake: { v: 3, space: "lake", notes: lake.notes, folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [] }, folders: [], intents: [], pending: [],
    remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [], archived: [],
  };
}

describe("首拉中断后续传（261026）", () => {
  it("本地正文与云端一致 ⇒ 不再重复写历史归档（续传快）", async () => {
    const { remote, lake } = cloudWith(["n1", "n2"], (id) => "body-" + id);
    const bodies = new Map([["n1", enc("body-n1")], ["n2", enc("body-n2")]]);
    const device = new ResumeDevice(bodies, localState(lake));
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev" });
    const report = await engine.sync({ onEmptyCloud: "stay" });
    expect(report.downloadedNotes).toBe(0); // 正文已就绪，不重复下载
    expect(device.archived).toEqual([]);   // 内容一致，不归档
  });

  it("本地正文与云端不同 ⇒ 只归档被覆盖的那一篇", async () => {
    const { remote, lake } = cloudWith(["n1", "n2"], (id) => "body-" + id);
    const bodies = new Map([["n1", enc("body-n1")], ["n2", enc("OLD-local")]]);
    const device = new ResumeDevice(bodies, localState(lake));
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev" });
    await engine.sync({ onEmptyCloud: "stay" });
    expect(device.archived).toEqual(["n2"]);
    expect(new TextDecoder().decode(bodies.get("n2")!)).toBe("body-n2"); // 远端覆盖回来
  });
});
