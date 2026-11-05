/**
 * Batch4-A（261105）：**从备份导入恢复**桌面主库（故障矩阵 #4「只能导出、无法自助恢复」）。
 *
 * 流程（安全顺序，失败不破坏原库）：
 *  1) 校验备份文件：文件名白名单（metadata*.sqlite3）、路径白名单/防目录穿越、能打开 + quick_check
 *     + 关键表存在 + 外键零违反；
 *  2) 隔离当前库：`<userData>/corrupt/restore-<ts>/`（改名，**不删除**；含 -wal/-shm），失败即回滚；
 *  3) 复制备份到位（先临时名再 rename）：复制后**再校验一次**，失败则把原库移回（回滚）；
 *  4) 返回「需要重启」提示（进程内 Store 仍持有旧句柄，必须重启才生效）。
 *
 * 本模块不 import electron，路径/文件/校验逻辑可在 vitest 里用临时目录直接测；
 * 目录选择框与 IPC 在主进程（electron/ipc/registerNotes.ts、main.ts 恢复页）。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const MAIN_DB_BASENAME = "metadata.sqlite3";
/** 备份文件命名白名单：应用导出/工作区备份产生的都是 metadata.sqlite3 或 metadata-<ts>.sqlite3。 */
const BACKUP_BASENAME_RE = /^metadata(?:-[A-Za-z0-9._-]+)?\.sqlite3$/;
/** 主库必须存在的关键表（缺任一 ⇒ 不是本应用的库，拒绝恢复）。 */
const REQUIRED_TABLES = ["notes", "tree_nodes", "settings", "device_state"];

// ---- 备份候选路径白名单（主进程选择框登记；IPC 只能恢复登记过的文件，防渲染层/HTTP 传任意路径） ----
const rememberedCandidates = new Set<string>();

export function isAcceptableBackupPath(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.includes("\0")) return false;
  if (!path.isAbsolute(trimmed)) return false;
  // 防目录穿越：按路径段拒绝 "." / ".."（不靠字符串 includes，避免误伤文件名里的两个点）。
  if (trimmed.split(/[\\/]+/).some((segment) => segment === "." || segment === "..")) return false;
  return BACKUP_BASENAME_RE.test(path.basename(trimmed));
}

/** 选择框选中后登记（返回是否可接受）；IPC 只接受登记过的绝对路径。 */
export function rememberRestoreCandidate(filePath: string): boolean {
  if (!isAcceptableBackupPath(filePath)) return false;
  rememberedCandidates.add(path.resolve(filePath));
  return true;
}

export function isRememberedRestoreCandidate(filePath: unknown): filePath is string {
  return typeof filePath === "string" && rememberedCandidates.has(path.resolve(filePath));
}

/** 测试/维护用：清空登记（不影响文件）。 */
export function clearRestoreCandidates(): void {
  rememberedCandidates.clear();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name && error.name !== "Error" ? error.name + ": " + error.message : error.message;
  try { return typeof error === "string" ? error : JSON.stringify(error); } catch { return String(error); }
}

function timestamp(now: () => Date): string {
  return now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export interface BackupInspection {
  ok: boolean;
  reason?: string;
  /** 备份库里的表名（诊断/测试用）。 */
  tables?: string[];
}

/**
 * 校验备份库（只读，不写任何文件）：能打开 + quick_check + 关键表 + 外键零违反。
 * 任何一步失败都返回 ok=false + 可读原因（调用方据此拒绝替换，原库保持不动）。
 */
export function inspectBackupDatabase(dbPath: string): BackupInspection {
  if (!fs.existsSync(dbPath)) return { ok: false, reason: "备份文件不存在：" + dbPath };
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const messages = (db.prepare("PRAGMA quick_check").all() as Array<{ quick_check?: string }>)
      .map((row) => row.quick_check ?? "").filter((message) => message.length > 0);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((row) => row.name);
    if (!(messages.length <= 1 && messages[0] === "ok")) {
      return { ok: false, reason: "备份库完整性检查未通过（quick_check=" + (messages.join("; ") || "unknown") + "）", tables };
    }
    const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));
    if (missing.length > 0) return { ok: false, reason: "备份库缺少关键表：" + missing.join("、"), tables };
    const foreignKeyErrors = (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
    if (foreignKeyErrors > 0) return { ok: false, reason: "备份库外键检查未通过（" + foreignKeyErrors + " 处违反）", tables };
    return { ok: true, tables };
  } catch (error) {
    return { ok: false, reason: "无法打开备份文件：" + describeError(error) };
  } finally {
    try { db?.close(); } catch { /* 已关闭 */ }
  }
}

/** 可注入的文件操作（单测覆盖回滚路径用；缺省 = node:fs）。 */
export interface RestoreFsOps {
  existsSync: (target: string) => boolean;
  mkdirSync: (target: string, options?: { recursive?: boolean }) => void;
  renameSync: (from: string, to: string) => void;
  copyFileSync: (from: string, to: string) => void;
  rmSync: (target: string, options?: { force?: boolean }) => void;
}

export interface RestoreFromBackupOptions {
  backupPath: string;
  /** 当前主库路径（<workspace>/metadata.sqlite3）。 */
  currentDbPath: string;
  userDataDir: string;
  now?: () => Date;
  fsOps?: Partial<RestoreFsOps>;
}

export interface RestoreFromBackupResult {
  ok: boolean;
  reason?: string;
  /** 失败时是否把原库完整移回（false = 回滚也失败，必须人工介入，message 会说明）。 */
  rolledBack?: boolean;
  /** 成功时原库的隔离目录（**不删除**，可手动找回）。 */
  quarantinePath?: string;
  message?: string;
}

/**
 * 从备份恢复主库（**校验 → 隔离 → 复制 → 校验 → 需重启**）。失败时尽最大努力回滚，
 * 只有在校验阶段失败时才能保证「一个文件都没动」（隔离/复制阶段失败会回滚并返回 rolledBack）。
 */
export function restoreMainDatabaseFromBackup(options: RestoreFromBackupOptions): RestoreFromBackupResult {
  const ops: RestoreFsOps = {
    existsSync: fs.existsSync,
    mkdirSync: (target, opts) => { fs.mkdirSync(target, opts); },
    renameSync: fs.renameSync,
    copyFileSync: fs.copyFileSync,
    rmSync: (target, opts) => { fs.rmSync(target, opts); },
    ...options.fsOps,
  };
  const now = options.now ?? (() => new Date());
  const backupPath = path.resolve(options.backupPath);
  const currentDbPath = path.resolve(options.currentDbPath);
  if (!isAcceptableBackupPath(backupPath)) {
    return { ok: false, reason: "备份文件无效：仅支持应用导出/整库备份产生的 metadata*.sqlite3 文件" };
  }
  if (backupPath === currentDbPath) {
    return { ok: false, reason: "所选文件就是当前正在使用的数据库，不能用来恢复" };
  }
  const inspection = inspectBackupDatabase(backupPath);
  if (!inspection.ok) return { ok: false, reason: inspection.reason ?? "备份文件校验未通过" };

  const quarantinePath = path.join(options.userDataDir, "corrupt", "restore-" + timestamp(now));
  const moved: Array<{ from: string; to: string }> = [];
  try {
    ops.mkdirSync(quarantinePath, { recursive: true });
    // 1) 隔离当前库（含 WAL/SHM）：改名而不是删除，失败可原样移回。
    for (const suffix of ["", "-wal", "-shm"]) {
      const from = currentDbPath + suffix;
      if (!ops.existsSync(from)) continue;
      const to = path.join(quarantinePath, MAIN_DB_BASENAME + suffix);
      ops.renameSync(from, to);
      moved.push({ from, to });
    }
    // 2) 复制备份到位：先临时名再 rename，避免半截文件；随后再校验一次落位结果。
    const tempPath = currentDbPath + ".restore-tmp";
    ops.copyFileSync(backupPath, tempPath);
    ops.renameSync(tempPath, currentDbPath);
    const verify = inspectBackupDatabase(currentDbPath);
    if (!verify.ok) throw new Error("替换后校验失败：" + (verify.reason ?? "unknown"));
    return {
      ok: true,
      quarantinePath,
      message: "已从备份恢复主库。原库已隔离保留在 " + quarantinePath + "（未删除）；请重启应用后生效。",
    };
  } catch (error) {
    // 3) 回滚：删掉可能写入的新库，把隔离的原库按相反顺序移回。
    try { ops.rmSync(currentDbPath, { force: true }); } catch { /* 尽力 */ }
    let rolledBack = true;
    for (const item of [...moved].reverse()) {
      try { ops.renameSync(item.to, item.from); } catch { rolledBack = false; }
    }
    return {
      ok: false,
      reason: describeError(error),
      rolledBack,
      message: rolledBack
        ? "已回滚，原库未变。原因：" + describeError(error)
        : "原库未能自动移回（仍保留在 " + quarantinePath + "）；请勿删除该目录，并联系维护者。原因：" + describeError(error),
    };
  }
}
