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
import { inspectBackupDatabase, inspectQuickNotesDatabase } from "./workspaceRestoreFromBackup.js";

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


// ---- A3 整库导入（目录模式；PORTABLE-TRANSFER.md §4）：备份目录整目录恢复 ----

export interface MirrorRestoreFsOps {
  existsSync: (target: string) => boolean;
  readdirSync: (target: string) => fs.Dirent[];
  mkdirSync: (target: string, options?: { recursive?: boolean }) => void;
  renameSync: (from: string, to: string) => void;
  cpSync: (from: string, to: string) => void;
  rmSync: (target: string, options?: { recursive?: boolean; force?: boolean }) => void;
}

export interface MirrorRestoreOptions {
  backupDir: string;
  workspaceRoot: string;
  /** 测试用：覆盖文件操作（缺省 = node:fs）。 */
  fsOps?: Partial<MirrorRestoreFsOps>;
}

export interface MirrorRestoreResult {
  ok: boolean;
  reason?: string;
  /** 失败时是否已把原工作区移回（false = 回滚也失败，必须人工介入）。 */
  rolledBack?: boolean;
  /** 成功时原工作区的隔离目录（**不删除**，可手动找回；全新机器没有隔离时为 undefined）。 */
  quarantinePath?: string;
  /** 备份是否包含小记库（false = 旧备份只有主库，恢复后标签/小记为空）。 */
  quickNotesRestored?: boolean;
  message?: string;
}


/** 工作区换位选项（A3 整库导入 / 便携包导入共用同一套「隔离 → 落新 → 回滚」）。 */
export interface WorkspaceReplaceOptions {
  workspaceRoot: string;
  /** 旧工作区隔离后，把新工作区内容落到 workspaceRoot（rename staging 或 copy 备份目录）；抛错即回滚。 */
  materialize: (workspaceRoot: string) => void;
  quickNotesRestored: boolean;
  /** 成功文案的开头（例如「已从备份整库恢复」「便携包已导入」）。 */
  describe: string;
}

/**
 * 唯一的「换位 + 回滚」实现：当前工作区改名隔离（不删除）→ materialize 落新工作区；
 * 任何失败都把旧工作区移回（回滚失败如实报告 rolledBack=false）。
 */
export function replaceWorkspaceWith(options: WorkspaceReplaceOptions): MirrorRestoreResult {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const quarantinePath = path.join(path.dirname(workspaceRoot), quarantineDirName());
  const hadWorkspace = fs.existsSync(workspaceRoot);
  let quarantined = false;
  try {
    if (hadWorkspace) {
      fs.mkdirSync(path.dirname(workspaceRoot), { recursive: true });
      fs.renameSync(workspaceRoot, quarantinePath);
      quarantined = true;
    }
    options.materialize(workspaceRoot);
  } catch (error) {
    try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* 尽力 */ }
    let rolledBack = true;
    if (quarantined) {
      try { fs.renameSync(quarantinePath, workspaceRoot); } catch { rolledBack = false; }
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: detail, rolledBack };
  }
  return {
    ok: true,
    quarantinePath: quarantined ? quarantinePath : undefined,
    quickNotesRestored: options.quickNotesRestored,
    message: options.describe + "。" + (quarantined ? "原工作区已隔离保留在 " + quarantinePath + "（未删除）；" : "") + "请重启应用后生效。",
  };
}

/**
 * 从「整库备份」目录整库恢复（校验 → 隔离当前工作区 → 全量拷回 → 需重启）。
 * 与 Batch4-A「从数据库快照恢复」（只换两份库）互补：同端/大库/含历史归档走这条路；
 * 失败时尽最大努力回滚（校验阶段失败保证一个文件都没动）。
 */
export function restoreWorkspaceMirror(options: MirrorRestoreOptions): MirrorRestoreResult {
  const ops: MirrorRestoreFsOps = {
    existsSync: fs.existsSync,
    readdirSync: (target) => fs.readdirSync(target, { withFileTypes: true }),
    mkdirSync: (target, opts) => { fs.mkdirSync(target, opts); },
    renameSync: fs.renameSync,
    cpSync: (from, to) => { fs.cpSync(from, to, { recursive: true }); },
    rmSync: (target, opts) => { fs.rmSync(target, opts); },
    ...options.fsOps,
  };
  const backupDir = path.resolve(options.backupDir);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  // 守卫：备份目录不能是工作区自己或其子目录（防自嵌套拷贝与「把备份一起隔离」）。
  if (backupDir === workspaceRoot || backupDir.startsWith(workspaceRoot + path.sep)) {
    return { ok: false, reason: "备份目录不能位于工作区内部，请选择外部的备份目录" };
  }
  const backupMainDb = path.join(backupDir, "metadata.sqlite3");
  if (!ops.existsSync(backupMainDb)) {
    return { ok: false, reason: "备份目录无效：缺少 metadata.sqlite3（请选择「整库备份」产生的目录）" };
  }
  const mainInspection = inspectBackupDatabase(backupMainDb);
  if (!mainInspection.ok) return { ok: false, reason: "备份主库校验未通过：" + (mainInspection.reason ?? "未知原因") };
  const backupQuickDb = path.join(backupDir, "quick-notes", "metadata.sqlite3");
  const hasQuick = ops.existsSync(backupQuickDb);
  if (hasQuick) {
    const quickInspection = inspectQuickNotesDatabase(backupQuickDb);
    if (!quickInspection.ok) return { ok: false, reason: "备份小记库校验未通过：" + (quickInspection.reason ?? "未知原因") };
  }

  // 隔离 → 拷回 → 回滚统一走 replaceWorkspaceWith（materialize = 目录拷贝）。
  return replaceWorkspaceWith({
    workspaceRoot,
    quickNotesRestored: hasQuick,
    describe: hasQuick
      ? "已从备份整库恢复（主库 + 小记库）"
      : "已从备份整库恢复（备份中无小记库，恢复后标签/小记为空）",
    materialize: (freshRoot) => {
      ops.mkdirSync(freshRoot, { recursive: true });
      for (const entry of ops.readdirSync(backupDir)) {
        ops.cpSync(path.join(backupDir, entry.name), path.join(freshRoot, entry.name));
      }
    },
  });
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
