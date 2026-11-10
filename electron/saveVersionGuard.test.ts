import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";
import { noteBodyHash } from "./noteBodyHash.js";
import { noteBodyRelativePath } from "../src/core/noteBodyPaths.js";
import { SAVE_CONFLICT_CODE, isSaveConflict } from "../src/lib/types.js";

// ===== electron mock（Store 模块加载即需要） =====
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return { secrets, getEncryptionAvailable() { return true; } };
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-save-guard-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
});

function bodyPath(id: string): string {
  return path.join(dir, noteBodyRelativePath("doc", id));
}

/** 直读 DB 行（验证冲突时"不写盘也不动元数据"）。 */
function noteRow(id: string): { updated_at: string; is_dirty: number } {
  const db = new Database(path.join(dir, "metadata.sqlite3"), { readonly: true });
  try {
    return db.prepare("SELECT updated_at, is_dirty FROM notes WHERE id=?").get(id) as { updated_at: string; is_dirty: number };
  } finally {
    db.close();
  }
}

describe("保存版本守卫（Batch4-D：外部/他端改过正文时不静默覆盖）", () => {
  it("readNote 回传正文 sha256；saveNoteVersioned 成功后回传新 hash", () => {
    const note = store.createNote("守卫");
    store.saveNote(note.id, "守卫", "<p>v1</p>");
    const read = store.readNote(note.id);
    expect(read.contentHash).toBe(crypto.createHash("sha256").update("<p>v1</p>", "utf8").digest("hex"));
    const saved = store.saveNoteVersioned(note.id, "守卫", "<p>v2</p>", undefined, read.contentHash);
    expect("contentHash" in saved && saved.contentHash).toBe(noteBodyHash("<p>v2</p>"));
  });

  it("磁盘 hash ≠ baseHash ⇒ 不写盘、不动元数据，返回结构化 conflict", () => {
    const note = store.createNote("守卫");
    store.saveNote(note.id, "守卫", "<p>原正文</p>");
    const baseHash = store.readNote(note.id).contentHash!;
    // 模拟外部写入（另一窗口/同步/外部工具）
    fs.writeFileSync(bodyPath(note.id), "<p>外部改过的正文</p>", "utf8");
    const before = noteRow(note.id);

    const result = store.saveNoteVersioned(note.id, "守卫", "<p>我的本地修改</p>", undefined, baseHash);
    expect("code" in result && result.code).toBe(SAVE_CONFLICT_CODE);
    expect(result).toMatchObject({ ok: false, noteId: note.id, diskHash: noteBodyHash("<p>外部改过的正文</p>") });
    // 磁盘正文原样保留（不静默覆盖）
    expect(fs.readFileSync(bodyPath(note.id), "utf8")).toBe("<p>外部改过的正文</p>");
    // DB 也不动：updated_at / is_dirty 保持不变（冲突 == 这次保存没发生）
    expect(noteRow(note.id)).toEqual(before);
  });

  it("baseHash 相符 ⇒ 正常写入", () => {
    const note = store.createNote("守卫");
    store.saveNote(note.id, "守卫", "<p>v1</p>");
    const baseHash = store.readNote(note.id).contentHash!;
    const result = store.saveNoteVersioned(note.id, "守卫标题", "<p>v2</p>", undefined, baseHash);
    expect("content" in result && result.content).toBe("<p>v2</p>");
    expect(fs.readFileSync(bodyPath(note.id), "utf8")).toBe("<p>v2</p>");
    expect(store.readNote(note.id).title).toBe("守卫标题");
  });

  it("内容与磁盘一致时即使 baseHash 陈旧也不弹冲突（本来就不写正文）", () => {
    const note = store.createNote("守卫");
    store.saveNote(note.id, "守卫", "<p>same</p>");
    fs.writeFileSync(bodyPath(note.id), "<p>same</p>", "utf8"); // 外部写入了同一内容
    const staleBaseHash = "c".repeat(64);
    const result = store.saveNoteVersioned(note.id, "守卫", "<p>same</p>", undefined, staleBaseHash);
    expect("ok" in result ? result.ok : true).not.toBe(false);
    expect("content" in result && result.content).toBe("<p>same</p>");
    expect(fs.readFileSync(bodyPath(note.id), "utf8")).toBe("<p>same</p>");
  });


  it("竞态自愈：磁盘已是同一份内容 ⇒ 不判冲突、不重复写盘（261110 现场误报）", () => {
    const note = store.createNote("竞态");
    const same = "<p>同一份正文</p>";
    store.saveNote(note.id, "竞态", same);
    const before = fs.readFileSync(bodyPath(note.id), "utf8");
    // 渲染层拿的是**过期** baseHash（另一次保存/同步已先落盘同一份），内容并未被他处改过
    const staleBaseHash = noteBodyHash("<p>旧版本</p>");
    const result = store.saveNoteVersioned(note.id, "竞态", same, undefined, staleBaseHash);
    // 成功 = 返回 NoteDocument（不是冲突对象）
    expect(isSaveConflict(result)).toBe(false);
    expect("contentHash" in result && result.contentHash).toBe(noteBodyHash(same));
    expect(fs.readFileSync(bodyPath(note.id), "utf8")).toBe(before);
  });
  it("竞态自愈但标题变了 ⇒ 照常落标题（不能静默丢改名）", () => {
    const note = store.createNote("旧标题");
    const same = "<p>同一份正文</p>";
    store.saveNote(note.id, "旧标题", same);
    const staleBaseHash = noteBodyHash("<p>更旧的版本</p>");
    const result = store.saveNoteVersioned(note.id, "新标题", same, undefined, staleBaseHash);
    expect(isSaveConflict(result)).toBe(false);
    expect(store.readNote(note.id).title).toBe("新标题");
    expect(store.listTreeNodes().find((n) => n.noteFileId === note.id)?.title).toBe("新标题");
  });

  it("未提供 baseHash ⇒ 旧行为（无条件写，逐字节一致回归）", () => {
    const note = store.createNote("守卫");
    store.saveNote(note.id, "守卫", "<p>v1</p>");
    fs.writeFileSync(bodyPath(note.id), "<p>外部改过的正文</p>", "utf8");
    const result = store.saveNoteVersioned(note.id, "守卫", "<p>v2</p>");
    expect("content" in result && result.content).toBe("<p>v2</p>");
    expect(fs.readFileSync(bodyPath(note.id), "utf8")).toBe("<p>v2</p>");
    // 老签名同样不受影响
    expect(store.saveNote(note.id, "守卫", "<p>v3</p>").content).toBe("<p>v3</p>");
  });

  it("既有 fail-closed 不变：不存在/回收站/缺正文仍抛（不是冲突码）", () => {
    expect(() => store.saveNoteVersioned("missing-note", "T", "<p>x</p>")).toThrowError(/笔记不存在/);
    const trashed = store.createNote("回收站");
    store.saveNote(trashed.id, "回收站", "<p>v1</p>");
    store.deleteTreeNode(trashed.id);
    expect(() => store.saveNoteVersioned(trashed.id, "回收站", "<p>v2</p>")).toThrowError(/回收站/);
    const missingBody = store.createNote("缺正文");
    store.saveNote(missingBody.id, "缺正文", "<p>v1</p>");
    fs.rmSync(bodyPath(missingBody.id));
    expect(() => store.saveNoteVersioned(missingBody.id, "缺正文", "<p>v2</p>")).toThrowError(/笔记不存在/);
  });

  it("冲突后可「覆盖磁盘」：带上 diskHash 重试即写入", () => {
    const note = store.createNote("守卫");
    store.saveNote(note.id, "守卫", "<p>v1</p>");
    const baseHash = store.readNote(note.id).contentHash!;
    fs.writeFileSync(bodyPath(note.id), "<p>外部版本</p>", "utf8");
    const conflict = store.saveNoteVersioned(note.id, "守卫", "<p>本地版本</p>", undefined, baseHash);
    expect("diskHash" in conflict && conflict.diskHash).toBeTruthy();
    const diskHash = (conflict as { diskHash: string }).diskHash;
    const retried = store.saveNoteVersioned(note.id, "守卫", "<p>本地版本</p>", undefined, diskHash);
    expect("content" in retried && retried.content).toBe("<p>本地版本</p>");
    expect(fs.readFileSync(bodyPath(note.id), "utf8")).toBe("<p>本地版本</p>");
  });
});
