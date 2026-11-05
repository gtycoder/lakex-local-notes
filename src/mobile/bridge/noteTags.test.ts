/**
 * 261105 晚：移动桥 setNoteTags / listNoteTagLinks（目录行「打标签…」的数据层）。
 * 移动是单库：直接写 tag_links(kind='note') + bump tag_link_versions（关系 LWW 才能传播）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {}, loadAssetBytesFs: async () => null, removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [], listQuickNoteAssetKeysFs: async () => [], listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {}, removeQuickNoteAssetsDirFs: async () => {},
}));

const mocks = vi.hoisted(() => ({ ensureDb: vi.fn() }));

vi.mock("./context", () => ({
  ensureDb: mocks.ensureDb,
  runWrite: (_op: string, fn: () => unknown) => fn(),
  runMaintenance: (_op: string, fn: () => unknown) => fn(),
  runPriority: (_op: string, fn: () => unknown) => fn(),
  assets: new Map(),
  dbPort: {},
  assertS3Credentials: () => undefined,
  readSyncSettings: () => ({}),
}));
vi.mock("./sync", () => ({
  downloadDeclaredAssetsFor: vi.fn(),
  ensureAssetsNative: vi.fn(async () => ({ downloaded: 0, failed: 0 })),
  mobileCloudState: vi.fn(async () => "offline"),
  syncDomain: {},
}));

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { notesDomain } from "./notes";

const TA = "t_aaaaaaaaaaaaaaaa";
const TB = "t_bbbbbbbbbbbbbbbb";
const TC = "t_cccccccccccccccc"; // 墓碑标签

let db: SqlJsAsyncDb;

async function freshDb(): Promise<SqlJsAsyncDb> {
  const opened = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(opened);
  await opened.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,content_hash) VALUES ('n1','文档',NULL,0,'2026-11-05T00:00:00.000Z','h1')").run();
  const insertTag = opened.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,0,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z',?)");
  await insertTag.run(TA, "A", null);
  await insertTag.run(TB, "B", null);
  await insertTag.run(TC, "C", "2026-11-02T00:00:00.000Z");
  // 小记的关联不应当出现在文档标签里
  await opened.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q1',?,0)").run(TA);
  return opened;
}

const linksOf = async (noteId: string) =>
  await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='note' AND target_id=? ORDER BY position").all(noteId) as Array<{ tag_id: string }>;
const versionOf = async (noteId: string) =>
  (await db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind='note' AND target_id=?").get(noteId) as { links_updated_at?: string } | undefined)?.links_updated_at ?? "";

beforeEach(async () => {
  db = await freshDb();
  mocks.ensureDb.mockReset().mockResolvedValue(db);
});

describe("setNoteTags（单库写关系 + bump 版本）", () => {
  it("写入顺序 = 传入顺序，并推进关系版本；listNoteTagLinks 读回", async () => {
    await notesDomain.setNoteTags("n1", [TB, TA]);
    expect((await linksOf("n1")).map((r) => r.tag_id)).toEqual([TB, TA]);
    expect(await versionOf("n1")).toBeTruthy();
    expect(await notesDomain.listNoteTagLinks()).toMatchObject({ n1: [TB, TA] });
  });

  it("整组替换：旧关系清掉、新关系按新顺序落库，版本继续前推", async () => {
    await notesDomain.setNoteTags("n1", [TA, TB]);
    const v1 = await versionOf("n1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await notesDomain.setNoteTags("n1", [TB]);
    expect((await linksOf("n1")).map((r) => r.tag_id)).toEqual([TB]);
    expect(await versionOf("n1")).not.toBe(v1);
  });

  it("空集合 = 删光标签（写空关系并推进版本，删除才能传播）", async () => {
    await notesDomain.setNoteTags("n1", [TA]);
    const v1 = await versionOf("n1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await notesDomain.setNoteTags("n1", []);
    expect(await linksOf("n1")).toEqual([]);
    expect(await versionOf("n1")).not.toBe(v1);
  });

  it("未知文档 / 未知标签 / 墓碑标签都拒绝（不写半截关系）", async () => {
    await expect(notesDomain.setNoteTags("missing", [TA])).rejects.toThrow("笔记不存在");
    await expect(notesDomain.setNoteTags("n1", ["t_ffffffffffffffff"])).rejects.toThrow("标签不存在或已删除");
    await expect(notesDomain.setNoteTags("n1", [TC])).rejects.toThrow("标签不存在或已删除");
    expect(await linksOf("n1")).toEqual([]);
  });

  it("listNoteTagLinks 只回文档空间（小记关系不串入）", async () => {
    await notesDomain.setNoteTags("n1", [TA]);
    const links = await notesDomain.listNoteTagLinks();
    expect(links.n1).toEqual([TA]);
    expect(links.q1).toBeUndefined();
  });
});
