/**
 * parseInkBody 的健壮性随机测试（261104 十八批）。
 *
 * 为什么值得单独写：保存时 **envelope 解析不出来的页会被永久丢弃**（结构严格、单页坏只丢该页），
 * 所以解析器的健壮性直接等于数据安全。这里用确定性伪随机做两件事：
 *  ① 随机**合法**文档往返：parseInkBody(inkToBody(doc)) 的页数/笔数/点数一致、再序列化不抛；
 *  ② 随机**畸形**输入（截断/改字节/错类型/NaN/重复 id/超限/深嵌套）：parseInkBody 永远不抛错，
 *    返回值只能是 null 或「可再次序列化」的文档（丢页要计数）。
 * 确定性种子 ⇒ 失败可复现，不用 flaky 的 Math.random。
 */
import { describe, expect, it } from "vitest";
import {
  INK_PAGE_HEIGHT,
  INK_PAGE_WIDTH,
  createInkDoc,
  createInkPage,
  inkToBody,
  parseInkBody,
  type InkDoc,
  type InkPage,
  type InkStroke,
} from "./inkDoc";

/** mulberry32：小、快、可复现。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length) % list.length];
}

function randomStroke(random: () => number, index: number): InkStroke {
  const points = [];
  const count = 1 + Math.floor(random() * 8);
  for (let i = 0; i < count; i += 1) {
    points.push({ x: random() * INK_PAGE_WIDTH, y: random() * INK_PAGE_HEIGHT, pressure: random(), ...(random() > 0.5 ? { t: random() * 1000 } : {}) });
  }
  return {
    id: "s" + index,
    tool: pick(random, ["pen", "highlighter"] as const),
    color: pick(random, ["#262626", "#FF4D4F", "#096DD9"] as const),
    width: 1 + random() * 20,
    points,
  };
}

function randomDoc(random: () => number): InkDoc {
  const pageCount = 1 + Math.floor(random() * 4);
  const pages: InkPage[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const page = createInkPage("page-" + i, pick(random, ["blank", "lined", "grid", "dot"] as const));
    const strokeCount = Math.floor(random() * 5);
    page.strokes = Array.from({ length: strokeCount }, (_, index) => randomStroke(random, i * 100 + index));
    pages.push(page);
  }
  return { ...createInkDoc(pages[0].id), pages };
}

function counts(doc: InkDoc): { pages: number; strokes: number; points: number } {
  const strokes = doc.pages.reduce((sum, page) => sum + page.strokes.length, 0);
  const points = doc.pages.reduce((sum, page) => sum + page.strokes.reduce((n, stroke) => n + stroke.points.length, 0), 0);
  return { pages: doc.pages.length, strokes, points };
}

/** 把 body 弄坏：截断 / 改一个字节 / 塞非法值 / 深嵌套 / 错类型。 */
function corrupt(random: () => number, body: string): string {
  const mode = Math.floor(random() * 6);
  if (mode === 0) return body.slice(0, Math.floor(random() * body.length));
  if (mode === 1) {
    const at = Math.floor(random() * body.length);
    const chars = "{}[],:\"0123456789eE+-.x";
    return body.slice(0, at) + chars[Math.floor(random() * chars.length)] + body.slice(at + 1);
  }
  if (mode === 2) return body.replace(/"version":3/, `"version"${pick(random, [":4", "3", ":true", ":null"])}`);
  if (mode === 3) return body.replace(/"kind":"ink"/, `"kind"${pick(random, [":\"doc\"", ":1", ":[]", ":null"])}`);
  if (mode === 4) return "[".repeat(50) + body + "]".repeat(50);
  return JSON.stringify({ kind: "ink", version: 3, pages: pick(random, [null, 1, "x", [null], [{}], { length: 3 }]) });
}

/** 解析器不许抛错：抛了就当场让测试失败（比 expect 包一层更好读）。 */
function safeParse(body: string): InkDoc | null {
  try {
    return parseInkBody(body);
  } catch (error) {
    throw new Error("parseInkBody 抛错了: " + String(error));
  }
}

describe("parseInkBody 随机健壮性", () => {
  it("随机合法文档：往返页数/笔数/点数一致，且可再次序列化", () => {
    const random = rng(20261104);
    for (let round = 0; round < 120; round += 1) {
      const doc = randomDoc(random);
      const body = inkToBody(doc);
      const parsed = parseInkBody(body);
      expect(parsed).not.toBeNull();
      expect(counts(parsed!)).toEqual(counts(doc));
      expect(parsed!.droppedPages ?? 0).toBe(0);
      // 再序列化必须成功（这是保存路径的前提）
      expect(() => inkToBody(parsed!)).not.toThrow();
      // 二次解析仍然稳定
      expect(counts(parseInkBody(inkToBody(parsed!))!)).toEqual(counts(doc));
    }
  });

  it("随机畸形输入：不抛错；非 null 的结果必须能再次序列化", () => {
    const random = rng(777001);
    let nulls = 0;
    for (let round = 0; round < 400; round += 1) {
      const body = corrupt(random, inkToBody(randomDoc(random)));
      const parsed = safeParse(body);
      if (!parsed) { nulls += 1; continue; }
      // 活下来的文档必须自洽：至少一页、可以重新序列化（坏页已被丢弃并计数）
      expect(parsed!.pages.length).toBeGreaterThan(0);
      expect(() => inkToBody(parsed!)).not.toThrow();
    }
    // 畸形输入里必然有一部分被判为整篇不可用（否则这条测试没有意义）
    expect(nulls).toBeGreaterThan(0);
  });

  it("超限与空值：null / 空串 / 超 16MiB / 非 JSON 都返回 null（不抛）", () => {
    expect(parseInkBody(null)).toBeNull();
    expect(parseInkBody("")).toBeNull();
    expect(parseInkBody("   ")).toBeNull();
    expect(parseInkBody("null")).toBeNull();
    expect(parseInkBody("[]")).toBeNull();
    expect(parseInkBody("x".repeat(16 * 1024 * 1024 + 1))).toBeNull();
    expect(() => parseInkBody("{\"kind\":\"ink\",\"version\":3,\"pages\":[]}")).not.toThrow();
    expect(parseInkBody("{\"kind\":\"ink\",\"version\":3,\"pages\":[]}")).toBeNull();
  });
});
