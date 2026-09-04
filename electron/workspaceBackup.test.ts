import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { exportWorkspaceBackup, backupTargetExists, quarantineDirName, prepareCloudRestore } from "./workspaceBackup.js";

// 真实 VACUUM INTO（与 store.backupDatabaseTo 同语义）供测试备份回调使用
function vacuumInto(srcDb: string, dstDb: string): void {
  const w = new Database(srcDb);
  const esc = dstDb.replace(/'/g, "''");
  w.exec(`VACUUM INTO '${esc}'`);
  w.close();
}

describe("workspaceBackup（A1/A2 桌面主进程）", () => {
  let tmp: string;
  it("exportWorkspaceBackup：目录拷贝 + 一致性 db 快照（VACUUM INTO）", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-bak-src-"));
    const ws = path.join(tmp, "workspace-default");
    fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
    fs.mkdirSync(path.join(ws, "note-assets"), { recursive: true });
    fs.mkdirSync(path.join(ws, "history"), { recursive: true });
    fs.mkdirSync(path.join(ws, "quick-notes", "items"), { recursive: true });
    const db = new Database(path.join(ws, "metadata.sqlite3"));
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
    db.prepare("INSERT INTO t VALUES (?,?)").run("k1", "hello");
    fs.writeFileSync(path.join(ws, "notes", "a.lake"), "<p>a</p>");
    fs.writeFileSync(path.join(ws, "quick-notes", "items", "q.txt"), "hello");
    const target = path.join(tmp, "backup-target");
    const backupDatabases = (targetRoot: string) => {
      fs.mkdirSync(targetRoot, { recursive: true });
      vacuumInto(path.join(ws, "metadata.sqlite3"), path.join(targetRoot, "metadata.sqlite3"));
    };
    const r = exportWorkspaceBackup(ws, target, backupDatabases, () => {});
    expect(r.copiedDirs).toContain("notes");
    const snap = new Database(path.join(target, "metadata.sqlite3"), { readonly: true });
    try { expect(snap.prepare("SELECT v FROM t WHERE id=?").get("k1")).toEqual({ v: "hello" }); } finally { snap.close(); }
    expect(fs.readFileSync(path.join(target, "notes", "a.lake"), "utf8")).toBe("<p>a</p>");
    expect(fs.readFileSync(path.join(target, "quick-notes", "items", "q.txt"), "utf8")).toBe("hello");
    expect(fs.existsSync(path.join(target, "metadata.sqlite3-wal"))).toBe(false);
    db.close();
  });

  it("backupTargetExists：空目标 false / 非空 true", () => {
    const empty = path.join(tmp, "empty");
    fs.mkdirSync(empty, { recursive: true });
    expect(backupTargetExists(empty)).toBe(false);
    const nonEmpty = path.join(tmp, "nonempty");
    fs.mkdirSync(path.join(nonEmpty, "x"), { recursive: true });
    expect(backupTargetExists(nonEmpty)).toBe(true);
  });

  it("prepareCloudRestore：改名隔离 + 建空 workspace，原内容完整保留在隔离目录", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "lake-restore-"));
    const ws = path.join(parent, "workspace-default");
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, "metadata.sqlite3"), "old-db");
    const { quarantinePath } = prepareCloudRestore(ws);
    expect(fs.readFileSync(path.join(quarantinePath, "metadata.sqlite3"), "utf8")).toBe("old-db");
    expect(fs.readdirSync(ws)).toEqual([]);
  });

  it("quarantineDirName 含时间戳且唯一", () => {
    expect(quarantineDirName()).toMatch(/^workspace-pre-restore-/);
  });
});
