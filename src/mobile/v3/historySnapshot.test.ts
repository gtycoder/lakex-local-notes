import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote } from "../data/noteRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("移动端 v3 覆盖留档（parity F1）", () => {
  it("Lake 文档写历史快照（含保护期）；小记无历史快照（产品定稿）", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    await createNote(db, "n1", "Doc", "hello", null, new Map());
    const store = new MobileDeviceStore(db);
    await store.init();

    const id = await store.writeHistory("n1", enc("covered-by-remote"));
    expect(id).toBe("n1");
    const rows = await db.prepare("SELECT note_id,title,protected_until FROM note_history WHERE note_id=?").all("n1") as Array<{ note_id: string; title: string; protected_until: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Doc");
    expect(rows[0].protected_until).not.toBeNull();

    // 小记：产品定稿「随手记语义，无历史快照」——返回占位值，不写库。
    expect(await store.writeHistory("quick-q1", enc("quick"))).toBe("quick-note-history-skip");
    const qRows = await db.prepare("SELECT COUNT(*) AS n FROM note_history WHERE note_id=?").get("quick-q1") as { n: number };
    expect(qRows.n).toBe(0);
  });
});
