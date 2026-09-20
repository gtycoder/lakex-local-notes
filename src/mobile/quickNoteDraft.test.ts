/**
 * 闪念速记未提交草稿（device_state，纯本地）护栏（260920）。
 *
 * 目标：随手写到一半被系统杀进程时，下次打开还能把文字捞回来（对齐思源闪念的草稿效果）。
 * 草稿是**本机 device_state**，不是小记、不进 S3；保存/主动取消后清除。
 */
import { describe, expect, it } from "vitest";
import type { MobileDb } from "./sqliteDb";
import { clearQuickNoteDraft, readQuickNoteDraft, writeQuickNoteDraft } from "./quickNotesRepository";

/** 只实现草稿用到的 prepare().get/run 的最小假库（按 SQL 首词分流 DELETE/写）。 */
function fakeDb() {
  const rows = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      return {
        async get(...params: unknown[]) {
          const key = String(params[0]);
          return rows.has(key) ? { value: rows.get(key) } : undefined;
        },
        async all() { return []; },
        async run(...params: unknown[]) {
          if (sql.trimStart().startsWith("DELETE")) rows.delete(String(params[0]));
          else rows.set(String(params[0]), String(params[1]));
          return { changes: 1, lastInsertRowid: 0 };
        },
      };
    },
    async transaction(fn: () => Promise<unknown>) { return await fn(); },
  } as unknown as MobileDb;
  return { db, rows };
}

describe("闪念速记草稿（device_state，纯本地）", () => {
  it("写→读往返；清除后为空", async () => {
    const { db, rows } = fakeDb();
    expect(await readQuickNoteDraft(db)).toBeNull();

    const img = { id: "img-1", filename: "1789_x.png", mimeType: "image/png", width: 4, height: 4, size: 89, hash: "a".repeat(64) };
    await writeQuickNoteDraft(db, { id: "draft-1", text: "随手一句", images: [img], updatedAt: "2026-09-20T00:00:00.000Z" });
    expect(await readQuickNoteDraft(db)).toEqual({ id: "draft-1", text: "随手一句", images: [img], updatedAt: "2026-09-20T00:00:00.000Z" });
    expect(rows.get("quick-note-draft")).toContain("draft-1");

    await clearQuickNoteDraft(db);
    expect(await readQuickNoteDraft(db)).toBeNull();
  });

  it("坏草稿（非法 JSON / 缺字段）当作没有，不抛", async () => {
    const { db, rows } = fakeDb();
    rows.set("quick-note-draft", "{not json");
    expect(await readQuickNoteDraft(db)).toBeNull();

    rows.set("quick-note-draft", JSON.stringify({ id: "", text: "x" }));
    expect(await readQuickNoteDraft(db)).toBeNull();

    rows.set("quick-note-draft", JSON.stringify({ id: "a", text: "x" }));
    expect(await readQuickNoteDraft(db)).toEqual({ id: "a", text: "x", images: [], updatedAt: "" });
  });
});
