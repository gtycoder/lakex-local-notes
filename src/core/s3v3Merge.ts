import { decideItem } from "./s3v3Decision.js";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry, QuickNoteEntry, QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import type { PlanWarning } from "./s3v3/plan/types.js";

/** 三方合并计划（纯逻辑）：输入基线×本地×远端，输出每条的下载/上传/删除/归档意图。 */

export interface LakeMergeContext {
  restorePending: ReadonlySet<string>;
  purgeIntents: ReadonlySet<string>;
  folderPurgeIntents: ReadonlySet<string>;
}

/** 环检测（对齐旧协议 syncPerf.isRemoteDescendant）：nodeId 在远端树中是否为 ancestorId 的子孙。
 *  用于「本地把 A 移进 B 的子树、而他端已把 B 移进 A」这类互成父子——即使本地 updatedAt 更新，
 *  也必须跟随远端断开，否则两端索引会长期成环（打开文档/移动目录都会失败）。 */
export function isRemoteDescendant(
  nodeId: string | null,
  ancestorId: string,
  parentMap: Map<string, string | null>,
): boolean {
  let cur: string | null | undefined = nodeId;
  const seen = new Set<string>();
  while (cur !== null && cur !== undefined) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = parentMap.get(cur) ?? null;
  }
  return false;
}

export type LakeNoteActionKind =
  | "upload"
  | "download"
  | "local-purge"
  | "remote-purged-trash"
  | "remote-wins-history"
  | "none";

export interface LakeNotePlan {
  id: string;
  kind: LakeNoteActionKind;
  /** 应用远端条目（元数据；download 类还会下载正文）。 */
  applyRemote: boolean;
  /** 上传本地条目（body 仅在 hash 变化时才真正上传，由运行时决定）。 */
  uploadLocal: boolean;
  /** 远端胜出时把本地版本写历史快照。 */
  archiveLocal: boolean;
  local?: LakeNoteEntry;
  remote?: LakeNoteEntry;
}

export interface LakeFolderPlan {
  id: string;
  kind: "upload" | "download" | "local-purge" | "local-delete" | "remote-purged-trash" | "none";
  applyRemote: boolean;
  uploadLocal: boolean;
  local?: LakeFolderEntry;
  remote?: LakeFolderEntry;
}

export interface LakeMergePlan {
  notes: LakeNotePlan[];
  folders: LakeFolderPlan[];
  /** P1-6：远端父级成环时「拒绝该父关系」的结构化告警（由 planSync 汇总到 SyncPlan.warnings）。 */
  warnings?: PlanWarning[];
}

/**
 * P1-6 父环防护（远端指数可注入父环）：
 * 合并后世界的 id → 父 id（远端优先，其次本地，最后基线）。note 与 folder 同一命名空间
 *（tree_nodes 里文档既是 note 也可能是父节点），因此必须合在一张表里判环。
 */
function mergedParentMapOf(base: LakeIndex | null, local: LakeIndex, remote: LakeIndex): Map<string, string | null> {
  const parentOf = new Map<string, string | null>();
  for (const [id, entry] of byId(base?.notes)) parentOf.set(id, entry.parentId);
  for (const [id, entry] of byId(base?.folders)) parentOf.set(id, entry.parentId);
  for (const [id, entry] of byId(local.notes)) parentOf.set(id, entry.parentId);
  for (const [id, entry] of byId(local.folders)) parentOf.set(id, entry.parentId);
  for (const [id, entry] of byId(remote.notes)) parentOf.set(id, entry.parentId);
  for (const [id, entry] of byId(remote.folders)) parentOf.set(id, entry.parentId);
  return parentOf;
}

/**
 * 祖先链上「含环」的全部 id（visited + 路径复用，O(n) 线性；防御超长链）。
 * 环上节点与「喂养进环的子孙」都会命中——它们的祖先链都无限，读取侧必须拒绝对应父关系。
 */
export function idsWithCyclicAncestors(parentOf: ReadonlyMap<string, string | null>): Set<string> {
  const result = new Map<string, boolean>();
  const limit = parentOf.size + 1;
  for (const start of parentOf.keys()) {
    if (result.has(start)) continue;
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = start;
    let cyclic = false;
    while (cur !== null) {
      if (onPath.has(cur)) { cyclic = true; break; }        // 当前路径成环
      const known = result.get(cur);
      if (known !== undefined) { cyclic = known; break; }   // 复用已算结果
      onPath.add(cur);
      path.push(cur);
      if (path.length > limit) { cyclic = true; break; }    // 防御：不可能但也不许无限
      cur = parentOf.get(cur) ?? null;
    }
    for (const id of path) result.set(id, cyclic);
  }
  const out = new Set<string>();
  for (const [id, cyclic] of result) if (cyclic) out.add(id);
  return out;
}

const byId = <T extends { id: string }>(list: T[] | undefined): Map<string, T> => new Map((list ?? []).map((x) => [x.id, x]));

export function planLakeMerge(base: LakeIndex | null, local: LakeIndex, remote: LakeIndex, ctx: LakeMergeContext): LakeMergePlan {
  const baseNotes = byId(base?.notes);
  const localNotes = byId(local.notes);
  const remoteNotes = byId(remote.notes);
  const baseFolders = byId(base?.folders);
  const localFolders = byId(local.folders);
  const remoteFolderParents = new Map<string, string | null>();
  for (const f of (remote.folders ?? [])) remoteFolderParents.set(f.id, f.parentId);
  // P1-6：远端索引可注入父环。合并后一旦成环，下游「落库 → 树查询/删除/移动」会无限展开
  //（descendantIds / 递归 CTE 即使有 visited 也会把整个环当子树）。这里在决策前先算出
  //「祖先链含环」的 id，并**拒绝该父关系**：有本地/基线父则保持原父，否则落 null（由落库侧兜底，
  // 至少不把环写进本地树）；同时产出结构化 warning，绝不静默。
  const parentOf = mergedParentMapOf(base, local, remote);
  const cyclicIds = idsWithCyclicAncestors(parentOf);
  const cycleWarnings: PlanWarning[] = [];
  const parentFix = new Map<string, string | null>();
  for (const [id] of remoteNotes) {
    if (!cyclicIds.has(id)) continue;
    parentFix.set(id, localNotes.get(id)?.parentId ?? baseNotes.get(id)?.parentId ?? null);
    cycleWarnings.push({ code: "remote_incomplete", space: "lake", id, detail: "cycle-parent: 远端父级形成环，已拒绝该父关系" });
  }
  for (const [id] of byId(remote.folders)) {
    if (!cyclicIds.has(id)) continue;
    parentFix.set(id, localFolders.get(id)?.parentId ?? baseFolders.get(id)?.parentId ?? null);
    cycleWarnings.push({ code: "remote_incomplete", space: "lake", id, detail: "cycle-parent: 远端父级形成环，已拒绝该父关系" });
  }
  const safeRemote = <T extends { id: string; parentId: string | null }>(entry: T | null): T | null => {
    if (!entry || !parentFix.has(entry.id)) return entry;
    return { ...entry, parentId: parentFix.get(entry.id)! };
  };
  const remoteNoteParents = new Map<string, string | null>();
  for (const n of remoteNotes.values()) remoteNoteParents.set(n.id, safeRemote(n)!.parentId);
  const ids = new Set<string>([...localNotes.keys(), ...remoteNotes.keys(), ...baseNotes.keys()]);
  const notes: LakeNotePlan[] = [];
  for (const id of [...ids].sort()) {
    const b = baseNotes.get(id) ?? null;
    const l = localNotes.get(id) ?? null;
    const r = safeRemote(remoteNotes.get(id) ?? null);
    const action = decideItem({
      basePresent: !!b,
      baseHash: b?.contentHash ?? null,
      localPresent: !!l,
      localHash: l?.contentHash ?? null,
      remotePresent: !!r,
      remoteHash: r?.contentHash ?? null,
      restorePending: ctx.restorePending.has(id),
      localPurgeIntent: ctx.purgeIntents.has(id),
    });
    switch (action) {
      case "upload":
        notes.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, archiveLocal: false, local: l ?? undefined, remote: r ?? undefined });
        break;
      case "restore-upload":
        notes.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, archiveLocal: false, local: l ?? undefined, remote: r ?? undefined });
        break;
      case "download":
        notes.push({ id, kind: "download", applyRemote: true, uploadLocal: false, archiveLocal: false, local: l ?? undefined, remote: r ?? undefined });
        break;
      case "local-purge-wins":
        notes.push({ id, kind: "local-purge", applyRemote: false, uploadLocal: false, archiveLocal: false, local: l ?? undefined, remote: r ?? undefined });
        break;
      case "remote-purged-move-to-trash": {
        const localChanged = !!l && !!b && l.contentHash !== b.contentHash;
        notes.push({ id, kind: "remote-purged-trash", applyRemote: true, uploadLocal: false, archiveLocal: localChanged, local: l ?? undefined, remote: r ?? undefined });
        break;
      }
      case "remote-wins-keep-history": {
        const localChanged = !!l && !!b && l.contentHash !== b.contentHash;
        notes.push({ id, kind: "remote-wins-history", applyRemote: true, uploadLocal: false, archiveLocal: localChanged, local: l ?? undefined, remote: r ?? undefined });
        break;
      }
      default: {
        // none：内容一致；元数据按 updatedAt 后写胜（本地更新 → 上传元数据；远端更新 → 应用远端）。
        const localMetaNewer = !!l && !!r && l.updatedAt > r.updatedAt;
        const remoteMetaNewer = !!r && (!l || r.updatedAt > l.updatedAt);
        // 编辑锁字段级 LWW（补齐旧协议 C3）：锁变更不 bump updatedAt，只按 updatedAt 判会永不传播。
        // lockedAt 是 ISO 串/空串，可直接字典序比较；相等时双方都不动。
        const localLockAt = l?.lockedAt ?? "";
        const remoteLockAt = r?.lockedAt ?? "";
        const remoteLockNewer = !!r && remoteLockAt > localLockAt;
        const localLockNewer = !!l && localLockAt > remoteLockAt;
        // 环检测（C4）：本地父在远端树中位于本节点之下 ⇒ 上传会把远端树弄成环，必须跟随远端断开。
        const wouldCycle = !!l && !!r && !!l.parentId && isRemoteDescendant(l.parentId, id, remoteNoteParents);
        notes.push({
          id,
          kind: "none",
          applyRemote: wouldCycle || remoteMetaNewer || remoteLockNewer,
          uploadLocal: !wouldCycle && (localMetaNewer || (!remoteMetaNewer && localLockNewer)),
          archiveLocal: false,
          local: l ?? undefined,
          remote: r ?? undefined,
        });
      }
    }
  }

  const remoteFolders = byId(remote.folders);
  const fids = new Set<string>([...localFolders.keys(), ...remoteFolders.keys(), ...baseFolders.keys()]);
  const folders: LakeFolderPlan[] = [];
  for (const id of [...fids].sort()) {
    const b = baseFolders.get(id) ?? null;
    const l = localFolders.get(id) ?? null;
    const r = safeRemote(remoteFolders.get(id) ?? null);
    const purge = ctx.folderPurgeIntents.has(id);
    if (purge && !l && r) {
      folders.push({ id, kind: "local-purge", applyRemote: false, uploadLocal: false, local: undefined, remote: r });
      continue;
    }
    if (l && !r) {
      // 本地有、远端无：
      // - 无基线 = 本地新建 → upload；
      // - 基线存在且本地在本轮被恢复/编辑过（updatedAt 晚于基线、且已不在回收站）→ 显式恢复传播：
      //   远端「缺席」让位，按 upload 重新发布（D4：否则恢复下一轮又被判 remote-purged-trash 打回）；
      // - 其余 = 远端已彻底删除 → 本地跟随进回收站（删除权威）。
      if (!b) folders.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, local: l, remote: undefined });
      else if (!l.trashedAt && l.updatedAt > b.updatedAt) folders.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, local: l, remote: undefined });
      else folders.push({ id, kind: "remote-purged-trash", applyRemote: true, uploadLocal: false, local: l, remote: undefined });
      continue;
    }
    if (!l && r) {
      // 本地无、远端有：**基线存在 = 用户删了本地目录 ⇒ 删除要传播**（发布不含它的新索引，对端跟随进回收站）；
      // 无基线 = 远端新建 ⇒ 下载。
      if (b) folders.push({ id, kind: "local-delete", applyRemote: false, uploadLocal: false, local: undefined, remote: r });
      else folders.push({ id, kind: "download", applyRemote: true, uploadLocal: false, local: undefined, remote: r });
      continue;
    }
    if (!l || !r) continue;
    const lChanged = !b || l.updatedAt !== b.updatedAt;
    const rChanged = !b || r.updatedAt !== b.updatedAt;
    if (lChanged && !rChanged) folders.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, local: l, remote: r });
    else if (!lChanged && rChanged) folders.push({ id, kind: "download", applyRemote: true, uploadLocal: false, local: l, remote: r });
    else if (lChanged && rChanged) {
      // 环检测（C4）：本地 new parent 在远端目录树中位于本目录之下 ⇒ 上传会成环，跟随远端断开。
      const wouldCycle = !!l.parentId && isRemoteDescendant(l.parentId, id, remoteFolderParents);
      if (!wouldCycle && l.updatedAt > r.updatedAt) folders.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, local: l, remote: r });
      else folders.push({ id, kind: "download", applyRemote: true, uploadLocal: false, local: l, remote: r });
    } else folders.push({ id, kind: "none", applyRemote: false, uploadLocal: false, local: l, remote: r });
  }
  if (cycleWarnings.length > 0) return { notes, folders, warnings: cycleWarnings };
  return { notes, folders };
}

export type QuickNoteActionKind = "upload" | "download" | "remote-wins-history" | "local-delete" | "local-purge" | "none";
export interface QuickNotePlan {
  id: string;
  kind: QuickNoteActionKind;
  applyRemote: boolean;
  uploadLocal: boolean;
  archiveLocal: boolean;
  local?: QuickNoteEntry;
  remote?: QuickNoteEntry;
}
export interface QuickNotesMergePlan { items: QuickNotePlan[] }

export function planQuickNotesMerge(base: QuickNotesIndex | null, local: QuickNotesIndex, remote: QuickNotesIndex, restorePending: ReadonlySet<string>, purgeIntents: ReadonlySet<string> = new Set(), localDeletes: ReadonlySet<string> = new Set(), purgedIds: ReadonlySet<string> = new Set()): QuickNotesMergePlan {

  const b = byId(base?.items);
  const l = byId(local.items);
  const r = byId(remote.items);
  const ids = new Set<string>([...l.keys(), ...r.keys(), ...b.keys()]);
  const items: QuickNotePlan[] = [];
  for (const id of [...ids].sort()) {
    const bb = b.get(id) ?? null;
    const ll = l.get(id) ?? null;
    const rr = r.get(id) ?? null;
    if (purgeIntents.has(id) && !ll && rr) {
      items.push({ id, kind: "local-purge", applyRemote: false, uploadLocal: false, archiveLocal: false, local: undefined, remote: rr });
      continue;
    }
    // 显式恢复优先于 purge 墓碑：用户从「云端已删除 · 仅本地」副本恢复时，必须重新上传，
    // 不能被远端/本地的 purged 墓碑再次判成 local-purge 弹回回收站。
    if (restorePending.has(id) && ll) {
      items.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, archiveLocal: false, local: ll, remote: rr ?? undefined });
      continue;
    }
    if (purgedIds.has(id)) {
      if (ll) items.push({ id, kind: "local-purge", applyRemote: false, uploadLocal: false, archiveLocal: false, local: ll, remote: rr ?? undefined });
      continue;
    }
    if (ll && !rr && !bb) {
      items.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, archiveLocal: false, local: ll, remote: undefined });
      continue;
    }
    if (!ll && rr && bb && localDeletes.has(id)) {
      items.push({ id, kind: "local-delete", applyRemote: false, uploadLocal: false, archiveLocal: false, local: undefined, remote: rr });
      continue;
    }
    if (!ll && rr) {
      items.push({ id, kind: "download", applyRemote: true, uploadLocal: false, archiveLocal: false, local: undefined, remote: rr });
      continue;
    }
    if (ll && !rr && bb) {
      items.push({ id, kind: "local-delete", applyRemote: false, uploadLocal: false, archiveLocal: false, local: ll, remote: undefined });
      continue;
    }
    if (!ll || !rr) continue;
    const lChanged = ll.contentHash !== (bb?.contentHash ?? null);
    const rChanged = rr.contentHash !== (bb?.contentHash ?? null);
    if (!lChanged && !rChanged) {
      const remoteMetaNewer = rr.updatedAt > ll.updatedAt;
      items.push({ id, kind: "none", applyRemote: remoteMetaNewer, uploadLocal: !remoteMetaNewer && ll.updatedAt > rr.updatedAt, archiveLocal: false, local: ll, remote: rr });
      continue;
    }
    if (lChanged && !rChanged) {
      items.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, archiveLocal: false, local: ll, remote: rr });
      continue;
    }
    if (!lChanged && rChanged) {
      items.push({ id, kind: "download", applyRemote: true, uploadLocal: false, archiveLocal: false, local: ll, remote: rr });
      continue;
    }
    items.push({ id, kind: "remote-wins-history", applyRemote: true, uploadLocal: false, archiveLocal: true, local: ll, remote: rr });
  }
  return { items };
}