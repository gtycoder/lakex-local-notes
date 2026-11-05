/**
 * Batch4-A：从备份导入恢复（校验 → 隔离 → 替换 → 回滚）单测。
 * 全部走临时目录 + 真实 SQLite 文件（better-sqlite3），锁住「校验失败不动原库」「成功保留原库」「失败可回滚」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRestoreCandidates,
  inspectBackupDatabase,
  isAcceptableBackupPath,
  isRememberedRestoreCandidate,
  rememberRestoreCandidate,
  restoreMainDatabaseFromBackup,
} from "./workspaceRestoreFromBackup.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-restore-backup-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  clearRestoreCandidates();
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
  }
});

/** 造一个「像主库」的备份：关键表齐全 + 一个可读的 marker 表（用于区分备份内容/原库内容）。 */
function createMainDb(dbPath: string, marker: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE tree_nodes(id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)");
    db.exec("CREATE TABLE device_state(key TEXT PRIMARY KEY, value TEXT)");
    db.exec("CREATE TABLE restore_test_marker(value TEXT)");
    db.prepare("INSERT INTO restore_test_marker(value) VALUES(?)").run(marker);
    db.prepare("INSERT INTO settings(key,value) VALUES('marker',?)").run(marker);
  } finally {
    db.close();
  }
}

function markerOf(dbPath: string): string | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare("SELECT value FROM restore_test_marker").get() as { value: string } | undefined)?.value ?? null;
  } finally {
    db.close();
  }
}

describe("备份路径白名单（防目录穿越/任意路径）", () => {
  it("接受应用产生的 metadata*.sqlite3 绝对路径", () => {
    const dir = tempDir();
    expect(isAcceptableBackupPath(path.join(dir, "metadata.sqlite3"))).toBe(true);
    expect(isAcceptableBackupPath(path.join(dir, "metadata-2026-11-05T10-00-00.sqlite3"))).toBe(true);
  });

  it("拒绝相对路径/非白名单文件名/遍历路径/空值/含 NUL", () => {
    const dir = tempDir();
    expect(isAcceptableBackupPath("metadata-2026.sqlite3")).toBe(false);
    expect(isAcceptableBackupPath(path.join(dir, "notes.sqlite3"))).toBe(false);
    // 注意用未规范化的原始串（path.join 会把 .. 折叠掉，测不到穿越拒绝）。
    expect(isAcceptableBackupPath(dir + "/../x/metadata.sqlite3")).toBe(false);
    expect(isAcceptableBackupPath("")).toBe(false);
    expect(isAcceptableBackupPath(null)).toBe(false);
    expect(isAcceptableBackupPath(dir + "/a\u0000b/metadata.sqlite3")).toBe(false);
  });

  it("选择框登记后 IPC 才接受：登记/查询/清空，非法路径登记也失败", () => {
    const dir = tempDir();
    const valid = path.join(dir, "metadata-1.sqlite3");
    const other = path.join(dir, "metadata-2.sqlite3");
    expect(isRememberedRestoreCandidate(valid)).toBe(false);
    expect(rememberRestoreCandidate(valid)).toBe(true);
    expect(isRememberedRestoreCandidate(valid)).toBe(true);
    expect(isRememberedRestoreCandidate(other)).toBe(false);
    // 非法路径不会被登记（IPC 即便拿到也拒绝）。
    expect(rememberRestoreCandidate(path.join(dir, "evil.sqlite3"))).toBe(false);
    expect(isRememberedRestoreCandidate(path.join(dir, "evil.sqlite3"))).toBe(false);
    clearRestoreCandidates();
    expect(isRememberedRestoreCandidate(valid)).toBe(false);
  });
});

describe("备份库校验（inspectBackupDatabase）", () => {
  it("健康备份（关键表齐全 + quick_check ok）⇒ 通过", () => {
    const dbPath = path.join(tempDir(), "metadata-2026.sqlite3");
    createMainDb(dbPath, "backup");
    const result = inspectBackupDatabase(dbPath);
    expect(result.ok).toBe(true);
    expect(result.tables).toEqual(expect.arrayContaining(["notes", "tree_nodes", "settings", "device_state"]));
  });

  it("文件不存在 / 非 SQLite / 缺关键表 ⇒ 不通过，并给可读原因", () => {
    const dir = tempDir();
    expect(inspectBackupDatabase(path.join(dir, "metadata-missing.sqlite3"))).toMatchObject({ ok: false, reason: expect.stringContaining("不存在") });

    const corrupt = path.join(dir, "metadata-corrupt.sqlite3");
    fs.writeFileSync(corrupt, "definitely not sqlite");
    expect(inspectBackupDatabase(corrupt).ok).toBe(false);

    const partial = path.join(dir, "metadata-partial.sqlite3");
    const db = new Database(partial);
    try { db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY)"); } finally { db.close(); }
    const result = inspectBackupDatabase(partial);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("关键表");
  });
});

describe("从备份恢复（restoreMainDatabaseFromBackup）", () => {
  it("成功：校验通过 → 原库改名隔离（不删除）→ 备份复制到位 → 提示重启", () => {
    const userDataDir = tempDir();
    const workspace = tempDir();
    const currentDb = path.join(workspace, "metadata.sqlite3");
    const backupDb = path.join(tempDir(), "metadata-2026-11-05.sqlite3");
    createMainDb(currentDb, "current");
    createMainDb(backupDb, "backup");

    const result = restoreMainDatabaseFromBackup({
      backupPath: backupDb,
      currentDbPath: currentDb,
      userDataDir,
      now: () => new Date("2026-11-05T03:04:05.678Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.quarantinePath).toBe(path.join(userDataDir, "corrupt", "restore-2026-11-05T03-04-05"));
    // 新库 = 备份内容；原库完整保留在隔离目录（不删除，可手动找回）。
    expect(markerOf(currentDb)).toBe("backup");
    expect(markerOf(path.join(result.quarantinePath!, "metadata.sqlite3"))).toBe("current");
    expect(result.message).toContain("隔离保留");
    expect(result.message).toContain("重启");
  });

  it("校验失败：一个文件都不动（原库内容不变、不产生隔离目录），明确报错", () => {
    const userDataDir = tempDir();
    const workspace = tempDir();
    const currentDb = path.join(workspace, "metadata.sqlite3");
    createMainDb(currentDb, "current");
    const badBackup = path.join(tempDir(), "metadata-bad.sqlite3");
    fs.writeFileSync(badBackup, "not a database");

    const result = restoreMainDatabaseFromBackup({ backupPath: badBackup, currentDbPath: currentDb, userDataDir });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(markerOf(currentDb)).toBe("current");
    expect(fs.existsSync(path.join(userDataDir, "corrupt"))).toBe(false);
  });

  it("替换阶段失败 ⇒ 回滚：原库移回、内容不变、返回 rolledBack", () => {
    const userDataDir = tempDir();
    const workspace = tempDir();
    const currentDb = path.join(workspace, "metadata.sqlite3");
    const backupDb = path.join(tempDir(), "metadata-2026-11-05.sqlite3");
    createMainDb(currentDb, "current");
    createMainDb(backupDb, "backup");

    const result = restoreMainDatabaseFromBackup({
      backupPath: backupDb,
      currentDbPath: currentDb,
      userDataDir,
      // 模拟复制阶段磁盘写失败：隔离已发生，必须把原库移回。
      fsOps: { copyFileSync: () => { throw new Error("disk full"); } },
    });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(markerOf(currentDb)).toBe("current");
    expect(result.message).toContain("已回滚");
  });

  it("拒绝用「当前正在使用的库」当备份；拒绝非白名单文件名", () => {
    const userDataDir = tempDir();
    const workspace = tempDir();
    const currentDb = path.join(workspace, "metadata.sqlite3");
    createMainDb(currentDb, "current");

    const same = restoreMainDatabaseFromBackup({ backupPath: currentDb, currentDbPath: currentDb, userDataDir });
    expect(same.ok).toBe(false);
    expect(same.reason).toContain("当前正在使用");

    const wrongName = path.join(tempDir(), "backup.sqlite3");
    fs.copyFileSync(currentDb, wrongName);
    const bad = restoreMainDatabaseFromBackup({ backupPath: wrongName, currentDbPath: currentDb, userDataDir });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain("备份文件无效");
    expect(markerOf(currentDb)).toBe("current");
  });
});
