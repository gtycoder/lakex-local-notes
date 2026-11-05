/**
 * 261105 Batch4-E：自动备份（主库 + 小记库，VACUUM INTO）+ 轮转保留。
 *
 * 设计要点（与 RESILIENCE 契约一致）：
 * - **恢复入口已具备**（设置→从备份恢复 / 启动恢复页），本模块只负责"按时生成可恢复的备份"：
 *   定时检查（main 就绪后每 6h tick，**启动不立即跑**）→ 纯函数策略（enabled / 到期 / 单飞 / 内容未变跳过）
 *   → VACUUM INTO 到 `<userData>/backups/metadata-<ts>.sqlite3` + `quicknotes-<ts>.sqlite3`
 *   （VACUUM 失败降级文件级拷贝并在结果里明说可能不完整）；
 * - 轮转：保留最近 N 份 + 总大小上限，最旧优先删除；删除失败只 warn，绝不抛出/阻断；
 * - 状态持久化到 settings（auto_backup_settings / auto_backup_state），只在本机、不进 git/同步；
 * - 备份失败不阻断主流程（调度器吞错，日志一条 [backup]）。
 *
 * 恢复范围说明（文案）：本轮「从备份恢复」入口只恢复**主库**；小记库备份文件同时保留在备份目录，
 * 需要时可手工拷贝/后续支持。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** 备份设置（settings key = auto_backup_settings）。 */
export interface AutoBackupSettings {
  enabled: boolean;
  /** 间隔天数：1 = 每天，7 = 每周（只允许这两个值，避免用户配出奇怪频率）。 */
  intervalDays: number;
  /** 保留最近 N 份（1..50）。 */
  keepCount: number;
  /** 备份目录总大小上限（字节，默认 300MB）。 */
  maxTotalBytes: number;
}

export const AUTO_BACKUP_DEFAULTS: AutoBackupSettings = {
  // 默认开启：数据安全兜底（用户可在设置里关闭）；每天一份、留 7 份、总大小 300MB。
  enabled: true,
  intervalDays: 1,
  keepCount: 7,
  maxTotalBytes: 300 * 1024 * 1024,
};

export const AUTO_BACKUP_TICK_MS = 6 * 60 * 60 * 1000;
export const BACKUP_MAIN_PREFIX = "metadata";
export const BACKUP_QUICKNOTES_PREFIX = "quicknotes";

/** 归一设置（非法输入返回 null，调用方报 InvalidInput；不做静默降级）。 */
export function normalizeAutoBackupSettings(raw: unknown): AutoBackupSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<AutoBackupSettings>;
  if (typeof value.enabled !== "boolean") return null;
  const intervalDays = value.intervalDays;
  if (intervalDays !== 1 && intervalDays !== 7) return null;
  const keepCount = typeof value.keepCount === "number" ? Math.floor(value.keepCount) : NaN;
  if (!Number.isFinite(keepCount) || keepCount < 1 || keepCount > 50) return null;
  const maxTotalBytes = typeof value.maxTotalBytes === "number" ? Math.floor(value.maxTotalBytes) : NaN;
  if (!Number.isFinite(maxTotalBytes) || maxTotalBytes < 10 * 1024 * 1024 || maxTotalBytes > 5 * 1024 * 1024 * 1024) return null;
  return { enabled: value.enabled, intervalDays, keepCount, maxTotalBytes };
}

export interface BackupFingerprint { size: number; mtimeMs: number }

export interface AutoBackupState {
  lastBackupAt: string;
  result: "ok" | "partial" | "failed";
  message: string;
  /** 本次备份的主库指纹（内容未变跳过用）。 */
  fingerprint: BackupFingerprint | null;
  mainFile: string | null;
  quickNotesFile: string | null;
}

export function normalizeAutoBackupState(raw: unknown): AutoBackupState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<AutoBackupState>;
  if (typeof value.lastBackupAt !== "string" || !value.lastBackupAt) return null;
  if (value.result !== "ok" && value.result !== "partial" && value.result !== "failed") return null;
  const fingerprint = value.fingerprint && typeof value.fingerprint === "object"
    && typeof (value.fingerprint as BackupFingerprint).size === "number"
    && typeof (value.fingerprint as BackupFingerprint).mtimeMs === "number"
    ? { size: (value.fingerprint as BackupFingerprint).size, mtimeMs: (value.fingerprint as BackupFingerprint).mtimeMs }
    : null;
  return {
    lastBackupAt: value.lastBackupAt,
    result: value.result,
    message: typeof value.message === "string" ? value.message : "",
    fingerprint,
    mainFile: typeof value.mainFile === "string" ? value.mainFile : null,
    quickNotesFile: typeof value.quickNotesFile === "string" ? value.quickNotesFile : null,
  };
}

export type BackupPolicyReason = "ok" | "disabled" | "busy" | "not-due" | "unchanged";

export interface BackupPolicyInput {
  enabled: boolean;
  /** 单飞：已有备份在跑。 */
  busy: boolean;
  nowMs: number;
  lastBackupAtMs: number | null;
  intervalDays: number;
  /** 当前主库指纹；null = 读不到（按"有变化"处理，允许备份）。 */
  fingerprint: BackupFingerprint | null;
  lastFingerprint: BackupFingerprint | null;
  /** 手动「立即备份」：绕过 enabled / 到期 / 内容未变（仍受单飞约束）。 */
  manual?: boolean;
}

/** 纯策略：是否该跑一次自动备份（测试主入口）。 */
export function decideAutoBackup(input: BackupPolicyInput): { run: boolean; reason: BackupPolicyReason } {
  if (input.busy) return { run: false, reason: "busy" };
  if (input.manual) return { run: true, reason: "ok" };
  if (!input.enabled) return { run: false, reason: "disabled" };
  const intervalMs = Math.max(1, input.intervalDays) * 24 * 60 * 60 * 1000;
  if (input.lastBackupAtMs !== null && input.nowMs - input.lastBackupAtMs < intervalMs) {
    return { run: false, reason: "not-due" };
  }
  const same = input.fingerprint && input.lastFingerprint
    && input.fingerprint.size === input.lastFingerprint.size
    && input.fingerprint.mtimeMs === input.lastFingerprint.mtimeMs;
  if (same) return { run: false, reason: "unchanged" };
  return { run: true, reason: "ok" };
}

/** 主库指纹（size+mtime）；读不到 = null（仍允许备份，由备份阶段给出真实失败原因）。 */
export function readDatabaseFingerprint(dbPath: string): BackupFingerprint | null {
  try {
    const stat = fs.statSync(dbPath);
    return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
  } catch {
    return null;
  }
}

export function backupsDir(userDataDir: string): string {
  return path.join(userDataDir, "backups");
}

function timestampOf(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** 备份文件命名（恢复入口的 metadata*.sqlite3 白名单兼容；小记文件独立前缀）。 */
export function backupFileNames(now: Date): { main: string; quickNotes: string; stamp: string } {
  const stamp = timestampOf(now);
  return { stamp, main: BACKUP_MAIN_PREFIX + "-" + stamp + ".sqlite3", quickNotes: BACKUP_QUICKNOTES_PREFIX + "-" + stamp + ".sqlite3" };
}

export interface DatabaseBackupResult { ok: boolean; mode?: "vacuum" | "copy"; path?: string; message: string }

/**
 * 单个 SQLite 文件备份：首选 VACUUM INTO（一致快照，备份可独立打开）；失败降级为文件级拷贝
 * （可能不完整，message 明说）。文件不存在 = ok:false（调用方按需降级为 partial）。
 */
export function backupDatabaseFile(opts: { dbPath: string; targetPath: string }): DatabaseBackupResult {
  const target = opts.targetPath;
  if (!fs.existsSync(opts.dbPath)) return { ok: false, message: "数据库文件不存在：" + opts.dbPath };
  try { fs.mkdirSync(path.dirname(target), { recursive: true }); }
  catch (error) { return { ok: false, message: "无法创建备份目录：" + (error instanceof Error ? error.message : String(error)) }; }
  try {
    const db = new Database(opts.dbPath);
    try { db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`); } finally { try { db.close(); } catch { /* ignore */ } }
    return { ok: true, mode: "vacuum", path: target, message: "已备份（VACUUM INTO）：" + target };
  } catch (vacuumError) {
    try {
      fs.copyFileSync(opts.dbPath, target);
      for (const suffix of ["-wal", "-shm"]) {
        if (fs.existsSync(opts.dbPath + suffix)) {
          try { fs.copyFileSync(opts.dbPath + suffix, target + suffix); } catch { /* 边车拷贝失败不影响主文件 */ }
        }
      }
      return {
        ok: true,
        mode: "copy",
        path: target,
        message: "VACUUM INTO 失败（" + (vacuumError instanceof Error ? vacuumError.message : String(vacuumError)) + "），已文件级拷贝（可能不完整）：" + target,
      };
    } catch (copyError) {
      return { ok: false, message: "备份失败：VACUUM INTO（" + (vacuumError instanceof Error ? vacuumError.message : String(vacuumError)) + "），文件拷贝也失败（" + (copyError instanceof Error ? copyError.message : String(copyError)) + "）" };
    }
  }
}

/** 备份可用性校验：能打开 + quick_check=ok（测试与「立即备份」自检共用）。 */
export function verifySqliteBackup(dbPath: string): { ok: boolean; reason?: string } {
  if (!fs.existsSync(dbPath)) return { ok: false, reason: "备份文件不存在" };
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const messages = (db.prepare("PRAGMA quick_check").all() as Array<{ quick_check?: string }>)
      .map((row) => row.quick_check ?? "").filter(Boolean);
    return messages.length <= 1 && messages[0] === "ok" ? { ok: true } : { ok: false, reason: "quick_check=" + messages.join("; ") };
  } catch (error) {
    return { ok: false, reason: "无法打开备份文件：" + (error instanceof Error ? error.message : String(error)) };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export interface BackupGroup { stamp: string; files: string[]; bytes: number; mtimeMs: number }

/** 列出备份目录里的备份组（按文件内嵌时间戳配对 metadata-/quicknotes-）。 */
export function listBackupGroups(dir: string): BackupGroup[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const groups = new Map<string, BackupGroup>();
  for (const name of names) {
    const match = /^(metadata|quicknotes)-(.+)\.sqlite3$/.exec(name);
    if (!match) continue;
    const stamp = match[2];
    let stat: fs.Stats;
    try { stat = fs.statSync(path.join(dir, name)); } catch { continue; }
    if (!stat.isFile()) continue;
    const group = groups.get(stamp) ?? { stamp, files: [], bytes: 0, mtimeMs: 0 };
    group.files.push(name);
    group.bytes += stat.size;
    group.mtimeMs = Math.max(group.mtimeMs, Math.round(stat.mtimeMs));
    groups.set(stamp, group);
  }
  return [...groups.values()].sort((a, b) => b.stamp.localeCompare(a.stamp)); // 新 → 旧（时间戳字符串可直接比）
}

/** 轮转：保留最近 keepCount 组 + 总大小 ≤ maxTotalBytes（最旧优先删；删除失败只 warn）。 */
export function rotateBackups(opts: {
  dir: string;
  keepCount: number;
  maxTotalBytes: number;
  log?: (message: string) => void;
}): { deleted: string[]; kept: number; totalBytes: number; warnings: string[] } {
  const groups = listBackupGroups(opts.dir); // 新 → 旧
  const deleted: string[] = [];
  const warnings: string[] = [];
  const kept = new Set<string>();
  let totalBytes = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const withinCount = index < Math.max(1, opts.keepCount);
    const withinSize = totalBytes + group.bytes <= opts.maxTotalBytes;
    if (withinCount && (withinSize || index === 0)) { // 至少保留最新一份，避免超小上限把备份删光
      kept.add(group.stamp);
      totalBytes += group.bytes;
      continue;
    }
    for (const file of group.files) {
      try {
        fs.rmSync(path.join(opts.dir, file), { force: true });
        deleted.push(file);
      } catch (error) {
        warnings.push("删除旧备份失败 " + file + "：" + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  if (deleted.length > 0) opts.log?.("[backup] 轮转删除 " + deleted.length + " 个旧备份（保留 " + kept.size + " 份，" + totalBytes + "B）");
  return { deleted, kept: kept.size, totalBytes, warnings };
}

export interface BackupCycleResult {
  ran: boolean;
  reason: BackupPolicyReason;
  state: AutoBackupState | null;
  message: string;
}

/**
 * 跑一次备份（主库必做；小记库尽力；VACUUM 失败降级拷贝；最后轮转）。
 * **绝不抛错**：任何异常都收敛成 failed/partial 状态（调度器不再二次兜底）。
 */
export function runBackupCycle(opts: {
  userDataDir: string;
  mainDbPath: string;
  quickNotesDbPath?: string | null;
  settings: AutoBackupSettings;
  now?: Date;
  log?: (message: string) => void;
}): BackupCycleResult {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const dir = backupsDir(opts.userDataDir);
  const names = backupFileNames(now);
  const errors: string[] = [];
  let mainFile: string | null = null;
  let quickNotesFile: string | null = null;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (error) {
    const message = "无法创建备份目录：" + (error instanceof Error ? error.message : String(error));
    opts.log?.("[backup] " + message);
    return { ran: true, reason: "ok", state: { lastBackupAt: at, result: "failed", message, fingerprint: null, mainFile: null, quickNotesFile: null }, message };
  }
  try {
    const main = backupDatabaseFile({ dbPath: opts.mainDbPath, targetPath: path.join(dir, names.main) });
    if (main.ok) mainFile = main.path ?? names.main;
    else errors.push(main.message);
    if (main.mode === "copy") errors.push("主库 VACUUM 失败，已文件级拷贝（可能不完整）");
    if (!opts.quickNotesDbPath) errors.push("小记库不可用：本次未备份小记库");
    else {
      const quick = backupDatabaseFile({ dbPath: opts.quickNotesDbPath, targetPath: path.join(dir, names.quickNotes) });
      if (quick.ok) quickNotesFile = quick.path ?? names.quickNotes;
      else errors.push("小记库：" + quick.message);
      if (quick.mode === "copy") errors.push("小记库 VACUUM 失败，已文件级拷贝（可能不完整）");
    }
    const rotation = rotateBackups({ dir, keepCount: opts.settings.keepCount, maxTotalBytes: opts.settings.maxTotalBytes, log: opts.log });
    errors.push(...rotation.warnings);
    const fingerprint = readDatabaseFingerprint(opts.mainDbPath);
    const result: AutoBackupState["result"] = !main.ok ? "failed" : errors.length > 0 ? "partial" : "ok";
    const message = (mainFile ? "已备份主库：" + mainFile : "主库备份失败") + (quickNotesFile ? "；小记库：" + quickNotesFile : "") + (errors.length > 0 ? "；注意：" + errors.join("；") : "");
    opts.log?.("[backup] " + JSON.stringify({ result, at, main: names.main, quickNotes: opts.quickNotesDbPath ? names.quickNotes : null, deleted: rotation.deleted.length, kept: rotation.kept, bytes: rotation.totalBytes }));
    return { ran: true, reason: "ok", state: { lastBackupAt: at, result, message, fingerprint, mainFile, quickNotesFile }, message };
  } catch (error) {
    const message = "备份失败：" + (error instanceof Error ? error.message : String(error));
    opts.log?.("[backup] " + message);
    return { ran: true, reason: "ok", state: { lastBackupAt: at, result: "failed", message, fingerprint: null, mainFile, quickNotesFile }, message };
  }
}
