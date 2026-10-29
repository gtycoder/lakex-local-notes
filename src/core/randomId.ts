/**
 * 唯一 id / 随机字节的**单一来源**（CORE-10）。
 *
 * 正常环境（Electron 主进程、移动 WebView、Node ≥18、vitest）WebCrypto 都在 ⇒ 走 WebCrypto。
 * **没有 WebCrypto 时的兜底不再用 Math.random**：改用「进程内单调计数器 + 固定常数 LCG」⇒
 * 确定性、同进程内连续调用必不重复。此前 assetNaming / quickNoteModel / bitableDoc 各带一份
 * Math.random 兜底：资产文件名（时间戳_8hex）一旦走兜底，碰撞会**静默覆盖**同名同路径的既有资产，
 * 把「文件名唯一性」变成概率问题。兜底不追求密码学强度，只保证「不重复 + 可复现（测试可断言）」。
 *
 * ⚠️ src/core 禁 node: 导入 ⇒ 只用 globalThis.crypto（WebCrypto）与纯 JS 运算。
 */

let fallbackSeed = 0;

/** 无 WebCrypto 环境的兜底字节（确定性：同进程内按调用顺序可复现；不同调用必不同序列）。 */
function fallbackBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = (0x9e3779b9 ^ (++fallbackSeed * 0x85ebca6b)) >>> 0;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = (x >>> 24) & 0xff;
  }
  return out;
}

/** 随机字节：WebCrypto 优先，无 WebCrypto 时走确定性兜底（见文件头）。 */
export function randomBytes(length: number): Uint8Array {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") return c.getRandomValues(new Uint8Array(length));
  return fallbackBytes(length);
}

/** RFC 4122 v4 UUID：WebCrypto randomUUID 优先，否则用 randomBytes 组包（不再 Math.random）。 */
export function randomUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
