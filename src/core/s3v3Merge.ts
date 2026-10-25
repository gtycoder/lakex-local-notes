import { decideItem } from "./s3v3Decision.js";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry, QuickNoteEntry, QuickNotesIndex } from "./s3v3Index.js";

/** 三方合并计划（纯逻辑）：输入基线×本地×远端，输出每条的下载/上传/删除/归档意图。 */

export interface LakeMergeContext {
  restorePending: ReadonlySet<string>;
  purgeIntents: ReadonlySet<string>;
  folderPurgeIntents: ReadonlySet<string>;
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
  kind: "upload" | "download" | "local-purge" | "remote-purged-trash" | "none";
  applyRemote: boolean;
  uploadLocal: boolean;
  local?: LakeFolderEntry;
  remote?: LakeFolderEntry;
}

export interface LakeMergePlan {
  notes: LakeNotePlan[];
  folders: LakeFolderPlan[];
}

const byId = <T extends { id: string }>(list: T[] | undefined): Map<string, T> => new Map((list ?? []).map((x) => [x.id, x]));

export function planLakeMerge(base: LakeIndex | null, local: LakeIndex, remote: LakeIndex, ctx: LakeMergeContext): LakeMergePlan {
  const baseNotes = byId(base?.notes);
  const localNotes = byId(local.notes);
  const remoteNotes = byId(remote.notes);
  const ids = new Set<string>([...localNotes.keys(), ...remoteNotes.keys(), ...baseNotes.keys()]);
  const notes: LakeNotePlan[] = [];
  for (const id of [...ids].sort()) {
    const b = baseNotes.get(id) ?? null;
    const l = localNotes.get(id) ?? null;
    const r = remoteNotes.get(id) ?? null;
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
        notes.push({
          id,
          kind: "none",
          applyRemote: remoteMetaNewer,
          uploadLocal: localMetaNewer,
          archiveLocal: false,
          local: l ?? undefined,
          remote: r ?? undefined,
        });
      }
    }
  }

  const baseFolders = byId(base?.folders);
  const localFolders = byId(local.folders);
  const remoteFolders = byId(remote.folders);
  const fids = new Set<string>([...localFolders.keys(), ...remoteFolders.keys(), ...baseFolders.keys()]);
  const folders: LakeFolderPlan[] = [];
  for (const id of [...fids].sort()) {
    const b = baseFolders.get(id) ?? null;
    const l = localFolders.get(id) ?? null;
    const r = remoteFolders.get(id) ?? null;
    const purge = ctx.folderPurgeIntents.has(id);
    if (purge && !l && r) {
      folders.push({ id, kind: "local-purge", applyRemote: false, uploadLocal: false, local: undefined, remote: r });
      continue;
    }
    if (l && !r) {
      // 本地有、远端无：基线存在 = 远端已彻底删除（本地跟随进回收站）；否则 = 本地新建。
      if (b) folders.push({ id, kind: "remote-purged-trash", applyRemote: true, uploadLocal: false, local: l, remote: undefined });
      else folders.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, local: l, remote: undefined });
      continue;
    }
    if (!l && r) {
      // 本地无、远端有：基线存在 = 本地缺失（按云端恢复下载）；否则 = 远端新建。
      folders.push({ id, kind: "download", applyRemote: true, uploadLocal: false, local: undefined, remote: r });
      continue;
    }
    if (!l || !r) continue;
    const lChanged = !b || l.updatedAt !== b.updatedAt;
    const rChanged = !b || r.updatedAt !== b.updatedAt;
    if (lChanged && !rChanged) folders.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, local: l, remote: r });
    else if (!lChanged && rChanged) folders.push({ id, kind: "download", applyRemote: true, uploadLocal: false, local: l, remote: r });
    else if (lChanged && rChanged) {
      if (l.updatedAt > r.updatedAt) folders.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, local: l, remote: r });
      else folders.push({ id, kind: "download", applyRemote: true, uploadLocal: false, local: l, remote: r });
    } else folders.push({ id, kind: "none", applyRemote: false, uploadLocal: false, local: l, remote: r });
  }
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

export function planQuickNotesMerge(base: QuickNotesIndex | null, local: QuickNotesIndex, remote: QuickNotesIndex, restorePending: ReadonlySet<string>, purgeIntents: ReadonlySet<string> = new Set(), localDeletes: ReadonlySet<string> = new Set()): QuickNotesMergePlan {

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
    if (restorePending.has(id) && ll) {
      items.push({ id, kind: "upload", applyRemote: false, uploadLocal: true, archiveLocal: false, local: ll, remote: rr ?? undefined });
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
