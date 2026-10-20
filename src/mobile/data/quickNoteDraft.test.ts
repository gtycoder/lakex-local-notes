/**
 * 闪念速记未提交草稿（draft-journal 文件 + device_state 指针；纯本地）护栏（261019 文件化）。
 *
 * 草稿正文在 draft-journal/{id}.json（与桌面草稿日志同构），device_state 只存一个 id 指针；
 * 不是小记、不进 S3；保存/主动取消后清除。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { applyMobileSchema } from "./schema.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import type { MobileDb } from "./sqliteDb";
import { clearQuickNoteDraft, readQuickNoteDraft, writeQuickNoteDraft } from "./quickNotesRepository";
import { readDraftJournal, writeDraftJournal } from "./noteBodies.js";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

function pointerValue(db: MobileDb): Promise<string | null> {
  return db.prepare("SELECT value FROM device_state WHERE key='quick_note_draft_id'").get().then((row) => {
    const value = (row as { value?: string } | undefined)?.value;
    return value == null ? null : String(value);
  });
}

describe("闪念速记草稿（draft-journal 文件，纯本地）", () => {
  it("写→读往返；清除后为空（正文在文件，DB 只存 id 指针）", async () => {
    const db = await freshDb();
    expect(await readQuickNoteDraft(db)).toBeNull();

    const img = { id: "img-1", filename: "1789_x.png", mimeType: "image/png", width: 4, height: 4, size: 89, hash: "a".repeat(64) };
    await writeQuickNoteDraft(db, { id: "draft-1", text: "随手一句", images: [img], tags: ["灵感"], updatedAt: "2026-09-20T00:00:00.000Z" });
    expect(await readQuickNoteDraft(db)).toEqual({ id: "draft-1", text: "随手一句", images: [img], tags: ["灵感"], updatedAt: "2026-09-20T00:00:00.000Z" });
    expect(await pointerValue(db)).toBe("draft-1");
    expect(await readDraftJournal("draft-1")).toContain("draft-1");

    await clearQuickNoteDraft(db);
    expect(await readQuickNoteDraft(db)).toBeNull();
    expect(await pointerValue(db)).toBeNull();
    expect(await readDraftJournal("draft-1")).toBeNull();
    await db.close();
  });

  it("坏草稿（非法 JSON / 缺字段）当作没有，不抛", async () => {
    const db = await freshDb();
    await writeDraftJournal("bad-json", "{not json");
    await db.prepare("INSERT INTO device_state(key,value) VALUES('quick_note_draft_id','bad-json')").run();
    expect(await readQuickNoteDraft(db)).toBeNull();

    await writeDraftJournal("bad-shape", JSON.stringify({ id: "", text: "x" }));
    await db.prepare("UPDATE device_state SET value='bad-shape' WHERE key='quick_note_draft_id'").run();
    expect(await readQuickNoteDraft(db)).toBeNull();

    await writeDraftJournal("good", JSON.stringify({ id: "a", text: "x" }));
    await db.prepare("UPDATE device_state SET value='good' WHERE key='quick_note_draft_id'").run();
    expect(await readQuickNoteDraft(db)).toEqual({ id: "a", text: "x", images: [], tags: [], updatedAt: "" });
    await db.close();
  });
});
