/**
 * v4 全量重拉（换机/坏库恢复）编排：remote 是真相，本地**收敛**而不是覆盖式删除。
 *
 * 语义与旧 `pullAll(pointer, state, report, archiveLocal=true)` 对齐（这是 I0 止血结论）：
 *  - 本地有、云端没有 ⇒ 复用「云端已删除·仅本地」：记 remotePurged + 软删进回收站（trashedAt/deletedFromParentId），
 *    正文/附件/历史保留，绝不物理删除；
 *  - 本地与云端 hash 不同的条目 ⇒ 先归档本地正文（历史快照）再被覆盖；
 *  - hash 相同的条目**不下载、不读正文**（复用本地内容；文件是否存在由可选 statBody 端口确认，
 *    端口缺失时按「hash 相同即可复用」处理——外部手改文件本就不在支持范围内）；
 *  - 不发布 pointer（云端已是真相），只产出新的本地状态；基线由调用方写。
 */
import type { LakeIndex, QuickNotesIndex, S3v3Pointer } from "../protocol/index.js";
import { indexKey, parseLakeIndexBytes, parseQuickNotesIndexBytes } from "../protocol/index.js";
import type { PlanWarning, ReadOp, Space, SyncPlan, WriteOp } from "../plan/types.js";
import { applyPlan, type ApplyResult } from "../apply/applyPlan.js";
import { applyAssets, type ApplyAssetsResult } from "../apply/applyAssets.js";
import type { RoundPorts } from "./runSyncRound.js";
import { TRASH_NOTEBOOK_ID } from "../../syncDecisions.js";

export interface PullRoundState {
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
  folders: LakeIndex["folders"];
  remotePurged: string[];
}

export interface PullRoundResult {
  state: PullRoundState;
  apply: ApplyResult;
  assets: ApplyAssetsResult;
  warnings: PlanWarning[];
  /** 被移入回收站（云端已删）的条目数。 */
  trashed: number;
  /** 因被云端覆盖而归档的本地正文数。 */
  archived: number;
}

/** 只读两份索引（并发）。 */
export async function readRemoteIndexes(pointer: S3v3Pointer, ports: Pick<RoundPorts, "getRemote">): Promise<{ lake: LakeIndex; quickNotes: QuickNotesIndex }> {
  const [lakeBytes, quickBytes] = await Promise.all([
    ports.getRemote(indexKey("lake", pointer.lake.commit)),
    ports.getRemote(indexKey("quickNotes", pointer.quickNotes.commit)),
  ]);
  if (!lakeBytes || !quickBytes) throw new Error("远端索引缺失");
  const lake = parseLakeIndexBytes(lakeBytes).index;
  const quick = parseQuickNotesIndexBytes(quickBytes).index;
  return { lake, quickNotes: quick };
}

/** 全量重拉：把本地状态收敛到远端索引（不发布）。 */
export async function pullRound(
  input: { state: PullRoundState; remote: { lake: LakeIndex; quickNotes: QuickNotesIndex }; now?: () => string; deferAssets?: boolean; archiveLocal?: boolean; progress?: (p: { phase: "archives" | "reads" | "uploads" | "deletes" | "asset-put" | "asset-get"; done: number; total: number; bytesDone: number }) => void },
  ports: RoundPorts,
): Promise<PullRoundResult> {
  const now = input.now?.() ?? new Date().toISOString();
  const { remote } = input;
  const warnings: PlanWarning[] = [];
  const localLake = new Map(input.state.lake.notes.map((n) => [n.id, n] as const));
  const localQuick = new Map(input.state.quickNotes.items.map((q) => [q.id, q] as const));
  const purged = new Set(input.state.remotePurged ?? []);

  // 1) 本地独有 ⇒ 回收站 + 「云端已删除·仅本地」标记（绝不物删）。
  const remoteLakeIds = new Set(remote.lake.notes.map((n) => n.id));
  const remoteQuickIds = new Set(remote.quickNotes.items.map((q) => q.id));
  const trashedLocal: LakeIndex["notes"] = [];
  let trashed = 0;
  for (const n of input.state.lake.notes) {
    if (remoteLakeIds.has(n.id) || purged.has(n.id)) continue;
    trashedLocal.push({ ...n, trashedAt: n.trashedAt ?? now, deletedFromParentId: n.deletedFromParentId ?? n.parentId, parentId: TRASH_NOTEBOOK_ID });
    purged.add(n.id);
    trashed += 1;
  }
  for (const q of input.state.quickNotes.items) {
    if (remoteQuickIds.has(q.id) || purged.has(q.id)) continue;
    purged.add(q.id);
    trashed += 1;
  }
  if (trashed > 0) warnings.push({ code: "remote_incomplete", space: "lake", detail: "已把 " + trashed + " 个「本机有、云上没有」的条目移入回收站（保留正文/附件/历史，未上传）" });

  // 2) 需要下载的条目：hash 不同 / 本地没有（hash 相同的复用本地内容，不下载）。
  const reads: ReadOp[] = [];
  const writes: WriteOp[] = [];
  let archived = 0;
  const archiveTasks: Array<{ space: Space; id: string; reason: "remote-wins" }> = [];
  for (const n of remote.lake.notes) {
    const local = localLake.get(n.id);
    const needBody = !local || local.contentHash !== n.contentHash;
    if (needBody) {
      if (local && input.archiveLocal !== false) archiveTasks.push({ space: "lake", id: n.id, reason: "remote-wins" });
      reads.push({ kind: "body", space: "lake", id: n.id, hash: n.contentHash });
    }
    if (n.assetsHash) reads.push({ kind: "declaration", space: "lake", id: n.id, declHash: n.assetsHash });
    writes.push({ kind: "apply-remote", space: "lake", id: n.id, meta: { ...n }, bodyHash: n.contentHash });
  }
  for (const q of remote.quickNotes.items) {
    const local = localQuick.get(q.id);
    const needBody = !local || local.contentHash !== q.contentHash;
    if (needBody) {
      if (local && input.archiveLocal !== false) archiveTasks.push({ space: "quickNotes", id: q.id, reason: "remote-wins" });
      reads.push({ kind: "body", space: "quickNotes", id: q.id, hash: q.contentHash });
    }
    if (q.assetsHash) reads.push({ kind: "declaration", space: "quickNotes", id: q.id, declHash: q.assetsHash });
    writes.push({ kind: "apply-remote", space: "quickNotes", id: q.id, meta: { ...q }, bodyHash: q.contentHash });
  }

  const plan: SyncPlan = {
    version: 4, reads, writes, transfers: [], deletes: [], publishes: { lake: [], quickNotes: [] }, publish: null,
    intentChanges: [], warnings: [], total: { ops: reads.length + writes.length, bytes: 0 },
  };
  for (const t of archiveTasks) {
    try { await ports.archiveLocal(t.space, t.id, t.reason); archived += 1; } catch { /* 归档失败不阻断收敛 */ }
  }
  const apply = await applyPlan(plan, ports, {
    ...(input.deferAssets ? { deferDeclarations: true } : {}),
    ...(input.progress ? { onProgress: (p) => input.progress!({ phase: p.phase, done: p.done, total: p.total, bytesDone: p.bytes }) } : {}),
  });
  const assets = await applyAssets(plan, { declarations: apply.declarations }, ports, {
    deferDownloads: input.deferAssets === true,
    ...(input.progress ? { onProgress: (p) => input.progress!({ phase: p.phase, done: p.done, total: p.total, bytesDone: p.bytes }) } : {}),
  });
  warnings.push(...apply.warnings, ...assets.warnings);

  const state: PullRoundState = {
    lake: { ...remote.lake, notes: [...remote.lake.notes, ...trashedLocal] },
    quickNotes: remote.quickNotes,
    folders: remote.lake.folders,
    remotePurged: [...purged].sort(),
  };
  return { state, apply, assets, warnings, trashed, archived };
}

