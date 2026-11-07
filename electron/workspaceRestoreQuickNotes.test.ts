import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectQuickNotesDatabase,
  restoreMainDatabaseFromBackup,
} from "./workspaceRestoreFromBackup.js";

const dirs: string[] = [];
function tempDir(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), "lake-restore-quick-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 尽力 */ } } });

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
  } finally { db.close(); }
}

function createQuickDb(dbPath: string, marker: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE quick_notes(id TEXT PRIMARY KEY)");
    db.exec("CREATE TABLE tags(id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    db.exec("CREATE TABLE tag_links(target_kind TEXT NOT NULL, target_id TEXT NOT NULL, tag_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(target_kind,target_id,tag_id))");
    db.exec("CREATE TABLE tag_link_versions(target_kind TEXT NOT NULL, target_id TEXT NOT NULL, links_updated_at TEXT NOT NULL, PRIMARY KEY(target_kind,target_id))");
    db.exec("CREATE TABLE restore_test_marker(value TEXT)");
    db.prepare("INSERT INTO restore_test_marker(value) VALUES(?)").run(marker);
  } finally { db.close(); }
}

function markerOf(dbPath: string): string | null {
  const db = new Database(dbPath, { readonly: true });
  try { return (db.prepare("SELECT value FROM restore_test_marker").get() as { value?: string } | undefined)?.value ?? null; }
  finally { db.close(); }
}

describe("从备份恢复小记库（标签存储统一前置）", () => {
  it("主库 + 同快照小记库一起恢复；原小记库隔离保留", () => {
    const userDataDir = tempDir();
    const workspace = tempDir();
    const backupRoot = tempDir();
    const currentMain = path.join(workspace, "metadata.sqlite3");
    const currentQuick = path.join(workspace, "quick-notes", "metadata.sqlite3");
    const backupMain = path.join(backupRoot, "metadata-2026-11-07.sqlite3");
    const backupQuick = path.join(backupRoot, "quick-notes", "metadata.sqlite3");
    createMainDb(currentMain, "current-main");
    createQuickDb(currentQuick, "current-quick");
    createMainDb(backupMain, "backup-main");
    createQuickDb(backupQuick, "backup-quick");

    const result = restoreMainDatabaseFromBackup({
      backupPath: backupMain,
      currentDbPath: currentMain,
      currentQuickNotesDbPath: currentQuick,
      userDataDir,
      now: () => new Date("2026-11-07T03:04:05.678Z"),
    });
    expect(result.ok).toBe(true);
    expect(result.quickNotesRestored).toBe(true);
    expect(markerOf(currentMain)).toBe("backup-main");
    expect(markerOf(currentQuick)).toBe("backup-quick");
    expect(markerOf(path.join(result.quarantinePath!, "quick-notes-metadata.sqlite3"))).toBe("current-quick");
    expect(result.message).toContain("小记库");
  });

  it("备份里没有小记库：只恢复主库，当前小记库保持不动", () => {
    const userDataDir = tempDir();
    const workspace = tempDir();
    const backupRoot = tempDir();
    const currentMain = path.join(workspace, "metadata.sqlite3");
    const currentQuick = path.join(workspace, "quick-notes", "metadata.sqlite3");
    const backupMain = path.join(backupRoot, "metadata-2026-11-07.sqlite3");
    createMainDb(currentMain, "current-main");
    createQuickDb(currentQuick, "current-quick");
    createMainDb(backupMain, "backup-main");

    const result = restoreMainDatabaseFromBackup({
      backupPath: backupMain,
      currentDbPath: currentMain,
      currentQuickNotesDbPath: currentQuick,
      userDataDir,
    });
    expect(result.ok).toBe(true);
    expect(result.quickNotesRestored).toBe(false);
    expect(markerOf(currentMain)).toBe("backup-main");
    expect(markerOf(currentQuick)).toBe("current-quick");
  });

  it("备份里小记库损坏：拒绝恢复且一个文件都不动", () => {
    const userDataDir = tempDir();
    const workspace = tempDir();
    const backupRoot = tempDir();
    const currentMain = path.join(workspace, "metadata.sqlite3");
    const currentQuick = path.join(workspace, "quick-notes", "metadata.sqlite3");
    const backupMain = path.join(backupRoot, "metadata-2026-11-07.sqlite3");
    const backupQuick = path.join(backupRoot, "quick-notes", "metadata.sqlite3");
    createMainDb(currentMain, "current-main");
    createQuickDb(currentQuick, "current-quick");
    createMainDb(backupMain, "backup-main");
    fs.mkdirSync(path.dirname(backupQuick), { recursive: true });
    fs.writeFileSync(backupQuick, "not sqlite");

    const result = restoreMainDatabaseFromBackup({
      backupPath: backupMain,
      currentDbPath: currentMain,
      currentQuickNotesDbPath: currentQuick,
      userDataDir,
    });
    expect(result.ok).toBe(false);
    expect(markerOf(currentMain)).toBe("current-main");
    expect(markerOf(currentQuick)).toBe("current-quick");
    expect(fs.existsSync(path.join(userDataDir, "corrupt"))).toBe(false);
  });
});

describe("inspectQuickNotesDatabase", () => {
  it("表集齐全才通过；缺 tag_links 则拒绝", () => {
    const dir = tempDir();
    const good = path.join(dir, "quick-notes", "metadata.sqlite3");
    createQuickDb(good, "x");
    expect(inspectQuickNotesDatabase(good).ok).toBe(true);

    const bad = path.join(dir, "bad", "metadata.sqlite3");
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    const db = new Database(bad);
    try { db.exec("CREATE TABLE quick_notes(id TEXT PRIMARY KEY)"); } finally { db.close(); }
    const result = inspectQuickNotesDatabase(bad);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("小记库");
  });
});
