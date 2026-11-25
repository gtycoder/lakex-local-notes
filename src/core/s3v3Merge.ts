/**
 * 核心合并判据（纯逻辑、零 IO）：三方合并 base(设备基线) × local(本地索引) × remote(远端索引)，
 * 逐条输出下载/上传/删除/归档意图 —— `planLakeMerge`（文档+目录）、`planQuickNotesMerge`（小记）。
 * 单条内容判定委托 `s3v3Decision.decideItem`：恢复标记 → 本地删除意图 → 缺席/新增 → contentHash
 * （docs/SYNC-PROTOCOL.md §9.1；小记顺序见 §9.3）。
 *
 * 边界（不做什么）：只做「判定」不执行（传输/落盘在 `s3v3Engine` 四相编排与 `s3v3/commit/*`）；
 * 位置三件套 parentId/trashedAt/deletedFromParentId **不在此判**，走 `s3v3/plan/positionMerge.ts`
 * 独立三方合并（SYNC-PROTOCOL §9.5，AGENTS §3#24 位置与内容正交）；编辑锁同理独立合并（§9.8）；
 * 合并层不做父集合合法性闸门（父节点兜底「未分类」归适配器，AGENTS §3#12）。
 *
 * 红线引注：本地是真相、S3 只是镜像（AGENTS §3#1）；删除传播/删除压编辑（§3#2/#3，删除=缺席 §10）；
 * 恢复是唯一显式例外（§3#4）；被远端删除强制留历史快照（SYNC-PROTOCOL §9.9）；日记本 space 只升不降
 * （§3#25，`enforceDiarySpaceMonotone`）；远端父环拒绝并出 warning（P1-6，`idsWithCyclicAncestors`）。
 */

import { isDiaryNotebookNode } from "./diary.js";
import { decideItem, type ItemAction } from "./s3v3Decision.js";
import { applyEncounterAction, applyFolderEncounterAction, applyQuickEncounterAction, type EncounterFolderAction, type EncounterQuickAction, type FirstEncounterMode } from "./firstEncounter.js";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry, QuickNoteEntry, QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import type { PlanWarning } from "./s3v3/plan/types.js";


export interface LakeMergeContext {
  restorePending: ReadonlySet<string>;
  purgeIntents: ReadonlySet<string>;
  folderPurgeIntents: ReadonlySet<string>;
  /** 首次相遇（docs/SYNC-PROTOCOL.md §21）：四选项对缺席/冲突判定的改写层（undefined = 既有语义）。 */
  encounter?: FirstEncounterMode;
  /** download-to-trash 落回收站用的时间戳（trashedAt）。 */
  trashNow?: string;
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
  /** 首次相遇「以本地为准」：远端独有条目落本地回收站（发布为 trashed、不从本地丢内容）。 */
  trashOverride?: { trashedAt: string };
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
    cycleWarnings.push({ code: "cycle_parent_rejected", space: "lake", id, detail: "cycle-parent: 远端父级形成环，已拒绝该父关系" });
  }
  for (const [id] of byId(remote.folders)) {
    if (!cyclicIds.has(id)) continue;
    parentFix.set(id, localFolders.get(id)?.parentId ?? baseFolders.get(id)?.parentId ?? null);
    cycleWarnings.push({ code: "cycle_parent_rejected", space: "lake", id, detail: "cycle-parent: 远端父级形成环，已拒绝该父关系" });
  }
  const safeRemote = <T extends { id: string; parentId: string | null }>(entry: T | null): T | null => {
    if (!entry || !parentFix.has(entry.id)) return entry;
    return { ...entry, parentId: parentFix.get(entry.id)! };
  };
  const remoteNoteParents = new Map<string, string | null>();
  for (const n of remoteNotes.values()) remoteNoteParents.set(n.id, safeRemote(n)!.parentId);
  const ids = new Set<string>([...localNotes.keys(), ...remoteNotes.keys(), ...baseNotes.keys()]);
  const notes: LakeNotePlan[] = [];
  for (const id of [...ids].toSorted()) {
    const b = baseNotes.get(id) ?? null;
    const l = localNotes.get(id) ?? null;
    const r = safeRemote(remoteNotes.get(id) ?? null);
    const rawAction = decideItem({
      basePresent: !!b,
      baseHash: b?.contentHash ?? null,
      localPresent: !!l,
      localHash: l?.contentHash ?? null,
      remotePresent: !!r,
      remoteHash: r?.contentHash ?? null,
      restorePending: ctx.restorePending.has(id),
      localPurgeIntent: ctx.purgeIntents.has(id),
    });
    // 首次相遇改写层（SYNC-PROTOCOL §21）：undefined = 既有语义；四选项对缺席/冲突判定的映射见 firstEncounter.ts。
    const action: ItemAction | "download-to-trash" = ctx.encounter
      ? applyEncounterAction(ctx.encounter, rawAction, { localPresent: !!l, remotePresent: !!r, basePresent: !!b })
      : rawAction;
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
      case "download-to-trash":
        // 首次相遇「以本地为准」：远端独有 → 本地回收站（内容保留；发布为 trashed 条目）。
        notes.push({ id, kind: "download", applyRemote: true, uploadLocal: false, archiveLocal: false, trashOverride: { trashedAt: ctx.trashNow ?? r?.updatedAt ?? "" }, local: l ?? undefined, remote: r ?? undefined });
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
        // 无基线（首次相遇空底稿轮）：拿不出「本地是否改过」的证据 ⇒ 以「本地与将被覆盖的远端不同」
        // 保守判留档（远端胜留历史，SYNC-PROTOCOL §21；多留一份历史无害，丢本地编辑有害，261123）。
        const localChanged = !!l && (!b ? !!r && l.contentHash !== r.contentHash : l.contentHash !== b.contentHash);
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
        // 「以云端为准」：元数据分歧一律**采纳远端**（把本地时间戳/锁漂移就地归一）——否则
      // 首相遇轮抑制上行后漂移仍在，下一个普通轮又对齐发布 = 索引抖动（261123 idlePublish 实测）。
          const cloudWinsMeta = ctx.encounter === "cloud-wins";
          const metaDrift = localMetaNewer || remoteMetaNewer || localLockNewer || remoteLockNewer;
          notes.push({
          id,
          kind: "none",
          applyRemote: wouldCycle || remoteMetaNewer || remoteLockNewer || (cloudWinsMeta && metaDrift),
          uploadLocal: !cloudWinsMeta && !wouldCycle && (localMetaNewer || (!remoteMetaNewer && localLockNewer)),
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
  for (const id of [...fids].toSorted()) {
    const b = baseFolders.get(id) ?? null;
    const l = localFolders.get(id) ?? null;
    const r = safeRemote(remoteFolders.get(id) ?? null);
    const purge = ctx.folderPurgeIntents.has(id);
    // 261124 P0-B1：目录决策同样过**首次相遇改写层**（旧实现裸用原始判定 ⇒ 「只增不删」轮也把本地目录
    // 判 remote-purged-trash → remove-folder → deleteTreeNode 级联收整棵子树）。同时对齐 decideItem：
    // 「基线在场」不是删除意图 —— 本地缺席 + 远端有一律 download 补回（真删除走 folderPurgeIntents /
    // 软删 trashedAt 两个显式通道），删除传播不再冒充普通缺席。
    const pushFolder = (rawKind: EncounterFolderAction): void => {
      const kind = ctx.encounter
        ? applyFolderEncounterAction(ctx.encounter, rawKind, { localPresent: !!l, remotePresent: !!r, basePresent: !!b })
        : rawKind;
      folders.push({
        id,
        kind: kind as LakeFolderPlan["kind"],
        applyRemote: kind === "download" || kind === "remote-purged-trash",
        uploadLocal: kind === "upload",
        local: l ?? undefined,
        remote: r ?? undefined,
      });
    };
    if (purge && !l && r) { pushFolder("local-purge"); continue; }
    if (l && !r) {
      // 本地有、远端无：
      // - 无基线 = 本地新建 → upload；
      // - 基线存在且本地在本轮被恢复/编辑过（updatedAt 晚于基线、且已不在回收站）→ 显式恢复传播：
      //   远端「缺席」让位，按 upload 重新发布（D4：否则恢复下一轮又被判 remote-purged-trash 打回）；
      // - 其余 = 远端已彻底删除 → 本地跟随进回收站（删除权威）。
      // F-01b（task-77）：**本地是回收站副本（trashed）且无基线 ⇒ 不是本地新建**。对端 purge 目录后，
      // 基线会被纯拉取轮推进到「不含该目录」的远端索引，上一版会在这里退化成 upload ⇒ 对端每轮把
      // 已 purge 的目录重新发布回云端 folders[]。回收站副本永远不参与上传（删除权威）。
      if (!b && !l.trashedAt) pushFolder("upload");
      else if (b && !l.trashedAt && l.updatedAt > b.updatedAt) pushFolder("upload");
      else pushFolder("remote-purged-trash");
      continue;
    }
    if (!l && r) {
      // 261124 P0-B1②（对齐 decideItem syncDecisions.ts:36）：**基线在场不是删除意图** ——
      // 无 purge 意图的本地缺失一律按云端恢复（download）。旧实现判 local-delete 会把
      // 「基线有、行缺失」（迁移/映射缺口）发布成缺席 ⇒ 他端整树进回收站。
      pushFolder("download");
      continue;
    }
    if (!l || !r) continue;
    const lChanged = !b || l.updatedAt !== b.updatedAt;
    const rChanged = !b || r.updatedAt !== b.updatedAt;
    if (lChanged && !rChanged) pushFolder("upload");
    else if (!lChanged && rChanged) pushFolder("download");
    else if (lChanged && rChanged) {
      // 环检测（C4）：本地 new parent 在远端目录树中位于本目录之下 ⇒ 上传会成环，跟随远端断开。
      const wouldCycle = !!l.parentId && isRemoteDescendant(l.parentId, id, remoteFolderParents);
      // 261124 P0-B1③：additive/local-wins 的「冲突本机胜」不再按 updatedAt 让远端（cloud-wins 照旧让远端）。
      const conflictLocalWins = ctx.encounter === "additive" || ctx.encounter === "local-wins" || l.updatedAt > r.updatedAt;
      if (!wouldCycle && conflictLocalWins && ctx.encounter !== "cloud-wins") pushFolder("upload");
      else pushFolder("download");
    } else pushFolder("none");
  }
  const normalizedFolders = enforceDiarySpaceMonotone(folders);
  if (cycleWarnings.length > 0) return { notes, folders: normalizedFolders, warnings: cycleWarnings };
  // 「以云端为准」（首次相遇）：本地一切变更不上行（内容/元数据/目录）——云端覆盖本地；
  // 恢复（restorePending）是唯一显式例外（AGENTS §3#4）。
  if (ctx.encounter === "cloud-wins") {
    for (const n of notes) if (!ctx.restorePending.has(n.id)) n.uploadLocal = false;
    for (const f of normalizedFolders) f.uploadLocal = false;
  }
  return { notes, folders: normalizedFolders };
}

/**
 * 日记本单调性（261112 用户裁决，AGENTS §3#25）：`folders[].space` 只允许 `null → "diary"`，
 * **禁止 `"diary" → null`**。他端旧包/脏数据把日记本发成 null（或整条缺席）时：
 *  · 本地已是 diary ⇒ 本地权威，按 upload 重新发布 diary（云端被改回普通笔记本也会被纠正）；
 *  · 仅远端是 diary、本地不是 ⇒ 从远端取回（download），只升不降。
 * 纯函数：只改合并计划条目，不改 wire 字段/表结构（发布侧仍显式写 space）。
 */
function enforceDiarySpaceMonotone(folders: LakeFolderPlan[]): LakeFolderPlan[] {
  return folders.map((f) => {
    const localDiary = isDiaryNotebookNode(f.local);
    const remoteDiary = isDiaryNotebookNode(f.remote);
    if (localDiary && !remoteDiary) {
      // 远端不是日记（null/缺席）⇒ 绝不 applyRemote（否则本地被降级成普通笔记本），改为重发布本地。
      return { ...f, kind: "upload", applyRemote: false, uploadLocal: true };
    }
    if (!localDiary && remoteDiary) {
      // 本地行丢了日记标记（换机/旧包/脏数据）⇒ 以远端为准取回；本机没有这本时就是首次下载。
      return { ...f, kind: "download", applyRemote: true, uploadLocal: false };
    }
    return f;
  });
}

export type QuickNoteActionKind = "upload" | "download" | "remote-wins-history" | "local-delete" | "local-purge" | "none";
export interface QuickNotePlan {
  id: string;
  kind: QuickNoteActionKind;
  applyRemote: boolean;
  uploadLocal: boolean;
  archiveLocal: boolean;
  /** 首次相遇「以本地为准」：远端独有小记落小记回收站（下载内容 + 发布缺席，不物删）。 */
  trashOverride?: { trashedAt: string };
  local?: QuickNoteEntry;
  remote?: QuickNoteEntry;
}
export interface QuickNotesMergePlan { items: QuickNotePlan[] }

export function planQuickNotesMerge(base: QuickNotesIndex | null, local: QuickNotesIndex, remote: QuickNotesIndex, restorePending: ReadonlySet<string>, purgeIntents: ReadonlySet<string> = new Set(), localDeletes: ReadonlySet<string> = new Set(), purgedIds: ReadonlySet<string> = new Set(), encounter?: FirstEncounterMode, trashNow?: string): QuickNotesMergePlan {

  const b = byId(base?.items);
  const l = byId(local.items);
  const r = byId(remote.items);
  const ids = new Set<string>([...l.keys(), ...r.keys(), ...b.keys()]);
  const items: QuickNotePlan[] = [];
  for (const id of [...ids].toSorted()) {
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
      // 261113（C1 真实桶实测）：删除压编辑只压「基线那一版」。远端条目比基线新 ⇒ 他端显式恢复
      // （恢复会 bump updatedAt）⇒ 必须让远端赢；否则本地旧墓碑会永久压过恢复、并把缺席反复
      // 发布回云端（删除回弹、恢复永远不生效）。同型 Lake 文档早就按 updatedAt/trashedAt 判，小记漏了。
      if ((rr.updatedAt ?? "") > (bb.updatedAt ?? "")) {
        items.push({ id, kind: "download", applyRemote: true, uploadLocal: false, archiveLocal: false, local: undefined, remote: rr });
        continue;
      }
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
    // 无基线（首次相遇空底稿）：与 decideItem 的 !basePresent 分支同语义——同 hash = none，
    // 异 = 远端胜留历史。旧判据 `bb?.contentHash ?? null` 在无基线时把 lChanged/rChanged 恒判 true
    // ⇒ 无谓的 remote-wins-history 下载 + 留档（261123 pullAllDiff 实测 downloaded=1）。
    if (!bb) {
      if (ll.contentHash === rr.contentHash) {
        const remoteMetaNewer0 = rr.updatedAt > ll.updatedAt;
        items.push({ id, kind: "none", applyRemote: remoteMetaNewer0 || (encounter === "cloud-wins" && ll.updatedAt !== rr.updatedAt), uploadLocal: encounter !== "cloud-wins" && !remoteMetaNewer0 && ll.updatedAt > rr.updatedAt, archiveLocal: false, local: ll, remote: rr });
      } else {
        items.push({ id, kind: "remote-wins-history", applyRemote: true, uploadLocal: false, archiveLocal: true, local: ll, remote: rr });
      }
      continue;
    }
    const lChanged = ll.contentHash !== (bb?.contentHash ?? null);
    const rChanged = rr.contentHash !== (bb?.contentHash ?? null);
    if (!lChanged && !rChanged) {
      const remoteMetaNewer = rr.updatedAt > ll.updatedAt;
      items.push({ id, kind: "none", applyRemote: remoteMetaNewer || (encounter === "cloud-wins" && ll.updatedAt !== rr.updatedAt), uploadLocal: encounter !== "cloud-wins" && !remoteMetaNewer && ll.updatedAt > rr.updatedAt, archiveLocal: false, local: ll, remote: rr });
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
  // 首次相遇改写层（SYNC-PROTOCOL §21）：小记版映射（download-to-trash = 下载内容 + 落小记回收站 + 发布缺席）。
  if (encounter) {
    for (const it of items) {
      const mapped = applyQuickEncounterAction(encounter, it.kind as EncounterQuickAction, { localPresent: !!it.local, remotePresent: !!it.remote, basePresent: b.has(it.id) });
      if (mapped === it.kind) continue;
      if (mapped === "download-to-trash") {
        it.kind = "download";
        it.applyRemote = true;
        it.uploadLocal = false;
        it.archiveLocal = false;
        it.trashOverride = { trashedAt: trashNow ?? it.remote?.updatedAt ?? "" };
        continue;
      }
      it.kind = mapped as QuickNoteActionKind;
      it.applyRemote = mapped === "download" || mapped === "remote-wins-history";
      it.uploadLocal = mapped === "upload";
      it.archiveLocal = mapped === "remote-wins-history";
    }
  }
  // 「以云端为准」：小记本地变更同样不上行（恢复例外）；软删/回收站语义由上方映射照常。
  if (encounter === "cloud-wins") {
    for (const it of items) if (!restorePending.has(it.id)) it.uploadLocal = false;
  }
  return { items };
}