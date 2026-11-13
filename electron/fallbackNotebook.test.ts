/**
 * 261113（#8）：兜底「未分类」笔记本 = **固定 id**（跨端同一本）+ 一次性收编旧随机 id。
 *
 * 背景：旧实现每端各自 uuid() 建一本「未分类」并当普通笔记本同步 ⇒ 云端累积同名分组、
 * 孤儿文档父关系在两端之间来回翻。判据（保护用户数据）：
 *  · 兜底新建一律 notebook-uncategorized；
 *  · 只有当「本地恰好只有一本笔记本、且它就叫未分类」时才把它收编成固定 id（子树/文档只改父指针）；
 *  · 本地有多本笔记本时绝不收编（用户自建的同名本原样保留）。
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
function rawDb(): RawDb {
  return (store as unknown as { db: RawDb }).db;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-fallback-nb-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
});

/** 去掉所有笔记本，模拟「用户把笔记本都删了、文档成了孤儿」的兜底态（欢迎笔记行保留，父悬空）。 */
function dropAllNotebooks(): void {
  rawDb().prepare("DELETE FROM tree_nodes WHERE node_type='notebook'").run();
}

describe("261113 #8：兜底「未分类」固定 id 与一次性收编", () => {
  it("没有笔记本时兜底新建用固定 id，根文档落在它下面", () => {
    dropAllNotebooks();
    const created = store.createNote("第一篇孤儿");
    const nb = store.listTreeNodes().filter((n) => n.nodeType === "notebook");
    expect(nb).toHaveLength(1);
    expect(nb[0].id).toBe(FIXED);
    expect(nb[0].title).toBe("未分类");
    expect(store.listNotesForSync().find((n) => n.id === created.id)!.parentId).toBe(FIXED);
  });

  it("唯一一本旧随机 id 的「未分类」被一次性收编（子树/文档只改父指针）", () => {
    dropAllNotebooks();
    const legacy = store.createNotebook("未分类"); // 旧实现：随机 id
    expect(legacy.id).not.toBe(FIXED);
    const child = store.createNoteIn(legacy.id, "孤儿文档");
    store.saveNote(child.id, "孤儿文档", "<p>x</p>");
    // 触发兜底：建一篇根文档
    const fresh = store.createNote("新根文档");
    const nodes = store.listTreeNodes();
    expect(nodes.find((n) => n.id === FIXED)?.title).toBe("未分类");
    expect(nodes.some((n) => n.id === legacy.id)).toBe(false);
    expect(store.listNotesForSync().find((n) => n.id === child.id)!.parentId).toBe(FIXED);
    expect(store.listNotesForSync().find((n) => n.id === fresh.id)!.parentId).toBe(FIXED);
    // 幂等：再来一次不新增、也不再收编出第二本
    store.createNote("第二篇根文档");
    expect(store.listTreeNodes().filter((n) => n.title === "未分类")).toHaveLength(1);
  });

  it("守卫：本地有多本笔记本时绝不做收编（用户自建同名本原样保留）", () => {
    dropAllNotebooks();
    const userBook = store.createNotebook("未分类"); // 用户自建，恰好同名
    store.createNotebook("工作");
    const created = store.createNote("根文档");
    // 不收编：不出现固定 id；用户那本原样在
    expect(store.listTreeNodes().some((n) => n.id === FIXED)).toBe(false);
    expect(store.listTreeNodes().some((n) => n.id === userBook.id)).toBe(true);
    expect(store.listNotesForSync().find((n) => n.id === created.id)!.parentId).not.toBeNull();
  });
});
