import { assetKey, declarationKey, lakeBodyKey, lakePurgePrefixes, quickNoteAssetKey, quickNoteBodyKey, quickNotePurgePrefixes } from "./s3v3Keys.js";
import type { LakeIndex, QuickNotesIndex } from "./s3v3Index.js";

/** 待删键规划（纯逻辑）：按旧/新世界差集生成；执行时仍须过 §5.2 门禁。 */

export interface PlannedDelete {
  kind: "body" | "asset" | "declaration" | "purge-prefix" | "index" | "quick-note-body" | "quick-note-asset" | "quick-note-declaration" | "quick-note-purge-prefix";
  key: string;
  noteId?: string;
  filename?: string;
  oldHash?: string;
  oldDeclHash?: string;
  space?: "lake" | "quickNotes";
}

export interface LakeDeclMap {
  /** noteId → { declHash, filenames } */
  get(noteId: string): { declHash: string; filenames: string[] } | undefined;
}

export interface LakeGcInput {
  previous: LakeIndex | null;
  next: LakeIndex;
  previousDecls: Map<string, { declHash: string; filenames: string[] }>;
  nextDecls: Map<string, { declHash: string; filenames: string[] }>;
  previousCommit: string | null;
  nextCommit: string;
}

export function planLakeDeletes(input: LakeGcInput): PlannedDelete[] {
  const out: PlannedDelete[] = [];
  const prev = new Map((input.previous?.notes ?? []).map((n) => [n.id, n]));
  const next = new Map(input.next.notes.map((n) => [n.id, n]));
  for (const [id, p] of prev) {
    const n = next.get(id);
    if (!n) {
      for (const prefix of lakePurgePrefixes(id)) out.push({ kind: "purge-prefix", key: prefix, noteId: id });
      continue;
    }
    if (p.contentHash !== n.contentHash) out.push({ kind: "body", key: lakeBodyKey(id, p.contentHash), noteId: id, oldHash: p.contentHash });
    const pd = input.previousDecls.get(id);
    const nd = input.nextDecls.get(id);
    if (pd && (!nd || nd.declHash !== pd.declHash)) {
      out.push({ kind: "declaration", key: declarationKey("lake", id, pd.declHash), noteId: id, oldDeclHash: pd.declHash });
    }
    if (pd) {
      const nextFiles = new Set(nd?.filenames ?? []);
      for (const filename of pd.filenames) {
        if (!nextFiles.has(filename)) out.push({ kind: "asset", key: assetKey(id, filename), noteId: id, filename });
      }
    }
  }
  if (input.previousCommit && input.previousCommit !== input.nextCommit) {
    out.push({ kind: "index", key: `meta/index/${input.previousCommit}.json`, space: "lake", oldHash: input.previousCommit });
  }
  return out;
}

export interface QuickNotesGcInput {
  previous: QuickNotesIndex | null;
  next: QuickNotesIndex;
  previousDecls: Map<string, { declHash: string; filenames: string[] }>;
  nextDecls: Map<string, { declHash: string; filenames: string[] }>;
  previousCommit: string | null;
  nextCommit: string;
}

export function planQuickNotesDeletes(input: QuickNotesGcInput): PlannedDelete[] {
  const out: PlannedDelete[] = [];
  const prev = new Map((input.previous?.items ?? []).map((n) => [n.id, n]));
  const next = new Map(input.next.items.map((n) => [n.id, n]));
  for (const [id, p] of prev) {
    const n = next.get(id);
    if (!n) {
      out.push({ kind: "quick-note-body", key: quickNoteBodyKey(p.contentHash), noteId: id, oldHash: p.contentHash });
      for (const prefix of quickNotePurgePrefixes(id)) out.push({ kind: "quick-note-purge-prefix", key: prefix, noteId: id });
      continue;
    }
    if (p.contentHash !== n.contentHash) out.push({ kind: "quick-note-body", key: quickNoteBodyKey(p.contentHash), noteId: id, oldHash: p.contentHash });
    const pd = input.previousDecls.get(id);
    const nd = input.nextDecls.get(id);
    if (pd && (!nd || nd.declHash !== pd.declHash)) {
      out.push({ kind: "quick-note-declaration", key: declarationKey("quickNotes", id, pd.declHash), noteId: id, oldDeclHash: pd.declHash });
    }
    if (pd) {
      const nextFiles = new Set(nd?.filenames ?? []);
      for (const filename of pd.filenames) {
        if (!nextFiles.has(filename)) out.push({ kind: "quick-note-asset", key: quickNoteAssetKey(id, filename), noteId: id, filename });
      }
    }
  }
  if (input.previousCommit && input.previousCommit !== input.nextCommit) {
    out.push({ kind: "index", key: `quick-notes/meta/index/${input.previousCommit}.json`, space: "quickNotes", oldHash: input.previousCommit });
  }
  return out;
}

