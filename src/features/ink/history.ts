/** 手写板撤销栈：同时限制条数与总字符数，避免 60 份大正文把 WebView 内存打满。 */
export const INK_UNDO_LIMIT = 60;
export const INK_UNDO_MAX_CHARS = 24 * 1024 * 1024;

export function pushBoundedHistory(
  stack: string[],
  body: string,
  limit = INK_UNDO_LIMIT,
  maxChars = INK_UNDO_MAX_CHARS,
): void {
  stack.push(body);
  let totalChars = stack.reduce((sum, item) => sum + item.length, 0);
  while (stack.length > limit || totalChars > maxChars) {
    const removed = stack.shift();
    if (removed === undefined) break;
    totalChars -= removed.length;
  }
}
