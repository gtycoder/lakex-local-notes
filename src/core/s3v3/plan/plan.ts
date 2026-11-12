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
import { mergeNotePosition, positionFields, positionOf } from "./positionMerge.js";
import { compareQuickNoteTagVersion, mergeQuickNoteTags } from "../../quickNoteTags.js";
import { folderSpaceForWire } from "../../diary.js";
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
  /** P1-4：正文疑似被外部损坏/替换的条目（引擎按 core 判据得出）：本轮**不上传正文、不覆盖本地文件**，
   *  只留档历史 + 发 warning；发布索引继续用远端版本（远端没有该篇则不发布它，绝不用可疑内容覆盖云端）。 */
  suspiciousBodyIds?: string[];
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

/** 位置字段投影进索引条目/写操作（null 显式写，便于两端比较；wire 字段沿用既有 parentId/trashedAt/deletedFromParentId）。 */
function withPosition<T extends { parentId?: string | null; trashedAt?: string | null; deletedFromParentId?: string | null }>(
  entry: T,
  pos: { parentId: string | null; trashedAt: string | null; deletedFromParentId: string | null },
): T {
  return {
    ...entry,
    parentId: pos.parentId,
    ...(pos.trashedAt ? { trashedAt: pos.trashedAt } : {}),
    ...(pos.deletedFromParentId ? { deletedFromParentId: pos.deletedFromParentId } : {}),
  };
}

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
  // P1-6：父环防护产出的结构化告警必须透出（否则只剩静默改写父关系）。
  warnings.push(...(lakePlan.warnings ?? []));
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
  // Review-A P1-4：publishes.lake 用 Set 去重（旧实现 includes 是 O(n)，20k 文档 + 旧索引场景会放大到秒级）。
  const publishedLakeIds = new Set<string>();
  /** P1-4：引擎按 core 判据算出的「疑似外部损坏」条目——本轮不碰它们的正文与索引。 */
  const suspiciousBodyIds = new Set(input.state.suspiciousBodyIds ?? []);

  const baseNotesById = new Map((base?.lake.notes ?? []).map((n) => [n.id, n] as const));
  for (const p of lakePlan.notes) {
    const l = p.local;
    const r = p.remote;
    // task-44：位置字段（parentId / trashedAt / deletedFromParentId）**独立三方合并**（判据见 plan/positionMerge）。
    // 内容与位置是两个正交维度：位置本地赢 ⇒ 必须发布本地位置（纯移动轮也要 indexChanged）；
    // 位置远端赢 ⇒ 本地应用远端位置（apply-position）。两边都动 ⇒ updatedAt LWW 兜底。
    const posMerge = mergeNotePosition({
      base: positionOf(baseNotesById.get(p.id)),
      local: positionOf(l),
      remote: positionOf(r),
      localUpdatedAt: l?.updatedAt ?? "",
      remoteUpdatedAt: r?.updatedAt ?? "",
    });
    if (posMerge.winner === "local") indexChanged = true;
    // P1-4 正文突变保护：可疑篇**不上传、不发布本地内容**，先留档历史 + warning。
    // 注意：仍允许「远端更新」路径把云端版本写回（那是修复本地损坏，不是上传）；
    // 发布索引里可疑篇只用远端版本（远端没有 ⇒ 整条不发布 = 不拿可疑内容覆盖云端）。
    const suspiciousBody = !!l && suspiciousBodyIds.has(p.id);
    if (suspiciousBody) {
      writes.push({ kind: "archive-local", space: "lake", id: p.id, reason: "suspicious" });
      warnings.push({
        code: "body_suspicious_external_change",
        space: "lake",
        id: p.id,
        title: l!.title,
        detail: "本地正文与基线不一致但行未改动，疑似外部损坏/替换：已跳过上传并留档历史，请从历史或云端恢复",
      });
    }
    const needBody = p.applyRemote && !!r && (!l || l.contentHash !== r.contentHash || p.kind === "download" || p.kind === "remote-wins-history");
    // 声明只在「要应用远端条目」或「要上传本地条目」时才读：零变更/纯无关条目**不产生声明 GET**。
    const willApply = !!(p.applyRemote && r);
    const willUpload = !!(l && (p.uploadLocal || fieldChanged.has(p.id)));
    const lakeDecl = r?.assetsHash && (willApply || willUpload) ? r.assetsHash : undefined;
    addRead(reads, "lake", p.id, lakeDecl, needBody, r?.contentHash ?? null);
    // P1-4：可疑篇不上传（远端更新仍走下面的 apply-remote 修复本地）。
    if (!suspiciousBody && (p.uploadLocal || fieldChanged.has(p.id)) && l) {
      const bodyChanged = !r || r.contentHash !== l.contentHash;
      // 261112 task-44：**内容赢家是远端时不得上传本地旧字节**。字段级变更（移动/回收站/改名等）会进
      // fieldChanged 分支，但这一轮内容判定可能是 download —— applyPlan 先下载后上传，本地正文此时已是
      // 远端字节 ⇒ 上传必然 hash_mismatch，进而 failedUploads 把索引条目回退成远端（位置本地赢被抹掉、
      // 纯移动轮 published=false）。元数据仍由下面的 indexChanged/publish 发布。
      const contentWinsRemote = p.kind === "download" || p.kind === "remote-wins-history";
      if (bodyChanged && !contentWinsRemote) {
        transfers.push({ op: "put", space: "lake", id: p.id, key: lakeBodyKey(p.id, l.contentHash), hash: l.contentHash, size: 0, kind: "body" });
      }
      // 只有「本地要发布」才改索引：纯拉取轮（applyRemote）不重发索引（与 v3 一致）。
      indexChanged = true;
      publishedLakeIds.add(p.id);
    }
    // 可疑篇的归档已按 suspicious 理由生成，避免同内容两份历史快照。
    if (p.archiveLocal && !suspiciousBody) writes.push({ kind: "archive-local", space: "lake", id: p.id, reason: p.kind === "remote-purged-trash" ? "cloud-absent" : "remote-wins" });
    if (p.applyRemote && r) {
      // task-44：应用远端内容时**位置取位置合并赢家**（本地赢 ⇒ 保留本地 parentId/trashedAt/deletedFromParentId，
      // 于是「B 编辑正文」不会回滚「A 的移动/移入回收站」）。
      const meta = posMerge.winner === "local" && l ? withPosition({ ...r }, positionFields(posMerge.position!)) : { ...r };
      writes.push({ kind: "apply-remote", space: "lake", id: p.id, meta, bodyHash: r.contentHash });
      if (p.kind === "remote-wins-history") warnings.push({ code: "conflict_kept_history", space: "lake", id: p.id, title: r.title });
    }
    // 位置远端赢（且本轮没有 apply-remote 覆盖元数据）：把远端位置写回本地（纯位置变化，不动正文）。
    if (posMerge.winner === "remote" && posMerge.position && !(p.applyRemote && r)) {
      writes.push({ kind: "apply-position", space: "lake", id: p.id, position: positionFields(posMerge.position) });
    }
    if (p.kind === "remote-purged-trash") {
      writes.push({ kind: "set-lifecycle", space: "lake", id: p.id, lifecycle: "cloud-deleted" });
    }
    if (p.kind === "local-purge") {
      deletes.push({ space: "lake", id: p.id, reason: "user-purge", prefixes: [`objects/${p.id}-`, `assets/${p.id}/`, `meta/assets/${p.id}/`] });
      indexChanged = true;
    }
    // ---- 文档标签关系（261105 P1）：集合 + 关系版本 LWW（复用小记 tagIds 的既有判据）----
    // 正文 hash 不变也要传播；旧索引无 tagIds 字段 = 未知 ⇒ **绝不清空本地关系**，但本地有关系须发布一次。
    // 字段存在判据 = tagIds 或 tagsUpdatedAt（P0：发布侧现在会显式带 `tagIds: []`，
    // 所以「远端空集合」必须能与「旧索引没有字段」区分开，否则删光标签永远发不出去）。
    const remoteHasTagField = !!r && (r.tagIds !== undefined || r.tagsUpdatedAt !== undefined);
    if (!suspiciousBody && r && remoteHasTagField) {
      const lt = l?.tagsUpdatedAt ?? "";
      const rt = r.tagsUpdatedAt ?? "";
      const localSet = [...(l?.tagIds ?? [])].sort().join("\u0000");
      const remoteSet = [...(r.tagIds ?? [])].sort().join("\u0000");
      if (localSet !== remoteSet || lt !== rt) {
        if (rt > lt) {
          // 远端关系更新 ⇒ 应用远端（保留本机顺序由落库侧实现）；正文 hash 可能没变，不重复 PUT 正文。
          // task-44：位置仍取位置合并赢家（否则「远端改标签」会把本地刚做的移动/删除回滚）。
          const tagMeta = posMerge.winner === "local" && l ? withPosition({ ...r }, positionFields(posMerge.position!)) : { ...r };
          writes.push({ kind: "apply-remote", space: "lake", id: p.id, meta: tagMeta, bodyHash: r.contentHash });
        } else if (lt > rt || (lt === rt && localSet !== remoteSet)) {
          indexChanged = true;
          publishedLakeIds.add(p.id);
        }
      }
    } else if (!suspiciousBody && l && (l.tagIds?.length ?? 0) > 0) {
      // 远端（旧索引）没有标签字段：本地有关系 ⇒ 发布一次把字段带出去（绝不反向清空）。
      indexChanged = true;
      publishedLakeIds.add(p.id);
    }
    // E1-2 暂不生成资产 transfer（需要本地资产实扫/远端声明差集；由 E1-2b 接 E2 transfer 层）。
  }

  publishes.lake = [...publishedLakeIds];

  // 目录：只有本地要发布（uploadLocal）才改索引；纯下载/应用远端不重发。
  // P1-b（261112 真实 S3 验收）：**本地 purge 也必须标记 indexChanged**——purge 后本地已无该目录，
  // 若本轮没有别的变更就会走「零变更短路」不发布，云端索引 folders[] 永久保留已删目录（对端会重新导入）。
  for (const f of lakePlan.folders) {
    if (f.uploadLocal || f.kind === "local-delete" || f.kind === "local-purge") indexChanged = true;
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
      // P1-4：可疑篇只允许用**远端版本**进索引（远端没有就整条不进，绝不用可疑本地内容覆盖云端）。
      .map((p) => {
        let picked = suspiciousBodyIds.has(p.id) ? p.remote : (p.applyRemote && p.remote ? p.remote : p.local ?? p.remote);
        if (!picked) return picked;
        // task-44：**发布条目按位置赢家组装**——内容取内容判定赢家，位置三件套取位置合并赢家。
        // 这是「纯移动轮/回收站轮也能把位置发出去」的关键（旧实现只取 p.remote/p.local 的原始位置）。
        {
          const posMerge = mergeNotePosition({
            base: positionOf(baseNotesById.get(p.id)),
            local: positionOf(p.local),
            remote: positionOf(p.remote),
            localUpdatedAt: p.local?.updatedAt ?? "",
            remoteUpdatedAt: p.remote?.updatedAt ?? "",
          });
          if (posMerge.position && (posMerge.winner === "local" || posMerge.winner === "remote")) {
            picked = withPosition({ ...picked }, positionFields(posMerge.position)) as typeof picked;
          }
        }
        // 261105 P1 复核（Review-A P1-1/P1-2）：标签字段按**关系 LWW 胜者单独合成**，与内容判定解耦。
        // 否则「远端标签更新 + 本地内容要发布」这一轮会用本地旧标签覆盖远端（published 分支还会丢弃 plan.writes）。
        const localTags = p.local?.tagIds;
        const remoteTags = p.remote?.tagIds;
        const lt = p.local?.tagsUpdatedAt ?? "";
        const rt = p.remote?.tagsUpdatedAt ?? "";
        const hasLocalTagField = !!p.local && (localTags !== undefined || lt !== "");
        const hasRemoteTagField = !!p.remote && (remoteTags !== undefined || rt !== "");
        let tagIds: string[] | undefined;
        let tagsUpdatedAt: string | undefined;
        if (hasLocalTagField || hasRemoteTagField) {
          const localSet = [...(localTags ?? [])].sort().join("\u0000");
          const remoteSet = [...(remoteTags ?? [])].sort().join("\u0000");
          if (rt > lt) {
            tagsUpdatedAt = rt;
            tagIds = remoteTags ?? [];
          } else if (lt > rt) {
            tagsUpdatedAt = lt;
            tagIds = localTags ?? [];
          } else {
            // 同版本：确定性 tie-break（排序后集合串的字典序比较，两端选出同一赢家；与小记标签同口径）。
            tagIds = localSet >= remoteSet ? (localTags ?? []) : (remoteTags ?? []);
            tagsUpdatedAt = lt || rt;
          }
        }
        return {
          ...picked,
          // P0：有标签字段/版本时必须显式发布 tagIds（空集合也写 `[]`），否则「删光标签」在 wire 上不可见。
          ...(tagIds !== undefined ? { tagIds: [...tagIds].sort() } : {}),
          ...(tagsUpdatedAt ? { tagsUpdatedAt } : {}),
        };
      })
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
      .filter((f): f is NonNullable<typeof f> => !!f)
      // 日记标记（261109）：发布时**必须显式写** space —— 非日记写 null（不是省略字段），
      // 否则「取消日记标记」在 wire 上不可见、两端会互刷（docs/DIARY.md 硬规则 1）。
      .map((f) => ({ ...f, space: folderSpaceForWire(f.space) }));
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