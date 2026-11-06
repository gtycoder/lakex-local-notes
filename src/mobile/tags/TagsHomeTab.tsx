/**
 * 一级「标签」页（261106 用户验收；与小记/知识库并列，flomo 式信息架构）：
 * 标签即入口 → 点进去看内容 → 编辑动作收在「管理」次级入口。
 *
 * 列表：标签名 + 「N 篇文档、M 条小记」（设备本地顺序，不重新排序）+ chevron；
 *   右上「管理」进入管理态（新建/重命名/合并到…/删除/长按拖拽，主体复用 TagManageList），
 *   右上「＋」新建（弹输入，MobileSheet）。
 * 详情：点标签进来 —— 文档 / 小记两段（各自按 updatedAt 倒序），行点击打开对应内容；
 *   行内「移除」= 只删这条引用（文档 setNoteTags / 小记 setQuickNoteTags），成功后刷新关系与计数。
 *
 * 计数/聚合复用 tags/tagAggregate 的纯函数（不复制第二套）；删除/合并文案复用 tagManageCopy。
 * 版面只用既有 mb-* / qn-tag* 语汇（0 新增 CSS）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Feather, FileText, Plus, Settings2, Tag } from "lucide-react";
import type { QuickNoteTag } from "../../core/quickNoteTags";
import { buildQuickNoteTagIndex, buildQuickNoteTagOptions } from "../../core/quickNoteTags";
import { formatListTime } from "../../core/dateFormat";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { LocalNoteSummary } from "../data/noteRepository";
import type { MobileQuickNote } from "../home/HomePage";
import { bridge } from "../bridge";
import { MobileSheet } from "../ui/MobileSheet";
import { showToast } from "../ui/toastBus";
import { aggregateTagRows, tagCounts, type NoteTagLinks, type TagAggregateRow } from "./tagAggregate";
import { createTagFromName } from "./tagCreate";
import { TagManageList } from "./TagManageList";

export interface TagsHomeTabProps {
  /** 标签目录（App 快照；顺序 = 设备本地展示顺序）。 */
  tags: readonly QuickNoteTag[];
  notes: readonly LocalNoteSummary[];
  quickNotes: readonly MobileQuickNote[];
  /** 当前是否在这一页（不活动时不读关系，避免冷启动多一次桥往返）。 */
  active: boolean;
  onOpenNote(id: string): void;
  /** 打开小记：回首页小记 tab 并定位（与全局搜索同一条通路）。 */
  onOpenQuickNote(id: string): void;
  /** 目录/关系变了以后刷新 App 快照（目录 + 小记列表）。 */
  onChanged(): Promise<void>;
}

const fmtTime = (iso: string): string => {
  try { return formatListTime(new Date(iso), new Date()); } catch { return iso; }
};

export function TagsHomeTab({ tags, notes, quickNotes, active, onOpenNote, onOpenQuickNote, onChanged }: TagsHomeTabProps) {
  const [links, setLinks] = useState<NoteTagLinks | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadLinks = useCallback(async (): Promise<void> => {
    setLoadingLinks(true);
    setLinksError(null);
    try {
      setLinks(await bridge.listNoteTagLinks());
    } catch (error) {
      setLinks(null);
      setLinksError(getNativeErrorMessage(error));
    } finally {
      setLoadingLinks(false);
    }
  }, []);

  // 只在真正切到这一页时读关系（三页常驻，冷启动不该多一次往返）。
  useEffect(() => {
    if (!active || links !== null || linksError !== null) return;
    void loadLinks();
  }, [active, links, linksError, loadLinks]);

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

  // 目录变化（删除/合并/远端同步）后选中项可能已不存在 ⇒ 回到列表。
  useEffect(() => {
    if (selectedTagId && !tags.some((tag) => tag.id === selectedTagId)) setSelectedTagId(null);
  }, [tags, selectedTagId]);

  /** 管理态任一写操作完成后：关系可能变了 ⇒ 关系 + App 快照一起刷。 */
  const reloadAll = async (): Promise<void> => { await loadLinks(); await onChanged(); };

  const openRow = (row: TagAggregateRow): void => {
    if (row.kind === "doc") onOpenNote(row.id);
    else onOpenQuickNote(row.id);
  };

  /** 行内移除该标签：只动关系、不动正文；失败明确提示并保留原列表。 */
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
        await bridge.setQuickNoteTags(row.id, (note?.tagIds ?? []).filter((id) => id !== selectedTag.id));
      }
      await onChanged();
      showToast("已移除标签");
    } catch (error) {
      showToast("移除标签失败：" + getNativeErrorMessage(error), { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createTagFromName(createName, tags);
      setCreateOpen(false);
      setCreateName("");
      await reloadAll();
      showToast("已新建标签");
    } catch (error) {
      setCreateError(getNativeErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const docs = rows.filter((row) => row.kind === "doc");
  const quickRows = rows.filter((row) => row.kind === "quick");

  /** 聚合行：整行可点（role=button）+ 行尾「移除」（独立按钮，点击 stopPropagation）。 */
  const renderRow = (row: TagAggregateRow) => (
    <div
      key={row.kind + row.id}
      className="mb-row mb-row--two-line"
      role="button"
      tabIndex={0}
      onClick={() => openRow(row)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRow(row); } }}
    >
      <span className="mb-row__main">
        <span className="mb-row__title">{row.title}</span>
        <span className="mb-row__sub">{row.kind === "doc" ? "文档" : "小记"}　{fmtTime(row.updatedAt)}</span>
      </span>
      <button
        type="button"
        className="mb-btn mb-btn--ghost"
        disabled={busy}
        aria-label={"从「" + (selectedTag?.name ?? "") + "」移除「" + row.title + "」"}
        onClick={(event) => { event.stopPropagation(); void removeRow(row); }}
      >移除</button>
    </div>
  );

  return (
    <div className="mobile-scroll">
      <div className="qn-tag-filter-bar" role="group" aria-label="标签页操作">
        <button
          type="button"
          className={"qn-tag" + (manage ? " is-selected" : "")}
          aria-pressed={manage}
          aria-label={manage ? "完成标签管理" : "管理标签"}
          onClick={() => { setManage(!manage); setSelectedTagId(null); }}
        >
          <Settings2 size={14} /><span>{manage ? "完成" : "管理"}</span>
        </button>
        <button type="button" className="qn-tag" aria-label="新建标签" onClick={() => { setCreateError(null); setCreateOpen(true); }}>
          <Plus size={14} /><span>新建</span>
        </button>
      </div>

      {selectedTag ? (
        <div className="mb-set-items">
          <button type="button" className="mb-row" onClick={() => setSelectedTagId(null)}>
            <ChevronLeft size={16} className="mb-row__icon" />
            <span className="mb-row__title">全部标签</span>
          </button>
          <div className="qn-tag-sheet__section">
            <Tag size={14} /><span>{selectedTag.name}</span>
            <span className="qn-tag-sheet__count">{(counts.docs[selectedTag.id] ?? 0) + " 篇文档、" + (counts.quickNotes[selectedTag.id] ?? 0) + " 条小记"}</span>
          </div>
          {rows.length === 0 ? (
            <div className="mb-empty">该标签下暂无内容</div>
          ) : (
            <>
              <div className="qn-tag-sheet__section"><FileText size={14} /><span>文档（{docs.length}）</span></div>
              {docs.map(renderRow)}
              <div className="qn-tag-sheet__section"><Feather size={14} /><span>小记（{quickRows.length}）</span></div>
              {quickRows.map(renderRow)}
            </>
          )}
        </div>
      ) : manage ? (
        <TagManageList tags={summaries} docCounts={counts.docs} onChanged={reloadAll} />
      ) : linksError ? (
        <div>
          <div className="mb-empty" role="alert">标签目录暂不可用：{linksError}</div>
          <div className="qn-tag-manager__actions">
            <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void loadLinks()}>重试</button>
          </div>
        </div>
      ) : (
        <div className="mb-set-items">
          {tags.length === 0 ? (
            <div className="mb-empty">还没有标签。新建一个标签，或在文档 / 小记里添加标签。</div>
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
          {loadingLinks && tags.length > 0 && <div className="qn-tag-manager__hint">读取标签计数…</div>}
        </div>
      )}

      <MobileSheet
        open={createOpen}
        title="新建标签"
        onClose={() => { if (!creating) setCreateOpen(false); }}
        className="qn-tag-sheet"
        bodyClassName="qn-tag-sheet__body mb-sheet__body--form"
        footer={<div className="mb-sheet__foot">
          <button type="button" className="mb-btn mb-btn--secondary" disabled={creating} onClick={() => setCreateOpen(false)}>取消</button>
          <button type="button" className="mb-btn mb-btn--primary" disabled={creating || !createName.trim()} onClick={() => void submitCreate()}>新建</button>
        </div>}
      >
        <span className="mb-input qn-tag-sheet__input">
          <input
            value={createName}
            autoFocus
            aria-label="新标签名称"
            placeholder="输入标签名称"
            onChange={(event) => { setCreateName(event.target.value); setCreateError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitCreate(); } }}
          />
        </span>
        {createError && <div className="qn-tag-sheet__error" role="alert">{createError}</div>}
      </MobileSheet>
    </div>
  );
}
