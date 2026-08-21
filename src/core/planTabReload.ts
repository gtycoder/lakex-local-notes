/**
 * 同步后 tab 重载决策纯函数（lake-core，V5 Phase 4）。
 * digest（轻量摘要）→ reload / deleted / skip，收敛 App.tsx 同步刷新循环的判定。
 * 说明：content-equal 需读全文后才能判定（第二阶段），不在本函数覆盖。
 */

export type TabReloadPlan =
  | { action: "deleted" }
  | { action: "skip"; reason: "dirty-pending" | "unchanged" }
  | { action: "reload"; superseded: boolean };

export interface PlanTabReloadInput {
  /** 远端轻量摘要；null 或 deleted=true = 远端已删除（软删/墓碑/purge） */
  digest: { updatedAt: string; title: string; deleted: boolean } | null;
  /** 本地上次同步后记录的摘要（tab.lastDigest） */
  lastDigest: { updatedAt: string; title: string } | null;
  /** tab 是否有未保存编辑 */
  tabDirty: boolean;
  /** 本笔记是否被远端覆盖（superseded：已强制留档历史） */
  superseded: boolean;
}

export function planTabReload(input: PlanTabReloadInput): TabReloadPlan {
  // 远端已删除：标记 tab 提示用户（保留正文供复制/从回收站恢复）
  if (!input.digest || input.digest.deleted) return { action: "deleted" };
  // 本地有未保存编辑且非被覆盖：不打断用户输入（待保存后再对账）
  if (!input.superseded && input.tabDirty) return { action: "skip", reason: "dirty-pending" };
  // 正文/元数据未变化（title+updatedAt 均同）：无需重载
  const last = input.lastDigest;
  if (!input.superseded && last && last.updatedAt === input.digest.updatedAt && last.title === input.digest.title) {
    return { action: "skip", reason: "unchanged" };
  }
  return { action: "reload", superseded: input.superseded };
}
