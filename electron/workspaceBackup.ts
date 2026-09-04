/**
 * A1/A2 工作区备份与云端恢复（桌面主进程）。
 *
 * A1 导出：把 workspace-default 完整备份到用户选择的目录。数据库用 VACUUM INTO 一致性快照
 *   （单文件、无 WAL 依赖、可独立打开——由持有 db 连接的 store/quickNotes 注入回调执行，
 *   保证与运行中写入一致）；notes/note-assets/history/quick-notes 等数据目录用 cpSync 拷贝。
 * A2 prepareCloudRestore：把当前 workspace 改名隔离备份 → 建全新空 workspace → app relaunch；
 *   重启后空库首次同步自动全量拉取（引擎「无 latest manifest = 首次同步」语义），完成即恢复。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const SQLITE_BASENAMES = new Set(["metadata.sqlite3", "metadata.sqlite3-wal", "metadata.sqlite3-shm"]);

/** 备份目录下是否已有内容（防覆盖用户目录）。 */
export function backupTargetExists(targetDir: string): boolean {
  try { return fs.readdirSync(targetDir).length > 0; } catch { return false; }
}

/** 目录拷贝回调排除 sqlite 文件（db 由 backupDatabases 用 VACUUM INTO 一致性快照产生）。 */
function excludeSqlite(src: string): boolean {
  return !SQLITE_BASENAMES.has(path.basename(src));
}

/** A1：把 workspaceRoot 全量备份到 targetDir（含小记子库）。
 * @param backupDatabases 注入回调：负责为主库与小记库生成一致性快照（store/quickNotes 连接执行 VACUUM INTO）。
 * 返回 { backupPath, copiedDirs }。 */
export function exportWorkspaceBackup(workspaceRoot: string, targetDir: string, backupDatabases: (targetRoot: string) => void, log: (msg: string) => void): { backupPath: string; copiedDirs: string[] } {
  if (!fs.existsSync(workspaceRoot)) throw new Error("工作区不存在，无法备份");
  fs.mkdirSync(targetDir, { recursive: true });
  if (backupTargetExists(targetDir)) throw new Error("目标目录非空：请选择空目录或新建目录");
  // 1) 一致性 DB 快照（先做：独立于目录拷贝，源连接执行 VACUUM INTO 无 WAL 依赖）
  backupDatabases(targetDir);
  // 2) 数据目录/杂项拷贝（排除 sqlite，避免与快照重复/不一致）
  const copiedDirs: string[] = [];
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (SQLITE_BASENAMES.has(entry.name)) continue;
    const src = path.join(workspaceRoot, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(src, dst, { recursive: true, filter: excludeSqlite });
      copiedDirs.push(entry.name);
      log(`[backup] dir ${entry.name}`);
    } else if (entry.name === "settings.json" || entry.name === "window-state.json") {
      try { fs.copyFileSync(src, dst); log(`[backup] misc ${entry.name}`); } catch { /* ignore */ }
    }
  }
  log(`[backup] done -> ${targetDir}`);
  return { backupPath: targetDir, copiedDirs };
}

/** A2：改名校验后的隔离备份名（时间戳）。 */
export function quarantineDirName(): string {
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `workspace-pre-restore-${ts}`;
}

/** A2：把当前 workspace 改名隔离 → 建空 workspace → 触发重启。restore 后空库首同步全量拉取。
 * 返回隔离备份新路径（供 UI 展示）；改名失败抛错（不重启）。 */
export function prepareCloudRestore(workspaceRoot: string): { quarantinePath: string } {
  if (!fs.existsSync(workspaceRoot)) throw new Error("工作区不存在，无法执行云端恢复");
  const parent = path.dirname(workspaceRoot);
  const quarantinePath = path.join(parent, quarantineDirName());
  fs.renameSync(workspaceRoot, quarantinePath);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return { quarantinePath };
}

/** A2：准备完成后调用（渲染层确认后）——重启应用进入空库首同步。 */
export function relaunchApp(): void {
  app.relaunch();
  app.exit(0);
}

/** A2：S3 凭据跨恢复保留 seed（重启后 main 读入新库再删除）。固定名放新 workspace 根。 */
export const S3_RESTORE_SEED = ".s3-restore-seed.json";

export function writeS3RestoreSeed(workspaceRoot: string, s3Settings: unknown): void {
  fs.writeFileSync(path.join(workspaceRoot, S3_RESTORE_SEED), JSON.stringify(s3Settings), { mode: 0o600 });
}

export function readAndRemoveS3RestoreSeed(workspaceRoot: string): unknown | null {
  const p = path.join(workspaceRoot, S3_RESTORE_SEED);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
  } finally {
    try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
  }
}
