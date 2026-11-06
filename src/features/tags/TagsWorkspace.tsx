import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, FileText, GripVertical, MoreVertical, Merge, Pencil, Plus, RefreshCw, StickyNote, Tag as TagIcon, Trash, X } from "lucide-react";
import { Dialog, Menu } from "../../components/ui/Overlay";
import { InlineRenameInput } from "../../components/ui/InlineRenameInput";
import { NamePromptDialog } from "../../components/app/NamePromptDialog";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { SplitHandle } from "../../components/ui/SplitHandle";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import {
  TAG_DIR_DEFAULT,
  TAG_DIR_MAX,
  TAG_DIR_MIN,
  TAG_LAYOUT_DEFAULTS,
  TAG_LAYOUT_STORAGE_KEY,
  TAG_PREVIEW_DEFAULT,
  TAG_PREVIEW_MAX,
  TAG_PREVIEW_MIN,
  clampTagDirWidth,
  clampTagPreviewWidth,
  parseStoredTagLayout,
  resolveTagColumns,
  serializeTagLayout,
  type TagSpaceWidths,
} from "./tagsLayout";
import { useConfirm } from "../../hooks/useConfirm";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { NoteSummary, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";
import {
  buildTagAggregate,
  buildTagDirectory,
  moveTagOrder,
  type DocumentTagLinks,
  type TagAggregateItem,
  type TagAggregateKindFilter,
  type TagDirectoryEntry,
} from "./tagsModel";
import "./tags.css";

/** 只读预览正文（内核）必须懒加载：它静态引用 Lake 运行时（P12 桌面内核边界）。 */
const TagPreviewBody = lazy(() => import("./TagPreviewBody"));

export interface TagsWorkspaceProps {
  /** 空间是否可见（keep-alive：不可见时不加载预览/不打接口）。 */
  active: boolean;
  /** 标签目录（quick-notes 库 tags，active only，保持本机目录顺序）。 */
  tags: readonly QuickNoteTag[];
  /** 文档 → 标签 id（主库关系表）。 */
  documentLinks: DocumentTagLinks;
  notes: readonly NoteSummary[];
  quickNotes: readonly QuickNoteListSummary[];
  /** 文档标签数据层是否可用（老版本/浏览器端 ⇒ 显示可读提示）。 */
  available: boolean;
  /** 目录读取失败的可读提示（小记库降级时）。 */
  dataError?: string | null;
  onReload(): void | Promise<void>;
  /** 新建标签（目录唯一来源 = quick-notes 标签库；App → native.createQuickNoteTag），返回新标签 id。 */
  onCreateTag(name: string): Promise<string>;
  onRenameTag(id: string, name: string): Promise<void>;
  onMergeTag(sourceId: string, targetId: string): Promise<void>;
  onDeleteTag(id: string): Promise<void>;
  onReorderTags(orderedIds: string[]): Promise<void>;
  onOpenDocument(noteId: string): void;
  onOpenQuickNote(quickNoteId: string): void;
  /** 读正文（只读预览用）：文档 = readNote；小记 = readQuickNote。失败返回 null。 */
  onLoadPreview(item: TagAggregateItem): Promise<string | null>;
  /** 取消某条内容上的当前标签（可逆、无二次确认）：文档 setNoteTags / 小记 setQuickNoteTags。 */
  onRemoveTagFromItem(item: TagAggregateItem, tagId: string): Promise<void>;
  onError(message: string): void;
}

const KIND_TABS: Array<{ id: TagAggregateKindFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "doc", label: "仅文档" },
  { id: "quickNote", label: "仅小记" },
];

function formatUpdated(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/**
 * 标签空间（P1 一级入口「标签」）：**只读聚合视图 + 就地元数据管理**，不是第三个数据空间。
 *
 * 三栏：① 标签目录（名称 / 文档数 / 小记数 / 更新时间；就地改名、合并、删除、拖拽排序）
 *      ② 选中标签的汇总列表（文档分组 + 小记分组，更新时间倒序，可切只看文档/只看小记）
 *      ③ 只读预览（文档 = 内核只读；小记 = 既有快路径 + 内核兜底）+ 「在文档/小记中打开」。
 *
 * 组件只吃 props（数据/回调由 App 注入）⇒ 可单测、不直接摸 native。
 */
export function TagsWorkspace(props: TagsWorkspaceProps) {
  const { active, tags, documentLinks, notes, quickNotes, available, dataError = null, onReload, onCreateTag, onRenameTag, onMergeTag, onDeleteTag, onReorderTags, onOpenDocument, onOpenQuickNote, onLoadPreview, onRemoveTagFromItem, onError } = props;
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<TagAggregateKindFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [mergeSource, setMergeSource] = useState<TagDirectoryEntry | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** 新建标签：弹窗（261105 用户验收；行内重命名仍用 InlineRenameInput）。 */
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** 行操作 ⋯ 菜单（固定可见入口；重命名 / 合并到… / 删除）。 */
  const [rowMenu, setRowMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  /** 三栏可拖：宽度设备本地持久化（左 200–480 / 右 240–720，中栏自适应最小 360）。 */
  const colsRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<TagSpaceWidths>(() => {
    try {
      const stored = parseStoredTagLayout(typeof window === "undefined" ? null : window.localStorage.getItem(TAG_LAYOUT_STORAGE_KEY));
      return stored ?? TAG_LAYOUT_DEFAULTS;
    } catch {
      return TAG_LAYOUT_DEFAULTS;
    }
  });
  // 容器宽度：首帧用窗口宽兜底（未测量前也能渲染 split；jsdom/无 RO 环境同样有值）。
  const [containerWidth, setContainerWidth] = useState<number>(() => (typeof window === "undefined" ? 1200 : window.innerWidth));
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [previewItem, setPreviewItem] = useState<TagAggregateItem | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** 正在「移除该标签」的条目 key（禁点 + 显示进行中）。 */
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const { confirm, confirmElement } = useConfirm();

  const directory = useMemo(() => buildTagDirectory({ tags, documentLinks, quickNotes }), [tags, documentLinks, quickNotes]);
  const selected = directory.find((entry) => entry.id === selectedTagId) ?? null;
  const aggregate = useMemo(
    () => buildTagAggregate({ tagId: selectedTagId, documentLinks, notes, quickNotes, filter: kindFilter }),
    [selectedTagId, documentLinks, notes, quickNotes, kindFilter],
  );
  /** 行操作 ⋯ 菜单的目标行 + 锚点定位（测量式，不自夹）。 */
  const rowMenuEntry = rowMenu ? directory.find((entry) => entry.id === rowMenu.id) ?? null : null;
  const rowMenuPos = usePopoverPosition({ open: rowMenuEntry !== null, anchor: rowMenu?.anchor, gap: 4, margin: 6 });

  /** 三栏栅格：够宽 = 左右固定 px + 中栏 minmax(360px,1fr)；过窄 = CSS 固定比例（handle 隐藏）。 */
  const columns = resolveTagColumns(containerWidth, widths);
  const commitWidths = useCallback((next: TagSpaceWidths) => {
    setWidths(next);
    writeLocalStorage(TAG_LAYOUT_STORAGE_KEY, serializeTagLayout(next));
  }, []);
  useEffect(() => {
    const element = colsRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const width = element.getBoundingClientRect().width;
      setContainerWidth(width > 0 ? width : window.innerWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  /** 选中标签后的中栏摘要：「N 篇文档、M 条小记 + 更新于 …」（左栏行不再展示条数/时间）。 */
  const latestUpdatedAt = useMemo(() => {
    const times = [...aggregate.docs, ...aggregate.quickNotes].map((item) => item.updatedAt).filter((value) => !!value).sort();
    return times.length > 0 ? times[times.length - 1] : (selected?.updatedAt ?? "");
  }, [aggregate, selected]);

  // 目录变化后（删除/合并/远端同步）选中项失效 ⇒ 回到"未选中"而不是显示空标签。
  useEffect(() => {
    if (selectedTagId && !directory.some((entry) => entry.id === selectedTagId)) {
      setSelectedTagId(null);
      setPreviewItem(null);
      setPreviewBody(null);
    }
  }, [directory, selectedTagId]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError(getNativeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [onError]);

  const reload = useCallback(async () => {
    setReloading(true);
    try { await onReload(); } catch (error) { onError(getNativeErrorMessage(error)); } finally { setReloading(false); }
  }, [onReload, onError]);

  /** 新建标签（弹窗提交）：创建（目录唯一来源）→ reload → 自动选中新标签；失败在弹窗内显示且不关闭。 */
  const createTag = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setCreateError(null);
    try {
      const id = await onCreateTag(trimmed);
      setCreating(false);
      await onReload();
      if (id) setSelectedTagId(id);
    } catch (error) {
      setCreateError(getNativeErrorMessage(error));
      onError(getNativeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [onCreateTag, onReload, onError]);

  const startCreating = useCallback(() => {
    setRowMenu(null);
    setCreateError(null);
    setCreating(true);
  }, []);

  const saveRename = useCallback(async (entry: TagDirectoryEntry) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name || name === entry.name) return;
    await run(async () => { await onRenameTag(entry.id, name); await onReload(); });
  }, [editName, run, onRenameTag, onReload]);

  const removeTag = useCallback(async (entry: TagDirectoryEntry) => {
    const ok = await confirm({
      title: "删除标签「" + entry.name + "」？",
      body: "会同时移除文档与小记上的该标签（引用 " + entry.docCount + " 篇文档、" + entry.quickNoteCount + " 条小记）；文档与小记本身不会被删除。",
      confirmText: "删除标签",
      danger: true,
    });
    if (!ok) return;
    await run(async () => { await onDeleteTag(entry.id); if (selectedTagId === entry.id) setSelectedTagId(null); await onReload(); });
  }, [confirm, run, onDeleteTag, onReload, selectedTagId]);

  const mergeInto = useCallback(async (target: TagDirectoryEntry) => {
    if (!mergeSource || mergeSource.id === target.id) { setMergeSource(null); return; }
    await run(async () => { await onMergeTag(mergeSource.id, target.id); setMergeSource(null); if (selectedTagId === mergeSource.id) setSelectedTagId(target.id); await onReload(); });
  }, [mergeSource, run, onMergeTag, onReload, selectedTagId]);

  const drop = useCallback(async (targetId: string) => {
    const source = dragId;
    setDragId(null);
    if (!source || source === targetId) return;
    const ids = directory.map((entry) => entry.id);
    const next = moveTagOrder(ids, source, targetId, "before");
    if (next.join("\u0000") === ids.join("\u0000")) return;
    await run(async () => { await onReorderTags(next); await onReload(); });
  }, [dragId, directory, run, onReorderTags, onReload]);

  const openPreview = useCallback(async (item: TagAggregateItem) => {
    setPreviewItem(item);
    setPreviewBody(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const body = await onLoadPreview(item);
      setPreviewBody(body);
      if (body === null) setPreviewError("正文读取失败或已丢失（可回原空间打开）。");
    } catch (error) {
      setPreviewError(getNativeErrorMessage(error));
    } finally {
      setPreviewLoading(false);
    }
  }, [onLoadPreview]);

  const openInOrigin = () => {
    if (!previewItem) return;
    if (previewItem.kind === "doc") onOpenDocument(previewItem.id);
    else onOpenQuickNote(previewItem.id);
  };

  /** 「移除该标签」= 取消这一条与该标签的关系（可逆、无二次确认），成功后刷新目录/聚合。 */
  const removeTagFromItem = useCallback(async (item: TagAggregateItem) => {
    const tagId = selectedTagId;
    if (!tagId) return;
    const key = item.kind + ":" + item.id;
    setRemovingKey(key);
    try {
      await onRemoveTagFromItem(item, tagId);
      // 这一条可能已不在当前标签下 ⇒ 预览随之关闭，避免展示已移除的内容。
      if (previewItem && previewItem.kind === item.kind && previewItem.id === item.id) {
        setPreviewItem(null);
        setPreviewBody(null);
        setPreviewError(null);
      }
      await onReload();
    } catch (error) {
      onError(getNativeErrorMessage(error));
    } finally {
      setRemovingKey(null);
    }
  }, [selectedTagId, onRemoveTagFromItem, previewItem, onReload, onError]);

  const directoryEmpty = directory.length === 0;
  let aggregateBody: ReactNode;
  if (!available) {
    aggregateBody = <p className="tags-empty" role="status">标签数据暂不可用：请升级到支持文档标签的版本。</p>;
  } else if (dataError) {
    aggregateBody = <p className="tags-empty" role="status">{dataError}</p>;
  } else if (directoryEmpty) {
    aggregateBody = <p className="tags-empty" role="status">还没有标签。新建一个标签，或在文档属性/右键菜单里设置标签。</p>;
  } else if (!selected) {
    aggregateBody = <p className="tags-empty" role="status">从左侧选择一个标签，查看它下面的文档与小记。</p>;
  } else if (aggregate.total === 0) {
    aggregateBody = <p className="tags-empty" role="status">该标签下暂无内容。</p>;
  } else {
    aggregateBody = (
      <div className="tags-aggregate__groups">
        {aggregate.docs.length > 0 && (
          <section className="tags-aggregate__group" aria-label="文档">
            <h3 className="tags-aggregate__group-title"><FileText size={14} aria-hidden="true" />文档（{aggregate.docs.length}）</h3>
            <ul className="tags-aggregate__list">
              {aggregate.docs.map((item) => renderAggregateRow(item))}
            </ul>
          </section>
        )}
        {aggregate.quickNotes.length > 0 && (
          <section className="tags-aggregate__group" aria-label="小记">
            <h3 className="tags-aggregate__group-title"><StickyNote size={14} aria-hidden="true" />小记（{aggregate.quickNotes.length}）</h3>
            <ul className="tags-aggregate__list">
              {aggregate.quickNotes.map((item) => renderAggregateRow(item))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  function renderAggregateRow(item: TagAggregateItem) {
    const selectedRow = previewItem?.kind === item.kind && previewItem.id === item.id;
    return (
      <li key={item.kind + ":" + item.id}>
        <div className={"ln-row tags-aggregate__row" + (selectedRow ? " is-selected" : "")} title={item.title}>
          <button type="button" className="tags-aggregate__open" onClick={() => void openPreview(item)}>
            {item.kind === "doc" ? <FileText size={14} aria-hidden="true" /> : <StickyNote size={14} aria-hidden="true" />}
            <span className="ln-ellipsis tags-aggregate__row-title">{item.title}</span>
            <time className="tags-aggregate__row-time" dateTime={item.updatedAt}>{formatUpdated(item.updatedAt)}</time>
          </button>
          {/* 「移除该标签」= 可逆动作（不删标签、无二次确认）；行悬停/键盘聚焦可见 */}
          <button type="button" className="ln-iconbtn ln-iconbtn--compact tags-aggregate__remove"
            aria-label={"移除标签 " + (selected?.name ?? "")} title="移除该标签"
            disabled={removingKey === item.kind + ":" + item.id}
            onClick={() => void removeTagFromItem(item)}><X size={12} /></button>
        </div>
      </li>
    );
  }

  return (
    <section className="tags-space" aria-label="标签" data-tags-space={active ? "active" : "idle"}>
      <div className={"tags-space__cols" + (columns.mode === "fallback" ? " is-fallback" : "")} ref={colsRef}
        style={columns.templateColumns ? { gridTemplateColumns: columns.templateColumns } : undefined}>
        {/* 左栏 = 像文档目录栏：头部标题 + 计数 +「＋新建标签」「刷新」两个 icon 按钮 */}
        <div className="tags-dir-pane">
        <header className="tags-dir__head">
          <h1 className="tags-space__title"><TagIcon size={15} aria-hidden="true" />标签</h1>
          <span className="tags-space__count">{directory.length}</span>
          {available && (
            <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="新建标签" title="新建标签" disabled={busy}
              onClick={startCreating}><Plus size={14} /></button>
          )}
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="刷新标签" title="刷新标签" disabled={reloading}
            onClick={() => void reload()}><RefreshCw size={14} className={reloading ? "spin" : undefined} /></button>
        </header>
        <div className="tags-dir" role="listbox" aria-label="标签目录">
          {directoryEmpty
            ? (creating ? null : (
              <div className="tags-dir__empty">
                <p className="tags-empty tags-empty--inset" role="status">
                  {available ? "还没有标签。新建一个标签，或在文档属性/右键菜单里设置标签。" : "标签目录暂不可用。"}
                </p>
                {available && (
                  <button type="button" className="ln-btn ln-btn--secondary" aria-label="新建标签" disabled={busy} onClick={startCreating}>
                    <Plus size={13} aria-hidden="true" />新建标签
                  </button>
                )}
              </div>
            ))
            : directory.map((entry) => (
              <div key={entry.id} role="option" aria-selected={selectedTagId === entry.id}
                className={"ln-row tags-dir__row" + (selectedTagId === entry.id ? " is-selected" : "") + (dragId === entry.id ? " is-dragging" : "")}
                draggable={!busy && editingId !== entry.id}
                onDragStart={() => setDragId(entry.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void drop(entry.id)}>
                <span className="tags-dir__grip" aria-hidden="true"><GripVertical size={12} /></span>
                {editingId === entry.id ? (
                  <InlineRenameInput className="ln-input__field tags-dir__rename" value={editName} autoFocus
                    ariaLabel={"重命名标签 " + entry.name} emptyPolicy="reject"
                    onChange={setEditName} onCommit={() => void saveRename(entry)} onCancel={() => setEditingId(null)} />
                ) : (
                  // 用户验收：左行只留名称（条数与更新时间只在选中后于中栏摘要展示）
                  <button type="button" className="tags-dir__select" onClick={() => setSelectedTagId(entry.id)} title={entry.name}>
                    <span className="ln-ellipsis tags-dir__name">{entry.name}</span>
                  </button>
                )}
                {editingId === entry.id ? (
                  <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="保存名称" onClick={() => void saveRename(entry)}><Check size={13} /></button>
                ) : (
                  // 固定可见的行操作入口（不再只在 hover 出现；键盘可聚焦、aria-haspopup/expanded 齐全）
                  <button type="button" className={"ln-iconbtn ln-iconbtn--compact tags-dir__more" + (rowMenu?.id === entry.id ? " is-active" : "")}
                    aria-label={"标签操作 " + entry.name} title="标签操作" aria-haspopup="menu" aria-expanded={rowMenu?.id === entry.id}
                    disabled={busy}
                    onClick={(event) => {
                      const anchor = event.currentTarget;
                      setRowMenu((current) => current?.id === entry.id ? null : { id: entry.id, anchor });
                    }}><MoreVertical size={14} /></button>
                )}
              </div>
            ))}
        </div>
        </div>
        <SplitHandle
          ariaLabel="调整标签目录宽度"
          className="tags-split tags-split--dir"
          containerRef={colsRef}
          width={columns.dir}
          minWidth={TAG_DIR_MIN}
          maxWidth={TAG_DIR_MAX}
          softClamp={(next) => clampTagDirWidth(next, containerWidth, widths.preview)}
          onPreview={(next) => setWidths((current) => ({ ...current, dir: clampTagDirWidth(next, containerWidth, current.preview) }))}
          onCommit={(next) => commitWidths({ ...widths, dir: next ?? TAG_DIR_DEFAULT })}
        />
        <div className="tags-aggregate" aria-label="标签内容">
          <div className="ln-tabs tags-aggregate__tabs" role="tablist" aria-label="内容类型">
            {KIND_TABS.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={kindFilter === tab.id}
                className={"ln-tabs__item" + (kindFilter === tab.id ? " is-active" : "")}
                onClick={() => setKindFilter(tab.id)}>{tab.label}</button>
            ))}
          </div>
          {selected && (
            <p className="tags-aggregate__hint">
              <span className="tags-aggregate__hint-main">{aggregate.docs.length} 篇文档、{aggregate.quickNotes.length} 条小记</span>
              <span className="tags-aggregate__hint-meta">
                按更新时间倒序{latestUpdatedAt ? "，更新于 " + formatUpdated(latestUpdatedAt) : ""}
              </span>
            </p>
          )}
          {aggregateBody}
        </div>
        <SplitHandle
          ariaLabel="调整标签预览宽度"
          className="tags-split tags-split--preview"
          containerRef={colsRef}
          width={columns.preview}
          minWidth={TAG_PREVIEW_MIN}
          maxWidth={TAG_PREVIEW_MAX}
          invert
          softClamp={(next) => clampTagPreviewWidth(next, containerWidth, widths.dir)}
          onPreview={(next) => setWidths((current) => ({ ...current, preview: clampTagPreviewWidth(next, containerWidth, current.dir) }))}
          onCommit={(next) => commitWidths({ ...widths, preview: next ?? TAG_PREVIEW_DEFAULT })}
        />
        <div className="tags-preview" aria-label="只读预览">
          {!previewItem ? (
            <p className="tags-empty tags-empty--inset" role="status">选择一条内容查看只读预览。</p>
          ) : (
            <>
              <header className="tags-preview__head">
                <span className="tags-preview__kind">{previewItem.kind === "doc" ? "文档" : "小记"}</span>
                <strong className="ln-ellipsis tags-preview__title">{previewItem.title}</strong>
                <button type="button" className="ln-btn ln-btn--secondary" onClick={openInOrigin}>
                  {previewItem.kind === "doc" ? "在文档中打开" : "在小记中打开"}
                </button>
                {selectedTagId && (
                  <button type="button" className="ln-btn ln-btn--secondary" aria-label={"移除标签 " + (selected?.name ?? "")}
                    disabled={removingKey === previewItem.kind + ":" + previewItem.id}
                    onClick={() => void removeTagFromItem(previewItem)} title="移除该标签">移除标签</button>
                )}
                <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭预览" title="关闭预览"
                  onClick={() => { setPreviewItem(null); setPreviewBody(null); setPreviewError(null); }}><X size={13} /></button>
              </header>
              <div className="tags-preview__body">
                {previewLoading && <p className="tags-empty" role="status">正在读取正文…</p>}
                {!previewLoading && previewError && <p className="tags-empty" role="status">{previewError}</p>}
                {!previewLoading && !previewError && previewBody !== null && (
                  <Suspense fallback={<p className="tags-empty" role="status">正在加载只读预览…</p>}>
                    <TagPreviewBody kind={previewItem.kind} docKind={previewItem.docKind} body={previewBody} noteId={previewItem.id} />
                  </Suspense>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <NamePromptDialog
        open={creating}
        title="新建标签"
        inputLabel="新标签名称"
        placeholder="输入标签名称"
        busy={busy}
        error={createError}
        onSubmit={createTag}
        onClose={() => { if (!busy) setCreating(false); }}
      />
      {rowMenuEntry && (
        <Menu onDismiss={() => setRowMenu(null)} surfaceClassName="context-menu"
          surfaceRef={rowMenuPos.surfaceRef} style={rowMenuPos.style ?? { visibility: "hidden" }}>
          <button role="menuitem" className="ln-menu__item" onClick={() => {
            setRowMenu(null);
            setEditingId(rowMenuEntry.id);
            setEditName(rowMenuEntry.name);
          }}><Pencil size={14} aria-hidden="true" /><span>重命名</span></button>
          <button role="menuitem" className="ln-menu__item" disabled={directory.length <= 1} onClick={() => {
            setRowMenu(null);
            setMergeSource(rowMenuEntry);
          }}><Merge size={14} aria-hidden="true" /><span>合并到…</span></button>
          <div className="context-menu-sep" role="separator" />
          <button role="menuitem" className="ln-menu__item tags-dir__danger" onClick={() => {
            setRowMenu(null);
            void removeTag(rowMenuEntry);
          }}><Trash size={14} aria-hidden="true" /><span>删除</span></button>
        </Menu>
      )}
      {mergeSource && (
        <Dialog open onDismiss={() => setMergeSource(null)} label="合并标签" className="tags-merge-dialog">
          <div className="ln-dialog__body">
            <h3>把「{mergeSource.name}」合并到…</h3>
            <p className="tags-merge-dialog__hint">合并后源标签消失；文档与小记会保留，引用改到目标标签。</p>
            <div className="tags-merge-dialog__list">
              {directory.filter((entry) => entry.id !== mergeSource.id).map((entry) => (
                <button key={entry.id} type="button" className="ln-row" disabled={busy} onClick={() => void mergeInto(entry)}>
                  <span className="ln-ellipsis">{entry.name}</span>
                  <span className="tags-dir__counts">{entry.docCount} 篇文档、{entry.quickNoteCount} 条小记</span>
                </button>
              ))}
            </div>
            <footer className="tags-merge-dialog__footer">
              <button type="button" className="ln-btn ln-btn--ghost" onClick={() => setMergeSource(null)}>取消</button>
            </footer>
          </div>
        </Dialog>
      )}
      {confirmElement}
    </section>
  );
}
