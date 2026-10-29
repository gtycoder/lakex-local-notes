/**
 * CORE-06 护栏：桌面主进程必须**真的**把 node:crypto SHA-256 注入 core（sha256Sync），
 * 且注入后 digest 与纯 JS / node:crypto 逐字节一致（含 padding 边界与大 buffer）。
 *
 * 事故形态：setSha256HexImpl 长期「只有定义、没有生产调用点」（唯一调用方 syncAdapters.ts
 * 是零生产引用的死模块，261029 已删）⇒ 桌面一直跑纯 JS，而注释承诺的是 native。
 * 所以这里锁两件事：① 注入发生了（运行时 + main.ts 静态接线）；② 注入不算错（digest 等价）。
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { installNativeSha256, nativeSha256Hex } from "./sha256Native.js";
import { currentSha256HexImpl, sha256Sync, setSha256HexImpl } from "../src/core/sha256Sync.js";
import { sha256Hex } from "../src/core/syncUtils.js";

/** 本文件加载时的生效实现（测试进程内没人注入过 ⇒ 纯 JS）。用作对照与还原。 */
const pureImpl = currentSha256HexImpl();
afterEach(() => setSha256HexImpl(pureImpl));

function nodeHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("CORE-06 桌面注入 native sha256", () => {
  it("安装后 core 的生效实现就是 native 包装（不再是纯 JS）", () => {
    expect(currentSha256HexImpl()).toBe(pureImpl);
    installNativeSha256();
    expect(currentSha256HexImpl()).toBe(nativeSha256Hex);
    expect(currentSha256HexImpl()).not.toBe(pureImpl);
  });

  it("注入后 digest 与纯 JS / node:crypto 一致（空、padding 边界、单块、大 buffer）", () => {
    installNativeSha256();
    // 0/1：空与单字节；55-57/63-65/119-129：SHA-256 padding 与 64B 块边界；
    // 1MB：多块（正文/附件量级），确认不是只在小输入上凑巧一致。
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1_000_000]) {
      const bytes = n === 0 ? new Uint8Array(0) : new Uint8Array(randomBytes(n));
      const expected = nodeHex(bytes);
      expect(sha256Sync(bytes)).toBe(expected);      // 注入后的入口
      expect(nativeSha256Hex(bytes)).toBe(expected); // native 本体
      expect(pureImpl(bytes)).toBe(expected);        // 纯 JS 对照
      expect(sha256Hex(bytes)).toBe(expected);       // 生产调用面（core/syncUtils 代理）
    }
  });

  it("注入后已知向量不变（FIPS 180-4）", () => {
    installNativeSha256();
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sha256Sync(enc(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Sync(enc("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Sync(enc("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))
      .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("main.ts 在 app ready 之前的初始化段安装（静态锁：不得再退回「无人调用」）", () => {
    const src = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(src).toMatch(/import \{ installNativeSha256 \} from "\.\/sha256Native\.js";/);
    const callAt = src.indexOf("installNativeSha256();");
    expect(callAt).toBeGreaterThan(0);
    expect(callAt).toBeLessThan(src.indexOf("app.whenReady()"));
  });
});
