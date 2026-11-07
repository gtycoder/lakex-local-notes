import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

async function freshStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lake-sync-window-"));
  const store = new Store(root);
  store.bootstrap();
  const nb = store.createNotebook("NB");
  store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
  return { root, store, nb };
}

function metaOf(store: Store, id: string) {
  const meta = store.listNotesSyncMeta().find((entry) => entry.id === id);
  if (!meta) throw new Error("note not found: " + id);
  return meta;
}

describe("同步窗口元数据守卫（261107 数据安全）", () => {
  it("干净行：远端元数据正常应用", async () => {
    const { root, store, nb } = await freshStore();
    try {
      store.markNotesSynced(["n1"]);
      const before = metaOf(store, "n1").updatedAt;
      store.applyRemoteNoteMeta({ id: "n1", title: "Remote", parentId: nb.id, sortOrder: 3, updatedAt: "2026-11-07T00:00:00.000Z", isConflict: false }, before);
      const meta = metaOf(store, "n1");
      expect(meta.title).toBe("Remote");
      expect(meta.sortOrder).toBe(3);
      expect(meta.updatedAt).toBe("2026-11-07T00:00:00.000Z");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("窗口内本地改名（dirty）：远端旧元数据不得覆盖本地", async () => {
    const { root, store, nb } = await freshStore();
    try {
      store.markNotesSynced(["n1"]);
      const snapshotUpdatedAt = metaOf(store, "n1").updatedAt;
      store.renameTreeNode("n1", "Local in window");
      expect(store.getSyncPendingSummary().documents).toBeGreaterThan(0);
      // 引擎传入的是本轮开始时的本地快照 updatedAt；窗口内改名后当前行已不等于它 ⇒ 不覆盖。
      store.applyRemoteNoteMeta({ id: "n1", title: "Remote old", parentId: nb.id, sortOrder: 0, updatedAt: "2026-11-07T00:00:00.000Z", isConflict: false }, snapshotUpdatedAt);
      const meta = metaOf(store, "n1");
      expect(meta.title).toBe("Local in window");
      expect(store.getSyncPendingSummary().documents).toBeGreaterThan(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
