import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { noteBodyRelativePath } from "../src/core/noteBodyPaths.js";
import { HISTORY_FALLBACK_BACKOFF_BASE_MS, HISTORY_FALLBACK_BACKOFF_MAX_MS } from "../src/core/historyFallbackPolicy.js";

// ===== electron mock（Store 模块加载即需要） =====
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
    secrets,
    getEncryptionAvailable() { return true; },
  };
});
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => electronMock.getEncryptionAvailable(),
    encryptString: (value: string) => {
      const id = crypto.randomUUID();
      electronMock.secrets.set(id, value);
      return Buffer.from(id);
    },
    decryptString: (buf: Buffer) => electronMock.secrets.get(buf.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

let dir: string;
let store: Store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-history-fallback-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
});

function bodyPath(id: string): string {
  return path.join(dir, noteBodyRelativePath("doc", id));
}

/** 显式推进正文 mtime（同毫秒内多次保存时 mtime 可能不变，测试不能靠 sleep 赌精度）。 */
function bumpMtime(id: string, deltaMs = 5000): void {
  const t = new Date(Date.now() + deltaMs);
  fs.utimesSync(bodyPath(id), t, t);
}

function db(): { prepare: (sql: string) => { run: (...args: unknown[]) => { changes?: number }; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } } {
  return (store as unknown as { db: ReturnType<typeof db> }).db;
}

function ledgerRow(noteId: string): { last_body_mtime_ms: number; fail_count: number; next_retry_at: string | null } | undefined {
  return db().prepare("SELECT last_body_mtime_ms, fail_count, next_retry_at FROM history_fallback_state WHERE note_id=?").get(noteId) as
    | { last_body_mtime_ms: number; fail_count: number; next_retry_at: string | null }
    | undefined;
}

describe("定时兜底历史快照（Batch4-C + P2-A）", () => {
  it("账本表建好；只挑自上次兜底后有正文变化的文档，重启后账本仍在", async () => {
    const db = new Database(path.join(dir, "metadata.sqlite3"), { readonly: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_fallback_state'").get();
    db.close();
    expect(table).toBeTruthy();

    const a = store.createNote("A");
    const b = store.createNote("B");
    store.saveNote(a.id, "A", "<p>A1</p>");
    store.saveNote(b.id, "B", "<p>B1</p>");

    const first = await store.runHistoryFallback();
    expect(first.created).toBeGreaterThanOrEqual(2);
    expect(store.listNoteHistory(a.id)).toHaveLength(1);
    expect(store.listNoteHistory(b.id)).toHaveLength(1);

    // 没有变化 ⇒ 一篇都不选（不是每轮都全量快照）
    const second = await store.runHistoryFallback();
    expect(second.changed).toBe(0);
    expect(second.created).toBe(0);

    // 只改 A（推进 mtime 模拟真实保存）⇒ 只给 A 补一份
    store.saveNote(a.id, "A", "<p>A2</p>");
    bumpMtime(a.id, 3000);
    const third = await store.runHistoryFallback();
    expect(third.changed).toBe(1);
    expect(third.created).toBe(1);
    expect(store.listNoteHistory(a.id)).toHaveLength(2);
    expect(store.listNoteHistory(b.id)).toHaveLength(1);

    // 模拟重启：账本在 DB 里（不是内存 set），新一轮不会重复快照
    store.close();
    store = new Store(dir, createSafeStorageSecretCipher());
    const fourth = await store.runHistoryFallback();
    expect(fourth.changed).toBe(0);
    expect(fourth.created).toBe(0);
  });

  it("24h 同 hash 去重仍生效：mtime 变了但内容没变 ⇒ changed 但不新建", async () => {
    const n = store.createNote("N");
    store.saveNote(n.id, "N", "<p>same</p>");
    expect((await store.runHistoryFallback()).created).toBeGreaterThanOrEqual(1);
    expect(store.listNoteHistory(n.id)).toHaveLength(1);
    bumpMtime(n.id, 4000);
    const res = await store.runHistoryFallback();
    expect(res.changed).toBeGreaterThanOrEqual(1);
    expect(res.created).toBe(0);
    expect(store.listNoteHistory(n.id)).toHaveLength(1);
  });

  it("单篇失败不阻断其余（失败计数、后续文档照常留档）", async () => {
    const a = store.createNote("A");
    const b = store.createNote("B");
    store.saveNote(a.id, "A", "<p>A</p>");
    store.saveNote(b.id, "B", "<p>B</p>");
    bumpMtime(a.id, 9000); // A 最新 ⇒ 排序后第一个被处理
    bumpMtime(b.id, 8000);
    // runHistoryFallback 在 HistoryLifecycle 里（Store 只是转发）⇒ 失败注入要打在 lifecycle 实例上。
    const lifecycle = (store as unknown as { historyLifecycle: { createHistorySnapshot: (noteId: string) => number | null } }).historyLifecycle;
    const spy = vi.spyOn(lifecycle, "createHistorySnapshot").mockImplementationOnce(() => { throw new Error("boom"); });
    const res = await store.runHistoryFallback();
    expect(res.failed).toBe(1);
    expect(res.created).toBeGreaterThanOrEqual(1);
    expect(store.listNoteHistory(b.id)).toHaveLength(1);
    expect(store.listNoteHistory(a.id)).toHaveLength(0);
    spy.mockRestore();
  });

  it("缺正文的文档跳过且不抛（走缺正文通道，不制造空快照）", async () => {
    const n = store.createNote("M");
    store.saveNote(n.id, "M", "<p>x</p>");
    fs.rmSync(bodyPath(n.id));
    const res = await store.runHistoryFallback();
    expect(res.missingBody).toBeGreaterThanOrEqual(1);
    expect(store.listNoteHistory(n.id)).toHaveLength(0);
  });

  it("回收站文档不生成兜底快照（不会白占磁盘）", async () => {
    const n = store.createNote("T");
    store.saveNote(n.id, "T", "<p>t</p>");
    store.deleteTreeNode(n.id);
    bumpMtime(n.id, 5000);
    await store.runHistoryFallback();
    expect(store.listNoteHistory(n.id)).toHaveLength(0);
  });

  it("P2-A 失败退避：写 fail_count/next_retry_at，退避期内跳过；到期后重试并清零", async () => {
    const a = store.createNote("A");
    const b = store.createNote("B");
    store.saveNote(a.id, "A", "<p>A</p>");
    store.saveNote(b.id, "B", "<p>B</p>");
    bumpMtime(a.id, 9000);
    bumpMtime(b.id, 8000);
    const lifecycle = (store as unknown as { historyLifecycle: { createHistorySnapshot: (noteId: string) => number | null } }).historyLifecycle;
    const spy = vi.spyOn(lifecycle, "createHistorySnapshot").mockImplementationOnce(() => { throw new Error("boom"); });
    const first = await store.runHistoryFallback();
    expect(first.failed).toBe(1);
    expect(first.created).toBeGreaterThanOrEqual(1);
    const row = ledgerRow(a.id)!;
    expect(row.fail_count).toBe(1);
    expect(row.next_retry_at).toBeTruthy();
    expect(Date.parse(row.next_retry_at!)).toBeGreaterThan(Date.now() + HISTORY_FALLBACK_BACKOFF_BASE_MS - 60_000);
    expect(Date.parse(row.next_retry_at!)).toBeLessThanOrEqual(Date.now() + HISTORY_FALLBACK_BACKOFF_MAX_MS + 60_000);

    // 退避期内：不再重试（skippedBackoff 计数、不计 failed）
    const second = await store.runHistoryFallback();
    expect(second.skippedBackoff).toBeGreaterThanOrEqual(1);
    expect(second.failed).toBe(0);
    spy.mockRestore();

    // 退避到期 ⇒ 重试成功，账本清零
    const later = new Date(Date.now() + HISTORY_FALLBACK_BACKOFF_BASE_MS * 3);
    const third = await store.runHistoryFallback({ now: later });
    expect(third.failed).toBe(0);
    expect(third.created).toBeGreaterThanOrEqual(1);
    expect(ledgerRow(a.id)!.fail_count).toBe(0);
    expect(ledgerRow(a.id)!.next_retry_at).toBeNull();
  });

  it("P2-A 账本清理：已删文档的记录行被清理（不再无限累积）", async () => {
    const a = store.createNote("A");
    store.saveNote(a.id, "A", "<p>A</p>");
    await store.runHistoryFallback();
    expect(ledgerRow(a.id)).toBeTruthy();
    db().prepare("DELETE FROM notes WHERE id=?").run(a.id); // 模拟行被 purge/坏库移除
    const res = await store.runHistoryFallback();
    expect(res.cleanedLedger).toBeGreaterThanOrEqual(1);
    expect(ledgerRow(a.id)).toBeUndefined();
  });

  it("P2-A 首轮游标：每 tick 只扫一页，走完自动切回全量模式", async () => {
    for (const title of ["n1", "n2", "n3", "n4", "n5"]) {
      const n = store.createNote(title);
      store.saveNote(n.id, title, "<p>" + title + "</p>");
    }
    // 种子笔记（欢迎）也会被扫描：总数 = 5 篇 + seed 欢迎笔记；pageSize=3 ⇒ 两页走完
    const total = store.listNotesSyncMeta().length;
    const first = await store.runHistoryFallback({ bootstrapPageSize: 3 });
    expect(first.bootstrap).toBe(true);
    expect(first.scanned).toBe(3);
    expect(first.created).toBe(3);
    expect(first.cursor).toBeTruthy();
    const second = await store.runHistoryFallback({ bootstrapPageSize: 3 });
    expect(second.bootstrap).toBe(true);
    expect(second.scanned).toBe(Math.min(3, total - 3));
    expect(second.created).toBe(Math.min(3, total - 3));
    const third = await store.runHistoryFallback({ bootstrapPageSize: 3 });
    expect(third.scanned).toBe(0); // 页已耗尽 ⇒ 首轮完成
    expect(third.cursor).toBeNull();
    const fourth = await store.runHistoryFallback({ bootstrapPageSize: 3 });
    expect(fourth.bootstrap).toBe(false);
    expect(fourth.changed).toBe(0);
  });

  it("P2-A 分片让出：stat 与快照两段都按 chunk await yield", async () => {
    for (const title of ["n1", "n2", "n3"]) {
      const n = store.createNote(title);
      store.saveNote(n.id, title, "<p>" + title + "</p>");
    }
    const yieldFn = vi.fn(async () => undefined);
    await store.runHistoryFallback({ chunkSize: 2, yieldToEventLoop: yieldFn });
    expect(yieldFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("P2-A 时间预算：用尽即停并记账 deferred，剩余留到下一 tick", async () => {
    for (const title of ["n1", "n2", "n3", "n4"]) {
      const n = store.createNote(title);
      store.saveNote(n.id, title, "<p>" + title + "</p>");
    }
    const total = store.listNotesSyncMeta().length;
    const first = await store.runHistoryFallback({ chunkSize: 1, timeBudgetMs: 0, bootstrapPageSize: 100 });
    expect(first.created).toBe(1); // 至少处理一篇再停
    expect(first.deferred).toBeGreaterThanOrEqual(1);
    const second = await store.runHistoryFallback();
    expect(first.created + second.created).toBe(total); // 剩余下一 tick 全部补上（不丢）
  });

  it("兜底产生的快照仍受每文档上限/保留期清理约束", async () => {
    store.saveHistorySettings({ maxSnapshots: 2, retentionDays: 3650, cleanupIntervalHours: 0, snapshotIntervalMinutes: 10 });
    const n = store.createNote("C");
    for (let i = 0; i < 4; i += 1) {
      store.saveNote(n.id, "C", "<p>v" + i + "</p>");
      bumpMtime(n.id, 1000 * (i + 1));
      await store.runHistoryFallback();
    }
    expect(store.listNoteHistory(n.id)).toHaveLength(4);
    const cleanup = store.cleanupHistory();
    expect(cleanup.deletedSnapshots).toBeGreaterThanOrEqual(2);
    expect(store.listNoteHistory(n.id)).toHaveLength(2);
  });
});
