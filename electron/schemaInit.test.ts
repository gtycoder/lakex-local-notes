import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SchemaInit } from "./schemaInit.js";
import type { DbLike } from "./dbLike.js";

/**
 * schema 迁移护栏（review 缺口）：旧库的 ai_writing_messages 没有 attach_refs 列，
 * SchemaInit.migrate 必须通过 PRAGMA 检查按需 ALTER 补齐，且重复执行幂等。
 */

function makeInit(raw: Database.Database): SchemaInit {
  return new SchemaInit({
    db: raw as unknown as DbLike,
    workspaceId: "w-test",
    trashNotebookId: "trash-test",
    defaultNotebookId: "default-test",
    nextSortOrder: () => 0,
    atomicWrite: () => undefined,
    notePathFor: (id) => "/tmp/" + id + ".lake",
  });
}

const columns = (raw: Database.Database, table: string): string[] =>
  (raw.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>).map((col) => col.name);

describe("SchemaInit · ai_writing_messages.attach_refs 迁移", () => {
  it("旧库（无 attach_refs）一次迁移补齐；第二次幂等；旧数据保留", () => {
    const raw = new Database(":memory:");
    // 模拟 v1.2.0 之前的 AI 写作表（只有 schema 最小子集，缺 attach_refs）
    raw.exec(`
      CREATE TABLE ai_writing_conversations (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'chat', title TEXT NOT NULL,
        prompt_text TEXT, doc_refs TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE ai_writing_messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '', reasoning TEXT, duration_ms INTEGER,
        stopped INTEGER NOT NULL DEFAULT 0, error TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO ai_writing_conversations(id,mode,title,created_at,updated_at) VALUES('c1','chat','旧会话','2026-01-01','2026-01-01');
      INSERT INTO ai_writing_messages(id,conversation_id,role,content,sort_order,created_at)
        VALUES('m1','c1','user','旧消息',0,'2026-01-01');
    `);
    expect(columns(raw, "ai_writing_messages")).not.toContain("attach_refs");

    const init = makeInit(raw);
    init.migrate();
    expect(columns(raw, "ai_writing_messages")).toContain("attach_refs");
    // 旧行保留且新列默认 NULL（不写空数组噪音）
    const old = raw.prepare("SELECT content, attach_refs FROM ai_writing_messages WHERE id='m1'").get() as { content: string; attach_refs: string | null };
    expect(old.content).toBe("旧消息");
    expect(old.attach_refs).toBeNull();

    // 重复启动：PRAGMA 已存在 ⇒ 不再 ALTER，不抛错
    expect(() => init.migrate()).not.toThrow();
    expect(columns(raw, "ai_writing_messages").filter((name) => name === "attach_refs")).toHaveLength(1);
  });
});
