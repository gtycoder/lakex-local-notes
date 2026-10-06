import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "./ui/Overlay";
import { ChevronRight, Folder, File, RotateCcw, Trash, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../core/requestVersion";
import { useFloatingDialog } from "./useFloatingDialog";
import { DialogResizeHandles } from "./DialogResizeHandles";
import { SplitPane } from "./ui/SplitPane";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { reportNativeActionError } from "../lib/nativeErrors";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance } from "../features/editor/lakeRuntime";
import { addAssetAccessToken } from "../lib/assetPort";
import { trashDaysUntilPurge, type TrashItem } from "../core/trashPolicy";
import { formatDateTime } from "../lib/formatTime";
import { HistorySnapshotPreview } from "./HistorySnapshotPreview";
import type { NoteKind } from "../core/noteKind.js";

/** 组树：根 = parentId 为回收站笔记本或父不在列表内（旧数据/孤儿兜底）。 */
function buildTrashTree(items: TrashItem[]): TrashItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const isRoot = (it: TrashItem) => !it.parentId || !byId.has(it.parentId);
  return items.filter(isRoot);
}

function TrashTreeRow({ item, items, selectedId, onSelect, onRestore, onPurge, trashAutoPurgeDays }: {
  item: TrashItem;
  items: TrashItem[];
  selectedId: string | null;
  onSelect: (item: TrashItem) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  trashAutoPurgeDays: number | null;
}) {
  const children = useMemo(() => items.filter((it) => it.parentId === item.id), [items, item.id]);
  const isRoot = !item.parentId || !items.some((it) => it.id === item.parentId);
  const [open, setOpen] = useState(false);
  const fileMissing = item.nodeType === "note" && !(item.noteFileId && item.hasFile);
  const days = item.deletedAt ? trashDaysUntilPurge(item.deletedAt, trashAutoPurgeDays ?? 0) : null;

  return (
    <div className="trash-tree-node">
      <div className={`b3-list-item b3-list-item--hide-action ln-row2${selectedId === item.id ? " b3-list-item--focus" : ""}`}>
        <span
          className={`b3-list-item__toggle${children.length > 0 ? "" : " is-empty"}`}
          role="button"
          tabIndex={children.length > 0 ? 0 : -1}
          aria-label={open ? "折叠子项" : "展开子项"}
          aria-expanded={children.length > 0 ? open : undefined}
          onClick={() => children.length > 0 && setOpen((v) => !v)}
          onKeyDown={(e) => { if (children.length > 0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen((v) => !v); } }}
        >
          {children.length > 0 ? <ChevronRight size={13} className={open ? "trash-caret-open" : ""} /> : null}
        </span>
        <span className="b3-list-item__graphic">{item.nodeType === "note" ? <File size={14} /> : <Folder size={14} />}</span>
        <div className="b3-list-item__text ln-row2__main ln-ellipsis" onClick={() => onSelect(item)} title={item.nodeType === "note" ? "点击预览内容" : ""}>
          <span className="ln-row2__title">{item.title || "无标题"}</span>
          <span className="ln-row2__meta">
            {item.nodeType === "note" ? "文档" : "目录"}
            {item.deletedAt ? ` · ${formatDateTime(item.deletedAt)}` : ""}
          </span>
        </div>
        {item.purged && <span className="badge badge--error" title="其他设备已彻底删除；本机仍保留可恢复副本">已被他端删除</span>}
        {fileMissing && <span className="badge badge--muted" title="正文文件已不在本机">正文已删</span>}
        {days !== null && (
          <span className={`badge ${days <= 7 ? "badge--warn" : "badge--muted"}`} title="自动过期彻底删除倒计时（含云端）">{days} 天后清除</span>
        )}
        <span className="fn__space" />
        {isRoot && (
          <button className="b3-list-item__action" title="恢复（含全部内容）" aria-label="恢复（含全部内容）" onClick={() => onRestore(item.id)}><RotateCcw size={14} /></button>
        )}
        <button
          className="b3-list-item__action b3-list-item__action--warning"
          title={isRoot ? "彻底删除（含全部内容）" : "彻底删除（含子项）"}
          aria-label={isRoot ? "彻底删除（含全部内容）" : "彻底删除（含子项）"}
          onClick={() => onPurge(item.id)}
        >
          <Trash size={14} />
        </button>
      </div>
      {open && children.length > 0 && (
        <div className="trash-tree-children">
          {children.map((child) => (
            <TrashTreeRow key={child.id} item={child} items={items} selectedId={selectedId}
              trashAutoPurgeDays={trashAutoPurgeDays}
              onSelect={onSelect} onRestore={onRestore} onPurge={onPurge} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TrashPanel({ open, embed = false, onClose, onChanged, onRestored }: {
  open: boolean;
  /** 成页嵌入工作区（空间形态）：布局与弹窗一致，只去掉遮罩/拖拽壳。 */
  embed?: boolean;
  onClose: () => void;
  /** 彻底删除/清空后通知外部清理与文档关联的本地草稿。 */
  onChanged?: () => void;
  /** 恢复/删除后通知外部刷新树 */
  /** 只读原因（本次恢复的条目 id）；清空回收站时可不传（表示批量恢复）。 */
  onRestored: (restoredId?: string) => void;
}) {
  const [tab, setTab] = useState<"docs" | "quick">("docs");
  const [items, setItems] = useState<TrashItem[]>([]);
  const [quickItems, setQuickItems] = useState<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }>>([]);
  const [selected, setSelected] = useState<{ id: string; title: string; noteId: string | null; html: string; kind?: NoteKind } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 回收站预览资源补拉中的加载态（大文档首次预览需从云端补缺失资源）
  const [previewing, setPreviewing] = useState(false);
  // C1：回收站自动过期配置（trashAutoPurgeDays；0=关闭不显示倒计时/提示条）
  const [trashAutoPurgeDays, setTrashAutoPurgeDays] = useState<number | null>(null);
  const floating = useFloatingDialog({ id: "trash", initialSize: { w: 1000, h: 640 }, minSize: { w: 740, h: 460 } });
  const docsVersionRef = useRef(createRequestVersion());
  const previewVersionRef = useRef(createRequestVersion());
  const quickVersionRef = useRef(createRequestVersion());
  const previewHostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<LakeEditorInstance | null>(null);

  const refresh = async () => {
    const version = docsVersionRef.current.next();
    setLoading(true);
    setError(null);
    try {
      const nextItems = await native.listTrash();
      if (docsVersionRef.current.isCurrent(version)) setItems(nextItems);
    } catch (e) {
      if (docsVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(e));
    } finally {
      if (docsVersionRef.current.isCurrent(version)) setLoading(false);
    }
  };

  const refreshQuick = async () => {
    const version = quickVersionRef.current.next();
    try {
      const nextItems = await native.listQuickNoteTrash();
      if (quickVersionRef.current.isCurrent(version)) setQuickItems(nextItems);
    } catch (e) {
      if (quickVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(e));
    }
  };

  useEffect(() => {
    docsVersionRef.current.invalidate();
    quickVersionRef.current.invalidate();
    if (open) {
      void refresh();
      void refreshQuick();
      void native.getS3GcSettings().then((s) => setTrashAutoPurgeDays(s.trashAutoPurgeDays)).catch(() => setTrashAutoPurgeDays(null));
    }
    return () => {
      docsVersionRef.current.invalidate();
      quickVersionRef.current.invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !floating.interactionRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, floating.interactionRef]);

  const preview = async (item: TrashItem) => {
    if (item.nodeType !== "note" || !item.noteFileId) { setSelected({ id: item.id, title: item.title || "无标题", noteId: null, html: "" }); return; }
    const noteFileId = item.noteFileId;
    const version = previewVersionRef.current.next();
    setSelected(null); // 清空旧预览（销毁旧 viewer），避免加载期间显示上一篇内容
    setPreviewing(true);
    try {
      // 回收站惰性下载补偿：预览前按需补拉该笔记本地缺失的资源（best-effort，失败仍显示本地已有内容）。
      await native.ensureTrashNoteAssets(noteFileId).catch((error) => reportNativeActionError("预览回收站附件", error));
      const doc = await native.readNote(noteFileId);
      if (!previewVersionRef.current.isCurrent(version)) return;
      setSelected({ id: item.id, title: item.title || "无标题", noteId: noteFileId, html: doc.content, kind: (doc.kind ?? "doc") as NoteKind });
    } catch (e) {
      if (!previewVersionRef.current.isCurrent(version)) return;
      setSelected({ id: item.id, title: item.title || "无标题", noteId: null, html: "" });
      setError(getNativeErrorMessage(e));
    } finally {
      if (previewVersionRef.current.isCurrent(version)) setPreviewing(false);
    }
  };

  // 选中文档 → Lake viewer 渲染（完整样式：图片/代码块/公式/画板；只读，不创建编辑器对象）
  // ⚠️ 只给 **doc** 挂：表格/多维表/画板的正文是内部 JSON，塞给 doc viewer 会原样吐出 JSON
  //（用户 261006 报"多维表预览又坏了"）⇒ 这三种走 <HistorySnapshotPreview>（与历史面板同一实现）。
  useEffect(() => {
    const host = previewHostRef.current;
    if (!host || !selected?.noteId || (selected.kind ?? "doc") !== "doc") {
      if (viewerRef.current) { destroyLakeEditor(viewerRef.current); viewerRef.current = null; }
      return;
    }
    let disposed = false;
    let viewer: LakeEditorInstance | null = null;
    try {
      viewer = createLakeDocument(host, "viewer", () => {}, false, selected.noteId, host, { disableNativeToc: true });
      viewerRef.current = viewer;
      viewer.setDocument("text/lake", addAssetAccessToken(selected.html));
      viewer.requestCardHydration?.();
    } catch (e) {
      if (!disposed) setError(getNativeErrorMessage(e));
    }
    return () => {
      disposed = true;
      if (viewer) { try { destroyLakeEditor(viewer); } catch { /* ignore */ } }
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [selected?.id, selected?.noteId]);

  const restoreQuick = async (id: string) => {
    try { await native.restoreQuickNote(id); await refreshQuick(); }
    catch (e) { setError(getNativeErrorMessage(e)); }
  };
  const purgeQuick = async (id: string) => {
    if (!window.confirm("彻底删除小记：本机立即移除、云端立即删除且不可恢复；其他设备若仍持有可恢复副本，直到它们也处理。确定删除？")) return;
    try { await native.purgeQuickNote(id); await refreshQuick(); }
    catch (e) { setError(getNativeErrorMessage(e)); }
  };

  const restore = async (id: string) => {
    const item = items.find((it) => it.id === id);
    const label = item?.title || "该文档";
    if (!window.confirm(`恢复「${label}」及其全部内容到原位置？`)) return;
    try {
      await native.restoreTrash(id);
      setSelected(null);
      await refresh();
      onRestored(id);
    } catch (e) {
      setError(getNativeErrorMessage(e));
    }
  };

  const purge = async (id: string) => {
    const item = items.find((it) => it.id === id);
    const isRoot = !item?.parentId || !items.some((it) => it.id === item.parentId);
    const label = item?.title || "该节点";
    const hint = isRoot ? `「${label}」及其全部内容` : `「${label}」及其子项`;
    if (!window.confirm(`彻底删除${hint}：本机立即移除、云端正文/资源立即删除且不可恢复（非回收窗口）；其他设备仍保留可恢复副本直到它们处理。确定删除？`)) return;
    try {
      await native.purgeTrash(id);
      if (selected?.id === id) setSelected(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(getNativeErrorMessage(e));
    }
  };

  const empty = async () => {
    if (items.length === 0) return;
    if (!window.confirm(`清空回收站（${buildTrashTree(items).length} 项）？将彻底删除：本机立即移除、云端正文/资源立即删除且不可恢复；其他设备保留可恢复副本直到它们处理。此操作不可撤销。`)) return;
    try {
      await native.emptyTrash();
      setSelected(null);
      await refresh();
      onChanged?.();
      onRestored();
    } catch (e) {
      setError(getNativeErrorMessage(e));
    }
  };

  const roots = useMemo(() => buildTrashTree(items), [items]);
  const canPreview = !!selected?.noteId;

  if (!open) return null;

  /** 主体（弹窗 / 成页共用；布局不改） */
  const body = (
    <>
      <header className={embed ? "trash-space-header" : "floating-dialog-header"} {...(embed ? {} : { onPointerDown: floating.startDrag })}>
        <div className="panel-title">
          <Trash size={16} />
          <h2>回收站</h2>
        </div>
        <div className="panel-actions">
          {items.length > 0 && (
            <button className="b3-button b3-button--outline ft__error" onClick={() => void empty()}>
              <Trash size={14} /> 清空
            </button>
          )}
          {!embed && (
            <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
          )}
        </div>
      </header>
      {/* 页签走 kit 层原语（.ln-tabs：墨线 + 计数徽标） */}
      <div className="ln-tabs">
        <div className="ln-tabs__track" role="tablist" aria-label="回收站">
          <button type="button" role="tab" aria-selected={tab === "docs"} className={`ln-tabs__item${tab === "docs" ? " is-active" : ""}`} onClick={() => setTab("docs")}>
            文档<span className="ln-tabs__count">{items.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "quick"} className={`ln-tabs__item${tab === "quick" ? " is-active" : ""}`} onClick={() => setTab("quick")}>
            小记<span className="ln-tabs__count">{quickItems.length}</span>
          </button>
        </div>
      </div>
      <p className="trash-panel-hint">回收站随云同步到所有设备。被删文档下的分组/文档随父级联（可展开查看），恢复仅对顶层生效（整棵恢复），子项可单独彻底删除。</p>
      {trashAutoPurgeDays != null && trashAutoPurgeDays > 0 && tab === "docs" && items.some((it) => {
        const d = it.deletedAt ? trashDaysUntilPurge(it.deletedAt, trashAutoPurgeDays) : null;
        return d != null && d <= 7;
      }) && (
        <p className="trash-panel-notice">
          开启自动过期（{trashAutoPurgeDays} 天）：部分条目将在 7 天内自动彻底删除（含云端）。需要保留请在到期前恢复。
        </p>
      )}
      {error && <div className="trash-error">{error}</div>}
      <SplitPane ariaLabel="调整回收站列表宽度" storageKey="trash" hidden={tab !== "docs"} minRight={280}>
        <div className="history-list b3-list b3-list--background history-list-left">
          {loading && <div className="ln-empty">加载中…</div>}
          {!loading && items.length === 0 && <div className="ln-empty">回收站是空的</div>}
          {!loading && roots.map((item) => (
            <TrashTreeRow key={item.id} item={item} items={items} selectedId={selected?.id ?? null}
              trashAutoPurgeDays={trashAutoPurgeDays}
              onSelect={(it) => void preview(it)} onRestore={(id) => void restore(id)} onPurge={(id) => void purge(id)} />
          ))}
        </div>
        <div className="history-preview-inline trash-preview">
          {previewing ? (
            <div className="ln-empty">正在加载资源…</div>
          ) : selected ? (
            <>
              <div className="history-preview-inline-title">{selected.title}</div>
              {canPreview ? (
                selected.kind && selected.kind !== "doc" ? (
                  <HistorySnapshotPreview kind={selected.kind} noteId={selected.noteId ?? ""} body={selected.html} snapshotId={selected.id} />
                ) : (
                  <div className="trash-preview-viewer" ref={previewHostRef} />
                )
              ) : (
                <div className="ln-empty">该节点无可预览内容（目录或正文已删）</div>
              )}
            </>
          ) : (
            <div className="ln-empty">选择左侧文档查看内容</div>
          )}
        </div>
      </SplitPane>
      {tab === "quick" && (
        <div className="history-list b3-list b3-list--background">
          {quickItems.length === 0 && <div className="ln-empty">回收站是空的</div>}
          {quickItems.map((item) => (
            <div className="b3-list-item b3-list-item--hide-action ln-row2" key={item.id}>
              <span className="b3-list-item__graphic"><File size={14} /></span>
              <div className="b3-list-item__text ln-row2__main ln-ellipsis">
                <span className="ln-row2__title">小记</span>
                <span className="ln-row2__meta">{formatDateTime(item.deletedAt)}</span>
              </div>
              <span className="fn__space" />
              <button className="b3-list-item__action" title="恢复" aria-label="恢复" onClick={() => void restoreQuick(item.id)}><RotateCcw size={14} /></button>
              <button className="b3-list-item__action b3-list-item__action--warning" title="彻底删除" aria-label="彻底删除" onClick={() => void purgeQuick(item.id)}><Trash size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {!embed && <DialogResizeHandles onResize={floating.startResize} />}
    </>
  );

  if (embed) {
    // 成页空间（对齐小记 quick-notes-pane）：**不要**挂 floating-dialog（那是弹窗壳）
    return (
      <section className="trash-space-pane" role="region" aria-label="回收站">
        {body}
      </section>
    );
  }

  return (
    <Dialog
      open
      onDismiss={() => { if (!floating.interactionRef.current) onClose(); }}
      label="回收站"
      surfaceClassName="floating-dialog trash-panel"
      style={floating.panelStyle}
      surfaceRef={floating.panelRef}
    >
      {body}
    </Dialog>
  );
}
