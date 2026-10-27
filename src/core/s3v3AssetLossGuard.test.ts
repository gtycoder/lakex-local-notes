import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, indexHashOf, serializeDeclaration, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3Index.js";
import { assetKey, declarationKey, indexKey, lakeBodyKey } from "./s3v3Keys.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-25T00:00:00.000Z";
const BODY = "<p>hello</p>";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]): Promise<void> { this.deleted.push(...keys); for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); this.deleted.push(...keys); for (const k of keys) this.objects.delete(k); return keys.length; }
}

/** 复现 261026 真机事故的状态：本地只有正文、附件目录为空（未落地），但 assetsHash 账本字段丢了。 */
class LossyDevice implements S3v3DeviceStore {
  savedState: DeviceState | null = null;
  writtenAssets: string[] = [];
  async init(): Promise<void> {}
  constructor(public state: DeviceState, public baseline: DeviceBaseline) {}
  async loadState(): Promise<DeviceState | null> { return this.state; }
  async saveState(s: DeviceState): Promise<void> { this.savedState = s; this.state = s; }
  async loadBaseline(): Promise<DeviceBaseline | null> { return this.baseline; }
  async saveBaseline(b: DeviceBaseline): Promise<void> { this.baseline = b; }
  async readBody(): Promise<Uint8Array | null> { return enc(BODY); }
  async writeBody(): Promise<void> {}
  async deleteBody(): Promise<void> {}
  async writeHistory(): Promise<string> { return "skip"; }
  async archiveBody(): Promise<void> {}
  async listAssets(): Promise<string[]> { return []; }
  async readAsset(): Promise<Uint8Array | null> { return null; }
  async writeAsset(_id: string, filename: string): Promise<void> { this.writtenAssets.push(filename); }
  async deleteAssetsDir(): Promise<void> {}
  async readQuickBody(): Promise<Uint8Array | null> { return null; }
  async writeQuickBody(): Promise<void> {}
  async deleteQuickBody(): Promise<void> {}
  async listQuickAssets(): Promise<string[]> { return []; }
  async readQuickAsset(): Promise<Uint8Array | null> { return null; }
  async writeQuickAsset(): Promise<void> {}
  async deleteQuickAssetsDir(): Promise<void> {}
}

describe("v3 附件声明数据安全（261026 真机事故回归）", () => {
  it("本地附件目录为空、assetsHash 账本缺失 ⇒ 保留云端声明，绝不删除云端附件", async () => {
    const remote = new MemRemote();
    const decl = buildAssetDeclaration([
      { filename: "a1.png", size: enc("A1").length, hash: H("A1") },
      { filename: "a2.png", size: enc("A2").length, hash: H("A2") },
    ]);
    const contentHash = H(BODY);
    const lake: LakeIndex = {
      v: 3, space: "lake", folders: [],
      notes: [{ id: "n1", title: "N", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash, assetsHash: decl.declHash }],
    };
    const lakeSer = serializeLakeIndex(lake);
    const commit = indexHashOf(lakeSer);
    const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [] };
    const quickSer = serializeQuickNotesIndex(quick);
    const quickCommit = indexHashOf(quickSer);
    const epoch = "11111111-1111-4111-8111-111111111111";
    remote.put(indexKey("lake", commit), enc(lakeSer));
    remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(quickSer));
    remote.put(declarationKey("lake", "n1", decl.declHash), enc(serializeDeclaration(decl.declaration)));
    remote.put(assetKey("n1", "a1.png"), enc("A1"));
    remote.put(assetKey("n1", "a2.png"), enc("A2"));
    remote.put(lakeBodyKey("n1", contentHash), enc(BODY));
    remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch, generation: 1, lake: { commit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));

    const baseline: DeviceBaseline = { epoch, generation: 1, lakeCommit: commit, quickNotesCommit: quickCommit, lake, quickNotes: quick };
    // 本地：正文同内容但 updatedAt 更新（触发 header 上传路径），assetsHash 缺失、附件目录为空（旧代码在这里删光云端附件）。
    const localNote = { id: "n1", title: "N", parentId: null, sortOrder: 0, updatedAt: "2026-10-26T00:00:00.000Z", contentHash };
    const state: DeviceState = {
      lake: { v: 3, space: "lake", notes: [localNote], folders: [] },
      quickNotes: quick, folders: [], intents: [], pending: [],
      remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [], archived: [],
    };
    const device = new LossyDevice(state, baseline);
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "test-device" });
    const report = await engine.sync({ onEmptyCloud: "stay" });

    // 1) 云端附件与声明对象一个都不能少
    expect(remote.objects.has(assetKey("n1", "a1.png"))).toBe(true);
    expect(remote.objects.has(assetKey("n1", "a2.png"))).toBe(true);
    expect(remote.objects.has(declarationKey("lake", "n1", decl.declHash))).toBe(true);
    // 只允许删旧索引/锁这类“本轮已被替换”的对象；附件与声明一律不许删。
    expect(remote.deleted.filter((k) => k.startsWith("assets/") || k.startsWith("meta/assets/"))).toEqual([]);
    // 2) 新索引仍带着 assetsHash（否则下一轮仍会判成「无附件」）
    const ptr = JSON.parse(new TextDecoder().decode(remote.objects.get("meta/pointer.json")!));
    expect(ptr.generation).toBe(2);
    const published = JSON.parse(new TextDecoder().decode(remote.objects.get(indexKey("lake", ptr.lake.commit))!)) as LakeIndex;
    expect(published.notes[0].assetsHash).toBe(decl.declHash);
    // 3) 上报结构化警告，UI 能看到「保留云端声明」
    expect(report.warningDetails.some((w) => w.kind === "asset_kept_remote" && w.noteId === "n1")).toBe(true);
    // 4) 本地 state 也保留声明（下轮从这里恢复）
    expect(device.savedState?.lake.notes[0].assetsHash).toBe(decl.declHash);
    // 5) 顺手自愈：缺失的附件按远端声明补拉回本地
    expect(new Set(device.writtenAssets)).toEqual(new Set(["a1.png", "a2.png"]));
  });
});
