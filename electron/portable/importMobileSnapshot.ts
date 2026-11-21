/**
 * mobile-snapshot 包的桌面导入（261122 大统一；docs/PORTABLE-TRANSFER.md §3 反向映射行）。
 *
 * 流程：解包（手机库 + mobile/files 白名单）→ baseline 反转（b64(gz(json)) → desktop baseline.json.gz）
 * → 行映射（mobileToDesktopMapping）→ 建桌面两库（复用真 schema：SchemaInit / migrateQuickNotesSchema；
 * 种子笔记本与欢迎笔记不带入，seed_initialized 置位后不复活）→ 换位（replaceWorkspaceWith）。
 * 失败原则与 desktop-workspace 导入一致：解包/映射阶段不碰本机数据；换位失败回滚；staging 无条件清理。
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { SchemaInit } from "../schemaInit.js";
import { migrateQuickNotesSchema } from "../quickNotes.js";
import { QuickNoteTagsStore } from "../quickNoteTagsStore.js";
import { QuickNoteTagLinksStore } from "../quickNoteTagLinksStore.js";
import { TRASH_NOTEBOOK_ID } from "../../src/core/syncDecisions.js";
import { PORTABLE_BODY_DIRS } from "../../src/core/portable/portableRows.js";
import { extractEntryToFile, readEntryData } from "./zipRead.js";
import { mapMobileToDesktop, type MappedDesktopFromMobile, type DesktopQuickNoteDeletedRow } from "./mobileToDesktopMapping.js";
import { replaceWorkspaceWith } from "../workspaceBackup.js";
import type { PortableImportOptions, PortableImportResult, PortablePackageInspection } from "./portableImport.js";

/** 与 Kotlin PortablePackagePlugin.MOBILE_DB_FILE 同值（测试钉住，改名两处一起动）。 */
export const MOBILE_DB_NAME = "lakex-local-notes-mobileSQLite.db";
const MOBILE_DB_PREFIX = "mobile/databases/";
const MOBILE_FILES_PREFIX = "mobile/files/";
/** 移动基线 = base64(gz(json))（AGENTS §4：移动 = sync-v3/baseline.json.gz.b64）。 */
const BASELINE_B64_REL = MOBILE_FILES_PREFIX + "sync-v3/baseline.json.gz.b64";

/** files 白名单（history/ 等仅本机数据不搬；quick-notes 的三个子目录取两段前缀）。 */
const COPY_PREFIXES: string[] = [
  ...PORTABLE_BODY_DIRS,
  "note-assets",
  "quick-notes/items",
  "quick-notes/assets",
  "quick-notes/staging",
  "draft-journal",
  "materials",
];

export function importMobileSnapshotPackageOnDesktop(options: PortableImportOptions, inspection: PortablePackageInspection): PortableImportResult {
  const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
  const stagingRoot = path.join(options.stagingParent, "import-" + stamp);
  try {
    fs.mkdirSync(stagingRoot, { recursive: true });
    const entries = inspection.directory.entries;

    // 1) 手机主库（+ wal/shm/journal）→ staging/mobile-db/。
    const mainDbEntry = entries.find((entry) => entry.name === MOBILE_DB_PREFIX + MOBILE_DB_NAME);
    if (!mainDbEntry) throw new Error("包内缺少手机数据库（" + MOBILE_DB_PREFIX + MOBILE_DB_NAME + "）");
    const mobileDbDir = path.join(stagingRoot, "mobile-db");
    for (const entry of entries) {
      if (!entry.name.startsWith(MOBILE_DB_PREFIX)) continue;
      extractEntryToFile(options.zipPath, entry, path.join(mobileDbDir, path.basename(entry.name)));
    }

    // 2) mobile/files 白名单 → staging/workspace/…（跳过 history/sync-v3 等仅本机目录）。
    const stagingWorkspace = path.join(stagingRoot, "workspace");
    let filesDone = 0;
    const copyEntries = entries.filter((entry) => {
      if (!entry.name.startsWith(MOBILE_FILES_PREFIX)) return false;
      const rel = entry.name.slice(MOBILE_FILES_PREFIX.length);
      return COPY_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix + "/"));
    });
    for (const entry of copyEntries) {
      extractEntryToFile(options.zipPath, entry, path.join(stagingWorkspace, entry.name.slice(MOBILE_FILES_PREFIX.length)));
      filesDone += 1;
      options.onProgress?.(filesDone, copyEntries.length);
    }

    // 3) baseline 反转：b64(gz(json)) → desktop sync-v3/baseline.json.gz（同一份 gz 字节）；
    //    解开自证可解析，坏基线直接失败（不能把坏字节当基线写进工作区）。
    const baselineEntry = entries.find((entry) => entry.name === BASELINE_B64_REL);
    if (baselineEntry) {
      const gz = Buffer.from(readEntryData(options.zipPath, baselineEntry).toString("utf8").trim(), "base64");
      JSON.parse(gunzipSync(gz).toString("utf8"));
      fs.mkdirSync(path.join(stagingWorkspace, "sync-v3"), { recursive: true });
      fs.writeFileSync(path.join(stagingWorkspace, "sync-v3", "baseline.json.gz"), gz);
    }

    // 4) 读手机行 → 映射成桌面行（纯逻辑；表缺失按空集处理）。
    const mobileDb = new Database(path.join(mobileDbDir, MOBILE_DB_NAME), { readonly: true });
    let mapped: MappedDesktopFromMobile;
    try {
      const rows = (table: string): Array<Record<string, unknown>> => {
        const exists = mobileDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) as { name?: string } | undefined;
        if (!exists?.name) return [];
        return mobileDb.prepare("SELECT * FROM " + table).all() as Array<Record<string, unknown>>;
      };
      mapped = mapMobileToDesktop({
        folders: rows("folders"),
        notes: rows("notes"),
        deletedNotes: rows("deleted_notes"),
        quickNotes: rows("quick_notes"),
        quickNoteDeleted: rows("quick_note_deleted"),
        tags: rows("tags"),
        tagLinks: rows("tag_links"),
        tagLinkVersions: rows("tag_link_versions"),
      });
    } finally {
      mobileDb.close();
    }

    // 5) 建桌面两库（真 schema）并灌行。种子（欢迎笔记/种子笔记本）不带入：
    //    migrate 置位 seed_initialized ⇒ 以后启动不会复活种子笔记本（AGENTS §3#7 语义）。
    fs.mkdirSync(stagingWorkspace, { recursive: true });
    const mainDb = new Database(path.join(stagingWorkspace, "metadata.sqlite3"));
    try {
      new SchemaInit({
        db: mainDb,
        workspaceId: "default",
        trashNotebookId: TRASH_NOTEBOOK_ID,
        defaultNotebookId: "notebook-personal",
        nextSortOrder: () => 0,
        atomicWrite: () => { /* 播种正文不落盘（欢迎笔记整体不带入） */ },
        notePathFor: (id) => path.join(stagingWorkspace, "notes", id + ".lake"),
      }).migrate();
      mainDb.exec("DELETE FROM notes");
      mainDb.prepare("DELETE FROM tree_nodes WHERE id <> ?").run(TRASH_NOTEBOOK_ID);
      insertDesktopMainRows(mainDb, mapped);
    } finally {
      mainDb.close();
    }
    fs.mkdirSync(path.join(stagingWorkspace, "quick-notes"), { recursive: true });
    const quickDb = new Database(path.join(stagingWorkspace, "quick-notes", "metadata.sqlite3"));
    try {
      migrateQuickNotesSchema(quickDb);
      // 标签域（tags/tag_links/tag_link_versions）由各自的 store 建表（quickNotes/schema 只建小记表）。
      new QuickNoteTagsStore(quickDb);
      new QuickNoteTagLinksStore(quickDb);
      insertDesktopQuickRows(quickDb, mapped);
    } finally {
      quickDb.close();
    }

    // 6) 换位（隔离/回滚统一走 replaceWorkspaceWith；staging 与工作区需同卷）。
    const swapped = replaceWorkspaceWith({
      workspaceRoot: options.workspaceRoot,
      quickNotesRestored: true,
      describe: "手机快照包已导入（主库 + 小记库）",
      materialize: (freshRoot) => { fs.renameSync(stagingWorkspace, freshRoot); },
    });
    if (!swapped.ok) {
      return { ok: false, reason: "换位失败（staging 与工作区需同磁盘）：" + (swapped.reason ?? ""), rolledBack: swapped.rolledBack };
    }
    return {
      ok: true,
      quarantinePath: swapped.quarantinePath,
      quickNotesRestored: true,
      requiresRestart: true,
      message: swapped.message,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* 尽力 */ }
  }
}

/** 主库灌行（单事务：tree_nodes / notes / deleted_notes）。 */
function insertDesktopMainRows(db: Database.Database, mapped: MappedDesktopFromMobile): void {
  const insertTree = db.prepare(
    "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,is_conflict,icon,space,trashed_at,deleted_from_parent_id,is_purged,is_dirty,cloud_deleted)"
    + " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const insertNote = db.prepare(
    "INSERT INTO notes(id,title,parent_id,sort_order,updated_at,is_conflict,deleted_at,kind,is_locked,locked_at,restore_pending_at,trashed_at,deleted_from_parent_id,is_purged,is_dirty,cloud_deleted)"
    + " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const insertTomb = db.prepare(
    "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,node_type,purged_at) VALUES(?,?,?,?,?,?,?,?)",
  );
  db.transaction(() => {
    for (const row of mapped.treeNodes) {
      insertTree.run(row.id, row.workspace_id, row.parent_id, row.node_type, row.title, row.note_file_id, row.sort_order,
        row.created_at, row.updated_at, row.deleted_at, row.is_conflict, row.icon, row.space, row.trashed_at,
        row.deleted_from_parent_id, row.is_purged, row.is_dirty, row.cloud_deleted);
    }
    for (const row of mapped.notes) {
      insertNote.run(row.id, row.title, row.parent_id, row.sort_order, row.updated_at, row.is_conflict, row.deleted_at,
        row.kind, row.is_locked, row.locked_at, row.restore_pending_at, row.trashed_at, row.deleted_from_parent_id,
        row.is_purged, row.is_dirty, row.cloud_deleted);
    }
    for (const row of mapped.tombstones) {
      insertTomb.run(row.id, row.title, row.parent_id, row.sort_order, row.updated_at, row.deleted_at, row.node_type, row.purged_at);
    }
  })();
}

/** 小记库灌行（单事务：quick_notes / quick_note_deleted / tags / tag_links / tag_link_versions）。 */
function insertDesktopQuickRows(db: Database.Database, mapped: MappedDesktopFromMobile): void {
  const insertQuick = db.prepare(
    "INSERT INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,cloud_deleted) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  const insertLedger = db.prepare(
    "INSERT INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync,purged_at,cloud_deleted) VALUES(?,?,?,?,?,?,?,?)",
  );
  const insertTag = db.prepare("INSERT INTO tags(id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?)");
  const insertLink = db.prepare("INSERT INTO tag_links(target_kind,target_id,tag_id,position) VALUES(?,?,?,?)");
  const insertVersion = db.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES(?,?,?)");
  db.transaction(() => {
    for (const row of mapped.quickNotes) {
      insertQuick.run(row.id, row.created_at, row.updated_at, row.preview_text, row.image_count, row.content_hash,
        row.is_dirty, row.is_conflict, row.cloud_deleted);
    }
    for (const row of mapped.quickNoteDeleted as DesktopQuickNoteDeletedRow[]) {
      insertLedger.run(row.id, row.created_at, row.updated_at, row.deleted_at, row.conversion_target_note_id,
        row.ready_to_sync, row.purged_at, row.cloud_deleted);
    }
    for (const row of mapped.tags) {
      insertTag.run(row.id, row.name, row.sort_order, row.created_at, row.updated_at);
    }
    for (const row of mapped.tagLinks) {
      insertLink.run(row.target_kind, row.target_id, row.tag_id, row.position);
    }
    for (const row of mapped.tagLinkVersions) {
      insertVersion.run(row.target_kind, row.target_id, row.links_updated_at);
    }
  })();
}
