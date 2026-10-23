/**
 * AI 历史对话**独立页面**（261023 P1.7，用户点单：不要抽屉）。
 *
 * 形态：全屏页（层序 = --mobile-z-page + 1，压在 AI 页之上），两级：
 *  · 列表：搜索 + 行（标题/时间/条数/资料）+ 行尾删除 + 顶部「清空」；
 *  · 详情：完整对话流程（用户气泡 + Markdown 回答 + 错误/已停止），可「继续对话」载入当前会话。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, Trash2 } from "lucide-react";
import type { AiConversationMeta } from "../data/aiConversationRepository";
import type { StoredAiConversation } from "./aiConversationPersist";
import { pushBackHandler } from "../ui/backStack";
import { confirmMobile } from "../ui/ConfirmDialog";
import { AiMarkdown } from "./AiMarkdown";

export interface AiHistoryPageProps {
  open: boolean;
  onClose: () => void;
  onList: (query: string) => Promise<AiConversationMeta[]>;
  onDetail: (id: string) => Promise<StoredAiConversation | null>;
  onContinue: (id: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
}

function timeText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AiHistoryPage({ open, onClose, onList, onDetail, onContinue, onDelete, onClearAll }: AiHistoryPageProps) {
  const [items, setItems] = useState<AiConversationMeta[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<StoredAiConversation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listSeq = useRef(0);

  const loadList = useCallback(async (keyword: string) => {
    const seq = ++listSeq.current;
    setLoading(true);
    try {
      const next = await onList(keyword);
      if (seq === listSeq.current) setItems(next);
    } catch {
      if (seq === listSeq.current) setItems([]);
    } finally {
      if (seq === listSeq.current) setLoading(false);
    }
  }, [onList]);

  useEffect(() => {
    if (!open) { setDetail(null); return; }
    setQuery("");
    void loadList("");
  }, [open, loadList]);

  // 返回栈：详情 → 列表 → 关闭
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => {
      if (detail) { setDetail(null); return true; }
      onClose();
      return true;
    });
  }, [open, detail, onClose]);

  useEffect(() => {
    if (detail && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [detail]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const stored = await onDetail(id);
      if (!stored) { setDetail(null); void loadList(query); return; }
      setDetail(stored);
    } finally { setDetailLoading(false); }
  }, [onDetail, loadList, query]);

  if (!open) return null;

  return (
    <div className="mobile-ai-page ai-history-page" role="dialog" aria-modal="true" aria-label="历史对话">
      <header className="toolbar toolbar--border mobile-topbar">
        <button type="button" className="toolbar__button" onClick={() => { if (detail) setDetail(null); else onClose(); }} aria-label="返回"><ArrowLeft size={20} /></button>
        <span className="mobile-topbar-title">{detail ? detail.title : "历史对话"}</span>
        {detail ? (
          <button type="button" className="toolbar__button" onClick={() => {
            void confirmMobile({ title: "删除这条对话？", body: "只删除本机保存的这条 AI 对话，不影响笔记与同步。", confirmText: "删除", danger: true })
              .then((ok) => { if (!ok) return; void onDelete(detail.id).then(() => { setDetail(null); void loadList(""); }); });
          }} aria-label="删除对话"><Trash2 size={20} /></button>
        ) : (
          <button type="button" className="toolbar__button" onClick={() => {
            void confirmMobile({ title: "清空全部历史对话？", body: "只删除本机保存的 AI 对话，不影响笔记与同步。", confirmText: "清空", danger: true })
              .then((ok) => { if (!ok) return; void onClearAll().then(() => setItems([])); });
          }} aria-label="清空全部" disabled={items.length === 0}><Trash2 size={20} /></button>
        )}
      </header>

      {detail ? (
        <>
          <div className="ai-history-meta">
            {timeText(detail.updatedAt)} · {detail.messages.length} 条消息
            {detail.corpus.length > 0 ? " · 资料 " + detail.corpus.map((doc) => "《" + doc.title + "》").join("") : ""}
          </div>
          <div className="ai-body ai-history-body" ref={scrollRef}>
            {detail.messages.map((message, index) => message.role === "user" ? (
              <div key={index} className="ai-msg ai-msg--user">
                <div className="ai-bubble">{message.text}</div>
              </div>
            ) : (
              <div key={index} className="ai-msg">
                {message.error ? <div className="ai-error">{message.error.message}</div> : <AiMarkdown text={message.text} />}
                {message.stopped && <div className="ai-stopped">已停止</div>}
              </div>
            ))}
          </div>
          <div className="ai-history-actions">
            <button type="button" className="mb-btn mb-btn--primary mb-btn--block" onClick={() => { void onContinue(detail.id).then((ok) => { if (ok) onClose(); }); }}>继续对话</button>
          </div>
        </>
      ) : (
        <>
          <div className="ai-sheet__search">
            <span className="mb-input">
              <Search size={16} aria-hidden="true" />
              <input aria-label="搜索历史对话" placeholder="搜索历史对话…" value={query} onChange={(event) => { setQuery(event.target.value); void loadList(event.target.value); }} />
            </span>
          </div>
          <div className="ai-body ai-history-body">
            {detailLoading && <div className="mb-empty mb-empty--inset">读取中…</div>}
            {!detailLoading && items.length === 0 && <div className="mb-empty mb-empty--inset">{query.trim() ? "没有匹配的对话" : "还没有历史对话"}</div>}
            {items.map((item) => (
              <button key={item.id} type="button" className="mb-row mb-row--two-line ai-history-row" onClick={() => void openDetail(item.id)}>
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
                  onClick={(event) => { event.stopPropagation(); void confirmMobile({ title: "删除这条对话？", body: "只删除本机保存的这条 AI 对话，不影响笔记与同步。", confirmText: "删除", danger: true }).then((ok) => { if (ok) void onDelete(item.id).then(() => void loadList(query)); }); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); event.preventDefault(); } }}
                >
                  <Trash2 size={16} />
                </span>
              </button>
            ))}
            {loading && items.length > 0 && <div className="ai-history-foot">读取中…</div>}
            {!loading && items.length > 0 && <div className="ai-history-foot">共 {items.length} 条 · 仅本机 · 最多保留 50 条 / 30 天</div>}
          </div>
        </>
      )}
    </div>
  );
}
