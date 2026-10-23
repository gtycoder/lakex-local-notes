/**
 * 移动端 AI 会话控制器（261023；P1.6 多会话历史）。
 *
 * 生命周期：
 *  · 页离开 ≠ 会话结束：状态在模块级 store + 常驻流订阅 → 后台继续、再进来能看完整回答；
 *  · App 进程结束：内存丢失，启动时从**设备本地**恢复「最近一次」会话；
 *  · 历史：每次会话落 `ai/conversations/{id}.json` + SQLite 索引，可列表/搜索/切回/删除；
 *  · 不存 Key/端点/温度，不进 S3。
 */
import { assertMessages } from "../../core/aiChatMessages";
import { buildAiSystemPrompt } from "../../core/aiCorpus";
import { aiErrorInfoFromCode } from "../../core/aiErrors";
import { aiCanTouchNetwork, aiNetworkHint } from "../../core/aiNetwork";
import { AI_SYSTEM_PROMPT } from "../../features/ai/aiPrompts";
import { bridge } from "../bridge";
import { ensureDb } from "../bridge/context";
import {
  deleteAiConversation,
  latestAiConversationId,
  listAiConversations,
  listAiConversationIds,
  listAllAiConversations,
  pickPruneIds,
  upsertAiConversation,
  type AiConversationMeta,
} from "../data/aiConversationRepository";
import { onAiStream, type AiChatSettingsView, type AiRequestPart } from "../native/aiChat";
import { imagePartsOf, type AiPendingImage } from "./aiImages";
import {
  conversationFilePath,
  deleteConversationFile,
  deleteLegacyConversationFile,
  parseLegacyConversation,
  readConversationFile,
  readLegacyConversationFile,
  writeConversationFile,
  type StoredAiConversation,
} from "./aiConversationPersist";
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

let currentId: string | null = null;
let currentCreatedAt: string | null = null;
let suppressPersist = false;
/** 上次写入的内容指纹（不含时间）：避免启动恢复后把 updatedAt 刷新、打乱历史排序。 */
let lastFingerprint = "";

function contentFingerprint(): string {
  return JSON.stringify({
    c: state.corpus.map((doc) => [doc.id, doc.title, doc.totalChars]),
    s: state.sendIds,
    m: state.messages.map((message) => [message.role, message.text, Boolean(message.stopped), message.error?.message ?? ""]),
  });
}

function set(patch: Partial<AiChatState>): void {
  state = { ...state, ...patch };
  snapshot = state;
  for (const listener of listeners) listener();
  if (!suppressPersist) schedulePersist();
}

function replaceLastAssistant(patch: Partial<AiMessage>): void {
  set({ messages: state.messages.map((m, i) => (i === state.messages.length - 1 && m.role === "assistant" ? { ...m, ...patch } : m)) });
}

export function getSnapshot(): AiChatState {
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- 持久化（1s 防抖写；会话文件 + SQLite 索引）----
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

function ensureCurrentId(): { id: string; createdAt: string } | null {
  if (!currentId || !currentCreatedAt) {
    currentId = crypto.randomUUID();
    currentCreatedAt = new Date().toISOString();
  }
  return { id: currentId, createdAt: currentCreatedAt };
}

async function pruneConversations(): Promise<void> {
  try {
    const db = await ensureDb();
    const all = await listAllAiConversations(db);
    for (const id of pickPruneIds(all)) {
      await deleteAiConversation(db, id);
      await deleteConversationFile(id);
      if (id === currentId) { currentId = null; currentCreatedAt = null; }
    }
  } catch { /* 淘汰失败不影响对话 */ }
}

async function persistNow(): Promise<void> {
  if (persistInFlight) { schedulePersist(); return; }
  if (state.messages.length === 0 && state.corpus.length === 0) return;
  const fingerprint = contentFingerprint();
  if (fingerprint === lastFingerprint) return;
  const ids = ensureCurrentId();
  if (!ids) return;
  persistInFlight = true;
  try {
    const meta = await writeConversationFile({ id: ids.id, createdAt: ids.createdAt, corpus: state.corpus, sendIds: state.sendIds, messages: state.messages });
    if (!meta) return;
    const db = await ensureDb();
    await upsertAiConversation(db, meta);
    lastFingerprint = fingerprint;
    await pruneConversations();
  } catch { /* 落盘失败不打断对话（下次变更会再试） */ }
  finally { persistInFlight = false; }
}

function toMessages(stored: StoredAiConversation): AiMessage[] {
  return stored.messages.map((message) => ({
    id: crypto.randomUUID(),
    role: message.role,
    text: message.text,
    streaming: false,
    ...(message.stopped ? { stopped: true } : {}),
    ...(message.error ? { error: message.error } : {}),
  }));
}

function applyStored(stored: StoredAiConversation): void {
  currentId = stored.id;
  currentCreatedAt = stored.createdAt;
  suppressPersist = true;
  set({ messages: toMessages(stored), corpus: stored.corpus, sendIds: stored.sendIds, busy: false });
  suppressPersist = false;
  // 恢复的内容即落盘内容：不因「打开 App/切会话」刷新 updatedAt。
  lastFingerprint = contentFingerprint();
}

/** 旧版单文件（v1）迁移成一条历史会话。 */
async function migrateLegacy(): Promise<string | null> {
  const raw = await readLegacyConversationFile();
  if (!raw) return null;
  const id = crypto.randomUUID();
  const stored = parseLegacyConversation(raw, id);
  await deleteLegacyConversationFile();
  if (!stored) return null;
  const meta = await writeConversationFile({ id, createdAt: stored.createdAt, corpus: stored.corpus, sendIds: stored.sendIds, messages: stored.messages });
  if (!meta) return null;
  const db = await ensureDb();
  await upsertAiConversation(db, meta);
  return id;
}

async function restoreLatest(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;
  if (state.messages.length > 0) return;
  try {
    const db = await ensureDb();
    await pruneConversations();
    let id = await latestAiConversationId(db);
    if (!id) id = await migrateLegacy();
    if (!id) return;
    if (state.messages.length > 0) return;
    const stored = await readConversationFile(id);
    if (!stored) { await deleteAiConversation(db, id); return; }
    applyStored(stored);
  } catch { /* 恢复失败从空会话开始 */ }
}

/** 历史列表 / 搜索（title + preview）。 */
export async function listConversations(query = ""): Promise<AiConversationMeta[]> {
  const db = await ensureDb();
  return await listAiConversations(db, query);
}

/** 只读取某条历史会话（不切换当前会话；历史详情页用）。 */
export async function readConversationDetail(id: string): Promise<StoredAiConversation | null> {
  return readConversationFile(id);
}

/** 切到某条历史会话（会先取消在途请求）。 */
export async function openConversation(id: string): Promise<boolean> {
  if (activeRequestId) {
    await bridge.aiCancel(activeRequestId).catch(() => undefined);
    activeRequestId = null;
    assistantText = "";
    if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
  }
  try {
    const stored = await readConversationFile(id);
    if (!stored) {
      const db = await ensureDb();
      await deleteAiConversation(db, id);
      return false;
    }
    applyStored(stored);
    return true;
  } catch {
    return false;
  }
}

/** 删除一条历史会话；删的是当前会话时回到空白新会话。 */
export async function deleteConversation(id: string): Promise<void> {
  try {
    const db = await ensureDb();
    await deleteAiConversation(db, id);
    await deleteConversationFile(id);
  } catch { /* 忽略 */ }
  if (id === currentId) {
    currentId = null;
    currentCreatedAt = null;
    lastFingerprint = "";
    suppressPersist = true;
    set({ messages: [], corpus: [], sendIds: [], busy: false });
    suppressPersist = false;
  }
}

/** 清空全部历史（设置页入口）。 */
export async function clearAllConversations(): Promise<void> {
  restoreStarted = true;
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (activeRequestId) { await bridge.aiCancel(activeRequestId).catch(() => undefined); activeRequestId = null; }
  try {
    const db = await ensureDb();
    for (const id of await listAiConversationIds(db)) {
      await deleteAiConversation(db, id);
      await deleteConversationFile(id);
    }
  } catch { /* 忽略 */ }
  await deleteLegacyConversationFile();
  currentId = null;
  currentCreatedAt = null;
  lastFingerprint = "";
  suppressPersist = true;
  set({ messages: [], corpus: [], sendIds: [], busy: false });
  suppressPersist = false;
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

/** 页面每次打开都调（幂等）：装载开关/设置、订阅原生流、恢复最近一次会话。 */
export function init(): void {
  ensureNative();
  void restoreLatest();
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
  currentId = null;
  currentCreatedAt = null;
  lastFingerprint = "";
  suppressPersist = true;
  set({ messages: [], busy: false, corpus: [], sendIds: [] });
  suppressPersist = false;
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
export interface SendOptions {
  /** 本轮图片（拍照/相册临时图 + 资料里的图片引用）；不落历史、只随这一问发送。 */
  images?: readonly AiPendingImage[];
  history?: ChatTurn[];
}

export async function send(raw: string, options: SendOptions = {}): Promise<SendOutcome> {
  const question = raw.trim();
  if (!question) return { ok: false, reason: "" };
  if (state.busy) return { ok: false, reason: "正在生成中" };
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!state.enabled) return { ok: false, reason: aiNetworkHint({ aiEnabled: false, online }) };
  if (!aiCanTouchNetwork({ aiEnabled: true, online })) return { ok: false, reason: aiNetworkHint({ aiEnabled: true, online }) };

  const budget = takeCorpus(state.corpus.filter((doc) => state.sendIds.includes(doc.id)));
  const corpusBlock = corpusBlockOf(budget);
  const history: ChatTurn[] = options.history ?? state.messages
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
    const images = imagePartsOf(options.images ?? []);
    payload = guarded.map((message, index) => {
      const text = typeof message.content === "string"
        ? message.content
        : message.content.filter((part) => part.type === "text").map((part) => (part.type === "text" ? part.text : "")).join("");
      const isLastUser = index === guarded.length - 1 && message.role === "user";
      const content: string | AiRequestPart[] = isLastUser && images.length > 0
        ? [{ type: "text", text }, ...images]
        : text;
      return { role: message.role, content };
    });
  } catch (error) {
    return { ok: false, reason: (error as Error).message || "内容过长" };
  }

  const displayText = question + ((options.images?.length ?? 0) > 0 ? "\n[图片]" : "");
  ensureCurrentId();
  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  assistantText = "";
  set({
    busy: true,
    messages: [
      ...state.messages,
      { id: crypto.randomUUID(), role: "user", text: displayText },
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
  await send(question, { history });
}

/** 当前会话 id（调试/测试用；正常 UI 不需要）。 */
export function currentConversationId(): string | null {
  return currentId;
}

export { conversationFilePath };
