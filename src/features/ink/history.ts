import type { InkDoc, InkPage } from "../../core/inkDoc.js";

/**
 * 手写板 undo/redo 栈：只存「受影响页」的补丁，不再为每一步复制整篇正文。
 *
 * - 每次提交只把受影响的页序列化成 before/after 片段（深拷贝，天然无别名）；
 * - 完整正文序列化只发生在保存路径（InkPad.commit 每次一次）；
 * - 预算按补丁内快照字符计（快照是补丁体积的绝对大头），16 MiB：
 *   10 MiB 正文 / 100 页时单步约 2 × 100 KiB，60 步全保留，满足「大正文 ≥30 步」。
 */
export const INK_UNDO_LIMIT = 60;
export const INK_UNDO_MAX_CHARS = 16 * 1024 * 1024;
const PATCH_OVERHEAD_CHARS = 160;

export interface InkPageDelta {
  id: string;
  /** 本次操作前的页快照（JSON 字符串）；null = 该页此前不存在。 */
  before: string | null;
  /** 本次操作后的页快照（JSON 字符串）；null = 该页被删除。 */
  after: string | null;
}

export interface InkOrderDelta {
  before: string[];
  after: string[];
}

export interface InkPatch {
  pages: InkPageDelta[];
  /** 页新增/删除/重排时记录（before/after 页 id 顺序）；纯页内改动省略。 */
  order?: InkOrderDelta;
}

export type InkPatchDirection = "undo" | "redo";

export interface InkHistoryEntry {
  patch: InkPatch;
  chars: number;
}

function snapshotPage(page: InkPage | null): string | null {
  return page ? JSON.stringify(page) : null;
}

export function inkPageDelta(before: InkPage | null, after: InkPage | null): InkPageDelta {
  const id = (after ?? before)?.id;
  if (!id) throw new Error("手写板补丁缺少页面 id");
  return { id, before: snapshotPage(before), after: snapshotPage(after) };
}

export function inkPagePatch(before: InkPage | null, after: InkPage | null): InkPatch {
  if (!before && !after) return { pages: [] };
  return { pages: [inkPageDelta(before, after)] };
}

/** 页序无变化返回 null（调用方据此省略 order 字段）。 */
export function inkOrderDelta(
  before: ReadonlyArray<Pick<InkPage, "id">>,
  after: ReadonlyArray<Pick<InkPage, "id">>,
): InkOrderDelta | null {
  const beforeIds = before.map((page) => page.id);
  const afterIds = after.map((page) => page.id);
  if (beforeIds.length === afterIds.length && beforeIds.every((id, index) => id === afterIds[index])) return null;
  return { before: beforeIds, after: afterIds };
}

export function inkPatchChars(patch: InkPatch): number {
  let chars = PATCH_OVERHEAD_CHARS;
  for (const delta of patch.pages) {
    chars += delta.id.length + 32;
    chars += delta.before?.length ?? 0;
    chars += delta.after?.length ?? 0;
  }
  if (patch.order) {
    chars += 32;
    for (const id of patch.order.before) chars += id.length + 3;
    for (const id of patch.order.after) chars += id.length + 3;
  }
  return chars;
}

export function pushBoundedHistory(
  stack: InkHistoryEntry[],
  patch: InkPatch,
  limit = INK_UNDO_LIMIT,
  maxChars = INK_UNDO_MAX_CHARS,
): void {
  stack.push({ patch, chars: inkPatchChars(patch) });
  let totalChars = stack.reduce((sum, item) => sum + item.chars, 0);
  while (stack.length > limit || totalChars > maxChars) {
    const removed = stack.shift();
    if (removed === undefined) break;
    totalChars -= removed.chars;
  }
}

function pageFromSnapshot(snapshot: string): InkPage | null {
  try {
    return JSON.parse(snapshot) as InkPage;
  } catch {
    return null;
  }
}

/**
 * 把补丁应用到当前文档：undo 取 before，redo 取 after。
 * 返回新文档，页对象均来自快照解析，不与历史栈共享引用。
 */
export function applyInkPatch(doc: InkDoc, patch: InkPatch, direction: InkPatchDirection): InkDoc {
  const byId = new Map<string, InkPage>(doc.pages.map((page) => [page.id, page]));
  for (const delta of patch.pages) {
    const snapshot = direction === "undo" ? delta.before : delta.after;
    if (snapshot === null) {
      byId.delete(delta.id);
      continue;
    }
    const page = pageFromSnapshot(snapshot);
    if (page) byId.set(page.id, page);
  }

  const order = direction === "undo" ? patch.order?.before : patch.order?.after;
  const pages: InkPage[] = [];
  const used = new Set<string>();
  if (order) {
    for (const id of order) {
      const page = byId.get(id);
      if (!page) continue;
      pages.push(page);
      used.add(id);
    }
  }
  for (const page of doc.pages) {
    if (used.has(page.id)) continue;
    const next = byId.get(page.id);
    if (!next) continue;
    pages.push(next);
    used.add(page.id);
  }
  for (const [id, page] of byId) {
    if (used.has(id)) continue;
    pages.push(page);
    used.add(id);
  }
  if (pages.length === 0) return doc;

  const activeIndex = doc.pages.findIndex((page) => page.id === doc.activePageId);
  const activePageId = pages.some((page) => page.id === doc.activePageId)
    ? doc.activePageId
    : pages[Math.min(Math.max(activeIndex, 0), pages.length - 1)].id;
  return { ...doc, pages, activePageId };
}
