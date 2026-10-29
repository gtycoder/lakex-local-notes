/**
 * 文档类型（kind）：doc = Lake 文档，usheet = 表格（Univer），bitable = 多维表，board = 画板，ink = 手写板。
 *
 * 只加在 notes.kind 与 manifest.kind 上，**不动 tree_nodes.node_type**（那套约束被回收站/目录/两端
 * 映射依赖，新增取值回归面最大）。缺省 "doc" 兼容旧库与旧清单。
 * 见 docs/STORAGE-LAYERS.md §4.3、docs/STORAGE-LAYERS.md。
 *
 * ⚠️ 新增取值必须确认两端 NOTE_KINDS 白名单同步：未知 kind 会被旧端 normalizeNoteKind
 * 静默降级成 doc ⇒ 旧端把画板 JSON 当 Lake 文档导入并保存 = 毁正文。
 * （manifest 时代已结束，CORE-05：不再有 MANIFEST_VERSION 可升；v3 索引的 kind 白名单就是这里。）
 */
export type NoteKind = "doc" | "usheet" | "bitable" | "board" | "ink";

export const NOTE_KINDS: readonly NoteKind[] = ["doc", "usheet", "bitable", "board", "ink"] as const;

/** 任意输入 → 合法 kind（非法 / 缺失 / 已废弃的旧 kind 一律回退 "doc"：按 AGENTS §3#7 不做迁移 / 兼容）。 */
export function normalizeNoteKind(value: unknown): NoteKind {
  return value === "usheet" || value === "bitable" || value === "board" || value === "ink" ? value : "doc";
}
