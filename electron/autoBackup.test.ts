/**
 * 261105 Batch4-E：自动备份策略/实现/轮转单测。
 * 覆盖：关闭/未到期/到期/单飞/内容未变跳过、手动绕过；VACUUM 备份可 quick_check；
 * 失败降级/不抛；轮转份数与大小；备份命名能被「从备份恢复」识别（只主库）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTO_BACKUP_DEFAULTS,
  AUTO_BACKUP_TICK_MS,
  backupDatabaseFile,
  backupFileNames,
  backupsDir,
  decideAutoBackup,
  listBackupGroups,
  normalizeAutoBackupSettings,
  readDatabaseFingerprint,
  rotateBackups,
  runBackupCycle,
  verifySqliteBackup,
  type BackupPolicyInput,
} from "./autoBackup.js";
import { isAcceptableBackupPath } from "./workspaceRestoreFromBackup.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-autobackup-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
  }
});

function createDb(dbPath: string, marker: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE marker(value TEXT)");
    db.prepare("INSERT INTO marker(value) VALUES(?)").run(marker);
  } finally { db.close(); }
}

function policy(over: Partial<BackupPolicyInput> = {}): BackupPolicyInput {
  return {
    enabled: true,
    busy: false,
    nowMs: 1_800_000_000_000,
    lastBackupAtMs: null,
    intervalDays: 1,
    fingerprint: { size: 100, mtimeMs: 1 },
    lastFingerprint: { size: 99, mtimeMs: 1 },
    ...over,
  };
}

describe("decideAutoBackup：纯策略", () => {
  it("关闭 ⇒ disabled（手动仍可）", () => {
    expect(decideAutoBackup(policy({ enabled: false }))).toEqual({ run: false, reason: "disabled" });
    expect(decideAutoBackup(policy({ enabled: false, manual: true }))).toEqual({ run: true, reason: "ok" });
  });

  it("单飞：正在跑 ⇒ busy（手动也不重入）", () => {
    expect(decideAutoBackup(policy({ busy: true }))).toEqual({ run: false, reason: "busy" });
    expect(decideAutoBackup(policy({ busy: true, manual: true }))).toEqual({ run: false, reason: "busy" });
  });

  it("未到期（每天/每周）⇒ not-due；到期 ⇒ ok", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 1_800_000_000_000;
    expect(decideAutoBackup(policy({ nowMs: now, lastBackupAtMs: now - day }))).toEqual({ run: true, reason: "ok" });
    expect(decideAutoBackup(policy({ nowMs: now, lastBackupAtMs: now - day + 1000 }))).toEqual({ run: false, reason: "not-due" });
    expect(decideAutoBackup(policy({ nowMs: now, lastBackupAtMs: now - 3 * day, intervalDays: 7 }))).toEqual({ run: false, reason: "not-due" });
    expect(decideAutoBackup(policy({ nowMs: now, lastBackupAtMs: now - 8 * day, intervalDays: 7 }))).toEqual({ run: true, reason: "ok" });
  });

  it("内容未变（size+mtime 相同）⇒ unchanged；手动绕过", () => {
    const same = { size: 100, mtimeMs: 1 };
    expect(decideAutoBackup(policy({ fingerprint: same, lastFingerprint: same }))).toEqual({ run: false, reason: "unchanged" });
    expect(decideAutoBackup(policy({ fingerprint: same, lastFingerprint: same, manual: true }))).toEqual({ run: true, reason: "ok" });
    expect(decideAutoBackup(policy({ fingerprint: same, lastFingerprint: { size: 100, mtimeMs: 2 } }))).toEqual({ run: true, reason: "ok" });
  });

  it("设置归一：只允许 1/7 天、份数 1-50、大小上限合法；非法返回 null", () => {
    expect(normalizeAutoBackupSettings(AUTO_BACKUP_DEFAULTS)).toEqual(AUTO_BACKUP_DEFAULTS);
    expect(normalizeAutoBackupSettings({ ...AUTO_BACKUP_DEFAULTS, intervalDays: 2 })).toBeNull();
    expect(normalizeAutoBackupSettings({ ...AUTO_BACKUP_DEFAULTS, keepCount: 0 })).toBeNull();
    expect(normalizeAutoBackupSettings({ ...AUTO_BACKUP_DEFAULTS, maxTotalBytes: 1 })).toBeNull();
    expect(normalizeAutoBackupSettings(null)).toBeNull();
  });

  it("tick = 6h（启动不立即跑的调度常量）", () => {
    expect(AUTO_BACKUP_TICK_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe("数据库备份实现", () => {
  it("VACUUM INTO 生成可独立打开的备份（quick_check 通过、内容一致）", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "workspace", "metadata.sqlite3");
    createDb(dbPath, "hello-backup");
    const target = path.join(dir, "backups", "metadata-2026-11-05T00-00-00.sqlite3");
    const result = backupDatabaseFile({ dbPath, targetPath: target });
    expect(result).toMatchObject({ ok: true, mode: "vacuum" });
    expect(verifySqliteBackup(target)).toEqual({ ok: true });
    const backup = new Database(target, { readonly: true });
    try { expect((backup.prepare("SELECT value FROM marker").get() as { value: string }).value).toBe("hello-backup"); }
    finally { backup.close(); }
  });

  it("坏库/非 SQLite ⇒ 降级文件级拷贝并在 message 明说可能不完整", () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "metadata-bad.sqlite3");
    fs.writeFileSync(dbPath, "not a database");
    const target = path.join(dir, "backups", "metadata-bad-copy.sqlite3");
    const result = backupDatabaseFile({ dbPath, targetPath: target });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("copy");
    expect(result.message).toContain("可能不完整");
    expect(fs.readFileSync(target, "utf8")).toBe("not a database");
  });

  it("主库不存在 ⇒ ok:false（不抛）", () => {
    const dir = tempDir();
    expect(backupDatabaseFile({ dbPath: path.join(dir, "missing.sqlite3"), targetPath: path.join(dir, "x.sqlite3") })).toMatchObject({ ok: false });
  });
});

describe("轮转保留", () => {
  it("保留最近 N 份（按时间戳分组，metadata+quicknotes 成组删）", () => {
    const dir = tempDir();
    const stamps = ["2026-11-01T00-00-00", "2026-11-02T00-00-00", "2026-11-03T00-00-00", "2026-11-04T00-00-00"];
    for (const stamp of stamps) {
      fs.writeFileSync(path.join(dir, "metadata-" + stamp + ".sqlite3"), "m");
      fs.writeFileSync(path.join(dir, "quicknotes-" + stamp + ".sqlite3"), "q");
    }
    const result = rotateBackups({ dir, keepCount: 2, maxTotalBytes: 300 * 1024 * 1024 });
    expect(result.kept).toBe(2);
    expect(result.deleted).toHaveLength(4); // 两组 × 2 文件
    expect(listBackupGroups(dir).map((group) => group.stamp)).toEqual(stamps.slice(-2).reverse());
  });

  it("大小上限：超限时最旧优先删；至少保留最新一份（上限极小也不删光）", () => {
    const dir = tempDir();
    for (let index = 0; index < 4; index += 1) {
      fs.writeFileSync(path.join(dir, "metadata-2026-11-0" + (index + 1) + "T00-00-00.sqlite3"), Buffer.alloc(100));
    }
    const result = rotateBackups({ dir, keepCount: 10, maxTotalBytes: 250 });
    expect(result.kept).toBe(2); // 最新两份 200B ≤ 250；第三份会超
    const tiny = tempDir();
    fs.writeFileSync(path.join(tiny, "metadata-2026-11-01T00-00-00.sqlite3"), Buffer.alloc(100));
    const keepsNewest = rotateBackups({ dir: tiny, keepCount: 10, maxTotalBytes: 1 });
    expect(keepsNewest.kept).toBe(1); // 即便上限 1B，也保留最新一份
    expect(fs.existsSync(path.join(tiny, "metadata-2026-11-01T00-00-00.sqlite3"))).toBe(true);
  });

  it("目录不存在 ⇒ 空结果、不抛", () => {
    expect(listBackupGroups(path.join(tempDir(), "nope"))).toEqual([]);
    expect(rotateBackups({ dir: path.join(tempDir(), "nope"), keepCount: 7, maxTotalBytes: 1024 }).kept).toBe(0);
  });
});

describe("runBackupCycle：端到端（主库+小记库、状态、轮转、失败不抛）", () => {
  it("成功：两份备份 + quick_check 可用 + 状态 ok + 旧备份被轮转", () => {
    const userDataDir = tempDir();
    const mainDb = path.join(userDataDir, "workspace-default", "metadata.sqlite3");
    const quickDb = path.join(userDataDir, "workspace-default", "quick-notes", "metadata.sqlite3");
    createDb(mainDb, "main");
    createDb(quickDb, "quick");
    // 预置 3 组旧备份（应被保留上限 2 挤掉）
    const dir = backupsDir(userDataDir);
    fs.mkdirSync(dir, { recursive: true });
    for (const stamp of ["2026-10-01T00-00-00", "2026-10-02T00-00-00", "2026-10-03T00-00-00"]) {
      fs.writeFileSync(path.join(dir, "metadata-" + stamp + ".sqlite3"), "old");
    }
    const logs: string[] = [];
    const result = runBackupCycle({
      userDataDir, mainDbPath: mainDb, quickNotesDbPath: quickDb,
      settings: { ...AUTO_BACKUP_DEFAULTS, keepCount: 2 },
      now: new Date("2026-11-05T00:00:00.000Z"),
      log: (message) => logs.push(message),
    });
    expect(result.state).toMatchObject({ result: "ok", lastBackupAt: "2026-11-05T00:00:00.000Z" });
    expect(result.state?.fingerprint).toEqual(readDatabaseFingerprint(mainDb));
    const names = backupFileNames(new Date("2026-11-05T00:00:00.000Z"));
    expect(verifySqliteBackup(path.join(dir, names.main))).toEqual({ ok: true });
    expect(verifySqliteBackup(path.join(dir, names.quickNotes))).toEqual({ ok: true });
    // 轮转：现在共 3 组（2 旧 + 1 新）保留 2 组最快照 = 保留 1 旧 + 新
    expect(listBackupGroups(dir)).toHaveLength(2);
    expect(logs.some((line) => line.includes("[backup]"))).toBe(true);
  });

  it("小记库不可用（降级）⇒ partial，但主库备份照常；不抛", () => {
    const userDataDir = tempDir();
    const mainDb = path.join(userDataDir, "workspace-default", "metadata.sqlite3");
    createDb(mainDb, "main");
    const result = runBackupCycle({
      userDataDir, mainDbPath: mainDb, quickNotesDbPath: null,
      settings: { ...AUTO_BACKUP_DEFAULTS },
      now: new Date("2026-11-05T00:00:00.000Z"),
    });
    expect(result.state?.result).toBe("partial");
    expect(result.message).toContain("小记库");
  });

  it("主库不存在 ⇒ failed 状态（不抛、不阻断）", () => {
    const userDataDir = tempDir();
    const result = runBackupCycle({
      userDataDir, mainDbPath: path.join(userDataDir, "missing.sqlite3"), quickNotesDbPath: null,
      settings: { ...AUTO_BACKUP_DEFAULTS },
    });
    expect(result.state?.result).toBe("failed");
    expect(result.message).toContain("失败");
  });

  it("备份文件名能被「从备份恢复」白名单识别（主库），小记库不在恢复范围", () => {
    const names = backupFileNames(new Date("2026-11-05T00:00:00.000Z"));
    expect(isAcceptableBackupPath(path.join(tempDir(), names.main))).toBe(true);
    expect(isAcceptableBackupPath(path.join(tempDir(), names.quickNotes))).toBe(false);
  });
});
