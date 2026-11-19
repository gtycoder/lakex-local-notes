import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * 内核文内表情面板（unicode-emoji 面板，非「目录选表情」NodeIconPicker）搜索补丁护栏（261119）。
 *
 * 用户报「表情筛选什么都筛选不出来」（搜「火」空结果）。根因（读码 + bundle 实测，见
 * docs/LAKEX-CONTRACT.md §5.60）：面板 getSearchItems 用内核自带 Fuse.js 6.6.2 对 keywords
 * （ePW 压缩数据：1467 条 emoji → 空格分隔的英文短名 + CLDR 中文词）做模糊搜索，options 是
 * { includeMatches, includeScore, distance: 12, keys: ['keywords'] } + score <= 0.1 过滤。
 * Fuse 评分 = errors/len + |命中位置 - 0| / distance，且 threshold 0.6 先行判 isMatch ⇒
 * 命中位置离开词条开头就丢分、超过 ~0.7 字符整条 0 命中（中文关键词都在词条尾部 ⇒ 搜「火」
 * 一条不出；英文也只有词条首词能过 0.1 滤网 ⇒ 搜「apple」不出 🍎）。
 *
 * 本地补丁（vendor/lakex-doc-react/LOCAL-CHANGES.md #34）：options 加
 * ignoreLocation: !0 + ignoreFieldNorm: !0 ⇒ 位置/字段长度不再计分，子串命中 score=0.001
 * 稳过 0.1 滤网，fuzzy 仍是「≤10% 错字」的紧口径；数据无需补中文别名（ePW 已含）。
 *
 * 重转/升级内核 lakex.js 后本文件会红 ⇒ 按 LOCAL-CHANGES #34 重放补丁并重建 dist。
 * 本测试只读 vendor 产物，不涉及 src/app/**（NodeIconPicker / nodeIcon.css 是另一条修复流）。
 */
const read = (url: string) => readFileSync(new URL(url, import.meta.url), "utf8");

const LAKEX = "../../../vendor/lakex-doc-react/src/components/lakex/lakex.js";
const REPLAY = "内核 lakex.js 已重转/升级：按 vendor/lakex-doc-react/LOCAL-CHANGES.md #34 重放 getSearchItems 补丁（ignoreLocation + ignoreFieldNorm）后再验";

const lakex = read(LAKEX);

/** 抠出 getSearchItems 里传给 Fuse 的 options 对象字面量并求值（= bundle 真实生效配置）。 */
function extractSearchOptions(src: string): Record<string, unknown> {
  const m = src.match(/new\s+\w+\(e,\s*(\{[^{}]*keys:\s*\['keywords'\][^{}]*\})\)/);
  if (!m) throw new Error(REPLAY);
  return new Function(`return (${m[1]});`)() as Record<string, unknown>;
}

/** 从 bundle 抠出内核自带的 Fuse 实现（压缩名 eoL..eid 段）；名字变化即重转 ⇒ 报重放。 */
function extractKernelFuse(src: string): new (items: unknown[], opts: Record<string, unknown>) => {
  search(q: string): { item: { emoji: string; keywords: string }; score: number }[];
} {
  const start = src.indexOf("function eoL(e)");
  const iife = src.indexOf("(function (...e)");
  if (start < 0 || iife < 0 || iife < start) throw new Error(REPLAY);
  let end = -1;
  for (const pat of ["\n        var ", "\n        function ", "\n        class ", "\n        let "]) {
    const at = src.indexOf(pat, iife);
    if (at !== -1 && (end === -1 || at < end)) end = at;
  }
  if (end < 0) throw new Error(REPLAY);
  try {
    return new Function(`${src.slice(start, end)}\nreturn eid;`)();
  } catch {
    throw new Error(REPLAY);
  }
}

/** 抠出面板默认数据 ePW（zlib+base64 的 JSON：emoji → keywords 字符串）。 */
function extractEmojiKeywords(src: string): Record<string, string> {
  const marker = src.indexOf("ePz.decode(");
  if (marker < 0) throw new Error(REPLAY);
  const q1 = src.indexOf("'", marker);
  const q2 = src.indexOf("'", q1 + 1);
  if (q1 < 0 || q2 < 0) throw new Error(REPLAY);
  try {
    return JSON.parse(inflateSync(Buffer.from(src.slice(q1 + 1, q2), "base64")).toString("utf8"));
  } catch {
    throw new Error(REPLAY);
  }
}

const Fuse = extractKernelFuse(lakex);
const emojiMap = extractEmojiKeywords(lakex);
const items = Object.keys(emojiMap).map((emoji) => ({ emoji, keywords: emojiMap[emoji] }));
const options = extractSearchOptions(lakex);

/** 与面板 getSearchItems 同构（含 score <= 0.1 滤网）。 */
function getSearchItems(q: string): { emoji: string; keywords: string }[] {
  return q.trim().toLowerCase()
    ? new Fuse(items, options)
        .search(q)
        .filter((e) => e.score <= 0.1)
        .map((e) => e.item)
    : items;
}

describe("内核文内表情面板（unicode-emoji）搜索补丁", () => {
  it("getSearchItems 补丁选项在 src 与 dist 双处在位", () => {
    expect(options.ignoreLocation).toBe(true);
    expect(options.ignoreFieldNorm).toBe(true);
    expect(options.distance).toBe(12);
    expect(options.keys).toEqual(["keywords"]);
    const head = lakex.slice(lakex.indexOf("key: 'getSearchItems'"), lakex.indexOf("key: 'getSearchItems'") + 700);
    expect(head).toContain("e.score <= 0.1");
    for (const dist of [
      "../../../vendor/lakex-doc-react/dist/index.es.js",
      "../../../vendor/lakex-doc-react/dist/index.cjs.js",
    ]) {
      expect(read(dist)).toMatch(
        /distance:\s*12,\s*ignoreLocation:\s*!0,\s*ignoreFieldNorm:\s*!0,\s*keys:\s*\[[^\]]*keywords[^\]]*\]/
      );
    }
  });

  it("实测：火→🔥 等火焰类、苹果→🍎、house→🏠、空查询→全量", () => {
    const fire = getSearchItems("火");
    expect(fire.length).toBeGreaterThanOrEqual(2);
    expect(fire.map((x) => x.emoji)).toContain("🔥");
    expect(getSearchItems("苹果").map((x) => x.emoji)).toContain("🍎");
    expect(getSearchItems("house").map((x) => x.emoji)).toContain("🏠");
    expect(getSearchItems("").length).toBe(items.length);
    expect(getSearchItems("   ").length).toBe(items.length);
  });

  it("实测：不误命中（house / fire 不出 🍎）", () => {
    expect(getSearchItems("house").map((x) => x.emoji)).not.toContain("🍎");
    expect(getSearchItems("fire").map((x) => x.emoji)).not.toContain("🍎");
  });

  it("内核 ePW 数据自带中文关键词（无需桥接 src/lib/emojiSearch.ts）", () => {
    expect(Object.keys(emojiMap).length).toBe(1467);
    expect(emojiMap["🔥"]).toContain("火");
    expect(emojiMap["🏠"]).toContain("房");
  });
});
