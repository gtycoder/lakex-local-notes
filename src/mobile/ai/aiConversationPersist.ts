/**
 * AI 历史对话的**文件正文**与序列化（261023 P1.6，多会话）。
 *
 * 分工：
 *  · 正文（消息 + 资料快照）→ App 私有 Data `ai/conversations/{id}.json`（BodyStore 原子写，≤2 MiB/份）；
 *  · 列表/搜索/淘汰元数据 → SQLite `ai_conversations`（见 data/aiConversationRepository.ts）；
 *  · **不进 S3、不跨设备、不存 API Key / baseUrl / 温度**；
 *  · 旧版单文件 `ai/last-conversation.json`（v1）在启动时迁移成一条会话后删除。
 */
import type { AiConversationMeta } from "../data/aiConversationRepository";
import { isValidImageRef, type AiStoredImageRef } from "./aiImageStore";
import { getBodyStore } from "../native/bodyStore";

export const AI_CONVERSATION_DIR = "ai/conversations";
export const AI_CONVERSATION_VERSION = 2;
export const AI_CONVERSATION_MAX_BYTES = 2 * 1024 * 1024;
export const AI_CONVERSATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 旧版单会话文件（v1，仅迁移用）。 */
export const AI_LEGACY_PATH = "ai/last-conversation.json";

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface StoredAiMessage {
  role: "user" | "assistant";
  text: string;
  stopped?: boolean;
  error?: { message: string; retryable: boolean };
  /** 存档图片引用（字节在 ai/conversations/{id}/images/，JSON 不存 base64）。 */
  images?: AiStoredImageRef[];
}

export interface StoredAiConversation {
  v: number;
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  corpus: Array<{ id: string; title: string; text: string; totalChars: number }>;
  sendIds: string[];
  messages: StoredAiMessage[];
}

export interface ConversationSnapshot {
  id: string;
  createdAt: string;
  corpus: Array<{ id: string; title: string; text: string; totalChars: number }>;
  sendIds: string[];
  messages: Array<{ role: "user" | "assistant"; text: string; streaming?: boolean; stopped?: boolean; error?: { message: string; retryable: boolean }; images?: AiStoredImageRef[] }>;
}

export interface SerializedConversation {
  json: string;
  meta: AiConversationMeta;
}

/** 会话标题：首条用户消息前 30 字；没有就「AI 对话」。 */
export function conversationTitle(messages: readonly { role: string; text: string }[]): string {
  const first = messages.find((message) => message.role === "user" && message.text.trim());
  const title = (first?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
  return title || "AI 对话";
}

/** 列表副标题/搜索用摘录：首问 + 最后一条回答（≤240 字）。 */
export function conversationPreview(messages: readonly { role: string; text: string }[]): string {
  const firstUser = messages.find((message) => message.role === "user" && message.text.trim())?.text ?? "";
  const lastAnswer = [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim())?.text ?? "";
  return (firstUser.replace(/\s+/g, " ").trim() + " " + lastAnswer.replace(/\s+/g, " ").trim()).trim().slice(0, 240);
}

/** 序列化 + 生成索引元数据；空会话/超限返回 null。纯函数，可单测。 */
export function serializeConversation(snapshot: ConversationSnapshot, now: number = Date.now()): SerializedConversation | null {
  const messages: StoredAiMessage[] = [];
  for (const message of snapshot.messages) {
    if (!message.text && !message.error) continue;
    const images = (message.images ?? []).filter(isValidImageRef).map((image) => ({ id: image.id, mime: image.mime, ext: image.ext }));
    messages.push({
      role: message.role,
      text: message.text,
      ...(message.stopped || message.streaming ? { stopped: true } : {}),
      ...(message.error ? { error: message.error } : {}),
      ...(images.length > 0 ? { images } : {}),
    });
  }
  if (messages.length === 0 && snapshot.corpus.length === 0) return null;
  const payload: StoredAiConversation = {
    v: AI_CONVERSATION_VERSION,
    id: snapshot.id,
    title: conversationTitle(messages),
    preview: conversationPreview(messages),
    createdAt: snapshot.createdAt,
    updatedAt: new Date(now).toISOString(),
    corpus: snapshot.corpus.map((doc) => ({ id: doc.id, title: doc.title, text: doc.text, totalChars: doc.totalChars })),
    sendIds: [...snapshot.sendIds],
    messages,
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > AI_CONVERSATION_MAX_BYTES) return null;
  return {
    json,
    meta: {
      id: payload.id,
      title: payload.title,
      preview: payload.preview,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      messageCount: messages.length,
      bytes,
      docs: payload.corpus.map((doc) => ({ id: doc.id, title: doc.title })),
    },
  };
}

/** 反序列化（版本/过期/损坏/超限/空 ⇒ null）。纯函数，可单测。 */
export function parseConversation(raw: string | null, now: number = Date.now()): StoredAiConversation | null {
  if (!raw) return null;
  if (new TextEncoder().encode(raw).length > AI_CONVERSATION_MAX_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const data = parsed as Partial<StoredAiConversation>;
  if (!data || data.v !== AI_CONVERSATION_VERSION) return null;
  if (typeof data.id !== "string" || !ID_RE.test(data.id)) return null;
  if (typeof data.createdAt !== "string" || typeof data.updatedAt !== "string") return null;
  const updated = Date.parse(data.updatedAt);
  if (!Number.isFinite(updated) || now - updated > AI_CONVERSATION_TTL_MS) return null;
  if (!Array.isArray(data.messages) || !Array.isArray(data.corpus) || !Array.isArray(data.sendIds)) return null;
  const messages: StoredAiMessage[] = [];
  for (const message of data.messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    if (typeof message.text !== "string") continue;
    const images = Array.isArray(message.images) ? message.images.filter(isValidImageRef).map((image) => ({ id: image.id, mime: image.mime, ext: image.ext })) : [];
    messages.push({
      role: message.role,
      text: message.text,
      ...(message.stopped ? { stopped: true } : {}),
      ...(message.error && typeof message.error.message === "string"
        ? { error: { message: message.error.message, retryable: Boolean(message.error.retryable) } }
        : {}),
      ...(images.length > 0 ? { images } : {}),
    });
  }
  const corpus = data.corpus
    .filter((doc) => doc && typeof doc.id === "string" && typeof doc.title === "string" && typeof doc.text === "string" && typeof doc.totalChars === "number")
    .map((doc) => ({ id: doc.id, title: doc.title, text: doc.text, totalChars: doc.totalChars }));
  const sendIds = data.sendIds.filter((id): id is string => typeof id === "string" && corpus.some((doc) => doc.id === id));
  if (messages.length === 0 && corpus.length === 0) return null;
  return {
    v: AI_CONVERSATION_VERSION,
    id: data.id,
    title: typeof data.title === "string" && data.title ? data.title : conversationTitle(messages),
    preview: typeof data.preview === "string" ? data.preview : conversationPreview(messages),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    corpus,
    sendIds,
    messages,
  };
}

/** v1 旧文件（单会话）→ v2（生成 id/createdAt）。 */
export function parseLegacyConversation(raw: string | null, id: string, now: number = Date.now()): StoredAiConversation | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const data = parsed as { v?: unknown; updatedAt?: unknown; corpus?: unknown; sendIds?: unknown; messages?: unknown };
  if (!data || data.v !== 1 || typeof data.updatedAt !== "string" || !Array.isArray(data.messages) || !Array.isArray(data.corpus)) return null;
  const updated = Date.parse(data.updatedAt);
  if (!Number.isFinite(updated) || now - updated > AI_CONVERSATION_TTL_MS) return null;
  const migrated = JSON.stringify({ ...data, v: AI_CONVERSATION_VERSION, id, createdAt: data.updatedAt, title: undefined, preview: undefined });
  return parseConversation(migrated, now);
}

export function conversationFilePath(id: string): string {
  if (!ID_RE.test(id)) throw new Error("非法会话 id");
  return AI_CONVERSATION_DIR + "/" + id + ".json";
}

export async function readConversationFile(id: string): Promise<StoredAiConversation | null> {
  try {
    const raw = await getBodyStore().readText(conversationFilePath(id));
    return parseConversation(raw);
  } catch {
    return null;
  }
}

export async function writeConversationFile(snapshot: ConversationSnapshot): Promise<AiConversationMeta | null> {
  const serialized = serializeConversation(snapshot);
  if (!serialized) return null;
  const body = getBodyStore();
  await body.writeText(conversationFilePath(snapshot.id), serialized.json);
  return serialized.meta;
}

export async function deleteConversationFile(id: string): Promise<void> {
  try { await getBodyStore().remove(conversationFilePath(id)); } catch { /* 不存在/失败都算删掉 */ }
}

export async function readLegacyConversationFile(): Promise<string | null> {
  try { return await getBodyStore().readText(AI_LEGACY_PATH); } catch { return null; }
}

export async function deleteLegacyConversationFile(): Promise<void> {
  try { await getBodyStore().remove(AI_LEGACY_PATH); } catch { /* 不存在 */ }
}
