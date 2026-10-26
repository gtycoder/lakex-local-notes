/**
 * 移动端「同步未完成」标记（261026 用户点单：退出再进来要能无感续上）。
 *
 * 生命周期：syncNow 开始即写、**成功结束才删**；网络失败 / 进后台被系统杀掉 / 用户手动退出都保留。
 * 下次冷启动或回到前台，useAutoSync 看到标记就**无条件**补一次同步（不受 autoMode=manual 限制）。
 * 存储用 localStorage（同步状态标记本来就是本地壳状态，不进数据库、不参与同步）。
 */
const KEY = "local-lakex-notes-mobile.syncInterruptedAt";

export function markSyncInterrupted(at: string = new Date().toISOString()): void {
  try { globalThis.localStorage?.setItem(KEY, at); } catch { /* 隐私模式/无存储：退化为“不续传” */ }
}

export function clearSyncInterrupted(): void {
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* 同上 */ }
}

export function readSyncInterruptedAt(): string | null {
  try { return globalThis.localStorage?.getItem(KEY) ?? null; } catch { return null; }
}

export function hasInterruptedSync(): boolean {
  return readSyncInterruptedAt() !== null;
}
