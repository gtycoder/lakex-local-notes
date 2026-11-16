import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { createSafeStorageSecretCipher } from "./secretCipher.js";

/**
 * 261118 用户问题：云端正文存 19876、本机实例跑 19888（端口回退/多实例）时，
 * 渲染/编辑是否会因为「URL 端口不同」而把整篇文档标成变更 → 触发 S3 上传？
 *
 * 期望（已在 store 保存收口实现）：用户写路径保存前把本地资产 URL 归一为规范端口 19876 并去掉运行时 token。
 * 因此：只要用户没有真实改动内容，无论捕获到的是哪个实例端口的正文，落盘字节与 contentHash 都保持一致
 * ⇒ 不会因为端口不同触发同步更新。这里从行为面钉住。
 */
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

let dir: string;
let store: Store;
let noteId: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-asset-port-test-"));
  store = new Store(dir, createSafeStorageSecretCipher());
  store.bootstrap();
  noteId = store.createNote("端口归一").id;
});

function diskBody(): string {
  return fs.readFileSync(path.join(dir, "notes", noteId + ".lake"), "utf8");
}

function bodyWithPort(port: number, token: string | null, encoded = false): string {
  if (encoded) {
    // 内核卡片 JSON 的百分号编码形态
    return '<p>encoded</p><div data-value="http%3A%2F%2F127.0.0.1%3A' + port + '%2F' + noteId + '%2Fimg.png"></div>';
  }
  const query = token ? "?token=" + token : "";
  return '<p>图片</p><img src="http://127.0.0.1:' + port + "/" + noteId + "/img.png" + query + '">';
}

describe("保存时的资产 URL 规范端口（261118）", () => {
  it("落盘 = 规范端口 19876 且不带运行时 token（裸 URL）", () => {
    store.saveNote(noteId, "端口归一", bodyWithPort(19888, "tok-abc"));
    const body = diskBody();
    expect(body).toContain("127.0.0.1:19876/" + noteId + "/img.png");
    expect(body).not.toContain("19888");
    expect(body).not.toContain("token=");
  });

  it("内核卡片百分号编码形态同样归一（只改端口、不破坏编码）", () => {
    store.saveNote(noteId, "端口归一", bodyWithPort(19877, null, true));
    const body = diskBody();
    expect(body).toContain("%3A19876%2F" + noteId + "%2Fimg.png");
    expect(body).not.toContain("%3A19877%2F");
  });

  const diskHash = (): string => crypto.createHash("sha256").update(diskBody()).digest("hex");

  it("同一内容只换实例端口/ token ⇒ 落盘 hash 不变（不会触发同步更新）", () => {
    store.saveNote(noteId, "端口归一", bodyWithPort(19888, "tok-a"));
    const first = diskHash();
    store.saveNote(noteId, "端口归一", bodyWithPort(19877, "tok-b"));
    expect(diskHash()).toBe(first);

    // 幂等：再次保存规范正文 hash 仍不变
    store.saveNote(noteId, "端口归一", bodyWithPort(19876, null));
    expect(diskHash()).toBe(first);
  });

  it("真实内容改动仍然会变 hash（归一化没有把编辑吞掉）", () => {
    store.saveNote(noteId, "端口归一", bodyWithPort(19888, "tok-a"));
    const before = diskHash();
    store.saveNote(noteId, "端口归一", bodyWithPort(19888, "tok-a").replace("图片", "图片（改）"));
    expect(diskHash()).not.toBe(before);
  });

  it("非资产的本机服务 URL 不受影响（只改本地资产路径）", () => {
    const body = '<a href="http://127.0.0.1:19888/api/echo?token=x">echo</a>';
    store.saveNote(noteId, "端口归一", body);
    expect(diskBody()).toBe(body);
  });
});
