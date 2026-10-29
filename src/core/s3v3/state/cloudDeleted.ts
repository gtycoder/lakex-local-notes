/**
 * 「云端已删除 · 仅本地」标记（`remotePurged` / DB `cloud_deleted`）的**唯一失效判据**（E3-1 phase2b 残项，261029）。
 *
 * 标记语义（docs/SYNC-STATE-CONVERGENCE.md §1.3）：一条标记 = 「远端已彻底删除、本地仍保留副本」。
 * 它只在**三种**情形下失效，其余任何情况都必须保留（丢了 ⇒ 副本被当本地新建重新上传 = 复活已删文档）：
 * 1. `restorePending` —— 用户显式恢复（唯一提前例外），副本让位给正常上传；
 * 2. `remotelyPresent` —— 远端同 id 又出现（只有引擎拿得到远端索引），副本跟随远端；
 * 3. `locallyPurged` —— 本地已彻底删除（purged 墓碑 / 小记 quickPurge），没有对象可指、标记空转。
 *
 * **为什么要单独一个文件**：phase2a 之后这条判据在引擎（`finalizeRemotePurged`）与适配器投影
 * （`createDeviceStoreMeta.loadState`，移动端 DB `cloud_deleted` 兜底）各写一遍，注释里直接写着
 * 「与引擎 resolveRemotePurged 同口径」——典型的双份判定：引擎加了第 4 种失效原因而适配器没跟上，
 * 就是「恢复/删除后徽标永久挂死 + 每轮空转」。两端/两层都调本函数，判据只剩一处。
 *
 * 边界：只做**过滤**，不做去重/排序（顺序与重复保持调用方现状）；空输入返回空数组。
 */
export interface CloudDeletedSettleContext {
  /** 显式恢复标记（Lake 文档与小记 id 同表）。 */
  restorePending?: Iterable<string> | undefined;
  /** 远端索引里仍存在的 id（引擎侧；适配器拿不到远端视图时不给）。 */
  remotelyPresent?: Iterable<string> | undefined;
  /** 本地已彻底删除的 id（purged 墓碑 / quickPurge）。 */
  locallyPurged?: Iterable<string> | undefined;
}

/** 返回**仍然有效**的标记（按输入顺序；三种失效情形之外的 id 一律保留）。 */
export function settleCloudDeleted(purged: readonly string[] | undefined, ctx: CloudDeletedSettleContext): string[] {
  const ids = purged ?? [];
  if (ids.length === 0) return [];
  const restore = ctx.restorePending ? new Set(ctx.restorePending) : null;
  const present = ctx.remotelyPresent ? new Set(ctx.remotelyPresent) : null;
  const localPurged = ctx.locallyPurged ? new Set(ctx.locallyPurged) : null;
  if (!restore && !present && !localPurged) return [...ids];
  return ids.filter((id) => !(restore?.has(id) || present?.has(id) || localPurged?.has(id)));
}
