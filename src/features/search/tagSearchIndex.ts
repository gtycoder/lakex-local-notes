/**
 * 标签搜索索引的**装载器**（渲染层拼接，不新增索引）：
 *   tags（小记库标签目录）+ noteLinks（主库 tag_links）+ noteSummaries + quickNote summaries。
 * 四个都是 tags 空间/小记列表本来就在用的 IPC；任何一项不可用（老主进程/浏览器测试环境）⇒ 返回 null，
 * 标签命中整体降级为「没有」，标题/正文搜索完全不受影响。
 */
import { native } from "../../lib/native";
import type { NoteSummary, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";
import type { TagSearchIndex } from "./searchScope";

type TagSearchBridge = {
  listQuickNoteTags?: () => Promise<unknown>;
  listNoteTagLinks?: () => Promise<unknown>;
  listNoteSummaries?: () => Promise<unknown>;
  listQuickNotes?: () => Promise<unknown>;
};

function bridge(): TagSearchBridge {
  return native as unknown as TagSearchBridge;
}

/** 标签命中所需的 IPC 是否齐全（不齐全时 UI 不提示、标签结果为空）。 */
export function tagSearchAvailable(): boolean {
  const api = bridge();
  return typeof api.listQuickNoteTags === "function"
    && typeof api.listNoteTagLinks === "function"
    && typeof api.listNoteSummaries === "function"
    && typeof api.listQuickNotes === "function";
}

/** 把 IPC 返回值收敛成标签索引（坏数据逐项丢弃，不抛错）。 */
export function normalizeTagSearchIndex(input: {
  tags: unknown;
  links: unknown;
  notes: unknown;
  quickNotes: unknown;
}): TagSearchIndex {
  const tags = (Array.isArray(input.tags) ? input.tags : [])
    .filter((tag): tag is QuickNoteTag => !!tag && typeof (tag as QuickNoteTag).id === "string" && typeof (tag as QuickNoteTag).name === "string")
    .map((tag) => ({ id: tag.id, name: tag.name }));
  const noteLinks: Record<string, string[]> = {};
  if (input.links && typeof input.links === "object") {
    for (const [noteId, value] of Object.entries(input.links as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const tagIds = value.filter((id): id is string => typeof id === "string");
      if (tagIds.length > 0) noteLinks[noteId] = tagIds;
    }
  }
  const notes = (Array.isArray(input.notes) ? input.notes : [])
    .filter((note): note is NoteSummary => !!note && typeof (note as NoteSummary).id === "string")
    .filter((note) => !note.isPurged)
    .map((note) => ({ id: note.id, title: note.title, kind: note.kind, updatedAt: note.updatedAt }));
  const quickNotes = (Array.isArray(input.quickNotes) ? input.quickNotes : [])
    .filter((note): note is QuickNoteListSummary => !!note && typeof (note as QuickNoteListSummary).id === "string")
    .map((note) => ({ id: note.id, previewText: note.previewText, updatedAt: note.updatedAt, tagIds: note.tagIds }));
  return { tags, noteLinks, notes, quickNotes };
}

/** 装载标签搜索索引（不可用/失败 ⇒ null）。成功结果由调用方缓存，一次打开只装一次。 */
export async function loadTagSearchIndex(): Promise<TagSearchIndex | null> {
  if (!tagSearchAvailable()) return null;
  const api = bridge();
  try {
    const [tags, links, notes, quickNotes] = await Promise.all([
      api.listQuickNoteTags!(),
      api.listNoteTagLinks!(),
      api.listNoteSummaries!(),
      api.listQuickNotes!(),
    ]);
    return normalizeTagSearchIndex({ tags, links, notes, quickNotes });
  } catch {
    return null;
  }
}
