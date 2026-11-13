import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";

/**
 * 回收站恢复的**空间正确性**（261110）：日记条目在原父已删/也在回收站时，
 * 必须回日记空间（space=diary 的笔记本），**不能落进默认笔记本（文档空间）**。
 * 判据只认「原始父链命中 diary 笔记本」，不看标题。
 */
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return { secrets, getEncryptionAvailable() { return true; } };
});
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => electronMock.getEncryptionAvailable(),
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (buf: Buffer) => electronMock.secrets.get(buf.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

let dir: string;
let store: Store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-trash-diary-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
});

function parentOf(id: string): string | null {
  const node = store.listTreeNodes().find((n) => n.id === id) ?? store.listTreeNodes().find((n) => n.noteFileId === id);
  return node?.parentId ?? null;
}

describe("回收站恢复：日记条目回日记空间（261110）", () => {
  it("原父（月分组）也进回收站时，恢复回到日记本而不是默认笔记本", () => {
    // 日记空间内部创建只允许走 diary_open_date（task-104 F-05 起 create_group/create_note_in 对日记目标闭门）。
    const opened = store.openDiaryDate("2026-11-09");
    const diary = { id: opened.notebookId };
    const month = store.listTreeNodes().find((n) => n.id === store.listTreeNodes().find((x) => x.id === opened.noteId)?.parentId)!;
    const note = { id: opened.noteId };
    // 先删文档（回收站根），再删它所在的分组（月分组也进回收站）⇒ 原父不可用
    store.deleteTreeNode(note.id);
    store.deleteTreeNode(month.id);
    store.restoreTrashItem(note.id);
    // 原路返回：按标题日期把 年/月 分组补回来（日记 → 2026 → 11 → 文档）
    const nodes = () => store.listTreeNodes();
    const parent = nodes().find((n) => n.id === parentOf(note.id));
    expect(parent?.nodeType).toBe("group");
    expect(parent?.title).toBe("11");
    const yearNode = nodes().find((n) => n.id === parent?.parentId);
    expect(yearNode?.title).toBe("2026");
    expect(yearNode?.parentId).toBe(diary.id);
  });

  it("普通文档（非日记）同样场景仍回落默认笔记本（旧行为不变）", () => {
    const notebook = store.createNotebook("工作");
    const group = store.createGroup(notebook.id, "项目");
    const note = store.createNoteIn(group.id, "普通文档");
    store.deleteTreeNode(note.id);
    store.deleteTreeNode(group.id);
    store.restoreTrashItem(note.id);
    const parent = parentOf(note.id);
    expect(parent).not.toBeNull();
    const parentNode = store.listTreeNodes().find((n) => n.id === parent);
    expect(parentNode?.nodeType).toBe("notebook");
    expect(parentNode?.id).not.toBe(notebook.id);
  });

  it("回收站列表给日记条目打 fromDiary，普通日期标题文档不打（不看标题）", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const diaryNote = { id: opened.noteId };
    const work = store.createNotebook("工作");
    const fakeDateDoc = store.createNoteIn(work.id, "2026-11-10");
    store.deleteTreeNode(diaryNote.id);
    store.deleteTreeNode(fakeDateDoc.id);
    const items = store.listTrash();
    expect(items.find((item) => item.id === diaryNote.id || item.noteFileId === diaryNote.id)?.fromDiary).toBe(true);
    expect(items.find((item) => item.id === fakeDateDoc.id || item.noteFileId === fakeDateDoc.id)?.fromDiary).toBe(false);
  });
});
