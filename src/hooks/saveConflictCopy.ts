import type { NoteDocument } from "../lib/types";
import type { NoteKind } from "../core/noteKind";

/**
 * 「保存冲突 → 另存为副本」的纯编排（Batch4-D）：把用户当前编辑器里的正文写成**一篇独立新文档**
 * （与原文同类型、同父级），原文档随后载入磁盘版本。UI（App）只注入创建/保存端口，便于单测。
 *
 * 为什么不直接用 createNoteIn：多维表/表格/画板/手写板的 kind 必须跟着原文档走，否则副本会被当成
 * Lake 文档打开（正文是 JSON，一打开就毁）。这里是 kind → 创建函数映射的**单一来源**。
 */
export type ConflictCopyKind = NoteKind;

export interface ConflictCopyPorts {
  createNote(parentId: string | null, title: string): Promise<NoteDocument>;
  createUsheet(parentId: string | null, title: string): Promise<NoteDocument>;
  createBitable(parentId: string | null, title: string): Promise<NoteDocument>;
  createBoard(parentId: string | null, title: string): Promise<NoteDocument>;
  createInk(parentId: string | null, title: string): Promise<NoteDocument>;
  /** 保存副本正文（新文档，故不传 baseHash）。 */
  saveNote(id: string, title: string, content: string): Promise<unknown>;
}

export interface CreateConflictCopyInput {
  ports: ConflictCopyPorts;
  /** 原文档类型（缺省 doc）。 */
  kind?: ConflictCopyKind | null;
  parentId: string | null;
  /** 原文档标题（副本标题自动加后缀）。 */
  title: string;
  /** 未保存的本地正文（编辑器当前内容）。 */
  content: string;
}

/** 副本标题后缀（单一来源）。 */
export const CONFLICT_COPY_SUFFIX = "（冲突副本）";

export function conflictCopyTitle(title: string): string {
  const base = title.trim() || "无标题";
  return base.endsWith(CONFLICT_COPY_SUFFIX) ? base : base + CONFLICT_COPY_SUFFIX;
}

/** 创建副本并写入正文；返回新文档（调用方据此刷新目录并提示用户）。失败向上抛（由调用方提示）。 */
export async function createConflictCopy(input: CreateConflictCopyInput): Promise<NoteDocument> {
  const { ports, kind, parentId, content } = input;
  const copyTitle = conflictCopyTitle(input.title);
  const created = kind === "usheet" ? await ports.createUsheet(parentId, copyTitle)
    : kind === "bitable" ? await ports.createBitable(parentId, copyTitle)
    : kind === "board" ? await ports.createBoard(parentId, copyTitle)
    : kind === "ink" ? await ports.createInk(parentId, copyTitle)
    : await ports.createNote(parentId, copyTitle);
  await ports.saveNote(created.id, created.title, content);
  return created;
}
