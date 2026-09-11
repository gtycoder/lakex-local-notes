/**
 * 文档属性弹窗（目录右键 →「属性」）。
 * 展示元数据 / 字数 / 文件位置 / 附件预览 / 历史版本，动作复用 native.*（打开位置、打开附件、历史面板）。
 */
import { useEffect, useState } from "react";
import { Box, Clock, FileText, FolderOpen, History, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import type { NoteInfo, TreeNode } from "../lib/types";

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

export function NoteInfoDialog({ note, onClose, onRevealNoteFile, onOpenHistory }: {
  note: TreeNode;
  onClose: () => void;
  onRevealNoteFile: () => void;
  onOpenHistory: () => void;
}) {
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

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

  const rows: Array<[string, string]> = info ? [
    ["位置", info.parentPath || "根目录"],
    ["创建", fmtTime(info.createdAt)],
    ["更新", fmtTime(info.updatedAt)],
    ["字数", `${info.wordCount} 字 · ${info.charCount} 字符`],
    ["大小", fmtSize(info.sizeBytes)],
    ["状态", `${SYNC_LABEL[info.syncState] ?? info.syncState}${info.isConflict ? " · 有冲突副本" : ""}${info.isLocked ? " · 已锁定" : ""}`],
  ] : [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="note-info-dialog" role="dialog" aria-modal="true" aria-label="文档属性">
        <header className="note-info-head">
          <FileText size={16} />
          <h3 title={info?.title ?? note.title}>{info?.title ?? note.title}</h3>
          <button className="ln-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        {error && <p className="note-info-error">{error}</p>}
        {!info && !error && <p className="note-info-empty">读取中…</p>}
        {info && (
          <div className="note-info-body">
            <dl className="note-info-rows">
              {rows.map(([k, v]) => (<div key={k} className="note-info-row"><dt>{k}</dt><dd>{v}</dd></div>))}
            </dl>

            <div className="note-info-section">
              <div className="note-info-section-title"><FolderOpen size={14} /><span>文件位置</span>
                <button className="b3-button b3-button--outline" onClick={onRevealNoteFile}>打开文件位置</button>
              </div>
              <div className="note-info-path" title={info.lakePath}>{info.lakePath}</div>
              <div className="note-info-path" title={info.assetsDir}>{info.assetsDir}</div>
            </div>

            <div className="note-info-section">
              <div className="note-info-section-title"><Paperclip size={14} /><span>附件 {info.assets.length} 个 · {fmtSize(info.assetTotalBytes)}</span></div>
              {info.assets.length === 0 ? <p className="note-info-empty">无附件</p> : (
                <div className="note-info-assets">
                  {info.assets.slice(0, THUMB_LIMIT).map((a) => (
                    <button key={a.filename} className="note-info-asset" onClick={() => openAsset(a.filename)} title={`${a.filename}（${fmtSize(a.size)}）`}>
                      {thumbs[a.filename]
                        ? <img src={thumbs[a.filename]} alt={a.filename} loading="lazy" />
                        : <span className="note-info-asset-glyph">{a.kind === "image" ? <ImageIcon size={16} /> : a.kind === "video" || a.kind === "audio" ? <Box size={16} /> : <Paperclip size={16} />}</span>}
                    </button>
                  ))}
                  {info.assets.length > THUMB_LIMIT && <span className="note-info-asset-more">+{info.assets.length - THUMB_LIMIT}</span>}
                </div>
              )}
            </div>

            <div className="note-info-section">
              <div className="note-info-section-title"><History size={14} /><span>历史版本 {info.history.length} 个</span>
                <button className="b3-button b3-button--outline" onClick={onOpenHistory}>打开历史版本</button>
              </div>
              {info.history.length === 0 ? <p className="note-info-empty">暂无历史快照</p> : (
                <ul className="note-info-history">
                  {info.history.slice(0, 5).map((h) => (
                    <li key={h.id}><Clock size={13} /><span>{fmtTime(h.createdAt)}</span><em>{fmtSize(h.size)}</em></li>
                  ))}
                  {info.history.length > 5 && <li className="note-info-history-more"><span>还有 {info.history.length - 5} 个…</span></li>}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
