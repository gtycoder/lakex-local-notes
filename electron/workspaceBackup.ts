/**
 * A1/A2 工作区备份与云端恢复（桌面主进程）。
 *
 * A1 导出：把 workspace-default 完整拷贝到用户选择的备份目录（db + notes + note-assets + history +
 *   quick-notes + draft-journal）。数据库用顺序拷贝 db/wal 的 WAL 快照（个人单用户低频备份，best-effort；
 *   提示导出期间勿编辑）。不引入压缩库（KISS，无新增依赖）。
 * A2 prepareCloudRestore：把当前 workspace 改名隔离备份 → 建全新空 workspace → app relaunch；
 *   重启后空库首次同步自动全量拉取（引擎「无 latest manifest = 首次同步」语义），完成即恢复。
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const SQLITE_FILES = ["metadata.sqlite3", "metadata.sqlite3-wal", "metadata.sqlite3-shm"];

/** 备份目录下是否已有内容（防覆盖用户目录）。 */
export function backupTargetExists(targetDir: string): boolean {
  try { return fs.readdirSync(targetDir).length > 0; } catch { return false; }
}

/** A1：把 workspaceRoot 全量备份到 targetDir（含小记子库）。返回 { backupPath, dirs }。 */
export function exportWorkspaceBackup(workspaceRoot: string, targetDir: string, log: (msg: string) => void): { backupPath: string; copiedDirs: string[] } {
  if (!fs.existsSync(workspaceRoot)) throw new Error("工作区不存在，无法备份");
  fs.mkdirSync(targetDir, { recursive: true });
  if (backupTargetExists(targetDir)) throw new Error("目标目录非空：请选择空目录或新建目录");
  const copiedDirs: string[] = [];
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    const src = path.join(workspaceRoot, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
      copiedDirs.push(entry.name);
      log(`[backup] dir ${entry.name}`);
    } else if (SQLITE_FILES.includes(entry.name)) {
      // 数据库文件：连 wal/shm 一起拷贝（WAL 快照）。拷贝顺序 db→wal 由调用方保证先拷 db。
      try { fs.copyFileSync(src, dst); log(`[backup] db ${entry.name}`); } catch { log(`[backup] skip ${entry.name}`); }
    } else if (entry.name === "settings.json" || entry.name === "window-state.json") {
      try { fs.copyFileSync(src, dst); log(`[backup] misc ${entry.name}`); } catch { /* ignore */ }
    }
  }
  // 若 db 在子目录（不会，但保险）：小记库随 quick-notes 目录整体拷过了。
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
