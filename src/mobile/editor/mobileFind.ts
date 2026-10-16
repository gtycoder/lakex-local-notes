/**
 * 移动端「文档内查找」的 DOM 引擎（261016）。
 *
 * 为什么自研：内核虽有查找替换面板（`.ne-ui-search-panel`），但它在**移动端不存在** ——
 * 移动端关掉了内核工具栏插件（`showToolbar:false` ⇒ `disabledPlugins:["save","toolbar"]`），
 * 而该面板只随工具栏的 search descriptor 一起挂载（见 docs/LAKEX-CONTRACT.md §5.39）。
 * 移动端文档编辑面开了 `disableVirtualRendering:true`（整篇正文都在 DOM 里）⇒ DOM 内查找是准确的。
 *
 * 高亮走 CSS Custom Highlight API（`CSS.highlights` + `::highlight()`）：不改 DOM、可多命中、能直接给出 `n/m`；
 * 宿主不支持该 API 时降级为「只滚动定位、不高亮」。
 */
const ALL_KEY = "mb-find";
const ACTIVE_KEY = "mb-find-active";
/** 单次扫描的命中上限（防超大文档把高亮对象撑爆）。 */
export const MAX_FIND_MATCHES = 600;

/** 纯函数：命中索引环形步进（total<=0 或 current<0 时给出合法起点）。 */
export function nextMatchIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : total - 1;
  return (current + delta + total) % total;
}

/**
 * 纯函数：**重扫后**调和当前命中位（正文被编辑 / 命中总量变化时用）：
 * 无命中 → -1；原位仍有效 → 保持（不把用户跳回第一条）；否则回到首条。
 */
export function reconcileMatchIndex(current: number, total: number): number {
  if (total <= 0) return -1;
  return current >= 0 && current < total ? current : 0;
}

/** 纯函数：一段文本里的**非重叠**命中起始位（大小写不敏感；中文按字符匹配）。 */
export function findMatchOffsets(text: string, query: string): number[] {
  if (!text || !query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const hit = haystack.indexOf(needle, from);
    if (hit < 0) break;
    out.push(hit);
    from = hit + needle.length;
  }
  return out;
}

interface HighlightCtor { new (...ranges: Range[]): unknown }
interface HighlightRegistry { set(name: string, value: unknown): void; delete(name: string): void }

function highlightApi(): { registry: HighlightRegistry; Ctor: HighlightCtor } | null {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  if (!registry || typeof registry.set !== "function" || typeof Ctor !== "function") return null;
  return { registry, Ctor };
}

/** 扫描容器内的文本节点，返回命中区间（跳过空节点与 script/style）。 */
export function collectMatchRanges(root: HTMLElement, query: string): Range[] {
  if (!query) return [];
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      return (node as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const ranges: Range[] = [];
  let node = walker.nextNode() as Text | null;
  while (node && ranges.length < MAX_FIND_MATCHES) {
    const text = node.data;
    for (const offset of findMatchOffsets(text, query)) {
      const range = doc.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + query.length);
      ranges.push(range);
      if (ranges.length >= MAX_FIND_MATCHES) break;
    }
    node = walker.nextNode() as Text | null;
  }
  return ranges;
}

/** 应用高亮：全部命中一套、当前命中另一套（API 不可用时静默降级）。 */
export function applyFindHighlights(ranges: Range[], activeIndex: number): void {
  const api = highlightApi();
  if (!api) return;
  if (ranges.length === 0) { clearFindHighlights(); return; }
  api.registry.set(ALL_KEY, new api.Ctor(...ranges));
  const active = ranges[activeIndex];
  if (active) api.registry.set(ACTIVE_KEY, new api.Ctor(active));
  else api.registry.delete(ACTIVE_KEY);
}

export function clearFindHighlights(): void {
  const api = highlightApi();
  if (!api) return;
  api.registry.delete(ALL_KEY);
  api.registry.delete(ACTIVE_KEY);
}

/** 把命中滚进容器可视区（只改容器 scrollTop，不动 DOM）。 */
export function scrollRangeIntoView(root: HTMLElement, range: Range): void {
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return;
  const rootRect = root.getBoundingClientRect();
  const margin = 24;
  if (rect.top >= rootRect.top + margin && rect.bottom <= rootRect.bottom - margin) return;
  root.scrollTop += rect.top - rootRect.top - Math.max(0, (root.clientHeight - rect.height) / 3);
}
