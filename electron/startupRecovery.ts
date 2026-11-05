/**
 * 启动硬失败恢复（P1-5，261105）：DB 打开失败/完整性检查不通过时**不再卡在 boot splash**，
 * 而是给出可操作出口（备份后重试、云端恢复、打开数据目录、退出），并留下可诊断的持久证据。
 *
 * 本文件只放**主进程可单测的纯逻辑/文件操作**（不 import electron）：
 * - 启动前完整性预检（PRAGMA quick_check + foreign_key_check）：必须先于 Store 构造；
 * - 启动决策（openError / integrity → normal | recovery）：判定与 UI 解耦，便于单测；
 * - 恢复模式页面 HTML（内联、无 preload）：按钮只做**同文档 hash 跳转**，由主进程拦截；
 * - 一次性备份（VACUUM INTO，失败降级文件拷贝，**失败必须明说**）；
 * - 持久崩溃标记 crash-marker.json（uncaughtException 后写，下次启动读取并消费）。
 *
 * 为什么恢复页不用 preload/IPC：打包 files 只列了 electron/preload.cjs（改 package.json 不在本任务
 * 写作用域），新增 preload 文件不会进安装包；恢复页是静态内联页，用同文档 hash 触发动作即可，
 * 不需要任何渲染层 API（也避免把恢复通道暴露给正常页面）。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** 错误摘要（不依赖 electron/logger，避免把主进程运行时拖进单测）。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.name && error.name !== "Error" ? error.name + ": " + error.message : error.message;
  try { return typeof error === "string" ? error : JSON.stringify(error); }
  catch { return String(error); }
}

// ===== 1) 启动前完整性预检 =====

export interface StartupIntegrity {
  /** true = 可以继续构造 Store；false = 必须进恢复模式。 */
  ok: boolean;
  /** 用户/日志可读摘要（含 quick_check 结果与外键违反数）。 */
  detail: string;
  /** quick_check 返回值（"ok" / 首个错误摘要 / "missing"）。 */
  quickCheck: string;
  foreignKeyErrors: number;
}

/**
 * 启动前 DB 体检（**必须先于 Store 构造**）：只读 pragma，不建表不迁移。
 * 文件不存在 = 全新安装（Store 会建库）⇒ 视为通过。
 * 打开/查询抛错一律视为不通过（恢复模式），绝不静默继续。
 */
export function inspectDatabaseForStartup(dbPath: string): StartupIntegrity {
  if (!fs.existsSync(dbPath)) {
    return { ok: true, detail: "数据库文件不存在（将按全新库创建）", quickCheck: "missing", foreignKeyErrors: 0 };
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);
    const rows = db.prepare("PRAGMA quick_check").all() as Array<{ quick_check?: string }>;
    const messages = rows.map((row) => row.quick_check ?? "").filter((message) => message.length > 0);
    const quickCheck = messages.length > 0 ? messages.join("; ") : "ok";
    const foreignKeyErrors = (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
    const ok = foreignKeyErrors === 0 && messages.length <= 1 && messages[0] === "ok";
    return {
      ok,
      quickCheck,
      foreignKeyErrors,
      detail: ok
        ? "完整性检查通过（quick_check=ok，外键违反 0 处）"
        : `完整性检查未通过（quick_check=${quickCheck}，外键违反 ${foreignKeyErrors} 处）`,
    };
  } catch (error) {
    return { ok: false, quickCheck: "error", foreignKeyErrors: 0, detail: "打开/校验数据库失败：" + describeError(error) };
  } finally {
    try { db?.close(); } catch { /* 已关闭/从未打开 */ }
  }
}

// ===== 2) 启动决策（normal | recovery）=====

export type StartupRecoveryCause = "open" | "integrity" | "none";

export interface StartupRecoveryInput {
  /** 预检结果；省略 = 未做预检（按通过处理，便于旧调用点/单测）。 */
  integrity?: StartupIntegrity | null;
  /** Store 构造异常（打开/迁移失败）。 */
  openError?: unknown;
  /** 上次运行遗留的持久崩溃标记（只作为提示，不单独触发恢复模式）。 */
  crashMarker?: CrashMarker | null;
}

export interface StartupRecoveryDecision {
  mode: "normal" | "recovery";
  cause: StartupRecoveryCause;
  /** 恢复页标题级原因（normal 时为空串）。 */
  reason: string;
  /** 技术细节（恢复页 <pre> 与日志都写它；normal 时写体检摘要）。 */
  detail: string;
  crashMarker: CrashMarker | null;
}

/**
 * 启动模式判定（纯函数）：
 * - 打开异常优先（打不开就谈不上完整性）⇒ recovery/open；
 * - 预检不通过 ⇒ recovery/integrity；
 * - 其余 ⇒ normal。crashMarker 只透传（提示用），**不**改变模式。
 */
export function decideStartupRecovery(input: StartupRecoveryInput = {}): StartupRecoveryDecision {
  const crashMarker = input.crashMarker ?? null;
  if (input.openError !== undefined && input.openError !== null) {
    return {
      mode: "recovery",
      cause: "open",
      reason: "打开本地数据库失败",
      detail: "数据库打开异常：" + describeError(input.openError),
      crashMarker,
    };
  }
  if (input.integrity && !input.integrity.ok) {
    return {
      mode: "recovery",
      cause: "integrity",
      reason: "本地数据库完整性检查未通过",
      detail: input.integrity.detail,
      crashMarker,
    };
  }
  return {
    mode: "normal",
    cause: "none",
    reason: "",
    detail: input.integrity?.detail ?? "启动完整性预检已跳过",
    crashMarker,
  };
}

// ===== 3) 持久崩溃标记 =====

export const CRASH_MARKER_FILE = "crash-marker.json";

/** 持久崩溃标记：time/reason/stack 摘要 + 次数（同一进程多次异常只累积次数，不刷屏）。 */
export interface CrashMarker {
  time: string;
  reason: string;
  stack: string;
  /** 连续累计次数（下次启动提示「上次运行捕获 N 次未捕获异常」）。 */
  occurrences: number;
}

export function crashMarkerPath(userDataDir: string): string {
  return path.join(userDataDir, CRASH_MARKER_FILE);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

/** 读标记：损坏/不存在/字段不合法都返回 null（启动路径绝不能因为标记文件再失败一次）。 */
export function readCrashMarker(userDataDir: string): CrashMarker | null {
  try {
    const raw = fs.readFileSync(crashMarkerPath(userDataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<CrashMarker>;
    if (typeof parsed?.time !== "string" || typeof parsed?.reason !== "string") return null;
    return {
      time: parsed.time,
      reason: parsed.reason,
      stack: typeof parsed.stack === "string" ? parsed.stack : "",
      occurrences: typeof parsed.occurrences === "number" && Number.isFinite(parsed.occurrences) ? parsed.occurrences : 1,
    };
  } catch {
    return null;
  }
}

/**
 * 写/累积标记（uncaughtException 用）。**自身绝不抛错**：崩溃处理里再抛会把现场彻底冲掉。
 * 返回写入的标记（失败返回 null，调用方只记日志）。
 */
export function writeCrashMarker(userDataDir: string, error: unknown, now: Date = new Date()): CrashMarker | null {
  try {
    const previous = readCrashMarker(userDataDir);
    const stack = error instanceof Error && error.stack ? error.stack : "";
    const marker: CrashMarker = {
      time: now.toISOString(),
      reason: truncate(describeError(error), 500),
      stack: truncate(stack, 2000),
      occurrences: (previous?.occurrences ?? 0) + 1,
    };
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(crashMarkerPath(userDataDir), JSON.stringify(marker, null, 2), "utf8");
    return marker;
  } catch {
    return null;
  }
}

/** 正常启动成功后消费标记（提示只出现一次；恢复模式保留给恢复页展示）。 */
export function removeCrashMarker(userDataDir: string): void {
  try { fs.rmSync(crashMarkerPath(userDataDir), { force: true }); } catch { /* 尽力删除 */ }
}

// ===== 4) 一次性备份（先备份后继续）=====

export interface RecoveryBackupResult {
  ok: boolean;
  /** vacuum = VACUUM INTO 一致快照；copy = 降级文件级拷贝（可能不完整，必须提示）。 */
  mode?: "vacuum" | "copy";
  path?: string;
  message: string;
}

/**
 * 备份主库到 `<userData>/backup/metadata-<ts>.sqlite3`：
 * 首选 `VACUUM INTO`（单文件、可独立打开）；DB 打不开时降级为 `metadata.sqlite3`(+wal/shm)
 * 原样拷贝——**两类结果都如实返回 message**，失败绝不静默。
 */
export function backupDatabaseForRecovery(opts: { dbPath: string; userDataDir: string; now?: Date }): RecoveryBackupResult {
  const backupDir = path.join(opts.userDataDir, "backup");
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `metadata-${stamp}.sqlite3`);
  if (!fs.existsSync(opts.dbPath)) {
    return { ok: false, message: `备份失败：数据库文件不存在（${opts.dbPath}）` };
  }
  try { fs.mkdirSync(backupDir, { recursive: true }); }
  catch (error) {
    return { ok: false, message: `备份失败：无法创建备份目录（${backupDir}）：${describeError(error)}` };
  }
  try {
    const db = new Database(opts.dbPath);
    try {
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
      try { db.close(); } catch { /* 忽略关闭失败 */ }
    }
    return { ok: true, mode: "vacuum", path: target, message: `已备份数据库（VACUUM INTO）到 ${target}` };
  } catch (vacuumError) {
    // 降级：原样拷贝（坏库/打不开时 VACUUM 必失败；至少把现场留档，别让用户无处可查）。
    try {
      fs.copyFileSync(opts.dbPath, target);
      for (const suffix of ["-wal", "-shm"]) {
        const sidecar = opts.dbPath + suffix;
        if (fs.existsSync(sidecar)) {
          try { fs.copyFileSync(sidecar, target + suffix); } catch { /* 边车缺失不影响主拷贝 */ }
        }
      }
      return {
        ok: true,
        mode: "copy",
        path: target,
        message: `VACUUM INTO 失败（${describeError(vacuumError)}），已改为文件级拷贝（可能不完整）：${target}`,
      };
    } catch (copyError) {
      return { ok: false, message: `备份失败：VACUUM INTO 失败（${describeError(vacuumError)}），文件拷贝也失败（${describeError(copyError)}）` };
    }
  }
}

// ===== 5) 恢复页（内联 HTML，无 preload）=====

export interface RecoveryPageInfo {
  /** 决策给出的原因（标题下一行）。 */
  reason: string;
  /** 技术细节（quick_check 摘要 / 打开异常）。 */
  detail: string;
  dataDir: string;
  workspacePath: string;
  logPath: string;
  backupDir: string;
  crashMarker: CrashMarker | null;
}

/** 恢复页动作（同文档 hash 触发；主进程拦截，不走 IPC/preload）。 */
export type RecoveryAction = "backup" | "cloud-restore" | "open-data" | "quit";

/** 解析 `#action=<name>`（允许附加 `&t=<nonce>` 以支持重复点击）。 */
export function parseRecoveryActionHash(hash: string): RecoveryAction | null {
  const match = /^#?action=(backup|cloud-restore|open-data|quit)(?:&|$)/.exec(hash);
  return match ? (match[1] as RecoveryAction) : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 静态恢复页 HTML。**不加载任何外部资源**（恢复模式下不能假设渲染层/内核可用）：
 * 内联样式 + 内联脚本；按钮只写 `location.hash = "action=..."`，动作与结果全在主进程。
 * 注意：这里的配色不用桌面 --lake-* 令牌（应急页不是产品界面，无法加载主题样式）。
 */
export function buildRecoveryPageHtml(info: RecoveryPageInfo): string {
  const crash = info.crashMarker
    ? `
    <section class="card crash">
      <h2>上次运行有未捕获异常</h2>
      <p>${escapeHtml(info.crashMarker.time)}（累计 ${info.crashMarker.occurrences} 次）· ${escapeHtml(info.crashMarker.reason)}</p>
      ${info.crashMarker.stack ? `<pre>${escapeHtml(info.crashMarker.stack)}</pre>` : ""}
    </section>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
<title>LakexLocalNotes 启动恢复</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 32px 32px; font: 13px/1.6 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: light-dark(#f6f7f9, #1e2126); color: light-dark(#1f2329, #e6e8ea); }
  h1 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
  h2 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
  p { margin: 0; }
  .reason { color: light-dark(#8a2f2f, #f0a5a5); font-weight: 600; margin-bottom: 10px; }
  .card { border: 1px solid light-dark(#d9dde3, #3a3f46); border-radius: 8px; padding: 12px 14px; margin: 12px 0; }
  .detail { white-space: pre-wrap; word-break: break-all; color: light-dark(#4a5058, #c3c7cc); }
  .paths { display: grid; grid-template-columns: 88px 1fr; gap: 4px 10px; margin: 10px 0 0; }
  .paths dt { color: light-dark(#6b727b, #9aa0a8); }
  .paths dd { margin: 0; word-break: break-all; user-select: text; }
  pre { margin: 8px 0 0; max-height: 120px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 12px; color: light-dark(#8a2f2f, #f0a5a5); }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid light-dark(#c6ccd4, #4a5058); background: light-dark(#ffffff, #2a2e34); color: inherit; cursor: pointer; }
  button:hover { border-color: light-dark(#8f98a3, #6b727b); }
  button.primary { background: light-dark(#2f5fd0, #4b7bec); border-color: light-dark(#2f5fd0, #4b7bec); color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .status { margin-top: 16px; min-height: 20px; white-space: pre-wrap; word-break: break-all; }
  .status.ok { color: light-dark(#1e6b3a, #7fd39a); }
  .status.err { color: light-dark(#8a2f2f, #f0a5a5); }
  .hint { margin-top: 18px; color: light-dark(#6b727b, #9aa0a8); font-size: 12px; }
</style>
</head>
<body>
  <h1>本地知识库启动失败</h1>
  <p class="reason">${escapeHtml(info.reason)}</p>
  <section class="card">
    <h2>原因摘要</h2>
    <p class="detail">${escapeHtml(info.detail)}</p>
    <dl class="paths">
      <dt>数据目录</dt><dd>${escapeHtml(info.dataDir)}</dd>
      <dt>工作区</dt><dd>${escapeHtml(info.workspacePath)}</dd>
      <dt>日志</dt><dd>${escapeHtml(info.logPath)}</dd>
      <dt>备份目录</dt><dd>${escapeHtml(info.backupDir)}</dd>
    </dl>
  </section>${crash}
  <div class="actions">
    <button class="primary" data-action="backup">先备份后继续</button>
    <button data-action="cloud-restore">从云端恢复（换机/坏库）</button>
    <button data-action="open-data">打开数据目录</button>
    <button data-action="quit">退出</button>
  </div>
  <div class="status" id="status" role="status" aria-live="polite"></div>
  <p class="hint">「先备份后继续」会先做一份数据库快照再重试打开；「从云端恢复」会把当前工作区改名隔离保留，然后用空库重启（需要重新配置云同步后从云端拉回）。</p>
<script>
  (() => {
    let busy = false;
    const status = document.getElementById("status");
    const buttons = Array.from(document.querySelectorAll("button[data-action]"));
    const setStatus = (payload) => {
      if (!payload || typeof payload.message !== "string") return;
      status.textContent = payload.message;
      status.className = "status " + (payload.ok ? "ok" : "err");
    };
    const setBusy = (value) => {
      busy = value;
      for (const button of buttons) button.disabled = value;
    };
    for (const button of buttons) {
      button.addEventListener("click", () => {
        if (busy) return;
        const action = button.getAttribute("data-action");
        if (!action) return;
        setBusy(true);
        setStatus({ ok: true, message: "处理中…" });
        // 同文档 hash 跳转 = 唯一的「页面 → 主进程」通道（恢复页不挂 preload/IPC）。
        location.hash = "action=" + action + "&t=" + Date.now();
      });
    }
    // 主进程完成后回调（executeJavaScript）；失败时 15s 解锁，避免页面永久禁用。
    window.__recoveryStatus = (payload) => {
      setBusy(false);
      setStatus(payload);
    };
    setTimeout(() => { if (busy) { setBusy(false); setStatus({ ok: false, message: "操作超时，请重试或直接退出后重开应用。" }); } }, 15000);
  })();
</script>
</body>
</html>`;
}
