/**
 * 移动端 AI 页（261023 P1；会话状态在 aiChatStore，页面只负责渲染与交互）。
 *
 * 关键行为：离开页面不销毁会话（后台流式继续、再进来能看到完整回答）；App 进程结束才清空。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowUp, Camera, Clock, FileText, Image as ImageIcon, Paperclip, Plus, Sparkles, Square } from "lucide-react";
import { bridge } from "../bridge";
import { pushBackHandler } from "../ui/backStack";
import { showToast } from "../ui/toastBus";
import { AiCorpusSheet, type CorpusCandidate } from "./AiCorpusSheet";
import { AiMarkdown } from "./AiMarkdown";
import { AiHistoryPage } from "./AiHistoryPage";
import { AiImageSheet } from "./AiImageSheet";
import { AiSendSheet } from "./AiSendSheet";
import {
  addCorpusDoc,
  clearAllConversations,
  deleteConversation,
  getSnapshot,
  init,
  listConversations,
  newConversation,
  readConversationDetail,
  openConversation,
  removeCorpusDoc,
  retry,
  send,
  setAllSend,
  stop,
  subscribe,
  toggleSend,
  type AiMessage,
} from "./aiChatStore";
import { canAddImage, compressImageFile, type AiPendingImage } from "./aiImages";
import { answerTitle, lakeBodyFromText, suggestions, takeCorpus } from "./aiSession";
import { pickLocalFile } from "../ui/pickFile";

export interface MobileAiPageProps {
  open: boolean;
  onClose: () => void;
  /** 新建了文档/小记后让首页刷新。 */
  onChanged?: () => void;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

export function MobileAiPage({ open, onClose, onChanged }: MobileAiPageProps) {
  const chat = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [draft, setDraft] = useState("");
  const [corpusOpen, setCorpusOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [imageSheetOpen, setImageSheetOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<AiPendingImage[]>([]);
  const [candidates, setCandidates] = useState<CorpusCandidate[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    init();
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat.messages, chat.busy]);

  const addPickedImage = useCallback(async (file: File | null, source: string) => {
    if (!file) return;
    setPendingImages((prev) => {
      const limitReason = canAddImage(prev.length);
      if (limitReason) { showToast(limitReason, { type: "error" }); return prev; }
      return prev;
    });
    try {
      const compressed = await compressImageFile(file);
      if (!compressed) { showToast(source + "：图片格式不支持或压缩失败", { type: "error" }); return; }
      setPendingImages((prev) => {
        if (canAddImage(prev.length)) { showToast("一次最多发送 10 张图片", { type: "error" }); return prev; }
        return [...prev, { id: crypto.randomUUID(), kind: "temp", dataUrl: compressed.dataUrl, mimeType: compressed.mimeType, bytes: compressed.bytes }];
      });
    } catch {
      showToast(source + "：读取图片失败", { type: "error" });
    }
  }, []);

  const loadCandidates = useCallback(async () => {
    try {
      const snapshot = await bridge.getHomeSnapshot();
      setCandidates(snapshot.notes.map((note) => ({ id: note.id, title: note.title, chars: null })));
    } catch {
      showToast("读取文档列表失败", { type: "error" });
    }
  }, []);

  const openCorpus = useCallback(() => {
    if (chat.messages.length > 0) {
      showToast("本会话资料已固定；换资料请新开对话");
      return;
    }
    setCorpusOpen(true);
    void loadCandidates();
  }, [chat.messages.length, loadCandidates]);

  const toggleCorpusDoc = useCallback(async (id: string) => {
    const existing = chat.corpus.find((doc) => doc.id === id);
    if (existing) { removeCorpusDoc(id); return; }
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, loading: true } : c)));
    try {
      const doc = await bridge.aiReadDocText(id);
      if (!doc) {
        setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, loading: false, disabledReason: "暂只支持 Lake 文档" } : c)));
        showToast("暂只支持 Lake 文档作为资料");
        return;
      }
      const reason = addCorpusDoc(doc);
      if (reason) showToast(reason);
      setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, loading: false, chars: doc.totalChars, disabledReason: reason ?? undefined } : c)));
    } catch (error) {
      setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, loading: false } : c)));
      showToast("读取文档失败：" + (error as Error).message, { type: "error" });
    }
  }, [chat.corpus]);

  const sendDraft = useCallback(async () => {
    const question = draft.trim();
    if (!question || chat.busy) return;
    const outcome = await send(question, { images: pendingImages });
    if (!outcome.ok) {
      if (outcome.reason) showToast(outcome.reason, { type: "error" });
      return;
    }
    setDraft("");
    setPendingImages([]);
  }, [chat.busy, draft, pendingImages]);

  const questionBefore = useCallback((index: number): string => {
    for (let i = index - 1; i >= 0; i -= 1) if (chat.messages[i].role === "user") return chat.messages[i].text;
    return "";
  }, [chat.messages]);

  const copyAnswer = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); showToast("已复制回答"); }
    catch { showToast("复制失败", { type: "error" }); }
  }, []);

  const saveAsDoc = useCallback(async (text: string, question: string) => {
    try {
      const title = answerTitle(question);
      const note = await bridge.createNote(title);
      await bridge.saveNote(note.id, title, lakeBodyFromText(text), note.parentId ?? null);
      showToast("已存为新文档《" + title + "》");
      onChanged?.();
    } catch (error) {
      showToast("保存失败：" + (error as Error).message, { type: "error" });
    }
  }, [onChanged]);

  const saveAsQuickNote = useCallback(async (text: string) => {
    try { await bridge.createQuickNote(text); showToast("已存为小记"); onChanged?.(); }
    catch (error) { showToast("保存失败：" + (error as Error).message, { type: "error" }); }
  }, [onChanged]);

  if (!open) return null;

  const used = takeCorpus(chat.corpus.filter((doc) => chat.sendIds.includes(doc.id))).used;
  const docCount = chat.corpus.length;

  return (
    <div className="mobile-ai-page" role="dialog" aria-modal="true" aria-label="AI 助手">
      <header className="toolbar toolbar--border mobile-topbar">
        <button type="button" className="toolbar__button" onClick={onClose} aria-label="返回"><ArrowLeft size={20} /></button>
        <span className="mobile-topbar-title">AI 助手</span>
        <button type="button" className="toolbar__button" onClick={() => setHistoryOpen(true)} aria-label="历史对话"><Clock size={20} /></button>
        <button type="button" className="toolbar__button" onClick={() => { newConversation(); setPendingImages([]); }} aria-label="新对话"><Plus size={20} /></button>
      </header>

      {docCount > 0 && (
        <div className="ai-corpusbar">
          <span className="ai-corpusbar__lead">资料 · {docCount} 篇</span>
          {chat.corpus.map((doc) => {
            const on = chat.sendIds.includes(doc.id);
            return (
              <button key={doc.id} type="button" className={"ai-chip" + (on ? "" : " is-off")} onClick={() => toggleSend(doc.id)}>
                {!on && <span className="ai-chip__dot" aria-hidden="true" />}
                <span className="mb-ellipsis">{doc.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {!chat.enabled && (
        <div className="ai-banner" role="status">
          AI 助手已关闭：任何路径都不出网。<span className="ai-banner__hint">到「设置 → AI 助手」开启</span>
        </div>
      )}

      <div className="ai-body" ref={listRef}>
        {chat.messages.length === 0 ? (
          <div className="ai-empty">
            <span className="ai-empty__logo" aria-hidden="true"><Sparkles size={24} /></span>
            <div className="ai-empty__name">AI 助手</div>
            <h1 className="ai-empty__title">想让我帮你做点什么？</h1>
            <div className="ai-sugg">
              {suggestions(docCount > 0, docCount).map((text) => (
                <button key={text} type="button" className="mb-btn mb-btn--sm" onClick={() => { setDraft(text); inputRef.current?.focus(); }}>{text}</button>
              ))}
            </div>
            <p className="ai-empty__note">内容由 AI 生成，可能有误。离开页面不会丢对话（App 退出才清空）。</p>
          </div>
        ) : (
          <>
            {docCount > 0 && <div className="ai-divider">本轮资料 · {docCount} 篇（{fmt(used)} 字）+ 历史</div>}
            {chat.messages.map((message: AiMessage, index: number) => message.role === "user" ? (
              <div key={message.id} className="ai-msg ai-msg--user">
                <div className="ai-bubble">{message.text}</div>
              </div>
            ) : (
              <div key={message.id} className="ai-msg">
                {message.error ? <div className="ai-error">{message.error.message}</div> : <AiMarkdown text={message.text} />}
                {message.streaming && <span className="ai-typing" aria-label="生成中"><i /><i /><i /></span>}
                {message.stopped && <div className="ai-stopped">已停止</div>}
                {!message.streaming && (message.text || message.error) && (
                  <div className="ai-actions">
                    {message.text && <button type="button" className="mb-btn mb-btn--sm" onClick={() => void copyAnswer(message.text)}>复制</button>}
                    {message.text && <button type="button" className="mb-btn mb-btn--sm" onClick={() => void saveAsDoc(message.text, questionBefore(index))}>存为新文档</button>}
                    {message.text && <button type="button" className="mb-btn mb-btn--sm" onClick={() => void saveAsQuickNote(message.text)}>存为小记</button>}
                    {(message.error || message.stopped) && <button type="button" className="mb-btn mb-btn--sm" onClick={() => void retry(questionBefore(index))}>重试</button>}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {pendingImages.length > 0 && (
        <div className="ai-thumbrow">
          {pendingImages.map((image) => (
            <div key={image.id} className="ai-thumb">
              {image.dataUrl ? <img src={image.dataUrl} alt="" /> : <span className="ai-thumb__placeholder" />}
              <button type="button" className="ai-thumb__rm" aria-label="移除图片"
                onClick={() => setPendingImages((prev) => prev.filter((item) => item.id !== image.id))}>×</button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="ai-hint"
        onClick={() => { if (docCount === 0 && pendingImages.length === 0) openCorpus(); else setSendOpen(true); }}
      >
        {(() => {
          const parts: string[] = [];
          if (chat.sendIds.length > 0) parts.push(chat.sendIds.length + " 篇 · " + fmt(used) + " 字");
          if (pendingImages.length > 0) parts.push(pendingImages.length + " 张图片");
          return parts.length > 0 ? "本轮发送：" + parts.join(" + ") + " ▾" : "本轮不带资料 · 选择发送内容 ▾";
        })()}
      </button>

      <div className="ai-composer">
        <button type="button" className="ai-round" onClick={() => setActionsOpen(true)} aria-label="附件"><Plus size={20} /></button>
        <span className="mb-input ai-composer__input">
          <input
            ref={inputRef}
            aria-label="向 AI 提问"
            value={draft}
            placeholder={chat.enabled ? "问点什么…" : "AI 助手已关闭"}
            disabled={!chat.enabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendDraft(); } }}
          />
        </span>
        <button
          type="button"
          className={"ai-round ai-round--primary" + (chat.busy ? " is-stop" : "")}
          aria-label={chat.busy ? "停止" : "发送"}
          disabled={!chat.busy && !draft.trim()}
          onClick={() => { if (chat.busy) void stop(); else void sendDraft(); }}
        >
          {chat.busy ? <Square size={16} /> : <ArrowUp size={18} />}
        </button>
      </div>

      <AiHistoryPage
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onList={listConversations}
        onDetail={readConversationDetail}
        onContinue={openConversation}
        onDelete={deleteConversation}
        onClearAll={clearAllConversations}
      />
      <AiImageSheet
        open={imageSheetOpen}
        docs={chat.corpus.map((doc) => ({ id: doc.id, title: doc.title }))}
        used={pendingImages.length}
        onConfirm={(images) => { setPendingImages((prev) => [...prev, ...images].slice(0, 10)); setImageSheetOpen(false); }}
        onClose={() => setImageSheetOpen(false)}
      />
      <AiCorpusSheet
        open={corpusOpen}
        candidates={candidates}
        selectedIds={chat.corpus.map((doc) => doc.id)}
        onToggle={(id) => void toggleCorpusDoc(id)}
        onStart={() => { setCorpusOpen(false); inputRef.current?.focus(); }}
        onClose={() => setCorpusOpen(false)}
      />
      <AiSendSheet
        open={sendOpen}
        docs={chat.corpus.map((doc) => ({ id: doc.id, title: doc.title, chars: doc.totalChars }))}
        sendIds={chat.sendIds}
        onToggle={toggleSend}
        onAll={setAllSend}
        onClose={() => setSendOpen(false)}
      />

      {actionsOpen && (
        <>
          <div className="mb-scrim" data-prevent-swipe onClick={() => setActionsOpen(false)} aria-hidden="true" />
          <div className="mb-actionsheet is-open" role="dialog" aria-modal="true" aria-label="附件">
            <div className="mb-actionsheet__group">
              <button type="button" className="mb-actionsheet__item" onClick={() => { setActionsOpen(false); openCorpus(); }}><FileText size={18} />资料<span className="ai-action__sub">选择文档</span></button>
              <button type="button" className="mb-actionsheet__item" onClick={() => { setActionsOpen(false); void pickLocalFile("image/*", "environment").then((file) => addPickedImage(file, "拍照")); }}><Camera size={18} />拍照<span className="ai-action__sub">拍一张</span></button>
              <button type="button" className="mb-actionsheet__item" onClick={() => { setActionsOpen(false); void pickLocalFile("image/*").then((file) => addPickedImage(file, "相册")); }}><ImageIcon size={18} />相册<span className="ai-action__sub">从相册选</span></button>
              <button type="button" className="mb-actionsheet__item" onClick={() => {
                setActionsOpen(false);
                if (chat.corpus.length === 0) { showToast("先选择资料文档，再用文档里的图片"); return; }
                setImageSheetOpen(true);
              }}><Paperclip size={18} />资源<span className="ai-action__sub">{chat.corpus.length > 0 ? "文档里的图片" : "先选资料文档"}</span></button>
            </div>
            <button type="button" className="mb-actionsheet__cancel" onClick={() => setActionsOpen(false)}>取消</button>
          </div>
        </>
      )}
    </div>
  );
}
