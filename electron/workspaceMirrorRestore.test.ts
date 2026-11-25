import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { recoverInterruptedWorkspaceSwap, replaceWorkspaceWith, restoreWorkspaceMirror, swapPendingMarkerPath, type MirrorRestoreFsOps } from "./workspaceBackup.js";

function makeMainDb(file: string): void {
  const db = new Database(file);
  db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY); CREATE TABLE tree_nodes (id TEXT PRIMARY KEY); CREATE TABLE settings (k TEXT); CREATE TABLE device_state (k TEXT);");
  db.prepare("INSERT INTO notes (id) VALUES (?)").run("n1");
  db.close();
}

function makeQuickDb(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE quick_notes (id TEXT PRIMARY KEY); CREATE TABLE tags (id TEXT); CREATE TABLE tag_links (id TEXT); CREATE TABLE tag_link_versions (id TEXT);");
  db.prepare("INSERT INTO quick_notes (id) VALUES (?)").run("q1");
  db.close();
}

/** 造一个「整库备份」目录（结构与 exportWorkspaceBackup 产物一致）。 */
function makeBackupDir(tmp: string, opts: { withQuick?: boolean } = {}): string {
  const dir = path.join(tmp, "lakex-local-notes-backup-2026-11-22");
  fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
  makeMainDb(path.join(dir, "metadata.sqlite3"));
  fs.writeFileSync(path.join(dir, "notes", "a.lake"), "<p>backup</p>");
  fs.writeFileSync(path.join(dir, "settings.json"), "{\"from\":\"backup\"}");
  if (opts.withQuick !== false) {
    makeQuickDb(path.join(dir, "quick-notes", "metadata.sqlite3"));
    fs.mkdirSync(path.join(dir, "quick-notes", "items"), { recursive: true });
    fs.writeFileSync(path.join(dir, "quick-notes", "items", "q1.qnote"), "qn");
  }
  return dir;
}

function makeWorkspace(tmp: string): string {
  const ws = path.join(tmp, "workspace-default");
  fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
  fs.writeFileSync(path.join(ws, "notes", "old.lake"), "<p>old</p>");
  fs.writeFileSync(path.join(ws, "metadata.sqlite3"), "OLD-LIVE-DB");
  return ws;
}

describe("restoreWorkspaceMirror（A3 整库导入：目录模式）", () => {
  it("成功：整目录恢复（正文/资产/设置/两库），原工作区隔离保留", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const backup = makeBackupDir(tmp);
    const ws = makeWorkspace(tmp);
    const result = restoreWorkspaceMirror({ backupDir: backup, workspaceRoot: ws });
    expect(result.ok).toBe(true);
    expect(result.quickNotesRestored).toBe(true);
    expect(result.message).toContain("重启");
    // 新工作区 = 备份内容
    expect(fs.readFileSync(path.join(ws, "notes", "a.lake"), "utf8")).toBe("<p>backup</p>");
    expect(JSON.parse(fs.readFileSync(path.join(ws, "settings.json"), "utf8"))).toEqual({ from: "backup" });
    const quick = new Database(path.join(ws, "quick-notes", "metadata.sqlite3"), { readonly: true });
    try { expect((quick.prepare("SELECT id FROM quick_notes").all() as Array<{ id: string }>).map((r) => r.id)).toEqual(["q1"]); } finally { quick.close(); }
    // 旧工作区完整隔离在 quarantine（未删除）
    const quarantinePath = result.quarantinePath!;
    expect(fs.readFileSync(path.join(quarantinePath, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
    expect(fs.readFileSync(path.join(quarantinePath, "metadata.sqlite3"), "utf8")).toBe("OLD-LIVE-DB");
  });

  it("261123：备份无云端基线（源端从未配 S3）⇒ 恢复后合成「合并底稿」基线", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const backup = makeBackupDir(tmp);
    const ws = makeWorkspace(tmp);
    const result = restoreWorkspaceMirror({ backupDir: backup, workspaceRoot: ws });
    expect(result.ok).toBe(true);
    // 与便携包两条导入路线同口径（docs/PORTABLE-TRANSFER.md §3.1）：bootstrap 底稿 + 谱系留空。
    const gz = path.join(ws, "sync-v3", "baseline.json.gz");
    expect(fs.existsSync(gz)).toBe(true);
    const parsed = JSON.parse(gunzipSync(fs.readFileSync(gz)).toString("utf8")) as { bootstrap?: boolean; epoch: string };
    expect(parsed.bootstrap).toBe(true);
    expect(parsed.epoch).toBe("");
  });

  it("备份自带云端基线 ⇒ 原样保留、不合成", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const backup = makeBackupDir(tmp);
    fs.mkdirSync(path.join(backup, "sync-v3"), { recursive: true });
    const real = { epoch: "e-1", generation: 2, lakeCommit: "lc", quickNotesCommit: "qc", lake: { notes: [] }, quickNotes: { items: [] } };
    fs.writeFileSync(path.join(backup, "sync-v3", "baseline.json.gz"), gzipSync(Buffer.from(JSON.stringify(real))));
    const ws = makeWorkspace(tmp);
    const result = restoreWorkspaceMirror({ backupDir: backup, workspaceRoot: ws });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(gunzipSync(fs.readFileSync(path.join(ws, "sync-v3", "baseline.json.gz"))).toString("utf8")) as { epoch: string; bootstrap?: boolean };
    expect(parsed.epoch).toBe("e-1");
    expect(parsed.bootstrap ?? false).toBe(false);
  });

  it("261201 P1-A：备份内基线**内容损坏**（文件在但不可解析）⇒ 合成合并底稿 + 明示警告", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const backup = makeBackupDir(tmp);
    fs.mkdirSync(path.join(backup, "sync-v3"), { recursive: true });
    fs.writeFileSync(path.join(backup, "sync-v3", "baseline.json.gz"), "NOT-GZIP{{{");
    const ws = makeWorkspace(tmp);
    const result = restoreWorkspaceMirror({ backupDir: backup, workspaceRoot: ws });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(gunzipSync(fs.readFileSync(path.join(ws, "sync-v3", "baseline.json.gz"))).toString("utf8")) as { bootstrap?: boolean; epoch: string };
    expect(parsed.bootstrap).toBe(true);
    expect(parsed.epoch).toBe("");
    expect(result.message).toContain("合成合并底稿");
    expect(result.message).not.toContain("先拉取云端再增量");
  });

  it("旧备份无小记库：仍可恢复，quickNotesRestored=false", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const backup = makeBackupDir(tmp, { withQuick: false });
    const ws = makeWorkspace(tmp);
    const result = restoreWorkspaceMirror({ backupDir: backup, workspaceRoot: ws });
    expect(result.ok).toBe(true);
    expect(result.quickNotesRestored).toBe(false);
    expect(fs.readFileSync(path.join(ws, "notes", "a.lake"), "utf8")).toBe("<p>backup</p>");
  });

  it("缺 metadata.sqlite3 / 坏主库 / 目录在工作区内部 ⇒ 拒绝且一个文件都没动", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const ws = makeWorkspace(tmp);
    // 缺主库
    const emptyDir = path.join(tmp, "not-a-backup");
    fs.mkdirSync(emptyDir, { recursive: true });
    expect(restoreWorkspaceMirror({ backupDir: emptyDir, workspaceRoot: ws }).ok).toBe(false);
    // 坏主库（不是 SQLite）
    const badDir = path.join(tmp, "bad-backup");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "metadata.sqlite3"), "NOT-A-DATABASE");
    const bad = restoreWorkspaceMirror({ backupDir: badDir, workspaceRoot: ws });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain("校验");
    // 备份目录在工作区内部
    const inner = path.join(ws, "backup-inside");
    fs.mkdirSync(inner, { recursive: true });
    const innerResult = restoreWorkspaceMirror({ backupDir: inner, workspaceRoot: ws });
    expect(innerResult.ok).toBe(false);
    expect(innerResult.reason).toContain("工作区内部");
    // 三次失败都不动工作区
    expect(fs.readFileSync(path.join(ws, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
    expect(fs.readFileSync(path.join(ws, "metadata.sqlite3"), "utf8")).toBe("OLD-LIVE-DB");
  });

  it("replaceWorkspaceWith：materialize 抛错 ⇒ 回滚（旧工作区原样移回，rolledBack=true）", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const ws = makeWorkspace(tmp);
    const result = replaceWorkspaceWith({
      workspaceRoot: ws,
      quickNotesRestored: true,
      describe: "测试换位",
      materialize: () => { throw new Error("staging 升格失败（模拟）"); },
    });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toContain("staging 升格失败");
    expect(fs.readFileSync(path.join(ws, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
  });

  it("拷贝中途中断 ⇒ 回滚：旧工作区原样移回", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const backup = makeBackupDir(tmp);
    const ws = makeWorkspace(tmp);
    let copies = 0;
    const fsOps: Partial<MirrorRestoreFsOps> = {
      cpSync: (from, to) => {
        copies += 1;
        if (copies >= 2) throw new Error("磁盘满（模拟）");
        fs.cpSync(from, to, { recursive: true });
      },
    };
    const result = restoreWorkspaceMirror({ backupDir: backup, workspaceRoot: ws, fsOps });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toContain("磁盘满");
    // 回滚后旧工作区原样
    expect(fs.readFileSync(path.join(ws, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
    expect(fs.readFileSync(path.join(ws, "metadata.sqlite3"), "utf8")).toBe("OLD-LIVE-DB");
    // 261201 P2-A：当场回滚成功 ⇒ 恢复标记已清（不再留待下次启动）。
    expect(fs.existsSync(swapPendingMarkerPath(ws))).toBe(false);
  });
});

describe("换位崩溃恢复（261201 P2-A）", () => {
  it("成功换位不留恢复标记；失败当场回滚也不留", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const backup = makeBackupDir(tmp);
    const ws = makeWorkspace(tmp);
    const ok = restoreWorkspaceMirror({ backupDir: backup, workspaceRoot: ws });
    expect(ok.ok).toBe(true);
    expect(fs.existsSync(swapPendingMarkerPath(ws))).toBe(false);
    // 失败路径（换位本身抛错）同样清标记
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const ws2 = makeWorkspace(tmp2);
    const failed = replaceWorkspaceWith({
      workspaceRoot: ws2,
      quickNotesRestored: true,
      describe: "测试换位",
      materialize: () => { throw new Error("staging 升格失败（模拟）"); },
    });
    expect(failed.ok).toBe(false);
    expect(fs.existsSync(swapPendingMarkerPath(ws2))).toBe(false);
  });

  it("崩溃残留标记（phase=begin）⇒ 启动恢复把旧工作区完整移回（半成品丢弃）", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const ws = makeWorkspace(tmp);
    // 模拟：换位已把旧工作区隔离、materialize 写到一半进程死了。
    const quarantine = path.join(tmp, "workspace-quarantine-crash");
    fs.renameSync(ws, quarantine);
    fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
    fs.writeFileSync(path.join(ws, "half.lake"), "partial");
    fs.writeFileSync(swapPendingMarkerPath(ws), JSON.stringify({
      workspaceRoot: ws,
      quarantinePath: quarantine,
      hadWorkspace: true,
      phase: "begin",
    }));
    const r = recoverInterruptedWorkspaceSwap(ws);
    expect(r).toEqual({ recovered: true, restored: true });
    expect(fs.readFileSync(path.join(ws, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
    expect(fs.existsSync(path.join(ws, "half.lake"))).toBe(false);
    expect(fs.existsSync(quarantine)).toBe(false);
    expect(fs.existsSync(swapPendingMarkerPath(ws))).toBe(false);
  });

  it("崩溃残留标记（phase=done）⇒ 新工作区已落成：保留新工作区只清标记", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const ws = path.join(tmp, "workspace-default");
    fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
    fs.writeFileSync(path.join(ws, "notes", "new.lake"), "<p>new</p>");
    fs.writeFileSync(swapPendingMarkerPath(ws), JSON.stringify({
      workspaceRoot: ws,
      quarantinePath: path.join(tmp, "workspace-quarantine-x"),
      hadWorkspace: true,
      phase: "done",
    }));
    const r = recoverInterruptedWorkspaceSwap(ws);
    expect(r).toEqual({ recovered: true, restored: false });
    expect(fs.readFileSync(path.join(ws, "notes", "new.lake"), "utf8")).toBe("<p>new</p>");
    expect(fs.existsSync(swapPendingMarkerPath(ws))).toBe(false);
  });

  it("hadWorkspace 但隔离目录不在（rename 未发生）⇒ 绝不删旧工作区", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lake-mirror-"));
    const ws = makeWorkspace(tmp);
    fs.writeFileSync(swapPendingMarkerPath(ws), JSON.stringify({
      workspaceRoot: ws,
      quarantinePath: path.join(tmp, "missing-quarantine"),
      hadWorkspace: true,
      phase: "begin",
    }));
    const r = recoverInterruptedWorkspaceSwap(ws);
    expect(r.recovered).toBe(true);
    expect(fs.readFileSync(path.join(ws, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
    expect(fs.existsSync(swapPendingMarkerPath(ws))).toBe(false);
  });

  it("启动接线钉法：换位回滚在启动预检前执行（C-04 后经 boot/startupDecision 装配）", () => {
    const source = fs.readFileSync(path.join(__dirname, "main.ts"), "utf8");
    const decision = fs.readFileSync(path.join(__dirname, "boot", "startupDecision.ts"), "utf8");
    const recover = source.indexOf("rollbackInterruptedWorkspaceSwap(workspaceRoot())"); // main：调用点
    const inspect = source.indexOf("openStoreWithStartupProbe("); // 其内部做启动预检（inspectDatabaseForStartup）
    expect(recover).toBeGreaterThan(-1);
    expect(inspect).toBeGreaterThan(-1);
    expect(recover).toBeLessThan(inspect);
    expect(decision, "回滚实现必须真调 recoverInterruptedWorkspaceSwap").toContain("recoverInterruptedWorkspaceSwap(workspaceRoot)");
  });
});
