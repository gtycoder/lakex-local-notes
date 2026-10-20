/**
 * sha256Sync 等价测试（Step A 预检 H1）：
 * 纯 JS 同步 SHA-256 vs node:crypto（桌面原实现）输出必须完全一致。
 */
import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { sha256Sync } from "./sha256Sync.js";

function nodeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const textCases: Array<{ name: string; text: string }> = [
  { name: "空串", text: "" },
  { name: "英文", text: "hello world" },
  { name: "中文", text: "你好，这是 LocalLakeNotes 的同步测试" },
  { name: "中文+英文混排", text: "abc 中文 def 测试 🎉 emoji" },
  { name: "长文本 100KB", text: "x".repeat(100_000) },
  { name: "Lake 内容样例", text: '<p id="x-body" class="ne-p">段落内容<br></p>' },
];

describe("sha256Sync 与 node:crypto 等价", () => {
  for (const c of textCases) {
    it(`文本：${c.name}`, () => {
      const bytes = new TextEncoder().encode(c.text);
      expect(sha256Sync(bytes)).toBe(nodeSha256(bytes));
    });
  }

  it("二进制随机 64 字节（边界：单块）", () => {
    const bytes = randomBytes(64);
    expect(sha256Sync(bytes)).toBe(nodeSha256(bytes));
  });

  it("二进制随机 55/56/57 字节（padding 边界）", () => {
    for (const n of [55, 56, 57, 63, 64, 65, 120, 121, 122, 127, 128, 129]) {
      const bytes = randomBytes(n);
      expect(sha256Sync(bytes)).toBe(nodeSha256(bytes));
    }
  });

  it("已知向量（FIPS 180-4 例）", () => {
    expect(sha256Sync(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Sync(new TextEncoder().encode(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Sync(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("异步 crypto.subtle 版本一致性（两端同 hash）", async () => {
    const text = "跨端一致性：桌面 sha256Sync 与移动端 crypto.subtle 输出相同";
    const bytes = new TextEncoder().encode(text);
    const subtle = await crypto.subtle.digest("SHA-256", bytes);
    const subtleHex = Array.from(new Uint8Array(subtle)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(sha256Sync(bytes)).toBe(subtleHex);
  });
});
