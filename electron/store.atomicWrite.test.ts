import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";

// ===== electron mock（Store 模块加载即需要）=====
const electronMock = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
    secrets,
  };
});
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-store-atomic-"));
  electronMock.secrets.clear();
  store = new Store(dir, createSafeStorageSecretCipher());
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 递归找出临时文件残留（.tmp- 前缀由原子写产生）。 */
function tmpLeftovers(root: string): string[] {
  const found: string[] = [];
  const walk = (p: string) => {
    for (const name of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.includes(".tmp-")) found.push(full);
    }
  };
  walk(root);
  return found;
}

describe("桌面 atomicWrite 补 fsync（261105 Batch3-C）", () => {
  it("writeRestoredBody：内容完整落盘，且不残留 tmp", () => {
    store.writeRestoredBody("note-atomic-1", "正文内容-content");
    const target = path.join(dir, "notes", "note-atomic-1.lake");
    expect(fs.readFileSync(target, "utf8")).toBe("正文内容-content");
    expect(tmpLeftovers(dir)).toEqual([]);
  });

  it("saveNote：走同一条原子写（有 fsync 调用），保存后无 tmp 残留", () => {
    const { id } = store.createNote("原子写测试");
    const fsyncSpy = vi.spyOn(fs, "fsyncSync");
    let fsyncCalls = 0;
    try {
      store.saveNote(id, "原子写测试", "<p>保存后的正文</p>");
      fsyncCalls = fsyncSpy.mock.calls.length; // mockRestore 会清空 calls，先取值
    } finally {
      fsyncSpy.mockRestore();
    }
    expect(fs.readFileSync(path.join(dir, "notes", `${id}.lake`), "utf8")).toBe("<p>保存后的正文</p>");
    // 写 tmp 的 fsync + rename 后的目录 fsync（目录 fsync 在 win32 跳过，其它平台至少两次）
    expect(fsyncCalls).toBeGreaterThanOrEqual(process.platform === "win32" ? 1 : 2);
    expect(tmpLeftovers(dir)).toEqual([]);
  });

  it("rename 失败：不留目标文件、清理 tmp，错误照常抛出", () => {
    const original = fs.renameSync;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(from).includes("note-atomic-fail.lake.tmp-")) throw new Error("injected rename failure");
      return original(from, to);
    }) as typeof fs.renameSync);
    try {
      expect(() => store.writeRestoredBody("note-atomic-fail", "x")).toThrow("injected rename failure");
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(path.join(dir, "notes", "note-atomic-fail.lake"))).toBe(false);
    expect(tmpLeftovers(dir)).toEqual([]);
  });

  it("写入阶段失败（fsync 抛错）：清理 tmp、不产生目标文件", () => {
    const spy = vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw new Error("injected fsync failure");
    });
    try {
      expect(() => store.writeRestoredBody("note-atomic-fsync", "x")).toThrow("injected fsync failure");
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(path.join(dir, "notes", "note-atomic-fsync.lake"))).toBe(false);
    expect(tmpLeftovers(dir)).toEqual([]);
  });
});
