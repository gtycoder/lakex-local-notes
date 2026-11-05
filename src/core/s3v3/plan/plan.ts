/**
 * v4 Reconciler（E1-2）：纯函数 planSync —— 输入三份世界快照 + 意图，输出 SyncPlan。
 *
 * 约束（RFC §6.2）：
 *  - **零 IO**：不读远端/不写本地/不打日志；只做决策与引用。
 *  - 复用现有纯合并函数（planLakeMerge / planQuickNotesMerge），保证与 v3 语义同源。
 *  - E1-2 范围：合并决策 → reads/writes/transfers/deletes/intents/publish/total。
 *    资产级 transfer（声明差集）与「pending 清理计划」留到 E1-2 后续小步（见 TODO），
 *    但契约已占位；dry-run 对拍（E1-3）先比合并决策与读写集合。
 */
import type { LakeIndex, QuickNotesIndex } from "../protocol/index.js";
import { lakeBodyKey, quickNoteBodyKey } from "../protocol/index.js";
import { planLakeMerge, planQuickNotesMerge } from "../../s3v3Merge.js";
import { compareQuickNoteTagVersion, mergeQuickNoteTags } from "../../quickNoteTags.js";
import type {
  DeleteOp, Intent, PlanWarning, ReadOp, Space, SyncPlan, TransferOp, WriteOp,
} from "./types.js";

export interface PlanWorld {
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
  folders: LakeIndex["folders"];
}

export interface PlanState {
  /** 显式恢复标记。 */
  restorePending: string[];
  /** 本地彻底删除意图（id 集合）。 */
  purgeIntents: string[];
  /** 目录彻底删除意图（id 集合）。 */
  folderPurgeIntents: string[];
  /** 本地小记软删（用于区分远端新增）。 */
  quickDeletes?: string[];
  /** 本机待删标签 id（离线删过、还没确认远端缺席）：索引里不能出现，远端重发也不复活。 */
  pendingTagDeletes?: string[];
  /** 小记不可恢复删除（purged 墓碑）。 */
  purgedQuickIds?: string[];
  /**
   * 强制按「本地发布」处理的条目（字段级变更：is_locked/locked_at/icon/title 等不 bump updatedAt，
   * 三方合并的内容级判据看不见它们）。由调用方（引擎/适配层）从状态投影算出，plan 只消费。
   */
  fieldChangedIds?: string[];
  /** 本地正文文件缺失的条目（适配层一次目录列举得出）：强制走上传判定，触发缺正文自愈。 */
  bodyMissingIds?: string[];
  /** 强制发布本轮索引（墓碑裁剪/首次收到他端墓碑等「只有 quick 索引变化」的场景）。 */
  forcePublish?: boolean;
}

export interface PlanInput {
  local: PlanWorld;
  /** null = 无基线（首拉/全量重拉；调用方应先处理好本地独有 → 回收站语义）。 */
  base: PlanWorld | null;
  remote: PlanWorld;
  state: PlanState;
  /** false = 首拉只搬正文/声明（资产按需），与引擎 deferAssets 同义。 */
  deferAssets?: boolean;
}

export interface PlanResult extends SyncPlan {}

function addRead(reads: ReadOp[], space: Space, id: string, remoteAssetsHash: string | undefined, needBody: boolean, bodyHash: string | null): void {
  if (needBody && bodyHash) reads.push({ kind: "body", space, id, hash: bodyHash });
  if (remoteAssetsHash) reads.push({ kind: "declaration", space, id, declHash: remoteAssetsHash });
}

/** 纯函数：本轮所有决定（不含 IO）。 */
export function planSync(input: PlanInput): SyncPlan {
  const reads: ReadOp[] = [];
  const writes: WriteOp[] = [];
  const transfers: TransferOp[] = [];
  const deletes: DeleteOp[] = [];
  const warnings: PlanWarning[] = [];
  const { local, remote, base } = input;
  const restore = new Set(input.state.restorePending);
  const purgeIntents = new Set(input.state.purgeIntents);
  const folderPurgeIntents = new Set(input.state.folderPurgeIntents);
  const fieldChanged = new Set(input.state.fieldChangedIds ?? []);

  const lakePlan = planLakeMerge(base?.lake ?? null, local.lake, remote.lake, {
    restorePending: restore,
    purgeIntents,
    folderPurgeIntents,
  });
  const quickPlan = planQuickNotesMerge(
    base?.quickNotes ?? null,
    local.quickNotes,
    remote.quickNotes,
    restore,
    purgeIntents,
    new Set(input.state.quickDeletes ?? []),
    new Set(input.state.purgedQuickIds ?? []),
  );

  // 远端索引变化标记（用于 publish=null 零变更短路）。
  let indexChanged = input.state.forcePublish === true;
  // 小记墓碑列表也是索引的一部分：与基线不同就必须发布（否则墓碑裁不掉/传不出去）。
  const purgedIds = [...(input.state.purgedQuickIds ?? [])].sort();
  const basePurged = [...(base?.quickNotes.purged ?? [])].sort();
  if (purgedIds.join("\u0000") !== basePurged.join("\u0000")) indexChanged = true;
  // 本地要发布的条目（uploadLocal）：metadata-only 轮次没有 body PUT，必须单独记录。
  const publishes: SyncPlan["publishes"] = { lake: [], quickNotes: [] };

  for (const p of lakePlan.notes) {
    const l = p.local;
    const r = p.remote;
    const needBody = p.applyRemote && !!r && (!l || l.contentHash !== r.contentHash || p.kind === "download" || p.kind === "remote-wins-history");
    // 声明只在「要应用远端条目」或「要上传本地条目」时才读：零变更/纯无关条目**不产生声明 GET**。
    const willApply = !!(p.applyRemote && r);
    const willUpload = !!(l && (p.uploadLocal || fieldChanged.has(p.id)));
    const lakeDecl = r?.assetsHash && (willApply || willUpload) ? r.assetsHash : undefined;
    addRead(reads, "lake", p.id, lakeDecl, needBody, r?.contentHash ?? null);
    if ((p.uploadLocal || fieldChanged.has(p.id)) && l) {
      const bodyChanged = !r || r.contentHash !== l.contentHash;
      if (bodyChanged) {
        transfers.push({ op: "put", space: "lake", id: p.id, key: lakeBodyKey(p.id, l.contentHash), hash: l.contentHash, size: 0, kind: "body" });
      }
      // 只有「本地要发布」才改索引：纯拉取轮（applyRemote）不重发索引（与 v3 一致）。
      indexChanged = true;
      publishes.lake.push(p.id);
    }
    if (p.archiveLocal) writes.push({ kind: "archive-local", space: "lake", id: p.id, reason: p.kind === "remote-purged-trash" ? "cloud-absent" : "remote-wins" });
    if (p.applyRemote && r) {
      writes.push({ kind: "apply-remote", space: "lake", id: p.id, meta: { ...r }, bodyHash: r.contentHash });
      if (p.kind === "remote-wins-history") warnings.push({ code: "conflict_kept_history", space: "lake", id: p.id, title: r.title });
    }
    if (p.kind === "remote-purged-trash") {
      writes.push({ kind: "set-lifecycle", space: "lake", id: p.id, lifecycle: "cloud-deleted" });
    }
    if (p.kind === "local-purge") {
      deletes.push({ space: "lake", id: p.id, reason: "user-purge", prefixes: [`objects/${p.id}-`, `assets/${p.id}/`, `meta/assets/${p.id}/`] });
      indexChanged = true;
    }
    // E1-2 暂不生成资产 transfer（需要本地资产实扫/远端声明差集；由 E1-2b 接 E2 transfer 层）。
  }

  // 目录：只有本地要发布（uploadLocal）才改索引；纯下载/应用远端不重发。
  for (const f of lakePlan.folders) {
    if (f.uploadLocal || f.kind === "local-delete") indexChanged = true;
    // 目录元数据也要真正落到本地状态（否则对端永远显示活跃：回收站/父级变更传不过去）。
    if (f.applyRemote && f.remote) writes.push({ kind: "apply-remote-folder", space: "lake", id: f.id, meta: { ...f.remote } });
    else if (f.kind === "remote-purged-trash") writes.push({ kind: "remove-folder", id: f.id });
  }

  for (const p of quickPlan.items) {
    const l = p.local;
    const r = p.remote;
    const needBody = p.applyRemote && !!r && (!l || l.contentHash !== r.contentHash || p.kind === "download" || p.kind === "remote-wins-history");
    const willApply = !!(p.applyRemote && r);
    const willUpload = !!(l && (p.uploadLocal || fieldChanged.has(p.id)));
    const quickDecl = r?.assetsHash && (willApply || willUpload) ? r.assetsHash : undefined;
    addRead(reads, "quickNotes", p.id, quickDecl, needBody, r?.contentHash ?? null);
    if ((p.uploadLocal || fieldChanged.has(p.id)) && l) {
      const bodyChanged = !r || r.contentHash !== l.contentHash;
      if (bodyChanged) {
        transfers.push({ op: "put", space: "quickNotes", id: p.id, key: quickNoteBodyKey(l.contentHash), hash: l.contentHash, size: 0, kind: "body" });
      }
      indexChanged = true;
      publishes.quickNotes.push(p.id);
    }
    if (p.archiveLocal) writes.push({ kind: "archive-local", space: "quickNotes", id: p.id, reason: "remote-wins" });
    // 小记标签关系是独立于正文 hash 的字段级 LWW（tagsUpdatedAt）：正文没变也必须传播。
    if (l && r) {
      const lt = l.tagsUpdatedAt ?? "";
      const rt = r.tagsUpdatedAt ?? "";
      // 关系按**集合**比较：顺序是设备本地视图，不参与同步。
      const ltags = [...(l.tagIds ?? [])].sort().join("\u0000");
      const rtags = [...(r.tagIds ?? [])].sort().join("\u0000");
      if (ltags !== rtags || lt !== rt) {
        if (rt > lt) writes.push({ kind: "apply-remote", space: "quickNotes", id: p.id, meta: { ...r }, bodyHash: r.contentHash });
        else if (lt > rt || (lt === rt && ltags !== rtags)) { indexChanged = true; publishes.quickNotes.push(p.id); }
      }
    }
    if (p.applyRemote && r) {
      writes.push({ kind: "apply-remote", space: "quickNotes", id: p.id, meta: { ...r }, bodyHash: r.contentHash });
      if (p.kind === "remote-wins-history") warnings.push({ code: "conflict_kept_history", space: "quickNotes", id: p.id });
    }
    if (p.kind === "local-delete" && r && !l) {
      // 本地软删（缺席 = 删除语义）：发布不含该条目的新索引，对端跟随进回收站。
      indexChanged = true;
    }
    if (p.kind === "local-delete" && l) {
      if (purgedIds.includes(p.id)) {
        // 他端 purged 墓碑（不可恢复删除）：本端不留副本。
        writes.push({ kind: "quick-purge", space: "quickNotes", id: p.id });
      } else {
        // 普通软删（缺席）：本地跟随进回收站（保留正文/图片，不物理删）。
        writes.push({ kind: "quick-soft-delete", space: "quickNotes", id: p.id });
      }
    }
    if (p.kind === "local-purge") {
      deletes.push({ space: "quickNotes", id: p.id, reason: "user-purge", prefixes: [`quick-notes/assets/${p.id}/`], ...(l ? { keys: [quickNoteBodyKey(l.contentHash)] } : {}) });
      indexChanged = true;
    }
  }

  // 标签目录：**删除 = 缺席**（261105 定稿）——云端 tags[] 只出现 active 标签，墓碑永不进索引。
  // 三方判定：
  //  ① 基线有 / 远端缺席 ⇒ 他端已删除（**删除压编辑**：本地改名也不上诉）⇒ 删本地；
  //  ② 本机待删（离线删过、还没发布成功）⇒ 一律按已删处理，远端重发也不复活；
  //  ③ 其余按 ID + 确定性 LWW 合并（顺序不参与，纯本机视图）。
  const localTags = local.quickNotes.tags ?? [];
  const remoteTags = remote.quickNotes.tags ?? [];
  const baseTags = base?.quickNotes.tags ?? [];
  const remoteTagIds = new Set(remoteTags.map((tag) => tag.id));
  const baseTagIds = new Set(baseTags.map((tag) => tag.id));
  const pendingTagDeletes = new Set(input.state.pendingTagDeletes ?? []);
  /** 他端删了、本地还留着 ⇒ 本轮删本地（删除压编辑）。 */
  const quickTagRemoved = localTags
    .filter((tag) => baseTagIds.has(tag.id) && !remoteTagIds.has(tag.id))
    .map((tag) => tag.id);
  const removedTagIds = new Set(quickTagRemoved);
  /** 远端已缺席 ⇒ 本机待删记录可以结算（否则会一直抑制同名标签）。 */
  const quickTagSettled = [...pendingTagDeletes].filter((id) => !remoteTagIds.has(id));
  const quickTags = mergeQuickNoteTags(
    localTags.filter((tag) => !removedTagIds.has(tag.id)),
    remoteTags,
    { exclude: new Set([...pendingTagDeletes, ...removedTagIds]) },
  );
  const remoteTagById = new Map(remoteTags.map((tag) => [tag.id, tag] as const));
  /** 本端目录有更新（远端没有 / 本端更新）⇒ 本轮必须发布；纯远端更新不需要本端再发一次。 */
  const localTagChanged = localTags.some((tag) => {
    if (pendingTagDeletes.has(tag.id) || removedTagIds.has(tag.id)) return false;
    const other = remoteTagById.get(tag.id);
    return !other || compareQuickNoteTagVersion(tag, other) > 0;
  });
  // 待删 / 删本地都要求「索引里没有它」：只要远端或基线还带着，就必须发布一次把缺席写出去。
  const tagRemovalNeedsPublish = [...pendingTagDeletes, ...removedTagIds]
    .some((id) => remoteTagIds.has(id) || baseTagIds.has(id));
  if (localTagChanged || tagRemovalNeedsPublish) indexChanged = true;

  // 发布索引：只在本轮会改变索引时构建（零变更轮 publish=null，只读 pointer）。
  let publish: SyncPlan["publish"] = null;
  if (indexChanged) {
    const lakeNotes = lakePlan.notes
      .filter((p) => p.kind !== "local-purge" && p.kind !== "remote-purged-trash")
      .map((p) => (p.applyRemote && p.remote ? p.remote : p.local ?? p.remote))
      .filter((n): n is NonNullable<typeof n> => !!n);
    const quickItems = quickPlan.items
      .filter((p) => p.kind !== "local-purge" && p.kind !== "local-delete")
      .map((p) => (p.applyRemote && p.remote ? p.remote : p.local ?? p.remote))
      .filter((q): q is NonNullable<typeof q> => !!q)
      // 发布时标签关系一律排序成集合（顺序不跨端传播）。
      .map((q) => (q.tagIds?.length ? { ...q, tagIds: [...q.tagIds].sort() } : q));
    const folders = lakePlan.folders
      .filter((f) => f.kind !== "local-purge" && f.kind !== "local-delete")
      .map((f) => (f.applyRemote && f.remote ? f.remote : f.local ?? f.remote))
      .filter((f): f is NonNullable<typeof f> => !!f);
    publish = {
      lake: { v: 3, space: "lake", notes: lakeNotes, folders },
      quickNotes: {
        // 发布只带已知字段：旧索引可能残留 pinned/sortOrder/deletedAt（已废弃），不能借发布继续传播。
        v: 3, space: "quickNotes", items: quickItems,
        tags: quickTags.map((tag) => ({
          id: tag.id, name: tag.name, createdAt: tag.createdAt, updatedAt: tag.updatedAt,
        })),
        // 墓碑随索引传播（不可恢复删除；超过保留窗口的由引擎在入 plan 前裁掉）。
        ...((input.state.purgedQuickIds ?? []).length > 0 ? { purged: [...(input.state.purgedQuickIds ?? [])].sort() } : {}),
      },
    };
  }

  // 意图变更：本纯函数只生成「新增 purge/restore」的意图候选；清除由引擎/Finalize 按 generation 做。
  const intentChanges: Array<{ op: "add" | "clear"; intent: Intent }> = [];

  const bytes = transfers.reduce((sum, t) => sum + t.size, 0);
  return {
    version: 4,
    reads,
    writes,
    transfers,
    deletes,
    publishes,
    quickTags,
    quickTagRemoved,
    quickTagSettled,
    publish,
    intentChanges,
    warnings,
    total: { ops: reads.length + writes.length + transfers.length + deletes.length, bytes },
  };
}