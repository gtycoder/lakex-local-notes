/**
 * 移动端「同步未完成」标记（261026 用户点单：退出再进来要能无感续上）。
 *
 * 存储：**device_state 表为主**（随 App 数据一起备份/清理，进程被杀也不会丢），
 * localStorage 仅作迁移来源与极端兜底（旧版本写入的值在首次读取时自然兼容）。
 * 生命周期：syncNow 开始即写、**成功结束才删**；网络失败 / 后台被杀 / 用户退出都保留。
 * 下次冷启动或回到前台，useAutoSync 看到标记就**无条件**补一次（不受 autoMode=manual 限制）。
 */
import type { MobileDb } from "../data/sqliteDb.js";

const DB_KEY = "sync_interrupted_at";
const LS_KEY = "local-lakex-notes-mobile.syncInterruptedAt";

function lsGet(): string | null {
  try { return globalThis.localStorage?.getItem(LS_KEY) ?? null; } catch { return null; }
}
function lsSet(value: string): void {
  try { globalThis.localStorage?.setItem(LS_KEY, value); } catch { /* 隐私模式/无存储 */ }
}
function lsRemove(): void {
  try { globalThis.localStorage?.removeItem(LS_KEY); } catch { /* 同上 */ }
}

export async function markSyncInterrupted(db: MobileDb | null, at: string = new Date().toISOString()): Promise<void> {
  lsSet(at); // 迁移兜底：极老版本/降级读取时还能看到
  if (!db) return;
  try {
    await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(DB_KEY, at);
  } catch { /* 表异常时退化为 localStorage */ }
}

export async function clearSyncInterrupted(db: MobileDb | null): Promise<void> {
  lsRemove();
  if (!db) return;
  try { await db.prepare("DELETE FROM device_state WHERE key=?").run(DB_KEY); } catch { /* 同上 */ }
}

export async function readSyncInterruptedAt(db: MobileDb | null): Promise<string | null> {
  if (db) {
    try {
      const row = await db.prepare("SELECT value FROM device_state WHERE key=?").get(DB_KEY) as { value?: string } | undefined;
      if (row?.value) return row.value;
    } catch { /* 回退 localStorage */ }
  }
  return lsGet();
}

export async function hasInterruptedSync(db: MobileDb | null): Promise<boolean> {
  return (await readSyncInterruptedAt(db)) !== null;
}
