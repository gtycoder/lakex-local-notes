import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Overlay";
import { Camera, Clock, File, History, RotateCcw, Trash, X } from "lucide-react";
import { native } from "../../lib/native";
import { createRequestVersion } from "../../core/requestVersion";
import { useFloatingDialog } from "../hooks/useFloatingDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { DialogResizeHandles } from "../ui/DialogResizeHandles";
import { SplitPane } from "../ui/SplitPane";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { useHistorySnapshotViewer } from "../hooks/useHistorySnapshotViewer";
import { HistorySnapshotPreview } from "./HistorySnapshotPreview";
import type { NoteKind } from "../../core/noteKind";
import { formatDateTime } from "../../lib/formatTime";

export interface HistoryItem {
  id: number; createdAt: string; size: number; contentHash: string; refCount: number; filePath: string; protectedUntil: string | null;
  kind: NoteKind;
}

/**
 * 预热预览分包：与 MultiTabEditor / HistorySnapshotPreview 共用同一份动态 import
 * ⇒ 第一次点快照不再等分包加载（第二次起本来就有缓存）。
 */
function prefetchPreviewChunk(kind: NoteKind): void {
  if (kind === "usheet") void import("../../features/usheet/UniverSheetEditor");
  else if (kind === "bitable") void import("../../features/bitable/BitableEditor");
  else if (kind === "board") void import("../../features/board/BoardEditor");
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
  const [orphanSel, setOrphanSel] = useState<string | null>(null);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [orphanPv, setOrphanPv] = useState<{
    title: string;
    text?: string;
    imageData?: string;
    size?: number;
  } | null>(null);
  const [inline, setInline] = useState<{ id: number; title: string; kind: NoteKind; html: string; size?: number } | null>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** 当前正文（已落盘那份）的 hash：用来标出"与当前版本一致"的快照。 */
  const [currentHash, setCurrentHash] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !noteId) {
      setCurrentHash(null);
      return;
    }
    let alive = true;
    native.getNoteInfo(noteId)
      .then((info) => { if (alive) setCurrentHash(info.contentHash || null); })
      .catch(() => { if (alive) setCurrentHash(null); });
    return () => { alive = false; };
  }, [open, noteId]);

  /** ↑/↓ 切换快照（连续比对版本时少点很多次）。只改列表自己的 scrollTop —— 不用 scrollIntoView（它会滚所有祖先）。 */
  const moveSelection = (delta: number) => {
    if (history.length === 0) return;
    const index = inline ? history.findIndex((h) => h.id === inline.id) : -1;
    const next = index < 0
      ? (delta > 0 ? 0 : history.length - 1)
      : Math.min(history.length - 1, Math.max(0, index + delta));
    const target = history[next];
    if (!target) return;
    void previewHistoryInline(target);
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-history-id="${target.id}"]`);
    if (!list || !row) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
    else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
  };
  const floating = useFloatingDialog({ id: "history", initialSize: { w: 900, h: 640 }, minSize: { w: 680, h: 440 } });
  /** 确认浮层（DT-02）：替代 window.confirm（恢复历史版本会覆盖当前正文）。 */
  const { confirm, confirmElement } = useConfirm();
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
      // 预热预览分包（同一篇文档的所有快照同类型）：第一次点快照不再等动态 import
      prefetchPreviewChunk(nextHistory[0]?.kind ?? "doc");
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
      setOrphanSel(null);
      setOrphanLoading(false);
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
    if (!(await confirm({
      title: "恢复这个历史版本？",
      body: "会覆盖当前内容（含只读/锁定文档）；当前版本会先存入历史快照。",
      confirmText: "恢复",
    }))) return;
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
      if (r) setInline({ id: h.id, title: formatDateTime(h.createdAt, true), kind: r.kind, html: r.html, size: h.size });
      else setError("快照预览失败（文件可能已删除）");
    } catch (e) {
      if (previewVersionRef.current.isCurrent(version)) setError(getNativeErrorMessage(e));
    }
  };

  // doc 快照：只读 Lake viewer，**同一实例复用**（切快照只 setDocument，不再重建整个内核）；
  // sheet/bitable/board 的正文是内部 JSON ⇒ 由 <HistorySnapshotPreview> 挂只读编辑器预览。
  useHistorySnapshotViewer({
    hostRef: previewHostRef,
    noteId: inline?.kind === "doc" ? noteId : null,
    body: inline?.kind === "doc" ? inline.html : null,
    onError: (message) => setError(message || "快照预览失败"),
  });

  /** 预览孤儿文件：与设置-资源同口径 —— 不清空上一张已解码的图，新图解码完再替换，
   *  否则预览区会先塌成提示文本再撑开（实测跳动 190px 量级 = 用户看到的"闪一下"）。 */
  const previewOrphanFile = async (o: NoteOrphan) => {
    if (!noteId) return;
    const version = previewVersionRef.current.next();
    setOrphanSel(o.filename);
    setOrphanLoading(true);
    try {
      const r = await native.previewNoteOrphan(noteId, o.filename);
      if (!previewVersionRef.current.isCurrent(version)) return;
      if (!r) { setError("文件预览失败（文件可能已删除）"); setOrphanLoading(false); return; }
      const next = r.kind === "image"
        ? { title: o.filename, imageData: r.data, size: r.size }
        : { title: o.filename, text: r.data, size: r.size };
      if (next.imageData) {
        const img = new Image();
        img.src = next.imageData;
        try { await img.decode(); } catch { /* 解码失败交给 <img> 自己表现 */ }
        if (!previewVersionRef.current.isCurrent(version)) return;
      }
      setOrphanPv(next);
      setOrphanLoading(false);
    } catch (e) {
      if (previewVersionRef.current.isCurrent(version)) { setError(getNativeErrorMessage(e)); setOrphanLoading(false); }
    }
  };

  const cleanable = orphans.filter((o) => !o.protectedByHistory).length;

  if (!open || !noteId) return null;
  return (
    <Dialog
      open
      onDismiss={() => { if (!floating.interactionRef.current) onClose(); }}
      label="历史版本"
      surfaceClassName="floating-dialog history-panel"
      style={floating.panelStyle}
      surfaceRef={floating.panelRef}
    >
        <header className="floating-dialog-header" onPointerDown={floating.startDrag}>
          <div className="panel-title">
            <History size={16} />
            <h2>历史版本</h2>
          </div>
          <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        {/* 页签走 kit 层原语（.ln-tabs：墨线 + 计数徽标）；右侧动作走原语的 .ln-tabs__action */}
        <div className="ln-tabs">
          <div className="ln-tabs__track" role="tablist" aria-label="历史版本">
            <button type="button" role="tab" aria-selected={tab === "history"} className={`ln-tabs__item${tab === "history" ? " is-active" : ""}`} onClick={() => switchTab("history")}>
              <Clock size={14} /> 文档历史<span className="ln-tabs__count">{history.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === "orphans"} className={`ln-tabs__item${tab === "orphans" ? " is-active" : ""}`} onClick={() => switchTab("orphans")}>
              <Trash size={14} /> 未引用文件<span className="ln-tabs__count">{orphans.length}</span>
            </button>
          </div>
          {tab === "history" && (
            <button className="ln-btn ln-btn--secondary ln-tabs__action" onClick={() => void createSnapshot()} title="手动创建快照">
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
            <span className="ln-toolbar__info">共 {orphans.length} 个，可清理 {cleanable}，受历史保护 {orphans.length - cleanable}</span>
            <button className="ln-btn ln-btn--secondary ln-btn--danger-text" onClick={() => void cleanOrphan()} disabled={cleanable === 0}>
              清理全部可清（{cleanable} 个）
            </button>
          </div>
        )}
        <SplitPane ariaLabel="调整历史列表宽度" storageKey="history" minRight={280}>
          <div
            className="history-list ln-list-panel ln-list-panel--background history-list-left"
            ref={listRef}
            tabIndex={0}
            aria-label="历史快照列表（可用 ↑/↓ 切换）"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); moveSelection(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); moveSelection(-1); }
            }}
          >
            {loading && <div className="ln-empty">加载中…</div>}
            {!loading && tab === "history" && history.length === 0 && <div className="ln-empty">暂无历史快照</div>}
            {!loading && tab === "orphans" && orphans.length === 0 && <div className="ln-empty">没有未引用文件</div>}
            {!loading && tab === "history" && history.map((h) => {
              const protectedUntil = h.protectedUntil && Date.parse(h.protectedUntil) > Date.now() ? Date.parse(h.protectedUntil as string) : null;
              const label = formatDateTime(h.createdAt, true);
              return (
                <div key={h.id} data-history-id={h.id} className={`ln-list-item ln-list-item--hide-action ln-row2${inline?.title === label ? " ln-list-item--focus" : ""}`}>
                  <span className="ln-list-item__graphic"><Clock size={14} /></span>
                  <div className="ln-list-item__text ln-row2__main" onClick={() => void previewHistoryInline(h)} title="点击预览快照">
                    <span className="ln-row2__title">{label}</span>
                    <span className="ln-row2__meta">{(h.size / 1024).toFixed(1)} KB，{h.refCount} 个资源，{h.contentHash.slice(0, 8)}</span>
                  </div>
                  {currentHash !== null && h.contentHash === currentHash && (
                    <span className="badge badge--accent" title="正文与当前已保存版本一致">当前</span>
                  )}
                  {protectedUntil !== null && (
                    <span className="badge badge--warn" title="被远端覆盖时自动保留，保护期内不被自动清理（可手动删除）">
                      冲突保留，剩余 {Math.max(1, Math.ceil((protectedUntil - Date.now()) / (24 * 3600 * 1000)))} 天
                    </span>
                  )}
                  <span className="ln-spacer" />
                  <button className="ln-list-item__action" title="恢复此版本" aria-label="恢复此版本" onClick={() => void restore(h.id)}><RotateCcw size={14} /></button>
                  <button className="ln-list-item__action ln-list-item__action--warning" title="删除快照" aria-label="删除快照" onClick={() => void removeHistory(h.id)}><Trash size={14} /></button>
                </div>
              );
            })}
            {!loading && tab === "orphans" && orphans.map((o) => (
              <div key={o.filename} className={`ln-list-item ln-list-item--hide-action${orphanSel === o.filename ? " ln-list-item--focus" : ""}`}>
                <span className="ln-list-item__graphic"><File size={14} /></span>
                <span className="ln-list-item__text ln-ellipsis" onClick={() => void previewOrphanFile(o)} title="点击预览文件">{o.filename}</span>
                {o.protectedByHistory && <span className="badge badge--warn">历史保护</span>}
                <span className="ln-list-item__meta">{(o.size / 1024).toFixed(1)} KB</span>
                <span className="ln-spacer" />
                {!o.protectedByHistory && (
                  <button className="ln-list-item__action ln-list-item__action--warning" title="清理该文件" aria-label="清理该文件" onClick={() => void cleanOrphan(o.filename)}><Trash size={14} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="history-preview-inline">
            {tab === "history" ? (
              inline ? (
                <>
                  <div className="history-preview-inline-title">{inline.title}{inline.size !== undefined ? `，${(inline.size / 1024).toFixed(1)} KB` : ""}</div>
                  {inline.kind === "doc"
                    ? <div className="history-preview-viewer" ref={previewHostRef} />
                    : <HistorySnapshotPreview kind={inline.kind} noteId={noteId} body={inline.html} snapshotId={inline.id} />}
                </>
              ) : (
                <div className="ln-empty">选择左侧快照查看内容</div>
              )
            ) : orphanPv ? (
              <>
                <div className="history-preview-inline-title">
                  {orphanSel ?? orphanPv.title}{orphanPv.size !== undefined ? `，${(orphanPv.size / 1024).toFixed(1)} KB` : ""}{orphanLoading ? "，加载中" : ""}
                </div>
                {orphanPv.imageData
                  ? <img key={orphanPv.title} className={`history-preview-image${orphanLoading ? " is-loading" : ""}`} src={orphanPv.imageData} alt={orphanPv.title} />
                  : <pre className="history-preview-text">{orphanPv.text ?? ""}</pre>}
              </>
            ) : (
              <div className="ln-empty">{orphanLoading ? "加载中…" : "选择左侧文件查看预览"}</div>
            )}
          </div>
        </SplitPane>
        <DialogResizeHandles onResize={floating.startResize} />
        {confirmElement}
    </Dialog>
  );
}
