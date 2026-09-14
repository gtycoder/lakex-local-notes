/**
 * 文档属性弹窗（目录右键 →「属性」）。
 * 第一部分：位置/创建/更新/字数/大小/状态（两列并排，省纵向空间）。
 * 第二部分：文件位置（打开文件位置 / 打开附件文件夹 / 复制 ID）+ 路径 + ID。
 * 第三部分：附件网格（高度受限可滚，避免附件过多撑破布局）；第四部分：历史版本（同一处理 + 内联快照预览）。
 * 动作复用 native.*；父级路径可点击跳转目录。
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Box, ChevronRight, Clock, Copy, FileText, FolderOpen, History, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import type { NoteInfo } from "../lib/types";

/** 附件/历史条目的渲染上限（超出提示 +N，避免超大文档一次性渲染成千上万节点）。 */
const ITEM_LIMIT = 200;
const THUMB_LIMIT = 24;

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

const SYNC_LABEL: Record<string, string> = { local: "未同步", synced: "已同步", conflict: "冲突" };

/** 桌面传 TreeNode 子集；移动端传 { noteFileId: id, title }，与平台解耦。 */
export function NoteInfoDialog({ note, onClose, onRevealNoteFile, onOpenAssetsDir, onOpenHistory, onJumpToNode }: {
  note: { noteFileId: string | null; title: string };
  onClose: () => void;
  /** 桌面：在文件管理器中显示 .lake；移动端不传则不渲染 */
  onRevealNoteFile?: () => void;
  /** 桌面：打开附件文件夹；移动端不传则不渲染 */
  onOpenAssetsDir?: () => void;
  onOpenHistory: () => void;
  /** 父级路径点击跳转；不传则路径只读展示 */
  onJumpToNode?: (id: string) => void;
}) {
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [histPreview, setHistPreview] = useState<{ id: number; html: string } | null>(null);
  const [histLoading, setHistLoading] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  /** 右下角拖拽调整弹窗大小（默认尺寸见 .note-info-dialog）。 */
  const onResizeStart = (event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault();
    const rect = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = rect?.width ?? 720;
    const startH = rect?.height ?? 640;
    const onMove = (ev: PointerEvent): void => {
      setSize({
        w: Math.max(420, Math.min(window.innerWidth * 0.94, startW + ev.clientX - startX)),
        h: Math.max(320, Math.min(window.innerHeight * 0.9, startH + ev.clientY - startY)),
      });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    let alive = true;
    if (!note.noteFileId) return;
    native.getNoteInfo(note.noteFileId).then((data) => { if (alive) setInfo(data); }).catch((reason) => { if (alive) setError(getNativeErrorMessage(reason)); });
    return () => { alive = false; };
  }, [note.noteFileId]);

  useEffect(() => {
    let alive = true;
    if (!info || !note.noteFileId) return;
    const images = info.assets.filter((a) => a.kind === "image").slice(0, THUMB_LIMIT);
    void Promise.all(images.map(async (a) => {
      try {
        const res = await native.readAssetPreview(note.noteFileId as string, a.filename);
        return res.supported && res.dataUrl ? [a.filename, res.dataUrl] as const : null;
      } catch { return null; }
    })).then((pairs) => {
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const p of pairs) if (p) next[p[0]] = p[1];
      setThumbs(next);
    });
    return () => { alive = false; };
  }, [info, note.noteFileId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openAsset = (filename: string): void => {
    if (note.noteFileId) void native.openAttachment(note.noteFileId, filename);
  };

  const copyId = (): void => {
    setInfo((current) => {
      if (current) void navigator.clipboard.writeText(current.id).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }).catch(() => undefined);
      return current;
    });
  };

  const toggleHistory = (id: number): void => {
    if (histPreview?.id === id) { setHistPreview(null); return; }
    setHistLoading(id);
    native.previewHistorySnapshot(id)
      .then((p) => setHistPreview(p ? { id, html: p.html } : null))
      .catch(() => setHistPreview(null))
      .finally(() => setHistLoading(null));
  };

  const cells: Array<[string, string]> = info ? [
    ["创建", fmtTime(info.createdAt)],
    ["更新", fmtTime(info.updatedAt)],
    ["字数", `${info.wordCount} 字 · ${info.charCount} 字符`],
    ["大小", fmtSize(info.sizeBytes)],
    ["状态", `${SYNC_LABEL[info.syncState] ?? info.syncState}${info.isConflict ? " · 有冲突副本" : ""}${info.isLocked ? " · 已锁定" : ""}`],
  ] : [];

  // Portal 到 body：侧栏/工作区可能形成堆叠上下文，挂到 body 才能保证弹窗在目录之上（与 ContextMenu/DesktopOverlays 同款做法）。
  return createPortal(
    <div className="modal-backdrop" data-prevent-swipe onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="ln-dialog note-info-dialog" data-prevent-swipe style={size ? { width: size.w, height: size.h } : undefined} role="dialog" aria-modal="true" aria-label="文档属性">
        <header className="ln-dialog__head">
          <FileText size={16} />
          <h3 className="ln-dialog__title" title={info?.title ?? note.title}>{info?.title ?? note.title}</h3>
          <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        {error && <p className="note-info-error">{error}</p>}
        {!info && !error && <p className="note-info-empty">读取中…</p>}
        {info && (
          <div className="ln-dialog__body">
            {/* 第一部分：基本信息（两列并排） */}
            <dl className="note-info-grid">
              <div className="note-info-cell note-info-cell--wide">
                <dt>位置</dt>
                <dd className="note-info-breadcrumb">
                  {info.parents.length === 0
                    ? <span className="note-info-crumb is-current">根目录</span>
                    : info.parents.map((p, i) => (
                      <span key={p.id} className="note-info-crumb-wrap">
                        {i > 0 && <ChevronRight size={12} className="note-info-crumb-sep" />}
                        {onJumpToNode
                          ? <button className="note-info-crumb" onClick={() => onJumpToNode(p.id)}>{p.title}</button>
                          : <span className="note-info-crumb is-current">{p.title}</span>}
                      </span>
                    ))}
                </dd>
              </div>
              {cells.map(([k, v]) => (
                <div key={k} className="note-info-cell"><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>

            {info.cardStats.length > 0 && (
              <div className="note-info-section">
                <div className="note-info-section-title"><Box size={14} /><span>内容统计</span></div>
                <div className="note-info-stats">
                  {info.cardStats.map((s) => (<span key={s.key} className="note-info-stat"><em>{s.label}</em>{s.count}</span>))}
                </div>
              </div>
            )}

            {/* 第二部分：文件位置（动作按钮放标题右侧，与历史版本同款式；ID 不再单独展示——路径里已含） */}
            <div className="note-info-section">
              <div className="note-info-section-title">
                <FolderOpen size={14} /><span>文件位置</span>
                <div className="note-info-actions">
                  {onRevealNoteFile && <button className="b3-button b3-button--outline" onClick={onRevealNoteFile}>打开文件位置</button>}
                  {onOpenAssetsDir && <button className="b3-button b3-button--outline" onClick={onOpenAssetsDir}>打开附件文件夹</button>}
                  <button className="b3-button b3-button--outline" onClick={copyId}>{copied ? "已复制" : "复制 ID"}</button>
                </div>
              </div>
              <div className="note-info-path" title={info.lakePath}>{info.lakePath}</div>
              {info.assetsDir && <div className="note-info-path" title={info.assetsDir}>{info.assetsDir}</div>}
            </div>

            {/* 第三部分：附件（高度受限，可滚；附件过多不会撑破布局） */}
            <div className="note-info-section">
              <div className="note-info-section-title"><Paperclip size={14} /><span>附件 {info.assets.length} 个 · {fmtSize(info.assetTotalBytes)}</span></div>
              {info.assets.length === 0 ? <p className="note-info-empty">无附件</p> : (
                <div className="note-info-assets">
                  {info.assets.slice(0, ITEM_LIMIT).map((a) => (
                    <button key={a.filename} className="note-info-asset" onClick={() => openAsset(a.filename)} title={`${a.filename}（${fmtSize(a.size)}）`}>
                      {thumbs[a.filename]
                        ? <img src={thumbs[a.filename]} alt={a.filename} loading="lazy" />
                        : <span className="note-info-asset-glyph">{a.kind === "image" ? <ImageIcon size={16} /> : a.kind === "video" || a.kind === "audio" ? <Box size={16} /> : <Paperclip size={16} />}</span>}
                    </button>
                  ))}
                  {info.assets.length > ITEM_LIMIT && <span className="note-info-asset-more">+{info.assets.length - ITEM_LIMIT}</span>}
                </div>
              )}
            </div>

            {/* 第四部分：历史版本（同一滚动约束 + 内联快照预览） */}
            <div className="note-info-section">
              <div className="note-info-section-title"><History size={14} /><span>历史版本 {info.history.length} 个</span>
                <button className="b3-button b3-button--outline" onClick={onOpenHistory}>打开历史版本</button>
              </div>
              {info.history.length === 0 ? <p className="note-info-empty">暂无历史快照</p> : (
                <ul className="note-info-history">
                  {info.history.slice(0, ITEM_LIMIT).map((h) => (
                    <li key={h.id}>
                      <button className={"note-info-history-row" + (histPreview?.id === h.id ? " is-active" : "")} onClick={() => toggleHistory(h.id)}>
                        <Clock size={13} /><span>{fmtTime(h.createdAt)}</span><em>{fmtSize(h.size)}</em>
                        <span className="note-info-history-hint">{histLoading === h.id ? "加载中…" : histPreview?.id === h.id ? "收起" : "预览"}</span>
                      </button>
                    </li>
                  ))}
                  {info.history.length > ITEM_LIMIT && <li className="note-info-history-more"><span>还有 {info.history.length - ITEM_LIMIT} 个…</span></li>}
                </ul>
              )}
              {histPreview && (
                <div className="note-info-history-preview" dangerouslySetInnerHTML={{ __html: histPreview.html }} />
              )}
            </div>
          </div>
        )}
        <span className="ln-dialog__resize" onPointerDown={onResizeStart} aria-hidden="true" />
      </section>
    </div>,
    document.body
  );
}
