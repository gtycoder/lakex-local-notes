import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { isNoteTagLinksMigrated, migrateNoteTagLinksToQuickNotes } from "./tagStorage.js";

const dirs: string[] = [];
function tempDir(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), "lake-tag-storage-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 尽力 */ } } });

function createDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE tag_links (target_kind TEXT NOT NULL, target_id TEXT NOT NULL, tag_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(target_kind, target_id, tag_id));
    CREATE TABLE tag_link_versions (target_kind TEXT NOT NULL, target_id TEXT NOT NULL, links_updated_at TEXT NOT NULL, PRIMARY KEY(target_kind, target_id));
  `);
  return db;
}

function rows(db: Database.Database, sql: string, ...args: unknown[]): unknown[] {
  return db.prepare(sql).all(...args);
}

describe("标签存储统一：主库 note 关系 → 小记库", () => {
  it("一次性迁移 note 行，保留 quickNote 行，重复执行为 no-op", () => {
    const dir = tempDir();
    const mainPath = path.join(dir, "main", "metadata.sqlite3");
    const quickPath = path.join(dir, "quick-notes", "metadata.sqlite3");
    const main = createDb(mainPath);
    main.prepare("INSERT INTO tag_links VALUES('note','n1','t1',0)").run();
    main.prepare("INSERT INTO tag_links VALUES('note','n1','t2',1)").run();
    main.prepare("INSERT INTO tag_link_versions VALUES('note','n1','2026-01-01T00:00:00.000Z')").run();
    main.prepare("INSERT INTO tag_links VALUES('quickNote','q1','t1',0)").run();
    main.close();

    const quick = createDb(quickPath);
    quick.prepare("INSERT INTO tag_links VALUES('quickNote','q1','t1',0)").run();
    quick.prepare("INSERT INTO tag_link_versions VALUES('quickNote','q1','2026-01-01T00:00:00.000Z')").run();

    const first = migrateNoteTagLinksToQuickNotes({ mainDbPath: mainPath, quickDb: quick });
    expect(first.ok).toBe(true);
    expect(first.already).toBe(false);
    expect(first.moved).toBe(2);
    expect(isNoteTagLinksMigrated(quick)).toBe(true);
    expect(rows(quick, "SELECT target_id, tag_id, position FROM tag_links WHERE target_kind='note' ORDER BY position").length).toBe(2);
    expect(rows(quick, "SELECT target_id FROM tag_link_versions WHERE target_kind='note'").length).toBe(1);
    // quickNote 关系不被删
    expect(rows(quick, "SELECT target_id FROM tag_links WHERE target_kind='quickNote'").length).toBe(1);

    const second = migrateNoteTagLinksToQuickNotes({ mainDbPath: mainPath, quickDb: quick });
    expect(second.ok).toBe(true);
    expect(second.already).toBe(true);
    expect(second.moved).toBe(0);
    quick.close();
  });

  it("主库没有关系表时返回失败且不写迁移标记（调用方保持旧服务）", () => {
    const dir = tempDir();
    const mainPath = path.join(dir, "main", "metadata.sqlite3");
    fs.mkdirSync(path.dirname(mainPath), { recursive: true });
    const main = new Database(mainPath);
    main.exec("CREATE TABLE notes(id TEXT PRIMARY KEY)");
    main.close();
    const quick = createDb(path.join(dir, "quick-notes", "metadata.sqlite3"));
    const result = migrateNoteTagLinksToQuickNotes({ mainDbPath: mainPath, quickDb: quick });
    expect(result.ok).toBe(false);
    expect(isNoteTagLinksMigrated(quick)).toBe(false);
    quick.close();
  });

  it("主库不存在（全新工作区）时视为完成，避免每次启动重试", () => {
    const dir = tempDir();
    const quick = createDb(path.join(dir, "quick-notes", "metadata.sqlite3"));
    const result = migrateNoteTagLinksToQuickNotes({ mainDbPath: path.join(dir, "main", "metadata.sqlite3"), quickDb: quick });
    expect(result.ok).toBe(true);
    expect(result.moved).toBe(0);
    expect(isNoteTagLinksMigrated(quick)).toBe(true);
    quick.close();
  });
});
