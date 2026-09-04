import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Clock, FileText, History, RotateCcw, Trash2, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../core/requestVersion";
import { useFloatingDialog } from "./useFloatingDialog";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance } from "../features/editor/lakeRuntime";
import { addAssetAccessToken } from "../lib/assetPort";

export interface HistoryItem {
  id: number; createdAt: string; size: number; contentHash: string; refCount: number; filePath: string; protectedUntil: string | null;
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
  onRestored: (noteId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("history");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [orphans, setOrphans] = useState<NoteOrphan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orphanPv, setOrphanPv] = useState<{
    title: string;
    text?: string;
    imageData?: string;
    size?: number;
  } | null>(null);
  const [inline, setInline] = useState<{ title: string; html: string; size?: number } | null>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<LakeEditorInstance | null>(null);
  const floating = useFloatingDialog({ initialSize: { w: 900, h: 640 }, minSize: { w: 680, h: 440 } });
  const dataVersionRef = useRef(createRequestVersion());
  const previewVersionRef = useRef(createRequestVersion());

  const refreshHistory = async () => {
    if (!noteId) return;
    const version = dataVersionRef.current.next();
    setLoading(true);
    setError(null);
    try {
      const nextHistory = await native.listNoteHistory(noteId);
      if (dataVersionRef.current.isCurrent(version)) setHistory(nextHistory);
    } catch (e) {
      if (dataVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(e));
    } finally {
      if (dataVersionRef.current.isCurrent(version)) setLoading(false);
    }
  };

  const refreshOrphans = async () => {
    if (!noteId) return;
    const version = dataVersionRef.current.next();
    setLoading(true);
    setError(null);
    try {
      const nextOrphans = await native.listNoteOrphans(noteId);
      if (dataVersionRef.current.isCurrent(version)) setOrphans(nextOrphans);
    } catch (e) {
      if (dataVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(e));
    } finally {
      if (dataVersionRef.current.isCurrent(version)) setLoading(false);
    }
  };

  // 打开时先刷新历史（默认 tab）；孤儿在切到孤儿 tab 时刷新。
  // 验收 #2：切换 note / 重新打开时必须清空上次的列表与预览状态（inline/preview），
  // 否则弹窗残留上一次内容（"快照弹窗不清理、还弹出上一次的内容"）。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !floating.interactionRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, floating.interactionRef]);

  useEffect(() => {
    // 切换文档、关闭弹窗或重新打开时，之前的列表/预览请求都不得再提交。
    dataVersionRef.current.invalidate();
    previewVersionRef.current.invalidate();
    if (open && noteId) {
      setTab("history");
      setHistory([]);
      setOrphans([]);
      setInline(null);
      setOrphanPv(null);
      setError(null);
      void refreshHistory();
    }
    return () => {
      dataVersionRef.current.invalidate();
      previewVersionRef.current.invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, noteId]);

  const createSnapshot = async () => {
    if (!noteId) return;
    try {
      const sid = await native.createHistorySnapshot(noteId, undefined, true);
      if (sid === null) setError("当前内容与最近快照相同，未创建");
      await refreshHistory();
    } catch (e) {
      setError(getNativeErrorMessage(e));
    }
  };

  const restore = async (historyId: number) => {
    if (!window.confirm("恢复该版本会覆盖当前内容（含只读/锁定文档）？当前版本会先存入历史。")) return;
    try {
      await native.restoreHistory(historyId);
      await refreshHistory();
      if (noteId) onRestored(noteId);
    } catch (e) {
      setError(getNativeErrorMessage(e));
    }
  };

  const removeHistory = async (historyId: number) => {
    try {
      await native.deleteHistory(historyId);
      await refreshHistory();
      // 顺序：删历史后立即重算孤儿（被删快照解除引用的资源此刻进入孤儿列表）
      await refreshOrphans();
    } catch (e) {
      setError(getNativeErrorMessage(e));
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
      setError(getNativeErrorMessage(e));
    }
  };

  const previewHistoryInline = async (h: HistoryItem) => {
    const version = previewVersionRef.current.next();
    try {
      const r = await native.previewHistorySnapshot(h.id);
      if (!previewVersionRef.current.isCurrent(version)) return;
      if (r) setInline({ title: new Date(h.createdAt).toLocaleString(), html: r.html, size: h.size });
      else setError("快照预览失败（文件可能已删除）");
    } catch (e) {
      if (previewVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(e));
    }
  };

  // 选中的历史快照 → Lake viewer 渲染（完整样式；只读，不创建编辑器对象）
  useEffect(() => {
    const host = previewHostRef.current;
    if (!host || !inline || !noteId) {
      if (viewerRef.current) { destroyLakeEditor(viewerRef.current); viewerRef.current = null; }
      return;
    }
    let disposed = false;
    let viewer: LakeEditorInstance | null = null;
    try {
      viewer = createLakeDocument(host, "viewer", () => {}, false, noteId, host, { disableNativeToc: true });
      viewerRef.current = viewer;
      viewer.setDocument("text/lake", addAssetAccessToken(inline.html));
      viewer.requestCardHydration?.();
    } catch (e) {
      if (!disposed) setError(getNativeErrorMessage(e));
    }
    return () => {
      disposed = true;
      if (viewer) { try { destroyLakeEditor(viewer); } catch { /* ignore */ } }
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
  }, [inline?.title, noteId]);

  const previewOrphanFile = async (o: NoteOrphan) => {
    if (!noteId) return;
    const version = previewVersionRef.current.next();
    setOrphanPv(null);
    try {
      const r = await native.previewNoteOrphan(noteId, o.filename);
      if (!previewVersionRef.current.isCurrent(version)) return;
      if (r) {
        setOrphanPv(r.kind === "image"
          ? { title: o.filename, imageData: r.data, size: r.size }
          : { title: o.filename, text: r.data, size: r.size });
      } else {
        setError("文件预览失败（文件可能已删除）");
      }
    } catch (e) {
      if (previewVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(e));
    }
  };

  const cleanable = orphans.filter((o) => !o.protectedByHistory).length;

  if (!open || !noteId) return null;
  return createPortal(
    <div className="history-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !floating.interactionRef.current) onClose(); }}>
      <section ref={floating.panelRef} className="floating-dialog history-panel" style={floating.panelStyle} role="dialog" aria-modal="true">
        <header className="floating-dialog-header" onPointerDown={floating.startDrag}>
          <div className="panel-title">
            <History size={17} />
            <h2>历史版本</h2>
          </div>
          <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="ln-tabs">
          <div className="ln-tabs__track" role="tablist" aria-label="历史版本">
          <button role="tab" aria-selected={tab === "history"} className={`ln-tabs__item${tab === "history" ? " is-active" : ""}`} onClick={() => switchTab("history")}>
            <Clock size={14} /> 文档历史
          </button>
          <button role="tab" aria-selected={tab === "orphans"} className={`ln-tabs__item${tab === "orphans" ? " is-active" : ""}`} onClick={() => switchTab("orphans")}>
            <Trash2 size={14} /> 文档孤儿文件
          </button>
          </div>
          {tab === "history" && (
            <button className="b3-button b3-button--outline ln-tabs__action" onClick={() => void createSnapshot()} title="手动创建快照">
              <Camera size={14} /> 创建快照
            </button>
          )}
        </div>
        <p className="history-hint">
          {tab === "history" ? "历史快照保存在本地，不参与同步。恢复前会自动保存当前版本。" : "未引用的资源文件（被历史引用的受保护，不会误删）。"}
        </p>
        {error && <div className="history-error">{error}</div>}
        {tab === "orphans" && orphans.length > 0 && (
          <div className="ln-toolbar">
            <span className="ln-toolbar__info">共 {orphans.length} 个 · 可清理 {cleanable} · 受历史保护 {orphans.length - cleanable}</span>
            <button className="b3-button b3-button--outline ft__error" onClick={() => void cleanOrphan()} disabled={cleanable === 0}>
              清理全部可清（{cleanable} 个）
            </button>
          </div>
        )}
        <div className="history-split">
          <div className="history-list b3-list b3-list--background history-list-left">
            {loading && <div className="ln-empty">加载中…</div>}
            {!loading && tab === "history" && history.length === 0 && <div className="ln-empty">暂无历史快照</div>}
            {!loading && tab === "orphans" && orphans.length === 0 && <div className="ln-empty">没有孤儿文件</div>}
            {!loading && tab === "history" && history.map((h) => {
              const protectedUntil = h.protectedUntil && Date.parse(h.protectedUntil) > Date.now() ? Date.parse(h.protectedUntil as string) : null;
              const label = new Date(h.createdAt).toLocaleString();
              return (
                <div key={h.id} className={`b3-list-item b3-list-item--hide-action ln-row2${inline?.title === label ? " b3-list-item--focus" : ""}`}>
                  <span className="b3-list-item__graphic"><Clock size={14} /></span>
                  <div className="b3-list-item__text ln-row2__main" onClick={() => void previewHistoryInline(h)} title="点击预览快照">
                    <span className="ln-row2__title">{label}</span>
                    <span className="ln-row2__meta">{(h.size / 1024).toFixed(1)} KB · {h.refCount} 个资源 · {h.contentHash.slice(0, 8)}</span>
                  </div>
                  {protectedUntil !== null && (
                    <span className="badge badge--warn" title="被远端覆盖时自动保留，保护期内不被自动清理（可手动删除）">
                      冲突保留 · 剩余 {Math.max(1, Math.ceil((protectedUntil - Date.now()) / (24 * 3600 * 1000)))} 天
                    </span>
                  )}
                  <span className="fn__space" />
                  <button className="b3-list-item__action" title="恢复此版本" aria-label="恢复此版本" onClick={() => void restore(h.id)}><RotateCcw size={14} /></button>
                  <button className="b3-list-item__action b3-list-item__action--warning" title="删除快照" aria-label="删除快照" onClick={() => void removeHistory(h.id)}><Trash2 size={14} /></button>
                </div>
              );
            })}
            {!loading && tab === "orphans" && orphans.map((o) => (
              <div key={o.filename} className={`b3-list-item b3-list-item--hide-action${orphanPv?.title === o.filename ? " b3-list-item--focus" : ""}`}>
                <span className="b3-list-item__graphic"><FileText size={14} /></span>
                <span className="b3-list-item__text" onClick={() => void previewOrphanFile(o)} title="点击预览文件">{o.filename}</span>
                {o.protectedByHistory && <span className="badge badge--warn">历史保护</span>}
                <span className="b3-list-item__meta">{(o.size / 1024).toFixed(1)} KB</span>
                <span className="fn__space" />
                {!o.protectedByHistory && (
                  <button className="b3-list-item__action b3-list-item__action--warning" title="清理该文件" aria-label="清理该文件" onClick={() => void cleanOrphan(o.filename)}><Trash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="history-preview-inline">
            {tab === "history" ? (
              inline ? (
                <>
                  <div className="history-preview-inline-title">{inline.title}{inline.size !== undefined ? ` · ${(inline.size / 1024).toFixed(1)} KB` : ""}</div>
                  <div className="history-preview-viewer" ref={previewHostRef} />
                </>
              ) : (
                <div className="ln-empty">选择左侧快照查看内容</div>
              )
            ) : orphanPv ? (
              <>
                <div className="history-preview-inline-title">{orphanPv.title}{orphanPv.size !== undefined ? ` · ${(orphanPv.size / 1024).toFixed(1)} KB` : ""}</div>
                {orphanPv.imageData
                  ? <img className="history-preview-image" src={orphanPv.imageData} alt={orphanPv.title} />
                  : <pre className="history-preview-text">{orphanPv.text ?? ""}</pre>}
              </>
            ) : (
              <div className="ln-empty">选择左侧文件查看预览</div>
            )}
          </div>
        </div>
        <div className="floating-dialog-resize" onPointerDown={floating.startResize} title="拖动调整大小" />
      </section>
    </div>,
    document.body
  );
}
