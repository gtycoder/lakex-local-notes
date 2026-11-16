/**
 * AI 对话状态机（261107 P3）：从 `AiAssistantDialog` 抽出的**纯对话逻辑**。
 *
 * 负责：输入/追问、会话轮次、流式请求、停止/重试、预设、全文上下文读取、首轮/续聊的 prompt 组装。
 * 不负责：DOM 定位、拖高、复制按钮、面板几何、滚动——那些留在展示组件里。
 *
 * 261116（用户裁决：桌面 AI 助手对齐 chat-demo）：线性 turns → 消息树 + 当前路径
 * （模型/纯函数见 aiConversationTree.ts）：
 * - 重新生成 = 在同一个用户提问下追加助手兄弟版本并选中它（旧回答保留）；
 * - 编辑提问 = 在同一个 parentId 下追加用户兄弟版本并选中它（后续消息走新分支，旧分支保留）；
 * - 切换版本 = 只改父节点的 selectedChildId；请求上下文一律由**当前可见路径**推导，
 *   不再单独维护 historyRef（否则切版本后追问会带着旧分支的历史发出去）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";
import { native } from "../../lib/native";
import type { AiChatMessage } from "../../core/aiProviders";
import { AI_IMAGE_PRESETS, AI_PROMPT_CUSTOM_ID, AI_PROMPT_PRESETS, buildAiDocumentContext, buildAiUserContent, withAiSystemMessage, type AiDocumentContext } from "./aiPrompts";
import { aiAttachments, aiDocumentNoteId, aiSelectionText, type AiAssistantRequest } from "./aiAssistantRequest";
import {
  appendBranch,
  appendTurnText,
  createAiConversationSession,
  newAiTurnId,
  removeTurn,
  selectVersion as selectSessionVersion,
  updateTurn,
  visiblePath,
  wireMessages,
  type AiConversationSession,
  type AiTurn,
} from "./aiConversationTree";

/** 正在编辑的提问：提交时新建该消息的兄弟版本（parentId 不变），原分支保留。 */
export interface AiEditingState { messageId: string; text: string }

export interface AiConversation {
  instruction: string;
  setInstruction: (value: string) => void;
  followUp: string;
  setFollowUp: (value: string) => void;
  /** 当前可见路径（= 面板里显示的消息，也是下一次请求的上下文）。 */
  turns: AiTurn[];
  /** 整棵树（版本切换用它算兄弟版本）。 */
  session: AiConversationSession;
  busy: boolean;
  error: string | null;
  stopped: boolean;
  /** 编辑提问态（null = 不在编辑）；提交走 commitEdit，不删旧分支。 */
  editing: AiEditingState | null;
  beginEdit: (messageId: string) => void;
  setEditingText: (value: string) => void;
  cancelEdit: () => void;
  commitEdit: () => Promise<void>;
  /** 切到某条消息的兄弟版本；生成中忽略（UI 也会禁用）。 */
  selectVersion: (messageId: string) => void;
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

export function useAiConversation({ open, request, thinking }: { open: boolean; request: AiAssistantRequest; /** 请求级深度思考覆盖（undefined = 用供应商当前设置，与改造前一致）。 */ thinking?: boolean }): AiConversation {
  const context = request.context;
  const selectionText = aiSelectionText(context);
  const attachments = aiAttachments(context);
  const noteId = aiDocumentNoteId(context);

  const [instruction, setInstruction] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [session, setSession] = useState<AiConversationSession>(createAiConversationSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 用户主动停止：是正常操作、不是错误（不报红）；已生成片段保留。 */
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);
  const reqRef = useRef<string | null>(null);
  /** 正在编辑的提问（提交时从这条提问分叉；取消不产生任何节点）。 */
  const [editing, setEditing] = useState<AiEditingState | null>(null);
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
    setInstruction(""); setFollowUp(""); setSession(createAiConversationSession()); setEditing(null);
    setError(null); setBusy(false);
    setStopped(false); stoppedRef.current = false; reqRef.current = null;
    setPresetId(AI_PROMPT_CUSTOM_ID);
    setIncludeDocument(false); setDocContext(null); setDocBusy(false); setDocError(null); setConversationDocMode(false);
  }, [open, context]);

  const documentText = includeDocument ? docContext?.text : undefined;
  const firstPrompt = buildAiUserContent(instruction, selectionText, documentText);
  const turns = visiblePath(session);
  const lastOutput = turns.toReversed().find((turn) => turn.role === "assistant")?.text ?? "";
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

  /** 发一轮：messages 已是完整上下文（含本轮 user）；增量只写进本轮助手消息。 */
  const send = useCallback(async (messages: AiChatMessage[], assistantId: string) => {
    setBusy(true); setError(null);
    stoppedRef.current = false; setStopped(false);
    const reqId = newAiRequestId();
    reqRef.current = reqId;
    const wireMessages = withAiSystemMessage(messages, { imageOnly });
    const appendAssistant = (delta: string) => setSession((prev) => appendTurnText(prev, assistantId, delta));
    try {
      // 请求级深度思考覆盖：undefined = 不传（与改造前逐字节一致）；只在 supportsThinking 的供应商上生效（主进程判据）。
      const thinkingOptions = thinking === undefined ? undefined : ({ thinking: thinking ? "enabled" : "disabled" } as const);
      const res = await runAiChat(reqId, wireMessages, appendAssistant, undefined, thinkingOptions);
      if (stoppedRef.current) {
        // 主动停止 ≠ 出错：半截回答留在面板里可复制/插入，但不再进入后续上下文；
        // 一个字都没生成 ⇒ 移除这个空的助手版本（父提问回落到上一个版本）。
        setSession((prev) => {
          const turn = prev.messages.find((message) => message.id === assistantId);
          if (!turn) return prev;
          if (!turn.text) return removeTurn(prev, assistantId);
          return updateTurn(prev, assistantId, { interrupted: true });
        });
      } else if (!res.ok) {
        setError(res.error ?? "未知错误");
      } else if (res.text != null) {
        // 供应商的最终文本才是权威（流式末段丢包时不残留截断）。
        setSession((prev) => {
          const turn = prev.messages.find((message) => message.id === assistantId);
          return !turn || turn.text === res.text ? prev : updateTurn(prev, assistantId, { text: res.text ?? "" });
        });
      }
    } catch (e) {
      if (!stoppedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); reqRef.current = null;
    }
  }, [imageOnly, thinking]);

  /** first=true 用预设+选区/全文起头；first=false 用追问，上下文 = 当前可见路径。 */
  const run = useCallback(async (first: boolean) => {
    if (busy || editing) return;
    if (first) setConversationDocMode(includeDocument);
    const content = first ? firstPrompt : followUp.trim();
    if (!content) { setError("请先写要让 AI 做什么"); return; }
    const path = visiblePath(session);
    const parentId = first ? null : path[path.length - 1]?.id ?? null;
    const userText = first ? instruction.trim() : followUp.trim();
    const firstContent: AiChatMessage["content"] = hasImages
      ? [{ type: "text", text: content }, ...attachments!.map((asset) => ({ type: "image" as const, asset }))]
      : content;
    const userContent = first ? firstContent : content;
    const userId = newAiTurnId();
    const assistantId = newAiTurnId();
    setSession((prev) => appendBranch(prev, parentId, [
      { id: userId, role: "user", text: userText, wireContent: userContent },
      { id: assistantId, role: "assistant", text: "" },
    ]));
    setFollowUp("");
    await send([...wireMessages(path), { role: "user", content: userContent }], assistantId);
  }, [attachments, busy, editing, firstPrompt, followUp, hasImages, includeDocument, instruction, send, session]);

  /** 重新生成：在同一个用户提问下追加助手兄弟版本并选中它；旧回答保留、可切回。 */
  const regenerate = useCallback(async () => {
    if (busy) return;
    const path = visiblePath(session);
    const last = path[path.length - 1];
    if (!last) return;
    const userIndex = last.role === "user" ? path.length - 1 : path.length - 2;
    const userTurn = path[userIndex];
    if (!userTurn || userTurn.role !== "user") return;
    const assistantId = newAiTurnId();
    setSession((prev) => appendBranch(prev, userTurn.id, [
      { id: assistantId, role: "assistant", text: "" },
    ]));
    await send(wireMessages(path.slice(0, userIndex + 1)), assistantId);
  }, [busy, send, session]);

  /** 切到某条消息的兄弟版本：生成中禁用（用户裁决），只改父节点的 selectedChildId。 */
  const selectVersion = useCallback((messageId: string) => {
    if (busy) return;
    setSession((prev) => selectSessionVersion(prev, messageId));
  }, [busy]);

  /** 进入编辑提问态：把原文放进输入框（面板侧绑定 editing.text）。 */
  const beginEdit = useCallback((messageId: string) => {
    if (busy) return;
    const turn = session.messages.find((message) => message.id === messageId && message.role === "user");
    if (!turn) return;
    setEditing({ messageId, text: turn.text });
  }, [busy, session.messages]);

  const setEditingText = useCallback((value: string) => {
    setEditing((prev) => (prev ? { ...prev, text: value } : prev));
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  /**
   * 编辑提问的 wireContent：首轮沿用同一套上下文（选区/全文/图片）只换问题；
   * 后续追问本来就只发问题文本。
   */
  const editedUserContent = useCallback((original: AiTurn, text: string): AiChatMessage["content"] => {
    if (original.parentId !== null) return text;
    const full = buildAiUserContent(text, selectionText, documentText);
    return hasImages
      ? [{ type: "text", text: full }, ...attachments!.map((asset) => ({ type: "image" as const, asset }))]
      : full;
  }, [attachments, documentText, hasImages, selectionText]);

  /** 提交编辑：新建该提问的**兄弟版本**（parentId 不变、rootId 只在根提问时切换），旧分支原样保留。 */
  const commitEdit = useCallback(async () => {
    if (busy || !editing) return;
    const text = editing.text.trim();
    if (!text) { setError("请先写要让 AI 做什么"); return; }
    const original = session.messages.find((message) => message.id === editing.messageId);
    if (!original || original.role !== "user") { setEditing(null); return; }
    const path = visiblePath(session);
    const parentId = original.parentId;
    const parentIndex = parentId === null ? -1 : path.findIndex((message) => message.id === parentId);
    if (parentId !== null && parentIndex < 0) { setEditing(null); return; }
    const base = parentId === null ? [] : wireMessages(path.slice(0, parentIndex + 1));
    const content = editedUserContent(original, text);
    const userId = newAiTurnId();
    const assistantId = newAiTurnId();
    setSession((prev) => appendBranch(prev, parentId, [
      { id: userId, role: "user", text, wireContent: content },
      { id: assistantId, role: "assistant", text: "" },
    ]));
    setEditing(null);
    setFollowUp("");
    setError(null);
    await send([...base, { role: "user", content }], assistantId);
  }, [busy, editedUserContent, editing, send, session]);

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
    if (editing) { if (editing.text.trim()) void commitEdit(); return; }
    if (turns.length === 0) { if (canSendFirst) void run(true); }
    else if (followUp.trim()) void run(false);
  }, [busy, canSendFirst, commitEdit, editing, followUp, run, turns.length]);

  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  return {
    instruction, setInstruction, followUp, setFollowUp, turns, session, busy, error, stopped,
    editing, beginEdit, setEditingText, cancelEdit, commitEdit, selectVersion,
    presetId, setPresetId, includeDocument, docContext, docBusy, docError, conversationDocMode,
    documentText, lastOutput, canSendFirst, hasImages, selectionContext, imageOnly, presets,
    activeValue, docLocked, docHint,
    toggleDocument, submit, onFieldKeyDown, run, regenerate, stop,
  };
}
