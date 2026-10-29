import type { SyncSettings } from "./sharedTypes.js";

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
/**
 * UI 的「是不是云端」判据（顶栏图标 / 状态灯 / 状态文案）：**没配置 或 关了开关，都算本地**。
 * 用户 261006：「这个图标就是开关云同步控制的，只要关了就展示这个磁盘，开了且 S3 通过了才是云」
 * ——「S3 通过」由开启流程保证（只有连通测试通过才允许 enabled=true），所以这里只看这两项。
 */
export function isCloudActive(configured: boolean, enabled: boolean): boolean {
  return configured && enabled;
}

export function cloudStateHint(state: CloudState): string | null {
  if (state === "unconfigured") return "未配置云同步：按纯本地空间处理，没有去云端补拉。";
  if (state === "offline") return "云同步已关闭：按纯本地空间处理，没有去云端补拉；重新开启后下次同步会自动补拉。";
  return null;
}

/**
 * 「启用云同步」行上的**隐私数据提示**（桌面 SettingsPanel 与移动 SettingsDrawer 共用同一份文案，
 * 用户 261009 定稿）：**固定展示**，不随开关状态 / 是否已通过连通测试而变化——"云端不加密"这件事
 * 必须在**开启之前**就一直在眼前，所以不做条件渲染、也不放进需要悬停才出现的隐藏提示。
 * 这里只存文案（core 无 UI 依赖）；渲染用既有原语：徽标 .ln-tag--pending + 行内提示 .config-note。
 */
export const CLOUD_PRIVACY_NOTICE = {
  badge: "隐私数据（云端不加密）",
  text: "开启后笔记正文与附件会上传到你的 S3（按原样存储、不做加密）；请先确认该桶为私有、未开放公开读，且凭据只有你持有。",
} as const;
