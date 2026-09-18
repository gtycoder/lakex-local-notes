/**
 * 文档类型（kind）：doc = Lake 文档，sheet = 表格，bitable = 多维表。
 *
 * 只加在 notes.kind 与 manifest.kind 上，**不动 tree_nodes.node_type**（那套约束被回收站/目录/两端
 * 映射依赖，新增取值回归面最大）。缺省 "doc" 兼容旧库与旧清单。
 * 见 docs/SHEET-BITABLE-DESIGN-260918.md §4.3。
 */
export type NoteKind = "doc" | "sheet" | "bitable";

export const NOTE_KINDS: readonly NoteKind[] = ["doc", "sheet", "bitable"] as const;

/** 任意输入 → 合法 kind（非法/缺失一律回退 "doc"）。 */
export function normalizeNoteKind(value: unknown): NoteKind {
  return value === "sheet" || value === "bitable" ? value : "doc";
}

export function isSheetKind(value: unknown): boolean {
  return value === "sheet";
}
