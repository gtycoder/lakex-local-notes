import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Folder, FileText, RotateCcw, Trash2, Trash, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../core/requestVersion";
import { useFloatingDialog } from "./useFloatingDialog";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance } from "../features/editor/lakeRuntime";
import { addAssetAccessToken } from "../lib/assetPort";
import type { TrashItem } from "../core/trashRepository";

/** 组树：根 = parentId 为回收站笔记本或父不在列表内（旧数据/孤儿兜底）。 */
function buildTrashTree(items: TrashItem[]): TrashItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const isRoot = (it: TrashItem) => !it.parentId || !byId.has(it.parentId);
  return items.filter(isRoot);
}

function TrashTreeRow({ item, items, selectedId, onSelect, onRestore, onPurge }: {
  item: TrashItem;
  items: TrashItem[];
  selectedId: string | null;
  onSelect: (item: TrashItem) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}) {
  const children = useMemo(() => items.filter((it) => it.parentId === item.id), [items, item.id]);
  const isRoot = !item.parentId || !items.some((it) => it.id === item.parentId);
  const [open, setOpen] = useState(false);

  return (
    <div className="trash-tree-node">
      <div className={`trash-item ${selectedId === item.id ? "trash-item-selected" : ""}`}>
        <span className="trash-item-caret" role="button" onClick={() => setOpen((v) => !v)}>
          {children.length > 0
            ? <ChevronRight size={13} className={open ? "trash-caret-open" : ""} />
            : <span className="trash-caret-placeholder" />}
        </span>
        <span className="trash-item-icon">{item.nodeType === "note" ? <FileText size={15} /> : <Folder size={15} />}</span>
        <div className="trash-item-main" onClick={() => onSelect(item)} title={item.nodeType === "note" ? "点击预览内容" : ""}>
          <div className="trash-item-title">{item.title || "无标题"}</div>
          <div className="trash-item-meta">
            {item.nodeType === "note" ? "文档" : "目录"}
            {item.purged ? " · 已被其他设备彻底删除（可恢复）" : ""}
            {item.noteFileId && item.hasFile ? "" : item.nodeType === "note" ? " · 正文已删" : ""}
            {item.deletedAt ? ` · ${new Date(item.deletedAt).toLocaleString()}` : ""}
          </div>
        </div>
        <div className="trash-item-actions">
          {isRoot && (
            <button className="trash-restore" onClick={() => onRestore(item.id)} title="恢复（含全部内容）">
              <RotateCcw size={14} /> 恢复
            </button>
          )}
          <button className="trash-purge" onClick={() => onPurge(item.id)} title={isRoot ? "彻底删除（含全部内容）" : "彻底删除（含子项）"}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {open && children.length > 0 && (
        <div className="trash-tree-children">
          {children.map((child) => (
            <TrashTreeRow key={child.id} item={child} items={items} selectedId={selectedId}
              onSelect={onSelect} onRestore={onRestore} onPurge={onPurge} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TrashPanel({ open, onClose, onChanged, onRestored }: {
  open: boolean;
  onClose: () => void;
  /** 彻底删除/清空后通知外部清理与文档关联的本地草稿。 */
  onChanged?: () => void;
  /** 恢复/删除后通知外部刷新树 */
  onRestored: () => void;
}) {
  const [tab, setTab] = useState<"docs" | "quick">("docs");
  const [items, setItems] = useState<TrashItem[]>([]);
  const [quickItems, setQuickItems] = useState<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }>>([]);
  const [selected, setSelected] = useState<{ id: string; title: string; noteId: string | null; html: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const floating = useFloatingDialog({ initialSize: { w: 1000, h: 640 }, minSize: { w: 740, h: 460 } });
  const docsVersionRef = useRef(createRequestVersion());
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
    if (open) { void refresh(); void refreshQuick(); }
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
    try {
      const doc = await native.readNote(item.noteFileId);
      setSelected({ id: item.id, title: item.title || "无标题", noteId: item.noteFileId, html: doc.content });
    } catch (e) {
      setSelected({ id: item.id, title: item.title || "无标题", noteId: null, html: "" });
      setError(getNativeErrorMessage(e));
    }
  };

  // 选中文档 → Lake viewer 渲染（完整样式：图片/代码块/公式/画板；只读，不创建编辑器对象）
  useEffect(() => {
    const host = previewHostRef.current;
    if (!host || !selected?.noteId) {
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
    if (!window.confirm("彻底删除后不可恢复，确定删除？")) return;
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
      onRestored();
    } catch (e) {
      setError(getNativeErrorMessage(e));
    }
  };

  const purge = async (id: string) => {
    const item = items.find((it) => it.id === id);
    const isRoot = !item?.parentId || !items.some((it) => it.id === item.parentId);
    const label = item?.title || "该节点";
    const hint = isRoot ? `「${label}」及其全部内容` : `「${label}」及其子项`;
    if (!window.confirm(`彻底删除${hint}后不可恢复，确定删除？`)) return;
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
    if (!window.confirm(`清空回收站（${buildTrashTree(items).length} 项）？此操作不可恢复。`)) return;
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
  return createPortal(
    <div className="trash-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !floating.interactionRef.current) onClose(); }}>
      <section ref={floating.panelRef} className="floating-dialog trash-panel" style={floating.panelStyle} role="dialog" aria-modal="true">
        <header className="floating-dialog-header" onPointerDown={floating.startDrag}>
          <div className="trash-panel-title">
            <Trash2 size={17} />
            <h2>回收站</h2>
          </div>
          <div className="trash-panel-actions">
            {items.length > 0 && (
              <button className="trash-empty" onClick={() => void empty()}>
                <Trash size={14} /> 清空
              </button>
            )}
            <button className="trash-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
          </div>
        </header>
        <div className="trash-tabs">
          <button className={`trash-tab ${tab === "docs" ? "active" : ""}`} onClick={() => setTab("docs")}>文档</button>
          <button className={`trash-tab ${tab === "quick" ? "active" : ""}`} onClick={() => setTab("quick")}>小记</button>
        </div>
        <p className="trash-panel-hint">回收站随云同步到所有设备。被删文档下的分组/文档随父级联（可展开查看），恢复仅对顶层生效（整棵恢复），子项可单独彻底删除。</p>
        {error && <div className="trash-error">{error}</div>}
        <div className="history-split" style={{ display: tab === "docs" ? undefined : "none" }}>
          <div className="history-list history-list-left">
            {loading && <div className="trash-empty-hint">加载中…</div>}
            {!loading && items.length === 0 && <div className="trash-empty-hint">回收站是空的</div>}
            {!loading && roots.map((item) => (
              <TrashTreeRow key={item.id} item={item} items={items} selectedId={selected?.id ?? null}
                onSelect={(it) => void preview(it)} onRestore={(id) => void restore(id)} onPurge={(id) => void purge(id)} />
            ))}
          </div>
          <div className="history-preview-inline trash-preview">
            {selected ? (
              <>
                <div className="history-preview-inline-title">{selected.title}</div>
                {canPreview ? (
                  <div className="trash-preview-viewer" ref={previewHostRef} />
                ) : (
                  <div className="trash-empty-hint">该节点无可预览内容（目录或正文已删）</div>
                )}
              </>
            ) : (
              <div className="trash-empty-hint">选择左侧文档查看内容</div>
            )}
          </div>
        </div>
        {tab === "quick" && (
          <div className="trash-list">
            {quickItems.length === 0 && <div className="trash-empty-hint">回收站是空的</div>}
            {quickItems.map((item) => (
              <div className="trash-item" key={item.id}>
                <span className="trash-item-caret"><span className="trash-caret-placeholder" /></span>
                <span className="trash-item-icon"><FileText size={15} /></span>
                <div className="trash-item-main">
                  <div className="trash-item-title">小记</div>
                  <div className="trash-item-meta">小记 · {new Date(item.deletedAt).toLocaleString()}</div>
                </div>
                <div className="trash-item-actions">
                  <button className="trash-restore" onClick={() => void restoreQuick(item.id)} title="恢复"><RotateCcw size={14} /> 恢复</button>
                  <button className="trash-purge" onClick={() => void purgeQuick(item.id)} title="彻底删除"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="floating-dialog-resize" onPointerDown={floating.startResize} title="拖动调整大小" />
      </section>
    </div>,
    document.body
  );
}
