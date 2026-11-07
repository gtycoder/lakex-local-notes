/**
 * 标签存储统一（261107，上线前最后一批）：
 * 把桌面主库的「文档 ↔ 标签」关系（tag_links/tag_link_versions 中 target_kind='note'）
 * 一次性迁入小记库（quick-notes/metadata.sqlite3）—— 小记库已有完全同构的这两张表，
 * 迁移后标签域（目录 tags + 所有关系 + 版本）只有一个库归属；S3 wire 字段不变。
 *
 * 安全性：
 *  · SQLite ATTACH 跨库事务：复制 + 行数校验 + 迁移标记在**一个事务**里提交，失败整体回滚；
 *  · 幂等：迁移标记 tag_storage_meta(note_links_v2=done) 存在则跳过；
 *  · 回退：迁移失败时调用方继续用主库旧关系，不切换；主库旧表保留一个版本，可人工回滚；
 *  · 只读主库：ATTACH 后只 SELECT，不写主库。
 *
 * 本模块不 import electron，可在 vitest 里用临时 SQLite 文件直接测。
 */
import fs from "node:fs";
import Database from "better-sqlite3";

const MARKER_KEY = "note_links_v2";
const KIND = "note";

export interface TagStorageMigrationResult {
  ok: boolean;
  /** 本次是否真的搬了行（false = 已迁过/无数据）。 */
  moved: number;
  /** 迁移标记已存在（此前已完成）。 */
  already: boolean;
  reason?: string;
}

export interface TagStorageMigrationOptions {
  /** 桌面主库路径（workspace-default/metadata.sqlite3）。 */
  mainDbPath: string;
  /** 已打开的小记库（QuickNotesStore 的 db；必须同一连接，不能另开）。 */
  quickDb: Database.Database;
  /** 诊断日志（缺省静默）。 */
  log?: (message: string) => void;
}

function ensureMeta(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS tag_storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
}

function hasMarker(db: Database.Database): boolean {
  const row = db.prepare("SELECT value FROM tag_storage_meta WHERE key=?").get(MARKER_KEY) as { value?: string } | undefined;
  return row?.value === "done";
}

function countRows(db: Database.Database, table: string, scope: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM " + table + (scope ? " WHERE target_kind=?" : "")).get(...(scope ? [scope] : [])) as { n: number };
  return row.n;
}

/** 迁移文档标签关系 → 小记库；失败时返回 ok:false（调用方保持主库服务，不切换）。 */
export function migrateNoteTagLinksToQuickNotes(options: TagStorageMigrationOptions): TagStorageMigrationResult {
  const { mainDbPath, quickDb } = options;
  const log = options.log ?? (() => undefined);
  try {
    ensureMeta(quickDb);
    if (hasMarker(quickDb)) return { ok: true, moved: 0, already: true };
    if (!fs.existsSync(mainDbPath)) {
      // 没有主库（全新工作区/异常）：没有可迁移数据，视为完成，避免每次启动重试。
      quickDb.prepare("INSERT INTO tag_storage_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(MARKER_KEY, "done");
      return { ok: true, moved: 0, already: false };
    }
    quickDb.prepare("ATTACH DATABASE ? AS tag_main").run(mainDbPath);
    try {
      const mainLinks = countRows(quickDb, "tag_main.tag_links", KIND);
      const mainVersions = countRows(quickDb, "tag_main.tag_link_versions", KIND);
      const migrate = quickDb.transaction(() => {
        // 目标表是小记库自己的 tag_links/tag_link_versions（与主库同构）；只清 note 行，保留 quickNote 关系。
        quickDb.prepare("DELETE FROM tag_links WHERE target_kind=?").run(KIND);
        quickDb.prepare("DELETE FROM tag_link_versions WHERE target_kind=?").run(KIND);
        if (mainLinks > 0) {
          quickDb.prepare(
            "INSERT INTO tag_links(target_kind,target_id,tag_id,position) SELECT target_kind,target_id,tag_id,position FROM tag_main.tag_links WHERE target_kind=?",
          ).run(KIND);
        }
        if (mainVersions > 0) {
          quickDb.prepare(
            "INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) SELECT target_kind,target_id,links_updated_at FROM tag_main.tag_link_versions WHERE target_kind=?",
          ).run(KIND);
        }
        const copiedLinks = countRows(quickDb, "tag_links", KIND);
        const copiedVersions = countRows(quickDb, "tag_link_versions", KIND);
        if (copiedLinks !== mainLinks || copiedVersions !== mainVersions) {
          throw new Error("关系行数校验失败：links " + copiedLinks + "/" + mainLinks + "，versions " + copiedVersions + "/" + mainVersions);
        }
        quickDb.prepare("INSERT INTO tag_storage_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(MARKER_KEY, "done");
        return copiedLinks;
      });
      const moved = migrate();
      log("[tags] 文档标签关系已迁入小记库：" + moved + " 行（versions " + mainVersions + " 行）");
      return { ok: true, moved, already: false };
    } finally {
      try { quickDb.prepare("DETACH DATABASE tag_main").run(); } catch { /* 连接异常时忽略 */ }
    }
  } catch (error) {
    return { ok: false, moved: 0, already: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** 测试/诊断用：直接判断迁移标记。 */
export function isNoteTagLinksMigrated(quickDb: Database.Database): boolean {
  try {
    ensureMeta(quickDb);
    return hasMarker(quickDb);
  } catch { return false; }
}
