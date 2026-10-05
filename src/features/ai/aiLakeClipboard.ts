/**
 * 「复制为 Lake」：用**内核方法**把 Markdown 转成内核自己的剪贴板负载（261005）。
 *
 * 为什么必须这么绕：Lake 粘贴按 `text/ne-inode > text/lake > text/html > text/aone > text/plain`
 * 取格式；而 `navigator.clipboard.write` 只放行 text/html / text/plain（写自定义类型会
 * NotAllowedError）。内核自己的解法（lakex.js 的 eSz）：把 `text/ne-inode` 负载 URL-encode 后
 * 作为 text/html 前缀 `<ne-clipboard data="…" source="…">`；粘贴时内核 process() 会把它还原成
 * `text/ne-inode` ⇒ 走原生直插、**不会再弹「是否需要做样式转换」**。
 *
 * 我们只照抄这个外壳；三种格式（ne-inode / html / plain）全部由内核 writeData 产出，
 * **不自己拼正文**。内核升级若改了外壳，下面的护栏单测会失败（提醒复核）。
 */
export interface LakePayloadKernel {
  readData: (format: string, data: string, options?: Record<string, unknown>) => unknown;
  writeData: (format: string, node: unknown, options?: Record<string, unknown>) => string;
}

export interface LakeClipboardPayload {
  html: string;
  plain: string;
}

/** 内核 <ne-clipboard> 外壳（照抄 lakex.js `eSz`；`source` 只用于溯源，粘贴不依赖它）。 */
export function wrapNeClipboard(neInode: string, html: string, href: string): string {
  return '<ne-clipboard data="' + encodeURIComponent(neInode) + '" source="' + encodeURIComponent(href) + '"></ne-clipboard>' + html;
}

/** Markdown → 内核剪贴板负载（解析失败返回 null，调用方回退）。 */
export function buildLakeClipboard(kernel: LakePayloadKernel, markdown: string, href: string): LakeClipboardPayload | null {
  const nodes = kernel.readData("text/markdown", markdown);
  if (!nodes) return null;
  const neInode = kernel.writeData("text/ne-inode", nodes, { since: "copy" });
  if (!neInode) return null;
  const html = kernel.writeData("text/html", nodes, { since: "copy" }) || "";
  const plain = kernel.writeData("text/plain", nodes) || " ";
  return { html: wrapNeClipboard(neInode, html, href), plain };
}

/** 真正写剪贴板；返回是否成功（失败由调用方决定是否回退到普通复制）。 */
export async function copyMarkdownAsLake(kernel: LakePayloadKernel, markdown: string, href: string): Promise<boolean> {
  const payload = buildLakeClipboard(kernel, markdown, href);
  if (!payload) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([payload.html], { type: "text/html" }),
      "text/plain": new Blob([payload.plain], { type: "text/plain" }),
    })]);
    return true;
  } catch {
    return false;
  }
}
