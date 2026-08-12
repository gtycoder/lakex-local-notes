import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Clock, FileText, History, RotateCcw, Trash2, X } from "lucide-react";
import { native } from "../lib/native";

export interface HistoryItem {
  id: number; createdAt: string; size: number; contentHash: string; refCount: number; filePath: string;
}
export interface NoteOrphan {
  filename: string; size: number; mimeType: string; protectedByHistory: boolean;
}

type Tab = "history" | "orphans";

/** 文档历史 + 文档孤儿文件（两 tab）。
 * 顺序（用户强调）：默认先展示历史 tab；删历史快照后立即重算孤儿列表（避免漏删）。 */
export function HistoryPanel({ open, noteId, onClose, onRestored }: {
  open: boolean;
  noteId: string | null;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [tab, setTab] = useState<Tab>("history");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [orphans, setOrphans] = useState<NoteOrphan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = async () => {
    if (!noteId) return;
    setLoading(true);
    setError(null);
    try {
      setHistory(await native.listNoteHistory(noteId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const refreshOrphans = async () => {
    if (!noteId) return;
    setLoading(true);
    setError(null);
    try {
      setOrphans(await native.listNoteOrphans(noteId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 打开时先刷新历史（默认 tab）；孤儿在切到孤儿 tab 时刷新
  useEffect(() => {
    if (open && noteId) {
      void refreshHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, noteId]);

  const createSnapshot = async () => {
    if (!noteId) return;
    try {
      const sid = await native.createHistorySnapshot(noteId, undefined, true);
      if (sid === null) setError("当前内容与最近快照相同，未创建");
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restore = async (historyId: number) => {
    if (!window.confirm("恢复该版本会覆盖当前内容？当前版本会先存入历史。")) return;
    try {
      await native.restoreHistory(historyId);
      await refreshHistory();
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeHistory = async (historyId: number) => {
    try {
      await native.deleteHistory(historyId);
      await refreshHistory();
      // 顺序：删历史后立即重算孤儿（被删快照解除引用的资源此刻进入孤儿列表）
      await refreshOrphans();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    if (next === "orphans") void refreshOrphans();
  };

  const cleanOrphan = async (filename?: string) => {
    if (!noteId) return;
    try {
      await native.cleanNoteOrphans(noteId, filename ? [filename] : undefined);
      await refreshOrphans();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open || !noteId) return null;
  return createPortal(
    <div className="history-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="history-panel" role="dialog" aria-modal="true">
        <header>
          <div className="history-panel-title">
            <History size={17} />
            <h2>历史版本</h2>
          </div>
          <button className="history-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="history-tabs">
          <button className={`history-tab${tab === "history" ? " active" : ""}`} onClick={() => switchTab("history")}>
            <Clock size={13} /> 文档历史
          </button>
          <button className={`history-tab${tab === "orphans" ? " active" : ""}`} onClick={() => switchTab("orphans")}>
            <Trash2 size={13} /> 文档孤儿文件
          </button>
          {tab === "history" && (
            <button className="history-create" onClick={() => void createSnapshot()} title="手动创建快照">
              <Camera size={13} /> 创建快照
            </button>
          )}
        </div>
        <p className="history-hint">
          {tab === "history" ? "历史快照保存在本地，不参与同步。恢复前会自动保存当前版本。" : "未引用的资源文件（被历史引用的受保护，不会误删）。"}
        </p>
        {error && <div className="history-error">{error}</div>}
        {tab === "history" ? (
          <div className="history-list">
            {loading && <div className="history-empty">加载中…</div>}
            {!loading && history.length === 0 && <div className="history-empty">暂无历史快照</div>}
            {!loading && history.map((h) => (
              <div className="history-item" key={h.id}>
                <div className="history-item-main">
                  <div className="history-item-time">{new Date(h.createdAt).toLocaleString()}</div>
                  <div className="history-item-meta">
                    {(h.size / 1024).toFixed(1)} KB · {h.refCount} 个资源 · {h.contentHash.slice(0, 8)}
                  </div>
                </div>
                <div className="history-item-actions">
                  <button className="history-restore" onClick={() => void restore(h.id)}><RotateCcw size={13} /> 恢复</button>
                  <button className="history-delete" onClick={() => void removeHistory(h.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="history-list">
            {loading && <div className="history-empty">加载中…</div>}
            {!loading && orphans.length === 0 && <div className="history-empty">没有孤儿文件</div>}
            {!loading && orphans.length > 0 && (
              <button className="history-clean-all" onClick={() => void cleanOrphan()}>
                清理全部可清（{orphans.filter((o) => !o.protectedByHistory).length} 个）
              </button>
            )}
            {!loading && orphans.map((o) => (
              <div className="history-item" key={o.filename}>
                <FileText size={14} className="history-item-icon" />
                <div className="history-item-main">
                  <div className="history-item-time">{o.filename}</div>
                  <div className="history-item-meta">
                    {(o.size / 1024).toFixed(1)} KB · {o.protectedByHistory ? "受历史保护" : "可清理"}
                  </div>
                </div>
                {!o.protectedByHistory && (
                  <button className="history-delete" onClick={() => void cleanOrphan(o.filename)}><Trash2 size={13} /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}
