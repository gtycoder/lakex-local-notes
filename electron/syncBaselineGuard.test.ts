import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

async function freshStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lake-baseline-guard-"));
  const store = new Store(root);
  store.bootstrap();
  const nb = store.createNotebook("NB");
  store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
  return { root, store };
}

function updatedAtOf(store: Store, id: string): string {
  const meta = store.listNotesSyncMeta().find((entry) => entry.id === id);
  if (!meta) throw new Error("note not found: " + id);
  return meta.updatedAt;
}

describe("saveBaseline 守卫式归位（261107 数据安全）", () => {
  it("本地 updated_at 仍等于基线快照 → 清 dirty；窗口内改名 → 保持待同步", async () => {
    const { root, store } = await freshStore();
    try {
      const before = updatedAtOf(store, "n1");
      const pendingBefore = store.getSyncPendingSummary().documents;
      expect(pendingBefore).toBeGreaterThan(0);
      expect(store.markNotesSyncedIfUnchanged([{ id: "n1", updatedAt: before }])).toEqual({ cleared: 1, kept: 0 });
      // 只归位这一篇：窗口内其它脏行（如有）不受影响。
      expect(store.getSyncPendingSummary().documents).toBe(pendingBefore - 1);

      // 模拟同步窗口内改名：updated_at 变了，旧 baseline 不得把它标 synced。
      store.renameTreeNode("n1", "Renamed in window");
      const after = updatedAtOf(store, "n1");
      expect(after).not.toBe(before);
      expect(store.markNotesSyncedIfUnchanged([{ id: "n1", updatedAt: before }])).toEqual({ cleared: 0, kept: 1 });
      expect(store.getSyncPendingSummary().documents).toBeGreaterThan(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("窗口内从回收站恢复 → restore_pending_at 不被旧基线清掉", async () => {
    const { root, store } = await freshStore();
    try {
      const before = updatedAtOf(store, "n1");
      store.markNotesSyncedIfUnchanged([{ id: "n1", updatedAt: before }]);
      store.deleteNote("n1");
      store.restoreTrashItem("n1");
      expect(store.listRestorePendingNoteIds()).toContain("n1");
      const result = store.markNotesSyncedIfUnchanged([{ id: "n1", updatedAt: before }]);
      expect(result.kept).toBe(1);
      expect(store.listRestorePendingNoteIds()).toContain("n1");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
