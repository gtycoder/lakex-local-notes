/**
 * 单条小记快路径的「一次读、多处派生」纯转换（261112 task-83；261113 D1-C 调整基线来源）。
 *
 * 背景：移动端 `sync_v3_state` 一行承载「账本信封」；baseline 自 261113（D1-C）起落独立文件
 * （`sync-v3/baseline.json.gz.b64`，见 data/v3BaselineFile.ts）。旧实现里 `loadBaseline()` /
 * `loadQuickPushState(id)` / `assetsHashOf()` **各自** 执行一次 `SELECT json FROM sync_v3_state`
 * 并把整行 JSON 过桥（大库实测单次 ~130ms）；这里把「已读出的 raw + 已读出的 baseline」转成同样的
 * 资产 hash 投影，用于合并读路径，**不碰 DB、不改任何判据**。
 *
 * 语义必须与 `src/mobile/data/v3StateRepository.ts` 的 `loadV3State()` 对齐（护栏
 * `quickPushSnapshot.test.ts` 用真实落盘形状对比逐次读取）。
 */
import { migratePersisted } from "../../core/s3v3/state/intentLogState.js";
import type { DeviceBaseline } from "../../core/s3v3DeviceStore.js";

export interface PersistedStateProjection {
  /** 与 `loadBaseline()` 同口径：由调用方传入文件读到的值（缺省回退旧行内嵌字段）。 */
  baseline: DeviceBaseline | null;
  /** 与 `loadV3State().assetsHash` 同口径：信封 assets 的 lake+quickNotes 合并。 */
  assetsHash: Record<string, string>;
}

/**
 * raw → 投影（`loadV3State` 的纯部分）。
 * @param baselineOverride 已从 baseline 文件读到的值（undefined = 未提供，回退旧行内嵌字段）。
 * 返回 null 表示「与 loadV3State 的 EMPTY 分支等价」（无行 / 无法识别的落盘），
 * 调用方按 baseline=null、assetsHash={} 处理。
 */
export function persistedStateProjection(raw: unknown, baselineOverride?: DeviceBaseline | null): PersistedStateProjection | null {
  const persisted = migratePersisted(raw);
  if (!persisted) return null;
  const inline = typeof raw === "object" && raw !== null && "baseline" in raw
    ? ((raw as { baseline?: DeviceBaseline | null }).baseline ?? null)
    : null;
  return {
    baseline: baselineOverride === undefined ? inline : baselineOverride,
    assetsHash: { ...persisted.assets.lake, ...persisted.assets.quickNotes },
  };
}
