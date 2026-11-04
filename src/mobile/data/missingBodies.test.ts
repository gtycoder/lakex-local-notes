import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sql.js 需要定位 wasm（与 sqliteDb.test.ts 同口径）。
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));
// 真实行为测试不触达文件系统：资源端口最小替身（孤儿扫描会用到）。
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  statNoteAssetSizesFs: vi.fn(async () => null),
  removeAssetBytesFs: vi.fn(async () => {}),
  listQuickNoteAssetKeysFs: vi.fn(async () => []),
  removeQuickNoteAssetsDirFs: vi.fn(async () => {}),
}));

import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { EMPTY_MOBILE_V3_STATE, ensureV3StateTable, saveV3State } from "./v3StateRepository.js";
import { createNote, readNote } from "./noteRepository.js";
import { readQuickNote, saveQuickNote } from "./quickNotesRepository.js";
import { getBodyStore, resetMemoryBodyStore } from "../native/bodyStore.js";
import { noteBodyRelativePath, quickNoteBodyRelativePath } from "../../core/noteBodyPaths.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import {
  MISSING_SCAN_BATCH,
  applyRestoredNoteBody,
  applyRestoredQuickNote,
  chunk,
  groupMissingDocs,
  groupMissingQuickNotes,
  missingIdsByStats,
  rebuildQuickNoteContentFromText,
  restoredBodyMatchesHash,
  scanMissingNoteBodies,
  scanMissingQuickNotes,
  type MissingNoteBody,
  type MissingQuickNote,
} from "./missingBodies.js";
import {
  MISSING_DOC_OPEN_HINT,
  MISSING_QUICK_NOTE_OPEN_HINT,
  claimMissingBodyNotice,
  docRecoveryLabel,
  missingRecoveryFailureText,
  quickNoteRecoveryLabel,
} from "./missingBodyMessages.js";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  await ensureV3StateTable(db);
  return db;
}

/** 模拟「用户手动删掉正文文件」。 */
async function removeDocBody(id: string, kind: "doc" = "doc"): Promise<void> {
  await getBodyStore().remove(noteBodyRelativePath(kind, id));
}

async function removeQuickNoteBody(id: string): Promise<void> {
  await getBodyStore().remove(quickNoteBodyRelativePath(id));
}

const DOC_HASH = "a".repeat(64);
const QN_HASH = "b".repeat(64);

/** 造一份「上轮同步过 n1 / q1」的 v3 基线（hasSyncBase 的唯一事实来源）。 */
async function seedSyncedBaseline(db: SqlJsAsyncDb, opts: { docs?: string[]; quickNotes?: string[] } = {}) {
  await saveV3State(db, {
    ...EMPTY_MOBILE_V3_STATE,
    baseline: {
      epoch: "e1",
      generation: 3,
      lakeCommit: DOC_HASH,
      quickNotesCommit: QN_HASH,
      lake: {
        v: 3, space: "lake", folders: [],
        notes: (opts.docs ?? []).map((id) => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: "2026-11-01T00:00:00.000Z", contentHash: DOC_HASH })),
      },
      quickNotes: {
        v: 3, space: "quickNotes", tags: [],
        items: (opts.quickNotes ?? []).map((id) => ({ id, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", contentHash: QN_HASH })),
      },
    },
  });
}

beforeEach(() => {
  resetMemoryBodyStore();
});

describe("缺正文判据（纯函数）", () => {
  it("chunk 按片切且保持顺序；空输入返回空", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], MISSING_SCAN_BATCH)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  it("missingIdsByStats 与 stat 结果对齐：只挑文件缺失的", () => {
    const ids = ["a", "b", "c"];
    const stats = [{ exists: true }, { exists: false }, { exists: false }];
    expect(missingIdsByStats(ids, stats)).toEqual(["b", "c"]);
    expect(missingIdsByStats(ids, [])).toEqual([]);
  });

  it("分组按可恢复路径分开（文档 cloud/history/none，小记 cloud/text/none）", () => {
    const doc = (id: string, recovery: MissingNoteBody["recovery"]): MissingNoteBody => ({
      id, title: id, kind: "doc", updatedAt: "2026-11-01T00:00:00.000Z", parentId: null,
      historyCount: 0, lastHistoryId: null, hasSyncBase: false, cloudConfigured: false, recovery,
    });
    const grouped = groupMissingDocs([doc("a", "cloud"), doc("b", "history"), doc("c", "none"), doc("d", "history")]);
    expect(grouped.cloud.map((d) => d.id)).toEqual(["a"]);
    expect(grouped.history.map((d) => d.id)).toEqual(["b", "d"]);
    expect(grouped.none.map((d) => d.id)).toEqual(["c"]);

    const qn = (id: string, recovery: MissingQuickNote["recovery"]): MissingQuickNote => ({
      id, createdAt: "", updatedAt: "", previewText: id, imageCount: 0, tags: "",
      hasSyncBase: false, cloudConfigured: false, hasTextCache: recovery === "text", recovery,
    });
    const qgrouped = groupMissingQuickNotes([qn("a", "cloud"), qn("b", "text"), qn("c", "none")]);
    expect(qgrouped.text.map((q) => q.id)).toEqual(["b"]);
    expect(qgrouped.cloud.map((q) => q.id)).toEqual(["a"]);
    expect(qgrouped.none.map((q) => q.id)).toEqual(["c"]);
  });

  it("sha256 校验：内容与云端 hash 不一致时必须判失败", () => {
    const content = "<p>恢复的正文</p>";
    const hash = sha256Sync(new TextEncoder().encode(content));
    expect(restoredBodyMatchesHash(content, hash)).toBe(true);
    expect(restoredBodyMatchesHash(content + "x", hash)).toBe(false);
  });

  it("提示文案：一句说清发生了什么 + 下一步去哪，且不使用中点", () => {
    for (const hint of [MISSING_DOC_OPEN_HINT, MISSING_QUICK_NOTE_OPEN_HINT]) {
      expect(hint).toContain("设置 → 资源管理");
      expect(hint).not.toContain("·");
    }
    expect(docRecoveryLabel("cloud")).toBe("可以从云端拉回");
    expect(docRecoveryLabel("history")).toBe("只能恢复历史版本");
    expect(docRecoveryLabel("none")).toBe("没有可用备份");
    expect(quickNoteRecoveryLabel("text")).toBe("可以用搜索缓存重建纯文本");
    // 失败原因：已知给具体后果，未知兜底可操作文案（不把内部错误码抛给用户）。
    expect(missingRecoveryFailureText("hash-mismatch")).toBe("云端内容校验失败，没有写入");
    expect(missingRecoveryFailureText("cloud-off")).toBe("云同步已关闭，无法从云端拉回");
    expect(missingRecoveryFailureText("boom-unknown")).toBe("恢复失败，请稍后重试");
  });

  it("每篇每会话只提示一次：claim 首次 true、再次 false", () => {
    const seen = new Set<string>();
    expect(claimMissingBodyNotice(seen, "n1")).toBe(true);
    expect(claimMissingBodyNotice(seen, "n1")).toBe(false);
    expect(claimMissingBodyNotice(seen, "n2")).toBe(true);
  });
});

describe("缺正文扫描（只 stat，不读正文）", () => {
  it("文档：正文文件缺失才进清单；有历史/有云端依据时给对应恢复路径", async () => {
    const db = await freshDb();
    await createNote(db, "n1", "缺正文的一篇", "<p>原文</p>", null, new Map());
    await createNote(db, "n2", "正常的一篇", "<p>正常</p>", null, new Map());
    await removeDocBody("n1");

    // 无云、无历史 ⇒ none
    let docs = await scanMissingNoteBodies(db, { cloudConfigured: false });
    expect(docs.map((d) => d.id)).toEqual(["n1"]);
    expect(docs[0].recovery).toBe("none");
    expect(docs[0].title).toBe("缺正文的一篇");
    expect(docs[0].parentId).toBeNull();

    // 有历史快照 ⇒ history（lastHistoryId 指向最新一份）
    await db.prepare(
      "INSERT INTO note_history (note_id, file_path, content_hash, title, created_at, size, refs_json, ref_count) VALUES (?,?,?,?,?,?,?,?)",
    ).run("n1", "history/n1/a.body.gz", DOC_HASH, "缺正文的一篇", "2026-11-01T00:00:00.000Z", 10, "[]", 0);
    docs = await scanMissingNoteBodies(db, { cloudConfigured: false });
    expect(docs[0].recovery).toBe("history");
    expect(docs[0].historyCount).toBe(1);
    expect(docs[0].lastHistoryId).toBeGreaterThan(0);

    // 上轮同步过 + 允许出网 ⇒ cloud（此时历史不再是首选路径）
    await seedSyncedBaseline(db, { docs: ["n1"] });
    docs = await scanMissingNoteBodies(db, { cloudConfigured: true });
    expect(docs[0].hasSyncBase).toBe(true);
    expect(docs[0].cloudConfigured).toBe(true);
    expect(docs[0].recovery).toBe("cloud");

    // 关了云 ⇒ 即使曾同步过也不给「从云端拉回」（AGENTS §3#20：关闭云同步 = 完全没配置）
    docs = await scanMissingNoteBodies(db, { cloudConfigured: false });
    expect(docs[0].recovery).toBe("history");
    await db.close();
  });

  it("小记：正文缺失才进清单；同步依据 + 搜索缓存分别给 cloud / text", async () => {
    const db = await freshDb();
    await saveQuickNote(db, "q1", "缺正文的小记", []);
    await saveQuickNote(db, "q2", "正常小记", []);
    await removeQuickNoteBody("q1");

    let items = await scanMissingQuickNotes(db, { cloudConfigured: false });
    expect(items.map((q) => q.id)).toEqual(["q1"]);
    expect(items[0].recovery).toBe("none");
    expect(items[0].previewText).toContain("缺正文的小记");

    // 搜索索引全文缓存 ⇒ text（小记**没有历史快照**，别造历史路径）
    await db.prepare(
      "INSERT INTO quick_notes_search_index (quick_note_id, fts_rowid, content_hash, text_cache, tags, indexed_at) VALUES (?,?,?,?,?,?)",
    ).run("q1", 1, QN_HASH, "缓存里的全文", "", "2026-11-01T00:00:00.000Z");
    items = await scanMissingQuickNotes(db, { cloudConfigured: false });
    expect(items[0].hasTextCache).toBe(true);
    expect(items[0].recovery).toBe("text");

    // 同步依据 + 允许出网 ⇒ cloud 优先
    await seedSyncedBaseline(db, { quickNotes: ["q1"] });
    items = await scanMissingQuickNotes(db, { cloudConfigured: true });
    expect(items[0].hasSyncBase).toBe(true);
    expect(items[0].recovery).toBe("cloud");
    await db.close();
  });

  it("正文正常时清单为空（不误报）", async () => {
    const db = await freshDb();
    await createNote(db, "n1", "正常", "<p>正常</p>", null, new Map());
    await saveQuickNote(db, "q1", "正常小记", []);
    expect(await scanMissingNoteBodies(db, { cloudConfigured: true })).toEqual([]);
    expect(await scanMissingQuickNotes(db, { cloudConfigured: true })).toEqual([]);
    await db.close();
  });
});

describe("恢复落盘", () => {
  it("文档：写回正文 + 标 synced（is_dirty=0）+ 更新 hash/纯文本缓存", async () => {
    const db = await freshDb();
    await createNote(db, "n1", "缺正文", "<p>旧</p>", null, new Map());
    await removeDocBody("n1");
    const content = "<p>云端恢复的正文</p>";
    await applyRestoredNoteBody(db, "n1", "doc", content, { synced: true });
    expect(await getBodyStore().readText(noteBodyRelativePath("doc", "n1"))).toBe(content);
    const row = await db.prepare("SELECT is_dirty, content_hash, text_cache FROM notes WHERE id=?").get("n1") as {
      is_dirty: number; content_hash: string; text_cache: string;
    };
    expect(row.is_dirty).toBe(0);
    expect(row.content_hash).toBe(sha256Sync(new TextEncoder().encode(content)));
    expect(row.text_cache).toContain("云端恢复的正文");
    // 恢复后的最终目的：这篇**能正常打开**（readNote 不再返回 null）。
    expect((await readNote(db, "n1"))!.content).toBe(content);
    await db.close();
  });

  it("文档：行已进回收站时拒绝写入（不制造「行在别处、正文被改」的半态）", async () => {
    const db = await freshDb();
    await createNote(db, "n1", "缺正文", "<p>旧</p>", null, new Map());
    await db.prepare("UPDATE notes SET trashed_at=? WHERE id=?").run("2026-11-01T00:00:00.000Z", "n1");
    await expect(applyRestoredNoteBody(db, "n1", "doc", "<p>x</p>", { synced: true })).rejects.toThrow();
    await db.close();
  });

  it("小记：搜索缓存重建 ⇒ 纯文本正文 + 标 local（is_dirty=1）；云端恢复 ⇒ 标 synced", async () => {
    const db = await freshDb();
    await saveQuickNote(db, "q1", "原正文", []);
    await removeQuickNoteBody("q1");

    const rebuilt = rebuildQuickNoteContentFromText("缓存重建的文本");
    await applyRestoredQuickNote(db, "q1", rebuilt, { synced: false });
    const raw = await getBodyStore().readText(quickNoteBodyRelativePath("q1"));
    expect(raw).toContain("缓存重建的文本");
    expect(JSON.parse(raw!)).toMatchObject({ text: "缓存重建的文本", images: [] });
    const local = await db.prepare("SELECT is_dirty, preview_text FROM quick_notes WHERE id=?").get("q1") as { is_dirty: number; preview_text: string };
    expect(local.is_dirty).toBe(1);
    expect(local.preview_text).toContain("缓存重建的文本");
    // 重建后卡片/写作卡能正常打开（纯文本镜像与内核正文都在）
    expect((await readQuickNote(db, "q1"))!.content.text).toBe("缓存重建的文本");

    await removeQuickNoteBody("q1");
    await applyRestoredQuickNote(db, "q1", rebuilt, { synced: true, updatedAt: "2026-10-30T00:00:00.000Z" });
    const synced = await db.prepare("SELECT is_dirty, updated_at FROM quick_notes WHERE id=?").get("q1") as { is_dirty: number; updated_at: string };
    expect(synced.is_dirty).toBe(0);
    expect(synced.updated_at).toBe("2026-10-30T00:00:00.000Z");
    await db.close();
  });
});

describe("关键路径静态契约（防退化）", () => {
  const read = (rel: string): string => readFileSync(path.resolve(process.cwd(), rel), "utf8");

  it("文档云端拉回 = 单篇 pointer→索引→内容寻址正文 + sha256 校验，绝不整库 restoreFromCloud", () => {
    const src = read("src/mobile/bridge/notes.ts");
    expect(src).toContain('runPriority("restoreMissingNoteBody"');
    expect(src).toContain("S3V3_POINTER_KEY");
    expect(src).toContain("lakeBodyKey");
    expect(src).toContain("sha256Hex");
    expect(src).not.toContain("restoreFromCloud(");
    // 同步账本/资产只读，不在这里清基线
    expect(src).not.toContain("clearV3State");
  });

  it("小记云端拉回 = quick-notes 索引 + quickNoteBodyKey + sha256；小记没有历史路径", () => {
    const src = read("src/mobile/bridge/quickNotes.ts");
    expect(src).toContain('runPriority("restoreMissingQuickNoteFromCloud"');
    expect(src).toContain("quickNoteBodyKey");
    expect(src).toContain("sha256Hex");
    expect(src).toContain("validateQuickNoteContent");
    expect(src).not.toContain("historyRepository");
    expect(src).not.toContain("restoreFromCloud(");
  });

  it("资源管理两行 + 二次确认接线存在", () => {
    const drawer = read("src/mobile/settings/SettingsDrawer.tsx");
    expect(drawer).toContain('itemId="resources-missing-bodies"');
    expect(drawer).toContain('itemId="resources-missing-quicknotes"');
    expect(drawer).toContain("<MissingBodiesSheet");
    // 同步警告区的「正文缺失」行给恢复入口（点了直接跳资源管理，而不是去点开会失败的文档）
    expect(drawer).toContain("去恢复");
    expect(drawer).toContain('setView("resources")');
    const sheet = read("src/mobile/settings/MissingBodiesSheet.tsx");
    expect(sheet).toContain("confirmMobile");
    expect(sheet).toContain("bridge.restoreMissingNoteBody");
    expect(sheet).toContain("bridge.restoreMissingQuickNoteFromCloud");
    expect(sheet).toContain("bridge.recoverMissingQuickNoteFromText");
    expect(sheet).toContain("bridge.purgeQuickNote");
  });

  it("打开缺正文的提示：文档与（待接的）小记共用同一处文案、且每篇每会话一次", () => {
    const workspace = read("src/mobile/notebook/NotebookWorkspace.tsx");
    expect(workspace).toContain("MISSING_DOC_OPEN_HINT");
    expect(workspace).toContain("claimMissingBodyNotice");
    const tabs = read("src/mobile/notebook/useNotebookTabs.ts");
    expect(tabs).toContain("onMissingRef.current(id)");
  });
});
