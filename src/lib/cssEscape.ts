/**
 * CSS 选择器转义（B1，261016）。
 *
 * 与直接调用 `CSS.escape` 的差别是**带兜底**：`CSS.escape` 在部分运行环境不可用
 * （Node 测试环境没有 `CSS` 全局；老 WebView 可能缺该方法）⇒ 裸调用会让整段选择器构建直接抛。
 * 这里统一成一个函数：优先 `CSS.escape`；不可用时退回「只转义属性选择器里真正会破串的两个字符」
 * （`"` 与 `\`）——调用点全部是 `[attr="…"]` 形态，够用且不会误伤。
 *
 * 原先这段 try/catch 在 `EditorTab` / `OutlineList` / `useOutline` 里各写了一份（逐字相同）。
 * 原先仓内另有 7 处**直接**调用 `CSS.escape`（无兜底，散在 MultiTabEditor/EditorTab/Sidebar/AssetsBrowser/
 * desktopDerivedState）；**已于 261016 全部收编到本函数**（C1-3b），并由 `cssEscape.test.ts` 的源码级护栏
 * 禁止再有裸调用 —— 判据只留一份。
 */
export function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}
