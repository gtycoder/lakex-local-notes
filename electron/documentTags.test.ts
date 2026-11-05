import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

/**
 * 261105 P1：文档标签关系（主库 tag_links/versions, target_kind='note'）单测。
 * 目录不在本服务（单一来源 = quick-notes 库 tags）；这里只测关系集合/版本/LWW/删除/合并/孤儿清理。
 */
const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const T3 = "2026-11-03T00:00:00.000Z";

async function freshStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-doctags-"));
  const store = new Store(root);
  store.bootstrap();
  const nb = store.createNotebook("NB");
  store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
  return { root, store };
}

describe("文档标签关系（主库，261105 P1）", () => {
  it("整组替换 + 关系版本推进；保留传入顺序（本机视图）", async () => {
    const { root, store } = await freshStore();
    try {
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual([]);
      expect(store.documentTags.setNoteTags("n1", ["t_aaaaaaaaaaaaaaaa", "t_bbbbbbbbbbbbbbbb"], T1)).toEqual(["t_aaaaaaaaaaaaaaaa", "t_bbbbbbbbbbbbbbbb"]);
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_aaaaaaaaaaaaaaaa", "t_bbbbbbbbbbbbbbbb"]);
      expect(store.documentTags.tagsUpdatedAt("n1")).toBe(T1);
      expect(store.documentTags.setNoteTags("n1", ["t_bbbbbbbbbbbbbbbb", "t_aaaaaaaaaaaaaaaa"], T2)).toEqual(["t_bbbbbbbbbbbbbbbb", "t_aaaaaaaaaaaaaaaa"]);
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_bbbbbbbbbbbbbbbb", "t_aaaaaaaaaaaaaaaa"]);
      expect(store.documentTags.listAll().get("n1")).toEqual(["t_bbbbbbbbbbbbbbbb", "t_aaaaaaaaaaaaaaaa"]);
      expect(store.documentTags.allTagsUpdatedAt().get("n1")).toBe(T2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("applyRemote LWW：版本旧不动；版本新 ⇒ 保留本机顺序、远端新增插最前（目录过滤交给 cleanupOrphans）", async () => {
    const { root, store } = await freshStore();
    try {
      store.documentTags.setNoteTags("n1", ["t_bbbbbbbbbbbbbbbb"], T2);
      expect(store.documentTags.applyRemote("n1", ["t_cccccccccccccccc"], T1)).toBe(false);
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_bbbbbbbbbbbbbbbb"]);
      expect(store.documentTags.applyRemote("n1", ["t_3333333333333333", "t_cccccccccccccccc", "t_bbbbbbbbbbbbbbbb"], T3)).toBe(true);
      // 新增插最前（本机顺序保留）；目录不存在的 id 由后续 cleanupOrphans 收敛。
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_3333333333333333", "t_cccccccccccccccc", "t_bbbbbbbbbbbbbbbb"]);
      expect(store.documentTags.tagsUpdatedAt("n1")).toBe(T3);
      expect(store.documentTags.cleanupOrphans(new Set(["t_bbbbbbbbbbbbbbbb", "t_cccccccccccccccc"]), "2026-11-05T00:00:00.000Z").links).toBe(1);
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_cccccccccccccccc", "t_bbbbbbbbbbbbbbbb"]);
      expect(store.documentTags.applyRemote("n1", [], "2026-11-06T00:00:00.000Z")).toBe(true);
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("删除标签：清该标签全部文档关系并推进受影响文档版本（删除可传播）", async () => {
    const { root, store } = await freshStore();
    try {
      store.documentTags.setNoteTags("n1", ["t_aaaaaaaaaaaaaaaa", "t_bbbbbbbbbbbbbbbb"], T1);
      expect(store.documentTags.removeTag("t_aaaaaaaaaaaaaaaa", T2)).toBe(1);
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_bbbbbbbbbbbbbbbb"]);
      expect(store.documentTags.tagsUpdatedAt("n1")).toBe(T2);
      expect(store.documentTags.removeTag("t_missing")).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("合并标签：源关系改指目标（去重、保留位置）并推进版本", async () => {
    const { root, store } = await freshStore();
    try {
      store.documentTags.setNoteTags("n1", ["t_aaaaaaaaaaaaaaaa", "t_bbbbbbbbbbbbbbbb"], T1);
      expect(store.documentTags.mergeTag("t_aaaaaaaaaaaaaaaa", "t_bbbbbbbbbbbbbbbb", T2)).toBe(1);
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_bbbbbbbbbbbbbbbb"]);
      expect(store.documentTags.tagsUpdatedAt("n1")).toBe(T2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("启动自检：清理指向不存在标签的孤儿关系并推进版本（干净库零工作）", async () => {
    const { root, store } = await freshStore();
    try {
      store.documentTags.setNoteTags("n1", ["t_1111111111111111", "t_2222222222222222"], T1);
      store.documentTags.setNoteTags("n2", ["t_1111111111111111"], T1);
      expect(store.documentTags.cleanupOrphans(new Set(["t_1111111111111111"]), T2)).toEqual({ links: 1, tags: 1 });
      expect(store.documentTags.getDocumentTagIds("n1")).toEqual(["t_1111111111111111"]);
      expect(store.documentTags.tagsUpdatedAt("n1")).toBe(T2);
      expect(store.documentTags.getDocumentTagIds("n2")).toEqual(["t_1111111111111111"]);
      expect(store.documentTags.cleanupOrphans(new Set(["t_1111111111111111"]), T3)).toEqual({ links: 0, tags: 0 });
      expect(store.documentTags.tagsUpdatedAt("n2")).toBe(T1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
