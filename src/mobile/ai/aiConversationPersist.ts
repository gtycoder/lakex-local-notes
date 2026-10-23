/**
 * AI 会话的**设备本地持久化**（261023 P1.5，用户定稿：只保留最近一次）。
 *
 * 边界：
 *  · 只存 **App 私有 Data**（BodyStore 原子写，路径 `ai/last-conversation.json`）；**不进 S3、不跨设备**；
 *  · 存消息 + 资料快照（冻结时的正文），打开时可原样恢复；**不存 API Key / baseUrl / 温度**（设置各存各的）；
 *  · 上限：单份 ≤ 2 MiB；超过 30 天视为过期（读时删除）；JSON 损坏/版本不符直接丢弃；
 *  · 流式中的半截回答也会存（restore 时标「已停止」），避免杀掉 App 后什么都看不到。
 */
import { getBodyStore } from "../native/bodyStore";

export const AI_CONVERSATION_PATH = "ai/last-conversation.json";
export const AI_CONVERSATION_VERSION = 1;
export const AI_CONVERSATION_MAX_BYTES = 2 * 1024 * 1024;
export const AI_CONVERSATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoredAiMessage {
  role: "user" | "assistant";
  text: string;
  stopped?: boolean;
  error?: { message: string; retryable: boolean };
}

export interface StoredAiConversation {
  v: number;
  updatedAt: string;
  corpus: Array<{ id: string; title: string; text: string; totalChars: number }>;
  sendIds: string[];
  messages: StoredAiMessage[];
}

export interface ConversationSnapshot {
  corpus: Array<{ id: string; title: string; text: string; totalChars: number }>;
  sendIds: string[];
  messages: Array<{ role: "user" | "assistant"; text: string; streaming?: boolean; stopped?: boolean; error?: { message: string; retryable: boolean } }>;
}

/** 序列化（超限/空会话返回 null，调用方不写盘）。纯函数，可单测。 */
export function serializeConversation(snapshot: ConversationSnapshot, now: number = Date.now()): string | null {
  const messages: StoredAiMessage[] = [];
  for (const message of snapshot.messages) {
    if (!message.text && !message.error) continue;
    messages.push({
      role: message.role,
      text: message.text,
      ...(message.stopped || message.streaming ? { stopped: true } : {}),
      ...(message.error ? { error: message.error } : {}),
    });
  }
  if (messages.length === 0 && snapshot.corpus.length === 0) return null;
  const payload: StoredAiConversation = {
    v: AI_CONVERSATION_VERSION,
    updatedAt: new Date(now).toISOString(),
    corpus: snapshot.corpus.map((doc) => ({ id: doc.id, title: doc.title, text: doc.text, totalChars: doc.totalChars })),
    sendIds: [...snapshot.sendIds],
    messages,
  };
  const json = JSON.stringify(payload);
  return new TextEncoder().encode(json).length <= AI_CONVERSATION_MAX_BYTES ? json : null;
}

/** 反序列化（版本/过期/损坏/超限/空 ⇒ null）。纯函数，可单测。 */
export function parseConversation(raw: string | null, now: number = Date.now()): StoredAiConversation | null {
  if (!raw) return null;
  if (new TextEncoder().encode(raw).length > AI_CONVERSATION_MAX_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const data = parsed as Partial<StoredAiConversation>;
  if (!data || data.v !== AI_CONVERSATION_VERSION) return null;
  if (typeof data.updatedAt !== "string") return null;
  const updated = Date.parse(data.updatedAt);
  if (!Number.isFinite(updated) || now - updated > AI_CONVERSATION_TTL_MS) return null;
  if (!Array.isArray(data.messages) || !Array.isArray(data.corpus) || !Array.isArray(data.sendIds)) return null;
  const messages: StoredAiMessage[] = [];
  for (const message of data.messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    if (typeof message.text !== "string") continue;
    messages.push({
      role: message.role,
      text: message.text,
      ...(message.stopped ? { stopped: true } : {}),
      ...(message.error && typeof message.error.message === "string"
        ? { error: { message: message.error.message, retryable: Boolean(message.error.retryable) } }
        : {}),
    });
  }
  const corpus = data.corpus
    .filter((doc) => doc && typeof doc.id === "string" && typeof doc.title === "string" && typeof doc.text === "string" && typeof doc.totalChars === "number")
    .map((doc) => ({ id: doc.id, title: doc.title, text: doc.text, totalChars: doc.totalChars }));
  const sendIds = data.sendIds.filter((id): id is string => typeof id === "string" && corpus.some((doc) => doc.id === id));
  if (messages.length === 0 && corpus.length === 0) return null;
  return { v: AI_CONVERSATION_VERSION, updatedAt: data.updatedAt, corpus, sendIds, messages };
}

// ---- 存储（BodyStore） ----

export async function readLastConversation(): Promise<StoredAiConversation | null> {
  try {
    const raw = await getBodyStore().readText(AI_CONVERSATION_PATH);
    return parseConversation(raw);
  } catch {
    return null;
  }
}

/** 返回是否写入成功（超限/空会话返回 false，不抛）。 */
export async function writeLastConversation(snapshot: ConversationSnapshot): Promise<boolean> {
  const json = serializeConversation(snapshot);
  if (!json) {
    await clearLastConversation();
    return false;
  }
  try {
    await getBodyStore().writeText(AI_CONVERSATION_PATH, json);
    return true;
  } catch {
    return false;
  }
}

export async function clearLastConversation(): Promise<void> {
  try { await getBodyStore().remove(AI_CONVERSATION_PATH); } catch { /* 不存在/失败都算清空 */ }
}
