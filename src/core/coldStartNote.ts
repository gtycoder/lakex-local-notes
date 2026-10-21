/**
 * 冷启动落点（用户 261022 定）：**优先 Lake 文档，其次多维表**。
 *
 * 为什么：冷启动第一个打开的文档会被立刻挂载编辑器——表格（Univer 全量 preset）/画板/手写板
 * 首开成本明显高于 Lake 文档；启动瞬间落它们等于把"启动慢"钉在第一次交互上。
 * 因此：上次打开的若是 Lake 文档 → 直接落它；否则落最近更新的 Lake 文档；再否则最近更新的多维表；
 * 都没有才退回"上次打开/最近更新"的那个（宁可慢也不让用户找不到上次的文档）。
 */
import type { NoteSummary } from "../lib/types";

type ColdStartNote = Pick<NoteSummary, "id" | "kind" | "updatedAt">;

export function chooseColdStartNoteId(
  notes: readonly ColdStartNote[],
  lastOpenedNoteId: string | null | undefined,
): string | null {
  if (notes.length === 0) return null;
  const last = lastOpenedNoteId ? notes.find((note) => note.id === lastOpenedNoteId) : undefined;
  const byRecent = [...notes].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  if (last && (last.kind ?? "doc") === "doc") return last.id;
  const doc = byRecent.find((note) => (note.kind ?? "doc") === "doc");
  if (doc) return doc.id;
  const bitable = byRecent.find((note) => note.kind === "bitable");
  if (bitable) return bitable.id;
  return last?.id ?? byRecent[0].id;
}
