import { randomUUID } from "node:crypto";
import {
  buildAssetDeclaration,
  indexHashOf,
  serializeDeclaration,
  serializeLakeIndex,
  serializeQuickNotesIndex,
  type LakeIndex,
  type LakeNoteEntry,
  type QuickNoteEntry,
  type QuickNoteTagEntry,
  type QuickNotesIndex,
} from "../../src/core/s3v3Index.js";
import { declarationKey } from "../../src/core/s3v3Keys.js";
import type { S3v3Pointer } from "../../src/core/s3v3Types.js";
import type { S3v3Remote } from "./ports.js";

/** 旧 Manifest（V1/V2）→ v3 迁移（一次性；正文/附件对象布局不变，不重传字节）。 */

export interface LegacyAsset { filename: string; size: number; hash: string; mimeType?: string; width?: number | null; height?: number | null }
export interface LegacyNote {
  id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; contentHash: string;
  isConflict?: boolean; isLocked?: boolean; lockedAt?: string | null; icon?: string | null; kind?: string;
  assets?: LegacyAsset[]; deleted?: boolean; deletedAt?: string; trashedAt?: string | null; deletedFromParentId?: string | null;
}
export interface LegacyFolder { id: string; title: string; parentId: string | null; sortOrder: number; nodeType: "notebook" | "group"; icon: string | null; updatedAt: string; trashedAt?: string | null; deletedFromParentId?: string | null; deleted?: boolean }
export interface LegacyManifest { notes: LegacyNote[]; folders?: LegacyFolder[] }
export interface LegacyQuickItem { id: string; createdAt: string; updatedAt: string; contentHash: string; isConflict?: boolean; assets?: LegacyAsset[]; deleted?: boolean; deletedAt?: string; tagIds?: string[]; tagsUpdatedAt?: string }
export interface LegacyQuickTag { id: string; name: string; color?: string | null; order?: number; createdAt: string; updatedAt: string }
export interface LegacyQuickManifest { items: LegacyQuickItem[]; tags?: LegacyQuickTag[] }

export interface MigrationResult { epoch: string; lakeCommit: string; quickNotesCommit: string; lake: LakeIndex; quickNotes: QuickNotesIndex; skippedTombstones: number; declarations: number }

export async function migrateLegacyManifest(
  remote: S3v3Remote,
  manifest: LegacyManifest,
  quickManifest: LegacyQuickManifest | null,
  opts: { deviceId?: string } = {},
): Promise<MigrationResult> {
  let skippedTombstones = 0;
  let declarations = 0;
  const notes: LakeNoteEntry[] = [];
  for (const n of manifest.notes) {
    if (n.deleted) { skippedTombstones++; continue; }
    let assetsHash: string | undefined;
    if (n.assets && n.assets.length > 0) {
      const built = buildAssetDeclaration(n.assets.map((a) => ({ filename: a.filename, size: a.size, hash: a.hash })));
      await remote.put(declarationKey("lake", n.id, built.declHash), new TextEncoder().encode(serializeDeclaration(built.declaration)), { gzip: true });
      assetsHash = built.declHash;
      declarations++;
    }
    notes.push({
      id: n.id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt,
      contentHash: n.contentHash, ...(n.kind ? { kind: n.kind } : {}), ...(n.icon !== undefined ? { icon: n.icon } : {}),
      isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, isConflict: !!n.isConflict,
      ...(n.trashedAt !== undefined ? { trashedAt: n.trashedAt } : {}), ...(n.deletedFromParentId !== undefined ? { deletedFromParentId: n.deletedFromParentId } : {}),
      ...(assetsHash ? { assetsHash } : {}),
    });
  }
  const folders = (manifest.folders ?? []).filter((f) => !f.deleted).map((f) => ({
    id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType, icon: f.icon, updatedAt: f.updatedAt,
    ...(f.trashedAt !== undefined ? { trashedAt: f.trashedAt } : {}), ...(f.deletedFromParentId !== undefined ? { deletedFromParentId: f.deletedFromParentId } : {}),
  }));
  const lake: LakeIndex = { v: 3, space: "lake", notes, folders };

  const quickItems: QuickNoteEntry[] = [];
  const quickTags: QuickNoteTagEntry[] = (quickManifest?.tags ?? []).map((t) => ({ id: t.id, name: t.name, ...(t.color !== undefined ? { color: t.color } : {}), order: t.order ?? 0, createdAt: t.createdAt, updatedAt: t.updatedAt }));
  if (quickManifest) {
    for (const q of quickManifest.items) {
      if (q.deleted) { skippedTombstones++; continue; }
      let assetsHash: string | undefined;
      if (q.assets && q.assets.length > 0) {
        const built = buildAssetDeclaration(q.assets.map((a) => ({ filename: a.filename, size: a.size, hash: a.hash, ...(a.mimeType !== undefined ? { mimeType: a.mimeType } : {}), ...(a.width !== undefined ? { width: a.width } : {}), ...(a.height !== undefined ? { height: a.height } : {}) })));
        await remote.put(declarationKey("quickNotes", q.id, built.declHash), new TextEncoder().encode(serializeDeclaration(built.declaration)), { gzip: true });
        assetsHash = built.declHash;
        declarations++;
      }
      quickItems.push({
        id: q.id, createdAt: q.createdAt, updatedAt: q.updatedAt, contentHash: q.contentHash, isConflict: !!q.isConflict,
        ...(assetsHash ? { assetsHash } : {}), ...(q.tagIds ? { tagIds: q.tagIds } : {}), ...(q.tagsUpdatedAt ? { tagsUpdatedAt: q.tagsUpdatedAt } : {}),
      });
    }
  }
  const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: quickItems, tags: quickTags };

  const lakeSerialized = serializeLakeIndex(lake);
  const quickSerialized = serializeQuickNotesIndex(quickNotes);
  const lakeCommit = indexHashOf(lakeSerialized);
  const quickNotesCommit = indexHashOf(quickSerialized);
  const epoch = randomUUID();
  await remote.put("meta/index/" + lakeCommit + ".json", new TextEncoder().encode(lakeSerialized), { gzip: true });
  await remote.put("quick-notes/meta/index/" + quickNotesCommit + ".json", new TextEncoder().encode(quickSerialized), { gzip: true });
  const pointer: S3v3Pointer = { v: 3, epoch, generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickNotesCommit }, createdAt: new Date().toISOString(), deviceId: opts.deviceId ?? "migration" };
  await remote.put("meta/pointer.json", new TextEncoder().encode(JSON.stringify(pointer)));
  return { epoch, lakeCommit, quickNotesCommit, lake, quickNotes, skippedTombstones, declarations };
}
