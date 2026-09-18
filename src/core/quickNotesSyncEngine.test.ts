/**
 * 共享小记同步引擎独立测试（P2-1，GPT 审计）：
 * - 内存假 QuickNotesSyncDbPort + 内存 S3Store，不依赖任何平台适配器；
 * - 覆盖：空桶首次/下载/上传/冲突归档/墓碑/恢复 LWW/远端对象缺失保留（P1-1）/
 *   清单与正文大小护栏；
 * - 桌面 adapter 行为由 electron/quickNotesSync.test.ts 兜底，移动端口由
 *   src/mobile/quickNotesDbPort.test.ts 兜底，本文件聚焦引擎自身分支。
 */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import type { S3Store, SyncConfig } from "./syncEngine.js";
import { syncQuickNotesViaEngine, parseManifest, MAX_QUICK_MANIFEST_BYTES, MAX_QUICK_MANIFEST_ITEMS, MAX_QUICK_NOTE_BYTES, type QuickNoteSyncItem, type QuickNoteSyncItemImage, type QuickNotesSyncDbPort } from "./quickNotesSyncEngine.js";
import { serializeQuickNoteContent, normalizeQuickNoteContent } from "./quickNoteModel.js";
import { sha256Sync } from "./sha256Sync.js";

const cfg: SyncConfig = { endpoint: "https://s3.test", region: "test", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "lake" };

function createFakeS3(): S3Store & { bucket: Map<string, Uint8Array> } {
  const bucket = new Map<string, Uint8Array>();
  return {
    bucket,
    async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
      const bytes = bucket.get(key);
      if (!bytes) return null;
      if (opts?.maxBytes && bytes.length > opts.maxBytes) throw new Error(`对象超限: ${key}`);
      return bytes;
    },
    async putObject(key: string, body: string | Uint8Array): Promise<void> {
      bucket.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    },
  };
}

interface FakeNote {
  id: string; createdAt: string; updatedAt: string; contentHash: string;
  syncState: string; isConflict: boolean; images: QuickNoteSyncItem["images"];
  content: Uint8Array;
}

/** 内存假端口：语义对齐 QuickNotesSyncDbPort 契约（软删保留内容、归档不进墓碑列表）。
 * deleted = 全部墓碑记录（对齐 quick_note_deleted 表，发布后保留）；published = 已发布记账集合。 */
function createFakePort(): { port: QuickNotesSyncDbPort; notes: Map<string, FakeNote>; assets: Map<string, Uint8Array>; deleted: Map<string, { id: string; createdAt: string; updatedAt: string; deletedAt: string }>; bases: Map<string, string>; restorePending: Set<string>; archived: Map<string, FakeNote>; publishedDeleted: string[] } {
  const notes = new Map<string, FakeNote>();
  const assets = new Map<string, Uint8Array>();
  const deleted = new Map<string, { id: string; createdAt: string; updatedAt: string; deletedAt: string }>();
  const bases = new Map<string, string>();
  const restorePending = new Set<string>();
  const archived = new Map<string, FakeNote>();
  const publishedDeleted: string[] = [];
  const publishedSet = new Set<string>();
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
        const copy = { ...n, id: newId, createdAt: n.createdAt, updatedAt: now(), syncState: "local" };
        archived.set(newId, copy);
        notes.set(newId, copy);
      }
    },
    async listDeletedQuickNotes() {
      // 对齐真实口径：ready（未发布）的墓碑才可发布；已发布（published 记账）不再返回
      return [...deleted.values()].filter((item) => !publishedSet.has(item.id));
    },
    // 对齐真实语义：发布 = 写 published 记账（记录保留在 deleted，下载 LWW 仍可见）
    async markDeletedPublished(ids) { for (const id of ids) { publishedSet.add(id); publishedDeleted.push(id); } },
    async listAllDeletedQuickNotes() { return [...deleted.values()]; },
    async listDeferredDeletedQuickNotes() { return []; },
    async rememberDeletedQuickNote(item) { if (!deleted.has(item.id)) deleted.set(item.id, { ...item }); },
    async revokeLocalDeletion(id) { deleted.delete(id); },
    async isRestorePending(id) { return restorePending.has(id); },
    async baseHash(id) { return bases.get(id) ?? null; },
    async setBaseHash(id, hash) { bases.set(id, hash); },
    async markSynced(id) { const n = notes.get(id); if (n) n.syncState = "synced"; restorePending.delete(id); },
    async log() { /* noop */ },
  };
  return { port, notes, assets, deleted, bases, restorePending, archived, publishedDeleted };
}

function promisifyPort(port: QuickNotesSyncDbPort): QuickNotesSyncDbPort {
  return new Proxy(port, {
    get(target, property, receiver) {
      if (property === "log") return Reflect.get(target, property, receiver);
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) =>
        await (value as (...args: unknown[]) => unknown).apply(target, args);
    },
  }) as QuickNotesSyncDbPort;
}

function makeContent(text: string): { serialized: string; hash: string } {
  const serialized = serializeQuickNoteContent(normalizeQuickNoteContent(text, "<p><br></p>", []));
  return { serialized, hash: sha256Sync(new TextEncoder().encode(serialized)) };
}

function createLocal(port: ReturnType<typeof createFakePort>, text: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { serialized, hash } = makeContent(text);
  port.notes.set(id, { id, createdAt: now, updatedAt: now, contentHash: hash, syncState: "local", isConflict: false, images: [], content: new TextEncoder().encode(serialized) });
  return id;
}

function editLocal(port: ReturnType<typeof createFakePort>, id: string, text: string): void {
  const n = port.notes.get(id)!;
  const { serialized, hash } = makeContent(text);
  n.content = new TextEncoder().encode(serialized);
  n.contentHash = hash;
  n.updatedAt = new Date().toISOString();
  n.syncState = "local";
}

function readManifest(s3: ReturnType<typeof createFakeS3>): { items: Array<{ id: string; contentHash: string; updatedAt: string; deleted?: boolean; assets?: Array<{ id: string; filename: string; mimeType: string; width: number | null; height: number | null; size: number; hash: string }> }> } {
  const bytes = s3.bucket.get("lake/quick-notes/manifests/latest.json");
  if (!bytes) throw new Error("manifest missing");
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("quickNotesSyncEngine（共享引擎独立测试）", () => {
  it("空桶首次同步：上传本地小记 + 正文对象 + manifest", async () => {
    const p = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(p, "第一条");
    const r = await syncQuickNotesViaEngine(cfg, s3, p.port);
    expect(r.uploaded).toBe(1);
    const m = readManifest(s3);
    expect(m.items).toHaveLength(1);
    expect(m.items[0].id).toBe(id);
    expect(s3.bucket.has(`lake/quick-notes/objects/${p.notes.get(id)!.contentHash}.qnote`)).toBe(true);
    expect(p.notes.get(id)!.syncState).toBe("synced");
  });

  it("远端 active 下载：B 拉取 A 发布的小记", async () => {
    const a = createFakePort();
    const b = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "共享小记");
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    expect(b.notes.get(id)?.syncState).toBe("synced");
  });

  it("接受全异步存储端口：Promise 返回值与同步返回值语义一致", async () => {
    const a = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "异步端口");

    const result = await syncQuickNotesViaEngine(cfg, s3, promisifyPort(a.port));

    expect(result.uploaded).toBe(1);
    expect(readManifest(s3).items[0]?.id).toBe(id);
    expect(a.notes.get(id)?.syncState).toBe("synced");
  });

  it("本地编辑上传：新 hash 对象 + manifest 更新", async () => {
    const a = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "v1");
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    editLocal(a, id, "v2 编辑");
    const r = await syncQuickNotesViaEngine(cfg, s3, a.port);
    expect(r.uploaded).toBe(1);
    expect(readManifest(s3).items[0].contentHash).toBe(a.notes.get(id)!.contentHash);
  });

  it("双端冲突：远端覆盖本地，本地版本归档（新 id），不重复冲突", async () => {
    const a = createFakePort();
    const b = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(b, "v1");
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    editLocal(a, id, "A 编辑");
    editLocal(b, id, "B 编辑");
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    const r = await syncQuickNotesViaEngine(cfg, s3, a.port);
    expect(r.conflicts).toBe(1);
    // A 现在持有 B 版；本地 A 版归档为新 id
    expect(new TextDecoder().decode(a.notes.get(id)!.content)).toContain("B 编辑");
    expect(a.archived.size).toBe(1);
    expect(a.archived.values().next().value!.id).not.toBe(id);
    // 归档 id 不进墓碑列表（ready_to_sync=0 语义），不发布幽灵墓碑
    expect(readManifest(s3).items.some((i) => i.id === [...a.archived.keys()][0] && i.deleted)).toBe(false);
    const r2 = await syncQuickNotesViaEngine(cfg, s3, a.port);
    expect(r2.conflicts).toBe(0);
    expect(r2.uploaded).toBe(0);
  });

  it("墓碑跨端：A 删除 → manifest deleted + 正文对象；B 跟随删除", async () => {
    const a = createFakePort();
    const b = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "会被删");
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    await a.port.deleteLocalQuickNote(id);
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    const m = readManifest(s3);
    console.log("DBG A manifest:", JSON.stringify(m.items.map((i) => ({ id: i.id.slice(0, 8), deleted: !!i.deleted }))), "A.deleted:", JSON.stringify([...a.deleted.keys()]), "A.published:", JSON.stringify(a.publishedDeleted));
    expect(m.items.find((i) => i.id === id)?.deleted).toBe(true);
    // 墓碑携带删除前内容（真实 hash + 对象）
    expect(s3.bucket.has(`lake/quick-notes/objects/${a.notes.get(id)!.contentHash}.qnote`)).toBe(true);
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    console.log("DBG B deleted:", JSON.stringify([...b.deleted.keys()]), "B.notes:", JSON.stringify([...b.notes.keys()]));
    expect(b.deleted.has(id)).toBe(true);
    const localAfterTombstone = await b.port.listLocalQuickNotes();
    expect(localAfterTombstone.some((i) => i.id === id)).toBe(false);
  });

  it("墓碑发布后清除待同步标记（markDeletedPublished）且不再重复发布", async () => {
    const a = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "发布后清标记");
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    await a.port.deleteLocalQuickNote(id);
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    // 发布即标记：待同步集合清空（否则 getPendingSyncSummary 永远计入 → "待同步"常挂）
    expect(a.publishedDeleted).toEqual([id]);
    // 二次同步：墓碑已清标记，不再进入发布列表、不再出现在新 manifest 循环
    const before = a.publishedDeleted.length;
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    expect(a.publishedDeleted.length).toBe(before);
  });

  it("墓碑携带图片（A）：带图小记删除 → 墓碑带 assets + 图片对象上传；B 收到墓碑后软删行有图片可恢复", async () => {
    const a = createFakePort();
    const b = createFakePort();
    const s3 = createFakeS3();
    // A 创建带图小记并同步（图片对象在云端）
    const id = createLocal(a, "带图小记");
    const imgBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const img = { id: "img-1", filename: "a.png", mimeType: "image/png", width: 4, height: 4, size: imgBytes.length, hash: sha256Sync(imgBytes) };
    const serialized = serializeQuickNoteContent(normalizeQuickNoteContent("带图小记", "<p><br></p>", [img]));
    const hash = sha256Sync(new TextEncoder().encode(serialized));
    const n = a.notes.get(id)!;
    n.content = new TextEncoder().encode(serialized);
    n.contentHash = hash;
    n.images = [img];
    a.assets.set(`${id}/${img.filename}`, imgBytes);
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    // B 同步拿到带图小记
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    expect(b.assets.has(`${id}/${img.filename}`)).toBe(true);
    // A 删除（未先同步图片变更——图片已在云端，此场景验证删除携带 assets）并同步
    await a.port.deleteLocalQuickNote(id);
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    const m = readManifest(s3);
    const tomb = m.items.find((i) => i.id === id)!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.assets?.length).toBe(1); // 墓碑条目带 assets
    expect(tomb.assets![0].filename).toBe("a.png");
    expect(s3.bucket.has(`lake/quick-notes/assets/${id}/a.png`)).toBe(true);
    // B 收到墓碑：软删 + 图片字节落地（applyTombstoneAssets）→ 恢复时图片完整
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    expect(b.deleted.has(id)).toBe(true);
    expect(b.assets.get(`${id}/${img.filename}`)).toEqual(imgBytes);
  });

  it("恢复 LWW：B 恢复（restore_pending）→ active 覆盖墓碑；A 跟随恢复且本地墓碑撤销", async () => {
    const a = createFakePort();
    const b = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "原始");
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    await a.port.deleteLocalQuickNote(id);
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    await syncQuickNotesViaEngine(cfg, s3, b.port); // B 学到删除
    // B 恢复：清墓碑 + restore_pending + local
    b.deleted.delete(id);
    b.restorePending.add(id);
    const n = b.notes.get(id)!;
    n.syncState = "local";
    n.updatedAt = new Date(Date.now() + 5000).toISOString();
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    expect(readManifest(s3).items.find((i) => i.id === id)?.deleted).not.toBe(true);
    expect(b.restorePending.has(id)).toBe(false); // markSynced 清除恢复标记
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    expect(a.deleted.has(id)).toBe(false); // 本地墓碑撤销
    expect(a.notes.has(id)).toBe(true); // 跟随恢复
  });

  it("P1-1：远端正文对象缺失 → manifest 保留条目（临时缺失不升级为删除）", async () => {
    const a = createFakePort();
    const b = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "对象会丢");
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    // 模拟云端正文对象丢失
    const contentHash = a.notes.get(id)!.contentHash;
    s3.bucket.delete(`lake/quick-notes/objects/${contentHash}.qnote`);
    // B 同步：下载阶段跳过（正文缺失），B 不持有该小记
    await syncQuickNotesViaEngine(cfg, s3, b.port);
    expect(b.notes.has(id)).toBe(false);
    // 发布阶段必须保留远端条目：manifest 仍包含 A（下轮重试下载），不是被删除
    const m = readManifest(s3);
    const entry = m.items.find((i) => i.id === id);
    expect(entry).toBeTruthy();
    expect(entry!.deleted).not.toBe(true);
    expect(entry!.contentHash).toBe(contentHash);
  });

  it("purge 语义：行删除后墓碑记录仍在 → 引擎继续发布 deleted（占位符 hash）", async () => {
    const a = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(a, "将被 purge");
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    // 模拟 purge：软删 → 硬删行（保留墓碑记录，内容已删）
    await a.port.deleteLocalQuickNote(id);
    const deletedRec = a.deleted.get(id)!;
    a.notes.delete(id);
    await syncQuickNotesViaEngine(cfg, s3, a.port);
    const m = readManifest(s3);
    const tomb = m.items.find((i) => i.id === id)!;
    expect(tomb.deleted).toBe(true);
    // 内容已删 → 占位符 hash（id 本身）
    expect(tomb.contentHash).toBe(id);
  });

  it("parseManifest 护栏：字节/条目上限", () => {
    const valid = (items: Array<Record<string, unknown>>) => JSON.stringify({ version: 1, workspaceId: "default", commitId: "c1", createdAt: "2026-01-01T00:00:00.000Z", items });
    expect(parseManifest(new TextEncoder().encode(valid([]))).items.length).toBe(0);
    expect(() => parseManifest(new TextEncoder().encode(valid([])), { maxBytes: 10 })).toThrow(/清单过大/);
    expect(() => parseManifest(new TextEncoder().encode(valid([{}, {}, {}])), { maxItems: 2 })).toThrow(/条目过多/);
    const item = {
      id: "duplicate-id", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      contentHash: "a".repeat(64), isConflict: false, assets: [],
    };
    expect(() => parseManifest(new TextEncoder().encode(valid([item, { ...item }])))).toThrow(/重复/);
    // 默认上限常量存在且合理
    expect(MAX_QUICK_MANIFEST_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_QUICK_MANIFEST_ITEMS).toBe(100_000);
  });

  it("正文对象大小护栏：超过 64MB 的远端对象被拒", async () => {
    const p = createFakePort();
    const s3 = createFakeS3();
    const id = createLocal(p, "x");
    await syncQuickNotesViaEngine(cfg, s3, p.port);
    // 篡改云端对象为超大字节（伪造 hash 也改掉，让校验走到 getObject maxBytes 先拒）
    const fakeHash = "a".repeat(64);
    s3.bucket.set(`lake/quick-notes/objects/${fakeHash}.qnote`, new Uint8Array(MAX_QUICK_NOTE_BYTES + 1024));
    // 远端 manifest 指向该超大对象 → 下载阶段 getObject maxBytes 抛错
    const m = readManifest(s3);
    m.items[0].contentHash = fakeHash;
    s3.bucket.set("lake/quick-notes/manifests/latest.json", new TextEncoder().encode(JSON.stringify(m)));
    await expect(syncQuickNotesViaEngine(cfg, s3, p.port)).rejects.toThrow(/超限|过大/);
  });
});
