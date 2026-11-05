import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

describe("文档标签（tag_links target_kind=note）", () => {
  it("创建标签、给文档打标签、关系版本、删除标签清关联", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-doctags-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
    const t1 = store.documentTags.create("工作");
    const t2 = store.documentTags.create("重要");
    expect(store.documentTags.getDocumentTagIds("n1")).toEqual([]);
    store.documentTags.setDocumentTags("n1", [t1.id, t2.id]);
    expect(store.documentTags.getDocumentTagIds("n1")).toEqual([t1.id, t2.id]);
    expect(store.documentTags.tagsUpdatedAt("n1")).not.toBe("");
    // 删除标签（261105「删除 = 缺席」）：目录行物理删除 + 关联/版本清除，不写墓碑
    store.documentTags.delete(t1.id);
    expect(store.documentTags.getDocumentTagIds("n1")).toEqual([t2.id]);
    expect(store.documentTags.list().map((t) => t.name)).toEqual(["重要"]);
    expect(store.documentTags.tagsUpdatedAt("n1")).toBe("");
    // 同名重建不撞主键（派生 ID 与刚删的相同也不会冲突）
    expect(store.documentTags.create("工作").id).toBe(t1.id);
  });

  it("合并标签：关联改指向目标、源标签物理删除", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-doctags-merge-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
    const a = store.documentTags.create("A");
    const b = store.documentTags.create("B");
    store.documentTags.setDocumentTags("n1", [a.id]);
    store.documentTags.merge(a.id, b.id);
    expect(store.documentTags.getDocumentTagIds("n1")).toEqual([b.id]);
    expect(store.documentTags.list().map((t) => t.name)).toEqual(["B"]);
  });
});
