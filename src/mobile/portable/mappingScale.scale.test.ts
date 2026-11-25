
import { describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { mapDesktopTree, parsePortableBaseline, type DesktopRow, type ParsedPortableBaseline } from "./portableMapping";

/**
 * 行映射规模档（261123 lead 点单 + 审计压测建议②）：导入行映射 ~5 万行的内存与时长。
 * 默认 skip：LLN_SCALE=1 npx vitest run src/mobile/portable/mappingScale.scale.test.ts
 * 报告行 "SCALE-REPORT"（JSON）打 stdout 供 lead 汇总。
 */

const SCALE = !!process.env.LLN_SCALE;
const H = (ch: string): string => ch.repeat(64);
const TS = "2026-11-09T00:00:00.000Z";
const memMb = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const report = (tag: string, data: Record<string, unknown>): void => {
  console.log("SCALE-REPORT " + JSON.stringify({ tag, ...data }));
};

function bigBaseline(): ParsedPortableBaseline {
  return parsePortableBaseline({
    epoch: "e1",
    generation: 1,
    lakeCommit: H("c"),
    quickNotesCommit: H("d"),
    lake: { v: 3, space: "lake", notes: [], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [] },
  });
}

describe.skipIf(!SCALE)("行映射规模档（~5 万行）", () => {
  it("mapDesktopTree：5 万 note 行 + 1 万 tree 行 的时长/内存（审计②）", () => {
    const noteRows: DesktopRow[] = Array.from({ length: 50_000 }, (_, i) => ({
      id: "n" + String(i).padStart(6, "0"),
      title: "Doc " + i,
      parent_id: "nb" + String(i % 100).padStart(4, "0"),
      sort_order: i,
      updated_at: TS,
      content_hash: H("a"),
      is_purged: 0,
    }));
    const treeRows: DesktopRow[] = Array.from({ length: 10_000 }, (_, i) => ({
      id: "nb" + String(i).padStart(4, "0"),
      parent_id: null,
      node_type: "notebook",
      title: "NB " + i,
      sort_order: i,
      updated_at: TS,
      is_purged: 0,
    }));
    const heap0 = memMb();
    const t0 = performance.now();
    const mapped = mapDesktopTree(treeRows, noteRows, bigBaseline());
    const mapMs = performance.now() - t0;
    expect(mapped.notes).toHaveLength(50_000);
    expect(mapped.folders).toHaveLength(10_000);
    expect(mapMs).toBeLessThan(20_000);
    report("mapDesktopTree-50k", {
      noteRows: 50_000, treeRows: 10_000,
      mapMs: Math.round(mapMs),
      heapDeltaMb: memMb() - heap0,
    });
  }, 300_000);
});

// ── 审计⑥：移动导入 readAllRows 桥往返次数（分页 500/次）──────────────────────────
const bridgeCalls = vi.hoisted(() => ({ reads: 0, rowsReturned: 0 }));
vi.mock("../native/portablePackage", () => ({
  isPortableImportNativeAvailable: () => true,
  nativeReadPortableBaseline: async () => ({ ok: true, json: JSON.stringify({
    epoch: "e1", generation: 1, lakeCommit: H("c"), quickNotesCommit: H("d"),
    lake: { v: 3, space: "lake", notes: [], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [] },
  }) }),
  nativeBeginPortableImport: async () => ({ ok: true, rollbackDir: "/x", dbFiles: 1, movedDirs: 0 }),
  nativeCopyPortablePayload: async () => ({ ok: true, files: 3, bytes: 100 }),
  nativeReadPortableRows: async (options: { table: string; offset: number }) => {
    bridgeCalls.reads += 1;
    const rows = ((globalThis as Record<string, unknown>).__scaleRows as Record<string, Array<Record<string, unknown>>> | undefined)?.[options.table] ?? [];
    const all = rows as Array<Record<string, unknown>>;
    const page = all.slice(options.offset, options.offset + 500);
    bridgeCalls.rowsReturned += page.length;
    return { ok: true, rows: page, done: options.offset + page.length >= all.length };
  },
  nativeRestorePortableSnapshot: async () => ({ ok: true, counts: { notes: 0, folders: 0, quickNotes: 0, tags: 0 }, hasBaseline: true, files: 0, bytes: 0 }),
  nativeCommitPortableImport: async () => ({ ok: true }),
  nativeRollbackPortableImport: async () => ({ ok: true, restored: true }),
  nativeRecoverPortableImport: async () => ({ ok: true, restored: true, pending: false }),
  nativePortablePendingInfo: async () => ({ pending: false }),
  nativeDiscardPortableStaging: async () => undefined,
}));

// DB/编排层 mock（与 importPortable.test.ts 同口径：只测桥往返计数，不动真库）
vi.mock("../bridge/context", () => ({
  closeDbForPortableImport: async () => undefined,
  reopenDbForPortableImport: async () => ({
    executeSet: async () => undefined,
    prepare: () => ({ all: async () => [], get: async () => undefined, run: async () => ({ changes: 0, lastInsertRowid: 0 }) }),
  }),
  ensureDb: async () => ({}),
}));
vi.mock("../data/v3StateRepository", () => ({
  ensureV3StateTable: async () => undefined,
  saveV3State: async () => undefined,
  EMPTY_MOBILE_V3_STATE: { baseline: null, intents: [], pending: [], remotePurged: [], restorePending: [], assetsHash: {}, quickPurgeTimes: {}, pendingAssets: [] },
}));
vi.mock("../data/derivedSearchCache", () => ({ clearSearchDerivedCache: async () => undefined }));
vi.mock("../data/searchIndex", () => ({ reconcileIndex: async () => undefined }));
vi.mock("../data/dbPortTypes", () => ({ executeBatch: async () => undefined }));

describe.skipIf(!SCALE)("移动导入桥往返（审计⑥）", () => {
  it("runPortableImport 读 5000 note 行：nativeReadPortableRows 桥调用 = ceil(5000/500) 桌面布局路", async () => {
    const { runPortableImport } = await import("./importPortable");
    const TS2 = "2026-11-09T00:00:00.000Z";
    const rows = {
      tree_nodes: Array.from({ length: 5000 }, (_, i) => ({
        id: "tree-" + i, parent_id: null, node_type: "note", title: "t" + i, note_file_id: "n" + i, sort_order: i, updated_at: TS2,
      })),
      notes: Array.from({ length: 5000 }, (_, i) => ({ id: "n" + i, title: "d" + i, parent_id: null, sort_order: i, updated_at: TS2, kind: "doc" })),
      quick_notes: [], quick_note_deleted: [], tags: [], tag_links: [], tag_link_versions: [],
    };
    (globalThis as Record<string, unknown>).__scaleRows = rows;
    bridgeCalls.reads = 0;
    bridgeCalls.rowsReturned = 0;
    const heap0 = memMb();
    const t0 = performance.now();
    const result = await runPortableImport({
      stagingPath: "/stage",
      manifest: {
        format: "lakex-local-notes-portable",
        formatVersion: 2,
        appVersion: "1.5.6",
        exportedAt: TS2,
        source: { platform: "desktop" },
        layout: "desktop-workspace",
        limitBytes: 4 * 1024 * 1024 * 1024,
        counts: { notes: 5000, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 1 },
        baseline: { epoch: "e1", generation: 1, lakeCommit: H("c"), quickNotesCommit: H("d") },
      },
      bytes: 1,
      entries: 10,
    } as never);
    const importMs = performance.now() - t0;
    expect(result).toBeTruthy();
    // 每表分页 500/次 ⇒ 7 张表各 ceil(n/500)：notes/tree_nodes 各 10 次，空表各 1 次 = 25 次；
    // 精确值以 SCALE-REPORT 上报为准，断言取宽界防实现微调（>2× 最小值 = 分页失效）
    const minimalCalls = 2 * Math.ceil(5000 / 500) + 5 * 1;
    expect(bridgeCalls.reads).toBeGreaterThanOrEqual(minimalCalls);
    expect(bridgeCalls.reads).toBeLessThan(minimalCalls * 2);
    expect(bridgeCalls.rowsReturned).toBeGreaterThanOrEqual(10_000);
    report("bridge-readAllRows", {
      noteRows: 5000, bridgeCalls: bridgeCalls.reads, minimalCalls,
      importMs: Math.round(importMs), heapDeltaMb: memMb() - heap0,
    });
    delete (globalThis as Record<string, unknown>).__scaleRows;
  }, 300_000);
});
