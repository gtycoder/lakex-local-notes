import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Store 模块加载会 import electron（secretCipher 的 safeStorage 分支）；测试内给最小 mock。
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

import { Store, TRASH_NOTEBOOK_ID } from "./store.js";
import type { SyncFolder } from "./noteQueries.js";

/**
 * P1-6 父环防护（electron 落库/读侧）：
 * 远端索引可注入父环；旧实现 descendantIds / trashLifecycle 无 visited ⇒ 移动/删除/回收站枚举卡死
 *（/tmp 复现：3 节点环递归 CTE 可吐 10 万行）。这里用坏库直接造环，断言每条路径**有限时间**内返回。
 */

const WORKSPACE = "default";
const NOW = "2026-11-05T00:00:00.000Z";

function freshStore(): { dir: string; store: Store } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-cycle-guard-"));
  return { dir, store: new Store(dir) };
}

function dbOf(store: Store): { prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] } } {
  return (store as unknown as { db: ReturnType<typeof dbOf> }).db;
}

function insertNode(store: Store, id: string, parentId: string | null, nodeType: "notebook" | "group" | "note"): void {
  dbOf(store).prepare(
    "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,is_dirty,is_conflict) VALUES(?,?,?,?,?,NULL,0,?,?,NULL,0,0)",
  ).run(id, WORKSPACE, parentId, nodeType, id, NOW, NOW);
}

/** 造环：a→b→c→a（group）；root notebook 正常。 */
function insertCycle(store: Store): void {
  insertNode(store, "nb", null, "notebook");
  insertNode(store, "a", "b", "group");
  insertNode(store, "b", "c", "group");
  insertNode(store, "c", "a", "group");
}

function elapsedMs(fn: () => unknown): number {
  const t0 = Date.now();
  fn();
  return Date.now() - t0;
}

function folder(id: string, parentId: string | null, updatedAt = NOW): SyncFolder {
  return { id, title: id, parentId, sortOrder: 0, nodeType: "group", icon: null, updatedAt };
}

describe("P1-6 父环防护（electron）", () => {
  it("moveTreeNode：环数据下守卫有限返回（不被自己子节点吞掉）", () => {
    const { dir, store } = freshStore();
    try {
      insertCycle(store);
      const ms = elapsedMs(() => {
        expect(() => store.moveTreeNode("a", "c", 0)).toThrow(/不能移动到子节点/);
      });
      expect(ms).toBeLessThan(2_000);
      // 环上节点原父不被写坏
      const row = dbOf(store).prepare("SELECT parent_id FROM tree_nodes WHERE id='a'").get() as { parent_id: string };
      expect(row.parent_id).toBe("b");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deleteTreeNode：环子树上移入回收站有限完成（visited 收敛）", () => {
    const { dir, store } = freshStore();
    try {
      insertCycle(store);
      const ms = elapsedMs(() => store.deleteTreeNode("a"));
      expect(ms).toBeLessThan(2_000);
      const rows = dbOf(store).prepare("SELECT id, parent_id, trashed_at FROM tree_nodes WHERE id IN ('a','b','c')").all() as Array<{ id: string; parent_id: string | null; trashed_at: string | null }>;
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.trashed_at).not.toBeNull();
      expect(rows.find((r) => r.id === "a")!.parent_id).toBe(TRASH_NOTEBOOK_ID);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("listTrash：环数据下回收站枚举有限返回", () => {
    const { dir, store } = freshStore();
    try {
      insertCycle(store);
      store.deleteTreeNode("a");
      const t0 = Date.now();
      const items = store.listTrash();
      expect(Date.now() - t0).toBeLessThan(2_000);
      expect(items.some((item) => item.id === "a")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applyRemoteFolderMeta：远端父关系若成环则保持原父（不把环写进本地树）", () => {
    const { dir, store } = freshStore();
    try {
      insertNode(store, "nb", null, "notebook");
      insertNode(store, "a", "nb", "group");
      insertNode(store, "b", "a", "group");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        // 远端把 a 挂到它的子孙 b 下 ⇒ 环
        store.applyRemoteFolderMeta(folder("a", "b", "2026-11-06T00:00:00.000Z"));
      } finally {
        warn.mockRestore();
      }
      const row = dbOf(store).prepare("SELECT parent_id FROM tree_nodes WHERE id='a'").get() as { parent_id: string | null };
      expect(row.parent_id).toBe("nb");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
