/**
 * 桌面主进程：把 node:crypto 的 SHA-256 注入 core 的 sha256Sync（CORE-06）。
 *
 * 为什么要显式注入：core 边界禁 node:，而同步上下文（资源 hash 校验、墓碑 hash、
 * 索引/声明 hash）不能 await crypto.subtle ⇒ core 默认跑纯 JS（比 native 慢约一个数量级，
 * 注释自述 10-20×）。注入点在 electron/main.ts 启动处（app ready 之前），一次生效。
 *
 * 移动端**不注入**（WebView 无 node）：纯 JS 是移动端的预期实现，不是缺口。
 */
import { createHash } from "node:crypto";
import { setSha256HexImpl } from "../src/core/sha256Sync.js";

/** node:crypto 实现（输出与 core 纯 JS 逐字节一致；等价测试见 src/core/sha256Sync.test.ts）。 */
export function nativeSha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 安装 native 实现（幂等）。桌面启动时调用一次。 */
export function installNativeSha256(): void {
  setSha256HexImpl(nativeSha256Hex);
}
