/**
 * 文档统计（状态栏字数/图片数）的纯逻辑。
 * W-2-A：从 App 渲染体内移出——此前每次按键都对整篇正文跑两次 O(n) 正则
 * （正文上限 32 MiB，大文档每按键可感知卡顿）。现在由 App 层节流调用。
 *
 * 261016（B1）：**字数口径统一到内核**。
 *  - 有内核实例时读 queryCommandValue('wordCount')（内核自己的状态栏控件同款：
 *    vendor lakex.js 约 7437619，订阅 renderer 的 contentchange 后读它）；
 *  - 没有实例（锁定预览 / 未挂载 / 主进程 / 移动端属性页）时用 src/core/textStats.ts 的
 *    同语义实现兜底，纯文本来源与移动端文档属性一致（lakeHtmlToMarkdown）。
 * 图片数仍由正文解析（内核没有对应查询）。
 */
import { lakeHtmlToMarkdown } from "./lakeCaches.js";
import { countWords } from "./textStats.js";

export interface DocStats {
  /** 字数（内核口径：非 ASCII 按字素、ASCII 按空白分词） */
  wordCount: number;
  /** Lake 正文中的 image card 数（0 表示无图片，状态栏不显示） */
  imageCount: number;
}

const IMAGE_CARD_RE = /<card\b[^>]*\bname="image"[^>]*>/g;

/** 正文 → 纯文本（与移动端文档属性、主进程缓存同源）。 */
export function docPlainText(content: string): string {
  return lakeHtmlToMarkdown(content);
}

/** 最小内核查询面（LakeEditorInstance 兼容；单测可直接给普通对象）。 */
export interface WordCountQueryable {
  queryCommandValue?(name: string, ...args: unknown[]): unknown;
}

/**
 * 读内核字数；内核不可达或返回值不是有限非负数 → null（调用方回退正文计算）。
 * 锁定态 Viewer 可能不完整支持 getDocument('text/plain')（该命令内部会用它）⇒ 必须 try/catch。
 */
export function kernelWordCount(editor: WordCountQueryable | null | undefined): number | null {
  try {
    const raw = editor?.queryCommandValue?.("wordCount");
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * 汇总统计：字数优先内核，图片数恒走正文。
 * 守卫：内核刚挂载但文档还没 setDocument 时会返回 0 ⇒ 正文非空则以正文兜底，
 * 避免切文档瞬间状态栏闪 0（正常运行帧里两者一致）。
 */
export function resolveDocStats(wordCount: number | null, content: string): DocStats {
  const imageCount = (content.match(IMAGE_CARD_RE) || []).length;
  if (wordCount !== null && wordCount > 0) return { wordCount, imageCount };
  const fallback = countWords(docPlainText(content));
  return { wordCount: fallback, imageCount };
}

/** 无内核实例时的整篇统计（正文兜底路径）。 */
export function computeDocStats(content: string): DocStats {
  return resolveDocStats(null, content);
}
