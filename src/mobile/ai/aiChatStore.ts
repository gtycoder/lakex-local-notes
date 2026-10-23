/**
 * 移动端 AI 会话控制器（261023，解决「关掉 AI 页就丢回答」）。
 *
 * 生命周期（用户 261023 定）：
 *  · **页离开 ≠ 会话结束**：状态放在模块级 store 里，流式订阅常驻 → 关闭 AI 页、回首页、切后台，
 *    后台请求继续跑、delta 继续累积；再进 AI 页能看到完整回答；
 *  · **App 进程结束 = 会话结束**（不持久化，与 D2 一致）：新进程从空会话开始；
 *  · 「新对话」显式清空。
 *
 * 页面只做渲染 + 调 action；所有网络/装配/流式状态都收在这里（单一来源）。
 */
import { assertMessages } from "../../core/aiChatMessages";
import { buildAiSystemPrompt } from "../../core/aiCorpus";
import { aiErrorInfoFromCode } from "../../core/aiErrors";
import { aiCanTouchNetwork, aiNetworkHint } from "../../core/aiNetwork";
import { AI_SYSTEM_PROMPT } from "../../features/ai/aiPrompts";
import { bridge } from "../bridge";
import { onAiStream, type AiChatSettingsView } from "../native/aiChat";
import { clearLastConversation, readLastConversation, writeLastConversation } from "./aiConversationPersist";
import { loadAiEnabled } from "./aiSettings";
import {
  AI_CORPUS_MAX_DOCS,
  AI_CORPUS_MIN_CHARS,
  buildChatMessages,
  corpusBlockOf,
  takeCorpus,
  type ChatTurn,
} from "./aiSession";

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  stopped?: boolean;
  error?: { message: string; retryable: boolean };
}

export interface AiCorpusDoc {
  id: string;
  title: string;
  text: string;
  totalChars: number;
}

export interface AiChatState {
  enabled: boolean;
  settings: AiChatSettingsView | null;
  messages: AiMessage[];
  busy: boolean;
  corpus: AiCorpusDoc[];
  sendIds: string[];
}

export type SendOutcome = { ok: true } | { ok: false; reason: string };

const EMPTY: AiChatState = { enabled: false, settings: null, messages: [], busy: false, corpus: [], sendIds: [] };

let state: AiChatState = EMPTY;
let snapshot: AiChatState = EMPTY;
const listeners = new Set<() => void>();

function set(patch: Partial<AiChatState>): void {
  state = { ...state, ...patch };
  snapshot = state;
  for (const listener of listeners) listener();
  schedulePersist();
}

function replaceLastAssistant(patch: Partial<AiMessage>): void {
  set({ messages: state.messages.map((m, i) => (i === state.messages.length - 1 && m.role === "assistant" ? { ...m, ...patch } : m)) });
}

export function getSnapshot(): AiChatState {
  return snapshot;
}

// ---- 设备本地持久化（只保留最近一次；1s 防抖写；不含 Key/端点）----
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight = false;
let restoreStarted = false;

function schedulePersist(): void {
  if (typeof setTimeout !== "function") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 1000);
}

async function persistNow(): Promise<void> {
  if (persistInFlight) { schedulePersist(); return; }
  persistInFlight = true;
  try {
    await writeLastConversation({ corpus: state.corpus, sendIds: state.sendIds, messages: state.messages });
  } finally {
    persistInFlight = false;
  }
}

/** 启动时恢复最近一次会话（只恢复一次；已有活动会话则不覆盖）。 */
async function restorePersisted(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;
  if (state.messages.length > 0) return;
  const saved = await readLastConversation();
  if (!saved || state.messages.length > 0) return;
  set({
    corpus: saved.corpus,
    sendIds: saved.sendIds,
    messages: saved.messages.map((message) => ({
      id: crypto.randomUUID(),
      role: message.role,
      text: message.text,
      streaming: false,
      ...(message.stopped ? { stopped: true } : {}),
      ...(message.error ? { error: message.error } : {}),
    })),
    busy: false,
  });
}

/** 清空「已保存的对话」（设置页入口；同时清掉当前内存会话与落盘文件）。 */
export async function clearPersistedConversation(): Promise<void> {
  restoreStarted = true;
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  newConversation();
  await clearLastConversation();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- 原生流（模块级常驻：页面关掉也不丢 delta）----
let nativeReady = false;
let activeRequestId: string | null = null;
let assistantText = "";
let rafHandle = 0;
let settingsLoading = false;

function flushAssistant(): void {
  rafHandle = 0;
  replaceLastAssistant({ text: assistantText });
}

function ensureNative(): void {
  if (nativeReady) return;
  nativeReady = true;
  onAiStream({
    onDelta: (event) => {
      if (event.requestId !== activeRequestId) return;
      assistantText += event.delta;
      if (!rafHandle && typeof requestAnimationFrame === "function") rafHandle = requestAnimationFrame(flushAssistant);
      else if (!rafHandle) flushAssistant();
    },
    onError: (event) => {
      if (event.requestId !== activeRequestId) return;
      const info = aiErrorInfoFromCode({ code: event.code, status: event.status, detail: event.detail });
      activeRequestId = null;
      set({ busy: false });
      replaceLastAssistant({ streaming: false, error: { message: info.message, retryable: info.retryable } });
    },
    onDone: (event) => {
      if (event.requestId !== activeRequestId) return;
      activeRequestId = null;
      if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
      set({ busy: false });
      replaceLastAssistant({ streaming: false, text: assistantText });
    },
  });
}

/** 页面每次打开都调（幂等）：首次装载开关/设置 + 订阅原生流。 */
export function init(): void {
  ensureNative();
  void restorePersisted();
  if (state.settings || settingsLoading) return;
  settingsLoading = true;
  set({ enabled: loadAiEnabled() });
  void bridge.aiGetSettings()
    .then((settings) => { settingsLoading = false; set({ settings }); })
    .catch(() => { settingsLoading = false; });
}

export function refreshSettings(): void {
  settingsLoading = false;
  void bridge.aiGetSettings().then((settings) => set({ settings })).catch(() => undefined);
}

// ---- 会话/资料 ----
export function newConversation(): void {
  if (activeRequestId) void bridge.aiCancel(activeRequestId).catch(() => undefined);
  activeRequestId = null;
  assistantText = "";
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  set({ messages: [], busy: false, corpus: [], sendIds: [] });
  void clearLastConversation();
}

export function addCorpusDoc(doc: AiCorpusDoc): string | null {
  if (state.messages.length > 0) return "本会话资料已固定；换资料请新开对话";
  if (state.corpus.some((item) => item.id === doc.id)) return null;
  if (state.corpus.length >= AI_CORPUS_MAX_DOCS) return "最多选 " + AI_CORPUS_MAX_DOCS + " 篇资料";
  if (doc.totalChars < AI_CORPUS_MIN_CHARS) return "这篇文档内容太少，不适合作为资料";
  set({ corpus: [...state.corpus, doc], sendIds: [...state.sendIds, doc.id] });
  return null;
}

export function removeCorpusDoc(id: string): void {
  set({ corpus: state.corpus.filter((doc) => doc.id !== id), sendIds: state.sendIds.filter((value) => value !== id) });
}

export function toggleSend(id: string): void {
  set({ sendIds: state.sendIds.includes(id) ? state.sendIds.filter((value) => value !== id) : [...state.sendIds, id] });
}

export function setAllSend(on: boolean): void {
  set({ sendIds: on ? state.corpus.map((doc) => doc.id) : [] });
}

// ---- 发送 ----
export async function send(raw: string, historyOverride?: ChatTurn[]): Promise<SendOutcome> {
  const question = raw.trim();
  if (!question) return { ok: false, reason: "" };
  if (state.busy) return { ok: false, reason: "正在生成中" };
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!state.enabled) return { ok: false, reason: aiNetworkHint({ aiEnabled: false, online }) };
  if (!aiCanTouchNetwork({ aiEnabled: true, online })) return { ok: false, reason: aiNetworkHint({ aiEnabled: true, online }) };

  const budget = takeCorpus(state.corpus.filter((doc) => state.sendIds.includes(doc.id)));
  const corpusBlock = corpusBlockOf(budget);
  const history: ChatTurn[] = historyOverride ?? state.messages
    .filter((message) => !message.error && message.text.trim().length > 0)
    .map((message) => ({ role: message.role, text: message.text }));
  let payload;
  try {
    const guarded = assertMessages(buildChatMessages({
      system: buildAiSystemPrompt(AI_SYSTEM_PROMPT, Boolean(corpusBlock)),
      corpusBlock,
      history,
      question,
    }));
    payload = guarded.map((message) => ({
      role: message.role,
      content: typeof message.content === "string"
        ? message.content
        : message.content.filter((part) => part.type === "text").map((part) => (part.type === "text" ? part.text : "")).join(""),
    }));
  } catch (error) {
    return { ok: false, reason: (error as Error).message || "内容过长" };
  }

  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  assistantText = "";
  set({
    busy: true,
    messages: [
      ...state.messages,
      { id: crypto.randomUUID(), role: "user", text: question },
      { id: crypto.randomUUID(), role: "assistant", text: "", streaming: true },
    ],
  });
  try {
    const result = await bridge.aiChat({ requestId, messages: payload, model: state.settings?.model });
    if (!result.ok) {
      const info = aiErrorInfoFromCode({ code: result.code, status: result.status, detail: result.detail });
      activeRequestId = null;
      set({ busy: false });
      replaceLastAssistant({ streaming: false, error: { message: info.message, retryable: info.retryable } });
      return { ok: true };
    }
    if (!assistantText && result.text) assistantText = result.text;
    if (activeRequestId === requestId) {
      activeRequestId = null;
      set({ busy: false });
      replaceLastAssistant({ streaming: false, text: assistantText });
    }
    return { ok: true };
  } catch (error) {
    const info = aiErrorInfoFromCode({ detail: (error as Error).message });
    activeRequestId = null;
    set({ busy: false });
    replaceLastAssistant({ streaming: false, error: { message: info.message, retryable: info.retryable } });
    return { ok: true };
  }
}

export async function stop(): Promise<void> {
  const requestId = activeRequestId;
  if (!requestId) return;
  activeRequestId = null;
  await bridge.aiCancel(requestId).catch(() => undefined);
  set({ busy: false });
  replaceLastAssistant({ streaming: false, stopped: true, text: assistantText });
}

/** 重试某个回答：丢掉该问题之后的问答，用同一问题重新发送。 */
export async function retry(question: string): Promise<void> {
  if (!question) return;
  let cut = state.messages.length;
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i].role === "user" && state.messages[i].text === question) { cut = i; break; }
  }
  const before = state.messages.slice(0, cut);
  const history: ChatTurn[] = before
    .filter((message) => !message.error && message.text.trim().length > 0)
    .map((message) => ({ role: message.role, text: message.text }));
  set({ messages: before });
  await send(question, history);
}
