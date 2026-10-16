/**
 * 文档属性弹窗（目录右键 →「属性」）。
 * 第一部分：位置/创建/更新/字数/大小/状态（两列并排，省纵向空间）。
 * 第二部分：文件位置（打开文件位置 / 打开附件文件夹 / 复制 ID）+ 路径 + ID。
 * 第三部分：附件网格（高度受限可滚，避免附件过多撑破布局）；第四部分：历史版本（同一处理 + 内联快照预览）。
 * 动作复用 native.*；父级路径可点击跳转目录。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog } from "./ui/Overlay";
import { Box, ChevronRight, Clock, File, FolderOpen, History, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import type { NoteInfo } from "../lib/types";
import { isMobileEnvironment } from "../features/editor/clipboardHtml";
import { HistorySnapshotPreview } from "./HistorySnapshotPreview";
import { useHistorySnapshotViewer } from "./useHistorySnapshotViewer";
import type { NoteKind } from "../core/noteKind.js";
import { formatNoteInfoSize, formatNoteInfoTime, noteInfoRows } from "../core/noteInfo.js";

/** 附件/历史条目的渲染上限（超出提示 +N，避免超大文档一次性渲染成千上万节点）。 */
const ITEM_LIMIT = 200;
const THUMB_LIMIT = 24;

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
  const [histPreview, setHistPreview] = useState<{ id: number; kind: NoteKind; html: string } | null>(null);
  const [histLoading, setHistLoading] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);

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
    if (!note.noteFileId) return;
    void native.openAttachment(note.noteFileId, filename)
      .then((result) => { if (!result.ok) setError(result.error || "打开附件失败"); })
      .catch((reason) => setError(getNativeErrorMessage(reason)));
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
      .then((p) => setHistPreview(p ? { id, kind: p.kind, html: p.html } : null))
      .catch(() => setHistPreview(null))
      .finally(() => setHistLoading(null));
  };

  // 内联快照预览：doc 走只读 Lake viewer（与 HistoryPanel 同一套：**同实例复用**，切快照只 setDocument）；
  // sheet/bitable/board 的正文是内部 JSON ⇒ 由只读编辑器预览渲染（见下方 JSX）。
  // 原 dangerouslySetInnerHTML 直接注入快照原始 lake 正文（可能来自 S3 同步/他端/导入），
  // 是未消毒 HTML 的 XSS 面。viewer 由内核渲染，快照正文只作为文档数据处理，不进 innerHTML。
  useHistorySnapshotViewer({
    hostRef: previewHostRef,
    noteId: histPreview?.kind === "doc" ? note.noteFileId : null,
    body: histPreview?.kind === "doc" ? histPreview.html : null,
    // 移动端无内部滚动容器，必须禁用虚拟渲染（同 DocumentEditor），否则正文渲染不全
    prefs: isMobileEnvironment()
      ? { disableNativeToc: true, disableVirtualRendering: true, showToolbar: false }
      : { disableNativeToc: true },
    // 快照正文异常：预览留白即可，非关键路径
    onError: () => undefined,
  });

  // 主清单来自 core（两端同一份，见 core/noteInfo.ts）——改「属性显示什么」只改那一处
  const cells: Array<[string, string]> = info ? noteInfoRows(info) : [];

  // Portal 到 body：侧栏/工作区可能形成堆叠上下文，挂到 body 才能保证弹窗在目录之上（与 ContextMenu/DesktopOverlays 同款做法）。
  return (
    <Dialog open onDismiss={onClose} label="文档属性" className="note-info-dialog" style={size ? { width: size.w, height: size.h } : undefined}>
        <header className="ln-dialog__head">
          <File size={16} />
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
              <div className="note-info-section-title"><Paperclip size={14} /><span>附件 {info.assets.length} 个 · {formatNoteInfoSize(info.assetTotalBytes)}</span></div>
              {info.assets.length === 0 ? <p className="note-info-empty">无附件</p> : (
                <div className="note-info-assets">
                  {info.assets.slice(0, ITEM_LIMIT).map((a) => (
                    <button key={a.filename} className="note-info-asset" onClick={() => openAsset(a.filename)} title={`${a.filename}（${formatNoteInfoSize(a.size)}）`}>
                      {thumbs[a.filename]
                        ? <img className="ln-imgfill" src={thumbs[a.filename]} alt={a.filename} loading="lazy" />
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
                        <Clock size={13} /><span>{formatNoteInfoTime(h.createdAt)}</span><em>{formatNoteInfoSize(h.size)}</em>
                        {info.contentHash !== "" && h.contentHash === info.contentHash && (
                          <span className="badge badge--accent" title="正文与当前已保存版本一致">当前</span>
                        )}
                        <span className="note-info-history-hint">{histLoading === h.id ? "加载中…" : histPreview?.id === h.id ? "收起" : "预览"}</span>
                      </button>
                    </li>
                  ))}
                  {info.history.length > ITEM_LIMIT && <li className="note-info-history-more"><span>还有 {info.history.length - ITEM_LIMIT} 个…</span></li>}
                </ul>
              )}
              {histPreview && (
                histPreview.kind === "doc"
                  ? <div className="note-info-history-viewer" ref={previewHostRef} />
                  : <HistorySnapshotPreview kind={histPreview.kind} noteId={note.noteFileId ?? ""} body={histPreview.html} snapshotId={histPreview.id} />
              )}
            </div>
          </div>
        )}
        <span className="ln-dialog__resize" onPointerDown={onResizeStart} aria-hidden="true" />
    </Dialog>
  );
}
