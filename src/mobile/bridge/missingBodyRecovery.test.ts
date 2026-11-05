/**
 * 缺正文「从云端拉回」的桥级行为（261104 B-lite）。
 *
 * 这里盖的是**最容易被写坏、又最难在设备上复现**的一段：单篇 pointer → 索引 → 内容寻址正文对象，
 * 校验 sha256 后落盘。远端用内存对象替身注入（真机验收由 lead 在集成后做；本文件是 mock 级验证）。
 * 三条不变量：
 *  ① 只读单篇，绝不整库 restoreFromCloud（不清本机同步账本）；
 *  ② 校验不通过**一个字节都不写**（正文仍缺失，行不变）；
 *  ③ 恢复成功后这篇能正常打开（readNote / readQuickNote 不再返回 null）。
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));
// 桥测试的标准替身：生产 MobileDb 形状，底层仍是 sql.js（与 bridgeTree.test 同口径）。
vi.mock("../native/nativeSqliteDb.js", async () =>
  (await import("../native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

/** pointer.epoch 必须符合 S3V3_EPOCH_RE（UUID），否则 validatePointer 直接判 not-in-cloud。 */
const POINTER_EPOCH = "11111111-1111-4111-8111-111111111111";

/** 云端对象替身：key → bytes（只实现本用例需要的 get）。 */
const remoteObjects = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../v3/s3v3Remote.js", () => ({
  createMobileS3v3Remote: () => ({
    get: async (key: string) => remoteObjects.get(key) ?? null,
    put: async () => {},
    list: async () => [],
    deleteMany: async () => {},
    deleteByPrefix: async () => 0,
  }),
}));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  listQuickNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
  removeQuickNoteAssetsDirFs: vi.fn(async () => {}),
}));
vi.mock("../native/secretStore.js", () => ({
  mobileSecretStore: {
    read: vi.fn(async (key: string) => (key === "s3.secretAccessKey" ? "secret-key" : null)),
    write: vi.fn(async () => {}),
  },
}));

import { bridge } from "../bridge";
import { getBodyStore } from "../native/bodyStore";
import { noteBodyRelativePath, quickNoteBodyRelativePath } from "../../core/noteBodyPaths.js";
import { sha256Hex } from "../../core/syncUtils.js";
import { S3V3_POINTER_VERSION } from "../../core/s3v3/protocol/s3v3Types.js";
import { S3V3_POINTER_KEY, indexKey, lakeBodyKey, quickNoteBodyKey } from "../../core/s3v3/protocol/s3v3Keys.js";
import {
  S3V3_INDEX_VERSION,
  indexHashOf,
  serializeLakeIndex,
  serializeQuickNotesIndex,
} from "../../core/s3v3/protocol/s3v3Index.js";
import { serializeQuickNoteContent } from "../../core/quickNoteModel.js";
import { EMPTY_MOBILE_V3_STATE, saveV3State } from "../data/v3StateRepository.js";
import { db as bridgeDb } from "./context";

const S3_KEY = "lakex-local-notes-mobile.s3";
const SYNC_KEY = "lakex-local-notes-mobile.sync";

/** node 环境没有 localStorage：给一个最小实现（context 的读取全在调用时，不依赖 import 顺序）。 */
function installLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  });
}

/** 配好 S3（key 存在 ⇒ 云同步开关默认开启；autoMode=manual ⇒ 允许出网）。 */
function seedS3Settings(): void {
  localStorage.setItem(S3_KEY, JSON.stringify({
    endpoint: "https://s3.example.com",
    region: "cn-east-1",
    bucket: "bucket",
    prefix: "lakex-local-notes",
    accessKeyId: "ak",
  }));
  localStorage.setItem(SYNC_KEY, JSON.stringify({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15 }));
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 造「上轮同步过这些 id」的 v3 基线（hasSyncBase 的唯一事实来源）。
 * 没有它 ⇒ 清单只会给「仅历史 / 无备份」，不会给「从云端拉回」。
 */
async function seedSyncedBaseline(opts: { docs?: string[]; quickNotes?: string[] } = {}): Promise<void> {
  const commit = "d".repeat(64);
  await saveV3State(bridgeDb!, {
    ...EMPTY_MOBILE_V3_STATE,
    baseline: {
      epoch: POINTER_EPOCH, generation: 4, lakeCommit: commit, quickNotesCommit: commit,
      lake: {
        v: S3V3_INDEX_VERSION, space: "lake", folders: [],
        notes: (opts.docs ?? []).map((id) => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: "2026-11-01T00:00:00.000Z", contentHash: commit })),
      },
      quickNotes: {
        v: S3V3_INDEX_VERSION, space: "quickNotes", tags: [],
        items: (opts.quickNotes ?? []).map((id) => ({ id, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", contentHash: commit })),
      },
    },
  });
}

/** 造 pointer + lake 索引 + 一篇正文对象；返回 index 里实际写入的 contentHash。 */
function seedCloudDoc(id: string, title: string, content: string, overrideHash?: string): string {
  const realHash = sha256Hex(utf8(content));
  const index = {
    v: S3V3_INDEX_VERSION, space: "lake" as const,
    notes: [{ id, title, parentId: null, sortOrder: 0, updatedAt: "2026-11-01T00:00:00.000Z", contentHash: realHash }],
    folders: [],
  };
  const serialized = serializeLakeIndex(index);
  const commit = indexHashOf(serialized);
  remoteObjects.set(indexKey("lake", commit), utf8(serialized));
  remoteObjects.set(lakeBodyKey(id, realHash), utf8(content));
  // overrideHash：索引声明 hash=X，但对象字节的真实 sha256≠X ⇒ 校验失败路径（对象在、内容不可信）。
  if (overrideHash) {
    index.notes[0].contentHash = overrideHash;
    remoteObjects.set(lakeBodyKey(id, overrideHash), utf8(content));
    const badSerialized = serializeLakeIndex(index);
    const badCommit = indexHashOf(badSerialized);
    remoteObjects.set(indexKey("lake", badCommit), utf8(badSerialized));
    remoteObjects.set(S3V3_POINTER_KEY, utf8(JSON.stringify({
      v: S3V3_POINTER_VERSION, epoch: POINTER_EPOCH, generation: 2,
      lake: { commit: badCommit }, quickNotes: { commit: "0".repeat(64) },
      createdAt: "2026-11-01T00:00:00.000Z",
    })));
  } else {
    remoteObjects.set(S3V3_POINTER_KEY, utf8(JSON.stringify({
      v: S3V3_POINTER_VERSION, epoch: POINTER_EPOCH, generation: 1,
      lake: { commit }, quickNotes: { commit: "0".repeat(64) },
      createdAt: "2026-11-01T00:00:00.000Z",
    })));
  }
  return realHash;
}

function seedCloudQuickNote(id: string, content: { text: string; body: string }): string {
  const serialized = serializeQuickNoteContent({
    version: 3, text: content.text, body: content.body, images: [],
  });
  const hash = sha256Hex(utf8(serialized));
  const index = {
    v: S3V3_INDEX_VERSION, space: "quickNotes" as const, tags: [],
    items: [{ id, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", contentHash: hash }],
  };
  const serializedIndex = serializeQuickNotesIndex(index);
  const commit = indexHashOf(serializedIndex);
  remoteObjects.set(indexKey("quickNotes", commit), utf8(serializedIndex));
  remoteObjects.set(quickNoteBodyKey(hash), utf8(serialized));
  remoteObjects.set(S3V3_POINTER_KEY, utf8(JSON.stringify({
    v: S3V3_POINTER_VERSION, epoch: POINTER_EPOCH, generation: 1,
    lake: { commit: "0".repeat(64) }, quickNotes: { commit },
    createdAt: "2026-11-01T00:00:00.000Z",
  })));
  return hash;
}

beforeEach(() => {
  vi.clearAllMocks();
  remoteObjects.clear();
  installLocalStorage();
  seedS3Settings();
});

describe("缺正文：单篇云端拉回（桥级 mock 远端）", () => {
  it("文档：pointer→索引→正文对象→sha256 校验→写回并标 synced，这篇随后能打开", async () => {
    const id = "missing-doc-1";
    await bridge.saveNote(id, "缺正文的文档", "<p>本地旧正文</p>", null);
    await getBodyStore().remove(noteBodyRelativePath("doc", id));
    const restored = "<p>云端恢复的正文</p>";
    seedCloudDoc(id, "缺正文的文档（云端标题）", restored);
    await seedSyncedBaseline({ docs: [id] });

    // 先确认清单把它判成「可云恢复」
    const snapshot = await bridge.listMissingBodies();
    expect(snapshot.cloudConfigured).toBe(true);
    expect(snapshot.docs.map((d) => d.id)).toEqual([id]);
    expect(snapshot.docs[0].recovery).toBe("cloud");

    const result = await bridge.restoreMissingNoteBody(id);
    expect(result).toEqual({ ok: true, title: "缺正文的文档（云端标题）" });
    expect(await getBodyStore().readText(noteBodyRelativePath("doc", id))).toBe(restored);
    expect((await bridge.readNote(id))!.content).toBe(restored);
    // 清单里不再出现（正文回来了）
    expect((await bridge.listMissingBodies()).docs).toEqual([]);
  });

  it("文档：sha256 不一致时明确回报 hash-mismatch，且一个字节都不写", async () => {
    const id = "missing-doc-2";
    await bridge.saveNote(id, "坏 hash 的文档", "<p>本地旧正文</p>", null);
    await getBodyStore().remove(noteBodyRelativePath("doc", id));
    seedCloudDoc(id, "坏 hash 的文档", "<p>云端正文</p>", "f".repeat(64));

    const result = await bridge.restoreMissingNoteBody(id);
    expect(result).toEqual({ ok: false, reason: "hash-mismatch" });
    expect(await getBodyStore().readText(noteBodyRelativePath("doc", id))).toBeNull();
    // 清单仍在，用户可换路径（历史/删除）。
    // 注：本文件测试间共享 DB 单例、而正文后端每个用例前会被清空 ⇒ 先前用例的行也会显示缺正文，
    // 断言只看本用例那条（真实 App 里没有这种跨用例串味）。
    expect((await bridge.listMissingBodies()).docs.map((d) => d.id)).toContain(id);
  });

  it("云端没有这篇时回报 not-in-cloud（不静默、不写空正文）", async () => {
    const id = "missing-doc-3";
    await bridge.saveNote(id, "云端已删的文档", "<p>本地旧正文</p>", null);
    await getBodyStore().remove(noteBodyRelativePath("doc", id));
    seedCloudDoc("other-doc", "别的文档", "<p>x</p>");

    const result = await bridge.restoreMissingNoteBody(id);
    expect(result).toEqual({ ok: false, reason: "not-in-cloud" });
    expect(await getBodyStore().readText(noteBodyRelativePath("doc", id))).toBeNull();
  });

  it("小记：云端镜像按 contentHash 校验后落盘，写作卡能重新读到内容", async () => {
    const id = await bridge.createQuickNote("本地旧小记");
    await getBodyStore().remove(quickNoteBodyRelativePath(id));
    seedCloudQuickNote(id, { text: "云端小记正文", body: "<p>云端小记正文</p>" });
    await seedSyncedBaseline({ quickNotes: [id] });

    const missingOf = async (): Promise<string[]> =>
      (await bridge.listMissingBodies()).quickNotes.map((q) => q.id).filter((qid) => qid === id);
    // （断言处必须 await；见下）
    // 注：本文件用内存正文后端且测试间共享 DB 单例 ⇒ 首启的「欢迎小记」在后续用例里也会显示为缺正文，
    // 与真实 App 无关（真实环境它一直有正文）。断言只看本用例造的那条。
    const snapshot = await bridge.listMissingBodies();
    expect(await missingOf()).toEqual([id]);
    expect(snapshot.quickNotes.find((q) => q.id === id)!.recovery).toBe("cloud");

    expect(await bridge.restoreMissingQuickNoteFromCloud(id)).toEqual({ ok: true });
    const read = await bridge.readQuickNote(id);
    expect(read?.content.text).toBe("云端小记正文");
    expect(await missingOf()).toEqual([]);
  });

  it("小记：用搜索缓存重建纯文本（标 local 待上传），写作卡能打开", async () => {
    const id = await bridge.createQuickNote("原标题");
    await getBodyStore().remove(quickNoteBodyRelativePath(id));
    const { db } = await import("./context");
    await db!.prepare(
      "INSERT OR REPLACE INTO quick_notes_search_index (quick_note_id, fts_rowid, content_hash, text_cache, tags, indexed_at) VALUES (?,?,?,?,?,?)",
    ).run(id, 99, "c".repeat(64), "缓存里的全文", "", "2026-11-01T00:00:00.000Z");

    const snapshot = await bridge.listMissingBodies();
    expect(snapshot.quickNotes[0].recovery).toBe("text");
    expect(snapshot.quickNotes[0].hasTextCache).toBe(true);

    expect(await bridge.recoverMissingQuickNoteFromText(id)).toEqual({ ok: true });
    expect((await bridge.readQuickNote(id))?.content.text).toBe("缓存里的全文");
    const row = await db!.prepare("SELECT is_dirty FROM quick_notes WHERE id=?").get(id) as { is_dirty: number };
    expect(row.is_dirty).toBe(1);
  });
});