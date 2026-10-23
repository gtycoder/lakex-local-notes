/**
 * AI 历史对话列表（261023 P1.6）：设备本地会话的列表 + 搜索 + 切回/删除/清空。
 * 表面复用 .mb-sheet / .mb-row / .mb-input / .mb-btn / .mb-iconbtn 原语。
 */
import { useEffect, useRef, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import type { AiConversationMeta } from "../data/aiConversationRepository";
import { pushBackHandler } from "../ui/backStack";
import { confirmMobile } from "../ui/ConfirmDialog";
import { useSwipeToClose } from "../ui/useSwipeToClose";

export interface AiHistorySheetProps {
  open: boolean;
  items: AiConversationMeta[];
  loading: boolean;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

function timeText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AiHistorySheet({ open, items, loading, onQuery, onOpen, onDelete, onClearAll, onClose }: AiHistorySheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useSwipeToClose(sheetRef, onClose, open);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    onQuery("");
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose, onQuery]);
  if (!open) return null;

  return (
    <>
      <div className="mb-scrim" data-prevent-swipe onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="mb-sheet ai-sheet" role="dialog" aria-modal="true" aria-label="历史对话" data-prevent-swipe>
        <div className="mb-sheet__head">
          <span className="mb-sheet__title">历史对话</span>
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onClose}>完成</button>
        </div>
        <div className="ai-sheet__search">
          <span className="mb-input">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="搜索历史对话"
              placeholder="搜索历史对话…"
              value={query}
              onChange={(event) => { setQuery(event.target.value); onQuery(event.target.value); }}
            />
          </span>
        </div>
        <div className="mb-sheet__body ai-sheet__body">
          {loading && items.length === 0 && <div className="mb-empty mb-empty--inset">读取中…</div>}
          {!loading && items.length === 0 && <div className="mb-empty mb-empty--inset">{query.trim() ? "没有匹配的对话" : "还没有历史对话"}</div>}
          {items.map((item) => (
            <button key={item.id} type="button" className="mb-row mb-row--two-line ai-history-row" onClick={() => onOpen(item.id)}>
              <span className="mb-row__main">
                <span className="mb-row__title">{item.title}</span>
                <span className="mb-row__sub">
                  {timeText(item.updatedAt)} · {item.messageCount} 条消息{item.docs.length > 0 ? " · 资料 " + item.docs.map((doc) => "《" + doc.title + "》").join("") : ""}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                className="mb-iconbtn ai-history-row__delete"
                aria-label="删除对话"
                onClick={(event) => { event.stopPropagation(); void confirmMobile({ title: "删除这条对话？", body: "只删除本机保存的这条 AI 对话，不影响笔记与同步。", confirmText: "删除", danger: true }).then((ok) => { if (ok) onDelete(item.id); }); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); event.preventDefault(); onDelete(item.id); } }}
              >
                <Trash2 size={16} />
              </span>
            </button>
          ))}
        </div>
        <div className="ai-sheet__foot">
          <span className="ai-budget">共 <b>{items.length}</b> 条 · 仅本机 · 最多保留 50 条 / 30 天</span>
          {items.length > 0 && (
            <button type="button" className="mb-btn mb-btn--ghost mb-btn--danger" onClick={() => {
              void confirmMobile({ title: "清空全部历史对话？", body: "只删除本机保存的 AI 对话，不影响笔记与同步。", confirmText: "清空", danger: true }).then((ok) => { if (ok) onClearAll(); });
            }}>清空全部</button>
          )}
        </div>
      </div>
    </>
  );
}
