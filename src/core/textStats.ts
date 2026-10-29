/**
 * 「字数 / 字符数」统计的宿主侧实现（261016，B1 复用内核能力）。
 *
 * 为什么要有它：过去**三处各写一套正则**——桌面状态栏 docStats（去标签后取字符数）、
 * 主进程文档属性 electron/store.ts、移动端文档属性 src/mobile/bridge.ts（CJK 字 + 拉丁词）。
 * 三者口径互不相等，也与内核/云端语雀不一致。现在统一由本文件提供。
 *
 * 内核语义（vendor lakex-doc-react/src/components/lakex/lakex.js 约 3301326 的 DM()，
 * 即 content.wordCount 命令的默认实现 option.wordCount(kernel.getDocument('text/plain'))）：
 *   ① 非 ASCII 连续串（/[\u0100-\uffff]+/）按**字素**逐个计 1，然后整串替换为空格；
 *   ② 两个及以上连字符（--）紧跟空白时再补 1；
 *   ③ 余下按空白（/\s+/）分词，每个词计 1。
 * 本文件是该算法的宿主侧同源实现：**有内核实例时仍优先读 queryCommandValue('wordCount')**
 * （内核自己的状态栏控件就是这么刷新字数的，同文件约 7437619），这里只在没有实例时兜底。
 */

/** 非 ASCII 连续串（内核原文的 Dj）。 */
const NON_ASCII_RUN = /[\u0100-\uffff]+/g;
/** 两个及以上连字符（内核原文的 DI）。 */
const DASH_RUN = /--+/g;
/** 空白串（内核原文的 DB）。 */
const WHITESPACE_RUN = /\s+/;

type GraphemeSegmenter = { segment(input: string): Iterable<unknown> };
type SegmenterCtor = new (locales?: string | string[], options?: { granularity: "grapheme" }) => GraphemeSegmenter;

/** 内核用字素切分（其内部工具 rx.A）；宿主侧能用 Intl.Segmenter 就用，否则退回码点。 */
const segmenter: GraphemeSegmenter | null = (() => {
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!Ctor) return null;
  try {
    return new Ctor(undefined, { granularity: "grapheme" });
  } catch {
    return null;
  }
})();

function graphemeCount(text: string): number {
  if (segmenter) return [...segmenter.segment(text)].length;
  return Array.from(text).length;
}

/**
 * 字数（内核 wordCount 同语义）。
 * 注意：中文标点也在 \u0100-\uffff 区间内，会与汉字一样各计 1（与内核、云端一致）。
 */
export function countWords(plain: string): number {
  if (!plain) return 0;
  let count = 0;
  let rest = plain.replace(NON_ASCII_RUN, (run) => {
    if ((run.codePointAt(0) ?? 0) > 127) {
      count += graphemeCount(run);
      return " ";
    }
    return run;
  });
  rest = rest.replace(DASH_RUN, (_match, offset: number, whole: string) => {
    if (WHITESPACE_RUN.test(whole[offset - 1] ?? "")) count += 1;
    return " ";
  });
  rest = rest.trim();
  if (rest) count += rest.split(WHITESPACE_RUN).length;
  return count;
}

/** 字符数（去掉所有空白后的长度；文档属性里与「字数」并列展示的那一项）。 */
export function countChars(plain: string): number {
  return plain.replace(/\s+/g, "").length;
}

export interface TextStats {
  wordCount: number;
  charCount: number;
}

/**
 * 字数 + 字符数的**唯一派生入口**（CORE-10）。
 *
 * 桌面主进程属性页、移动端属性页、状态栏兜底都调它——过去是三处各自调
 * `countChars` + `countWords`，只改一处就会端间口径不一致。这里只负责「同输入同输出」，
 * 输入源（text_cache / searchTextForKind / lakeHtmlToMarkdown）仍由调用方决定并各自登记。
 */
export function countTextStats(plain: string): TextStats {
  return { wordCount: countWords(plain), charCount: countChars(plain) };
}
