import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { PORTABLE_LIMIT_BYTES, type PortableManifest } from "../../src/core/portable/portableFormat.js";
import { writeStoreZip, type ZipEntrySource } from "./zipStore.js";
import { extractEntryToFile, readCentralDirectory, type ZipDirEntry } from "./zipRead.js";
import { importPortablePackageOnDesktop, inspectPortablePackage } from "./portableImport.js";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function bufEntry(name: string, data: string): ZipEntrySource {
  const bytes = Buffer.from(data, "utf8");
  return {
    name,
    size: bytes.length,
    mtime: new Date("2026-11-22T02:00:00Z"),
    read: async function* () { yield bytes; },
  };
}

function makeMainDb(file: string, marker: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY); CREATE TABLE tree_nodes (id TEXT PRIMARY KEY); CREATE TABLE settings (k TEXT); CREATE TABLE device_state (k TEXT);");
  db.prepare("INSERT INTO notes (id) VALUES (?)").run(marker);
  db.close();
}

function makeQuickDb(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE quick_notes (id TEXT PRIMARY KEY); CREATE TABLE tags (id TEXT); CREATE TABLE tag_links (id TEXT); CREATE TABLE tag_link_versions (id TEXT);");
  db.close();
}

const BASELINE = { epoch: "e-1", generation: 3, lakeCommit: "lc", quickNotesCommit: "qc", lake: { notes: [] }, quickNotes: { quickNotes: [] } };

function buildManifest(overrides: Partial<PortableManifest> = {}): string {
  const manifest = {
    format: "lakex-local-notes-portable",
    formatVersion: 2,
    appVersion: "1.5.5",
    exportedAt: "2026-11-22T02:00:00Z",
    source: { platform: "desktop" },
    layout: "desktop-workspace",
    limitBytes: PORTABLE_LIMIT_BYTES,
    counts: { notes: 1, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 10 },
    baseline: { epoch: "e-1", generation: 3, lakeCommit: "lc", quickNotesCommit: "qc" },
    ...overrides,
  };
  return JSON.stringify(manifest, null, 2);
}

/** 造一个 desktop-workspace v2 包（真 SQLite 两库 + 正文 + 基线 JSON）。 */
async function makeDesktopPackage(target: string, opts: { baseline?: "cloud" | "offline" | "none"; withQuick?: boolean; corruptBaseline?: boolean } = {}): Promise<string> {
  const tmp = tempDir("lakex-pkg-db-");
  const mainDb = path.join(tmp, "metadata.sqlite3");
  const quickDb = path.join(tmp, "quick-metadata.sqlite3");
  makeMainDb(mainDb, "n-from-package");
  makeQuickDb(quickDb);
  const baselineMode = opts.baseline ?? "cloud";
  const manifest = buildManifest(baselineMode === "offline" || baselineMode === "none"
    ? { baseline: null }
    : {});
  const entries: ZipEntrySource[] = [
    bufEntry("portable.json", manifest),
    { name: "desktop/metadata.sqlite3", size: fs.statSync(mainDb).size, mtime: new Date(), read: () => fs.createReadStream(mainDb) as unknown as AsyncIterable<Uint8Array> },
  ];
  if (opts.withQuick !== false) {
    entries.push({ name: "desktop/quick-notes/metadata.sqlite3", size: fs.statSync(quickDb).size, mtime: new Date(), read: () => fs.createReadStream(quickDb) as unknown as AsyncIterable<Uint8Array> });
  }
  entries.push(bufEntry("desktop/notes/n1.lake", "<p>pkg</p>"));
  if (opts.corruptBaseline === true) entries.push(bufEntry("desktop/sync-v3/baseline.json", "NOT-JSON{{{"));
  else if (baselineMode === "cloud") entries.push(bufEntry("desktop/sync-v3/baseline.json", JSON.stringify(BASELINE)));
  if (baselineMode === "offline") entries.push(bufEntry("desktop/sync-v3/baseline.json", JSON.stringify({ localOnly: true, notes: { n1: "h" }, quickNotes: {} })));
  fs.mkdirSync(target, { recursive: true });
  const zipPath = path.join(target, "lakex-portable-20261122-020000.zip.lln");
  await writeStoreZip(zipPath, entries);
  return zipPath;
}

function makeWorkspace(tmp: string): string {
  const ws = path.join(tmp, "workspace-default");
  fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
  fs.writeFileSync(path.join(ws, "notes", "old.lake"), "<p>old</p>");
  makeMainDb(path.join(ws, "metadata.sqlite3"), "n-old");
  return ws;
}

describe("portableImport（桌面导入大统一迁移包 v2）", () => {
  it("inspectPortablePackage：v2 通过；坏后缀 / v1 清单 / 条目上限拒绝", async () => {
    const target = tempDir("lakex-pkg-out-");
    const zipPath = await makeDesktopPackage(target);
    const inspection = inspectPortablePackage(zipPath);
    expect(inspection.manifest.formatVersion).toBe(2);
    expect(inspection.entries).toBe(5);
    expect(() => inspectPortablePackage(zipPath.replace(/\.zip\.lln$/, ".zip"))).toThrow(".zip.lln");
    expect(() => inspectPortablePackage(zipPath, { maxEntries: 2 })).toThrow("条目过多");
    // v1 清单（formatVersion 1）拒绝：不写兼容
    const v1Zip = path.join(target, "v1.zip.lln");
    await writeStoreZip(v1Zip, [bufEntry("portable.json", buildManifest({ formatVersion: 1 as unknown as 2 }))]);
    expect(() => inspectPortablePackage(v1Zip)).toThrow("格式版本不支持");
  });

  it("desktop-workspace 包导入：staging 换位 + baseline 转 gz + 旧工作区隔离", async () => {
    const tmp = tempDir("lakex-pkg-ws-");
    const zipPath = await makeDesktopPackage(path.join(tmp, "out"));
    const ws = makeWorkspace(tmp);
    const result = importPortablePackageOnDesktop({
      zipPath,
      workspaceRoot: ws,
      stagingParent: path.join(tmp, "portable-import"),
    });
    expect(result.ok).toBe(true);
    expect(result.requiresRestart).toBe(true);
    expect(result.quickNotesRestored).toBe(true);
    // 新工作区 = 包内容
    expect(fs.readFileSync(path.join(ws, "notes", "n1.lake"), "utf8")).toBe("<p>pkg</p>");
    const main = new Database(path.join(ws, "metadata.sqlite3"), { readonly: true });
    try { expect((main.prepare("SELECT id FROM notes").all() as Array<{ id: string }>).map((r) => r.id)).toEqual(["n-from-package"]); } finally { main.close(); }
    // baseline：JSON → baseline.json.gz（内容一致），原 JSON 不留
    const gz = path.join(ws, "sync-v3", "baseline.json.gz");
    expect(fs.existsSync(gz)).toBe(true);
    expect(JSON.parse(gunzipSync(fs.readFileSync(gz)).toString("utf8"))).toEqual(BASELINE);
    expect(fs.existsSync(path.join(ws, "sync-v3", "baseline.json"))).toBe(false);
    // 旧工作区隔离保留
    expect(fs.readFileSync(path.join(result.quarantinePath!, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
  });

  it("纯离线包（baseline=null）：内容哈希清单不写桌面基线", async () => {
    const tmp = tempDir("lakex-pkg-ws-");
    const zipPath = await makeDesktopPackage(path.join(tmp, "out"), { baseline: "offline" });
    const ws = makeWorkspace(tmp);
    const result = importPortablePackageOnDesktop({ zipPath, workspaceRoot: ws, stagingParent: path.join(tmp, "portable-import") });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(ws, "sync-v3", "baseline.json.gz"))).toBe(false);
    expect(fs.existsSync(path.join(ws, "sync-v3", "baseline.json"))).toBe(false);
  });

  it("坏基线不阻断迁移：按无基线导入并在消息里明说", async () => {
    const tmp = tempDir("lakex-pkg-ws-");
    const zipPath = await makeDesktopPackage(path.join(tmp, "out"), { corruptBaseline: true });
    const ws = makeWorkspace(tmp);
    const result = importPortablePackageOnDesktop({ zipPath, workspaceRoot: ws, stagingParent: path.join(tmp, "portable-import") });
    expect(result.ok, "导入失败原因：" + result.reason).toBe(true);
    expect(fs.existsSync(path.join(ws, "sync-v3", "baseline.json.gz"))).toBe(false);
    expect(result.message).toContain("无基线");
  });

  it("包损坏（CRC 不符）⇒ 失败且本机数据未动；staging 清理", async () => {
    const tmp = tempDir("lakex-pkg-ws-");
    const zipPath = await makeDesktopPackage(path.join(tmp, "out"));
    // 翻转正文条目区的一个字节（store 条目数据紧随本地头）
    const buffer = fs.readFileSync(zipPath);
    const directory = readCentralDirectory(zipPath);
    const entry = directory.entries.find((item) => item.name === "desktop/notes/n1.lake")!;
    const head = buffer.subarray(entry.localHeaderOffset, entry.localHeaderOffset + 30);
    const dataStart = entry.localHeaderOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    buffer[dataStart] = buffer[dataStart]! ^ 0xff;
    fs.writeFileSync(zipPath, buffer);
    const ws = makeWorkspace(tmp);
    const result = importPortablePackageOnDesktop({ zipPath, workspaceRoot: ws, stagingParent: path.join(tmp, "portable-import") });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("CRC");
    expect(fs.readFileSync(path.join(ws, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
    expect(fs.readdirSync(path.join(tmp, "portable-import"))).toEqual([]);
  });

  it("zip-slip 条目名一律拒绝；mobile-snapshot 包缺手机数据库给可执行报错", async () => {
    const target = tempDir("lakex-pkg-out-");
    const zipPath = await makeDesktopPackage(target);
    const directory = readCentralDirectory(zipPath);
    const evil: ZipDirEntry = { ...directory.entries[0]!, name: "../evil.txt" };
    expect(() => extractEntryToFile(zipPath, evil, path.join(target, "out.txt"))).toThrow("路径非法");
    const snapZip = path.join(target, "snap.zip.lln");
    await writeStoreZip(snapZip, [bufEntry("portable.json", buildManifest({
      source: { platform: "mobile" } as never,
      layout: "mobile-snapshot" as never,
    }))]);
    const ws = makeWorkspace(target);
    const result = importPortablePackageOnDesktop({ zipPath: snapZip, workspaceRoot: ws, stagingParent: path.join(target, "portable-import") });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("手机数据库");
  });
});
