/**
 * 一级「标签」页（261106 用户验收；与小记/知识库并列，flomo 式：标签即入口）。
 *
 * 版面（261106 打磨）：与「小记」页**同一套页面骨架**——
 *   .mobile-scroll（纵向滚动）+ .mobile-quick-cards（页面内距 12/16 + 组间距 12）
 *   + .mb-set-title / .mb-set-section 卡片 + .mb-set-item 行（min-height 48、行间发丝、页内距 16）；
 *   按钮 .mb-btn / .mb-iconbtn（44 命中）、空态 .mb-empty。**不新增自造类、不新增 CSS。**
 *
 * 列表：标签名 + 「N 篇文档、M 条小记」（设备本地顺序，不重排）+ chevron；
 *   头部卡右上「管理」（进管理态）/「＋」（新建标签，弹 MobileSheet 输入）。
 * 详情：文档 / 小记两段（各自 updatedAt 倒序）；行点击打开；行尾 **× 图标**（44 命中）移除该条关联，
 *   点击先二次确认（只删关联，不动标签本身与其它内容），确认后才调 setNoteTags / setQuickNoteTags。
 *
 * 计数/聚合复用 tags/tagAggregate 的纯函数（不复制第二套）；删除/合并/移除文案在 tagManageCopy。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Feather, FileText, Plus, Settings2, Tag, X } from "lucide-react";
import type { QuickNoteTag } from "../../core/quickNoteTags";
import { buildQuickNoteTagIndex, buildQuickNoteTagOptions } from "../../core/quickNoteTags";
import { formatListTime } from "../../core/dateFormat";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { LocalNoteSummary } from "../data/noteRepository";
import type { MobileQuickNote } from "../home/HomePage";
import { bridge } from "../bridge";
import { confirmMobile } from "../ui/ConfirmDialog";
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

/** 行内计数文案（列表 / 详情 / 管理态同一口径）。 */
const countText = (docs: number, quickNotes: number): string => docs + " 篇文档、" + quickNotes + " 条小记";

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

  /** 行尾 ×：**先二次确认**（只删这条关联，标签本身与其它内容不受影响），确认后才落库。 */
  const removeRow = async (row: TagAggregateRow): Promise<void> => {
    if (!selectedTag || busy) return;
    const ok = await confirmMobile({
      title: "移除标签「" + selectedTag.name + "」？",
      body: "仅从这条内容上移除该标签；标签本身、以及其它内容的关联不受影响。",
      confirmText: "移除",
    });
    if (!ok) return;
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

  /** 聚合行：整行可点（main role=button）+ 行尾 ×（IconButton 44；stopPropagation 只走移除流程）。 */
  const renderRow = (row: TagAggregateRow) => (
    <div key={row.kind + row.id} className="mb-set-item">
      <div
        className="mb-set-item__main"
        role="button"
        tabIndex={0}
        onClick={() => openRow(row)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRow(row); } }}
      >
        <div className="mb-set-name">{row.title}</div>
        <div className="mb-set-item__desc">{row.kind === "doc" ? "文档" : "小记"}　{fmtTime(row.updatedAt)}</div>
      </div>
      <div className="mb-set-item__ctl">
        <button
          type="button"
          className="mb-iconbtn"
          disabled={busy}
          aria-label={"移除标签「" + row.title + "」"}
          onClick={(event) => { event.stopPropagation(); void removeRow(row); }}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="mobile-scroll">
      <div className="mobile-quick-cards">
        {/* 页头：标题 + 计数 + 「管理」「＋」（mb-set 行规范：命中 44、aria 齐） */}
        <div className="mb-set-section">
          <div className="mb-set-item">
            <div className="mb-set-item__main">
              <div className="mb-set-name">标签</div>
              <div className="mb-set-item__desc">{tags.length} 个标签，顺序只在本机生效</div>
            </div>
            <div className="mb-set-item__ctl">
              <button
                type="button"
                className="mb-btn mb-btn--secondary"
                aria-pressed={manage}
                aria-label={manage ? "完成标签管理" : "管理标签"}
                onClick={() => { setManage(!manage); setSelectedTagId(null); }}
              >
                <Settings2 size={16} />{manage ? "完成" : "管理"}
              </button>
              <button type="button" className="mb-iconbtn" aria-label="新建标签" onClick={() => { setCreateError(null); setCreateOpen(true); }}>
                <Plus size={20} />
              </button>
            </div>
          </div>
        </div>

        {selectedTag ? (
          <>
            <div className="mb-set-section">
              <div className="mb-set-item">
                <div className="mb-set-item__ctl">
                  <button type="button" className="mb-iconbtn" aria-label="返回标签列表" onClick={() => setSelectedTagId(null)}>
                    <ChevronLeft size={20} />
                  </button>
                </div>
                <div className="mb-set-item__main">
                  <div className="mb-set-name">{selectedTag.name}</div>
                  <div className="mb-set-item__desc">
                    {countText(counts.docs[selectedTag.id] ?? 0, counts.quickNotes[selectedTag.id] ?? 0)}
                  </div>
                </div>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="mb-empty">该标签下暂无内容</div>
            ) : (
              <>
                <h4 className="mb-set-title"><FileText size={14} />文档（{docs.length}）</h4>
                <div className="mb-set-section">{docs.map(renderRow)}</div>
                <h4 className="mb-set-title"><Feather size={14} />小记（{quickRows.length}）</h4>
                <div className="mb-set-section">{quickRows.map(renderRow)}</div>
              </>
            )}
          </>
        ) : manage ? (
          <TagManageList tags={summaries} docCounts={counts.docs} onChanged={reloadAll} />
        ) : linksError ? (
          <div className="mb-set-section">
            <div className="mb-set-item">
              <div className="mb-set-item__main">
                <div className="mb-set-name">标签目录暂不可用</div>
                <div className="mb-set-item__desc">{linksError}</div>
              </div>
              <div className="mb-set-item__ctl">
                <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void loadLinks()}>重试</button>
              </div>
            </div>
          </div>
        ) : tags.length === 0 ? (
          <div className="mb-empty">还没有标签。新建一个标签，或在文档 / 小记里添加标签。</div>
        ) : (
          <>
            <div className="mb-set-section">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="mb-set-item"
                  role="button"
                  tabIndex={0}
                  aria-label={tag.name}
                  onClick={() => setSelectedTagId(tag.id)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedTagId(tag.id); } }}
                >
                  <Tag size={18} className="mb-row__icon" />
                  <div className="mb-set-item__main">
                    <div className="mb-set-name">{tag.name}</div>
                    <div className="mb-set-item__desc">{countText(counts.docs[tag.id] ?? 0, counts.quickNotes[tag.id] ?? 0)}</div>
                  </div>
                  <div className="mb-set-item__ctl">
                    <ChevronRight size={18} className="mb-row__chevron" />
                  </div>
                </div>
              ))}
            </div>
            {loadingLinks && <div className="mb-set-item__desc">读取标签计数…</div>}
          </>
        )}
      </div>

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
