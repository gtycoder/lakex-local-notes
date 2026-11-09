/**
 * 导入编排的**回滚/提交路径**单测：原生边界与 DB 全部 mock，
 * 验证「失败 ⇒ 回滚 + 报错说明」「成功 ⇒ 写基线 + 提交」两条路径（真机文件/DB 行为留给台架）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  baselineJson: "",
  rows: new Map<string, Array<Record<string, unknown>>>(),
  failCopy: false,
  calls: [] as string[],
  savedBaseline: null as unknown,
  batches: [] as Array<{ statement: string; values: unknown[] }>,
}));

vi.mock("../native/portablePackage", () => ({
  isPortableImportNativeAvailable: () => true,
  nativeReadPortableBaseline: async () => ({ ok: true, json: state.baselineJson }),
  nativeBeginPortableImport: async () => {
    state.calls.push("begin");
    return { ok: true, rollbackDir: "/x", dbFiles: 1, movedDirs: 0 };
  },
  nativeCopyPortablePayload: async () => {
    state.calls.push("copy");
    return state.failCopy ? { ok: false, error: "磁盘已满" } : { ok: true, files: 3, bytes: 100 };
  },
  nativeReadPortableRows: async (options: { table: string; offset: number }) => {
    const all = state.rows.get(options.table) ?? [];
    const rows = all.slice(options.offset, options.offset + 500);
    return { ok: true, rows, done: options.offset + rows.length >= all.length };
  },
  nativeCommitPortableImport: async () => {
    state.calls.push("commit");
    return { ok: true };
  },
  nativeRollbackPortableImport: async () => {
    state.calls.push("rollback");
    return { ok: true, restored: true };
  },
  nativeRecoverPortableImport: async () => ({ ok: true, restored: true, pending: true }),
  nativePortablePendingInfo: async () => ({ pending: true }),
  nativeDiscardPortableStaging: async () => undefined,
}));

vi.mock("../bridge/context", () => ({
  closeDbForPortableImport: async () => { state.calls.push("close-db"); },
  reopenDbForPortableImport: async () => ({ executeSet: async (set: Array<{ statement: string; values: unknown[] }>) => { state.batches.push(...set); } }),
  ensureDb: async () => { state.calls.push("ensure-db"); return {}; },
}));

vi.mock("../data/v3StateRepository", () => ({
  ensureV3StateTable: async () => { state.calls.push("ensure-v3"); },
  saveV3State: async (_db: unknown, value: { baseline: unknown }) => { state.savedBaseline = value.baseline; },
  EMPTY_MOBILE_V3_STATE: { baseline: null, intents: [], pending: [], remotePurged: [], restorePending: [], assetsHash: {}, quickPurgeTimes: {}, pendingAssets: [] },
}));

vi.mock("../data/derivedSearchCache", () => ({ clearSearchDerivedCache: async () => undefined }));
vi.mock("../data/searchIndex", () => ({ reconcileIndex: async () => undefined }));
vi.mock("../data/sqliteDb", () => ({
  executeBatch: async (_db: unknown, statements: Array<{ statement: string; values: unknown[] }>) => {
    state.batches.push(...statements);
  },
}));

const { runPortableImport, recoverInterruptedPortableImport, consumePortableRecoveryNotice } = await import("./importPortable");

const H = (ch: string) => ch.repeat(64);
const TS = "2026-11-09T00:00:00.000Z";

const baseline = () => JSON.stringify({
  epoch: "e1",
  generation: 1,
  lakeCommit: H("c"),
  quickNotesCommit: H("d"),
  lake: {
    v: 3,
    space: "lake",
    notes: [{ id: "n1", title: "文档1", parentId: "nb1", sortOrder: 0, updatedAt: TS, contentHash: H("a"), kind: "doc" }],
    folders: [{ id: "nb1", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: TS }],
  },
  quickNotes: { v: 3, space: "quickNotes", items: [{ id: "q1", createdAt: TS, updatedAt: TS, contentHash: H("b") }] },
});

const staged = () => ({
  stagingPath: "/stage",
  manifest: {
    format: "lakex-local-notes-portable" as const,
    formatVersion: 1 as const,
    appVersion: "1.0.4",
    exportedAt: TS,
    source: { platform: "desktop" as const },
    hasHistory: false as const,
    limitBytes: 4 * 1024 * 1024 * 1024,
    counts: { notes: 1, folders: 1, quickNotes: 1, tags: 1, assets: 3, bytes: 100 },
    baseline: { epoch: "e1", generation: 1, lakeCommit: H("c"), quickNotesCommit: H("d") },
  },
  bytes: 100,
  entries: 12,
});

beforeEach(() => {
  state.rows = new Map([
    ["tree_nodes", [
      { id: "nb1", parent_id: null, node_type: "notebook", title: "个人笔记", sort_order: 0, updated_at: TS },
      { id: "tree-n1", parent_id: "nb1", node_type: "note", title: "文档1", note_file_id: "n1", sort_order: 0, updated_at: TS },
    ]],
    ["notes", [{ id: "n1", title: "文档1", parent_id: "nb1", sort_order: 0, updated_at: TS, kind: "doc" }]],
    ["quick_notes", [{ id: "q1", created_at: TS, updated_at: TS, preview_text: "预览", image_count: 0 }]],
    ["quick_note_deleted", []],
    ["tags", [{ id: "t1", name: "标签", sort_order: 0, created_at: TS, updated_at: TS }]],
    ["tag_links", [{ target_kind: "quickNote", target_id: "q1", tag_id: "t1", position: 0 }]],
    ["tag_link_versions", [{ target_kind: "note", target_id: "n1", links_updated_at: TS }]],
  ]);
  state.failCopy = false;
  state.calls = [];
  state.savedBaseline = null;
  state.batches = [];
  state.baselineJson = baseline();
});

describe("便携包导入编排", () => {
  it("成功：写基线（intents/pending 置空）+ 清历史 + 提交", async () => {
    const result = await runPortableImport(staged());
    expect(result.counts).toMatchObject({ notes: 1, folders: 1, quickNotes: 1, tags: 1, assets: 3 });
    expect(state.calls).toEqual(["close-db", "begin", "copy", "ensure-v3", "commit"]);
    expect(state.savedBaseline).toMatchObject({ epoch: "e1", generation: 1 });
    const statements = state.batches.map((item) => item.statement);
    expect(statements).toContain("DELETE FROM note_history");
    expect(statements.some((sql) => sql.startsWith("INSERT OR REPLACE INTO notes"))).toBe(true);
  });

  it("纯离线包（manifest.baseline=null）：只读内容哈希、不写云端基线", async () => {
    const offline = staged();
    (offline.manifest as unknown as { baseline: unknown }).baseline = null;
    state.baselineJson = JSON.stringify({ localOnly: true, notes: { n1: H("a") }, quickNotes: { q1: H("b") } });
    const result = await runPortableImport(offline as ReturnType<typeof staged>);
    expect(result.hasCloudBaseline).toBe(false);
    expect(state.savedBaseline).toBeNull();
    expect(state.calls).toContain("commit");
  });

  it("失败：回滚到导入前并明确告知（不提交）", async () => {
    state.failCopy = true;
    await expect(runPortableImport(staged())).rejects.toThrow(/已回滚到导入前的数据/);
    expect(state.calls).not.toContain("commit");
    expect(state.calls).toContain("rollback");
    expect(state.calls).toContain("ensure-db");
  });

  it("基线不合法：在动数据前失败（不 begin、不回滚）", async () => {
    state.baselineJson = "{}";
    await expect(runPortableImport(staged())).rejects.toThrow(/基线/);
    expect(state.calls).not.toContain("begin");
  });
});

describe("启动时 pending 恢复", () => {
  it("发现 pending 即回滚并留下一次性提示", async () => {
    await expect(recoverInterruptedPortableImport()).resolves.toBe(true);
    expect(consumePortableRecoveryNotice()).toContain("已自动回滚");
    expect(consumePortableRecoveryNotice()).toBeNull();
  });
});
