/**
 * task-52 / G3（写守卫越界）移动端口回归：同步镜像 icon 不得撞用户写边界守卫。
 *
 * 桌面侧见 electron/s3v3/remoteIconWrite.test.ts；移动端口本来就是同步镜像直写 notes.icon
 * （mobilePlatformPort.setNodeIcon），本文件把「回收站行可写、不抛错、trashed_at 不变」钉死。
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createMobilePlatformPort } from "./mobilePlatformPort.js";

describe("同步镜像 icon（261112 G3 移动口径：不撞用户写边界守卫）", () => {
  it("回收站行可接收远端图标：只写 icon、不抛错、trashed_at 不变", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    const now = "2026-11-12T00:00:00.000Z";
    await db.prepare(
      "INSERT INTO notes (id,title,parent_id,updated_at,created_at,content_hash,is_dirty,text_cache,doc_kind,trashed_at,deleted_from_parent_id) VALUES ('t1','回收站条目',NULL,?,?,?,1,NULL,'doc',?,NULL)",
    ).run(now, now, "hash-t1", now);
    const port = createMobilePlatformPort(db);
    await expect(port.setNodeIcon("t1", "📄")).resolves.toBeUndefined();
    const row = await db.prepare("SELECT icon, trashed_at FROM notes WHERE id='t1'").get() as
      { icon: string | null; trashed_at: string | null };
    expect(row.icon).toBe("📄");
    expect(row.trashed_at).toBe(now);
    await db.close();
  }, 60_000);
});
