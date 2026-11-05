/**
 * Batch4-B：文件 ↔ 元数据对账（只报告版，参考思源 index_fix 的节流）。
 *
 * 现状：只有小记 FTS 启动对账与「缺正文」清单，没有「正文文件 vs DB 行」的反向对账
 *（文件在、行丢 ⇒ 正文永远不可见）⇒ 只能一条条撞。
 *
 * 本模块的边界（重要）：
 * - 只 stat，不读字节；不写库、不写文件、不删东西、不重建正文。
 * - 「行在、文件没」已由缺正文链路（readNote bodyMissing / 资源页）覆盖，这里不重复做。
 * - 触发严格节流：同步完成之后 + 进程空闲 >= N 分钟 + 有 dirty 标记 + 距上次 >= M 分钟冷却
 *   + TryLock（拿锁后、进维护队列后再判一次），且全程与同步/GC 共用 enqueueMaintenance 串行域。
 * - 默认关闭（main.ts 用 LAKE_FILE_RECONCILE=1 显式开启）；开启后也只产出报告，供设置→同步诊断
 *   （runDataHealthCheck 的 fileReconcile 字段）与日志查看，候选清理前必须人工确认。
 */
import fs from "node:fs";
import path from "node:path";
import { NOTE_BODY_DIR, NOTE_BODY_EXT } from "../src/core/noteBodyPaths.js";
import { NOTE_KINDS, type NoteKind } from "../src/core/noteKind.js";
import { isSafePathSegment } from "../src/core/storeUtils.js";

export const FILE_RECONCILE_DEFAULTS = {
  /** 进程空闲多少秒后才允许跑（powerMonitor.getSystemIdleTime 同口径）。 */
  minIdleSeconds: 5 * 60,
  /**
   * 默认节奏 = **每 24h 一次**（261105 定稿：功能从"默认关闭/30min 冷却"降级为低频只报告，
   * 避免每分钟/每半小时扫一遍大库；0 小时 = 关闭，由设置页配置）。
   */
  intervalHours: 24,
  /** 两次实跑之间的冷却：与 24h 节奏合并（interval 变更时由调用方覆盖 cooldownMs）。 */
  cooldownMs: 24 * 60 * 60 * 1000,
  /** 单次报告最多列出的候选条数（防大库把报告撑爆）。 */
  maxCandidates: 500,
  /** 单次扫描的文件数硬上限（防御性；超了记 truncated）。 */
  maxScannedFiles: 200_000,
} as const;

/** 设置归一：扫描间隔（小时，0 = 关闭；上限 720h 防误配成天文数字）。 */
export function normalizeFileScanIntervalHours(value: unknown): number | null {
  const hours = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(hours)) return null;
  return Math.min(720, Math.max(0, Math.floor(hours * 100) / 100));
}

export type ReconcileBlockReason =
  | "ok"
  | "disabled"
  | "running"
  | "waiting-sync"
  | "no-dirty"
  | "not-idle"
  | "cooldown";

export interface ReconcileThrottleInput {
  enabled: boolean;
  running: boolean;
  afterSyncPending: boolean;
  dirty: boolean;
  idleSeconds: number;
  minIdleSeconds: number;
  nowMs: number;
  lastRunAtMs: number | null;
  cooldownMs: number;
  manual?: boolean;
}

export interface ReconcileThrottleDecision {
  run: boolean;
  reason: ReconcileBlockReason;
  waitMs?: number;
}

/** 纯函数：节流判据（测试主入口；不满足一律不跑）。 */
export function decideFileReconcile(input: ReconcileThrottleInput): ReconcileThrottleDecision {
  if (!input.enabled && !input.manual) return { run: false, reason: "disabled" };
  if (input.running) return { run: false, reason: "running" };
  if (input.manual) return { run: true, reason: "ok" };
  if (!input.afterSyncPending) return { run: false, reason: "waiting-sync" };
  if (!input.dirty) return { run: false, reason: "no-dirty" };
  if (input.idleSeconds < input.minIdleSeconds) {
    return { run: false, reason: "not-idle", waitMs: (input.minIdleSeconds - input.idleSeconds) * 1000 };
  }
  if (input.lastRunAtMs !== null && input.nowMs - input.lastRunAtMs < input.cooldownMs) {
    return { run: false, reason: "cooldown", waitMs: input.cooldownMs - (input.nowMs - input.lastRunAtMs) };
  }
  return { run: true, reason: "ok" };
}

/** 报告候选：文件在、DB 行丢（正文对象）。字段供设置页/日志展示，足够人工确认后再处理。 */
export interface FileOrphanCandidate {
  /** 从文件名反解出的笔记 id（该 id 在 DB 里没有对应 notes 行）。 */
  noteId: string;
  kind: NoteKind;
  /** 相对 workspace 根的正文路径（与 noteBodyRelativePath 同口径）。 */
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface FileReconcileReport {
  generatedAt: string;
  durationMs: number;
  enabled: boolean;
  trigger: "sync-idle" | "manual-report";
  /** 当前配置的扫描间隔（小时，0 = 关闭）。设置页显示「上次扫描时间/是否启用」用。 */
  intervalHours: number;
  /** DB 里已知的正文行数（notes.deleted_at IS NULL；含回收站行——它们本来就有文件）。 */
  knownRows: number;
  scannedFiles: number;
  /** 命名不符合正文契约 / 非法的文件数（.tmp 残留等）。 */
  ignoredFiles: number;
  scanErrors: number;
  candidates: FileOrphanCandidate[];
  candidateCount: number;
  truncated: boolean;
  /** 不存在（= 该类型尚无文档）的正文目录名；正常现象，仅诊断参考。 */
  missingBodyDirs: string[];
}

export interface ScanOrphanBodyInput {
  root: string;
  knownNoteIds: ReadonlySet<string>;
  nowMs?: number;
  maxCandidates?: number;
  maxScannedFiles?: number;
}

/** 只读扫描：stat-only，不读正文、不写盘、不触碰 DB。 */
export function scanOrphanBodyFiles(input: ScanOrphanBodyInput): Omit<FileReconcileReport, "enabled" | "trigger" | "intervalHours"> {
  const startedAt = input.nowMs ?? Date.now();
  const maxCandidates = Math.max(1, input.maxCandidates ?? FILE_RECONCILE_DEFAULTS.maxCandidates);
  const maxScannedFiles = Math.max(1, input.maxScannedFiles ?? FILE_RECONCILE_DEFAULTS.maxScannedFiles);
  const candidates: FileOrphanCandidate[] = [];
  const missingBodyDirs: string[] = [];
  let scannedFiles = 0;
  let ignoredFiles = 0;
  let scanErrors = 0;
  let truncated = false;

  outer: for (const kind of NOTE_KINDS) {
    const dir = path.join(input.root, NOTE_BODY_DIR[kind]);
    const ext = NOTE_BODY_EXT[kind];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      missingBodyDirs.push(NOTE_BODY_DIR[kind]);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!name.endsWith(ext)) { ignoredFiles += 1; continue; }
      const noteId = name.slice(0, name.length - ext.length);
      if (!isSafePathSegment(noteId)) { ignoredFiles += 1; continue; }
      if (scannedFiles >= maxScannedFiles) { truncated = true; break outer; }
      scannedFiles += 1;
      if (input.knownNoteIds.has(noteId)) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(path.join(dir, name)); } catch { scanErrors += 1; continue; }
      candidates.push({
        noteId,
        kind,
        relativePath: NOTE_BODY_DIR[kind] + "/" + name,
        sizeBytes: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
      });
      if (candidates.length >= maxCandidates) { truncated = true; break outer; }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.relativePath.localeCompare(b.relativePath));
  return {
    generatedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    knownRows: input.knownNoteIds.size,
    scannedFiles,
    ignoredFiles,
    scanErrors,
    candidates,
    candidateCount: candidates.length,
    truncated,
    missingBodyDirs,
  };
}

export interface FileMetadataReconcilerDeps {
  root: string;
  /** DB 已知正文 id（含回收站行）。每次实跑时现取，避免缓存过期。 */
  listKnownNoteIds: () => Iterable<string>;
  /** 进程空闲秒数（main = powerMonitor.getSystemIdleTime；测试注入）。 */
  getIdleSeconds: () => number;
  /** 维护域串行队列（同步/GC/深度清理同一队列）。 */
  enqueueMaintenance: <T>(task: () => Promise<T>) => Promise<T>;
  enabled: boolean;
  /** 扫描间隔（小时，0 = 关闭）；缺省 24h。cooldownMs 缺省 = intervalHours×3600e3。 */
  intervalHours?: number;
  minIdleSeconds?: number;
  cooldownMs?: number;
  maxCandidates?: number;
  now?: () => number;
  log?: (message: string) => void;
  onReport?: (report: FileReconcileReport) => void;
  /** 上次成功扫描时间（ISO；设备本地持久化，跨重启生效）。缺失/损坏按未跑过处理。 */
  loadLastRunAt?: () => string | null;
  /** 成功扫描后持久化（settings/device_state；失败只记日志，不影响本轮）。 */
  saveLastRunAt?: (at: string) => void;
}

/**
 * 定时器唤醒延迟（纯函数）：按「下次到期」睡，而不是每 60s 醒一次。
 * - 空闲未达标 ⇒ 等到空闲达标；
 * - 冷却未到 ⇒ 等到冷却到期；
 * - 取两者较大值（两者都满足才可能跑），下限 1s，上限 24h（Node 定时器安全范围；720h 间隔也不会溢）。
 */
export function computeReconcileWakeDelayMs(input: {
  minIdleSeconds: number;
  idleSeconds: number;
  cooldownMs: number;
  lastRunAtMs: number | null;
  nowMs: number;
}): number {
  const waitIdle = Math.max(0, input.minIdleSeconds - input.idleSeconds) * 1000;
  const waitCooldown = input.lastRunAtMs === null ? 0 : Math.max(0, input.cooldownMs - (input.nowMs - input.lastRunAtMs));
  return Math.min(24 * 3600_000, Math.max(1_000, Math.ceil(Math.max(waitIdle, waitCooldown))));
}

export interface ReconcileRunOutcome {
  ran: boolean;
  reason: ReconcileBlockReason;
  report?: FileReconcileReport;
}

/**
 * 对账调度器：TryLock + 维护域串行 + 双重空闲/冷却判定。
 * - 入口只有两个：onSyncComplete()（同步成功后打点，等空闲/冷却到点）与 markDirty()（本地写）；
 * - 定时器只是「到点再试一次」，不保证跑——能否跑一律回到 decideFileReconcile；
 * - tryRun() 可被测试/手动报告直接调用（manual 绕过 idle/dirty/冷却，仍串行）。
 */
export class FileMetadataReconciler {
  private readonly deps: FileMetadataReconcilerDeps;
  private readonly minIdleSeconds: number;
  private readonly intervalHours: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private dirty = false;
  private afterSyncPending = false;
  private running = false;
  private lastRunAtMs: number | null = null;
  private lastReport: FileReconcileReport | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: FileMetadataReconcilerDeps) {
    this.deps = deps;
    this.minIdleSeconds = deps.minIdleSeconds ?? FILE_RECONCILE_DEFAULTS.minIdleSeconds;
    this.intervalHours = deps.intervalHours ?? FILE_RECONCILE_DEFAULTS.intervalHours;
    // 冷却与节奏合并：缺省用 intervalHours 推导（24h = 低频），显式 cooldownMs 优先（测试/特殊场景）。
    this.cooldownMs = deps.cooldownMs ?? Math.max(1, Math.round(this.intervalHours * 3600_000));
    this.now = deps.now ?? (() => Date.now());
    // 跨重启的「上次成功扫描」：缺失/非法 = null（按未跑过，本轮到期即跑）；绝不因坏值阻断启动。
    try {
      const persisted = deps.loadLastRunAt?.() ?? null;
      const parsed = persisted ? Date.parse(persisted) : NaN;
      this.lastRunAtMs = Number.isFinite(parsed) ? parsed : null;
    } catch {
      this.lastRunAtMs = null;
    }
  }

  /** 同步成功后打点：等进程空闲 + 冷却满足才实跑（不是立刻跑）。 */
  onSyncComplete(): void {
    this.afterSyncPending = true;
    this.dirty = true; // 同步可能带回/删除正文行——视为本地世界已变
    this.schedule();
  }

  /** 本地写打点（保存/导入等）；只置脏并重排定时器，不触发立即扫描。 */
  markDirty(): void {
    this.dirty = true;
    this.schedule();
  }

  getLastReport(): FileReconcileReport | null {
    return this.lastReport;
  }

  get enabled(): boolean { return this.deps.enabled; }

  /** 当前配置的扫描间隔（小时，0 = 关闭）；设置页诊断展示用。 */
  getIntervalHours(): number { return this.intervalHours; }

  dispose(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /**
   * 尝试跑一次（只读）。TryLock 非阻塞：并发调用直接返回 running。
   * 进维护队列后会再判一次（排队期间可能又开始同步/用户回来），不满足则跳过、不推进 lastRun。
   */
  async tryRun(opts: { manual?: boolean } = {}): Promise<ReconcileRunOutcome> {
    const manual = opts.manual === true;
    const pre = this.decide(manual);
    if (!pre.run) return { ran: false, reason: pre.reason };
    if (!this.tryLock()) return { ran: false, reason: "running" };
    try {
      return await this.deps.enqueueMaintenance(async (): Promise<ReconcileRunOutcome> => {
        // 拿锁 + 进队列后二次判（同步可能在排队期间开始；用户可能回来；冷却可能还没到）。
        // ignoreOwnLock：TryLock 的 running 是自己的，不能把自己判成 running。
        const post = this.decide(manual, true);
        if (!post.run) return { ran: false, reason: post.reason };
        const report = this.scan(manual ? "manual-report" : "sync-idle");
        this.lastRunAtMs = this.now();
        try { this.deps.saveLastRunAt?.(new Date(this.lastRunAtMs).toISOString()); } catch { /* 落盘失败不影响本轮 */ }
        this.dirty = false;
        this.afterSyncPending = false;
        this.lastReport = report;
        this.deps.log?.("[reconcile] " + JSON.stringify({
          trigger: report.trigger,
          knownRows: report.knownRows,
          scannedFiles: report.scannedFiles,
          candidates: report.candidateCount,
          truncated: report.truncated,
          durationMs: report.durationMs,
        }));
        this.deps.onReport?.(report);
        return { ran: true, reason: "ok", report };
      });
    } finally {
      this.running = false;
    }
  }

  /** 定时器到点：尝试一次；条件仍不满足则按新的到期时间重排（低频任务不再每 60s 空转）。 */
  private schedule(): void {
    if (!this.deps.enabled) return;
    if (this.timer) return;
    const wait = this.nextWaitMs();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tryRun()
        .then(() => {
          if (this.afterSyncPending && this.dirty) this.schedule();
        })
        .catch(() => { /* 对账失败绝不打扰主流程 */ });
    }, wait);
    this.timer.unref?.();
  }

  private nextWaitMs(): number {
    return computeReconcileWakeDelayMs({
      minIdleSeconds: this.minIdleSeconds,
      idleSeconds: this.deps.getIdleSeconds(),
      cooldownMs: this.cooldownMs,
      lastRunAtMs: this.lastRunAtMs,
      nowMs: this.now(),
    });
  }

  /** 间隔/开关变化后重排定时器（不清 dirty/同步打点；条件满足时立刻重算下一次到期）。 */
  rearm(): void {
    this.dispose();
    if (this.afterSyncPending || this.dirty) this.schedule();
  }

  /** 上次成功扫描时间（ms；未跑过/null = null）。诊断/测试用。 */
  getLastRunAtMs(): number | null { return this.lastRunAtMs; }

  private decide(manual: boolean, ignoreOwnLock = false): ReconcileThrottleDecision {
    return decideFileReconcile({
      enabled: this.deps.enabled,
      running: ignoreOwnLock ? false : this.running,
      afterSyncPending: this.afterSyncPending,
      dirty: this.dirty,
      idleSeconds: this.deps.getIdleSeconds(),
      minIdleSeconds: this.minIdleSeconds,
      nowMs: this.now(),
      lastRunAtMs: this.lastRunAtMs,
      cooldownMs: this.cooldownMs,
      manual,
    });
  }

  private tryLock(): boolean {
    if (this.running) return false;
    this.running = true;
    return true;
  }

  private scan(trigger: FileReconcileReport["trigger"]): FileReconcileReport {
    const base = scanOrphanBodyFiles({
      root: this.deps.root,
      knownNoteIds: new Set(this.deps.listKnownNoteIds()),
      maxCandidates: this.deps.maxCandidates,
    });
    return { ...base, enabled: this.deps.enabled, trigger, intervalHours: this.intervalHours };
  }
}
