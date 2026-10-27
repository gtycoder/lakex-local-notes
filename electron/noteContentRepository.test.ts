import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NoteContentRepository } from "./noteContentRepository.js";
import type { DbLike } from "./dbLike.js";

type NoteRow = { title: string; trashed_at: string | null; is_purged?: number | null };

/** 最小 DbLike mock：prepare 返回 run()（计入 calls）/ get()；transaction(fn) 直接执行。 */
function makeDb(row: NoteRow = { title: "旧标题", trashed_at: null, is_purged: 0 }) {
  const runCalls: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        get: (..._args: unknown[]) => (sql.includes("SELECT title") ? row : undefined),
        all: () => [],
        run: (..._args: unknown[]) => { runCalls.push(sql); return { changes: 1, lastInsertRowid: 1 }; },
      };
    },
    transaction(fn: () => void) { return () => fn(); },
    pragma: () => undefined,
    exec: () => undefined,
    close: () => undefined,
  } as unknown as DbLike;
  return { db, runCalls };
}

function deps(over: Partial<ConstructorParameters<typeof NoteContentRepository>[0]> = {}) {
  const { db } = makeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ncr-"));
  const notePath = path.join(dir, "note.lake");
  fs.writeFileSync(notePath, "<p>旧内容</p>", "utf8");
  const base = {
    db,
    notePathFor: () => notePath,
    atomicWrite: vi.fn((_fp: string, content: string) => fs.writeFileSync(notePath, content, "utf8")),
    upsertSearch: vi.fn(),
    detectOrphans: vi.fn(),
    markHistoryDirty: vi.fn(),
    ...over,
  };
  return { base, notePath, dir } as const;
}

describe("NoteContentRepository.save (W-7 文件写与 DB 事务分离)", () => {
  it("正常保存：atomicWrite 先写入正文，DB 事务再更新元数据", () => {
    const { base } = deps();
    const repo = new NoteContentRepository(base);
    repo.save("n1", "新标题", "<p>新内容</p>");
    expect(fs.readFileSync(base.notePathFor("n1"), "utf8")).toBe("<p>新内容</p>");
    expect(base.atomicWrite).toHaveBeenCalledTimes(1);
    expect(base.upsertSearch).toHaveBeenCalled();
  });

  it("atomicWrite 抛错（磁盘失败）→ save() 抛错，DB 更新不执行", () => {
    const { db, runCalls } = makeDb();
    const { base } = deps({ db, atomicWrite: () => { throw new Error("ENOSPC 磁盘满"); } });
    const repo = new NoteContentRepository(base);
    expect(() => repo.save("n1", "新标题", "<p>新内容</p>")).toThrow("ENOSPC");
    expect(runCalls.length).toBe(0); // 事务内的 UPDATE 从未执行
  });

  it("审计 F04：回收站条目不能被普通保存改写（明确拒绝，正文/DB 都不动）", () => {
    const { db, runCalls } = makeDb({ title: "旧标题", trashed_at: "2026-09-30T00:00:00.000Z", is_purged: 0 });
    const { base, notePath } = deps({ db });
    const repo = new NoteContentRepository(base);
    expect(() => repo.save("n1", "新标题", "<p>晚到保存</p>")).toThrow(/回收站|已删除/);
    expect(fs.readFileSync(notePath, "utf8")).toBe("<p>旧内容</p>");
    expect(base.atomicWrite).not.toHaveBeenCalled();
    expect(runCalls.length).toBe(0);
  });

  it("审计 F04：is_purged 的保留副本同样拒绝（不兼职恢复）", () => {
    const { db } = makeDb({ title: "旧标题", trashed_at: null, is_purged: 1 });
    const { base } = deps({ db });
    const repo = new NoteContentRepository(base);
    expect(() => repo.save("n1", "新标题", "<p>晚到保存</p>")).toThrow(/回收站|已删除/);
    expect(base.atomicWrite).not.toHaveBeenCalled();
  });
});
