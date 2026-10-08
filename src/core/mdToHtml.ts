/**
 * 轻量 Markdown → HTML 转换器（收口导出用）。
 * 覆盖常见语法：标题/段落/粗体/斜体/行内代码/链接/图片/无序有序列表/引用/代码块。
 * 不引入第三方依赖；未知语法按段落原样输出。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 链接协议白名单：仅允许 http/https/mailto 或无协议相对地址；拒绝 javascript:/data:/file: 等。 */
function isSafeLinkUrl(url: string): boolean {
  if (/^\/\//.test(url)) return false; // 协议相对（file:// 导出环境下解析异常）
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true; // 无协议 → 相对地址
  return /^(https?:|mailto:)/i.test(url);
}

/** 图片协议白名单：仅允许 http/https、data:image/ 或无协议相对地址。 */
function isSafeImageUrl(url: string): boolean {
  if (/^\/\//.test(url)) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
  return /^(https?:|data:image\/)/i.test(url);
}

/** 行内转换：**bold** *italic* `code` [text](url) ![alt](url) */
function inline(text: string): string {
  // 先转义 HTML 特殊字符，再用占位符保护已生成的标签
  let s = escapeHtml(text);
  // 图片 ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
    if (!isSafeImageUrl(url)) return ""; // 危险协议直接丢弃该图片
    return `<img src="${url}" alt="${alt}" />`;
  });
  // 链接 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    if (!isSafeLinkUrl(url)) return label; // 危险协议降级为纯文本（不生成可点击链接）
    return `<a href="${url}">${label}</a>`;
  });
  // 粗体
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, (_m, pre: string, inner: string) => `${pre}<em>${inner}</em>`);
  // 行内代码（` 开头，可能带语言前缀）
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

export function mdToHtml(markdown: string): string {
  const blocks: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  const pending: string[] = []; // 当前段落累积
  const flushParagraph = () => {
    if (pending.length) {
      blocks.push(`<p>${pending.map(inline).join("<br />")}</p>`);
      pending.length = 0;
    }
  };
  const flushList = (items: string[], ordered: boolean) => {
    if (!items.length) return;
    const tag = ordered ? "ol" : "ul";
    blocks.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
  };
  let listItems: string[] = [];
  let listOrdered = false;
  let inList = false;

  while (i < lines.length) {
    const line = lines[i];
    // 代码块
    if (line.trimStart().startsWith("```")) {
      flushParagraph(); flushList(listItems, listOrdered); listItems = []; inList = false;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ```
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(); flushList(listItems, listOrdered); listItems = []; inList = false;
      const level = h[1].length;
      blocks.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // 引用
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph(); flushList(listItems, listOrdered); listItems = []; inList = false;
      blocks.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      i++;
      continue;
    }
    // 列表
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = Boolean(ol);
      const item = (ol ?? ul)![1];
      if (!inList || ordered !== listOrdered) {
        flushParagraph(); flushList(listItems, listOrdered);
        listItems = []; listOrdered = ordered; inList = true;
      }
      listItems.push(item);
      i++;
      continue;
    }
    // 空行 → 结束列表/段落
    if (!line.trim()) {
      flushParagraph(); flushList(listItems, listOrdered); listItems = []; inList = false;
      i++;
      continue;
    }
    // 普通行：累积为段落
    if (inList) { flushList(listItems, listOrdered); listItems = []; inList = false; }
    pending.push(line.trim());
    i++;
  }
  flushParagraph(); flushList(listItems, listOrdered);
  return blocks.join("\n");
}

/** 组装完整 HTML 文档（含标题与 UTF-8 声明） */
export function wrapHtmlPage(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
/* 独立导出页：**不引用应用 CSS 令牌**（页面在应用外打开，令牌没有定义；字体同理用系统栈）。
   下面需要颜色的地方一律用字面量，值取自 src/styles/themes/light.css：小圆角 4px / 次级文字 #4e5969 / 分隔线 #d3d7de。 */
body { max-width: 820px; margin: 0 auto; padding: 24px 20px; font: 16px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #24292f; }
img { max-width: 100%; height: auto; }
pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
code { background: #f6f8fa; padding: 2px 5px; border-radius: 4px; font-size: 90%; }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding-left: 12px; border-left: 1px solid #d3d7de; color: #4e5969; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
