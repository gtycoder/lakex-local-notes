import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportWorkspaceBackup, backupTargetExists, quarantineDirName, prepareCloudRestore } from "./workspaceBackup.js";

describe("workspaceBackup（A1/A2 桌面主进程）", () => {
  let tmp: string;
  it("exportWorkspaceBackup：目录+db+wal 全量拷贝到目标", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-bak-src-"));
    const ws = path.join(tmp, "workspace-default");
    fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
    fs.mkdirSync(path.join(ws, "note-assets"), { recursive: true });
    fs.mkdirSync(path.join(ws, "history"), { recursive: true });
    fs.mkdirSync(path.join(ws, "quick-notes", "items"), { recursive: true });
    fs.writeFileSync(path.join(ws, "metadata.sqlite3"), "db-bytes");
    fs.writeFileSync(path.join(ws, "metadata.sqlite3-wal"), "wal-bytes");
    fs.writeFileSync(path.join(ws, "notes", "a.lake"), "<p>a</p>");
    fs.writeFileSync(path.join(ws, "quick-notes", "items", "q.txt"), "hello");
    const target = path.join(tmp, "backup-target");
    const r = exportWorkspaceBackup(ws, target, () => {});
    expect(r.copiedDirs).toContain("notes");
    expect(fs.existsSync(path.join(target, "metadata.sqlite3"))).toBe(true);
    expect(fs.existsSync(path.join(target, "metadata.sqlite3-wal"))).toBe(true);
    expect(fs.readFileSync(path.join(target, "notes", "a.lake"), "utf8")).toBe("<p>a</p>");
    expect(fs.readFileSync(path.join(target, "quick-notes", "items", "q.txt"), "utf8")).toBe("hello");
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
    // 原内容完整保留在隔离目录
    expect(fs.readFileSync(path.join(quarantinePath, "metadata.sqlite3"), "utf8")).toBe("old-db");
    // 新 workspace 为空目录（等待首同步）
    expect(fs.readdirSync(ws)).toEqual([]);
  });

  it("quarantineDirName 含时间戳且唯一", () => {
    expect(quarantineDirName()).toMatch(/^workspace-pre-restore-/);
  });
});
