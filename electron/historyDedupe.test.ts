import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { pickCurrentHistorySnapshotId } from "../src/core/historyCurrent.js";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-history-dedupe-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
});

function db(): { prepare: (sql: string) => { run: (...args: unknown[]) => { lastInsertRowid?: number | bigint; changes?: number }; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } } {
  return (store as unknown as { db: ReturnType<typeof db> }).db;
}

interface HistoryRow {
  id: number;
  file_path: string;
  content_hash: string;
  created_at: string;
  size: number;
  refs_json: string;
  ref_count: number;
}

function historyRows(noteId: string): HistoryRow[] {
  return db().prepare(
    "SELECT id,file_path,content_hash,created_at,size,refs_json,ref_count FROM note_history WHERE note_id=? ORDER BY created_at DESC, id DESC",
  ).all(noteId) as HistoryRow[];
}

/** 模拟旧版本（24h 窗口）留下的同 hash 重复行：复制 .body.gz + 插一行（created_at 可控）。 */
function insertLegacyDuplicate(noteId: string, source: HistoryRow, createdAt: string): { id: number; relPath: string } {
  const relPath = source.file_path.replace(/([^/]+)$/, (name) => "legacy-" + name);
  fs.copyFileSync(path.join(dir, source.file_path), path.join(dir, relPath));
  const info = db().prepare(
    "INSERT INTO note_history(note_id,file_path,content_hash,created_at,size,refs_json,ref_count,protected_until) VALUES(?,?,?,?,?,?,?,NULL)",
  ).run(noteId, relPath, source.content_hash, createdAt, source.size, source.refs_json, source.ref_count);
  return { id: Number(info.lastInsertRowid), relPath };
}

function bodyPath(id: string): string {
  return path.join(dir, "notes", id + ".lake");
}

function bumpMtime(id: string, deltaMs = 5000): void {
  const t = new Date(Date.now() + deltaMs);
  fs.utimesSync(bodyPath(id), t, t);
}

describe("历史快照去重（261106 定稿：同 note 同 hash 永远只留一条）", () => {
  it("根因回归：隔天（>24h）再触发同内容也不再新增（旧 hasRecentDuplicate 24h 窗口会重复）", () => {
    const n = store.createNote("A");
    store.saveNote(n.id, "A", "<p>v1</p>");
    const first = store.createHistorySnapshot(n.id);
    expect(first).toBeTruthy();
    // 把已有快照「拨回」3 天前（旧实现 created_at > now-24h 判据会因此放行第二次）
    db().prepare("UPDATE note_history SET created_at=? WHERE id=?").run(
      new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
      first,
    );
    expect(store.createHistorySnapshot(n.id)).toBeNull();
    expect(store.listNoteHistory(n.id)).toHaveLength(1);
  });

  it("手动 + 兜底交叉：同一内容只留一条（兜底不重复、手动也不重复）", async () => {
    const n = store.createNote("A");
    store.saveNote(n.id, "A", "<p>v1</p>");
    // 手动创建（不再传 force）
    expect(store.createHistorySnapshot(n.id)).toBeTruthy();
    // 正文 mtime 变化，但内容没变 ⇒ 兜底不得给这篇新增（首轮还会给 seed 欢迎笔记留档，故按本 note 计数）
    bumpMtime(n.id, 4000);
    await store.runHistoryFallback();
    expect(store.listNoteHistory(n.id)).toHaveLength(1);
    // 内容变化后：兜底留档一条；手动再点（同内容）仍不重复
    store.saveNote(n.id, "A", "<p>v2</p>");
    bumpMtime(n.id, 8000);
    await store.runHistoryFallback();
    expect(store.listNoteHistory(n.id)).toHaveLength(2);
    expect(store.createHistorySnapshot(n.id)).toBeNull();
    expect(store.listNoteHistory(n.id)).toHaveLength(2);
  });

  it("force（历史接口兼容 / 冲突留档路径）同内容同样去重", () => {
    const n = store.createNote("A");
    store.saveNote(n.id, "A", "<p>same</p>");
    expect(store.createHistorySnapshot(n.id, undefined, true)).toBeTruthy();
    expect(store.createHistorySnapshot(n.id, undefined, true)).toBeNull();
    expect(store.listNoteHistory(n.id)).toHaveLength(1);
  });

  it("不同内容正常留两条；「当前」判据只标最新一条", () => {
    const n = store.createNote("A");
    store.saveNote(n.id, "A", "<p>v1</p>");
    const h1 = store.createHistorySnapshot(n.id)!;
    store.saveNote(n.id, "A", "<p>v2</p>");
    const h2 = store.createHistorySnapshot(n.id)!;
    expect(h1).not.toBe(h2);
    const list = store.listNoteHistory(n.id);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((h) => h.contentHash)).size).toBe(2);
    // 同 hash 存量重复时，当前只落在最新的一条（这里用 v2 的两条模拟）
    const dupOfV2 = insertLegacyDuplicate(n.id, historyRows(n.id)[0], new Date(Date.now() + 60_000).toISOString());
    const withDup = store.listNoteHistory(n.id);
    expect(withDup).toHaveLength(3);
    const currentId = pickCurrentHistorySnapshotId(withDup, list[0].contentHash);
    expect(currentId).toBe(dupOfV2.id); // 最新一条
    expect(withDup.filter((h) => h.contentHash === list[0].contentHash)).toHaveLength(2);
    // 面板 badge 判据不会同时命中两条：只有 currentId 一条
    expect(withDup.filter((h) => h.id === currentId)).toHaveLength(1);
  });

  it("cleanupHistory 不再自动收敛存量重复行（261106 用户定稿：不替历史数据做收敛，用户可自己删）", () => {
    const n = store.createNote("A");
    store.saveNote(n.id, "A", "<p>v1</p>");
    store.createHistorySnapshot(n.id);
    store.saveNote(n.id, "A", "<p>v2</p>");
    store.createHistorySnapshot(n.id);
    const v2 = historyRows(n.id)[0];
    // 模拟历史遗留的同 hash 重复行（旧代码可产生；现在不会新增，但存量不该被自动删）
    const dup = insertLegacyDuplicate(n.id, v2, new Date(Date.now() + 60_000).toISOString());
    expect(store.listNoteHistory(n.id)).toHaveLength(3);

    const cleanup = store.cleanupHistory();
    // 保留策略（30 天/100 份）不会命中这些新 snapshot ⇒ 三行（含重复）都保留
    expect(cleanup.deletedSnapshots).toBe(0);
    expect(store.listNoteHistory(n.id)).toHaveLength(3);
    expect(store.listNoteHistory(n.id).some((h) => h.id === dup.id)).toBe(true);
    expect(fs.existsSync(path.join(dir, dup.relPath))).toBe(true);
  });
});
