/**
 * 滚动位置判据（移动端，纯函数，单测见 scrollPosition.test.ts）。
 *
 * 背景（261027 R1）：文档编辑器在「阅读 ⇄ 编辑」切换时，LakeEditor 的 effect deps 含 mode/showToolbar，
 * 会 destroy + host.replaceChildren() —— 滚动容器 .mobile-doc-body 的内容先被清空（scrollHeight 归零），
 * Chrome 把 scrollTop 钳到 0；新内容落地后停在 0（实测 790 → 0）。
 * 同一篇文档的模式切换属于「同一个阅读位置」，要把它恢复回来；但**不能**直接写回旧 scrollTop：
 * 两种模式的内容盒高度不同（阅读 3014 / 编辑 2954），越界会被浏览器再钳一次并产生抖动 ⇒ 一律先 clamp。
 *
 * ⚠️ 这不是「滚动记忆」式的通用补丁：
 * - 只在**同一 noteId 的 mode 切换**（editing 变化）时调用一次；
 * - 切到另一篇文档、新建文档、重新打开被淘汰的标签都不经过这里（新文档仍从顶）；
 * - 不写 localStorage / 不进正文 / 不进 S3（设备本地视图）。
 */

/** 可滚动范围（scrollHeight-clientHeight）内取整；非有限值一律回落 0。 */
export function scrollMax(scrollHeight: number, clientHeight: number): number {
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return 0;
  return Math.max(0, Math.floor(scrollHeight - clientHeight));
}

/** 把要恢复的 scrollTop 钳到当前内容的可滚动范围内。 */
export function clampScrollTop(top: number, scrollHeight: number, clientHeight: number): number {
  if (!Number.isFinite(top)) return 0;
  const max = scrollMax(scrollHeight, clientHeight);
  if (top <= 0) return 0;
  return Math.min(Math.floor(top), max);
}
