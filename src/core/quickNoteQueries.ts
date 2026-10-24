/**
 * 小记查询共享核心（Phase 0B-4：从 electron/quickNotesQueries.ts 抽取纯映射逻辑）。
 * 原则（§6.5 用户定调）：共享"难逻辑"纯函数，不共享编排骨架。
 * 本文件只包含：行→文档映射、删除行→已删记录映射（无 fs/平台依赖）。
 * 内容读取（桌面文件 / 移动端 native SQLite）由调用方注入后经 mapDocument 组装。
 */
import type { QuickNoteDocument, QuickNoteSummary } from "../lib/types.js";
import type { StoredQuickNoteContent } from "./quickNoteModel.js";

/** 行结构（与 electron/quickNotesQueries.ts QuickNoteRow 对齐；两端共用的最小字段集）。 */
export interface QuickNoteRowShape {
  id: string;
  created_at: string;
  updated_at: string;
  preview_text: string;
  image_count: number;
  content_hash: string;
  sync_state: QuickNoteSummary["syncState"];
  is_conflict: number;
  restore_pending_at?: string | null;
}

export interface QuickNoteDeletedRowShape {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string;
  conversion_target_note_id: string | null;
  ready_to_sync: number;
  purged_at?: string | null;
}

export interface QuickNoteDocumentParts {
  /** 已解析校验的内容（读取层注入；桌面读文件，移动端读存储端口）。 */
  content: StoredQuickNoteContent;
  /** 图片 URL 解析（桌面/移动端统一 canonical assetServer URL）。 */
  imageUrl(noteId: string, filename: string): string;
  /** 标签 ID → 展示名（来自标签表；墓碑/未知 ID 由调用方过滤）。 */
  tagNames(tagIds: readonly string[]): string[];
}

/** 行 → 小记文档（共享映射；content/images/tagNames 由调用方注入）。 */
export function mapQuickNoteRow(row: QuickNoteRowShape, parts: QuickNoteDocumentParts): QuickNoteDocument {
  const images = parts.content.images.map((image) => ({ ...image, url: parts.imageUrl(row.id, image.filename) }));
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    previewText: row.preview_text,
    imageCount: row.image_count,
    contentHash: row.content_hash,
    syncState: row.sync_state,
    isConflict: !!row.is_conflict,
    content: {
      version: parts.content.version,
      text: parts.content.text,
      body: parts.content.body,
      images,
      tagIds: [...parts.content.tagIds],
      tags: parts.tagNames(parts.content.tagIds),
    },
  };
}

/** 删除行 → 已删记录（共享映射）。 */
export function mapQuickNoteDeletedRow(row: QuickNoteDeletedRowShape): {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  conversionTargetNoteId: string | null;
  readyToSync: boolean;
} {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    conversionTargetNoteId: row.conversion_target_note_id ?? null,
    readyToSync: !!row.ready_to_sync,
  };
}

/** 回收站列表行映射（共享）：conversion 目标为空 + 未 purge → 展示项。 */
export function mapTrashRow(row: { id: string; created_at: string; updated_at: string; deleted_at: string }): { id: string; createdAt: string; updatedAt: string; deletedAt: string } {
  return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}
