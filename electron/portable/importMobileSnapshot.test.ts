import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { PORTABLE_LIMIT_BYTES } from "../../src/core/portable/portableFormat.js";
import { writeStoreZip, type ZipEntrySource } from "./zipStore.js";
import { MOBILE_DB_NAME } from "./importMobileSnapshot.js";
import { importPortablePackageOnDesktop } from "./portableImport.js";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

const TS = "2026-11-22T02:00:00.000Z";
const BASELINE = { epoch: "e-m", generation: 5, lakeCommit: "lc", quickNotesCommit: "qc", lake: { notes: [] }, quickNotes: { quickNotes: [] } };

function bufEntry(name: string, data: string | Buffer): ZipEntrySource {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return { name, size: bytes.length, mtime: new Date(TS), read: async function* () { yield bytes; } };
}

/** 手机快照库替身（列 = 映射读取面；行覆盖 folder/note/墓碑/小记/标签域）。 */
function makeMobileDb(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(`
    CREATE TABLE folders (id TEXT PRIMARY KEY, title TEXT, parent_id TEXT, sort_order INTEGER, node_type TEXT, space TEXT, icon TEXT, updated_at TEXT, trashed_at TEXT, deleted_from_parent_id TEXT, is_dirty INTEGER, is_purged INTEGER, cloud_deleted INTEGER);
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, parent_id TEXT, sort_order INTEGER, updated_at TEXT, content_hash TEXT, is_dirty INTEGER, is_purged INTEGER, is_conflict INTEGER, deleted_at TEXT, doc_kind TEXT, cloud_deleted INTEGER, trashed_at TEXT, deleted_from_parent_id TEXT, restore_pending_at TEXT, is_locked INTEGER, locked_at TEXT, icon TEXT, text_cache TEXT);
    CREATE TABLE deleted_notes (id TEXT PRIMARY KEY, title TEXT, parent_id TEXT, sort_order INTEGER, updated_at TEXT, deleted_at TEXT, node_type TEXT, purged_at TEXT);
    CREATE TABLE quick_notes (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, preview_text TEXT, image_count INTEGER, content_hash TEXT, is_dirty INTEGER, is_conflict INTEGER, restore_pending_at TEXT, deleted_at TEXT, tags_updated_at TEXT, first_image TEXT, list_metadata_version INTEGER, cloud_deleted INTEGER, ready_to_sync INTEGER);
    CREATE TABLE quick_note_deleted (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, deleted_at TEXT, purged_at TEXT);
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE tag_links (target_kind TEXT, target_id TEXT, tag_id TEXT, position INTEGER);
    CREATE TABLE tag_link_versions (target_kind TEXT, target_id TEXT, links_updated_at TEXT);
    CREATE TABLE sync_v3_state (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO folders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("nb1", "个人笔记", null, 0, "notebook", null, "📒", TS, null, null, 0, 0, 0);
  db.prepare("INSERT INTO folders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("nb-d", "日记本", null, 1, "notebook", "diary", null, TS, null, null, 0, 0, 0);
  db.prepare("INSERT INTO notes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("n1", "文档1", "nb1", 0, TS, "h-n1", 0, 0, 0, null, "doc", 0, null, null, null, 1, TS, null, null);
  db.prepare("INSERT INTO deleted_notes VALUES(?,?,?,?,?,?,?,?)").run("t1", "删了", null, 0, TS, TS, "note", TS);
  db.prepare("INSERT INTO quick_notes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("q1", TS, TS, "速记", 1, "h-q1", 0, 0, null, null, "", null, 0, 0, 1);
  db.prepare("INSERT INTO quick_note_deleted VALUES(?,?,?,?,?)").run("q2", TS, TS, TS, TS);
  db.prepare("INSERT INTO tags VALUES(?,?,?,?,?)").run("tag1", "标签", 0, TS, TS);
  db.prepare("INSERT INTO tag_links VALUES(?,?,?,?)").run("note", "n1", "tag1", 0);
  db.prepare("INSERT INTO tag_link_versions VALUES(?,?,?)").run("note", "n1", TS);
  db.close();
}

async function makeMobilePackage(target: string, opts: { withBaseline?: boolean; corruptBaseline?: boolean } = {}): Promise<string> {
  fs.mkdirSync(target, { recursive: true });
  const tmp = tempDir("lakex-mob-db-");
  const dbFile = path.join(tmp, MOBILE_DB_NAME);
  makeMobileDb(dbFile);
  const manifest = JSON.stringify({
    format: "lakex-local-notes-portable",
    formatVersion: 2,
    appVersion: "1.5.5",
    exportedAt: TS,
    source: { platform: "mobile" },
    layout: "mobile-snapshot",
    limitBytes: PORTABLE_LIMIT_BYTES,
    counts: { notes: 1, folders: 2, quickNotes: 2, tags: 1, assets: 1, bytes: 10 },
    baseline: opts.withBaseline === false ? null : { epoch: "e-m", generation: 5, lakeCommit: "lc", quickNotesCommit: "qc" },
  }, null, 2);
  const entries: ZipEntrySource[] = [
    bufEntry("portable.json", manifest),
    { name: "mobile/databases/" + MOBILE_DB_NAME, size: fs.statSync(dbFile).size, mtime: new Date(), read: () => fs.createReadStream(dbFile) as unknown as AsyncIterable<Uint8Array> },
    bufEntry("mobile/files/notes/n1.lake", "<p>mob</p>"),
    bufEntry("mobile/files/note-assets/n1/a.png", "PNG"),
    bufEntry("mobile/files/draft-journal/d1.json", "{}"),
    bufEntry("mobile/files/history/n1/h1.body.gz", "HISTORY-MUST-NOT-COPY"),
    bufEntry("mobile/files/quick-notes/items/q1.qnote", JSON.stringify({
      version: 3,
      text: "速记",
      body: "<p>速记</p>",
      images: [{ id: "img1", filename: "a.png", mimeType: "image/png", width: 10, height: 20, size: 3, hash: "h-img" }],
    })),
  ];
  if (opts.corruptBaseline === true) {
    entries.push(bufEntry("mobile/files/sync-v3/baseline.json.gz.b64", Buffer.from("NOT-BASE64-GZIP")));
  } else if (opts.withBaseline !== false) {
    entries.push(bufEntry("mobile/files/sync-v3/baseline.json.gz.b64", gzipSync(Buffer.from(JSON.stringify(BASELINE))).toString("base64")));
  }
  const zipPath = path.join(target, "lakex-portable-mobile.zip.lln");
  await writeStoreZip(zipPath, entries);
  return zipPath;
}

function makeWorkspace(tmp: string): string {
  const ws = path.join(tmp, "workspace-default");
  fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
  fs.writeFileSync(path.join(ws, "notes", "old.lake"), "<p>old</p>");
  return ws;
}

describe("importMobileSnapshot（手机快照包 → 桌面，反向映射）", () => {
  it("全量导入：行映射 + 文件搬运 + baseline 反转 + 种子不带入 + 旧工作区隔离", async () => {
    const tmp = tempDir("lakex-mob-ws-");
    const zipPath = await makeMobilePackage(path.join(tmp, "out"));
    const ws = makeWorkspace(tmp);
    const result = importPortablePackageOnDesktop({ zipPath, workspaceRoot: ws, stagingParent: path.join(tmp, "portable-import") });
    expect(result.ok, "导入失败原因：" + result.reason).toBe(true);
    expect(result.requiresRestart).toBe(true);
    // 文件搬运：正文/资产/草稿进，history 不进
    expect(fs.readFileSync(path.join(ws, "notes", "n1.lake"), "utf8")).toBe("<p>mob</p>");
    expect(fs.readFileSync(path.join(ws, "note-assets", "n1", "a.png"), "utf8")).toBe("PNG");
    expect(fs.existsSync(path.join(ws, "draft-journal", "d1.json"))).toBe(true);
    expect(fs.existsSync(path.join(ws, "history"))).toBe(false);
    // baseline 反转：b64(gz) → desktop baseline.json.gz（解开一致）
    expect(JSON.parse(gunzipSync(fs.readFileSync(path.join(ws, "sync-v3", "baseline.json.gz"))).toString("utf8"))).toEqual(BASELINE);
    // 主库：容器 + note（新树 id / note_file_id）+ 墓碑；种子（欢迎笔记/个人笔记）不带入
    const main = new Database(path.join(ws, "metadata.sqlite3"), { readonly: true });
    try {
      const tree = main.prepare("SELECT id,node_type,note_file_id,space,trashed_at FROM tree_nodes ORDER BY rowid").all() as Array<Record<string, unknown>>;
      // 回收站容器（migrate 固定）+ 两个 notebook + 文档节点
      expect(tree.some((r) => r.id === "notebook-trash")).toBe(true);
      expect(tree.some((r) => r.id === "nb1" && r.node_type === "notebook")).toBe(true);
      expect(tree.some((r) => r.id === "nb-d" && r.space === "diary")).toBe(true);
      const noteNode = tree.find((r) => r.note_file_id === "n1")!;
      expect(noteNode.node_type).toBe("note");
      expect(noteNode.id).toBe("n1"); // 261124 A9：tree id == note id 不变量（旧「重新生成」= 文档父断链根因）
      expect(tree.some((r) => r.id === "welcome-note")).toBe(false);
      expect(tree.some((r) => r.id === "notebook-personal")).toBe(false);
      expect((main.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n).toBe(1);
      const note = main.prepare("SELECT id,kind,is_locked FROM notes WHERE id='n1'").get() as Record<string, unknown>;
      expect(note).toMatchObject({ id: "n1", kind: "doc", is_locked: 1 });
      const tomb = main.prepare("SELECT id,node_type,purged_at FROM deleted_notes WHERE id='t1'").get() as Record<string, unknown>;
      expect(tomb).toMatchObject({ id: "t1", node_type: "note", purged_at: TS });
    } finally { main.close(); }
    // 小记库：活跃 + 账本 + 标签域
    const quick = new Database(path.join(ws, "quick-notes", "metadata.sqlite3"), { readonly: true });
    try {
      expect((quick.prepare("SELECT id FROM quick_notes").all() as Array<{ id: string }>).map((r) => r.id)).toEqual(["q1"]);
      // quick_note_assets 从随包 .qnote 正文资源清单重建（width/height 不丢）
      expect(quick.prepare("SELECT id,quick_note_id,filename,mime_type,width,height,size,content_hash FROM quick_note_assets").all()).toEqual([
        { id: "img1", quick_note_id: "q1", filename: "a.png", mime_type: "image/png", width: 10, height: 20, size: 3, content_hash: "h-img" },
      ]);
      expect((quick.prepare("SELECT id,purged_at FROM quick_note_deleted").all() as Array<Record<string, unknown>>))
        .toEqual([{ id: "q2", purged_at: TS }]);
      expect((quick.prepare("SELECT name FROM tags").all() as Array<{ name: string }>).map((r) => r.name)).toEqual(["标签"]);
      expect((quick.prepare("SELECT COUNT(*) AS n FROM tag_links").get() as { n: number }).n).toBe(1);
    } finally { quick.close(); }
    // 旧工作区隔离保留
    expect(fs.readFileSync(path.join(result.quarantinePath!, "notes", "old.lake"), "utf8")).toBe("<p>old</p>");
  });

  it("261123：纯离线手机快照（无基线文件）合成「合并底稿」基线", async () => {
    const tmp = tempDir("lakex-mob-ws-");
    const zipPath = await makeMobilePackage(path.join(tmp, "out"), { withBaseline: false });
    const ws = makeWorkspace(tmp);
    const result = importPortablePackageOnDesktop({ zipPath, workspaceRoot: ws, stagingParent: path.join(tmp, "portable-import") });
    expect(result.ok, "导入失败原因：" + result.reason).toBe(true);
    // 修复（docs/PORTABLE-TRANSFER.md §3.1）：从映射后的桌面两库合成合并底稿基线（bootstrap）。
    const gz = path.join(ws, "sync-v3", "baseline.json.gz");
    expect(fs.existsSync(gz)).toBe(true);
    const parsed = JSON.parse(gunzipSync(fs.readFileSync(gz)).toString("utf8")) as { bootstrap?: boolean; epoch: string; lake: { notes: unknown[] } };
    expect(parsed.bootstrap).toBe(true);
    expect(parsed.epoch).toBe("");
    expect(fs.existsSync(path.join(ws, "sync-v3", "baseline.json"))).toBe(false);
  });

  it("261201 P1-A：坏基线不阻断迁移——降级合成合并底稿 + 明示警告（不落拉全轮）", async () => {
    const tmp = tempDir("lakex-mob-ws-");
    const zipPath = await makeMobilePackage(path.join(tmp, "out"), { corruptBaseline: true });
    const ws = makeWorkspace(tmp);
    const result = importPortablePackageOnDesktop({ zipPath, workspaceRoot: ws, stagingParent: path.join(tmp, "portable-import") });
    expect(result.ok, "导入失败原因：" + result.reason).toBe(true);
    // 坏基线不再「按无基线导入」：从映射后的桌面两库合成合并底稿（与纯离线包同口径）。
    const gz = path.join(ws, "sync-v3", "baseline.json.gz");
    expect(fs.existsSync(gz)).toBe(true);
    const parsed = JSON.parse(gunzipSync(fs.readFileSync(gz)).toString("utf8")) as { bootstrap?: boolean; epoch: string };
    expect(parsed.bootstrap).toBe(true);
    expect(parsed.epoch).toBe("");
    expect(result.message).toContain("合成合并底稿");
    expect(result.message).not.toContain("先拉取云端再增量");
  });
});
