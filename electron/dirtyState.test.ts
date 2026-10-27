import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

describe("UI dirty 状态（v3 发布后清 0）", () => {
  it("新建/编辑置 dirty；markNotesSynced 清 0", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-dirty-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "D", "<p>x</p>", [], "d1");
    expect(store.listNoteSummaries().find((n) => n.id === "d1")?.isDirty).toBe(true);
    store.markNotesSynced(["d1"]);
    expect(store.listNoteSummaries().find((n) => n.id === "d1")?.isDirty).toBeUndefined();
    store.saveNote("d1", "D2", "<p>y</p>");
    expect(store.listNoteSummaries().find((n) => n.id === "d1")?.isDirty).toBe(true);
  });
});
