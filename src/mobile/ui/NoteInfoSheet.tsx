/**
 * 移动端「文档属性」底部抽屉 —— 桌面 `components/app/NoteInfoDialog` 的移动端对应物。
 *
 * 为什么单独做（261009）：桌面那个弹窗会经 `HistorySnapshotPreview` 懒加载**桌面**编辑器
 * （`UniverSheetEditor` / `BitableEditor` / `BoardEditor`）⇒ 既把桌面实现打进移动端包，
 * 又会在移动端挂桌面编辑器（绑桌面资源端口 / IPC）。移动端口径：非 doc 的历史快照预览「暂不支持」，
 * 本抽屉只做**信息展示 + 入口**：基本信息 / 位置 / 文档 ID / 附件（可点开）/ 历史版本（跳移动端历史）。
 * 数据与动作复用 `native.*`（移动端 bridge 已实现 getNoteInfo / openAttachment）。
 */
import { useEffect, useState } from "react";
import { Copy, History, Paperclip, Tag } from "lucide-react";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { NoteInfo } from "../../lib/types";
import { showToast } from "./toastBus";
import { MobileSheet } from "./MobileSheet";
import { formatNoteInfoSize, formatNoteInfoTime, noteInfoRows } from "../../core/noteInfo.js";
import { bridge } from "../bridge";
import { loadNoteTagIdsForNotes } from "../bridge/noteTagReads";
import { resolveDocTagChips, type DocTagChipView } from "./docTagChips";
import { EmptyState } from "./EmptyState";

/** 附件/历史条目的渲染上限。**比桌面更小**（桌面 200）：移动端一次渲染过多节点更伤滚动；
 *  不是"与桌面同口径"——原注释这么写是错的，261016 顺手改正。 */
const ITEM_LIMIT = 100;

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
  /**
   * 文档标签（261105 P1，**只读**）：关系从 noteTagReads.loadNoteTagIdsForNotes 读，名称由标签目录解析。
   * 目录里没有的 id 不展示（只给一句降级提示）；标签读取失败不影响属性其余部分，也不提供编辑入口。
   */
  const [tagView, setTagView] = useState<DocTagChipView | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!noteFileId) { setTagView(null); setTagError(null); return () => { alive = false; }; }
    setTagView(null);
    setTagError(null);
    void Promise.all([loadNoteTagIdsForNotes([noteFileId]), bridge.listQuickNoteTags()])
      .then(([read, directory]) => {
        if (!alive) return;
        setTagView(resolveDocTagChips(read.byNoteId[noteFileId] ?? [], directory));
      })
      .catch((reason) => { if (alive) setTagError(getNativeErrorMessage(reason)); });
    return () => { alive = false; };
  }, [noteFileId]);

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

  // 主清单来自 core（与桌面同一份，见 core/noteInfo.ts）——两端"属性显示什么"从此不可能漂移
  const rows: Array<[string, string]> = info ? noteInfoRows(info) : [];

  return (
    // MOB-11：scrim / 右滑关闭 / 返回栈 / 焦点与滚动锁统一由 MobileSheet 负责
    //（本抽屉此前漏了返回栈：打开后按返回键会落到父层「退工作区」）。类名/结构与手写版一致。
    <MobileSheet
      open
      title={info?.title || title || "文档属性"}
      titleClassName="mb-ellipsis"
      ariaLabel={info?.title || title || "文档属性"}
      onClose={onClose}
    >
      {error && <EmptyState inset>{error}</EmptyState>}
      {!info && !error && <EmptyState inset>读取中…</EmptyState>}
      {info && (
        <div className="minfo">
          <dl className="minfo-rows">
            {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
          </dl>

          {/* 文档标签（261105 P1）：只读 chips；编辑入口不做（标签编辑回桌面版）。
              P2-D：读取期间给加载态占位（否则 chips 出现时整块插入会把下方内容顶一下）。 */}
          {noteFileId !== null && (tagError !== null || tagView === null || tagView.chips.length > 0) && (
            <div className="minfo-section" aria-busy={tagView === null && tagError === null}>
              <div className="minfo-title"><Tag size={14} /><span>标签{tagView && tagView.chips.length > 0 ? " " + tagView.chips.length : ""}</span></div>
              {tagView === null && tagError === null && <p className="minfo-empty">读取中…</p>}
              {tagView && tagView.chips.length > 0 && (
                <div role="list" aria-label="文档标签（只读）">
                  {tagView.chips.map((tag) => (<span className="mb-tag" key={tag.id} role="listitem">{tag.name}</span>))}
                </div>
              )}
              {tagView && tagView.unresolved > 0 && (
                <p className="minfo-empty">另有 {tagView.unresolved} 个标签不在本机目录中（可能已在他端删除或尚未同步），已隐藏。</p>
              )}
              {tagError && <p className="minfo-empty">标签信息暂不可用：{tagError}</p>}
            </div>
          )}

          <div className="minfo-section">
            <div className="minfo-title"><Copy size={14} /><span>文档 ID</span>
              <button className="mb-btn mb-btn--secondary mb-btn--sm minfo-action" onClick={copyId}>复制</button>
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
            <div className="minfo-title"><Paperclip size={14} /><span>附件 {info.assets.length} 个，{formatNoteInfoSize(info.assetTotalBytes)}</span></div>
            {info.assets.length === 0 ? <p className="minfo-empty">无附件</p> : (
              <ul className="minfo-list">
                {info.assets.slice(0, ITEM_LIMIT).map((a) => (
                  <li key={a.filename}>
                    <button className="minfo-row" onClick={() => openAsset(a.filename)} title={a.filename}>
                      <span className="mb-ellipsis">{a.filename}</span><em>{formatNoteInfoSize(a.size)}</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="minfo-section">
            <div className="minfo-title"><History size={14} /><span>历史版本 {info.history.length} 个</span>
              <button className="mb-btn mb-btn--secondary mb-btn--sm minfo-action" onClick={onOpenHistory}>打开历史版本</button>
            </div>
            {info.history.length === 0 ? <p className="minfo-empty">暂无历史快照</p> : (
              <ul className="minfo-list">
                {info.history.slice(0, ITEM_LIMIT).map((h) => (
                  <li key={h.id}><div className="minfo-row"><span>{formatNoteInfoTime(h.createdAt)}</span><em>{formatNoteInfoSize(h.size)}</em></div></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </MobileSheet>
  );
}

export default NoteInfoSheet;
