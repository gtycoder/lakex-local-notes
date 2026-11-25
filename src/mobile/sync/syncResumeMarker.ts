/**
 * 移动端「同步未完成」标记（261026 用户点单：退出再进来要能无感续上）。
 *
 * 存储：**device_state 表**（随 App 数据一起备份/清理，进程被杀也不会丢）。
 * 旧 localStorage 迁移兜底/表异常退化已删（261125 裁决，AGENTS §3#7：丢一次续传标记 = 多补一次同步）。
 * 生命周期：syncNow 开始即写、**成功结束才删**；网络失败 / 后台被杀 / 用户退出都保留。
 * 下次冷启动或回到前台，useAutoSync 看到标记就**无条件**补一次（不受 autoMode=manual 限制）。
 */
import type { MobileDb } from "../data/dbPortTypes.js";

const DB_KEY = "sync_interrupted_at";

export async function markSyncInterrupted(db: MobileDb | null, at: string = new Date().toISOString()): Promise<void> {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(DB_KEY, at);
  } catch { /* 表异常：丢一次续传标记（下一轮同步照常跑），不抛错 */ }
}

export async function clearSyncInterrupted(db: MobileDb | null): Promise<void> {
  if (!db) return;
  try { await db.prepare("DELETE FROM device_state WHERE key=?").run(DB_KEY); } catch { /* 同上 */ }
}

export async function readSyncInterruptedAt(db: MobileDb | null): Promise<string | null> {
  if (!db) return null;
  try {
    const row = await db.prepare("SELECT value FROM device_state WHERE key=?").get(DB_KEY) as { value?: string } | undefined;
    return row?.value ?? null;
  } catch { return null; }
}

export async function hasInterruptedSync(db: MobileDb | null): Promise<boolean> {
  return (await readSyncInterruptedAt(db)) !== null;
}
