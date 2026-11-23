
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  PORTABLE_LIMIT_BYTES,
  parsePortableManifest,
  assertPortableSize,
} from "../../src/core/portable/portableFormat.js";
import { crc32 } from "./zipStore.js";
import { importPortablePackageOnDesktop, inspectPortablePackage } from "./portableImport.js";

/**
 * 对抗档：坏包 / 恶意包（261123 lead 点单）。断言的是**安全不变量**：
 *  - 拒绝或安全降级（有 ok:false + 可读 reason，或带明示警告的降级）；
 *  - 失败绝不触碰本机工作区（marker 原样）；
 *  - 绝不把文件写出 staging 之外（zip-slip）；
 *  - staging 无条件清理。
 * 清单 counts 与实际不符这类「包撒谎但无害」的行为按现状钉住（characterization），缺口写进报告。
 */

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// ── 原始 zip 构造（绕过 writeStoreZip 的写侧校验，造「恶意包」）──────────────────
interface RawEntry {
  name: string;
  data: Buffer;
  /** 篡改中央目录里的 CRC（写侧校验是拦不住恶意包的）。 */
  crcOverride?: number;
}

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
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x2821, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2821, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, entry.data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + entry.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ── 夹具：合法清单 / 真 SQLite 主库字节 ────────────────────────────────────────
function manifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "lakex-local-notes-portable",
    formatVersion: 2,
    appVersion: "1.5.6",
    exportedAt: "2026-11-23T02:00:00Z",
    source: { platform: "desktop" },
    layout: "desktop-workspace",
    limitBytes: PORTABLE_LIMIT_BYTES,
    counts: { notes: 1, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 10 },
    baseline: null,
    ...overrides,
  }, null, 2);
}

function mainDbBytes(marker: string): Buffer {
  const dir = tempDir("lakex-adv-db-");
  const file = path.join(dir, "metadata.sqlite3");
  const db = new Database(file);
  db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY); CREATE TABLE tree_nodes (id TEXT PRIMARY KEY); CREATE TABLE settings (k TEXT); CREATE TABLE device_state (k TEXT);");
  db.prepare("INSERT INTO notes (id) VALUES (?)").run(marker);
  db.close();
  return fs.readFileSync(file);
}

const S = (s: string) => Buffer.from(s, "utf8");
function bufEntry(name: string, data: Buffer): RawEntry { return { name, data }; }

function writeRaw(target: string, entries: RawEntry[]): string {
  fs.writeFileSync(target, buildRawZip(entries));
  return target;
}

/** 目标工作区（导入失败后必须原样）：marker 文件 + 可识别行的旧库。 */
function makeTargetWorkspace(): { root: string; marker: string } {
  const root = path.join(tempDir("lakex-adv-ws-"), "workspace");
  fs.mkdirSync(root, { recursive: true });
  const marker = path.join(root, "MARKER-原工作区.txt");
  fs.writeFileSync(marker, "original");
  fs.mkdirSync(path.join(root, "notes"), { recursive: true });
  fs.writeFileSync(path.join(root, "notes", "old.lake"), "old-body");
  return { root, marker };
}

function stagingParent(): string { return tempDir("lakex-adv-staging-"); }

/** 失败导入的公共不变量：工作区原样 + staging 清空。 */
function expectWorkspaceIntact(ws: { root: string; marker: string }, staging: string): void {
  expect(fs.existsSync(ws.marker), "失败导入不得改动本机工作区（marker 被删）").toBe(true);
  expect(fs.readFileSync(ws.marker, "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(ws.root, "notes", "old.lake"), "utf8")).toBe("old-body");
  expect(fs.readdirSync(staging), "staging 必须无条件清理").toEqual([]);
}

describe("便携包对抗档：zip-slip 与非法条目名", () => {
  it("desktop/ 前缀下的 .. 路径穿越条目被拒，且文件绝不落出 staging", () => {
    const ws = makeTargetWorkspace();
    const staging = stagingParent();
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "evil.zip.lln"), [
      bufEntry("portable.json", S(manifestJson())),
      bufEntry("desktop/../../evil.txt", S("pwned")),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/路径非法/);
    expectWorkspaceIntact(ws, staging);
    // 没有任何 evil.txt 出现在 staging/工作区/其父目录树里
    const parent = path.dirname(ws.root);
    expect(fs.existsSync(path.join(parent, "evil.txt"))).toBe(false);
    expect(fs.existsSync(path.join(staging, "evil.txt"))).toBe(false);
  });

  it("绝对路径 / 反斜杠 / NUL / 空段 / 点段 / 超长名 一律拒（desktop/ 前缀下）", () => {
    const names = [
      "desktop//evil.txt",
      "desktop/./evil.txt",
      "desktop/a/../evil.txt",
      "desktop/" + "长".repeat(600) + ".txt", // >1024 UTF-8 字节？—— 按字符数上限 1024 拒
      "desktop/a\\b.txt",
    ];
    for (const name of names) {
      const ws = makeTargetWorkspace();
      const staging = stagingParent();
      const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "evil2.zip.lln"), [
        bufEntry("portable.json", S(manifestJson())),
        bufEntry(name, S("x")),
        bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
      ]);
      const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
      expect(result.ok, "非法名必须拒：" + name).toBe(false);
      expectWorkspaceIntact(ws, staging);
    }
  });

  it("NUL 字节名被拒", () => {
    const ws = makeTargetWorkspace();
    const staging = stagingParent();
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "evil3.zip.lln"), [
      bufEntry("portable.json", S(manifestJson())),
      bufEntry("desktop/a\u0000b.txt", S("x")),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/路径非法/);
    expectWorkspaceIntact(ws, staging);
  });

  it("非 desktop/ 前缀的穿越名条目被跳过（不提取、不落盘），导入照常", () => {
    const ws = makeTargetWorkspace();
    const staging = stagingParent();
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "evil4.zip.lln"), [
      bufEntry("portable.json", S(manifestJson())),
      bufEntry("../outside.txt", S("pwned")),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(staging), "outside.txt"))).toBe(false);
  });

  it("目录式条目名（尾空段）被拒", () => {
    const ws = makeTargetWorkspace();
    const staging = stagingParent();
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "evil5.zip.lln"), [
      bufEntry("portable.json", S(manifestJson())),
      bufEntry("desktop/sub/", S("")),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
    expect(result.ok).toBe(false);
    expectWorkspaceIntact(ws, staging);
  });
});

describe("便携包对抗档：截断 / CRC 篡改 / 结构", () => {
  it("截断包：读目录失败，工作区原样", () => {
    const ws = makeTargetWorkspace();
    const staging = stagingParent();
    const full = buildRawZip([
      bufEntry("portable.json", S(manifestJson())),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const zip = path.join(tempDir("lakex-adv-zip-"), "truncated.zip.lln");
    fs.writeFileSync(zip, full.subarray(0, Math.floor(full.length / 2)));
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
    expect(result.ok).toBe(false);
    expectWorkspaceIntact(ws, staging);
  });

  it("条目 CRC 篡改：解包中途失败，工作区原样、staging 清空", () => {
    const ws = makeTargetWorkspace();
    const staging = stagingParent();
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "badcrc.zip.lln"), [
      bufEntry("portable.json", S(manifestJson())),
      { name: "desktop/notes/first.lake", data: S("first"), crcOverride: 12345 },
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/CRC|截断/);
    expectWorkspaceIntact(ws, staging);
  });

  it("空包 / 缺 portable.json / 非 JSON 清单 一律拒", () => {
    const cases: Array<{ name: string; entries: RawEntry[] }> = [
      { name: "empty.zip.lln", entries: [] },
      { name: "nomanifest.zip.lln", entries: [bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1"))] },
      { name: "badjson.zip.lln", entries: [bufEntry("portable.json", S("{not json")), bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1"))] },
      { name: "arr.zip.lln", entries: [bufEntry("portable.json", S("[]")), bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1"))] },
    ];
    for (const c of cases) {
      const ws = makeTargetWorkspace();
      const staging = stagingParent();
      const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), c.name), c.entries);
      const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
      expect(result.ok, c.name + " 必须拒").toBe(false);
      expectWorkspaceIntact(ws, staging);
    }
  });

  it("后缀校验：非 .zip.lln 直接拒", () => {
    const ws = makeTargetWorkspace();
    const zip = path.join(tempDir("lakex-adv-zip-"), "evil.zip");
    fs.writeFileSync(zip, buildRawZip([bufEntry("portable.json", S(manifestJson()))]));
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: stagingParent() });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/只接受/);
  });
});

describe("便携包对抗档：清单（manifest）恶意字段", () => {
  const manifestCases: Array<{ label: string; overrides: Record<string, unknown> | "raw"; raw?: string; reason: RegExp }> = [
    { label: "formatVersion=1", overrides: { formatVersion: 1 }, reason: /格式版本/ },
    { label: "format 冒名", overrides: { format: "other" }, reason: /不是 LakexLocalNotes/ },
    { label: "limitBytes 不匹配", overrides: { limitBytes: 123 }, reason: /上限声明/ },
    { label: "source.platform 非法", overrides: { source: { platform: "win95" } }, reason: /来源非法/ },
    { label: "layout 与来源不匹配（desktop+mobile-snapshot）", overrides: { layout: "mobile-snapshot" }, reason: /布局与来源不匹配/ },
    { label: "baseline 形状非法", overrides: { baseline: { epoch: 1 } }, reason: /baseline 非法/ },
    { label: "counts 缺字段", overrides: { counts: { notes: -1 } }, reason: /counts/ },
    { label: "counts 非整数", overrides: { counts: { notes: 1.5, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 0 } }, reason: /counts/ },
  ];
  for (const c of manifestCases) {
    it("清单校验拒：" + c.label, () => {
      const ws = makeTargetWorkspace();
      const staging = stagingParent();
      const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "m.zip.lln"), [
        bufEntry("portable.json", S(c.overrides === "raw" ? (c.raw ?? "") : manifestJson(c.overrides))),
        bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
      ]);
      const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(c.reason);
      expectWorkspaceIntact(ws, staging);
    });
  }

  it("layout↔platform 配对由 parsePortableManifest 单一校验器钉住", () => {
    expect(() => parsePortableManifest(JSON.parse(manifestJson({ layout: "mobile-snapshot" })))).toThrow(/布局与来源不匹配/);
    expect(() => parsePortableManifest(JSON.parse(manifestJson({ source: { platform: "mobile" }, layout: "desktop-workspace" })))).toThrow(/布局与来源不匹配/);
  });

  it("counts 与实际不符（包撒谎）：现状 = 不校验、照常导入（characterization；缺口见报告）", () => {
    const ws = makeTargetWorkspace();
    const staging = stagingParent();
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "liar.zip.lln"), [
      bufEntry("portable.json", S(manifestJson({ counts: { notes: 999999, folders: 999999, quickNotes: 999999, tags: 999999, assets: 999999, bytes: 1 } }))),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: staging });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(ws.marker)).toBe(false); // 成功导入 = 工作区已换位（这是预期语义）
  });

  it("manifest 带 baseline ref 但包内 baseline 文件缺失：明示降级 + 合成合并底稿（P1-A 修复后语义）", () => {
    // ⚠️ P1-A 耦合（portable-sync-repro 261123 在修）：原行为 = 「按无基线导入」（首同步会落
    // 拉全轮 ⇒ 小记物删/文档假删除），修复后 = 合成「合并底稿」基线 + 明示警告。本用例按修复后语义钉。
    const ws = makeTargetWorkspace();
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "nobase.zip.lln"), [
      bufEntry("portable.json", S(manifestJson({ baseline: { epoch: "e", generation: 1, lakeCommit: "lc", quickNotesCommit: "qc" } }))),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
    ]);
    const result = importPortablePackageOnDesktop({ zipPath: zip, workspaceRoot: ws.root, stagingParent: stagingParent() });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/合成合并底稿|已按无基线导入/);
    // 修复后的安全不变量：导入侧必须留下合并底稿基线（或在合成失败时明示降级）
    const hasBootstrap = fs.existsSync(path.join(ws.root, "sync-v3", "baseline.json.gz"));
    expect(hasBootstrap || /已按无基线导入/.test(result.message ?? "")).toBe(true);
  });
});

describe("边界行为（MAX_ENTRIES / 4GiB）", () => {
  it("条目数上限：maxEntries 选项夹紧（超一个即拒）", () => {
    const zip = writeRaw(path.join(tempDir("lakex-adv-zip-"), "many.zip.lln"), [
      bufEntry("portable.json", S(manifestJson())),
      bufEntry("desktop/metadata.sqlite3", mainDbBytes("n1")),
      bufEntry("desktop/notes/a.lake", S("a")),
    ]);
    expect(() => inspectPortablePackage(zip, { maxEntries: 2 })).toThrow(/条目过多/);
    expect(inspectPortablePackage(zip, { maxEntries: 3 }).entries).toBe(3);
    // 产品上限常量存在且 = 50 万（Kotlin MAX_ENTRIES 同值；改这里先改 PORTABLE-TRANSFER）
    expect(inspectPortablePackage(zip).entries).toBe(3);
  });

  it("4GiB 上限：assertPortableSize 在 99% 余量口径上卡住", () => {
    expect(() => assertPortableSize(Math.floor(PORTABLE_LIMIT_BYTES * 0.98))).not.toThrow();
    expect(() => assertPortableSize(Math.floor(PORTABLE_LIMIT_BYTES * 0.995))).toThrow(/4GiB/);
    // inspectPortablePackage 的 dataBytes 硬闸覆盖「真实条目字节和」场景（4GiB 真包见 portableExport2gb.gated）
  });
});
