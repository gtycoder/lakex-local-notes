import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, FileText, RotateCcw, Trash2, Trash, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../lib/requestVersion";
import { useFloatingDialog } from "./useFloatingDialog";

export interface TrashItem {
  id: string; title: string; nodeType: string; noteFileId: string | null;
  parentId: string | null; deletedAt: string; updatedAt: string; hasFile: boolean;
  /** 收到其他设备 purge 墓碑后被抑制的本地副本（保留可恢复、不上传） */
  purged?: boolean;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const floating = useFloatingDialog({ initialSize: { w: 900, h: 600 }, minSize: { w: 660, h: 420 } });
  const docsVersionRef = useRef(createRequestVersion());
  const quickVersionRef = useRef(createRequestVersion());

  const refresh = async () => {
    const version = docsVersionRef.current.next();
    setLoading(true);
    setError(null);
    try {
      const nextItems = await native.listTrash();
      if (docsVersionRef.current.isCurrent(version)) setItems(nextItems);
    } catch (e) {
      if (docsVersionRef.current.isCurrent(version)) setError(e instanceof Error ? e.message : String(e));
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
      if (quickVersionRef.current.isCurrent(version)) setError(e instanceof Error ? e.message : String(e));
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

  const restoreQuick = async (id: string) => {
    try { await native.restoreQuickNote(id); await refreshQuick(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const purgeQuick = async (id: string) => {
    if (!(window as any).confirm("彻底删除后不可恢复，确定删除？")) return;
    try { await native.purgeQuickNote(id); await refreshQuick(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const restore = async (id: string) => {
    try {
      await native.restoreTrash(id);
      await refresh();
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const purge = async (id: string) => {
    if (!(window as any).confirm("彻底删除后不可恢复，确定删除？")) return;
    try {
      await native.purgeTrash(id);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const empty = async () => {
    if (items.length === 0) return;
    if (!(window as any).confirm(`清空回收站（${items.length} 项）？此操作不可恢复。`)) return;
    try {
      await native.emptyTrash();
      await refresh();
      onChanged?.();
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
        <p className="trash-panel-hint">回收站随云同步到所有设备。其他设备彻底删除的条目仍保留在本端（标"已彻底删除"），可恢复。</p>
        {error && <div className="trash-error">{error}</div>}
        <div className="trash-list" style={{ display: tab === "docs" ? undefined : "none" }}>
          {loading && <div className="trash-empty-hint">加载中…</div>}
          {!loading && items.length === 0 && <div className="trash-empty-hint">回收站是空的</div>}
          {!loading && items.map((item) => (
            <div className="trash-item" key={item.id}>
              <span className="trash-item-icon">{item.nodeType === "note" ? <FileText size={15} /> : <Folder size={15} />}</span>
              <div className="trash-item-main">
                <div className="trash-item-title">{item.title || "无标题"}</div>
                <div className="trash-item-meta">
                  {item.nodeType === "note" ? "文档" : "目录"}
                  {item.purged ? " · 已被其他设备彻底删除（可恢复）" : ""}
                  {item.noteFileId && item.hasFile ? "" : item.nodeType === "note" ? " · 正文已删" : ""}
                  {" · "}{new Date(item.deletedAt).toLocaleString()}
                </div>
              </div>
              <div className="trash-item-actions">
                <button className="trash-restore" onClick={() => void restore(item.id)} title="恢复">
                  <RotateCcw size={14} /> 恢复
                </button>
                <button className="trash-purge" onClick={() => void purge(item.id)} title="彻底删除">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        {tab === "quick" && (
          <div className="trash-list">
            {quickItems.length === 0 && <div className="trash-empty-hint">回收站是空的</div>}
            {quickItems.map((item) => (
              <div className="trash-item" key={item.id}>
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
