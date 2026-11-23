
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PORTABLE_LIMIT_BYTES } from "../../src/core/portable/portableFormat.js";
import { crc32 } from "./zipStore.js";
import { importPortablePackageOnDesktop } from "./portableImport.js";

/**
 * 原子性 / 崩溃档（261123 lead 点单）：导入中途失败必须让工作区**完整回到导入前状态**
 * （或明确可恢复），绝不允许半迁移状态；二次导入幂等；换位失败走回滚。
 * 隔离目录名 = workspace-pre-restore-<ISO 秒级时间戳>（workspaceBackup.ts）⇒ 同秒两次导入
 * 会撞名，这里把「碰撞时原工作区必须完好」也钉住（characterization + 不变量）。
 */

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.useRealTimers();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

interface RawEntry { name: string; data: Buffer; crcOverride?: number }

function buildRawZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = entry.crcOverride ?? crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0x2821, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2821, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, entry.data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + entry.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const S = (s: string) => Buffer.from(s, "utf8");
const MANIFEST = JSON.stringify({
  format: "lakex-local-notes-portable",
  formatVersion: 2,
  appVersion: "1.5.6",
  exportedAt: "2026-11-23T02:00:00Z",
  source: { platform: "desktop" },
  layout: "desktop-workspace",
  limitBytes: PORTABLE_LIMIT_BYTES,
  counts: { notes: 1, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 10 },
  baseline: null,
}, null, 2);

function mainDbBytes(marker: string): Buffer {
  const dir = tempDir("lakex-atom-db-");
  const file = path.join(dir, "metadata.sqlite3");
  const db = new Database(file);
  db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY); CREATE TABLE tree_nodes (id TEXT PRIMARY KEY); CREATE TABLE settings (k TEXT); CREATE TABLE device_state (k TEXT);");
  db.prepare("INSERT INTO notes (id) VALUES (?)").run(marker);
  db.close();
  return fs.readFileSync(file);
}

/** 带哨兵正文的合法包：workspace 导入后出现 notes/<sentinel>.lake。 */
function makePackage(sentinel: string, extra: RawEntry[] = [], dbBytes?: Buffer): string {
  const zip = path.join(tempDir("lakex-atom-zip-"), sentinel + ".zip.lln");
  fs.writeFileSync(zip, buildRawZip([
    { name: "portable.json", data: S(MANIFEST) },
    { name: "desktop/notes/" + sentinel + ".lake", data: S("body-of-" + sentinel) },
    { name: "desktop/metadata.sqlite3", data: dbBytes ?? mainDbBytes("row-" + sentinel) },
    ...extra,
  ]));
  return zip;
}

function makeTargetWorkspace(): { root: string; marker: string } {
  const root = path.join(tempDir("lakex-atom-ws-"), "workspace");
  fs.mkdirSync(path.join(root, "notes"), { recursive: true });
  const marker = path.join(root, "MARKER.txt");
  fs.writeFileSync(marker, "original");
  fs.writeFileSync(path.join(root, "notes", "old.lake"), "old-body");
  return { root, marker };
}

function importTo(zipPath: string, workspaceRoot: string, stagingParent: string) {
  return importPortablePackageOnDesktop({ zipPath, workspaceRoot, stagingParent });
}

function expectOriginalIntact(ws: { root: string; marker: string }): void {
  expect(fs.existsSync(ws.marker), "半迁移状态：原工作区 marker 丢失").toBe(true);
  expect(fs.readFileSync(ws.marker, "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(ws.root, "notes", "old.lake"), "utf8")).toBe("old-body");
}

describe("导入原子性：中途失败必须完整回滚", () => {
  it("解包中途 CRC 失败：工作区原样、staging 清空、无隔离目录残留", () => {
    const ws = makeTargetWorkspace();
    const staging = tempDir("lakex-atom-staging-");
    const zip = makePackage("mid-fail", [
      { name: "desktop/notes/bad.lake", data: S("corrupted"), crcOverride: 999 },
    ]);
    const result = importTo(zip, ws.root, staging);
    expect(result.ok).toBe(false);
    expectOriginalIntact(ws);
    expect(fs.readdirSync(staging)).toEqual([]);
    const siblings = fs.readdirSync(path.dirname(ws.root));
    expect(siblings.some((n) => n.startsWith("workspace-pre-restore-"))).toBe(false);
  });

  it("包内主库校验失败（垃圾字节）：工作区原样", () => {
    const ws = makeTargetWorkspace();
    const staging = tempDir("lakex-atom-staging-");
    const zip = makePackage("bad-db", [], S("this is not a sqlite database at all...."));
    const result = importTo(zip, ws.root, staging);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/校验未通过|数据库/);
    expectOriginalIntact(ws);
    expect(fs.readdirSync(staging)).toEqual([]);
  });

  it("staging 目录建不出来（父路径是文件）：直接失败，工作区原样", () => {
    const ws = makeTargetWorkspace();
    const fileAsDir = path.join(tempDir("lakex-atom-file-"), "regular-file");
    fs.writeFileSync(fileAsDir, "x");
    const zip = makePackage("no-staging");
    const result = importTo(zip, ws.root, path.join(fileAsDir, "staging"));
    expect(result.ok).toBe(false);
    expectOriginalIntact(ws);
  });

  it("换位失败（工作区父目录只读）：返回 ok:false + 换位失败 + rolledBack=true", () => {
    const guard = tempDir("lakex-atom-ro-");
    const wsRoot = path.join(guard, "workspace");
    fs.mkdirSync(path.join(wsRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(wsRoot, "MARKER.txt"), "original");
    fs.chmodSync(guard, 0o555);
    try {
      const zip = makePackage("swap-fail");
      const result = importTo(zip, wsRoot, tempDir("lakex-atom-staging-"));
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/换位失败/);
      expect(result.rolledBack).toBe(true);
    } finally {
      fs.chmodSync(guard, 0o755);
    }
  });

  // 【P0 缺陷复现 electron/workspaceBackup.ts:135】换位失败的 catch 里
  // fs.rmSync(workspaceRoot, { recursive: true, force: true }) 在隔离 rename 失败后会把
  // **原工作区**（此时 workspaceRoot 还是用户数据）递归删掉；父目录只读时内容被清空只剩根壳。
  // 不变量「换位失败 ⇒ 原工作区完好」当前**不成立** ⇒ 用 it.fails 钉住：缺陷在 = 绿；
  // 修复后本用例翻红 ⇒ 把 it.fails 改回 it 即完成闭环。回滚语义应只清理「materialize 半成品」
  // （quarantined === true 时的 workspaceRoot），quarantined === false 时绝不能碰 workspaceRoot。
  it.fails("【P0 缺陷复现】换位失败不得毁掉原工作区（修复后翻红 ⇒ 改回普通 it）", () => {
    const guard = tempDir("lakex-atom-ro-");
    const wsRoot = path.join(guard, "workspace");
    fs.mkdirSync(path.join(wsRoot, "notes"), { recursive: true });
    fs.writeFileSync(path.join(wsRoot, "MARKER.txt"), "original");
    fs.chmodSync(guard, 0o555);
    try {
      const result = importTo(makePackage("swap-fail-ro"), wsRoot, tempDir("lakex-atom-staging-"));
      expect(result.ok).toBe(false);
      expect(fs.readFileSync(path.join(wsRoot, "MARKER.txt"), "utf8"), "原工作区 marker 被回滚路径误删").toBe("original");
      expect(fs.readFileSync(path.join(wsRoot, "notes", "old.lake"), "utf8")).toBe("old-body");
    } finally {
      fs.chmodSync(guard, 0o755);
    }
  });
});

describe("导入原子性：成功换位与二次导入", () => {
  it("成功导入 = 原工作区隔离保留 + 新内容生效 + 需重启", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T02:00:00Z"));
    const ws = makeTargetWorkspace();
    const result = importTo(makePackage("pkg-ok"), ws.root, tempDir("lakex-atom-staging-"));
    expect(result.ok).toBe(true);
    expect(result.requiresRestart).toBe(true);
    expect(result.quarantinePath).toBeTruthy();
    expect(fs.readFileSync(path.join(result.quarantinePath!, "MARKER.txt"), "utf8")).toBe("original");
    expect(fs.readFileSync(path.join(ws.root, "notes", "pkg-ok.lake"), "utf8")).toBe("body-of-pkg-ok");
  });

  it("二次导入（时间推进 ≥1s）：幂等成功、各自隔离、旧隔离不丢", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T02:00:00Z"));
    const ws = makeTargetWorkspace();
    const first = importTo(makePackage("pkg-a"), ws.root, tempDir("lakex-atom-staging-"));
    expect(first.ok).toBe(true);
    vi.setSystemTime(new Date("2026-11-23T02:00:01Z"));
    const second = importTo(makePackage("pkg-b"), ws.root, tempDir("lakex-atom-staging-"));
    expect(second.ok).toBe(true);
    expect(fs.readFileSync(path.join(ws.root, "notes", "pkg-b.lake"), "utf8")).toBe("body-of-pkg-b");
    // 两个隔离目录都在：原始工作区（MARKER）与第一次导入的内容（pkg-a）
    const quarantines = fs.readdirSync(path.dirname(ws.root)).filter((n) => n.startsWith("workspace-pre-restore-"));
    expect(quarantines.length).toBe(2);
    const all = quarantines.map((n) => fs.readdirSync(path.join(path.dirname(ws.root), n)).join(",")).join("|");
    expect(all).toContain("MARKER.txt");
    expect(all).toContain("notes");
  });

  it("同秒两次导入（隔离名碰撞）：第二次返回可读失败原因（characterization）", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T02:00:00Z"));
    const ws = makeTargetWorkspace();
    const first = importTo(makePackage("same-a"), ws.root, tempDir("lakex-atom-staging-"));
    expect(first.ok).toBe(true);
    // 同一秒再导一次：隔离目录名 workspace-pre-restore-<ISO 秒> 相同 ⇒ rename ENOTEMPTY
    const second = importTo(makePackage("same-b"), ws.root, tempDir("lakex-atom-staging-"));
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/换位失败/);
  });

  // 【P0 缺陷复现 electron/workspaceBackup.ts:135，同上根因】同秒二次导入撞隔离名后，
  // catch 的 recursive rmSync 把「第一次导入刚换进来的工作区」整个删掉（实测目录直接消失）。
  // 叠加缺陷：隔离目录名是秒级时间戳（quarantineDirName）⇒ 双击导入/恢复必撞名；
  // 修复建议 = ① catch 只在 quarantined===true 时清 materialize 半成品；② 隔离名加防碰撞后缀。
  it.fails("【P0 缺陷复现】同秒二次导入不得毁掉工作区（修复后翻红 ⇒ 改回普通 it）", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T02:00:00Z"));
    const ws = makeTargetWorkspace();
    expect(importTo(makePackage("same-a2"), ws.root, tempDir("lakex-atom-staging-")).ok).toBe(true);
    importTo(makePackage("same-b2"), ws.root, tempDir("lakex-atom-staging-"));
    expect(fs.existsSync(ws.root), "同秒二次导入后工作区目录消失 = 丢数据").toBe(true);
    expect(fs.readFileSync(path.join(ws.root, "notes", "same-a2.lake"), "utf8"), "第一次导入的内容被误删").toBe("body-of-same-a2");
  });
});
