
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { PORTABLE_LIMIT_BYTES, assertPortableSize, parsePortableManifest } from "../../src/core/portable/portableFormat.js";
import { noteBodyRelativePath } from "../../src/core/noteBodyPaths.js";
import { buildOfflineHashes, collectPortableFiles, computePortableCounts, exportPortablePackage } from "./portableExport.js";
import { inspectPortablePackage, importPortablePackageOnDesktop, PORTABLE_MAX_ENTRIES } from "./portableImport.js";
import { readCentralDirectory, readEntryData, sumEntrySizes } from "./zipRead.js";
import { writeStoreZip, type ZipEntrySource } from "./zipStore.js";

/**
 * 规模档（261123 lead 点单；测试规模口径 = 5k 文档 / 1万附件，另设 1k/2k 中档看趋势）：
 * 便携包**导出→导入往返一致性** + 关键路径耗时/内存/包体测量。默认 skip，按需跑：
 *   LLN_SCALE=1 npx vitest run electron/portable/portableScale.scale.test.ts
 * 边界行为（MAX_ENTRIES / ZIP64 >65535 条目 / 4GiB 口径）与审计压测项
 * ① buildOfflineHashes 全量读盘、④ 中央目录高条目解析 也收在本文件。
 * 报告行以 "SCALE-REPORT" 前缀打到 stdout（JSON），供 lead 汇总。
 */

const SCALE = !!process.env.LLN_SCALE;

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
function report(tag: string, data: Record<string, unknown>): void {
  console.log("SCALE-REPORT " + JSON.stringify({ tag, ...data }));
}

function seedWorkspace(root: string, docs: number, assetsPerDoc: number): { assetCount: number } {
  fs.mkdirSync(path.join(root, "notes"), { recursive: true });
  for (let i = 0; i < docs; i++) {
    const id = "n" + String(i).padStart(6, "0");
    fs.writeFileSync(path.join(root, noteBodyRelativePath("doc", id)), "body-" + id + "-".repeat(64));
  }
  let assetCount = 0;
  for (let i = 0; i < docs; i++) {
    const id = "n" + String(i).padStart(6, "0");
    const dir = path.join(root, "note-assets", id);
    fs.mkdirSync(dir, { recursive: true });
    for (let a = 0; a < assetsPerDoc; a++) {
      fs.writeFileSync(path.join(dir, "f" + a + ".png"), "asset-" + id + "-" + a);
      assetCount += 1;
    }
  }
  return { assetCount };
}

function writeMainDb(file: string, docs: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, content_hash TEXT, kind TEXT);"
    + " CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, node_type TEXT, title TEXT, parent_id TEXT, sort_order INTEGER, updated_at TEXT, is_purged INTEGER, note_file_id TEXT);"
    + " CREATE TABLE settings (k TEXT); CREATE TABLE device_state (k TEXT);");
  const insert = db.prepare("INSERT INTO notes (id, title, content_hash, kind) VALUES (?,?,?,?)");
  const insertTree = db.prepare("INSERT INTO tree_nodes (id, node_type, title, parent_id, sort_order, updated_at, is_purged, note_file_id) VALUES (?,?,?,'',0,'2026-11-23T00:00:00.000Z',0,?)");
  const tx = db.transaction(() => {
    for (let i = 0; i < docs; i++) {
      const id = "n" + String(i).padStart(6, "0");
      insert.run(id, "Doc " + i, "h".repeat(64), "doc");
      insertTree.run(id, "note", "Doc " + i, id);
    }
  });
  tx();
  db.close();
}

function writeQuickDb(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE quick_notes (id TEXT PRIMARY KEY); CREATE TABLE tags (id TEXT); CREATE TABLE tag_links (id TEXT); CREATE TABLE tag_link_versions (id TEXT);");
  db.close();
}

function makeSnapshot(targetRoot: string, sourceDb: string): void {
  fs.mkdirSync(path.join(targetRoot, "quick-notes"), { recursive: true });
  fs.copyFileSync(sourceDb, path.join(targetRoot, "metadata.sqlite3"));
  writeQuickDb(path.join(targetRoot, "quick-notes", "metadata.sqlite3"));
}

function countFiles(root: string): number {
  let n = 0;
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n += 1;
    }
  };
  walk(root);
  return n;
}

const memMb = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

describe.skipIf(!SCALE)("便携包规模档：导出→导入往返（5k 文档/1万附件为主档）", () => {
  const tiers = [
    { name: "mid-1k-docs-2k-assets", docs: 1000, assetsPerDoc: 2 },
    { name: "main-5k-docs-10k-assets", docs: 5000, assetsPerDoc: 2 },
  ];
  for (const tier of tiers) {
    it("往返一致性 + 耗时/内存：" + tier.name, async () => {
      const base = tempDir("lakex-scale-" + tier.name + "-");
      const workspace = path.join(base, "workspace");
      const targetDir = path.join(base, "out");
      const freshRoot = path.join(base, "fresh-workspace");
      const staging = path.join(base, "staging");

      const heap0 = memMb();
      const t0 = performance.now();
      const { assetCount } = seedWorkspace(workspace, tier.docs, tier.assetsPerDoc);
      const dbFile = path.join(base, "seed", "metadata.sqlite3");
      writeMainDb(dbFile, tier.docs);
      const seedMs = performance.now() - t0;

      // 审计①：buildOfflineHashes 全量正文读盘的耗时/内存
      const snapshotRoot = path.join(base, "snapshot");
      makeSnapshot(snapshotRoot, dbFile);
      const heapBeforeHash = memMb();
      const th = performance.now();
      const hashes = buildOfflineHashes(workspace, snapshotRoot);
      const offlineHashMs = performance.now() - th;
      const hashMemDeltaMb = memMb() - heapBeforeHash;

      // 导出（产品真实导出函数；快照/计数按 main 同款口径注入）
      const t1 = performance.now();
      await exportPortablePackage({
        workspaceRoot: workspace,
        targetDir,
        appVersion: "1.5.6",
        snapshotDatabases: (tr) => makeSnapshot(tr, dbFile),
        counts: { folders: 0, quickNotes: 0, tags: 0 },
        offlineHashes: () => hashes,
      });
      const exportMs = performance.now() - t1;
      const zipName = fs.readdirSync(targetDir).find((n) => n.endsWith(".zip.lln"))!;
      const zipPath = path.join(targetDir, zipName);
      const zipBytes = fs.statSync(zipPath).size;

      // 只读校验 + 清单自洽
      const t2 = performance.now();
      const inspection = inspectPortablePackage(zipPath);
      const inspectMs = performance.now() - t2;
      const directory = readCentralDirectory(zipPath);
      expect(inspection.entries).toBe(directory.entries.length);
      // 往返一致性：条目数 = 1 manifest + 2 db + docs 正文 + assets + 离线哈希清单
      expect(inspection.entries).toBe(1 + 2 + tier.docs + assetCount + 1);
      const manifestEntry = directory.entries.find((e) => e.name === "portable.json")!;
      const manifest = parsePortableManifest(JSON.parse(readEntryData(zipPath, manifestEntry).toString("utf8")));
      expect(manifest.counts.notes).toBe(tier.docs);
      expect(manifest.counts.assets).toBe(assetCount);
      expect(sumEntrySizes(directory.entries)).toBe(directory.dataBytes);

      // 导入（产品真实导入函数）→ 全新工作区
      const t3 = performance.now();
      const imported = importPortablePackageOnDesktop({ zipPath, workspaceRoot: freshRoot, stagingParent: staging });
      const importMs = performance.now() - t3;
      expect(imported.ok, imported.reason ?? "").toBe(true);

      // 往返一致性：正文/资产文件集合与字节一致
      const srcBodies = fs.readdirSync(path.join(workspace, "notes")).sort();
      const dstBodies = fs.readdirSync(path.join(freshRoot, "notes")).sort();
      expect(dstBodies).toEqual(srcBodies);
      for (const f of srcBodies.slice(0, 20)) {
        expect(fs.readFileSync(path.join(freshRoot, "notes", f), "utf8")).toBe(fs.readFileSync(path.join(workspace, "notes", f), "utf8"));
      }
      expect(countFiles(path.join(freshRoot, "note-assets"))).toBe(assetCount);
      // 纯离线包按 PORTABLE-TRANSFER §3.1 合成合并底稿基线
      expect(fs.existsSync(path.join(freshRoot, "sync-v3", "baseline.json.gz"))).toBe(true);

      report(tier.name, {
        docs: tier.docs,
        assets: assetCount,
        seedMs: Math.round(seedMs),
        offlineHashMs: Math.round(offlineHashMs),
        hashMemDeltaMb,
        exportMs: Math.round(exportMs),
        inspectMs: Math.round(inspectMs),
        importMs: Math.round(importMs),
        zipMb: +(zipBytes / 1024 / 1024).toFixed(2),
        entries: inspection.entries,
        dataMb: +(inspection.dataBytes / 1024 / 1024).toFixed(2),
        heapStartMb: heap0,
        heapEndMb: memMb(),
      });
      fs.rmSync(path.join(workspace, "note-assets"), { recursive: true, force: true });
      fs.rmSync(path.join(freshRoot, "note-assets"), { recursive: true, force: true });
    }, 600_000);
  }
});

describe.skipIf(!SCALE)("边界行为：MAX_ENTRIES / ZIP64 高条目 / 4GiB 口径", () => {
  it("66k 小条目 zip：ZIP64 中央目录解析（审计④）+ maxEntries 夹紧", async () => {
    const dir = tempDir("lakex-scale-zip64-");
    const zipPath = path.join(dir, "many.zip.lln");
    const N = 66_000;
    const manifestBytes = Buffer.from(JSON.stringify({
      format: "lakex-local-notes-portable", formatVersion: 2, appVersion: "1.5.6", exportedAt: "2026-11-23T00:00:00Z",
      source: { platform: "desktop" }, layout: "desktop-workspace", limitBytes: PORTABLE_LIMIT_BYTES,
      counts: { notes: 0, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 1 }, baseline: null,
    }), "utf8");
    const entries: ZipEntrySource[] = [
      { name: "portable.json", size: manifestBytes.length, mtime: new Date(), read: async function* () { yield manifestBytes; } },
    ];
    for (let i = 0; i < N; i++) {
      const data = Buffer.from("x", "utf8");
      entries.push({ name: "desktop/notes/n" + String(i).padStart(6, "0") + ".lake", size: 1, mtime: new Date(), read: async function* () { yield data; } });
    }
    const heap0 = memMb();
    const t0 = performance.now();
    await writeStoreZip(zipPath, entries);
    const writeMs = performance.now() - t0;
    const t1 = performance.now();
    const directory = readCentralDirectory(zipPath);
    const parseMs = performance.now() - t1;
    report("zip64-66k-entries", {
      entries: directory.entries.length,
      writeMs: Math.round(writeMs),
      centralParseMs: Math.round(parseMs),
      heapDeltaMb: memMb() - heap0,
      zipMb: +(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2),
    });
    expect(directory.entries.length).toBe(N + 1);
    expect(directory.entries.length).toBeGreaterThan(65535); // ZIP64 场景
    expect(PORTABLE_MAX_ENTRIES).toBe(500_000); // 改口径先过 PORTABLE-TRANSFER（Kotlin 同值）
    expect(() => inspectPortablePackage(zipPath, { maxEntries: N })).toThrow(/条目过多/);
    expect(inspectPortablePackage(zipPath).entries).toBe(N + 1);
    fs.rmSync(zipPath, { force: true });
  }, 600_000);

  it("4GiB 口径：assertPortableSize 99% 余量 + collectPortableFiles 字节和对齐", () => {
    expect(() => assertPortableSize(Math.floor(PORTABLE_LIMIT_BYTES * 0.98))).not.toThrow();
    expect(() => assertPortableSize(Math.floor(PORTABLE_LIMIT_BYTES * 0.995))).toThrow(/4GiB/);
    const base = tempDir("lakex-scale-bytes-");
    const ws = path.join(base, "ws");
    seedWorkspace(ws, 10, 1);
    const files = collectPortableFiles(ws);
    const total = files.reduce((s, f) => s + f.size, 0);
    expect(total).toBeGreaterThan(0);
    expect(computePortableCounts(files, { folders: 0, quickNotes: 0, tags: 0 }, 0).bytes).toBe(total);
  });
});
