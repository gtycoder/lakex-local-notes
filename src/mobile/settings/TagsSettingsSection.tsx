/**
 * 移动端「标签」设置页（261106 用户验收）：标签目录管理入口 + 简化标签空间。
 *
 * 信息架构（与桌面同构后再简化）：桌面是独立「标签空间」工作区（三栏）；移动端收成设置里的
 * 一个子页 = ①「管理标签」入口（新建 / 重命名 / 合并到… / 删除，复用 MobileQuickNoteTagManager）
 * ② 标签列表 → 选中标签后的聚合（文档 + 小记，更新时间倒序；行点击打开，行内可移除该标签）。
 *
 * 数据单一来源：目录 = quick-notes 标签库（bridge.* 通道）；文档关系 = bridge.listNoteTagLinks / setNoteTags；
 * 小记关系 = quickNotes 的 tagIds + bridge.setQuickNoteTags。删除/合并对文档关系的同库收敛由
 * quickNoteTagService 完成（本页只做读取与「移除单个引用」）。
 * 版面：0 新增 CSS —— 只用既有 mb-set-* / mb-row* / mb-btn / mb-empty 与 qn-tag-* 语汇。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Feather, FileText, Tag } from "lucide-react";
import type { QuickNoteTag } from "../../core/quickNoteTags";
import { buildQuickNoteTagIndex, buildQuickNoteTagOptions } from "../../core/quickNoteTags";
import { formatListTime } from "../../core/dateFormat";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { LocalNoteSummary } from "../data/noteRepository";
import type { MobileQuickNote } from "../home/HomePage";
import { MobileQuickNoteTagManager } from "../home/MobileQuickNoteTagManager";
import { bridge } from "../bridge";
import { Block, Group } from "../ui/settingsPrimitives";
import { showToast } from "../ui/toastBus";

/** 文档 ↔ 标签关系表（noteId → tagIds；来自 bridge.listNoteTagLinks）。 */
export type NoteTagLinks = Readonly<Record<string, readonly string[]>>;

export interface TagAggregateRow {
  kind: "doc" | "quick";
  id: string;
  title: string;
  updatedAt: string;
}

export interface TagCounts {
  docs: Record<string, number>;
  quickNotes: Record<string, number>;
}

/**
 * 每个标签的引用数（文档 = 在 links 里且文档仍存在；小记 = tagIds 命中，同一条只算一次）。
 * 纯函数：计数口径与桌面 tags 目录一致（文档数 / 小记数分开报）。
 */
export function tagCounts(
  tags: readonly QuickNoteTag[],
  links: NoteTagLinks | null,
  notes: readonly LocalNoteSummary[],
  quickNotes: readonly Pick<MobileQuickNote, "id" | "tagIds">[],
): TagCounts {
  const known = new Set(tags.map((tag) => tag.id));
  const liveNotes = new Set(notes.map((note) => note.id));
  const docs: Record<string, number> = {};
  const quick: Record<string, number> = {};
  for (const tag of tags) { docs[tag.id] = 0; quick[tag.id] = 0; }
  for (const [noteId, tagIds] of Object.entries(links ?? {})) {
    if (!liveNotes.has(noteId)) continue;
    for (const tagId of new Set(tagIds)) if (known.has(tagId)) docs[tagId] += 1;
  }
  for (const note of quickNotes) {
    for (const tagId of new Set(note.tagIds)) if (known.has(tagId)) quick[tagId] += 1;
  }
  return { docs, quickNotes: quick };
}

const timeOf = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

/** 某个标签下的聚合：文档 + 小记，更新时间倒序（同一时间按 kind/id 稳定排序，避免列表跳动）。 */
export function aggregateTagRows(
  tagId: string,
  links: NoteTagLinks | null,
  notes: readonly LocalNoteSummary[],
  quickNotes: readonly Pick<MobileQuickNote, "id" | "previewText" | "updatedAt" | "tagIds">[],
): TagAggregateRow[] {
  const rows: TagAggregateRow[] = [];
  for (const note of notes) {
    if (!(links?.[note.id] ?? []).includes(tagId)) continue;
    rows.push({ kind: "doc", id: note.id, title: note.title || "无标题文档", updatedAt: note.updatedAt });
  }
  for (const note of quickNotes) {
    if (!note.tagIds.includes(tagId)) continue;
    rows.push({ kind: "quick", id: note.id, title: note.previewText || "（空白小记）", updatedAt: note.updatedAt });
  }
  return rows.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export interface TagsSettingsSectionProps {
  /** 标签目录（App 已加载；顺序 = 设备本地展示顺序）。 */
  tags: readonly QuickNoteTag[];
  /** 文档清单（标题 / 更新时间）。 */
  notes: readonly LocalNoteSummary[];
  /** 小记清单（摘要 / 更新时间 / 标签）。 */
  quickNotes: readonly MobileQuickNote[];
  onOpenNote(id: string): void;
  /** 打开小记（回首页小记 tab 并定位）；不传则行点击提示不可用。 */
  onOpenQuickNote?(id: string): void;
  /** 关系 / 目录变了以后刷新 App 数据（目录 + 小记列表）。 */
  onChanged(): Promise<void>;
}

const fmtTime = (iso: string): string => {
  try { return formatListTime(new Date(iso), new Date()); } catch { return iso; }
};

export function TagsSettingsSection({ tags, notes, quickNotes, onOpenNote, onOpenQuickNote, onChanged }: TagsSettingsSectionProps) {
  const [links, setLinks] = useState<NoteTagLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadLinks = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLinksError(null);
    try {
      setLinks(await bridge.listNoteTagLinks());
    } catch (error) {
      setLinks(null);
      setLinksError(getNativeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  const counts = useMemo(() => tagCounts(tags, links, notes, quickNotes), [tags, links, notes, quickNotes]);
  const summaries = useMemo(
    () => buildQuickNoteTagOptions(tags, buildQuickNoteTagIndex(quickNotes, tags, (note) => note.tagIds).tags),
    [tags, quickNotes],
  );
  const selectedTag = useMemo(() => (selectedTagId ? tags.find((tag) => tag.id === selectedTagId) ?? null : null), [tags, selectedTagId]);
  const rows = useMemo(
    () => (selectedTag ? aggregateTagRows(selectedTag.id, links, notes, quickNotes) : []),
    [selectedTag, links, notes, quickNotes],
  );

  // 目录变化（删除/合并/远端同步）后选中项可能已不存在 ⇒ 回到列表，而不是显示空标签。
  useEffect(() => {
    if (selectedTagId && !tags.some((tag) => tag.id === selectedTagId)) setSelectedTagId(null);
  }, [tags, selectedTagId]);

  const openRow = (row: TagAggregateRow): void => {
    if (row.kind === "doc") { onOpenNote(row.id); return; }
    if (onOpenQuickNote) { onOpenQuickNote(row.id); return; }
    showToast("小记入口暂不可用", { type: "error" });
  };

  /** 行内移除该标签：文档走 setNoteTags，小记走 setQuickNoteTags（只动关系，不动正文）。 */
  const removeRow = async (row: TagAggregateRow): Promise<void> => {
    if (!selectedTag || busy) return;
    setBusy(true);
    try {
      if (row.kind === "doc") {
        const current = links?.[row.id] ?? [];
        await bridge.setNoteTags(row.id, current.filter((id) => id !== selectedTag.id));
        await loadLinks();
      } else {
        const note = quickNotes.find((item) => item.id === row.id);
        const current = note?.tagIds ?? [];
        await bridge.setQuickNoteTags(row.id, current.filter((id) => id !== selectedTag.id));
      }
      await onChanged();
      showToast("已移除标签");
    } catch (error) {
      showToast("移除标签失败：" + getNativeErrorMessage(error), { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  /** 管理页任一写操作完成后：文档关系可能与标签一起变了 ⇒ 关系与 App 数据一起刷新。 */
  const reloadAll = async (): Promise<void> => { await loadLinks(); await onChanged(); };

  return (
    <>
      <Group title="标签目录" icon={<Tag size={16} />}>
        <Block name="管理标签" desc="新建 / 重命名 / 合并到… / 删除；拖动排序只在本机生效（不同步）。">
          <button type="button" className="mb-btn mb-btn--secondary" onClick={() => setManagerOpen(true)}>管理标签</button>
        </Block>
      </Group>

      <Group title="标签空间" icon={<Feather size={16} />}>
        {linksError ? (
          <Block name="标签目录暂不可用" desc={linksError}>
            <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void loadLinks()}>重试</button>
          </Block>
        ) : selectedTag ? (
          <Block name={"「" + selectedTag.name + "」"} desc={rows.length === 0 ? "这个标签下还没有文档或小记" : "文档与小记按更新时间排序；行内可直接移除该标签。"}>
            <div className="mb-set-items">
              <button type="button" className="mb-row" onClick={() => setSelectedTagId(null)}>
                <ChevronLeft size={16} className="mb-row__icon" />
                <span className="mb-row__title">全部标签</span>
              </button>
              {rows.map((row) => (
                <div key={row.kind + row.id} className="mb-row mb-row--two-line">
                  <button type="button" className="mb-row__main" onClick={() => openRow(row)}>
                    <span className="mb-row__title">{row.title}</span>
                    <span className="mb-row__sub">
                      {row.kind === "doc" ? <FileText size={12} /> : <Feather size={12} />}
                      {row.kind === "doc" ? "文档" : "小记"}　{fmtTime(row.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mb-row__action mb-btn mb-btn--ghost mb-btn--sm"
                    disabled={busy}
                    aria-label={"从「" + selectedTag.name + "」移除「" + row.title + "」"}
                    onClick={() => void removeRow(row)}
                  >移除</button>
                </div>
              ))}
            </div>
          </Block>
        ) : (
          <Block name="按标签查看" desc={loading ? "读取标签引用…" : "点一个标签，查看它下面的文档与小记。"}>
            <div className="mb-set-items">
              {tags.length === 0 ? (
                <div className="mb-empty mb-empty--inset">还没有标签。在「管理标签」里新建，或在文档 / 小记上加标签</div>
              ) : tags.map((tag) => (
                <button key={tag.id} type="button" className="mb-row mb-row--two-line" onClick={() => setSelectedTagId(tag.id)}>
                  <Tag size={18} className="mb-row__icon" />
                  <span className="mb-row__main">
                    <span className="mb-row__title">{tag.name}</span>
                    <span className="mb-row__sub">{(counts.docs[tag.id] ?? 0) + " 篇文档、" + (counts.quickNotes[tag.id] ?? 0) + " 条小记"}</span>
                  </span>
                  <ChevronRight size={18} className="mb-row__chevron" />
                </button>
              ))}
            </div>
          </Block>
        )}
      </Group>

      <MobileQuickNoteTagManager
        open={managerOpen}
        tags={summaries}
        docCounts={counts.docs}
        onClose={() => setManagerOpen(false)}
        onChanged={reloadAll}
      />
    </>
  );
}
