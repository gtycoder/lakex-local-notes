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
  restoreOk: true,
  restoreHasBaseline: true,
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
  nativeRestorePortableSnapshot: async () => {
    state.calls.push("restore");
    return state.restoreOk
      ? { ok: true, counts: { notes: 2, folders: 1, quickNotes: 1, tags: 1 }, hasBaseline: state.restoreHasBaseline, files: 4, bytes: 500 }
      : { ok: false, error: "快照损坏" };
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

/** 手机快照恢复后的活库行（供合成合并底稿基线读取；按 SQL 里的表名分派）。字面量避免 TDZ（本段在 H/TS 声明之前）。 */
const liveRows: Record<string, Array<Record<string, unknown>>> = {
  notes: [{ id: "n1", title: "文档1", parent_id: "nb1", sort_order: 0, updated_at: "2026-11-09T00:00:00.000Z", content_hash: "a".repeat(64), is_conflict: 0, is_locked: 0, locked_at: null, doc_kind: "doc", trashed_at: null, deleted_from_parent_id: null }],
  folders: [{ id: "nb1", title: "个人笔记", parent_id: null, sort_order: 0, node_type: "notebook", space: null, icon: null, updated_at: "2026-11-09T00:00:00.000Z", trashed_at: null, deleted_from_parent_id: null }],
  quick_notes: [{ id: "q1", created_at: "2026-11-09T00:00:00.000Z", updated_at: "2026-11-09T00:00:00.000Z", content_hash: "b".repeat(64), is_conflict: 0, tags_updated_at: "" }],
  quick_note_deleted: [],
  tags: [{ id: "t1", name: "标签", created_at: "2026-11-09T00:00:00.000Z", updated_at: "2026-11-09T00:00:00.000Z" }],
  tag_links: [{ target_kind: "quickNote", target_id: "q1", tag_id: "t1", position: 0 }],
  tag_link_versions: [],
};

vi.mock("../bridge/context", () => ({
  closeDbForPortableImport: async () => { state.calls.push("close-db"); },
  reopenDbForPortableImport: async () => ({
    executeSet: async (set: Array<{ statement: string; values: unknown[] }>) => { state.batches.push(...set); },
    prepare: (sql: string) => ({
      all: async () => liveRows[/FROM (\w+)/.exec(sql)?.[1] ?? ""] ?? [],
      get: async () => undefined,
      run: async () => ({ changes: 0, lastInsertRowid: 0 }),
    }),
  }),
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

const snapshotStaged = () => ({
  stagingPath: "/snapstage",
  manifest: {
    format: "lakex-local-notes-portable" as const,
    formatVersion: 2 as const,
    appVersion: "1.3.2",
    exportedAt: TS,
    source: { platform: "mobile" as const },
    layout: "mobile-snapshot" as const,
    limitBytes: 4 * 1024 * 1024 * 1024,
    counts: { notes: 2, folders: 1, quickNotes: 1, tags: 1, assets: 1, bytes: 500 },
    baseline: null,
  },
  bytes: 500,
  entries: 20,
});

const staged = () => ({
  stagingPath: "/stage",
  manifest: {
    format: "lakex-local-notes-portable" as const,
    formatVersion: 2 as const,
    appVersion: "1.0.4",
    exportedAt: TS,
    source: { platform: "desktop" as const },
    layout: "desktop-workspace" as const,
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

  it("261123 报障回归：纯离线包合成「合并底稿」基线（不再落「有信封无基线」假丢失态）", async () => {
    const offline = staged();
    (offline.manifest as unknown as { baseline: unknown }).baseline = null;
    state.baselineJson = JSON.stringify({ localOnly: true, notes: { n1: H("a") }, quickNotes: { q1: H("b") } });
    const result = await runPortableImport(offline as ReturnType<typeof staged>);
    expect(result.hasCloudBaseline).toBe(false);
    // 修复（docs/PORTABLE-TRANSFER.md §3.1）：写入合并底稿基线（bootstrap），
    // 首同步走三方合并而不是被 SyncBaselineLostError 中止；内容底稿 = 导出时刻哈希。
    expect(state.savedBaseline).toMatchObject({ bootstrap: true, epoch: "" });
    const saved = state.savedBaseline as { lake: { notes: Array<{ id: string; contentHash: string }>; folders: Array<{ id: string }> }; quickNotes: { items: Array<{ id: string; contentHash: string }> } };
    expect(saved.lake.notes).toMatchObject([{ id: "n1", contentHash: H("a") }]);
    expect(saved.lake.folders).toMatchObject([{ id: "nb1" }]);
    expect(saved.quickNotes.items).toMatchObject([{ id: "q1", contentHash: H("b") }]);
    expect(state.calls).toContain("commit");
  });

  it("失败：回滚到导入前并明确告知（不提交）", async () => {
    state.failCopy = true;
    await expect(runPortableImport(staged())).rejects.toThrow(/已回滚到导入前的数据/);
    expect(state.calls).not.toContain("commit");
    expect(state.calls).toContain("rollback");
    expect(state.calls).toContain("ensure-db");
  });

  it("261201 P1-A：坏云端基线不阻断迁移——降级合成合并底稿 + 明示警告（不走拉全轮）", async () => {
    state.baselineJson = "{}"; // manifest 带 baseline 但内容不可解析
    const result = await runPortableImport(staged());
    expect(result.baselineSource).toBe("bootstrap"); // P2-C：按实际写入上报，不再报 true
    expect(result.hasCloudBaseline).toBe(false);
    expect(result.warnings.join()).toContain("合成合并底稿");
    expect(state.savedBaseline).toMatchObject({ bootstrap: true, epoch: "" });
    expect(state.calls).toContain("commit");
  });

  it("261201 P1-A：baseline.json 缺失/不可读同样降级合成（不抛错、不落『有信封无基线』）", async () => {
    state.baselineJson = "";
    const result = await runPortableImport(staged());
    expect(result.baselineSource).toBe("bootstrap");
    expect(result.warnings.join()).toContain("基线缺失");
    expect(state.savedBaseline).toMatchObject({ bootstrap: true });
    expect(state.calls).toContain("commit");
  });
});

describe("启动时 pending 恢复", () => {
  it("发现 pending 即回滚并留下一次性提示", async () => {
    await expect(recoverInterruptedPortableImport()).resolves.toBe(true);
    expect(consumePortableRecoveryNotice()).toContain("已自动回滚");
    expect(consumePortableRecoveryNotice()).toBeNull();
  });
});
describe("手机整机快照恢复（261117 D 项）", () => {
  it("快照包 = 原生整机恢复（关库 → restore），不走桌面行映射", async () => {
    state.calls = [];
    state.restoreOk = true;
    const result = await runPortableImport(snapshotStaged() as never);
    expect(state.calls).toEqual(["close-db", "restore"]);
    expect(result.counts).toMatchObject({ notes: 2, folders: 1, quickNotes: 1, tags: 1, assets: 4, bytes: 500 });
    expect(result.hasCloudBaseline).toBe(true);
    expect(result.warnings.join()).toContain("整机快照");
  });

  it("261123：零基线快照（manifest.baseline=null 且快照内无基线）恢复后合成合并底稿基线", async () => {
    state.calls = [];
    state.restoreOk = true;
    state.restoreHasBaseline = false;
    state.savedBaseline = null;
    const offline = snapshotStaged();
    const result = await runPortableImport(offline as never);
    expect(result.hasCloudBaseline).toBe(false);
    expect(state.savedBaseline).toMatchObject({ bootstrap: true });
    const saved = state.savedBaseline as { lake: { notes: Array<{ id: string; contentHash: string }> } };
    expect(saved.lake.notes).toMatchObject([{ id: "n1", contentHash: "a".repeat(64) }]);
    expect(state.calls).toContain("restore");
  });

  it("261201 P1-A：快照声称云端基线但实际缺失/损坏 ⇒ 同样合成合并底稿 + 警告", async () => {
    state.calls = [];
    state.restoreOk = true;
    state.restoreHasBaseline = false; // 包内没有可用基线文件
    state.savedBaseline = null;
    const claimed = snapshotStaged();
    (claimed.manifest as unknown as { baseline: unknown }).baseline = { epoch: "e", generation: 1, lakeCommit: "l", quickNotesCommit: "q" };
    const result = await runPortableImport(claimed as never);
    expect(result.baselineSource).toBe("bootstrap");
    expect(result.hasCloudBaseline).toBe(false);
    expect(result.warnings.join()).toContain("合成合并底稿");
    expect(state.savedBaseline).toMatchObject({ bootstrap: true });
  });

  it("原生恢复失败：报错并尽量回滚/重开数据库", async () => {
    state.calls = [];
    state.restoreOk = false;
    await expect(runPortableImport(snapshotStaged() as never)).rejects.toThrow(/恢复手机快照失败/);
    expect(state.calls).toContain("restore");
    expect(state.calls).toContain("rollback");
    expect(state.calls).toContain("ensure-db");
  });
});
