/**
 * AI 写作空间控制器（桌面，v1）。
 *
 * 分层（唯一职责边界）：
 * - 本 hook：会话列表 / 当前会话 / 输入卡状态 / 把「一轮」交给 aiWritingTurn；
 * - aiWritingTurn：流式聚合 + 停止 / 失败语义（纯异步、可单测）；
 * - aiWritingContext：多文档资料读取（注入 reader、可单测）；
 * - core/aiWriting：形状 / 预算 / 消息组装（纯函数）；
 * - 主进程：本地 SQLite 仓库 + IPC；网络仍只走既有 ai_chat（Key 不出主进程）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelAiChat, loadAiSettings, newAiRequestId, runAiChat } from "../../lib/ai";
import { loadAiEnabled } from "../../lib/aiEnabled";
import { native } from "../../lib/native";
import { AI_PROVIDERS } from "../../core/aiProviders";
import {
  aiWritingTitleFrom,
  buildAiWritingMessages,
  type AiWritingConversation,
  type AiWritingDocRef,
  type AiWritingMessage,
  type AiWritingMode,
} from "../../core/aiWriting";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { resolveAiWritingDocs, type AiWritingDocReader } from "./aiWritingContext";
import { startAiWritingTurn, type AiWritingTurn } from "./aiWritingTurn";

export interface AiWritingStream {
  messageId: string;
  content: string;
  reasoning: string;
}

export interface AiWritingController {
  conversations: AiWritingConversation[];
  activeConversation: AiWritingConversation | null;
  messages: AiWritingMessage[];
  loading: boolean;
  loadError: string | null;
  busy: boolean;
  stream: AiWritingStream | null;
  /** 输入卡 */
  mode: AiWritingMode;
  setMode: (mode: AiWritingMode) => void;
  input: string;
  setInput: (value: string) => void;
  promptText: string | null;
  setPromptText: (text: string | null) => void;
  docRefs: AiWritingDocRef[];
  setDocRefs: (refs: AiWritingDocRef[]) => void;
  /** AI 可用性（总开关 + 供应商配置 + 供应商名） */
  ready: boolean;
  aiEnabled: boolean;
  providerLabel: string;
  /** 会话操作 */
  newConversation: () => void;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  /** 发送（override = 「点一点试试」直接发送） */
  send: (override?: string) => void;
  stop: () => void;
  regenerate: () => void;
}

function providerLabelOf(activeProviderId: string): string {
  return AI_PROVIDERS.find((def) => def.id === activeProviderId)?.label ?? "AI";
}

export function useAiWriting(options: { active: boolean }): AiWritingController {
  const { active } = options;
  const [conversations, setConversations] = useState<AiWritingConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<AiWritingConversation | null>(null);
  const [messages, setMessages] = useState<AiWritingMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<AiWritingStream | null>(null);
  const [mode, setModeState] = useState<AiWritingMode>("chat");
  const [input, setInput] = useState("");
  const [promptText, setPromptTextState] = useState<string | null>(null);
  const [docRefs, setDocRefsState] = useState<AiWritingDocRef[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState(AI_PROVIDERS[0].id);
  const [ready, setReady] = useState(false);

  const messagesRef = useRef<AiWritingMessage[]>([]);
  messagesRef.current = messages;
  const conversationRef = useRef<AiWritingConversation | null>(null);
  conversationRef.current = activeConversation;
  const busyRef = useRef(false);
  const turnRef = useRef<AiWritingTurn | null>(null);
  const composerRef = useRef({ mode, promptText, docRefs });
  composerRef.current = { mode, promptText, docRefs };

  /** 主进程读取端口（多文档上下文）；集中一处，便于替换成移动端/Host 实现。 */
  const docReader = useMemo<AiWritingDocReader>(() => ({
    readNoteCaches: (id) => native.readNoteCaches(id),
    readNote: (id) => native.readNote(id),
    readQuickNote: (id) => native.readQuickNote(id),
  }), []);

  const notifyComposer = useCallback((patch: { mode?: AiWritingMode; promptText?: string | null; docRefs?: AiWritingDocRef[] }) => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    void native.aiWritingComposer(conversation.id, patch).catch(() => undefined);
  }, []);

  const setMode = useCallback((next: AiWritingMode) => {
    setModeState(next);
    notifyComposer({ mode: next });
  }, [notifyComposer]);

  const setPromptText = useCallback((next: string | null) => {
    setPromptTextState(next);
    notifyComposer({ promptText: next });
  }, [notifyComposer]);

  const setDocRefs = useCallback((next: AiWritingDocRef[]) => {
    setDocRefsState(next);
    notifyComposer({ docRefs: next });
  }, [notifyComposer]);

  // ---- AI 可用性：进入空间时 + 窗口重新聚焦时刷新（用户去设置里配好回来要立刻生效） ----
  const refreshReadiness = useCallback(async () => {
    setAiEnabled(loadAiEnabled());
    try {
      const settings = await loadAiSettings();
      setActiveProviderId(settings.activeProviderId);
      const provider = settings.providers.find((item) => item.id === settings.activeProviderId);
      setReady(Boolean(provider?.hasApiKey && provider.model));
    } catch {
      setReady(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refreshReadiness();
    const onFocus = () => { void refreshReadiness(); };
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); };
  }, [active, refreshReadiness]);

  // ---- 会话列表：进入空间时加载 ----
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    void native.aiWritingList()
      .then((items) => { if (alive) { setConversations(items); setLoadError(null); } })
      .catch((error) => { if (alive) setLoadError(getNativeErrorMessage(error) || "读取历史记录失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active]);

  // ---- 会话切换 ----
  const selectConversation = useCallback((id: string) => {
    if (busyRef.current) return;
    setLoading(true);
    void native.aiWritingGet(id)
      .then((payload) => {
        if (!payload) return;
        setActiveConversation(payload.conversation);
        setMessages(payload.messages);
        setModeState(payload.conversation.mode);
        setPromptTextState(payload.conversation.promptText);
        setDocRefsState(payload.conversation.docRefs);
        setInput("");
      })
      .catch((error) => setLoadError(getNativeErrorMessage(error) || "打开会话失败"))
      .finally(() => setLoading(false));
  }, []);

  const newConversation = useCallback(() => {
    if (busyRef.current) return;
    setActiveConversation(null);
    setMessages([]);
    setPromptTextState(null);
    setDocRefsState([]);
    setInput("");
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const updated = await native.aiWritingRename(id, title);
    if (!updated) return;
    setConversations((prev) => prev.map((item) => (item.id === id ? updated : item)));
    setActiveConversation((prev) => (prev && prev.id === id ? updated : prev));
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await native.aiWritingDelete(id);
    setConversations((prev) => prev.filter((item) => item.id !== id));
    if (conversationRef.current?.id === id) {
      setActiveConversation(null);
      setMessages([]);
    }
  }, []);

  // ---- 一轮生成：UI 占位 → 交给 turn → 回填占位消息 ----
  const runAssistant = useCallback(async (params: {
    conversation: AiWritingConversation;
    history: AiWritingMessage[];
    userText: string;
  }) => {
    const { conversation, history, userText } = params;
    const { mode: currentMode, promptText: currentPrompt, docRefs: currentRefs } = composerRef.current;
    busyRef.current = true;
    setBusy(true);
    setLoadError(null);

    const placeholder = await native.aiWritingAppendMessage({ conversationId: conversation.id, role: "assistant", content: "" });
    const base = [...history, placeholder];
    setMessages(base);

    const docs = currentMode === "docs" ? await resolveAiWritingDocs(currentRefs, docReader) : [];
    const requestMessages = buildAiWritingMessages({
      mode: currentMode,
      input: userText,
      promptText: currentPrompt,
      docs,
      history: history.map((message) => ({ role: message.role, content: message.content })),
    });
    const turn = startAiWritingTurn({
      requestId: newAiRequestId(),
      messages: requestMessages,
      deps: { run: runAiChat, cancel: cancelAiChat },
      onPartial: (content, reasoning) => setStream({ messageId: placeholder.id, content, reasoning }),
    });
    turnRef.current = turn;
    const outcome = await turn.result;
    turnRef.current = null;

    const saved = await native.aiWritingUpdateMessage(placeholder.id, {
      content: outcome.content,
      reasoning: outcome.reasoning || null,
      durationMs: outcome.durationMs,
      stopped: outcome.stopped,
      error: outcome.error,
    });
    if (saved) setMessages(base.map((message) => (message.id === placeholder.id ? saved : message)));
    setStream(null);
    busyRef.current = false;
    setBusy(false);
    // 历史列表的检索依据是 updated_at：轻量重拉一次排序。
    void native.aiWritingList().then((items) => setConversations(items)).catch(() => undefined);
  }, [docReader]);

  // ---- 发送 ----
  const send = useCallback((override?: string) => {
    if (busyRef.current) return;
    const text = (override ?? input).trim();
    if (!text) return;
    const { mode: currentMode, promptText: currentPrompt, docRefs: currentRefs } = composerRef.current;
    const history = messagesRef.current;
    void (async () => {
      try {
        let conversation = conversationRef.current;
        if (!conversation) {
          conversation = await native.aiWritingCreate({
            mode: currentMode,
            title: aiWritingTitleFrom(text),
            promptText: currentPrompt,
            docRefs: currentRefs,
          });
          setActiveConversation(conversation);
          setConversations((prev) => [conversation!, ...prev]);
        }
        const userMessage = await native.aiWritingAppendMessage({ conversationId: conversation.id, role: "user", content: text });
        setInput("");
        await runAssistant({ conversation, history: [...history, userMessage], userText: text });
      } catch (error) {
        setLoadError(getNativeErrorMessage(error) || "发送失败");
      }
    })();
  }, [input, runAssistant]);

  const stop = useCallback(() => {
    turnRef.current?.stop();
  }, []);

  /** 重新生成：删掉最后一条助手消息，用最后一条用户消息（连同它之前的历史）重跑。 */
  const regenerate = useCallback(() => {
    if (busyRef.current) return;
    const conversation = conversationRef.current;
    if (!conversation) return;
    const list = messagesRef.current;
    const lastUserIndex = [...list].reverse().findIndex((message) => message.role === "user");
    if (lastUserIndex < 0) return;
    const index = list.length - 1 - lastUserIndex;
    const lastUser = list[index];
    const history = list.slice(0, index + 1);
    void (async () => {
      await native.aiWritingDeleteLastAssistant(conversation.id);
      await runAssistant({ conversation, history, userText: lastUser.content });
    })();
  }, [runAssistant]);

  return useMemo(() => ({
    conversations, activeConversation, messages, loading, loadError, busy, stream,
    mode, setMode, input, setInput, promptText, setPromptText, docRefs, setDocRefs,
    ready, aiEnabled, providerLabel: providerLabelOf(activeProviderId),
    newConversation, selectConversation, renameConversation, deleteConversation,
    send, stop, regenerate,
  }), [
    conversations, activeConversation, messages, loading, loadError, busy, stream,
    mode, setMode, input, promptText, setPromptText, docRefs, setDocRefs,
    ready, aiEnabled, activeProviderId,
    newConversation, selectConversation, renameConversation, deleteConversation, send, stop, regenerate,
  ]);
}
