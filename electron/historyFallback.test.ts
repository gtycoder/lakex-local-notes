import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { noteBodyRelativePath } from "../src/core/noteBodyPaths.js";

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

describe("定时兜底历史快照（Batch4-C）", () => {
  it("账本表建好；只挑自上次兜底后有正文变化的文档，重启后账本仍在", () => {
    const db = new Database(path.join(dir, "metadata.sqlite3"), { readonly: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_fallback_state'").get();
    db.close();
    expect(table).toBeTruthy();

    const a = store.createNote("A");
    const b = store.createNote("B");
    store.saveNote(a.id, "A", "<p>A1</p>");
    store.saveNote(b.id, "B", "<p>B1</p>");

    const first = store.runHistoryFallback();
    expect(first.created).toBeGreaterThanOrEqual(2);
    expect(store.listNoteHistory(a.id)).toHaveLength(1);
    expect(store.listNoteHistory(b.id)).toHaveLength(1);

    // 没有变化 ⇒ 一篇都不选（不是每轮都全量快照）
    const second = store.runHistoryFallback();
    expect(second.changed).toBe(0);
    expect(second.created).toBe(0);

    // 只改 A（推进 mtime 模拟真实保存）⇒ 只给 A 补一份
    store.saveNote(a.id, "A", "<p>A2</p>");
    bumpMtime(a.id, 3000);
    const third = store.runHistoryFallback();
    expect(third.changed).toBe(1);
    expect(third.created).toBe(1);
    expect(store.listNoteHistory(a.id)).toHaveLength(2);
    expect(store.listNoteHistory(b.id)).toHaveLength(1);

    // 模拟重启：账本在 DB 里（不是内存 set），新一轮不会重复快照
    store.close();
    store = new Store(dir, createSafeStorageSecretCipher());
    const fourth = store.runHistoryFallback();
    expect(fourth.changed).toBe(0);
    expect(fourth.created).toBe(0);
  });

  it("24h 同 hash 去重仍生效：mtime 变了但内容没变 ⇒ changed 但不新建", () => {
    const n = store.createNote("N");
    store.saveNote(n.id, "N", "<p>same</p>");
    expect(store.runHistoryFallback().created).toBeGreaterThanOrEqual(1);
    expect(store.listNoteHistory(n.id)).toHaveLength(1);
    bumpMtime(n.id, 4000);
    const res = store.runHistoryFallback();
    expect(res.changed).toBeGreaterThanOrEqual(1);
    expect(res.created).toBe(0);
    expect(store.listNoteHistory(n.id)).toHaveLength(1);
  });

  it("单篇失败不阻断其余（失败计数、后续文档照常留档）", () => {
    const a = store.createNote("A");
    const b = store.createNote("B");
    store.saveNote(a.id, "A", "<p>A</p>");
    store.saveNote(b.id, "B", "<p>B</p>");
    bumpMtime(a.id, 9000); // A 最新 ⇒ 排序后第一个被处理
    bumpMtime(b.id, 8000);
    // runHistoryFallback 在 HistoryLifecycle 里（Store 只是转发）⇒ 失败注入要打在 lifecycle 实例上。
    const lifecycle = (store as unknown as { historyLifecycle: { createHistorySnapshot: (noteId: string) => number | null } }).historyLifecycle;
    const spy = vi.spyOn(lifecycle, "createHistorySnapshot").mockImplementationOnce(() => { throw new Error("boom"); });
    const res = store.runHistoryFallback();
    expect(res.failed).toBe(1);
    expect(res.created).toBeGreaterThanOrEqual(1);
    expect(store.listNoteHistory(b.id)).toHaveLength(1);
    expect(store.listNoteHistory(a.id)).toHaveLength(0);
    spy.mockRestore();
  });

  it("缺正文的文档跳过且不抛（走缺正文通道，不制造空快照）", () => {
    const n = store.createNote("M");
    store.saveNote(n.id, "M", "<p>x</p>");
    fs.rmSync(bodyPath(n.id));
    expect(() => store.runHistoryFallback()).not.toThrow();
    expect(store.runHistoryFallback().missingBody).toBeGreaterThanOrEqual(1);
    expect(store.listNoteHistory(n.id)).toHaveLength(0);
  });

  it("回收站文档不生成兜底快照（不会白占磁盘）", () => {
    const n = store.createNote("T");
    store.saveNote(n.id, "T", "<p>t</p>");
    store.deleteTreeNode(n.id);
    bumpMtime(n.id, 5000);
    store.runHistoryFallback();
    expect(store.listNoteHistory(n.id)).toHaveLength(0);
  });

  it("兜底产生的快照仍受每文档上限/保留期清理约束", () => {
    store.saveHistorySettings({ maxSnapshots: 2, retentionDays: 3650, cleanupIntervalHours: 0, snapshotIntervalMinutes: 10 });
    const n = store.createNote("C");
    for (let i = 0; i < 4; i += 1) {
      store.saveNote(n.id, "C", "<p>v" + i + "</p>");
      bumpMtime(n.id, 1000 * (i + 1));
      store.runHistoryFallback();
    }
    expect(store.listNoteHistory(n.id)).toHaveLength(4);
    const cleanup = store.cleanupHistory();
    expect(cleanup.deletedSnapshots).toBeGreaterThanOrEqual(2);
    expect(store.listNoteHistory(n.id)).toHaveLength(2);
  });
});
