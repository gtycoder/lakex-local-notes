/**
 * AI 对话状态机（261107 P3）：从 `AiAssistantDialog` 抽出的**纯对话逻辑**。
 *
 * 负责：输入/追问、会话轮次、流式请求、停止/重试、预设、全文上下文读取、首轮/续聊的 prompt 组装。
 * 不负责：DOM 定位、拖高、复制按钮、面板几何、滚动——那些留在展示组件里。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";
import { native } from "../../lib/native";
import { aiMessageText, type AiChatMessage } from "../../core/aiProviders";
import { AI_IMAGE_PRESETS, AI_PROMPT_CUSTOM_ID, AI_PROMPT_PRESETS, buildAiDocumentContext, buildAiUserContent, withAiSystemMessage, type AiDocumentContext } from "./aiPrompts";
import { aiAttachments, aiDocumentNoteId, aiSelectionText, type AiAssistantRequest } from "./aiAssistantRequest";

interface Turn { role: "user" | "assistant"; text: string }

export interface AiConversation {
  instruction: string;
  setInstruction: (value: string) => void;
  followUp: string;
  setFollowUp: (value: string) => void;
  turns: Turn[];
  busy: boolean;
  error: string | null;
  stopped: boolean;
  presetId: string;
  setPresetId: (value: string) => void;
  includeDocument: boolean;
  docContext: AiDocumentContext | null;
  docBusy: boolean;
  docError: string | null;
  conversationDocMode: boolean;
  documentText: string | undefined;
  lastOutput: string;
  canSendFirst: boolean;
  hasImages: boolean;
  selectionContext: boolean;
  imageOnly: boolean;
  presets: typeof AI_PROMPT_PRESETS;
  activeValue: string;
  docLocked: boolean;
  docHint: string;
  toggleDocument: () => Promise<void>;
  submit: () => void;
  onFieldKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  run: (first: boolean) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
}

export function useAiConversation({ open, request }: { open: boolean; request: AiAssistantRequest }): AiConversation {
  const context = request.context;
  const selectionText = aiSelectionText(context);
  const attachments = aiAttachments(context);
  const noteId = aiDocumentNoteId(context);

  const [instruction, setInstruction] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 用户主动停止：是正常操作、不是错误（不报红）；已生成片段保留。 */
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);
  const reqRef = useRef<string | null>(null);
  const historyRef = useRef<AiChatMessage[]>([]);
  const [presetId, setPresetId] = useState<string>(AI_PROMPT_CUSTOM_ID);
  /** 当前文档全文上下文（默认关；只在用户打开开关时读一次本地缓存）。 */
  const [includeDocument, setIncludeDocument] = useState(false);
  const [docContext, setDocContext] = useState<AiDocumentContext | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  /** 本次对话是否从「全文」起头：一旦开聊就锁死，且结果不自动回写。 */
  const [conversationDocMode, setConversationDocMode] = useState(false);

  // 打开/换入口即重置整段对话（与旧 Dialog 的内联 effect 同口径）。
  useEffect(() => {
    if (!open) return;
    // 单会话 Host 换入口时组件不卸载：先中止上一会话的在途请求，避免旧流写进新对话。
    if (reqRef.current) { void cancelAiChat(reqRef.current); reqRef.current = null; }
    setInstruction(""); setFollowUp(""); setTurns([]); setError(null); setBusy(false);
    setStopped(false); stoppedRef.current = false; reqRef.current = null; historyRef.current = [];
    setPresetId(AI_PROMPT_CUSTOM_ID);
    setIncludeDocument(false); setDocContext(null); setDocBusy(false); setDocError(null); setConversationDocMode(false);
  }, [open, context]);

  const documentText = includeDocument ? docContext?.text : undefined;
  const firstPrompt = buildAiUserContent(instruction, selectionText, documentText);
  const lastOutput = [...turns].reverse().find((t) => t.role === "assistant")?.text ?? "";
  const canSendFirst = Boolean(instruction.trim());
  const hasImages = (attachments?.length ?? 0) > 0;
  /** 有选区/图片上下文：区域选择用 AI 只处理这段，不提供全文开关。 */
  const selectionContext = selectionText.trim().length > 0 || hasImages;
  // 全文模式下即使只有图片，也走文字 system（它才是解释「全文块」规则的那份）。
  const imageOnly = hasImages && !selectionText.trim() && !includeDocument;
  const presets = imageOnly ? AI_IMAGE_PRESETS : AI_PROMPT_PRESETS;
  const activeValue = turns.length === 0 ? instruction : followUp;
  /** 开聊后锁死上下文。 */
  const docLocked = turns.length > 0;
  const docHint = docBusy
    ? "正在读取文档缓存…"
    : docError
      ? docError
      : includeDocument && docContext
        ? "已附加 " + docContext.chars.toLocaleString("zh-CN") + " 字符" +
          (docContext.truncated
            ? "（已保存版本，超上限已截断）"
            : docContext.wordCount != null
              ? "（约 " + docContext.wordCount.toLocaleString("zh-CN") + " 字，已保存版本）"
              : "（已保存版本）") +
          (docLocked ? "（本次对话已固定）" : "")
        : docLocked
          ? "本次对话未附加全文；关闭面板重开可切换"
          : "开启后，发送时会把已保存的整篇正文发给 AI 供应商";

  const appendAssistant = (delta: string) => setTurns((prev) => {
    const next = prev.slice();
    const last = next[next.length - 1];
    if (last && last.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + delta };
    return next;
  });

  /** 发一轮：messages 已是完整上下文（含本轮 user）。 */
  const send = useCallback(async (messages: AiChatMessage[]) => {
    setBusy(true); setError(null);
    stoppedRef.current = false; setStopped(false);
    const reqId = newAiRequestId();
    reqRef.current = reqId;
    const wireMessages = withAiSystemMessage(messages, { imageOnly });
    try {
      const res = await runAiChat(reqId, wireMessages, appendAssistant);
      if (stoppedRef.current) {
        // 主动停止 ≠ 出错：半截回答不写进 history，但留在面板里可复制/插入。
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          return last && last.role === "assistant" && !last.text ? prev.slice(0, -1) : prev;
        });
      } else if (!res.ok) {
        setError(res.error ?? "未知错误");
      } else {
        historyRef.current = [...messages, { role: "assistant", content: res.text ?? "" }];
      }
    } catch (e) {
      if (!stoppedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); reqRef.current = null;
    }
  }, [imageOnly]);

  /** first=true 用预设+选区/全文起头；first=false 用追问，带上历史。 */
  const run = useCallback(async (first: boolean) => {
    if (busy) return;
    if (first) setConversationDocMode(includeDocument);
    const content = first ? firstPrompt : followUp.trim();
    if (!content) { setError("请先写要让 AI 做什么"); return; }
    const base = first ? [] : historyRef.current;
    const firstContent: AiChatMessage["content"] = hasImages
      ? [{ type: "text", text: content }, ...attachments!.map((asset) => ({ type: "image" as const, asset }))]
      : content;
    const messages: AiChatMessage[] = [...base, { role: "user", content: first ? firstContent : content }];
    historyRef.current = messages;
    setTurns((prev) => [...(first ? [] : prev),
      { role: "user", text: first ? instruction.trim() : followUp.trim() },
      { role: "assistant", text: "" }]);
    setFollowUp("");
    await send(messages);
  }, [attachments, busy, firstPrompt, followUp, hasImages, includeDocument, instruction, send]);

  /** 重新生成：丢掉最后一条助手回复，用同样的上文再要一次。 */
  const regenerate = useCallback(async () => {
    if (busy) return;
    const hist = historyRef.current;
    let cut = -1;
    for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].role === "user") { cut = i; break; } }
    if (cut < 0) return;
    const messages = hist.slice(0, cut + 1);
    historyRef.current = messages;
    const lastUser = aiMessageText(messages[messages.length - 1]);
    setTurns((prev) => {
      const next = prev.slice();
      while (next.length && next[next.length - 1].role === "assistant") next.pop();
      if (!next.length || next[next.length - 1].role !== "user") next.push({ role: "user", text: lastUser });
      next.push({ role: "assistant", text: "" });
      return next;
    });
    await send(messages);
  }, [busy, send]);

  /** 开关「当前文档全文」：首次开启时才读本地缓存；空/失败都给明确原因。 */
  const toggleDocument = useCallback(async () => {
    if (!noteId || docBusy || docLocked) return;
    if (includeDocument) { setIncludeDocument(false); return; }
    if (docContext) { setIncludeDocument(true); setDocError(null); return; }
    setDocBusy(true); setDocError(null);
    try {
      const next = buildAiDocumentContext(await native.readNoteCaches(noteId));
      if (!next) { setDocError("该文档还没有文本缓存，请先打开并保存一次"); return; }
      setDocContext(next); setIncludeDocument(true);
    } catch {
      setDocError("读取文档缓存失败，本次不附加全文");
    } finally {
      setDocBusy(false);
    }
  }, [docBusy, docContext, docLocked, includeDocument, noteId]);

  /** 停止生成：立刻中止主进程那一次请求，并记「主动停止」而非报错。 */
  const stop = useCallback(() => {
    if (!reqRef.current) return;
    stoppedRef.current = true; setStopped(true);
    void cancelAiChat(reqRef.current);
  }, []);

  /** 回车 = 确定；Ctrl/⌥/⌘/⇧+回车 = 换行。 */
  const submit = useCallback(() => {
    if (busy) return;
    if (turns.length === 0) { if (canSendFirst) void run(true); }
    else if (followUp.trim()) void run(false);
  }, [busy, canSendFirst, followUp, run, turns.length]);

  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return {
    instruction, setInstruction, followUp, setFollowUp, turns, busy, error, stopped,
    presetId, setPresetId, includeDocument, docContext, docBusy, docError, conversationDocMode,
    documentText, lastOutput, canSendFirst, hasImages, selectionContext, imageOnly, presets,
    activeValue, docLocked, docHint,
    toggleDocument, submit, onFieldKeyDown, run, regenerate, stop,
  };
}