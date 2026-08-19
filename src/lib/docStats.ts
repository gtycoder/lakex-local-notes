/**
 * 文档统计（状态栏字数/图片数）的纯逻辑。
 * W-2-A：从 App 渲染体内移出——此前每次按键都对整篇正文跑两次 O(n) 正则
 * （正文上限 32 MiB，大文档每按键可感知卡顿）。现在由 App 层节流调用。
 */

export interface DocStats {
  /** 去标签后的可见字符数（0 表示空文档） */
  wordCount: number;
  /** Lake 正文中的 image card 数（0 表示无图片，状态栏不显示） */
  imageCount: number;
}

const IMAGE_CARD_RE = /<card\b[^>]*\bname="image"[^>]*>/g;

export function computeDocStats(content: string): DocStats {
  const plainText = content
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const wordCount = plainText.trim().length;
  const imageCount = (content.match(IMAGE_CARD_RE) || []).length;
  return { wordCount, imageCount };
}
