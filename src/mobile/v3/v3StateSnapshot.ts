/**
 * 单条小记快路径的「一次读、多处派生」纯转换（261112 task-83）。
 *
 * 背景：移动端 `sync_v3_state` 一行的 JSON 同时承载账本信封 + baseline。旧实现里
 * `loadBaseline()` / `loadQuickPushState(id)` / `assetsHashOf()` **各自** 执行一次
 * `SELECT json FROM sync_v3_state` 并把整行 JSON 过桥（大库实测单次 ~130ms，一次「保存并同步」
 * 要读 3 次）；这里把「已读出的 raw」转成同样的 baseline / 资产 hash 投影，用于合并读路径，
 * **不碰 DB、不改任何判据**。
 *
 * 语义必须与 `src/mobile/data/v3StateRepository.ts` 的 `loadV3State()` 对齐（护栏
 * `quickPushSnapshot.test.ts` 用真实落盘形状对比逐次读取）。
 */
import { migratePersisted } from "../../core/s3v3/state/intentLogState.js";
import type { DeviceBaseline } from "../../core/s3v3DeviceStore.js";

export interface PersistedStateProjection {
  /** 与 `loadBaseline()` 同口径：无效/缺行 = null；有效但无 baseline 字段 = null。 */
  baseline: DeviceBaseline | null;
  /** 与 `loadV3State().assetsHash` 同口径：信封 assets 的 lake+quickNotes 合并。 */
  assetsHash: Record<string, string>;
}

/**
 * raw → 投影（`loadV3State` 的纯部分）。
 * 返回 null 表示「与 loadV3State 的 EMPTY 分支等价」（无行 / 无法识别的落盘），
 * 调用方按 baseline=null、assetsHash={} 处理。
 */
export function persistedStateProjection(raw: unknown): PersistedStateProjection | null {
  const persisted = migratePersisted(raw);
  if (!persisted) return null;
  // loadV3State 只认「顶层有 baseline 键」的对象（数组/标量落盘视为异常 ⇒ 无 baseline）。
  const baseline = typeof raw === "object" && raw !== null && "baseline" in raw
    ? ((raw as { baseline?: DeviceBaseline | null }).baseline ?? null)
    : null;
  return {
    baseline,
    assetsHash: { ...persisted.assets.lake, ...persisted.assets.quickNotes },
  };
}
