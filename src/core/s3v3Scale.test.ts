import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, declarationHashOf, indexHashOf, parseLakeIndexBytes, serializeLakeIndex, serializeDeclaration, validateAssetDeclaration, type LakeIndex, type LakeNoteEntry } from "./s3v3Index.js";
import { planLakeMerge } from "./s3v3Merge.js";
import { planLakeDeletes } from "./s3v3Gc.js";
import { gatePendingDelete, type CurrentWorld, type PendingDelete } from "./s3v3Gate.js";

const H = (s: string) => sha256Hex(new TextEncoder().encode(s));
const DOCS = 20_000;
const ASSETS_PER_DOC = 10;

function buildWorld() {
  const t0 = performance.now();
  const notes: LakeNoteEntry[] = [];
  const declarations = new Map<string, { declHash: string; filenames: string[] }>();
  const declBytesTotal = { raw: 0 };
  for (let i = 0; i < DOCS; i++) {
    const id = "n" + String(i).padStart(6, "0");
    const assets = [];
    for (let a = 0; a < ASSETS_PER_DOC; a++) {
      const filename = "f" + a + ".png";
      assets.push({ filename, size: 1024 + a, hash: H(id + "/" + filename) });
    }
    const built = buildAssetDeclaration(assets);
    declarations.set(id, { declHash: built.declHash, filenames: assets.map((x) => x.filename) });
    declBytesTotal.raw += serializeDeclaration(built.declaration).length;
    notes.push({ id, title: "Doc " + i, parentId: null, sortOrder: i, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: H("body-" + id), assetsHash: built.declHash });
  }
  const index: LakeIndex = { v: 3, space: "lake", notes, folders: [] };
  return { index, declarations, declBytesTotal, buildMs: performance.now() - t0 };
}

describe("大规模（2 万文档 / 20 万附件量级）纯逻辑", () => {
  it("索引体积/解析/合并/GC/门禁在预算内", () => {
    const { index, declarations, declBytesTotal, buildMs } = buildWorld();
    expect(index.notes).toHaveLength(DOCS);
    expect(declarations.size).toBe(DOCS);
    expect(declBytesTotal.raw).toBeGreaterThan(20 * 1024 * 1024);
    // 索引序列化
    const t1 = performance.now();
    const serialized = serializeLakeIndex(index);
    const commit = indexHashOf(serialized);
    const serMs = performance.now() - t1;
    expect(serialized.length).toBeGreaterThan(5 * 1024 * 1024);
    expect(serialized.length).toBeLessThan(15 * 1024 * 1024);
    // 解析
    const t2 = performance.now();
    const parsed = parseLakeIndexBytes(new TextEncoder().encode(serialized));
    const parseMs = performance.now() - t2;
    expect(parsed.commit).toBe(commit);
    // 校验一个声明
    const sample = [...declarations.values()][0];
    expect(declarationHashOf(validateAssetDeclaration({ assets: Array.from({ length: ASSETS_PER_DOC }, (_, a) => ({ filename: "f" + a + ".png", size: 1024 + a, hash: H("n000000/f" + a + ".png") })) }))).toBe(sample.declHash);
    // 合并：本地改 500 篇、远端改另 500 篇
    const remoteIndex: LakeIndex = { ...index, notes: index.notes.map((n, i) => i % 1000 === 0 ? { ...n, contentHash: H("remote-" + n.id), updatedAt: "2026-10-26T00:00:00.000Z" } : n) };
    const localIndex: LakeIndex = { ...index, notes: index.notes.map((n, i) => i % 1000 === 1 ? { ...n, contentHash: H("local-" + n.id), updatedAt: "2026-10-26T00:00:00.000Z" } : n) };
    const t3 = performance.now();
    const plan = planLakeMerge(index, localIndex, remoteIndex, { restorePending: new Set(), purgeIntents: new Set(), folderPurgeIntents: new Set() });
    const mergeMs = performance.now() - t3;
    expect(plan.notes.filter((p) => p.kind === "download").length).toBeGreaterThan(0);
    expect(plan.notes.filter((p) => p.kind === "upload").length).toBeGreaterThan(0);
    // GC：远端索引 → 下一版（改 500、删 100）
    const nextIndex: LakeIndex = { v: 3, space: "lake", notes: remoteIndex.notes.filter((_, i) => i % 200 !== 0).map((n, i) => i % 1000 === 0 ? { ...n, contentHash: H("next-" + n.id) } : n), folders: [] };
    const t4 = performance.now();
    const deletes = planLakeDeletes({ previous: remoteIndex, next: nextIndex, previousDecls: declarations, nextDecls: declarations, previousCommit: commit, nextCommit: H("next-commit") });
    const gcMs = performance.now() - t4;
    expect(deletes.length).toBeGreaterThan(0);
    // 门禁：1000 条待删针对当前 index
    const world: CurrentWorld = { lakeCommit: commit, quickNotesCommit: H("q"), notes: index.notes, quickNotes: [], declarations: {}, quickDeclarations: {} };
    const pending: PendingDelete[] = index.notes.slice(0, 1000).map((n) => ({ kind: "body", key: "objects/" + n.id + "-" + n.contentHash + ".lake", noteId: n.id, oldHash: n.contentHash, targetEpoch: "e", targetGeneration: 1, targetCommit: commit, createdAt: "x" }));
    const t5 = performance.now();
    const gated = pending.map((p) => gatePendingDelete(p, world));
    const gateMs = performance.now() - t5;
    expect(gated.every((g) => !g.execute)).toBe(true);
    console.log(JSON.stringify({
      docs: DOCS, assets: DOCS * ASSETS_PER_DOC, buildMs: Math.round(buildMs), serMs: Math.round(serMs), parseMs: Math.round(parseMs),
      mergeMs: Math.round(mergeMs), gcMs: Math.round(gcMs), gateMs: Math.round(gateMs),
      indexBytes: serialized.length, declarationsRawBytes: declBytesTotal.raw, planEntries: plan.notes.length, deletes: deletes.length,
    }));
    expect(serMs).toBeLessThan(3000);
    expect(parseMs).toBeLessThan(4000);
    expect(mergeMs).toBeLessThan(3000);
    expect(gcMs).toBeLessThan(3000);
    expect(gateMs).toBeLessThan(1000);
  }, 120_000);
});
