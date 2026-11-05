import { describe, expect, it } from "vitest";
import {
  CANONICAL_JSON_MAX_DEPTH,
  CANONICAL_JSON_MAX_NODES,
  canonicalJson,
  indexHashOf,
  serializeLakeIndex,
  serializeQuickNotesIndex,
  type LakeIndex,
  type QuickNotesIndex,
} from "./s3v3Index.js";

/** 旧实现（递归）原样留档：新实现必须与它**逐字节一致**（索引 hash 稳定性回归）。 */
function canonicalJsonReference(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJsonReference(v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJsonReference(obj[k])).join(",") + "}";
}

/** 确定性 PRNG（mulberry32）：对拍用随机结构，失败可复现。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomValue(rand: () => number, depth: number): unknown {
  const roll = rand();
  if (depth >= 5 || roll < 0.45) {
    const kind = Math.floor(rand() * 7);
    if (kind === 0) return null;
    if (kind === 1) return rand() < 0.5;
    if (kind === 2) return Math.round(rand() * 2000 - 1000);
    if (kind === 3) return rand() * 1e6;
    if (kind === 4) return `s${Math.floor(rand() * 10)}"\\`;
    if (kind === 5) return "";
    return undefined;
  }
  if (roll < 0.7) {
    const n = Math.floor(rand() * 5);
    return Array.from({ length: n }, () => randomValue(rand, depth + 1));
  }
  const n = Math.floor(rand() * 5);
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) obj[`k${Math.floor(rand() * 6)}`] = randomValue(rand, depth + 1);
  return obj;
}

describe("canonicalJson 迭代实现（261105 Batch3-C）", () => {
  it("随机结构对拍：与旧递归实现逐字节一致（含 undefined 键过滤、数组顺序、key 排序）", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = mulberry32(seed);
      const value = randomValue(rand, 0);
      expect(canonicalJson(value)).toBe(canonicalJsonReference(value));
    }
  });

  it("对象 key 排序、undefined 值过滤、数组保序、稀疏数组与特殊字符转义", () => {
    const value = {
      b: 2,
      a: [3, { d: 4, c: 5 }],
      skipped: undefined,
      quoted: 'he said "hi"\n\t',
    };
    expect(canonicalJson(value)).toBe('{"a":[3,{"c":5,"d":4}],"b":2,"quoted":"he said \\"hi\\"\\n\\t"}');
    // 稀疏数组：旧实现 map 跳过洞，join 后与「洞=空串」等价
    const sparse = new Array(3);
    sparse[1] = 1;
    expect(canonicalJson(sparse)).toBe(canonicalJsonReference(sparse));
  });

  it("深嵌套 20 万层：抛可读错误而不是 RangeError（旧实现会栈溢出）", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 200_000; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow(new RegExp(`嵌套超过 ${CANONICAL_JSON_MAX_DEPTH} 层`));
    // 明确不是 RangeError（栈溢出）
    try {
      canonicalJson(deep);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("Error");
    }
  });

  it(`节点数超过上限（${CANONICAL_JSON_MAX_NODES}）时报错`, () => {
    const wide = new Array(CANONICAL_JSON_MAX_NODES).fill(null);
    expect(() => canonicalJson(wide)).toThrow(/节点数超过上限/);
  });

  it("既有序列化结果不变：空索引与小索引的字节与 hash", () => {
    const emptyLake: LakeIndex = { v: 3, space: "lake", notes: [], folders: [] };
    const emptyQuick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [] };
    expect(serializeLakeIndex(emptyLake)).toBe('{"folders":[],"notes":[],"space":"lake","v":3}');
    expect(serializeQuickNotesIndex(emptyQuick)).toBe('{"items":[],"space":"quickNotes","v":3}');
    expect(serializeLakeIndex(emptyLake)).toBe(canonicalJsonReference(emptyLake));
    expect(indexHashOf(serializeLakeIndex(emptyLake))).toMatch(/^[0-9a-f]{64}$/);
  });
});
