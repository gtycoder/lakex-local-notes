import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PORTABLE_LIMIT_BYTES, assertPortableSize, parsePortableManifest, type PortableExportProgress } from "../../src/core/portable/portableFormat.js";
import { exportPortablePackage } from "./portableExport.js";
import { readStoreZip } from "./zipRead.js";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

const BASELINE = {
  epoch: "e-2026-11-09",
  generation: 7,
  lakeCommit: "lake-commit",
  quickNotesCommit: "quick-commit",
  lake: { notes: [{ id: "n1" }] },
  quickNotes: { quickNotes: [] },
};

// v2 白名单：正文/资产/小记/草稿（draft-journal + quick-notes/staging）/画板素材都要进包。
const FILE_BYTES: Record<string, number> = {
  "notes/n1.lake": 10,
  "usheets/u1.usheet.json": 20,
  "bitables/b1.bitable.json": 30,
  "boards/br1.board.json": 40,
  "inks/i1.ink.json": 50,
  "note-assets/n1/a.png": 60,
  "quick-notes/items/q1.qnote": 70,
  "quick-notes/assets/q1/i.png": 80,
  "draft-journal/d1.json": 5,
  "quick-notes/staging/s1/i.png": 6,
  "materials/m1.board.json": 7,
};

function makeWorkspace(): string {
  const root = tempDir("lakex-portable-ws-");
  for (const [rel, size] of Object.entries(FILE_BYTES)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.alloc(size, 7));
  }
  fs.mkdirSync(path.join(root, "sync-v3"), { recursive: true });
  fs.writeFileSync(path.join(root, "sync-v3", "baseline.json.gz"), gzipSync(Buffer.from(JSON.stringify(BASELINE))));
  // 必须被排除的文件/目录（白名单遍历不应收集）
  fs.mkdirSync(path.join(root, "history"), { recursive: true });
  fs.writeFileSync(path.join(root, "history", "h1.lake"), "history");
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  fs.writeFileSync(path.join(root, "logs", "lake.log"), "log");
  fs.mkdirSync(path.join(root, "backups"), { recursive: true });
  fs.writeFileSync(path.join(root, "backups", "b.sqlite3"), "backup");
  fs.writeFileSync(path.join(root, "settings.json"), "{}");
  fs.writeFileSync(path.join(root, "window-state.json"), "{}");
  fs.writeFileSync(path.join(root, "sync-v3", "state.json"), JSON.stringify({ intents: [] }));
  fs.writeFileSync(path.join(root, "metadata.sqlite3"), "LIVE-DB-IS-NOT-PACKED");
  return root;
}

// 真 SQLite 快照（VACUUM INTO 产物的替身）：带历史索引行，验证导出时清零。
let snapshotDbBytes = 0;
function makeSnapshot(targetRoot: string): void {
  fs.mkdirSync(path.join(targetRoot, "quick-notes"), { recursive: true });
  const main = new Database(path.join(targetRoot, "metadata.sqlite3"));
  main.exec("CREATE TABLE notes (id TEXT PRIMARY KEY); CREATE TABLE note_history (id TEXT PRIMARY KEY); CREATE TABLE history_fallback_state (id TEXT PRIMARY KEY);");
  main.prepare("INSERT INTO notes (id) VALUES (?)").run("n-live");
  main.prepare("INSERT INTO note_history (id) VALUES (?)").run("h1");
  main.prepare("INSERT INTO note_history (id) VALUES (?)").run("h2");
  main.prepare("INSERT INTO history_fallback_state (id) VALUES (?)").run("f1");
  main.close();
  const quick = new Database(path.join(targetRoot, "quick-notes", "metadata.sqlite3"));
  quick.exec("CREATE TABLE quick_notes (id TEXT PRIMARY KEY);");
  quick.close();
  snapshotDbBytes = fs.statSync(path.join(targetRoot, "metadata.sqlite3")).size
    + fs.statSync(path.join(targetRoot, "quick-notes", "metadata.sqlite3")).size;
}

const COUNT_INPUT = { folders: 2, quickNotes: 4, tags: 3 };

describe("portableExport（桌面导出大统一迁移包 v2）", () => {
  it("生成 manifest + 全量白名单文件 + 解压后的 baseline；排除历史/日志/设置/同步意图", async () => {
    const workspace = makeWorkspace();
    const target = tempDir("lakex-portable-out-");
    const now = new Date("2026-11-09T12:00:00Z");
    const progress: PortableExportProgress[] = [];
    const result = await exportPortablePackage({
      workspaceRoot: workspace,
      targetDir: target,
      appVersion: "1.0.4",
      snapshotDatabases: makeSnapshot,
      counts: COUNT_INPUT,
      now: () => now,
      onProgress: (event) => progress.push(event),
    });

    expect(fs.existsSync(result.path)).toBe(true);
    expect(path.basename(result.path).endsWith(".zip.lln")).toBe(true);
    expect(result.entries).toBe(15);
    expect(result.bytes).toBe(fs.statSync(result.path).size);
    const entries = readStoreZip(result.path);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const names = [...byName.keys()];

    // 白名单条目齐全（含 v2 新增：草稿与画板素材）
    expect(names).toContain("portable.json");
    expect(names).toContain("desktop/metadata.sqlite3");
    expect(names).toContain("desktop/quick-notes/metadata.sqlite3");
    for (const rel of Object.keys(FILE_BYTES)) expect(names).toContain("desktop/" + rel);
    expect(names).toContain("desktop/sync-v3/baseline.json");
    // 排除项一个都不在
    for (const forbidden of ["desktop/history", "desktop/logs", "desktop/backups",
      "desktop/settings.json", "desktop/window-state.json", "desktop/sync-v3/state.json", "desktop/sync-v3/baseline.json.gz"]) {
      expect(names.some((name) => name.startsWith(forbidden))).toBe(false);
    }

    // 清单：v2（layout=desktop-workspace、无 hasHistory 字段）/上限/counts/baseline 与 spec 一致
    const manifestRaw = JSON.parse(byName.get("portable.json")!.data.toString("utf8")) as Record<string, unknown>;
    expect(manifestRaw).not.toHaveProperty("hasHistory");
    const manifest = parsePortableManifest(manifestRaw);
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.layout).toBe("desktop-workspace");
    expect(manifest.appVersion).toBe("1.0.4");
    expect(manifest.exportedAt).toBe(now.toISOString());
    expect(manifest.limitBytes).toBe(PORTABLE_LIMIT_BYTES);
    expect(manifest.counts.notes).toBe(5);
    expect(manifest.counts.assets).toBe(2);
    expect(manifest.counts.folders).toBe(2);
    expect(manifest.counts.quickNotes).toBe(4);
    expect(manifest.counts.tags).toBe(3);
    const expectedBytes = Object.values(FILE_BYTES).reduce((a, b) => a + b, 0)
      + snapshotDbBytes + Buffer.byteLength(JSON.stringify(BASELINE));
    expect(manifest.counts.bytes).toBe(expectedBytes);
    expect(manifest.baseline).toEqual({ epoch: BASELINE.epoch, generation: 7, lakeCommit: "lake-commit", quickNotesCommit: "quick-commit" });

    // baseline.json = 解压后的 JSON（不是 gz 字节）
    const baseline = JSON.parse(byName.get("desktop/sync-v3/baseline.json")!.data.toString("utf8"));
    expect(baseline).toEqual(BASELINE);
    // DB 快照来自注入回调（不是工作区活库）：真 SQLite，含 notes 种子行
    const extractDir = tempDir("lakex-portable-zdb-");
    const mainDbPath = path.join(extractDir, "metadata.sqlite3");
    fs.writeFileSync(mainDbPath, byName.get("desktop/metadata.sqlite3")!.data);
    const main = new Database(mainDbPath, { readonly: true });
    try {
      expect((main.prepare("SELECT id FROM notes").all() as Array<{ id: string }>).map((r) => r.id)).toEqual(["n-live"]);
      // 261122：历史快照不进包 ⇒ 快照库历史索引行必须清零（包内自洽，无悬空历史条目）
      expect((main.prepare("SELECT COUNT(*) AS n FROM note_history").get() as { n: number }).n).toBe(0);
      expect((main.prepare("SELECT COUNT(*) AS n FROM history_fallback_state").get() as { n: number }).n).toBe(0);
    } finally { main.close(); }

    // 进度：三个 phase 都出现，write 结束 filesDone = filesTotal
    expect(new Set(progress.map((event) => event.phase))).toEqual(new Set(["snapshot", "collect", "write"]));
    const last = progress[progress.length - 1]!;
    expect(last.filesDone).toBe(last.filesTotal);
  });

  it("同一时间戳重复导出不覆盖（自动加后缀）", async () => {
    const workspace = makeWorkspace();
    const target = tempDir("lakex-portable-out-");
    const options = { workspaceRoot: workspace, targetDir: target, appVersion: "1.0.4", snapshotDatabases: makeSnapshot, counts: COUNT_INPUT, now: () => new Date("2026-11-09T12:00:00Z") };
    const first = await exportPortablePackage(options);
    const second = await exportPortablePackage(options);
    expect(first.path).not.toBe(second.path);
    expect(fs.existsSync(first.path)).toBe(true);
    expect(fs.existsSync(second.path)).toBe(true);
  });

  it("缺同步基线 ⇒ 仍可离线导出：manifest.baseline=null，包内写内容哈希清单", async () => {
    const workspace = makeWorkspace();
    fs.rmSync(path.join(workspace, "sync-v3", "baseline.json.gz"));
    const target = tempDir("lakex-portable-out-");
    const hashes = Buffer.from(JSON.stringify({ localOnly: true, notes: { n1: "hash-n1" }, quickNotes: {} }));
    const result = await exportPortablePackage({
      workspaceRoot: workspace, targetDir: target, appVersion: "1.0.4",
      snapshotDatabases: makeSnapshot, counts: COUNT_INPUT, offlineHashes: () => hashes,
    });
    const entries = readStoreZip(result.path);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const manifest = JSON.parse(byName.get("portable.json")!.data.toString("utf8")) as { baseline: unknown };
    expect(manifest.baseline).toBeNull();
    expect(JSON.parse(byName.get("desktop/sync-v3/baseline.json")!.data.toString("utf8"))).toMatchObject({ localOnly: true });
  });

  it("超过上限（测试用小上限模拟 4GiB）⇒ 失败且不留 zip", async () => {
    const workspace = makeWorkspace();
    const target = tempDir("lakex-portable-out-");
    await expect(exportPortablePackage({
      workspaceRoot: workspace, targetDir: target, appVersion: "1.0.4",
      snapshotDatabases: makeSnapshot, counts: COUNT_INPUT, limitBytes: 100,
    })).rejects.toThrow("4GiB");
    expect(fs.readdirSync(target)).toEqual([]);
    // 生产上限常量本身也守住 4GiB 口径（261122 维持 4GiB，不做 5GiB）
    expect(() => assertPortableSize(PORTABLE_LIMIT_BYTES * 0.995)).toThrow();
  });
});
