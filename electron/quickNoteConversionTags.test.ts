/**
 * 261105 P1 追加：小记 → 正式文档转换时**继承小记标签**。
 * 转换成功后把源小记的关系复制到 target_kind='note'（id 稳定：目标文档 id），并 bump 关系版本；
 * 无标签的小记不受影响；源小记按既有转换语义删除（tombstone）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = "k" + electronMock.secrets.size; electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "./store.js";
import { QuickNotesStore } from "./quickNotes.js";
import { convertQuickNoteToLake } from "./quickNoteConversion.js";

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-convert-tags-"));
  const store = new Store(root);
  store.bootstrap();
  const quickNotes = new QuickNotesStore(root);
  const notebook = store.createNotebook("NB");
  return { root, store, quickNotes, notebook };
}

describe("小记 → 文档转换继承标签（261105 P1）", () => {
  it("转换带标签：目标文档复制小记关系（bump 版本），源小记按既有语义清理", () => {
    const { root, store, quickNotes, notebook } = fresh();
    try {
      const tagA = quickNotes.tagService.create("项目");
      const tagB = quickNotes.tagService.create("重要");
      const note = quickNotes.createQuickNote({ text: "带标签小记", draftId: "d-conv", stagedImageIds: [] });
      quickNotes.setQuickNoteTags(note.id, [tagA.id, tagB.id]);
      const target = convertQuickNoteToLake(quickNotes, store, note.id, notebook.id);
      expect(store.documentTags.getDocumentTagIds(target.id)).toEqual([tagA.id, tagB.id]);
      expect(store.documentTags.tagsUpdatedAt(target.id)).not.toBe("");
      expect(quickNotes.listQuickNotes().some((item) => item.id === note.id)).toBe(false);
      expect(quickNotes.listAllDeleted().map((item) => item.id)).toContain(note.id);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("无标签小记转换不受影响：目标无文档关系、其它文档关系不变", () => {
    const { root, store, quickNotes, notebook } = fresh();
    try {
      const tag = quickNotes.tagService.create("保留");
      const plain = quickNotes.createQuickNote({ text: "无标签小记", draftId: "d-plain", stagedImageIds: [] });
      const tagged = quickNotes.createQuickNote({ text: "有标签小记", draftId: "d-tagged", stagedImageIds: [] });
      quickNotes.setQuickNoteTags(tagged.id, [tag.id]);
      const taggedTarget = convertQuickNoteToLake(quickNotes, store, tagged.id, notebook.id);
      const plainTarget = convertQuickNoteToLake(quickNotes, store, plain.id, notebook.id);
      expect(store.documentTags.getDocumentTagIds(plainTarget.id)).toEqual([]);
      expect(store.documentTags.getDocumentTagIds(taggedTarget.id)).toEqual([tag.id]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
