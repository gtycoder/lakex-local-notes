/**
 * 二进制入参归一（单一来源）：桌面 IPC 传 `Uint8Array`（结构化克隆），
 * Web 客户端/移动端经 HTTP JSON 传 `number[]`（有时是 `{0:..}` 形态的普通对象）。
 * 统一收成 Uint8Array，并在非法输入时返回 null（调用方给 IPC 明确的 INVALID_INPUT）。
 */
export function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    const out = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const n = value[i];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 255) return null;
      out[i] = n;
    }
    return out;
  }
  return null;
}
