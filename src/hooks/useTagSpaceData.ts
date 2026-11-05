import { useCallback, useEffect, useState } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import type { QuickNoteListSummary, QuickNoteTag } from "../lib/types";
import type { QuickNoteTagSummary } from "../core/quickNoteTags";
import { documentTagBridgeAvailable, loadDocumentTagLinks } from "../features/tags/documentTags";
import type { DocumentTagLinks } from "../features/tags/tagsModel";

/**
 * 标签空间的数据装载（P1）：标签目录（quick-notes 库，已同步）+ 文档关系（主库，IPC）+ 小记列表。
 *
 * - 目录读失败（小记库降级）不发散：`error` 给可读文案，页面照常渲染空态；
 * - 文档关系数据层不可用（老主进程/浏览器端）⇒ `available:false`，由页面给提示；
 * - 组件不直接摸 native：App 注入这份数据，渲染组件保持可单测。
 */
export interface TagSpaceData {
  loading: boolean;
  /** 文档标签数据层是否可用。 */
  available: boolean;
  /** 目录读取失败的可读提示（成功为 null）。 */
  error: string | null;
  tags: QuickNoteTag[];
  /** 选择器/筛选用的目录（含 0 引用的新标签）。 */
  tagOptions: QuickNoteTagSummary[];
  links: DocumentTagLinks;
  quickNotes: QuickNoteListSummary[];
  reload(): Promise<void>;
}

export function useTagSpaceData(): TagSpaceData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<QuickNoteTag[]>([]);
  const [links, setLinks] = useState<DocumentTagLinks>({});
  const [quickNotes, setQuickNotes] = useState<QuickNoteListSummary[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const catalog = await native.listQuickNoteTags();
      setTags(Array.isArray(catalog) ? catalog : []);
    } catch (reason) {
      // 小记库降级：目录读不出来 → 给可读提示，别把整个页面变成空白/报错。
      setTags([]);
      setError("标签目录暂不可用：" + getNativeErrorMessage(reason));
    }
    const documentLinks = await loadDocumentTagLinks();
    setLinks(documentLinks.links);
    try {
      const list = await native.listQuickNotes();
      setQuickNotes(Array.isArray(list) ? list : []);
    } catch {
      // 小记列表同样可能受降级影响：标签页少了小记分组比整页失败好。
      setQuickNotes([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return {
    loading,
    available: documentTagBridgeAvailable(),
    error,
    tags,
    tagOptions: tags.map((tag) => ({ ...tag, count: 0 })),
    links,
    quickNotes,
    reload: load,
  };
}
