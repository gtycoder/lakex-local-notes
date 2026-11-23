/**
 * 桌面工作区 → 「合并底稿」基线（261123，docs/PORTABLE-TRANSFER.md §3.1）。
 *
 * 便携包纯离线（导出端从未配 S3）导入桌面时合成：条目来自包内两库行 + 内容哈希清单（导出时刻快照），
 * 谱系留空打 bootstrap 标记；配好 S3 后首同步走**三方合并**（增量、不误删），不是拉全轮。
 * 手机快照布局（mobile-snapshot）导入桌面时同样从**映射后**的桌面两库合成 ⇒ 两条路共用本文件。
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { buildBootstrapBaseline } from "../../src/core/portable/bootstrapBaseline.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry } from "../../src/core/s3v3/protocol/s3v3Index.js";
import type { DeviceBaseline } from "../../src/core/s3v3DeviceStore.js";

type Row = Record<string, unknown>;

/** 缺表/坏表 = 空集（个别表缺失不毁整次合成；与 importMobileSnapshot 的 rows() 同口径）。 */
function safeRows(db: Database.Database, table: string): Row[] {
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name?: string } | undefined;
    if (!exists?.name) return [];
    return db.prepare("SELECT * FROM " + table).all() as Row[];
  } catch {
    return [];
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const bool01 = (v: unknown): boolean => v === 1 || v === true || v === "1";

/** 纯离线包的 contents 哈希清单（portableExport.buildOfflineHashes 产物）解析。 */
export function parseOfflineHashMaps(raw: string): { notes: Map<string, string>; quickNotes: Map<string, string> } {
  const toMap = (input: unknown): Map<string, string> => {
    const map = new Map<string, string>();
    if (input && typeof input === "object") {
      for (const [id, hash] of Object.entries(input as Record<string, unknown>)) {
        if (typeof hash === "string" && hash.length > 0) map.set(id, hash);
      }
    }
    return map;
  };
  const parsed = JSON.parse(raw) as { notes?: unknown; quickNotes?: unknown };
  return { notes: toMap(parsed.notes), quickNotes: toMap(parsed.quickNotes) };
}

/**
 * 读桌面两库行 → 合并底稿基线。contentHash 优先取包内内容哈希清单（与导出端发布值一致），
 * 缺席才回落行内 content_hash；坏 hash 条目由构建器统一丢弃（不毁整包）。
 */
export function buildBootstrapBaselineFromDesktopWorkspace(
  workspaceRoot: string,
  hashMaps?: { notes: Map<string, string>; quickNotes: Map<string, string> },
): DeviceBaseline {
  const mainDbPath = path.join(workspaceRoot, "metadata.sqlite3");
  const quickDbPath = path.join(workspaceRoot, "quick-notes", "metadata.sqlite3");
  const notes: LakeNoteEntry[] = [];
  const folders: LakeFolderEntry[] = [];
  const quickItems: QuickNoteEntry[] = [];
  const quickTags: QuickNoteTagEntry[] = [];
  const quickPurged: string[] = [];
  const noteTagIds = new Map<string, string[]>();
  const noteTagVersion = new Map<string, string>();
  const quickTagIds = new Map<string, string[]>();
  const quickTagVersion = new Map<string, string>();

  const main = new Database(mainDbPath, { readonly: true });
  try {
    for (const row of safeRows(main, "tree_nodes")) {
      const nodeType = str(row.node_type);
      const purged = bool01(row.is_purged);
      if (purged) continue;
      if (nodeType === "notebook" || nodeType === "group") {
        folders.push({
          id: str(row.id),
          title: str(row.title),
          parentId: strOrNull(row.parent_id),
          sortOrder: num(row.sort_order),
          nodeType: nodeType === "group" ? "group" : "notebook",
          icon: strOrNull(row.icon),
          updatedAt: str(row.updated_at),
          space: strOrNull(row.space) as LakeFolderEntry["space"],
          trashedAt: strOrNull(row.trashed_at),
          deletedFromParentId: strOrNull(row.deleted_from_parent_id),
        });
      }
    }
    for (const row of safeRows(main, "notes")) {
      if (bool01(row.is_purged)) continue;
      const id = str(row.id);
      if (!id) continue;
      notes.push({
        id,
        title: str(row.title) || "未命名",
        parentId: strOrNull(row.parent_id),
        sortOrder: num(row.sort_order),
        updatedAt: str(row.updated_at),
        contentHash: hashMaps?.notes.get(id) ?? str(row.content_hash),
        kind: str(row.kind) || "doc",
        icon: strOrNull(row.icon),
        isLocked: bool01(row.is_locked),
        lockedAt: strOrNull(row.locked_at),
        isConflict: bool01(row.is_conflict),
        trashedAt: strOrNull(row.trashed_at),
        deletedFromParentId: strOrNull(row.deleted_from_parent_id),
      });
    }
  } finally {
    main.close();
  }

  if (fs.existsSync(quickDbPath)) {
    const quick = new Database(quickDbPath, { readonly: true });
    try {
      for (const row of safeRows(quick, "quick_notes")) {
        const id = str(row.id);
        if (!id) continue;
        quickItems.push({
          id,
          createdAt: str(row.created_at),
          updatedAt: str(row.updated_at),
          contentHash: hashMaps?.quickNotes.get(id) ?? str(row.content_hash),
          isConflict: bool01(row.is_conflict),
        });
        const tv = str(row.tags_updated_at);
        if (tv) quickTagVersion.set("quickNote:" + id, tv);
      }
      for (const row of safeRows(quick, "quick_note_deleted")) {
        if (row.purged_at != null && str(row.id)) quickPurged.push(str(row.id));
      }
      for (const row of safeRows(quick, "tags")) {
        quickTags.push({ id: str(row.id), name: str(row.name), createdAt: str(row.created_at), updatedAt: str(row.updated_at) });
      }
      for (const row of safeRows(quick, "tag_links")) {
        const kind = str(row.target_kind) === "note" ? "note" : "quickNote";
        const key = kind + ":" + str(row.target_id);
        const list = kind === "note" ? noteTagIds.get(key) ?? [] : quickTagIds.get(key) ?? [];
        if (!list.includes(str(row.tag_id))) list.push(str(row.tag_id));
        if (kind === "note") noteTagIds.set(key, list); else quickTagIds.set(key, list);
      }
      for (const row of safeRows(quick, "tag_link_versions")) {
        const key = (str(row.target_kind) === "note" ? "note" : "quickNote") + ":" + str(row.target_id);
        const map = key.startsWith("note:") ? noteTagVersion : quickTagVersion;
        map.set(key, str(row.links_updated_at));
      }
    } finally {
      quick.close();
    }
  }

  for (const note of notes) {
    const key = "note:" + note.id;
    const ids = noteTagIds.get(key);
    if (ids && ids.length > 0) note.tagIds = [...ids].toSorted();
    const tv = noteTagVersion.get(key);
    if (tv) note.tagsUpdatedAt = tv;
  }
  for (const item of quickItems) {
    const key = "quickNote:" + item.id;
    const ids = quickTagIds.get(key);
    if (ids && ids.length > 0) item.tagIds = [...ids].toSorted();
    const tv = quickTagVersion.get(key);
    if (tv) item.tagsUpdatedAt = tv;
  }
  return buildBootstrapBaseline({ notes, folders, quickItems, quickTags, quickPurged });
}

/** 合成基线写进 staging 工作区（gzip，与云端基线同形同落点；bootstrap 标记在 JSON 里）。 */
export function writeBootstrapBaselineGz(workspaceRoot: string, baseline: DeviceBaseline): void {
  const dir = path.join(workspaceRoot, "sync-v3");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "baseline.json.gz"), gzipSync(Buffer.from(JSON.stringify(baseline), "utf8")));
}
