import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { bridge } from "../bridge";

export interface QuickNoteDetail {
  body: string;
  images: StoredQuickNoteImage[];
  tags: string[];
  tagIds: string[];
  firstImage: string | null;
  updatedAt: string;
}

export interface QuickNoteDetailSource {
  id: string;
  updatedAt: string;
  tags: string[];
}

export interface QuickNoteDetailReader {
  (id: string): Promise<{
    content: { body: string; images: StoredQuickNoteImage[]; tagIds: string[] };
    tags: string[];
    updatedAt: string;
  } | null>;
}

const DEFAULT_CACHE_LIMIT = 12;

/** 小记列表只带轻量元数据；详情按卡片可见性读取，去重、LRU 与失效由本 hook 拥有。 */
export function useQuickNoteDetailCache(
  notes: readonly QuickNoteDetailSource[],
  readDetail: QuickNoteDetailReader = (id) => bridge.readQuickNote(id),
  limit = DEFAULT_CACHE_LIMIT,
) {
  const [details, setDetails] = useState<Map<string, QuickNoteDetail>>(() => new Map());
  const detailsRef = useRef<Map<string, QuickNoteDetail>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const readDetailRef = useRef(readDetail);
  readDetailRef.current = readDetail;

  const loadDetail = useCallback(async (id: string): Promise<void> => {
    if (detailsRef.current.has(id) || loadingRef.current.has(id)) return;
    loadingRef.current.add(id);
    try {
      const full = await readDetailRef.current(id);
      if (!full) return;
      const next = new Map(detailsRef.current);
      next.delete(id);
      const images = Array.isArray(full.content.images) ? full.content.images : [];
      next.set(id, {
        body: typeof full.content.body === "string" ? full.content.body : "",
        images,
        tags: Array.isArray(full.tags) ? full.tags : [],
        tagIds: Array.isArray(full.content.tagIds) ? full.content.tagIds : [],
        firstImage: images[0]?.filename ?? null,
        updatedAt: full.updatedAt,
      });
      while (next.size > limit) {
        const oldest = next.keys().next().value as string | undefined;
        if (!oldest) break;
        next.delete(oldest);
      }
      detailsRef.current = next;
      setDetails(next);
    } catch {
      // 单条正文读取失败：卡片保留轻量摘要，允许下次可见时重试。
    } finally {
      loadingRef.current.delete(id);
    }
  }, [limit]);

  // 列表刷新后丢弃已过期详情；标签变化但 updatedAt 不变时也要失效。
  useEffect(() => {
    const base = new Map(notes.map((note) => [note.id, note] as const));
    const next = new Map(detailsRef.current);
    let changed = false;
    for (const [id, detail] of next) {
      const note = base.get(id);
      if (!note || note.updatedAt !== detail.updatedAt || note.tags.join("\u0000") !== detail.tags.join("\u0000")) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) {
      detailsRef.current = next;
      setDetails(next);
    }
  }, [notes]);

  return { details, loadDetail };
}
