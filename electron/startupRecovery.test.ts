/**
 * 启动硬失败恢复（P1-5）单测：完整性预检 / 启动决策 / 备份 / 恢复页 HTML / 崩溃标记。
 * 这些是主进程恢复路径的**纯逻辑与文件操作**，必须能在没有 Electron 运行时的 vitest 里跑通。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  backupDatabaseForRecovery,
  buildRecoveryPageHtml,
  crashMarkerPath,
  decideStartupRecovery,
  inspectDatabaseForStartup,
  parseRecoveryActionHash,
  readCrashMarker,
  removeCrashMarker,
  writeCrashMarker,
  CRASH_MARKER_FILE,
  type RecoveryPageInfo,
} from "./startupRecovery.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-startup-recovery-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
  }
});

function healthyDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE t(id TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO t(id, value) VALUES('a', 'hello')").run();
  } finally { db.close(); }
}

describe("启动前完整性预检（inspectDatabaseForStartup）", () => {
  it("文件不存在 = 全新安装 ⇒ 通过（Store 会建库）", () => {
    const report = inspectDatabaseForStartup(path.join(tempDir(), "metadata.sqlite3"));
    expect(report.ok).toBe(true);
    expect(report.quickCheck).toBe("missing");
    expect(report.detail).toContain("全新库");
  });

  it("健康库 ⇒ 通过（quick_check=ok、外键 0 处违反）", () => {
    const dbPath = path.join(tempDir(), "metadata.sqlite3");
    healthyDatabase(dbPath);
    const report = inspectDatabaseForStartup(dbPath);
    expect(report.ok).toBe(true);
    expect(report.quickCheck).toBe("ok");
    expect(report.foreignKeyErrors).toBe(0);
    expect(report.detail).toContain("完整性检查通过");
  });

  it("外键违反 ⇒ 不通过（恢复模式，别让坏引用继续被写）", () => {
    const dbPath = path.join(tempDir(), "metadata.sqlite3");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE parent(id TEXT PRIMARY KEY)");
      db.exec("CREATE TABLE child(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id))");
      // 故意写入违反外键的行：better-sqlite3 新版默认开 foreign_keys，这里必须先关掉才能造坏数据。
      db.pragma("foreign_keys = OFF");
      db.prepare("INSERT INTO child(id, parent_id) VALUES('c1', 'missing-parent')").run();
    } finally { db.close(); }
    const report = inspectDatabaseForStartup(dbPath);
    expect(report.ok).toBe(false);
    expect(report.foreignKeyErrors).toBe(1);
    expect(report.detail).toContain("外键违反 1 处");
  });

  it("非 SQLite 文件/打不开 ⇒ 不通过，并带错误摘要（绝不静默继续）", () => {
    const dbPath = path.join(tempDir(), "metadata.sqlite3");
    fs.writeFileSync(dbPath, "this is definitely not a sqlite database");
    const report = inspectDatabaseForStartup(dbPath);
    expect(report.ok).toBe(false);
    expect(report.detail).toContain("打开/校验数据库失败");
  });
});

describe("启动决策（decideStartupRecovery）", () => {
  const okIntegrity = { ok: true, detail: "完整性检查通过", quickCheck: "ok", foreignKeyErrors: 0 };
  const badIntegrity = { ok: false, detail: "完整性检查未通过（quick_check=broken）", quickCheck: "broken", foreignKeyErrors: 2 };
  const marker = { time: "2026-11-05T00:00:00.000Z", reason: "Error: boom", stack: "at x", occurrences: 2 };

  it("未给输入/预检通过且无打开异常 ⇒ normal", () => {
    expect(decideStartupRecovery()).toMatchObject({ mode: "normal", cause: "none", reason: "" });
    expect(decideStartupRecovery({ integrity: okIntegrity })).toMatchObject({ mode: "normal", cause: "none" });
  });

  it("预检不通过 ⇒ recovery/integrity（reason/detail 供恢复页展示）", () => {
    const decision = decideStartupRecovery({ integrity: badIntegrity });
    expect(decision.mode).toBe("recovery");
    expect(decision.cause).toBe("integrity");
    expect(decision.reason).toContain("完整性");
    expect(decision.detail).toContain("quick_check=broken");
  });

  it("打开异常优先于完整性结论（打不开就谈不上完整性）", () => {
    const decision = decideStartupRecovery({ integrity: badIntegrity, openError: new Error("SQLITE_CANTOPEN") });
    expect(decision).toMatchObject({ mode: "recovery", cause: "open" });
    expect(decision.detail).toContain("SQLITE_CANTOPEN");
  });

  it("崩溃标记只透传提示，不单独把启动判成恢复模式", () => {
    expect(decideStartupRecovery({ integrity: okIntegrity, crashMarker: marker })).toMatchObject({ mode: "normal", crashMarker: marker });
    expect(decideStartupRecovery({ integrity: badIntegrity, crashMarker: marker })).toMatchObject({ mode: "recovery", crashMarker: marker });
  });
});

describe("恢复页 HTML（buildRecoveryPageHtml）", () => {
  const info: RecoveryPageInfo = {
    reason: "本地数据库完整性检查未通过",
    detail: "完整性检查未通过（quick_check=broken，外键违反 2 处）",
    dataDir: "/tmp/userData",
    workspacePath: "/tmp/userData/workspace-default",
    logPath: "/tmp/userData/logs/lakex-local-notes.log",
    backupDir: "/tmp/userData/backup",
    crashMarker: { time: "2026-11-05T00:00:00.000Z", reason: "Error: boom", stack: "at foo", occurrences: 3 },
  };

  it("展示原因/细节/数据目录/日志路径，并给出五个动作按钮（含从备份恢复）", () => {
    const html = buildRecoveryPageHtml(info);
    expect(html).toContain("本地数据库完整性检查未通过");
    expect(html).toContain("quick_check=broken");
    expect(html).toContain("/tmp/userData");
    expect(html).toContain("/tmp/userData/logs/lakex-local-notes.log");
    expect(html).toContain("/tmp/userData/workspace-default");
    expect(html).toContain("/tmp/userData/backup");
    for (const action of ["backup", "cloud-restore", "restore-backup", "open-data", "quit"]) {
      expect(html).toContain(`data-action="${action}"`);
    }
    expect(html).toContain("先备份后继续");
    expect(html).toContain("从云端恢复（换机/坏库）");
    expect(html).toContain("从备份恢复…");
    expect(html).toContain("打开数据目录");
    expect(html).toContain("退出");
    // 说明文案要讲清「先校验再隔离替换、原库不删除、重启生效」。
    expect(html).toContain("metadata*.sqlite3");
    expect(html).toContain("原库不删除");
  });

  it("有崩溃标记时展示 time/reason/occurrences；无标记时不出现崩溃区块", () => {
    const withCrash = buildRecoveryPageHtml(info);
    expect(withCrash).toContain("上次运行有未捕获异常");
    expect(withCrash).toContain("2026-11-05T00:00:00.000Z");
    expect(withCrash).toContain("累计 3 次");
    expect(withCrash).toContain("at foo");
    const withoutCrash = buildRecoveryPageHtml({ ...info, crashMarker: null });
    expect(withoutCrash).not.toContain("上次运行有未捕获异常");
  });

  it("所有外部文本都转义（原因/路径里带标签也不会被当 HTML 执行）", () => {
    const html = buildRecoveryPageHtml({ ...info, reason: '<script>alert(1)</script>', detail: '"><img src=x onerror=alert(2)>', dataDir: "/tmp/a<b" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).not.toContain("/tmp/a<b");
  });

  it("页面只走同文档 hash（无 preload 可用的 IPC/fetch 依赖）", () => {
    const html = buildRecoveryPageHtml(info);
    expect(html).toContain('location.hash = "action="');
    expect(html).toContain("window.__recoveryStatus");
    expect(html).not.toContain("lakeNative");
    expect(html).not.toContain("ipcRenderer");
  });
});

describe("恢复页动作解析（parseRecoveryActionHash）", () => {
  it("解析五种动作，允许附加 nonce（重复点击）", () => {
    expect(parseRecoveryActionHash("#action=backup")).toBe("backup");
    expect(parseRecoveryActionHash("#action=cloud-restore&t=1720000000")).toBe("cloud-restore");
    expect(parseRecoveryActionHash("#action=restore-backup&t=1720000001")).toBe("restore-backup");
    expect(parseRecoveryActionHash("#action=open-data&t=1")).toBe("open-data");
    expect(parseRecoveryActionHash("#action=quit")).toBe("quit");
  });
  it("未知/空 hash 返回 null（不执行任何动作）", () => {
    for (const hash of ["", "#", "#backup", "#action=delete", "#action=", "#action=backupx"]) {
      expect(parseRecoveryActionHash(hash)).toBeNull();
    }
  });
});

describe("一次性备份（backupDatabaseForRecovery）", () => {
  it("健康库 ⇒ VACUUM INTO 一致快照，备份文件可独立打开", () => {
    const userDataDir = tempDir();
    const dbPath = path.join(userDataDir, "workspace-default", "metadata.sqlite3");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    healthyDatabase(dbPath);
    const result = backupDatabaseForRecovery({ dbPath, userDataDir, now: new Date("2026-11-05T01:02:03.456Z") });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("vacuum");
    expect(result.path).toBe(path.join(userDataDir, "backup", "metadata-2026-11-05T01-02-03-456Z.sqlite3"));
    expect(fs.existsSync(result.path!)).toBe(true);
    const backupDb = new Database(result.path!);
    try { expect((backupDb.prepare("SELECT value FROM t WHERE id='a'").get() as { value: string }).value).toBe("hello"); }
    finally { backupDb.close(); }
    expect(result.message).toContain("已备份数据库");
  });

  it("数据库文件不存在 ⇒ 失败，并明说原因（不产出空备份）", () => {
    const userDataDir = tempDir();
    const result = backupDatabaseForRecovery({ dbPath: path.join(userDataDir, "missing.sqlite3"), userDataDir });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("备份失败");
    expect(result.message).toContain("不存在");
  });

  it("坏库 VACUUM 失败 ⇒ 降级文件级拷贝，并在 message 里明说「可能不完整」", () => {
    const userDataDir = tempDir();
    const dbPath = path.join(userDataDir, "workspace-default", "metadata.sqlite3");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const garbage = "definitely not sqlite";
    fs.writeFileSync(dbPath, garbage);
    const result = backupDatabaseForRecovery({ dbPath, userDataDir, now: new Date("2026-11-05T02:03:04.567Z") });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("copy");
    expect(result.message).toContain("文件级拷贝");
    expect(result.message).toContain("可能不完整");
    expect(fs.readFileSync(result.path!, "utf8")).toBe(garbage);
  });
});

describe("持久崩溃标记（crash-marker.json）", () => {
  it("写/读/累积次数：同一用户目录多次异常只累加 occurrences", () => {
    const userDataDir = tempDir();
    expect(crashMarkerPath(userDataDir)).toBe(path.join(userDataDir, CRASH_MARKER_FILE));
    const first = writeCrashMarker(userDataDir, new Error("boom"), new Date("2026-11-05T00:00:00.000Z"));
    expect(first).toMatchObject({ reason: "boom", occurrences: 1, time: "2026-11-05T00:00:00.000Z" });
    const second = writeCrashMarker(userDataDir, new Error("boom again"), new Date("2026-11-05T00:01:00.000Z"));
    expect(second?.occurrences).toBe(2);
    const read = readCrashMarker(userDataDir);
    expect(read).toMatchObject({ reason: "boom again", occurrences: 2, time: "2026-11-05T00:01:00.000Z" });
    expect(read?.stack).toContain("Error: boom again");
  });

  it("缺失/损坏的标记文件返回 null（启动路径不能因标记再失败一次）", () => {
    const userDataDir = tempDir();
    expect(readCrashMarker(userDataDir)).toBeNull();
    fs.mkdirSync(path.dirname(crashMarkerPath(userDataDir)), { recursive: true });
    fs.writeFileSync(crashMarkerPath(userDataDir), "{not json");
    expect(readCrashMarker(userDataDir)).toBeNull();
    fs.writeFileSync(crashMarkerPath(userDataDir), JSON.stringify({ time: 123 }));
    expect(readCrashMarker(userDataDir)).toBeNull();
  });

  it("delete/remove：消费后不再出现", () => {
    const userDataDir = tempDir();
    writeCrashMarker(userDataDir, new Error("boom"));
    removeCrashMarker(userDataDir);
    expect(readCrashMarker(userDataDir)).toBeNull();
    expect(fs.existsSync(crashMarkerPath(userDataDir))).toBe(false);
  });

  it("非 Error 的异常也能落标记（reason 兜底字符串化）", () => {
    const userDataDir = tempDir();
    const marker = writeCrashMarker(userDataDir, "plain string failure");
    expect(marker?.reason).toContain("plain string failure");
    expect(marker?.stack).toBe("");
  });
});
