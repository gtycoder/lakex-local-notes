import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, indexHashOf, parseLakeIndexBytes, serializeLakeIndex, serializeDeclaration, type LakeIndex, type LakeNoteEntry } from "./s3v3/protocol/s3v3Index.js";
import { planLakeMerge } from "./s3v3Merge.js";
import { planLakeDeletes } from "./s3v3Gc.js";

const H = (s: string) => sha256Hex(new TextEncoder().encode(s));
const SIZES = (process.env.S3V3_CAP_SIZES || "10000,20000,50000").split(",").map(Number);
const ASSETS_PER_DOC = Number(process.env.S3V3_CAP_ASSETS || 10);

function buildWorld(docs: number) {
  const notes: LakeNoteEntry[] = [];
  const declarations = new Map<string, { declHash: string; filenames: string[] }>();
  let declBytes = 0;
  for (let i = 0; i < docs; i++) {
    const id = "n" + String(i).padStart(7, "0");
    const assets = Array.from({ length: ASSETS_PER_DOC }, (_, a) => ({ filename: "f" + a + ".png", size: 1024 + a, hash: H(id + "/" + a) }));
    const built = buildAssetDeclaration(assets);
    declarations.set(id, { declHash: built.declHash, filenames: assets.map((x) => x.filename) });
    declBytes += serializeDeclaration(built.declaration).length;
    notes.push({ id, title: "Doc " + i, parentId: null, sortOrder: i, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: H("body-" + id), assetsHash: built.declHash });
  }
  return { index: { v: 3, space: "lake", notes, folders: [] } as LakeIndex, declarations, declBytes };
}

describe("容量拐点（索引/声明，合成数据）", () => {
  it("10k/20k/50k 文档 × 10 附件：体积/解析/合并/GC 耗时", () => {
    const results = [];
    for (const docs of SIZES) {
      const t0 = performance.now();
      const { index, declarations, declBytes } = buildWorld(docs);
      const buildMs = performance.now() - t0;
      const t1 = performance.now();
      const serialized = serializeLakeIndex(index);
      const commit = indexHashOf(serialized);
      const serMs = performance.now() - t1;
      const t2 = performance.now();
      const parsed = parseLakeIndexBytes(new TextEncoder().encode(serialized));
      const parseMs = performance.now() - t2;
      const remoteIndex = { ...index, notes: index.notes.map((n, i) => i % 1000 === 0 ? { ...n, contentHash: H("remote-" + n.id), updatedAt: "2026-10-26T00:00:00.000Z" } : n) };
      const localIndex = { ...index, notes: index.notes.map((n, i) => i % 1000 === 1 ? { ...n, contentHash: H("local-" + n.id), updatedAt: "2026-10-26T00:00:00.000Z" } : n) };
      const t3 = performance.now();
      const plan = planLakeMerge(index, localIndex, remoteIndex, { restorePending: new Set(), purgeIntents: new Set(), folderPurgeIntents: new Set() });
      const mergeMs = performance.now() - t3;
      const nextIndex = { ...remoteIndex, notes: remoteIndex.notes.filter((_, i) => i % 200 !== 0) } as LakeIndex;
      const t4 = performance.now();
      const deletes = planLakeDeletes({ previous: remoteIndex, next: nextIndex, previousDecls: declarations, nextDecls: declarations, previousCommit: commit, nextCommit: H("next-commit") });
      const gcMs = performance.now() - t4;
      results.push({ docs, assets: docs * ASSETS_PER_DOC, indexBytes: serialized.length, declBytes, buildMs: Math.round(buildMs), serMs: Math.round(serMs), parseMs: Math.round(parseMs), mergeMs: Math.round(mergeMs), gcMs: Math.round(gcMs), planEntries: plan.notes.length, deletes: deletes.length, parsedOk: parsed.commit === commit });
      console.log("CAP " + JSON.stringify(results[results.length - 1]));
    }
    expect(results.every((r) => r.parsedOk)).toBe(true);
  }, 600_000);
});
