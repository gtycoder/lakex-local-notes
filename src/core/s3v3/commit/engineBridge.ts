/**
 * 引擎 ↔ v4 四相的**纯映射层**（E2-3 切换的最后一层胶水）。
 *
 * 为什么要单独成文件：`DeviceState` 与 `PlanWorld/PlanState/IntentLogState` 是两套表示，
 * 映射写错会直接变成数据安全 bug（例如把 quickDeletes 漏传 ⇒ 已删小记被当远端新增复活）。
 * 纯函数 ⇒ 可以逐字段测，切换时只做「取 → 跑 → 写回」三步。
 *
 * 本层**不接管**：remotePurged/quickPurges 的投影、回收站/`cloud_deleted` 展示、pendingAssets 重试、
 * 基线写入（这些仍归引擎；切换分两步走，先切「决策+IO」，再收编标记类字段）。
 */
import type { DeviceState } from "../../s3v3DeviceStore.js";
import { TRASH_NOTEBOOK_ID } from "../../syncDecisions.js";
import type { PlanState, PlanWorld } from "../plan/plan.js";
import { settleCloudDeleted } from "../state/cloudDeleted.js";
import type { IntentLogState } from "./intentLog.js";
import type { RoundResult } from "./runSyncRound.js";

/** 三世界里的本地世界（= 设备当前索引；folders 与 state.folders 同源）。 */
export function planWorldOf(state: DeviceState): PlanWorld {
  // remotePurged 的副本「仅本地」：不参与合并/上传/发布（显式恢复的除外）。
  const restore = new Set(state.restorePending ?? []);
  const purged = new Set((state.remotePurged ?? []).filter((id) => !restore.has(id)));
  if (purged.size === 0) return { lake: state.lake, quickNotes: state.quickNotes, folders: state.folders };
  return {
    lake: { ...state.lake, notes: state.lake.notes.filter((n) => !purged.has(n.id)) },
    quickNotes: { ...state.quickNotes, items: state.quickNotes.items.filter((q) => !purged.has(q.id)) },
    folders: state.folders,
  };
}

/** 计划输入里的本地标记：删除意图 / 显式恢复 / 小记软删与墓碑。 */
export function planStateOf(state: DeviceState): PlanState {
  return {
    restorePending: state.restorePending ?? [],
    purgeIntents: state.intents.map((i) => i.noteId),
    folderPurgeIntents: [],
    quickDeletes: state.quickDeletes ?? [],
    purgedQuickIds: state.quickPurges ?? [],
  };
}

export function intentLogOf(state: DeviceState): IntentLogState {
  return { intents: state.intents, restorePending: state.restorePending ?? [] };
}

/**
 * 一轮结束后回写 state：
 *  - 发布了新索引 ⇒ lake/quickNotes/folders 用发布的那份（含失败回退、assetsHash 覆盖）；
 *  - 未发布（skipped/unchanged/retry）⇒ 索引保持原样（绝不因为「本轮没发布」而清空本地索引）；
 *  - 待删队列用剩余项（retry 时剩余为空 ⇒ 队列保持不动，见 RoundResult 约定）；
 *  - 意图 / 恢复标记用结算后的结果；其余字段原样保留（remotePurged、quickPurges、pendingAssets 等仍归引擎）。
 */
/** 「云端已删除·仅本地」标记结算：显式恢复 / 远端重新出现同 id ⇒ 标记失效（副本跟随/复活）。
 *  判据单点在 state/cloudDeleted.ts 的 settleCloudDeleted —— 适配器 loadState 的 DB 投影兜底调同一函数，
 *  两层不再各写一份「同口径」（E3-1 phase2b 残项收口）。 */
export function finalizeRemotePurged(state: DeviceState, ctx: { remoteIds: Iterable<string>; restorePending?: Iterable<string> }): DeviceState {
  const previous = state.remotePurged ?? [];
  const purged = settleCloudDeleted(previous, {
    restorePending: ctx.restorePending ?? state.restorePending ?? [],
    remotelyPresent: ctx.remoteIds,
  });
  const same = purged.length === previous.length && purged.every((id, i) => id === previous[i]);
  return same ? state : { ...state, remotePurged: purged };
}

/** 把远端已 purge 的本地副本移入回收站并打标记（仅本地、不参与同步；正文/附件/历史都保留）。 */
function applyCloudDeleted(state: DeviceState, ids: Set<string>): DeviceState {
  if (ids.size === 0) return state;
  const now = new Date().toISOString();
  const lake = state.lake.notes.map((n) => ids.has(n.id)
    ? { ...n, trashedAt: n.trashedAt ?? now, deletedFromParentId: n.deletedFromParentId ?? n.parentId, parentId: TRASH_NOTEBOOK_ID }
    : n);
  const quick = state.quickNotes.items.map((q) => ids.has(q.id) ? { ...q, isConflict: q.isConflict } : q);
  return { ...state, lake: { ...state.lake, notes: lake }, quickNotes: { ...state.quickNotes, items: quick }, remotePurged: [...new Set([...(state.remotePurged ?? []), ...ids])].sort() };
}

/** 不可恢复删除（quick purges 墓碑）：条目不得留在本地状态（与旧路径一致，不留回收站副本）。 */
function dropPurgedQuick(state: DeviceState): DeviceState {
  const purged = new Set(state.quickPurges ?? []);
  if (purged.size === 0 || !state.quickNotes.items.some((q) => purged.has(q.id))) return state;
  return { ...state, quickNotes: { ...state.quickNotes, items: state.quickNotes.items.filter((q) => !purged.has(q.id)) } };
}

/** 把合并后的标签目录并进设备状态（远端优先；本地独有的标签保留）。 */
function mergeQuickTagsIntoState(state: DeviceState, tags: DeviceState["quickNotes"]["tags"] | undefined): DeviceState {
  if (!tags || tags.length === 0) return state;
  const byId = new Map<string, NonNullable<DeviceState["quickNotes"]["tags"]>[number]>();
  for (const t of state.quickNotes.tags ?? []) byId.set(t.id, t);
  let changed = false;
  for (const t of tags) { if (!byId.has(t.id)) { byId.set(t.id, t); changed = true; } }
  return changed ? { ...state, quickNotes: { ...state.quickNotes, tags: [...byId.values()] } } : state;
}

export function mergeRoundIntoState(state: DeviceState, round: RoundResult, opts: { bodyFailed?: ReadonlySet<string> } = {}): DeviceState {
  // 生命周期写（cloud-deleted）：远端已 purge 的本地副本进回收站 + 打「云端已删除·仅本地」标，
  // 绝不发布（发布 = 复活）。这条与是否发布无关，先行结算。
  const lifecycle = round.plan.writes.filter((w): w is Extract<typeof w, { kind: "set-lifecycle" }> => w.kind === "set-lifecycle");
  const cloudDeleted = new Set(lifecycle.filter((w) => w.lifecycle === "cloud-deleted").map((w) => w.id));
  const quickPurged = new Set(round.plan.writes.filter((w) => w.kind === "quick-purge").map((w) => w.id));
  const quickDeleted = new Set(round.plan.writes.filter((w) => w.kind === "quick-soft-delete").map((w) => w.id));
  const sd0 = mergeQuickTagsIntoState(dropPurgedQuick(applyCloudDeleted(state, cloudDeleted)), round.plan.quickTags);
  let sd = sd0;
  if (quickDeleted.size > 0) {
    sd = {
      ...sd,
      quickNotes: { ...sd.quickNotes, items: sd.quickNotes.items.filter((q) => !quickDeleted.has(q.id)) },
      quickDeletes: [...new Set([...(sd.quickDeletes ?? []), ...quickDeleted])],
    };
  }
  if (quickPurged.size > 0) {
    sd = {
      ...sd,
      quickNotes: { ...sd.quickNotes, items: sd.quickNotes.items.filter((q) => !quickPurged.has(q.id)) },
      quickDeletes: (sd.quickDeletes ?? []).filter((id) => !quickPurged.has(id)),
      quickPurges: [...new Set([...(sd.quickPurges ?? []), ...quickPurged])],
      quickPurgeTimes: { ...(sd.quickPurgeTimes ?? {}), ...Object.fromEntries([...quickPurged].map((id) => [id, new Date().toISOString()])) },
    };
  }
  // 目录写：远端元数据/回收站状态要落到本地（目录没有正文，只有行）。
  const folderWrites = round.plan.writes.filter((w): w is Extract<typeof w, { kind: "apply-remote-folder" | "remove-folder" }> => w.kind === "apply-remote-folder" || w.kind === "remove-folder");
  const applyFolders = (folders: DeviceState["folders"]): DeviceState["folders"] => {
    if (folderWrites.length === 0) return folders;
    const byId = new Map(folders.map((f) => [f.id, f] as const));
    for (const w of folderWrites) {
      if (w.kind === "remove-folder") { byId.delete(w.id); continue; }
      const meta = w.meta;
      const prev = byId.get(w.id);
      byId.set(w.id, {
        id: w.id,
        title: meta.title ?? prev?.title ?? w.id,
        parentId: meta.parentId === undefined ? (prev?.parentId ?? null) : meta.parentId,
        sortOrder: meta.sortOrder ?? prev?.sortOrder ?? 0,
        nodeType: (meta.kind === "group" ? "group" : prev?.nodeType ?? "notebook") as DeviceState["folders"][number]["nodeType"],
        icon: meta.icon === undefined ? (prev?.icon ?? null) : meta.icon,
        updatedAt: meta.updatedAt ?? prev?.updatedAt ?? new Date(0).toISOString(),
        ...(meta.trashedAt !== undefined ? { trashedAt: meta.trashedAt } : {}),
        ...(meta.deletedFromParentId !== undefined ? { deletedFromParentId: meta.deletedFromParentId } : {}),
      });
    }
    return [...byId.values()];
  };
  const published = round.commit.status === "published" && round.publish !== null;
  if (published) {
    return {
      ...sd,
      lake: round.publish!.lake,
      quickNotes: round.publish!.quickNotes,
      folders: round.publish!.lake.folders,
      pending: round.commit.status === "retry" ? state.pending : round.remainingPending,
      intents: round.intents.intents,
      restorePending: round.intents.restorePending,
    };
  }
  // 未发布（纯拉取/零变更）：先把 apply-remote 写回本地索引（漏掉 = 正文落盘但标题/锁/图标不变）。
  // **快路径**：本轮没有任何 apply-remote ⇒ 索引原样复用（不回 O(n) 复制、也不排序）。
  if (!round.plan.writes.some((w) => w.kind === "apply-remote") && folderWrites.length === 0) {
    return { ...sd, pending: round.commit.status === "retry" ? state.pending : round.remainingPending, intents: round.intents.intents, restorePending: round.intents.restorePending };
  }
  const lakeById = new Map(sd.lake.notes.map((n) => [n.id, n] as const));
  const quickById = new Map(sd.quickNotes.items.map((q) => [q.id, q] as const));
  for (const w of round.plan.writes) {
    if (w.kind !== "apply-remote") continue;
    // 正文没真正落盘的条目不得把索引写成远端 hash（否则下一轮不再重试 = 永久缺正文）。
    if (opts.bodyFailed?.has(w.space + ":" + w.id)) continue;
    if (w.space === "lake") {
      const prev = lakeById.get(w.id);
      const meta = w.meta;
      // apply-remote = 远端条目就是真值：**重建**条目而不是叠加旧字段
      // （叠加会残留 trashedAt/deletedFromParentId ⇒ 远端恢复后本地仍显示在回收站）。
      lakeById.set(w.id, {
        id: w.id,
        title: meta.title ?? prev?.title ?? w.id,
        parentId: meta.parentId === undefined ? (prev?.parentId ?? null) : meta.parentId,
        sortOrder: meta.sortOrder ?? prev?.sortOrder ?? 0,
        updatedAt: meta.updatedAt ?? prev?.updatedAt ?? new Date(0).toISOString(),
        contentHash: w.bodyHash ?? prev?.contentHash ?? "",
        ...(meta.kind !== undefined ? { kind: meta.kind } : {}),
        ...(meta.icon !== undefined ? { icon: meta.icon } : {}),
        ...(meta.isLocked !== undefined ? { isLocked: meta.isLocked } : {}),
        ...(meta.lockedAt !== undefined ? { lockedAt: meta.lockedAt } : {}),
        ...(meta.isConflict !== undefined ? { isConflict: meta.isConflict } : {}),
        ...(meta.trashedAt !== undefined ? { trashedAt: meta.trashedAt } : {}),
        ...(meta.deletedFromParentId !== undefined ? { deletedFromParentId: meta.deletedFromParentId } : {}),
        ...(meta.assetsHash !== undefined ? { assetsHash: meta.assetsHash } : {}),
      });
    } else {
      const prev = quickById.get(w.id);
      const meta = w.meta;
      quickById.set(w.id, {
        ...prev,
        id: w.id,
        createdAt: prev?.createdAt ?? new Date(0).toISOString(),
        updatedAt: prev?.updatedAt ?? new Date(0).toISOString(),
        contentHash: w.bodyHash ?? prev?.contentHash ?? "",
        // 标签关系与冲突标记随远端条目一起写回（漏掉 = 跨端标签丢失/冲突角标丢失）。
        ...(meta.tagIds !== undefined ? { tagIds: meta.tagIds } : {}),
        ...(meta.tagsUpdatedAt !== undefined ? { tagsUpdatedAt: meta.tagsUpdatedAt } : {}),
        ...(meta.isConflict !== undefined ? { isConflict: meta.isConflict } : {}),
        ...(meta.assetsHash !== undefined ? { assetsHash: meta.assetsHash } : {}),
      });
    }
  }
  return {
    ...sd,
    folders: applyFolders(sd.folders),
    lake: { ...sd.lake, notes: [...lakeById.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), folders: applyFolders(sd.lake.folders) },
    quickNotes: { ...sd.quickNotes, items: [...quickById.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) },
    pending: round.commit.status === "retry" ? state.pending : round.remainingPending,
    intents: round.intents.intents,
    restorePending: round.intents.restorePending,
  };
}
