/**
 * 261113（#8，用户裁决「认 id 不认名字」）：兜底「未分类」笔记本 = **固定 id**（跨端同一本）。
 *
 * 规则：
 *  · 兜底新建一律 `notebook-uncategorized`（跨端同一本，云端不会各建一份）；
 *  · 用户自己建的笔记本（哪怕标题也叫「未分类」、哪怕本地只有这一本）**一律不动** ——
 *    名称允许重复，判据只认 id；旧版随机 id 的兜底不做迁移（不碰用户数据，多一本同名本无害）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";

const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
    secrets,
    getEncryptionAvailable: () => true,
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

const FIXED = "notebook-uncategorized";
let dir: string;
let store: Store;

type RawDb = import("better-sqlite3").Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-fallback-nb-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
});

/** 去掉所有笔记本，模拟「用户把笔记本都删了、文档成了孤儿」的兜底态。 */
function dropAllNotebooks(): void {
  (store as unknown as { db: RawDb }).db.prepare("DELETE FROM tree_nodes WHERE node_type='notebook'").run();
}

describe("261113 #8：兜底「未分类」固定 id（认 id 不认名字）", () => {
  it("没有笔记本时兜底新建用固定 id，根文档落在它下面", () => {
    dropAllNotebooks();
    const created = store.createNote("第一篇孤儿");
    const nb = store.listTreeNodes().filter((n) => n.nodeType === "notebook");
    expect(nb).toHaveLength(1);
    expect(nb[0].id).toBe(FIXED);
    expect(nb[0].title).toBe("未分类");
    expect(store.listNotesForSync().find((n) => n.id === created.id)!.parentId).toBe(FIXED);
  });

  it("用户自建的「未分类」（唯一一本、随机 id）一律不动：不改 id、不删、不新建固定本", () => {
    dropAllNotebooks();
    const userBook = store.createNotebook("未分类"); // 用户自建，恰好同名
    expect(userBook.id).not.toBe(FIXED);
    const child = store.createNoteIn(userBook.id, "用户文档");
    store.saveNote(child.id, "用户文档", "<p>x</p>");
    const created = store.createNote("根文档");
    // 不建固定兜底、不动用户那本
    expect(store.listTreeNodes().some((n) => n.id === FIXED)).toBe(false);
    expect(store.listTreeNodes().some((n) => n.id === userBook.id && n.title === "未分类")).toBe(true);
    expect(store.listTreeNodes().filter((n) => n.nodeType === "notebook")).toHaveLength(1);
    // 新文档挂在既有本下、父指针不为空
    expect(store.listNotesForSync().find((n) => n.id === created.id)!.parentId).toBe(userBook.id);
    // 用户文档原样
    expect(store.listNotesForSync().find((n) => n.id === child.id)!.parentId).toBe(userBook.id);
  });

  it("多本笔记本（含同名未分类）同样不动用户数据", () => {
    dropAllNotebooks();
    const userBook = store.createNotebook("未分类");
    const work = store.createNotebook("工作");
    const created = store.createNote("根文档");
    expect(store.listTreeNodes().some((n) => n.id === FIXED)).toBe(false);
    expect(store.listTreeNodes().some((n) => n.id === userBook.id)).toBe(true);
    expect(store.listTreeNodes().some((n) => n.id === work.id)).toBe(true);
    expect(store.listTreeNodes().filter((n) => n.nodeType === "notebook")).toHaveLength(2);
    expect(store.listNotesForSync().find((n) => n.id === created.id)!.parentId).not.toBeNull();
  });
});
