/**
 * 移动端回收站自动过期清理（与桌面同口径，261105）。
 *
 * ## 桌面怎么做的（对齐目标）
 * electron/main.ts:757-773：启动即查一次 + `setInterval` 每 24h 一次，读
 * `settings.trashAutoPurgeDays`（默认 90，<=0 = 关闭），纯本地操作、失败只 warn。
 * 语义实现 electron/trashLifecycle.ts:119-128 的 `autoPurgeExpiredTrash`：
 * 只遍历**回收站顶级条目**（子项随根一起 purge，不重复处理），`trashed_at < now - N 天` 即到期。
 *
 * ## 移动端为什么不是 setInterval
 * WebView 没有可靠的常驻定时器：切后台进程随时被系统冻结/杀掉，`setInterval` 在后台不跑，
 * 回前台也不会"补跑"累积的那几次。因此复用**既有的两个时机钩子**（useAutoSync 的
 * 「就绪」与「回前台」）各跑一次 —— 与历史快照定期清理（historyCleanupScheduler）同一套思路，
 * 不新增常驻定时器，也不因此出网（纯本地 DB/文件操作）。
 *
 * ## 阈值从哪来
 * 移动端设置页**没有**「回收站自动过期天数」这一项（只有历史快照/资源/同步/关于），
 * 也没有可复用的云端 GC 设置桥方法（`getS3GcSettings` 只存在于桌面）。因此取**与桌面默认值
 * 相同的 90 天**（electron/settingsRepository.ts:119 的 `trashAutoPurgeDays: 90`），
 * 判据语义与 core/trashPolicy（`<=0` = 关闭、按 `deletedAt + days` 判到期）一致。
 * 不新增设置项的理由：桌面已有该项，移动端再搬一套 UI + 存储属过度设计（AGENTS §3#17）；
 * 真需要用户可改时，把值落 device_state 后传给本模块的 `days` 即可，调度逻辑不用改。
 * ⚠️ 若之后 core/trashPolicy 导出「默认天数」常量，这里应改成引用它（单一来源），
 *    不要再让 90 这个数字在两端各写一遍。
 *
 * ## 边界与安全
 * - **阈值 <=0 = 关闭**：不读回收站、不做任何删除（与桌面一致）。
 * - **只清文档/文件夹**（tree nodes）：桌面 `autoPurgeExpiredTrash` 也只清 tree_nodes，
 *   小记回收站（quick_notes.deleted_at）不在此列 —— 两端保持同一口径。
 * - **cloud_deleted 副本不豁免**：AGENTS §3#5「云端已删除·仅本地」到点照样 purge。
 * - **不越过用户恢复**：候选列表是事务外读的，真正删除时由 repository 在事务内按最新
 *   `trashed_at` 重判（`PurgeTreeItemOptions.expiredBefore`）⇒ 用户在列表与删除之间点「恢复」，
 *   这次 purge 会静默跳过（返回 false）。
 * - **分批 + 让出主线程**：每批 `TRASH_PURGE_BATCH_SIZE` 条、批间 `setTimeout(0)`，
 *   避免一次清几百条把 WebView 主线程钉住（UI 卡顿）。
 * - **幂等**：删完的行不会再出现在下一次候选里；重复调用（就绪 + 回前台）不会重复删。
 * - **并发重入**：模块内单飞标记，上一轮没跑完时再来一次直接跳过（返回 skipped）。
 * - **失败静默 + 日志**：单条失败不中断其余，计数交回调用方写日志；读取/整轮失败由调用方 catch。
 */
import type { MobileTrashTreeItem } from "../data/trashRepository.js";

const DAY_MS = 24 * 3600 * 1000;

/** 回收站自动过期天数：移动端无设置项，取与桌面默认值一致的 90 天（理由见文件头）。 */
import { TRASH_AUTO_PURGE_DAYS } from "../../core/settingsDefaults";
export { TRASH_AUTO_PURGE_DAYS };

/** 每批处理的条数：一批 ≈ 一次事件循环让出，避免长任务卡住 UI。 */
export const TRASH_PURGE_BATCH_SIZE = 20;

/** 候选行（= bridge.listTrashTree 的返回行；只取判据需要的字段）。 */
export interface TrashRootCandidate {
  id: string;
  kind: "folder" | "note";
  parentId: string | null;
  deletedAt: string | null;
}

/** 回收站「顶级」条目：父不在回收站（父为空/父是活跃节点 ⇒ 顶级）。子项随根 purge，不单独处理。 */
export function trashRootsOf<T extends TrashRootCandidate>(items: readonly T[]): T[] {
  const trashedIds = new Set(items.map((item) => item.id));
  return items.filter((item) => !item.parentId || !trashedIds.has(item.parentId));
}

/**
 * 选出**已到期**的顶级条目，并给出本次统一的截止时刻（交给 repository 做事务内兜底复核）。
 * - `days <= 0`（或非法）⇒ 空数组 = 关闭，不清任何东西；
 * - `deletedAt` 缺失/非法 ⇒ 无法判断期限，**宁可留着**（不删）；
 * - 边界与桌面一致：严格 `trashed_at < cutoff` 才算到期（正好 N 天仍保留）。
 */
export function selectExpiredTrashRoots<T extends TrashRootCandidate>(
  items: readonly T[],
  options: { now: number; days?: number },
): Array<{ root: T; expiredBefore: string }> {
  const days = options.days ?? TRASH_AUTO_PURGE_DAYS;
  if (!Number.isFinite(days) || days <= 0) return [];
  const cutoffMs = options.now - days * DAY_MS;
  const expiredBefore = new Date(cutoffMs).toISOString();
  const expired: Array<{ root: T; expiredBefore: string }> = [];
  for (const root of trashRootsOf(items)) {
    const deletedAt = root.deletedAt ? Date.parse(root.deletedAt) : Number.NaN;
    if (!Number.isFinite(deletedAt) || deletedAt >= cutoffMs) continue;
    expired.push({ root, expiredBefore });
  }
  return expired;
}

/** 默认让出：给渲染/输入事件一个执行机会（不用 requestIdleCallback —— 它可能长时间不回调）。 */
function yieldToUi(): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

export interface ScheduledTrashPurgeDeps<T extends TrashRootCandidate = MobileTrashTreeItem> {
  /** 读回收站全量（bridge.listTrashTree）。 */
  listTrash: () => Promise<readonly T[]>;
  /** 带过期守卫的彻底删除；返回是否真的删了（false = 已恢复/未到期，跳过）。 */
  purge: (root: T, expiredBefore: string) => Promise<boolean>;
  /** 阈值（默认 TRASH_AUTO_PURGE_DAYS；<=0 = 关闭）。 */
  days?: number;
  /** 测试注入时钟。 */
  now?: () => number;
  /** 每批条数（默认 TRASH_PURGE_BATCH_SIZE）。 */
  batchSize?: number;
  /** 批间让出（测试注入空实现，免得依赖真实定时器）。 */
  yieldToUi?: () => Promise<void>;
}

export interface ScheduledTrashPurgeResult {
  /** 真的删掉的条数（不含被守卫跳过的）。 */
  purged: number;
  /** 单条失败数（失败不中断其余，下次时机再试）。 */
  failed: number;
  /** 上一轮还没跑完 ⇒ 本轮整体跳过。 */
  skipped: boolean;
}

/** 单飞标记：就绪与回前台可能同时触发，别叠两轮（列表/删除都会重复做）。 */
let purging = false;

/** 就绪/回前台调用一次：到期项分批彻底删除。失败不抛给 UI（调用方只写日志）。 */
export async function runScheduledTrashPurge<T extends TrashRootCandidate>(
  deps: ScheduledTrashPurgeDeps<T>,
): Promise<ScheduledTrashPurgeResult> {
  if (purging) return { purged: 0, failed: 0, skipped: true };
  purging = true;
  try {
    const days = deps.days ?? TRASH_AUTO_PURGE_DAYS;
    // 关闭时连回收站都不读（一次桥往返都不花）。
    if (!Number.isFinite(days) || days <= 0) return { purged: 0, failed: 0, skipped: false };
    const now = deps.now ? deps.now() : Date.now();
    const expired = selectExpiredTrashRoots(await deps.listTrash(), { now, days });
    if (expired.length === 0) return { purged: 0, failed: 0, skipped: false };

    const batchSize = Math.max(1, deps.batchSize ?? TRASH_PURGE_BATCH_SIZE);
    const yieldBetweenBatches = deps.yieldToUi ?? yieldToUi;
    let purged = 0;
    let failed = 0;
    for (let offset = 0; offset < expired.length; offset += batchSize) {
      const batch = expired.slice(offset, offset + batchSize);
      for (const { root, expiredBefore } of batch) {
        try {
          if (await deps.purge(root, expiredBefore)) purged += 1;
        } catch {
          // 单条失败（行被并发改掉/文件删不掉等）：不中断整轮，下次时机再来。
          failed += 1;
        }
      }
      // 批间让出主线程；最后一批不需要。
      if (offset + batchSize < expired.length) await yieldBetweenBatches();
    }
    return { purged, failed, skipped: false };
  } finally {
    purging = false;
  }
}
