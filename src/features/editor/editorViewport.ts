import { escapeId } from "../../lib/cssEscape";

/**
 * 编辑器「视口」域（261028 DT-14）：滚动记忆 + 全局搜索命中定位。
 *
 * 为什么独立成模块：这两件事原本住在 1114 行的 `EditorTab.tsx` 里，被 App /
 * useTabLifecycle / useNoteLifecycle 反向 import —— 只想用两个小函数，却把整个组件模块
 * （连同 lakeRuntime 依赖面）拖进依赖图。现在归到「编辑器视口」域：**不依赖 React、不依赖
 * lakeRuntime**，只碰内存 Map 与已渲染的 DOM，可单独跑 jsdom 用例。
 */

/** 跨 remount（外部刷新/冲突重载）保留滚动位置；仅内存态，关闭应用后不保留。 */
const scrollMemory = new Map<string, number>();

/** 记录某文档的滚动位置（tab 的滚动监听每次滚动都会调用）。 */
export function rememberEditorScroll(noteId: string, top: number): void {
  scrollMemory.set(noteId, top);
}

/** 读取滚动记忆：没有记录 = undefined（调用方自行决定回退，别把 0 当「没记过」）。 */
export function readEditorScroll(noteId: string): number | undefined {
  return scrollMemory.get(noteId);
}

/** tab 关闭/淘汰时清理滚动记忆条目，防长会话缓慢累积（remount 不受影响）。 */
export function clearScrollMemory(noteId: string): void {
  scrollMemory.delete(noteId);
}

/**
 * 定位全局搜索命中（不改 Lake 编辑器 API）：
 * 高亮全部命中块（上限 200）、长词优先、滚动到第一个命中。
 *
 * 只认 `.lake-editor-tab[data-note-id]` 宿主：分屏/keep-alive 下同时存在多个编辑器，
 * 按 noteId 精确定位才不会把别的文档滚走。
 */
export function locateEditorSearchHit(noteId: string, query: string): boolean {
  const host = document.querySelector<HTMLElement>(`.lake-editor-tab[data-note-id="${escapeId(noteId)}"]`);
  if (!host || !query.trim()) return false;
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  if (terms.length === 0) return false;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const blocks: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const MAX_BLOCKS = 200;
  let node: Text | null = null;
  while ((node = walker.nextNode() as Text | null)) {
    const value = node.nodeValue ?? "";
    if (!value) continue;
    const lower = value.toLocaleLowerCase();
    if (!terms.some((term) => lower.includes(term))) continue;
    const block = node.parentElement?.closest<HTMLElement>("[data-node-id], .ne-p, .ne-h, .ne-block, p, h1, h2, h3, h4, h5, h6") ?? node.parentElement;
    if (!block || seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
    block.classList.add("lake-search-hit-target");
    if (blocks.length >= MAX_BLOCKS) break;
  }
  if (blocks.length === 0) return false;
  blocks[0].scrollIntoView({ block: "center", behavior: "smooth" });
  window.setTimeout(() => { for (const block of blocks) block.classList.remove("lake-search-hit-target"); }, 1800);
  return true;
}
