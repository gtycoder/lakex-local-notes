import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, FileText, GripVertical, Merge, Pencil, RefreshCw, StickyNote, Tag as TagIcon, Trash, X } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";
import { InlineRenameInput } from "../../components/ui/InlineRenameInput";
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
  onRenameTag(id: string, name: string): Promise<void>;
  onMergeTag(sourceId: string, targetId: string): Promise<void>;
  onDeleteTag(id: string): Promise<void>;
  onReorderTags(orderedIds: string[]): Promise<void>;
  onOpenDocument(noteId: string): void;
  onOpenQuickNote(quickNoteId: string): void;
  /** 读正文（只读预览用）：文档 = readNote；小记 = readQuickNote。失败返回 null。 */
  onLoadPreview(item: TagAggregateItem): Promise<string | null>;
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
  const { active, tags, documentLinks, notes, quickNotes, available, dataError = null, onReload, onRenameTag, onMergeTag, onDeleteTag, onReorderTags, onOpenDocument, onOpenQuickNote, onLoadPreview, onError } = props;
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<TagAggregateKindFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [mergeSource, setMergeSource] = useState<TagDirectoryEntry | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [previewItem, setPreviewItem] = useState<TagAggregateItem | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const { confirm, confirmElement } = useConfirm();

  const directory = useMemo(() => buildTagDirectory({ tags, documentLinks, quickNotes }), [tags, documentLinks, quickNotes]);
  const selected = directory.find((entry) => entry.id === selectedTagId) ?? null;
  const aggregate = useMemo(
    () => buildTagAggregate({ tagId: selectedTagId, documentLinks, notes, quickNotes, filter: kindFilter }),
    [selectedTagId, documentLinks, notes, quickNotes, kindFilter],
  );

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

  const directoryEmpty = directory.length === 0;
  let aggregateBody: ReactNode;
  if (!available) {
    aggregateBody = <p className="tags-empty" role="status">标签数据暂不可用：请升级到支持文档标签的版本。</p>;
  } else if (dataError) {
    aggregateBody = <p className="tags-empty" role="status">{dataError}</p>;
  } else if (directoryEmpty) {
    aggregateBody = <p className="tags-empty" role="status">还没有标签。在文档属性或小记里添加标签后会出现在这里。</p>;
  } else if (!selected) {
    aggregateBody = <p className="tags-empty" role="status">从左侧选择一个标签，查看它下面的文档与小记。</p>;
  } else if (aggregate.total === 0) {
    aggregateBody = <p className="tags-empty" role="status">「{selected.name}」下还没有{kindFilter === "doc" ? "文档" : kindFilter === "quickNote" ? "小记" : "内容"}。</p>;
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
        <button type="button" className={"ln-row tags-aggregate__row" + (selectedRow ? " is-selected" : "")}
          onClick={() => void openPreview(item)} title={item.title}>
          {item.kind === "doc" ? <FileText size={14} aria-hidden="true" /> : <StickyNote size={14} aria-hidden="true" />}
          <span className="ln-ellipsis tags-aggregate__row-title">{item.title}</span>
          <time className="tags-aggregate__row-time" dateTime={item.updatedAt}>{formatUpdated(item.updatedAt)}</time>
        </button>
      </li>
    );
  }

  return (
    <section className="tags-space" aria-label="标签" data-tags-space={active ? "active" : "idle"}>
      <header className="tags-space__head">
        <h1 className="tags-space__title"><TagIcon size={16} aria-hidden="true" />标签</h1>
        <span className="tags-space__count">{directory.length} 个标签</span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="刷新标签" title="刷新" disabled={reloading}
          onClick={() => void reload()}><RefreshCw size={14} className={reloading ? "spin" : undefined} /></button>
      </header>
      <div className="tags-space__cols">
        <div className="tags-dir" role="listbox" aria-label="标签目录">
          {directoryEmpty
            ? <p className="tags-empty tags-empty--inset" role="status">{available ? "还没有标签。" : "标签目录暂不可用。"}</p>
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
                  <button type="button" className="tags-dir__select" onClick={() => setSelectedTagId(entry.id)} title={entry.name}>
                    <span className="ln-ellipsis tags-dir__name">{entry.name}</span>
                    <span className="tags-dir__counts">
                      <span title={"文档 " + entry.docCount + " 篇"}>文 {entry.docCount}</span>
                      <span title={"小记 " + entry.quickNoteCount + " 条"}>记 {entry.quickNoteCount}</span>
                    </span>
                    <time className="tags-dir__time" dateTime={entry.updatedAt}>{formatUpdated(entry.updatedAt)}</time>
                  </button>
                )}
                {editingId === entry.id ? (
                  <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="保存名称" onClick={() => void saveRename(entry)}><Check size={13} /></button>
                ) : (
                  <>
                    <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label={"重命名标签 " + entry.name} title="重命名" disabled={busy}
                      onClick={() => { setEditingId(entry.id); setEditName(entry.name); }}><Pencil size={13} /></button>
                    <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label={"合并标签 " + entry.name} title="合并到…" disabled={busy || directory.length <= 1}
                      onClick={() => setMergeSource(entry)}><Merge size={13} /></button>
                    <button type="button" className="ln-iconbtn ln-iconbtn--compact tags-dir__danger" aria-label={"删除标签 " + entry.name} title="删除标签（保留内容）" disabled={busy}
                      onClick={() => void removeTag(entry)}><Trash size={13} /></button>
                  </>
                )}
              </div>
            ))}
        </div>
        <div className="tags-aggregate" aria-label="标签内容">
          <div className="ln-tabs tags-aggregate__tabs" role="tablist" aria-label="内容类型">
            {KIND_TABS.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={kindFilter === tab.id}
                className={"ln-tabs__item" + (kindFilter === tab.id ? " is-active" : "")}
                onClick={() => setKindFilter(tab.id)}>{tab.label}</button>
            ))}
          </div>
          {selected && <p className="tags-aggregate__hint">「{selected.name}」：{aggregate.docs.length} 篇文档、{aggregate.quickNotes.length} 条小记（按更新时间倒序）</p>}
          {aggregateBody}
        </div>
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
      {mergeSource && (
        <Dialog open onDismiss={() => setMergeSource(null)} label="合并标签" className="tags-merge-dialog">
          <div className="ln-dialog__body">
            <h3>把「{mergeSource.name}」合并到…</h3>
            <p className="tags-merge-dialog__hint">合并后源标签消失；文档与小记会保留，引用改到目标标签。</p>
            <div className="tags-merge-dialog__list">
              {directory.filter((entry) => entry.id !== mergeSource.id).map((entry) => (
                <button key={entry.id} type="button" className="ln-row" disabled={busy} onClick={() => void mergeInto(entry)}>
                  <span className="ln-ellipsis">{entry.name}</span>
                  <span className="tags-dir__counts">文 {entry.docCount} · 记 {entry.quickNoteCount}</span>
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
