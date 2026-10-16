/**
 * CSS 选择器转义（B1，261016）。
 *
 * 与直接调用 `CSS.escape` 的差别是**带兜底**：`CSS.escape` 在部分运行环境不可用
 * （Node 测试环境没有 `CSS` 全局；老 WebView 可能缺该方法）⇒ 裸调用会让整段选择器构建直接抛。
 * 这里统一成一个函数：优先 `CSS.escape`；不可用时退回「只转义属性选择器里真正会破串的两个字符」
 * （`"` 与 `\`）——调用点全部是 `[attr="…"]` 形态，够用且不会误伤。
 *
 * 原先这段 try/catch 在 `EditorTab` / `OutlineList` / `useOutline` 里各写了一份（逐字相同）。
 * 注意：仓内另有若干处**直接**调用 `CSS.escape`（无兜底），那是「用法不同」而非重复定义，
 * 未在本批收编（见 docs/CODE-REVIEW-261015.md C1-3）。
 */
export function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}
