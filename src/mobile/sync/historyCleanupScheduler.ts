/**
 * 移动端历史快照「定期清理」调度（MOB-09）。
 *
 * 桌面是主进程常驻 setInterval（electron/main.ts 的 cleanupTimer）；移动端 WebView 没有可靠的
 * 后台常驻定时器 ⇒ 改成**就绪/回前台时检查是否到期**（低频、默认 24h 一次，0 = 不自动清理，
 * 与桌面同一语义）。上次清理时间落 device_state（随 App 数据持久，进程被杀也不丢）；
 * 旧 localStorage 迁移兜底已删（261125 裁决，AGENTS §3#7）。
 *
 * 语义约束：
 * - **先记时间再清理**：清理中途被杀也不会每次启动都重跑；失败也等下一个间隔，不打扰用户。
 *   无 db 时标记不落盘（下次可能多清一次；清理按保留策略幂等，无害）。
 * - 只调用既有 bridge.cleanupHistory()（写域，内部按设置做分层保留），不新增原生 API。
 * - 读设置/开库失败由调用方静默（后台维护不弹提示）。
 */
import type { MobileDb } from "../data/dbPortTypes.js";
import type { HistoryMobileSettings } from "../data/historyRepository.js";

const DB_KEY = "history_cleanup_at";

/** 是否到了清理时间：intervalHours <= 0 = 关闭；从未清理过 = 到期；否则按间隔比较。 */
export function shouldRunHistoryCleanup(args: { now: number; lastAt: number | null; intervalHours: number }): boolean {
  if (!(args.intervalHours > 0)) return false;
  if (args.lastAt == null || !Number.isFinite(args.lastAt)) return true;
  return args.now - args.lastAt >= args.intervalHours * 3600 * 1000;
}

function parseAt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** 上次清理时间（device_state）；无 db/无记录 = 从未清理。 */
export async function readLastHistoryCleanupAt(db: MobileDb | null): Promise<number | null> {
  if (!db) return null;
  try {
    const row = await db.prepare("SELECT value FROM device_state WHERE key=?").get(DB_KEY) as { value?: string } | undefined;
    return parseAt(row?.value);
  } catch { return null; }
}

/** 记录本次清理时间（device_state）。 */
export async function markHistoryCleanupAt(db: MobileDb | null, at: Date = new Date()): Promise<void> {
  if (!db) return;
  const value = at.toISOString();
  try {
    await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(DB_KEY, value);
  } catch { /* 表异常：丢一次清理时间（下次可能多清一次），不抛错 */ }
}

export interface ScheduledHistoryCleanupDeps {
  /** 读历史设置（bridge.getHistorySettings）。 */
  readSettings: () => Promise<HistoryMobileSettings>;
  /** 真正的清理（bridge.cleanupHistory）。 */
  cleanup: () => Promise<{ deleted: number }>;
  /** 打开主库；失败可返回 null（标记不落盘，下次可能多清一次）。 */
  db: () => Promise<MobileDb | null>;
  /** 测试注入时钟。 */
  now?: number;
}

/** 到期就清理一次；返回是否真的跑了（未到期/已关闭都不跑）。 */
export async function runScheduledHistoryCleanup(deps: ScheduledHistoryCleanupDeps): Promise<{ ran: boolean; deleted: number }> {
  const settings = await deps.readSettings();
  const now = deps.now ?? Date.now();
  const db = await deps.db().catch(() => null);
  const lastAt = await readLastHistoryCleanupAt(db);
  if (!shouldRunHistoryCleanup({ now, lastAt, intervalHours: settings.cleanupIntervalHours })) {
    return { ran: false, deleted: 0 };
  }
  // 先落标记：清理可能删文件，中途被杀/失败都不该在下次启动立刻重跑（低频、不打扰）。
  await markHistoryCleanupAt(db, new Date(now));
  const result = await deps.cleanup();
  return { ran: true, deleted: result.deleted };
}
