/**
 * 小记「保存并同步」并发安全的**端到端级（引擎层）**护栏。
 *
 * 背景（AGENTS §4「互斥域」/「小记『保存并同步』」）：
 * - 单条推送 pushQuickNote 走**高优先域**，整轮同步 syncQuickNotesViaEngine 走**维护域**，两者可并行；
 *   唯一交叉风险 = 整轮同步拿"它读到的旧本地快照"落地时，把刚推的条目覆盖掉。
 * - 小记清单是单文件覆盖写、**没有 CAS**（quick-notes/manifests/latest.json）
 *   ⇒ 兜底 = 推送成功后往维护域队尾排一次幂等回核（再推一次）。
 *
 * 证据等级（本文件与 quickNotePush.test.ts 的区别）：
 * - quickNotePush.test.ts 已有 8 例**属性级**护栏，其中「并发防覆盖」那例的"覆盖"是手写
 *   seedManifest(snapshot, ...) 直接把旧清单盖回去 —— 那是**等价复现**，不是真交错；
 * - 本文件把**真实引擎**停在"已读过本地清单快照、尚未写清单"的时刻（停在它本来就会 await 的
 *   listDeferredDeletedQuickNotes 上，只延长这次 await，不改变任何产品逻辑），
 *   让**真实 pushQuickNote** 在这个窗口内跑完 ⇒ 两个真实操作真正重叠 = **真交错**。
 * - 边界的 S3 / 本地库仍是内存假件（与两个既有 core 测试同款写法），故是"引擎层端到端"，
 *   不是跨进程/真网络 E2E。
 *
 * 本文件**不修改任何产品实现**，只新增测试。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { S3Store, SyncConfig } from "./syncEngine.js";
import type { ManifestItem, QuickNotesManifest } from "./manifestTypes.js";
import { pushQuickNote } from "./quickNotePush.js";
import {
  syncQuickNotesViaEngine,
  type QuickNoteSyncItem,
  type QuickNoteSyncItemImage,
  type QuickNotesSyncDbPort,
} from "./quickNotesSyncEngine.js";
import { sha256Sync } from "./sha256Sync.js";

const cfg: SyncConfig = { endpoint: "https://s3.test", region: "test", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "lake" };
const ROOT = "quick-notes";
const manifestKey = `${cfg.prefix}/${ROOT}/manifests/latest.json`;
const objectKey = (contentHash: string) => `${cfg.prefix}/${ROOT}/objects/${contentHash}.qnote`;
const assetKey = (id: string, filename: string) => `${cfg.prefix}/${ROOT}/assets/${id}/${filename}`;
const bytesOf = (text: string) => new TextEncoder().encode(text);
const FIXED_AT = "2026-10-13T00:00:00.000Z";
const TARGET = "note-target";
const IMG: QuickNoteSyncItemImage = { id: "img-1", filename: "pic.png", mimeType: "image/png", width: 1, height: 1, size: 4, hash: sha256Sync(bytesOf("PIC!")) };

/** 可复用的"挂起点"：wait() 先 resolve reached（外部已到达该点），再等 release()。 */
interface Gate { reached: Promise<void>; release: () => void; wait: () => Promise<void>; }
function createGate(): Gate {
  let reach!: () => void;
  let rel!: () => void;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  const released = new Promise<void>((resolve) => { rel = resolve; });
  return { reached, release: () => rel(), wait: async () => { reach(); await released; } };
}

// 内存假 S3（沿用 quickNotePush.test.ts / quickNotesSyncEngine.test.ts 的写法），
// 额外支持"在写清单对象时挂起"——用于把单条推送停在网络窗口内验证 I2。
interface FakeS3 extends S3Store {
  bucket: Map<string, Uint8Array>;
  puts: string[];
  armManifestPutGate(gate: Gate): void;
}

function createFakeS3(): FakeS3 {
  const bucket = new Map<string, Uint8Array>();
  const puts: string[] = [];
  let gated = false;
  let gate: Gate | null = null;
  return {
    bucket,
    puts,
    armManifestPutGate(next: Gate) { gate = next; gated = true; },
    async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
      const bytes = bucket.get(key);
      if (!bytes) return null;
      if (opts?.maxBytes && bytes.length > opts.maxBytes) throw new Error(`对象超限: ${key}`);
      return bytes;
    },
    async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
      void opts;
      puts.push(key);
      if (gated && key === manifestKey && gate) { gated = false; await gate.wait(); }
      bucket.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    },
  };
}

interface FakeNote {
  id: string; createdAt: string; updatedAt: string; contentHash: string;
  syncState: string; isConflict: boolean; images: QuickNoteSyncItemImage[];
  content: Uint8Array;
}

interface FakePort {
  port: QuickNotesSyncDbPort;
  notes: Map<string, FakeNote>;
  assets: Map<string, Uint8Array>;
  bases: Map<string, string>;
  deleted: Map<string, { id: string; createdAt: string; updatedAt: string; deletedAt: string }>;
  syncedCalls: Array<{ id: string; expected: string }>;
  /** 把真实引擎的"上传阶段之后、写清单之前"那次 listDeferredDeletedQuickNotes 挂起。 */
  armDeferredGate(gate: Gate): void;
}

/**
 * 内存假端口：语义对齐 QuickNotesSyncDbPort 契约（软删保留内容、归档不进墓碑列表），
 * 直接复用 src/core/quickNotesSyncEngine.test.ts 的写法；额外两点：
 * - markSyncedIfUnchanged 实现 I2 真语义（本地内容仍等于 expected 才标 synced）；
 * - listDeferredDeletedQuickNotes 第 2 次调用可挂起（真交错点）。
 */
function createFakePort(): FakePort {
  const notes = new Map<string, FakeNote>();
  const assets = new Map<string, Uint8Array>();
  const deleted = new Map<string, { id: string; createdAt: string; updatedAt: string; deletedAt: string }>();
  const bases = new Map<string, string>();
  const restorePending = new Set<string>();
  const syncedCalls: Array<{ id: string; expected: string }> = [];
  const published = new Set<string>();
  let deferredCalls = 0;
  let deferredGate: Gate | null = null;
  const now = () => new Date().toISOString();
  const port: QuickNotesSyncDbPort = {
    async listLocalQuickNotes(): Promise<QuickNoteSyncItem[]> {
      return [...notes.values()].filter((n) => !deleted.has(n.id)).map((n) => ({
        id: n.id, createdAt: n.createdAt, updatedAt: n.updatedAt,
        contentHash: n.contentHash, syncState: n.syncState, isConflict: n.isConflict, images: n.images,
      }));
    },
    async readContent(id) { return notes.get(id)?.content ?? null; },
    async readAsset(id, filename) { return assets.get(`${id}/${filename}`) ?? null; },
    async applyRemoteQuickNote(item, content, assetsIn) {
      if (sha256Sync(content) !== item.contentHash) throw new Error(`哈希不符: ${item.id}`);
      notes.set(item.id, {
        id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt,
        contentHash: item.contentHash, syncState: "synced", isConflict: item.isConflict, content,
        images: item.assets.map(({ id, filename, mimeType, width, height, size, hash }) => ({ id, filename, mimeType, width, height, size, hash })),
      });
      for (const a of assetsIn) assets.set(`${item.id}/${a.filename}`, a.bytes);
    },
    async applyTombstoneContent(id, content) {
      const n = notes.get(id); if (n) { n.content = content; n.contentHash = sha256Sync(content); }
    },
    async listDeletedQuickNoteAssets(id) {
      const n = notes.get(id);
      if (!n) return [];
      try {
        const parsed = JSON.parse(new TextDecoder().decode(n.content)) as { images: QuickNoteSyncItemImage[] };
        return parsed.images;
      } catch { return []; }
    },
    async applyTombstoneAssets(id, tombAssets) {
      for (const a of tombAssets) assets.set(`${id}/${a.metadata.filename}`, a.bytes);
    },
    async deleteLocalQuickNote(id) {
      if (!deleted.has(id)) {
        const n = notes.get(id);
        deleted.set(id, { id, createdAt: n?.createdAt ?? now(), updatedAt: n?.updatedAt ?? now(), deletedAt: now() });
      }
    },
    async archiveLocalQuickNoteToTrash(id) {
      const n = notes.get(id);
      if (n) {
        const newId = crypto.randomUUID();
        notes.set(newId, { ...n, id: newId, updatedAt: now(), syncState: "local" });
      }
    },
    async listDeletedQuickNotes() { return [...deleted.values()].filter((item) => !published.has(item.id)); },
    async markDeletedPublished(ids) { for (const id of ids) published.add(id); },
    async listAllDeletedQuickNotes() { return [...deleted.values()]; },
    async listDeferredDeletedQuickNotes() {
      deferredCalls += 1;
      // 第 1 次在下载阶段（有远端清单时）；第 2 次在上传阶段之后、写清单之前。
      // 真实端口这两次都是真实异步 DB 调用 ⇒ 在第 2 次挂起等价于"网络/DB 慢"，是真交错，不是改产品逻辑。
      if (deferredCalls === 2 && deferredGate) await deferredGate.wait();
      return [];
    },
    async rememberDeletedQuickNote(item) { if (!deleted.has(item.id)) deleted.set(item.id, { ...item }); },
    async revokeLocalDeletion(id) { deleted.delete(id); },
    async isRestorePending(id) { return restorePending.has(id); },
    async baseHash(id) { return bases.get(id) ?? null; },
    async setBaseHash(id, hash) { bases.set(id, hash); },
    async markSynced(id) { const n = notes.get(id); if (n) n.syncState = "synced"; },
    // I2 真语义：只有本地内容 hash 仍等于 expected（推送期间未被编辑）才标 synced。
    async markSyncedIfUnchanged(id, expected) {
      syncedCalls.push({ id, expected });
      const n = notes.get(id);
      if (n && n.contentHash === expected) n.syncState = "synced";
    },
    log() { /* 测试静音 */ },
  };
  return { port, notes, assets, bases, deleted, syncedCalls, armDeferredGate: (g) => { deferredGate = g; } };
}

function addNote(f: FakePort, id: string, text: string, images: QuickNoteSyncItemImage[] = [], assetData: Record<string, Uint8Array> = {}): FakeNote {
  const content = bytesOf(text);
  const note: FakeNote = { id, createdAt: FIXED_AT, updatedAt: FIXED_AT, contentHash: sha256Sync(content), syncState: "local", isConflict: false, images, content };
  f.notes.set(id, note);
  for (const [filename, bytes] of Object.entries(assetData)) f.assets.set(`${id}/${filename}`, bytes);
  return note;
}

function editLocal(f: FakePort, id: string, text: string): void {
  const n = f.notes.get(id)!;
  const content = bytesOf(text);
  n.content = content;
  n.contentHash = sha256Sync(content);
  n.updatedAt = "2026-10-13T00:00:01.000Z";
  n.syncState = "local";
}

function seedManifest(s3: FakeS3, items: ManifestItem[], commitId = "seed-commit"): QuickNotesManifest {
  const manifest: QuickNotesManifest = { version: 1, workspaceId: "default", commitId, createdAt: "2026-10-12T00:00:00.000Z", items };
  s3.bucket.set(manifestKey, bytesOf(JSON.stringify(manifest, null, 2)));
  return manifest;
}

const readManifest = (s3: FakeS3): QuickNotesManifest =>
  JSON.parse(new TextDecoder().decode(s3.bucket.get(manifestKey)!)) as QuickNotesManifest;

const manifestIds = (s3: FakeS3): string[] => readManifest(s3).items.map((i) => i.id);

const remoteItem = (id: string, contentHash: string, extra: Partial<ManifestItem> = {}): ManifestItem => ({
  id, createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
  contentHash, isConflict: false, assets: [], ...extra,
});

describe("小记「保存并同步」并发安全（真实引擎 × 真实单条推送）", () => {
  it("真交错：整轮同步读过本地快照、尚未写清单时并发推送 ⇒ 引擎落地旧快照覆盖该条；回核补回且其余条目逐字节不变", async () => {
    const p = createFakePort();
    const s3 = createFakeS3();

    const otherActive = remoteItem("note-other", sha256Sync(bytesOf("other")));
    const otherTomb = remoteItem("note-gone", "deadbeef", { deleted: true, deletedAt: "2026-10-10T00:00:00.000Z" });
    seedManifest(s3, [otherActive, otherTomb], "sync-start");
    s3.bucket.set(objectKey(otherActive.contentHash), bytesOf("other")); // 下载阶段需要正文对象（否则按 P1-1 跳过）

    const gate = createGate();
    p.armDeferredGate(gate); // 真实引擎第 2 次读 deferred 时挂起：已读本地快照、未写清单

    const engineRun = syncQuickNotesViaEngine(cfg, s3, p.port);
    await gate.reached;
    // 真交错前提：引擎已读过本地清单快照，且此刻本地还没有目标小记（用户刚记下 / 刚点同步）
    expect(p.notes.has(TARGET)).toBe(false);

    // ① 用户此刻记下目标小记并点「保存并同步」：真实 pushQuickNote 与在途引擎真正重叠
    addNote(p, TARGET, "fresh", [IMG], { [IMG.filename]: bytesOf("PIC!") });
    const pushed = await pushQuickNote(cfg, s3, p.port, TARGET);
    expect(pushed).toMatchObject({ status: "pushed", uploadedContent: true, uploadedAssets: 1 });
    expect(manifestIds(s3)).toEqual(["note-other", "note-gone", TARGET]);

    // 引擎此刻才用"它读到的旧本地快照"落地
    gate.release();
    await engineRun;

    // ② 覆盖确实发生：目标条目从清单里消失（其余条目含墓碑仍在）
    const landed = readManifest(s3);
    expect(landed.commitId).not.toBe("sync-start");
    expect(manifestIds(s3)).toEqual(["note-other", "note-gone"]);
    expect(landed.items.find((i) => i.id === "note-gone")?.deleted).toBe(true);

    // ③ 回核 = 再调一次真实 pushQuickNote（幂等）：目标条目回到清单
    const repaired = await pushQuickNote(cfg, s3, p.port, TARGET);
    expect(repaired.status).toBe("pushed");
    const after = readManifest(s3);
    expect(after.items.find((i) => i.id === TARGET)?.contentHash).toBe(sha256Sync(bytesOf("fresh")));
    // 其余条目**逐字节不变**：以引擎落地的那份为准，回核只 upsert 目标这一条
    expect(JSON.stringify(after.items.filter((i) => i.id !== TARGET))).toBe(JSON.stringify(landed.items));
    // 正文 / 图片对象都在（回核后其他端能拉到完整这一条）
    expect(s3.bucket.get(objectKey(sha256Sync(bytesOf("fresh"))))).toEqual(bytesOf("fresh"));
    expect(s3.bucket.get(assetKey(TARGET, IMG.filename))).toEqual(bytesOf("PIC!"));
    expect(after.items[after.items.length - 1]?.id).toBe(TARGET);
  });

  it("真交错 I2：推送网络窗口内又被编辑 ⇒ 守卫不标 synced、本地新内容不丢、下轮按新 hash 重传", async () => {
    const p = createFakePort();
    const s3 = createFakeS3();
    const v1 = bytesOf("v1");
    seedManifest(s3, [remoteItem("note-a", sha256Sync(v1))]);
    s3.bucket.set(objectKey(sha256Sync(v1)), v1);
    addNote(p, "note-a", "v2"); // 本地已改成 v2，等待推送
    const v2hash = sha256Sync(bytesOf("v2"));

    const gate = createGate();
    s3.armManifestPutGate(gate); // 把真实 push 停在"写清单"= 推送网络窗口内
    const pushRun = pushQuickNote(cfg, s3, p.port, "note-a");
    await gate.reached;

    editLocal(p, "note-a", "v3"); // 推送在途时用户又编辑
    const v3hash = sha256Sync(bytesOf("v3"));
    gate.release();
    const outcome = await pushRun;

    expect(outcome.status).toBe("pushed");
    // 云端只拿到推送时快照 v2
    expect(readManifest(s3).items.find((i) => i.id === "note-a")?.contentHash).toBe(v2hash);
    // I2：expected = v2，但本地已是 v3 ⇒ markSyncedIfUnchanged 不得把新内容标成已同步
    expect(p.syncedCalls).toEqual([{ id: "note-a", expected: v2hash }]);
    expect(p.notes.get("note-a")?.syncState).toBe("local");
    expect(p.notes.get("note-a")?.contentHash).toBe(v3hash); // 新内容没丢
    // 记账的是已推送的 v2：下轮整轮同步按 v2→v3 重传
    expect(p.bases.get("note-a")).toBe(v2hash);
  });

  it("（可选）接线护栏：桌面 / 移动都在推送成功后把幂等回核排在维护域队尾", () => {
    const repoRoot = process.cwd();
    const mobile = readFileSync(path.join(repoRoot, "src/mobile/bridge.ts"), "utf8");
    const desktop = readFileSync(path.join(repoRoot, "electron/ipc/registerQuickNotes.ts"), "utf8");

    // 移动端：syncQuickNote 成功后调 scheduleQuickNoteVerify；后者取 maintenance 锁再重推
    expect(mobile).toContain('if (outcome.status === "pushed") scheduleQuickNoteVerify(id);');
    const verifyFn = mobile.slice(mobile.indexOf("function scheduleQuickNoteVerify"));
    expect(verifyFn).toContain('maintenanceQueue.run("maintenance"');
    expect(verifyFn).toContain("pushSingleQuickNote(id)");

    // 桌面端：sync_quick_note 成功后 enqueueMaintenance 重推
    const handler = desktop.slice(desktop.indexOf('ipc.handle("sync_quick_note"'));
    expect(handler).toContain('if (outcome.status === "pushed")');
    expect(handler).toContain("enqueueMaintenance(");
    expect(handler).toContain("pushQuickNoteToS3(quickNotes, latest, id)");
  });
});
