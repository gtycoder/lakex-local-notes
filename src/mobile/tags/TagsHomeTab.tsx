/**
 * 一级「标签」页（261106 用户验收；flomo 式：标签即入口 → 点进去看内容 → 编辑动作收在次级入口）。
 *
 * 261106 三次返工后的定稿交互（**没有「管理」模式**，列表永远可交互）：
 *  · 页头：标题 + 计数 + 「＋新建」（.mb-iconbtn，aria「新建标签」，命中 44）；不再有「管理 / 完成」切换。
 *  · 每行右侧固定「⋯」（.mb-iconbtn + MoreVertical，aria「标签操作 <名称>」，命中 44）→ 弹出既有 MobileSheetMenu：
 *    重命名（弹输入、预填 + 全选）/ 合并到…（选目标，提示与桌面同句）/ 删除（二次确认，与桌面逐字一致）。
 *  · 行主区点击 = 进详情；「⋯」stopPropagation 不触发详情。
 *  · 长按 350ms 进入拖拽排序（复用既有 qn-tag-manager 拖拽态与判据）→ 松手 reorderQuickNoteTags（设备本地顺序）；
 *    拖拽过的那一次 click 被吞掉，不会误进详情。
 *  · 详情：文档 / 小记两段（各自 updatedAt 倒序）；行点击打开；行尾 ×（44 命中）→ 二次确认（只删该条关联）。
 *
 * 版面：mobile-scroll + mobile-quick-cards（与「小记」页同一内距容器）+ mb-set-section/mb-set-item/mb-set-title/
 * mb-set-block/mb-btn/mb-iconbtn/mb-empty。**零新增 CSS。** 计数/聚合复用 tags/tagAggregate；文案复用 tagManageCopy。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Feather, FileText, GripVertical, Merge, MoreVertical, Pencil, Plus, Trash, X } from "lucide-react";
import type { QuickNoteTag } from "../../core/quickNoteTags";
import { buildQuickNoteTagIndex, buildQuickNoteTagOptions, moveQuickNoteTagOrder, normalizeQuickNoteTag, type QuickNoteTagSummary } from "../../core/quickNoteTags";
import { formatListTime } from "../../core/dateFormat";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { LocalNoteSummary } from "../data/noteRepository";
import type { MobileQuickNote } from "../home/HomePage";
import { bridge } from "../bridge";
import { confirmMobile } from "../ui/ConfirmDialog";
import { MobileSheet } from "../ui/MobileSheet";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { pushBackHandler } from "../ui/backStack";
import { TagQuickNotePreview } from "./TagQuickNotePreview";
import { useLongPress } from "../ui/useLongPress";
import { showToast } from "../ui/toastBus";
import { aggregateTagRows, tagCounts, type NoteTagLinks, type TagAggregateRow } from "./tagAggregate";
import { createTagFromName } from "./tagCreate";
import { MERGE_TAG_HINT, deleteTagConfirmBody } from "./tagManageCopy";

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

interface DragState { id: string; overId: string | null; after: boolean }

const fmtTime = (iso: string): string => {
  try { return formatListTime(new Date(iso), new Date()); } catch { return iso; }
};

/** 行内计数文案（列表 / 详情同一口径）。 */
const countText = (docs: number, quickNotes: number): string => docs + " 篇文档、" + quickNotes + " 条小记";

export function TagsHomeTab({ tags, notes, quickNotes, active, onOpenNote, onOpenQuickNote, onChanged }: TagsHomeTabProps) {
  const [links, setLinks] = useState<NoteTagLinks | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 页头「＋新建」
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 行 ⋯ 菜单 / 重命名 / 合并
  const [menuFor, setMenuFor] = useState<QuickNoteTag | null>(null);
  const [renaming, setRenaming] = useState<QuickNoteTag | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<QuickNoteTag | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  // 长按拖拽排序
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const pressedId = useRef<string | null>(null);
  const startPoint = useRef<{ clientX: number; clientY: number } | null>(null);
  /** 长按/拖拽过的那一次 click 要吞掉（否则松手会顺带进详情）。 */
  const suppressClick = useRef(false);

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

  // 详情页的返回键：先回标签列表（返回 true 消费；不要落到「两次返回退出」那条兜底）。
  useEffect(() => {
    if (!selectedTagId) return;
    return pushBackHandler(() => { setSelectedTagId(null); return true; });
  }, [selectedTagId]);

  /** 任一写操作完成后：关系可能变了 ⇒ 关系 + App 快照一起刷。 */
  const reloadAll = useCallback(async (): Promise<void> => { await loadLinks(); await onChanged(); }, [loadLinks, onChanged]);

  const countOf = useCallback((tag: QuickNoteTagSummary | QuickNoteTag): string => (
    countText(counts.docs[tag.id] ?? 0, "count" in tag ? tag.count : (counts.quickNotes[tag.id] ?? 0))
  ), [counts]);

  const openRow = (row: TagAggregateRow): void => {
    if (row.kind === "doc") onOpenNote(row.id);
    else onOpenQuickNote(row.id);
  };

  // ── 行 ⋯ 菜单 ────────────────────────────────────────────────────────────────
  const menuItems: MobileSheetItem[] = [
    { id: "rename", label: "重命名", icon: Pencil },
    { id: "merge", label: "合并到…", icon: Merge, disabled: tags.length < 2 },
    { id: "delete", label: "删除", icon: Trash, danger: true },
  ];

  const onMenuSelect = (item: MobileSheetItem): void => {
    const tag = menuFor;
    setMenuFor(null);
    if (!tag) return;
    if (item.id === "rename") startRename(tag);
    else if (item.id === "merge") setMergeSource(tag);
    else if (item.id === "delete") void removeTag(tag);
  };

  // ── 重命名（弹输入，预填 + 全选）──────────────────────────────────────────────
  const startRename = (tag: QuickNoteTag): void => {
    setRenameError(null);
    setRenameValue(tag.name);
    setRenaming(tag);
  };

  // 打开后全选当前名称（用户要求「重命名弹输入并全选」）。
  useEffect(() => {
    if (!renaming) return;
    const input = renameInputRef.current;
    if (input) { input.focus(); input.select(); }
  }, [renaming]);

  const submitRename = async (): Promise<void> => {
    const tag = renaming;
    if (!tag || busy) return;
    const name = renameValue.trim();
    if (!name) { setRenameError("标签名不能为空"); return; }
    if (name === tag.name) { setRenaming(null); return; }
    let normalized = "";
    try { normalized = normalizeQuickNoteTag(name); } catch (error) {
      setRenameError(getNativeErrorMessage(error));
      return;
    }
    if (tags.some((item) => item.name === normalized && item.id !== tag.id)) { setRenameError("已有同名标签"); return; }
    setBusy(true);
    setRenameError(null);
    try {
      await bridge.updateQuickNoteTag(tag.id, { name: normalized });
      setRenaming(null);
      await reloadAll();
      showToast("已重命名标签");
    } catch (error) {
      const message = getNativeErrorMessage(error);
      setRenameError(message);
      showToast("重命名失败：" + message, { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ── 合并到…（选目标 → 二次确认 → mergeQuickNoteTags）─────────────────────────
  const mergeTargets = useMemo(() => tags.filter((tag) => tag.id !== mergeSource?.id), [tags, mergeSource]);
  const submitMerge = async (target: QuickNoteTag): Promise<void> => {
    const source = mergeSource;
    if (!source || busy) return;
    const ok = await confirmMobile({
      title: "把「" + source.name + "」合并到「" + target.name + "」？",
      body: MERGE_TAG_HINT,
      confirmText: "合并",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await bridge.mergeQuickNoteTags(source.id, target.id);
      setMergeSource(null);
      await reloadAll();
      showToast("已合并标签");
    } catch (error) {
      showToast("合并失败：" + getNativeErrorMessage(error), { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ── 删除（二次确认与桌面逐字一致）────────────────────────────────────────────
  const removeTag = async (tag: QuickNoteTag): Promise<void> => {
    if (busy) return;
    const ok = await confirmMobile({
      title: "删除标签「" + tag.name + "」？",
      body: deleteTagConfirmBody(counts.docs[tag.id] ?? 0, counts.quickNotes[tag.id] ?? 0),
      confirmText: "删除标签",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await bridge.deleteQuickNoteTag(tag.id);
      if (selectedTagId === tag.id) setSelectedTagId(null);
      await reloadAll();
      showToast("已删除标签");
    } catch (error) {
      showToast("删除失败：" + getNativeErrorMessage(error), { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  // ── 长按 350ms 拖拽排序（复用既有 qn-tag-manager 拖拽态/判据）───────────────────
  const order = useMemo(() => tags.map((tag) => tag.id), [tags]);
  const longPress = useLongPress((touch) => {
    const id = pressedId.current;
    if (!id) return;
    suppressClick.current = true;     // 长按过 ⇒ 松手后的 click 不进详情
    setDrag({ id, overId: null, after: false });
    startPoint.current = touch;
  }, { moveCancelPx: 0 });

  useEffect(() => {
    if (!drag) return;
    const compute = (clientY: number): { overId: string | null; after: boolean } => {
      const hit = document.elementFromPoint(startPoint.current?.clientX ?? 0, clientY) as HTMLElement | null;
      const row = hit?.closest("[data-tag-id]") as HTMLElement | null;
      const overId = row?.getAttribute("data-tag-id") ?? null;
      if (!overId || overId === dragRef.current?.id) return { overId: null, after: false };
      const rect = row!.getBoundingClientRect();
      return { overId, after: clientY > rect.top + rect.height / 2 };
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      const next = compute(touch.clientY);
      const current = dragRef.current;
      if (!current) return;
      if (current.overId === next.overId && current.after === next.after) return;
      setDrag({ ...current, ...next });
    };
    const finish = () => {
      const current = dragRef.current;
      setDrag(null);
      startPoint.current = null;
      if (!current?.overId) return;
      const nextOrder = moveQuickNoteTagOrder(order, current.id, current.overId, current.after ? "after" : "before");
      if (nextOrder.join("\u0000") === order.join("\u0000")) return;
      setBusy(true);
      void bridge.reorderQuickNoteTags(nextOrder)
        .then(reloadAll)
        .catch((error: unknown) => showToast("排序失败：" + getNativeErrorMessage(error), { type: "error" }))
        .finally(() => setBusy(false));
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
  }, [drag !== null, order, reloadAll]);

  // ── 详情行 × ：先二次确认（只删该条关联），确认后才落库 ───────────────────────
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

  const openDetail = (tag: QuickNoteTag): void => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setSelectedTagId(tag.id);
  };

  /** 文档行：标题 + 时间；× 在行右侧中轴（IconButton 44；stopPropagation 只走移除）。 */
  const renderDocRow = (row: TagAggregateRow) => (
    <div key={"doc-" + row.id} className="mb-set-item">
      <div
        className="mb-set-item__main"
        role="button"
        tabIndex={0}
        onClick={() => openRow(row)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRow(row); } }}
      >
        <div className="mb-set-name">{row.title}</div>
        <div className="mb-set-item__desc">文档　{fmtTime(row.updatedAt)}</div>
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

  /**
   * 小记行（261106）：富预览（与首页卡片同一个 QuickNotePreview，正文按需 readQuickNote），
   * × 与文档行同一套——放在右侧中轴（不再在卡片底部单独一行）。预览内勾选框只读、不切换。
   */
  const renderQuickRow = (row: TagAggregateRow) => (
    <div key={"quick-" + row.id} className="mb-set-item">
      <div
        className="mb-set-item__main"
        role="button"
        tabIndex={0}
        aria-label={"打开小记 " + row.title}
        onClick={() => onOpenQuickNote(row.id)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenQuickNote(row.id); } }}
      >
        <TagQuickNotePreview noteId={row.id} fallbackText={row.title} />
        <div className="mb-set-item__desc">小记　{fmtTime(row.updatedAt)}</div>
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
        {/* 页头：标题 + 计数 + 「＋新建」（没有「管理」模式；行内 ⋯ 直接给动作） */}
        <div className="mb-set-section">
          <div className="mb-set-item">
            <div className="mb-set-item__main">
              <div className="mb-set-name">标签</div>
              <div className="mb-set-item__desc">{tags.length} 个标签，长按可拖动排序（只在本机生效）</div>
            </div>
            <div className="mb-set-item__ctl">
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
                <div className="mb-set-section">{docs.map(renderDocRow)}</div>
                <h4 className="mb-set-title"><Feather size={14} />小记（{quickRows.length}）</h4>
                <div className="mb-set-section">{quickRows.map(renderQuickRow)}</div>
              </>
            )}
          </>
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
          <div className="mb-set-section">
            {summaries.map((tag) => (
              <div
                key={tag.id}
                className={"mb-set-item qn-tag-manager__row"
                  + (drag?.id === tag.id ? " is-dragging" : "")
                  + (drag?.overId === tag.id && !drag.after ? " is-drop-before" : "")
                  + (drag?.overId === tag.id && drag.after ? " is-drop-after" : "")}
                data-tag-id={tag.id}
                // 整行点击都进详情（点在手柄/内距上也一样）；拖拽过的那次 click 由 suppressClick 吞掉。
                onClick={() => openDetail(tag)}
                onTouchStart={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return;
                  pressedId.current = tag.id;
                  longPress.onTouchStart(event);
                }}
                onTouchMove={longPress.onTouchMove}
                onTouchEnd={longPress.onTouchEnd}
                onTouchCancel={longPress.onTouchCancel}
              >
                <span className="mb-row__icon" aria-hidden="true"><GripVertical size={16} /></span>
                <div
                  className="mb-set-item__main"
                  role="button"
                  tabIndex={0}
                  aria-label={tag.name}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(tag); } }}
                >
                  <div className="mb-set-name">{tag.name}</div>
                  <div className="mb-set-item__desc">{countOf(tag)}</div>
                </div>
                <div className="mb-set-item__ctl">
                  <button
                    type="button"
                    className="mb-iconbtn"
                    aria-label={"标签操作 " + tag.name}
                    onClick={(event) => { event.stopPropagation(); setMenuFor(tag); }}
                  >
                    <MoreVertical size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!selectedTag && loadingLinks && tags.length > 0 && (
          <div className="mb-set-item__desc">读取标签计数…</div>
        )}
      </div>

      {/* 行 ⋯ 菜单（既有 .mb-menusheet 原语） */}
      <MobileSheetMenu
        open={menuFor !== null}
        items={menuItems}
        onClose={() => setMenuFor(null)}
        onSelect={onMenuSelect}
      />

      {/* ＋新建 */}
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

      {/* 重命名：弹输入、预填 + 全选 */}
      <MobileSheet
        open={renaming !== null}
        title="重命名标签"
        onClose={() => { if (!busy) setRenaming(null); }}
        className="qn-tag-sheet"
        bodyClassName="qn-tag-sheet__body mb-sheet__body--form"
        footer={<div className="mb-sheet__foot">
          <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={() => setRenaming(null)}>取消</button>
          <button type="button" className="mb-btn mb-btn--primary" disabled={busy || !renameValue.trim()} onClick={() => void submitRename()}>保存</button>
        </div>}
      >
        <span className="mb-input qn-tag-sheet__input">
          <input
            ref={renameInputRef}
            value={renameValue}
            aria-label="标签名"
            onChange={(event) => { setRenameValue(event.target.value); setRenameError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitRename(); } }}
          />
        </span>
        {renameError && <div className="qn-tag-sheet__error" role="alert">{renameError}</div>}
      </MobileSheet>

      {/* 合并到…：选目标标签（排除自身），提示与桌面同句 */}
      <MobileSheet
        open={mergeSource !== null}
        title="合并标签"
        onClose={() => { if (!busy) setMergeSource(null); }}
        className="qn-tag-sheet"
        bodyClassName="qn-tag-sheet__body mb-sheet__body--form"
        footer={<div className="mb-sheet__foot">
          <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={() => setMergeSource(null)}>取消</button>
        </div>}
      >
        <div className="qn-tag-sheet__section"><Merge size={14} /><span>把「{mergeSource?.name ?? ""}」合并到：</span></div>
        <div className="mb-set-item__desc">{MERGE_TAG_HINT}</div>
        <div className="mb-set-section">
          {mergeTargets.map((tag) => (
            <div
              key={tag.id}
              className="mb-set-item"
              role="button"
              tabIndex={0}
              aria-label={"合并到 " + tag.name}
              onClick={() => void submitMerge(tag)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void submitMerge(tag); } }}
            >
              <div className="mb-set-item__main">
                <div className="mb-set-name">{tag.name}</div>
                <div className="mb-set-item__note">{countText(counts.docs[tag.id] ?? 0, counts.quickNotes[tag.id] ?? 0)}</div>
              </div>
              <div className="mb-set-item__ctl"><ChevronRight size={18} className="mb-row__chevron" /></div>
            </div>
          ))}
        </div>
        {mergeTargets.length === 0 && <div className="mb-empty">没有其他标签可合并</div>}
      </MobileSheet>
    </div>
  );
}
