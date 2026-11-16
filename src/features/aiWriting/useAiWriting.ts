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
  AI_WRITING_MAX_ATTACHMENTS,
  aiWritingAttachmentErrorHint,
  aiWritingAttachmentKey,
  aiWritingModeCapabilities,
  aiWritingTitleFrom,
  buildAiWritingMessages,
  filterAiWritingAttachmentsForMode,
  isAiWritingLocalAttachment,
  type AiWritingAttachment,
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
  /** 待发送的图片附件（只随下一轮 user 消息；发送后清空；不进会话 composer 状态）。 */
  attachRefs: AiWritingAttachment[];
  addAttachments: (refs: readonly AiWritingAttachment[]) => void;
  removeAttachment: (asset: AiWritingAttachment) => void;
  clearAttachments: () => void;
  /** 主进程 dialog 选本机文件（只在允许 localFiles 的模式下可用）。 */
  pickLocalFiles: () => Promise<void>;
  /** 粘贴剪贴板图片（第三方复制）：字节只此一次进主进程，落盘后只加引用。 */
  pasteImages: (files: File[]) => Promise<void>;
  /** 深度思考（261116 用户裁决：默认开、可关）。请求级覆盖 = runAiChat options.thinking。 */
  thinking: boolean;
  setThinking: (value: boolean) => void;
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
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<AiWritingStream | null>(null);
  const [mode, setModeState] = useState<AiWritingMode>("chat");
  const [input, setInput] = useState("");
  const [promptText, setPromptTextState] = useState<string | null>(null);
  const [docRefs, setDocRefsState] = useState<AiWritingDocRef[]>([]);
  /** 待发送图片附件（合并按 key 去重；上限 = core 的 AI_WRITING_MAX_ATTACHMENTS）。 */
  const [attachRefs, setAttachRefs] = useState<AiWritingAttachment[]>([]);
  /** 深度思考开关：默认开（与改造前一致）；关闭 = 请求级覆盖 thinking="disabled"（见 runAssistant）。 */
  const [thinking, setThinking] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState(AI_PROVIDERS[0].id);
  const [ready, setReady] = useState(false);

  const messagesRef = useRef<AiWritingMessage[]>([]);
  messagesRef.current = messages;
  const conversationRef = useRef<AiWritingConversation | null>(null);
  conversationRef.current = activeConversation;
  const busyRef = useRef(false);
  /** 发送中的哨兵：busyRef 要等占位消息写入后才置位，连点 Enter 会在这之前重复建会话。 */
  const sendingRef = useRef(false);
  const turnRef = useRef<AiWritingTurn | null>(null);
  const composerRef = useRef({ mode, promptText, docRefs, thinking, attachRefs });
  composerRef.current = { mode, promptText, docRefs, thinking, attachRefs };

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

  /**
   * 模式切换 = **结束当前会话视图（新会话）+ 清空上下文**（261116 第四稿强判据）：
   * 取消在途请求、detach 当前会话、清 docRefs/attachRefs/输入（以及提示词 chip，避免沿用上一模式的约束）。
   * 只切 mode 本身不持久化到旧会话——旧会话保留其原本模式，切回来看到的是干净的新视图。
   */
  const setMode = useCallback((next: AiWritingMode) => {
    if (next === composerRef.current.mode) return;
    turnRef.current?.stop();
    setModeState(next);
    setActiveConversation(null);
    setMessages([]);
    setStream(null);
    setPromptTextState(null);
    setDocRefsState([]);
    setAttachRefs([]);
    setInput("");
    setLoadError(null);
  }, []);

  const setPromptText = useCallback((next: string | null) => {
    setPromptTextState(next);
    notifyComposer({ promptText: next });
  }, [notifyComposer]);

  const setDocRefs = useCallback((next: AiWritingDocRef[]) => {
    setDocRefsState(next);
    // 换选/移除文档 ⇒ 引用这些文档的附件一并清掉（不留悬空附件）；本机文件在多文档模式本来就不允许。
    const allowed = new Set(next.map((doc) => doc.id));
    setAttachRefs((prev) => prev.filter((ref) => !isAiWritingLocalAttachment(ref) && allowed.has(ref.noteId)));
    notifyComposer({ docRefs: next });
  }, [notifyComposer]);

  /**
   * 加附件：模式判据（capabilities 表）先过滤，再合并去重 + 上限。
   * chat：文档资产图 + 本机文件都可；docs：只收 noteId ∈ 已选文档的资产图片（本机文件直接忽略）。
   * 超出的部分静默丢弃（选择器已按剩余槽位限选）。
   */
  const addAttachments = useCallback((refs: readonly AiWritingAttachment[]) => {
    const { mode: currentMode, docRefs: currentDocs } = composerRef.current;
    const cap = aiWritingModeCapabilities(currentMode);
    const allowedDocs = new Set(currentDocs.map((doc) => doc.id));
    setAttachRefs((prev) => {
      const seen = new Set(prev.map(aiWritingAttachmentKey));
      const merged = [...prev];
      for (const ref of refs) {
        if (merged.length >= AI_WRITING_MAX_ATTACHMENTS) break;
        if (isAiWritingLocalAttachment(ref) ? !cap.localFiles : !cap.docAssets) continue;
        if (!isAiWritingLocalAttachment(ref) && cap.attachmentsLimitedToDocs && !allowedDocs.has(ref.noteId)) continue;
        const key = aiWritingAttachmentKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(ref);
      }
      return merged;
    });
  }, []);

  const removeAttachment = useCallback((asset: AiWritingAttachment) => {
    const key = aiWritingAttachmentKey(asset);
    setAttachRefs((prev) => prev.filter((item) => aiWritingAttachmentKey(item) !== key));
  }, []);

  const clearAttachments = useCallback(() => setAttachRefs([]), []);

  /** 本机文件：主进程 dialog 选文件（只回引用/元数据），能力表禁止时给出可执行原因。 */
  /** 与主进程 AI_PASTED_IMAGE_MAX_BYTES 同口径（10MB/张；附件总数沿用 AI_WRITING_MAX_ATTACHMENTS）。 */
  const pasteImages = useCallback(async (files: File[]) => {
    const cap = aiWritingModeCapabilities(composerRef.current.mode);
    if (!cap.localFiles) {
      setLoadError("多文档推理只接受「所选文档里的附件」，不能粘贴图片；请切到「对话写作」再粘贴。");
      return;
    }
    const remaining = AI_WRITING_MAX_ATTACHMENTS - composerRef.current.attachRefs.length;
    if (remaining <= 0) {
      setLoadError("附件已达 " + AI_WRITING_MAX_ATTACHMENTS + " 个上限，请先移除部分附件再粘贴。");
      return;
    }
    const picked: AiWritingAttachment[] = [];
    for (const file of files.slice(0, remaining)) {
      if (!file.type.startsWith("image/")) {
        setLoadError("只能粘贴图片（剪贴板里的其它类型请用「从电脑选择文件」）。");
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setLoadError("粘贴图片过大：" + (file.name || "剪贴板图片") + "（上限 10MB）");
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        picked.push(await native.aiSavePastedImage(bytes, file.type, file.name || undefined));
      } catch (error) {
        setLoadError(getNativeErrorMessage(error) || "粘贴图片保存失败，请重试");
      }
    }
    if (files.length > remaining) setLoadError("一次最多 " + AI_WRITING_MAX_ATTACHMENTS + " 个附件：本次粘贴 " + files.length + " 张，只添加了前 " + remaining + " 张。");
    if (picked.length > 0) addAttachments(picked);
  }, [addAttachments]);

  const pickLocalFiles = useCallback(async () => {
    const cap = aiWritingModeCapabilities(composerRef.current.mode);
    if (!cap.localFiles) {
      setLoadError("多文档推理只允许「所选文档里的附件」，本机文件请切到「对话写作」。");
      return;
    }
    try {
      const refs = await native.pickAiLocalFiles();
      if (refs.length > 0) addAttachments(refs);
    } catch (error) {
      setLoadError(getNativeErrorMessage(error) || "选择本机文件失败");
    }
  }, [addAttachments]);

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
    // 先清空当前视图：否则加载期间会短暂看到上一篇（切换闪烁）。
    setMessages([]);
    setActiveConversation(null);
    void native.aiWritingGet(id)
      .then((payload) => {
        if (!payload) return;
        setActiveConversation(payload.conversation);
        setMessages(payload.messages);
        setModeState(payload.conversation.mode);
        setPromptTextState(payload.conversation.promptText);
        // 对话写作 = 纯对话：即使旧数据里存过 docRefs 也不加载（模式判据单一来源）。
        setDocRefsState(aiWritingModeCapabilities(payload.conversation.mode).docs ? payload.conversation.docRefs : []);
        setAttachRefs([]);
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
    setAttachRefs([]);
    setInput("");
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    try {
      const updated = await native.aiWritingRename(id, title);
      if (!updated) return;
      setConversations((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setActiveConversation((prev) => (prev && prev.id === id ? updated : prev));
    } catch (error) {
      setLoadError(getNativeErrorMessage(error) || "重命名失败");
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    // 正在生成的会话被删：先停流（否则请求结束后无处回填消息）。
    if (conversationRef.current?.id === id) turnRef.current?.stop();
    try {
      await native.aiWritingDelete(id);
      setConversations((prev) => prev.filter((item) => item.id !== id));
      if (conversationRef.current?.id === id) {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (error) {
      setLoadError(getNativeErrorMessage(error) || "删除失败");
    }
  }, []);

  // ---- 一轮生成：UI 占位 → 交给 turn → 回填占位消息 ----
  const runAssistant = useCallback(async (params: {
    conversation: AiWritingConversation;
    /** 请求上下文（**不含本轮 user**：本轮由 userText 单独组装，避免同一句问两遍）。 */
    history: AiWritingMessage[];
    /** 消息列表里占位前要显示的轮次（通常 = history + 本轮 user；重新生成时含 lastUser）。 */
    displayMessages?: AiWritingMessage[];
    userText: string;
    /** 本轮随发的附件（重新生成时沿用最后 user 消息的 attachRefs）。 */
    attachRefs?: readonly AiWritingAttachment[];
  }) => {
    const { conversation, history, displayMessages, userText, attachRefs: turnAttachments = [] } = params;
    const { mode: currentMode, promptText: currentPrompt, docRefs: currentRefs, thinking: currentThinking } = composerRef.current;
    busyRef.current = true;
    setBusy(true);
    setLoadError(null);

    try {
    const placeholder = await native.aiWritingAppendMessage({ conversationId: conversation.id, role: "assistant", content: "" });
    const base = [...(displayMessages ?? history), placeholder];
    setMessages(base);

    const docs = currentMode === "docs" ? await resolveAiWritingDocs(currentRefs, docReader) : [];
    const requestMessages = buildAiWritingMessages({
      mode: currentMode,
      input: userText,
      promptText: currentPrompt,
      docs,
      attachments: turnAttachments,
      docRefs: currentRefs,
      history: history.map((message) => ({ role: message.role, content: message.content })),
    });
    const turn = startAiWritingTurn({
      requestId: newAiRequestId(),
      messages: requestMessages,
      deps: { run: runAiChat, cancel: cancelAiChat },
      // 深度思考 = 请求级覆盖（261116）：不传 ≠ 关；传 "enabled"/"disabled" 才覆盖供应商默认值。
      options: { thinking: currentThinking ? "enabled" : "disabled" },
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
      // 带图失败：在 aiErrors 归类文案后补一句可执行提示（不维护视觉模型清单）。
      error: aiWritingAttachmentErrorHint(outcome.error, turnAttachments.length),
    });
    if (saved) setMessages(base.map((message) => (message.id === placeholder.id ? saved : message)));
    } catch (error) {
      // 占位消息写入失败 / 上下文读取异常：给出页面级错误，别把输入区永久卡在「生成中」。
      setLoadError(getNativeErrorMessage(error) || "发送失败");
    } finally {
      turnRef.current = null;
      setStream(null);
      busyRef.current = false;
      setBusy(false);
      // 历史列表的检索依据是 updated_at：轻量重拉一次排序。
      void native.aiWritingList().then((items) => setConversations(items)).catch(() => undefined);
    }
  }, [docReader]);

  // ---- 发送 ----
  const send = useCallback((override?: string) => {
    if (busyRef.current || sendingRef.current || loadingRef.current) return;
    const text = (override ?? input).trim();
    if (!text) return;
    sendingRef.current = true;
    const { mode: currentMode, promptText: currentPrompt, docRefs: currentRefs, attachRefs: pendingAttachments } = composerRef.current;
    // 请求前最后一道模式判据（UI 已 prune；防越权/脏数据）：chat 允许两类，docs 只留已选文档的资产图片。
    const currentAttachments = filterAiWritingAttachmentsForMode(currentMode, pendingAttachments, currentRefs);
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
        const userMessage = await native.aiWritingAppendMessage({
          conversationId: conversation.id,
          role: "user",
          content: text,
          ...(currentAttachments.length > 0 ? { attachRefs: [...currentAttachments] } : {}),
        });
        setInput("");
        // 附件只随这一轮：发出即清空待发列表（历史通过消息 attachRefs 展示，不重发）。
        if (currentAttachments.length > 0) setAttachRefs([]);
        await runAssistant({
          conversation,
          // 请求上下文不含本轮 user（历史上这里是 [...history, userMessage] 又把本轮拼一次 ⇒ 同一句问两遍）；
          // 显示列表单独传，气泡照常出现。
          history,
          displayMessages: [...history, userMessage],
          userText: text,
          attachRefs: currentAttachments,
        });
      } catch (error) {
        setLoadError(getNativeErrorMessage(error) || "发送失败");
      } finally {
        sendingRef.current = false;
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
    const lastUserIndex = list.toReversed().findIndex((message) => message.role === "user");
    if (lastUserIndex < 0) return;
    const index = list.length - 1 - lastUserIndex;
    const lastUser = list[index];
    const history = list.slice(0, index + 1);
    void (async () => {
      await native.aiWritingDeleteLastAssistant(conversation.id);
      await runAssistant({
        conversation,
        history: list.slice(0, index), // 上下文不含本轮 user
        displayMessages: history, // 列表里保留这条 user（重跑它的回答）
        userText: lastUser.content,
        attachRefs: lastUser.attachRefs ?? [],
      });
    })();
  }, [runAssistant]);

  return useMemo(() => ({
    conversations, activeConversation, messages, loading, loadError, busy, stream,
    mode, setMode, input, setInput, promptText, setPromptText, docRefs, setDocRefs,
    attachRefs, addAttachments, removeAttachment, clearAttachments, pickLocalFiles, pasteImages,
    thinking, setThinking,
    ready, aiEnabled, providerLabel: providerLabelOf(activeProviderId),
    newConversation, selectConversation, renameConversation, deleteConversation,
    send, stop, regenerate,
  }), [
    conversations, activeConversation, messages, loading, loadError, busy, stream,
    mode, setMode, input, promptText, setPromptText, docRefs, setDocRefs, attachRefs, addAttachments, removeAttachment, clearAttachments, pickLocalFiles, pasteImages, thinking,
    ready, aiEnabled, activeProviderId,
    newConversation, selectConversation, renameConversation, deleteConversation, send, stop, regenerate,
  ]);
}
