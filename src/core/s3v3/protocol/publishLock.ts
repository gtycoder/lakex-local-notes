/**
 * 发布锁协议常量（单条小记快路径与整轮同步共用；**只有一份值**）。
 *
 * 261110：从 s3v3Engine 私有时把值上收到协议层，供独立单条推送管线复用，
 * 避免"两个模块各写一份 LOCK_KEY/TTL 然后漂移"。协议语义见 docs/SYNC-PROTOCOL.md §12.1。
 */
export const LOCK_KEY = "meta/lock.json";
export const LOCK_TTL_MS = 120_000;
/** 锁重试：无 CAS 的 provider 下，靠「写后静置再读回」降低双持窗口。 */
export const LOCK_DEADLINE_MS = 15_000;
export const LOCK_SETTLE_MS = 40;
