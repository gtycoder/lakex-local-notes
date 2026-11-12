import { describe, expect, it } from "vitest";
import { runQuickPush } from "./pipeline.js";
import type { QuickPushDeps, QuickPushDevice, QuickPushRemote } from "./types.js";
import { LOCK_KEY } from "../protocol/publishLock.js";
import { sha256Hex } from "../../syncUtils.js";
import {
  indexHashOf, serializeLakeIndex, serializeQuickNotesIndex, parseQuickNotesIndexBytes,
  type LakeIndex, type QuickNoteEntry, type QuickNotesIndex,
} from "../protocol/s3v3Index.js";
import { indexKey, quickNoteBodyKey, S3V3_POINTER_KEY } from "../protocol/s3v3Keys.js";
import { validatePointer, type S3v3Pointer } from "../protocol/s3v3Types.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const NOW = new Date("2026-11-11T00:00:00.000Z");
const iso = () => NOW.toISOString();

type Op = { op: string; key: string };

class FakeRemote implements QuickPushRemote {
  objects = new Map<string, Uint8Array>();
  ops: Op[] = [];
  async get(key: string) { this.ops.push({ op: "get", key }); return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array) { this.ops.push({ op: "put", key }); this.objects.set(key, new Uint8Array(bytes)); }
  async deleteMany(keys: string[]) { for (const k of keys) this.ops.push({ op: "delete", key: k }); for (const k of keys) this.objects.delete(k); }
}

class FakeDevice implements QuickPushDevice {
  baseline: import("../protocol/s3v3Types.js").S3v3Pointer extends never ? never : any = null;
  quickState: any = null;
  state: any = null;
  body: Uint8Array | null = null;
  synced: Array<{ id: string; hash: string }> = [];
  savedBaselines: any[] = [];
  markers: any[] = [];
  async loadBaseline() { return this.baseline; }
  async loadQuickPushState() { return this.quickState; }
  async loadState() { return this.state; }
  async readQuickBody() { return this.body; }
  async markQuickNoteSynced(id: string, hash: string) { this.synced.push({ id, hash }); }
  async saveBaseline(b: any) { this.savedBaselines.push(b); this.baseline = b; }
  async persistSyncMarkers(m: any) { this.markers.push(m); }
  async listQuickAssets(_id: string) { return []; }
  async readQuickAsset(_id: string, _filename: string) { return null; }
}

function lakeIndex(): LakeIndex { return { v: 3, space: "lake", notes: [], folders: [] }; }
const localEntry = (id: string, body: string, over: Partial<QuickNoteEntry> = {}): QuickNoteEntry => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: sha256Hex(enc(body)), ...over,
});
const qEntry = (id: string, body: string, over: Partial<QuickNoteEntry> = {}): QuickNoteEntry => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: sha256Hex(enc(body)), ...over,
});

interface FixtureOpts {
  remoteItems?: QuickNoteEntry[];
  remoteTags?: QuickNotesIndex["tags"];
  remotePurged?: string[];
  local?: QuickNoteEntry | null;
  body?: string;
  baselineGen?: number;
  pointerGen?: number;
  baseline?: boolean;
  pointer?: boolean;
  restorePending?: string[];
  remotePurgedState?: string[];
}
function fixture(opts: FixtureOpts = {}) {
  const lake = lakeIndex();
  const lakeCommit = indexHashOf(serializeLakeIndex(lake));
  const quick: QuickNotesIndex = {
    v: 3, space: "quickNotes", items: opts.remoteItems ?? [],
    ...(opts.remoteTags ? { tags: opts.remoteTags } : {}),
    ...(opts.remotePurged && opts.remotePurged.length ? { purged: [...opts.remotePurged] } : {}),
  };
  const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
  const epoch = "11111111-1111-4111-8111-111111111111";
  const remote = new FakeRemote();
  if (opts.pointer !== false) {
    const pointer: S3v3Pointer = {
      v: 3, epoch, generation: opts.pointerGen ?? 1,
      lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit },
      createdAt: iso(), deviceId: "D",
    };
    remote.objects.set(S3V3_POINTER_KEY, enc(JSON.stringify(pointer)));
    remote.objects.set(indexKey("quickNotes", quickCommit), enc(serializeQuickNotesIndex(quick)));
    remote.objects.set(indexKey("lake", lakeCommit), enc(serializeLakeIndex(lake)));
  }
  const device = new FakeDevice();
  device.baseline = opts.baseline === false ? null : {
    epoch, generation: opts.baselineGen ?? 1, lakeCommit, quickNotesCommit: quickCommit, lake, quickNotes: quick,
  };
  const local = opts.local === undefined ? localEntry("q1", "hello") : opts.local;
  device.quickState = local ? {
    quickNote: local, restorePending: opts.restorePending ?? [], remotePurged: opts.remotePurgedState ?? [],
    quickPurges: [], quickPurgeTimes: {},
  } : { quickNote: null, restorePending: [], remotePurged: [], quickPurges: [], quickPurgeTimes: {} };
  device.state = {
    lake,
    quickNotes: local ? { v: 3, space: "quickNotes", items: [...quick.items.filter((q) => q.id !== local.id), local] } : quick,
    folders: [], intents: [], pending: [], remotePurged: [], restorePending: [],
  };
  device.body = enc(opts.body ?? "hello");
  const deps: QuickPushDeps = { remote, device, deviceId: "D", now: () => NOW };
  return { remote, device, deps, lake, lakeCommit, quick, quickCommit, epoch };
}

const summary = (ops: Op[]) => ops.map((o) => o.op + " " + o.key);
const quickBodyKey = (hash: string) => quickNoteBodyKey(hash);

describe("单条推送独立管线：请求序列（261110 剥离 + 提速）", () => {
  it("成功推一条 = 11 次请求，固定顺序；锁内只读一次 pointer（无入口读），释放锁不查 owner", async () => {
    const f = fixture();
    const result = await runQuickPush(f.deps, "q1");
    expect(result).toMatchObject({ status: "pushed", uploadedContent: true, uploadedAssets: 0, unchanged: false, generation: 2 });
    const ops = summary(f.remote.ops);
    expect(ops).toHaveLength(11);
    // put 索引 key 含内容 hash（动态）⇒ 用位置/类别断言。
    // 上面的字面量对 put 索引的 hash 是动态的 ⇒ 用位置/类别断言（顺序稳定、key 动态）。
    expect(ops[0]).toBe("get " + LOCK_KEY);
    expect(ops[1]).toBe("put " + LOCK_KEY);
    expect(ops[2]).toBe("get " + LOCK_KEY);
    expect(ops[3]).toBe("get " + S3V3_POINTER_KEY);
    expect(ops[4]).toBe("put " + quickBodyKey(sha256Hex(enc("hello"))));
    expect(ops[5].startsWith("get quick-notes/meta/index/")).toBe(true);
    expect(ops[6].startsWith("put quick-notes/meta/index/")).toBe(true);
    expect(ops[7]).toBe("get " + LOCK_KEY); // 写 pointer 前 assert 仍持锁
    expect(ops[8]).toBe("put " + S3V3_POINTER_KEY);
    expect(ops[9]).toBe("get " + S3V3_POINTER_KEY); // 写后读回校验
    expect(ops[10]).toBe("delete " + LOCK_KEY); // 释放锁：TTL 余量内直接 DELETE（无 owner GET）
    // 不读 lake 索引、不 GET 其它小记正文。
    expect(f.remote.ops.filter((o) => o.key.startsWith("meta/index/")).length).toBe(0);
    expect(f.remote.ops.filter((o) => o.op === "get" && o.key.startsWith("quick-notes/objects/")).length).toBe(0);
    const pointer = validatePointer(JSON.parse(dec(f.remote.objects.get(S3V3_POINTER_KEY)!)));
    expect(pointer.ok && pointer.pointer.generation).toBe(2);
  });

  it("重复点（内容/meta/资产都没变）= 只读 1 次 pointer，不取锁、不读索引、0 上传、0 发布", async () => {
    const f = fixture();
    await runQuickPush(f.deps, "q1");
    // 第一次推送后 baseline 已被 fake device 更新；重复点。
    f.remote.ops = [];
    const again = await runQuickPush(f.deps, "q1");
    expect(again).toMatchObject({ status: "pushed", unchanged: true, uploadedContent: false, generation: 2 });
    expect(summary(f.remote.ops)).toEqual(["get " + S3V3_POINTER_KEY]);
  });

  it("别端新增/删除/改标签：发布只 upsert 本条，其余 items/tags/purged 原样保留", async () => {
    const tags = [{ id: "t1", name: "Tag", createdAt: iso(), updatedAt: iso() }];
    const other = qEntry("q2", "other");
    const f = fixture({ remoteItems: [other], remoteTags: tags, remotePurged: ["dead-1"] });
    const result = await runQuickPush(f.deps, "q1");
    expect(result.status).toBe("pushed");
    const p = validatePointer(JSON.parse(dec(f.remote.objects.get(S3V3_POINTER_KEY)!)));
    if (!p.ok) throw new Error("pointer invalid");
    const idx = parseQuickNotesIndexBytes(f.remote.objects.get(indexKey("quickNotes", p.pointer.quickNotes.commit))!).index;
    expect(idx.items.map((i) => i.id).sort()).toEqual(["q1", "q2"]);
    expect(idx.items.find((i) => i.id === "q2")).toEqual(other);
    expect(idx.tags).toEqual(tags);
    expect(idx.purged).toEqual(["dead-1"]);
  });
});

describe("单条推送独立管线：回退四条件（各自 full-sync + 已释放锁）", () => {
  it("无 baseline：读一次 pointer 区分 no-cloud / no-baseline；不取锁", async () => {
    const noPointer = fixture({ baseline: false, pointer: false });
    expect(await runQuickPush(noPointer.deps, "q1")).toEqual({ status: "full-sync", reason: "no-cloud" });
    expect(summary(noPointer.remote.ops)).toEqual(["get " + S3V3_POINTER_KEY]);

    const withPointer = fixture({ baseline: false });
    expect(await runQuickPush(withPointer.deps, "q1")).toEqual({ status: "full-sync", reason: "no-baseline" });
    expect(summary(withPointer.remote.ops)).toEqual(["get " + S3V3_POINTER_KEY]);
  });

  it("有 baseline 但云端无 pointer：取锁 → 读不到 pointer → full-sync(no-cloud) 并释放锁", async () => {
    const f = fixture({ pointer: false });
    expect(await runQuickPush(f.deps, "q1")).toEqual({ status: "full-sync", reason: "no-cloud" });
    expect(summary(f.remote.ops)).toEqual(["get " + LOCK_KEY, "put " + LOCK_KEY, "get " + LOCK_KEY, "get " + S3V3_POINTER_KEY, "delete " + LOCK_KEY]);
    expect(f.remote.ops.some((o) => o.op === "put" && o.key === S3V3_POINTER_KEY)).toBe(false);
  });

  it("baseline 与 pointer 不同代：full-sync(cloud-changed)，不发布、锁已释放", async () => {
    const f = fixture({ pointerGen: 2, baselineGen: 1 });
    expect(await runQuickPush(f.deps, "q1")).toEqual({ status: "full-sync", reason: "cloud-changed" });
    expect(f.remote.ops.at(-1)).toEqual({ op: "delete", key: LOCK_KEY });
    expect(f.remote.ops.some((o) => o.op === "put" && o.key === S3V3_POINTER_KEY)).toBe(false);
  });

  it("远端 purged 且本机无恢复标记：full-sync(remote-deleted)，不发布、锁已释放", async () => {
    const f = fixture({ remotePurged: ["q1"] });
    expect(await runQuickPush(f.deps, "q1")).toEqual({ status: "full-sync", reason: "remote-deleted" });
    expect(f.remote.ops.at(-1)).toEqual({ op: "delete", key: LOCK_KEY });
    expect(f.remote.ops.some((o) => o.op === "put" && o.key === S3V3_POINTER_KEY)).toBe(false);
  });

  it("本机没有这条（同批被删）：not-found，零网络", async () => {
    const f = fixture({ local: null });
    expect(await runQuickPush(f.deps, "q1")).toEqual({ status: "not-found" });
    expect(f.remote.ops).toEqual([]);
  });

  it("设备没有轻量状态端口：回退 loadState 仍能推（只有一份实现，慢路径语义不变）", async () => {
    const f = fixture();
    const inner = f.device;
    const legacyDevice: QuickPushDevice = {
      loadBaseline: () => inner.loadBaseline(),
      loadState: () => inner.loadState(),
      readQuickBody: () => inner.readQuickBody(),
      markQuickNoteSynced: (id, hash) => inner.markQuickNoteSynced(id, hash),
      saveBaseline: (b) => inner.saveBaseline(b),
      persistSyncMarkers: (m) => inner.persistSyncMarkers(m),
      listQuickAssets: () => inner.listQuickAssets("q1"),
      readQuickAsset: (id, f2) => inner.readQuickAsset(id, f2),
    };
    const result = await runQuickPush({ ...f.deps, device: legacyDevice }, "q1");
    expect(result.status).toBe("pushed");
  });

  it("轻量读返回 null（单行查询缺失，非删除）：回退整份 state 后继续", async () => {
    const f = fixture();
    f.device.loadQuickPushState = async () => null;
    const result = await runQuickPush(f.deps, "q1");
    expect(result.status).toBe("pushed");
  });
});

describe("单条推送状态读取：合并读端口（261112 task-83）", () => {
  it("设备提供合并读：只调一次，不再分别 loadBaseline/loadQuickPushState，结果与两段读一致", async () => {
    const plain = fixture();
    const expected = await runQuickPush(plain.deps, "q1");

    const f = fixture();
    const inner = f.device;
    let snapshotCalls = 0;
    let baselineCalls = 0;
    let stateCalls = 0;
    const mergedDevice: QuickPushDevice = {
      loadBaseline: async () => { baselineCalls += 1; return inner.loadBaseline(); },
      loadQuickPushState: async () => { stateCalls += 1; return inner.loadQuickPushState(); },
      loadQuickPushSnapshot: async () => {
        snapshotCalls += 1;
        return { baseline: await inner.loadBaseline(), light: await inner.loadQuickPushState() };
      },
      readQuickBody: () => inner.readQuickBody(),
      markQuickNoteSynced: (id, hash) => inner.markQuickNoteSynced(id, hash),
      saveBaseline: (b) => inner.saveBaseline(b),
      persistSyncMarkers: (m) => inner.persistSyncMarkers(m),
      listQuickAssets: (id) => inner.listQuickAssets(id),
      readQuickAsset: (id, filename) => inner.readQuickAsset(id, filename),
    };
    const result = await runQuickPush({ ...f.deps, device: mergedDevice }, "q1");
    expect(result).toEqual(expected);
    expect(snapshotCalls).toBe(1);
    expect(baselineCalls).toBe(0);
    expect(stateCalls).toBe(0);
  });

  it("合并读返回 null（没有能力/拿不到）：回退两段读取，结果不变", async () => {
    const expected = await runQuickPush(fixture().deps, "q1");
    const f = fixture();
    const inner = f.device;
    let baselineCalls = 0;
    let stateCalls = 0;
    const device: QuickPushDevice = {
      loadBaseline: async () => { baselineCalls += 1; return inner.loadBaseline(); },
      loadQuickPushState: async () => { stateCalls += 1; return inner.loadQuickPushState(); },
      loadQuickPushSnapshot: async () => null,
      readQuickBody: () => inner.readQuickBody(),
      markQuickNoteSynced: (id, hash) => inner.markQuickNoteSynced(id, hash),
      saveBaseline: (b) => inner.saveBaseline(b),
      persistSyncMarkers: (m) => inner.persistSyncMarkers(m),
      listQuickAssets: (id) => inner.listQuickAssets(id),
      readQuickAsset: (id, filename) => inner.readQuickAsset(id, filename),
    };
    const result = await runQuickPush({ ...f.deps, device }, "q1");
    expect(result).toEqual(expected);
    expect(baselineCalls).toBe(1);
    expect(stateCalls).toBe(1);
  });
});
