/**
 * 清洗 Lake 内核导出的 Markdown：Lake 会保留 <font style="..."> / <span> 等
 * 内联样式标签（如知乎抓取内容的颜色），对 AI/资料包都不友好。
 * 这里只剥掉 font/span 标签（保留内部文本），并跳过代码块，避免误伤代码块内的字面量。
 */
export function cleanLakeMarkdown(markdown: string): string {
  // 先按代码块分段：奇数段是 ```...``` 代码块，原样保留
  const parts = markdown.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part; // 代码块
      return part
        .replace(/<font\b[^>]*>/gi, "")
        .replace(/<\/font>/gi, "")
        .replace(/<span\b[^>]*>/gi, "")
        .replace(/<\/span>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n");
    })
    .join("");
}
