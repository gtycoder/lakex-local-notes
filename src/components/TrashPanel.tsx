import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, FileText, RotateCcw, Trash2, Trash, X } from "lucide-react";
import { native } from "../lib/native";

export interface TrashItem {
  id: string; title: string; nodeType: string; noteFileId: string | null;
  parentId: string | null; deletedAt: string; updatedAt: string; hasFile: boolean;
}

export function TrashPanel({ open, onClose, onRestored }: {
  open: boolean;
  onClose: () => void;
  /** 恢复/删除后通知外部刷新树 */
  onRestored: () => void;
}) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await native.listTrash());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

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
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;
  return createPortal(
    <div className="trash-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="trash-panel" role="dialog" aria-modal="true">
        <header>
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
        <p className="trash-panel-hint">回收站仅保存在本地，不参与同步。恢复后的文档会重新参与同步。</p>
        {error && <div className="trash-error">{error}</div>}
        <div className="trash-list">
          {loading && <div className="trash-empty-hint">加载中…</div>}
          {!loading && items.length === 0 && <div className="trash-empty-hint">回收站是空的</div>}
          {!loading && items.map((item) => (
            <div className="trash-item" key={item.id}>
              <span className="trash-item-icon">{item.nodeType === "note" ? <FileText size={15} /> : <Folder size={15} />}</span>
              <div className="trash-item-main">
                <div className="trash-item-title">{item.title || "无标题"}</div>
                <div className="trash-item-meta">
                  {item.nodeType === "note" ? "文档" : "目录"}
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
      </section>
    </div>,
    document.body
  );
}
