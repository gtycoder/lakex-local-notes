import type { SyncSettings } from "../lib/types.js";

/**
 * 云同步的**状态判据（单一来源）**。
 *
 * 用户 261006 定稿的语义：
 *   · **没配置 S3 凭据** ⇒ `unconfigured`（离线本地空间）；
 *   · **配了但关掉「启用云同步」** ⇒ `offline`（**等同没配置**：任何路径都不出网，
 *     包括回收站恢复/预览的按需补拉、云 GC、诊断）；
 *   · 开着但自动同步 = manual ⇒ `manual`（允许**按需**出网：手动同步、恢复时补拉缺失资源）；
 *   · 开着且按间隔/开合自动同步 ⇒ `auto`。
 *
 * ⚠️ 任何"要不要联网"的判断都必须走 `canTouchNetwork(cloudStateOf(...))`，
 * 不要各自去读 `enabled`/`autoMode`（历史上正因为各处各判，出现过"关了同步但恢复仍偷偷出网"的语义漂移）。
 */
export type CloudState = "unconfigured" | "offline" | "manual" | "auto";

export function cloudStateOf(configured: boolean, sync: Pick<SyncSettings, "enabled" | "autoMode"> | null | undefined): CloudState {
  if (!configured) return "unconfigured";
  if (!sync || !sync.enabled) return "offline";
  return sync.autoMode === "manual" ? "manual" : "auto";
}

/** 唯一判据：这个状态下允许访问网络吗？（unconfigured / offline 一律不允许） */
export function canTouchNetwork(state: CloudState): boolean {
  return state === "manual" || state === "auto";
}

/** 给 UI 用的一句话说明（离线类状态为什么没去补拉）。 */
export function cloudStateHint(state: CloudState): string | null {
  if (state === "unconfigured") return "未配置云同步：按纯本地空间处理，没有去云端补拉。";
  if (state === "offline") return "云同步已关闭：按纯本地空间处理，没有去云端补拉；重新开启后下次同步会自动补拉。";
  return null;
}
