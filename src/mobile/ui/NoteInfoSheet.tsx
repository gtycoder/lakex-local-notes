/**
 * 移动端「文档属性」底部抽屉 —— 桌面 `components/NoteInfoDialog` 的移动端对应物。
 *
 * 为什么单独做（261009）：桌面那个弹窗会经 `HistorySnapshotPreview` 懒加载**桌面**编辑器
 * （`UniverSheetEditor` / `BitableEditor` / `BoardEditor`）⇒ 既把桌面实现打进移动端包，
 * 又会在移动端挂桌面编辑器（绑桌面资源端口 / IPC）。移动端口径：非 doc 的历史快照预览「暂不支持」，
 * 本抽屉只做**信息展示 + 入口**：基本信息 / 位置 / 文档 ID / 附件（可点开）/ 历史版本（跳移动端历史）。
 * 数据与动作复用 `native.*`（移动端 bridge 已实现 getNoteInfo / openAttachment）。
 */
import { useEffect, useState } from "react";
import { Copy, History, Paperclip, X } from "lucide-react";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { NoteInfo } from "../../lib/types";
import { showToast } from "./toastBus";

/** 附件/历史条目的渲染上限（与桌面同口径，避免超大文档一次性渲染过多节点）。 */
const ITEM_LIMIT = 100;

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

export interface NoteInfoSheetProps {
  noteFileId: string | null;
  title: string;
  onClose: () => void;
  /** 跳移动端自己的历史版本面板（本抽屉不做内联预览）。 */
  onOpenHistory: () => void;
}

export function NoteInfoSheet({ noteFileId, title, onClose, onOpenHistory }: NoteInfoSheetProps) {
  const [info, setInfo] = useState<NoteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!noteFileId) return;
    native.getNoteInfo(noteFileId)
      .then((data) => { if (alive) setInfo(data); })
      .catch((reason) => { if (alive) setError(getNativeErrorMessage(reason)); });
    return () => { alive = false; };
  }, [noteFileId]);

  const copyId = (): void => {
    if (!info) return;
    void navigator.clipboard?.writeText(info.id)
      .then(() => showToast("已复制文档 ID"))
      .catch(() => showToast("复制失败"));
  };

  const openAsset = (filename: string): void => {
    if (!noteFileId) return;
    void native.openAttachment(noteFileId, filename)
      .then((result) => { if (!result.ok) showToast(result.error || "打开附件失败"); })
      .catch((reason) => showToast(getNativeErrorMessage(reason)));
  };

  const rows: Array<[string, string]> = info ? [
    ["创建", fmtTime(info.createdAt)],
    ["更新", fmtTime(info.updatedAt)],
    ["字数", `${info.wordCount} 字 · ${info.charCount} 字符`],
    ["大小", fmtSize(info.sizeBytes)],
    ["状态", `${SYNC_LABEL[info.syncState] ?? info.syncState}${info.isConflict ? " · 有冲突副本" : ""}${info.isLocked ? " · 已锁定" : ""}`],
  ] : [];

  return (
    <div className="mb-scrim" onClick={onClose}>
      <div className="mb-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sheet__grab" />
        <div className="mb-sheet__head">
          <span className="mb-sheet__title mb-ellipsis">{info?.title || title || "文档属性"}</span>
          <button className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="mb-sheet__body">
          {error && <p className="mb-sheet__empty">{error}</p>}
          {!info && !error && <p className="mb-sheet__empty">读取中…</p>}
          {info && (
            <div className="minfo">
              <dl className="minfo-rows">
                {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
              </dl>

              <div className="minfo-section">
                <div className="minfo-title"><Copy size={14} /><span>文档 ID</span>
                  <button className="minfo-action" onClick={copyId}>复制</button>
                </div>
                <div className="minfo-path">{info.id}</div>
              </div>

              {info.parentPath !== "" && (
                <div className="minfo-section">
                  <div className="minfo-title"><span>位置</span></div>
                  <div className="minfo-path">{info.parentPath}</div>
                </div>
              )}

              <div className="minfo-section">
                <div className="minfo-title"><Paperclip size={14} /><span>附件 {info.assets.length} 个 · {fmtSize(info.assetTotalBytes)}</span></div>
                {info.assets.length === 0 ? <p className="minfo-empty">无附件</p> : (
                  <ul className="minfo-list">
                    {info.assets.slice(0, ITEM_LIMIT).map((a) => (
                      <li key={a.filename}>
                        <button className="minfo-row" onClick={() => openAsset(a.filename)} title={a.filename}>
                          <span className="mb-ellipsis">{a.filename}</span><em>{fmtSize(a.size)}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="minfo-section">
                <div className="minfo-title"><History size={14} /><span>历史版本 {info.history.length} 个</span>
                  <button className="minfo-action" onClick={onOpenHistory}>打开历史版本</button>
                </div>
                {info.history.length === 0 ? <p className="minfo-empty">暂无历史快照</p> : (
                  <ul className="minfo-list">
                    {info.history.slice(0, ITEM_LIMIT).map((h) => (
                      <li key={h.id}><div className="minfo-row"><span>{fmtTime(h.createdAt)}</span><em>{fmtSize(h.size)}</em></div></li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NoteInfoSheet;
