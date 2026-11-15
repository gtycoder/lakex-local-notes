/**
 * 桌面 AI 助手对话的「消息版本 / 分支」模型（261116，用户裁决：与 chat-demo 同语义）。
 *
 * 线性 turns → 树 + 当前路径：
 * - 每条消息记 id / parentId / selectedChildId，会话只存 rootId + messages[]；
 * - visiblePath() 从 rootId 沿 selectedChildId 走到叶子 = 当前显示，也是下一次请求的上下文；
 * - versionsOf() 取同一 parentId 下的兄弟版本（◀ n/m ▶ 按 messages[] 顺序编号）；
 * - 重新生成 = 同一用户提问下追加助手兄弟并选中它（旧回答保留）；
 * - 编辑提问 = 同一 parentId 下追加用户兄弟并选中它（后续消息走新分支，旧分支保留）。
 *
 * 参考 deepseek-ai/chat-demo 的 `src/services/chat/branches.ts`，但**不**照搬 zustand / IndexedDB：
 * 这里全是纯函数，React 状态由 useAiConversation 持有。聊天记录是本地数据 ⇒ 格式只认当前
 * schemaVersion，旧格式读取时直接给空会话，**不写迁移**（AGENTS §3#7「能删了重建就不写兼容」）。
 */
import type { AiChatMessage } from "../../core/aiProviders";

/** 本地会话格式版本；读取时不等即丢弃（旧格式没有这个字段 ⇒ 同样丢弃）。 */
export const AI_CONVERSATION_SCHEMA_VERSION = 1;

export type AiTurnRole = "user" | "assistant";

export interface AiTurn {
  id: string;
  /** 父消息 id（根消息 = null）。 */
  parentId: string | null;
  /** 当前选中的子消息（叶子 = null）。切版本 = 改父节点的这个指针。 */
  selectedChildId: string | null;
  role: AiTurnRole;
  /** 展示文本：用户 = 提问原文；助手 = 回答正文。 */
  text: string;
  /**
   * 实际发往模型的内容：首轮含选区/全文上下文与图片块（展示文本不含上下文，不能反推）；
   * 缺省 = text。编辑提问时沿用原上下文、只换问题文本。
   */
  wireContent?: AiChatMessage["content"];
  /** 用户主动停止的半截回答：留在面板里可复制，但不再进入后续上下文。 */
  interrupted?: boolean;
}

export interface AiConversationSession {
  schemaVersion: number;
  /** 根消息 id（空会话 = null）。 */
  rootId: string | null;
  messages: AiTurn[];
}

/** 兄弟版本 = 同一 parentId 下按 messages[] 顺序排列的一组消息；index 为当前这条的下标。 */
export interface MessageVersions {
  ids: string[];
  index: number;
}

/** 新消息要挂到树上的最小描述（id 由调用方生成，纯函数不碰随机源）。 */
export interface AiTurnDraft {
  id: string;
  role: AiTurnRole;
  text: string;
  wireContent?: AiChatMessage["content"];
  interrupted?: boolean;
}

const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 };

let turnSequence = 0;

/** 消息 id（只要求会话内唯一；不参与排序，版本顺序看 messages[]）。 */
export function newAiTurnId(): string {
  turnSequence += 1;
  return "turn-" + turnSequence.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function createAiConversationSession(): AiConversationSession {
  return { schemaVersion: AI_CONVERSATION_SCHEMA_VERSION, rootId: null, messages: [] };
}

/**
 * 当前路径：从 rootId 沿 selectedChildId 一直走到叶子。
 * 遇到缺失节点/环就停（坏数据只影响后续，不把面板打挂）；不修改 session。
 */
export function visiblePath(session: AiConversationSession): AiTurn[] {
  if (!session.rootId) return [];
  const byId = new Map(session.messages.map((message) => [message.id, message]));
  const path: AiTurn[] = [];
  const visited = new Set<string>();
  let id: string | null = session.rootId;
  while (id && !visited.has(id)) {
    const message = byId.get(id);
    if (!message) break;
    visited.add(id);
    path.push(message);
    id = message.selectedChildId;
  }
  return path;
}

/** 某条消息的兄弟版本（含它自己）；不是当前路径上的节点也可以查。 */
export function versionsOf(session: AiConversationSession, messageId: string): MessageVersions {
  const message = session.messages.find((item) => item.id === messageId);
  if (!message) return EMPTY_VERSIONS;
  const ids = session.messages
    .filter((item) => item.parentId === message.parentId)
    .map((item) => item.id);
  return { ids, index: ids.indexOf(messageId) };
}

/**
 * 追加分支：新消息挂在 parentId 下并**选中**新分支，原节点与其后续对话保持不变。
 * parentId = null 表示新的根版本（编辑第一条提问）；parentId 必须已存在，否则原样返回。
 */
export function appendBranch(
  session: AiConversationSession,
  parentId: string | null,
  drafts: readonly AiTurnDraft[]
): AiConversationSession {
  const first = drafts[0];
  if (!first) return session;
  if (parentId !== null && !session.messages.some((message) => message.id === parentId)) return session;
  const appended: AiTurn[] = drafts.map((draft, index) => ({
    id: draft.id,
    role: draft.role,
    text: draft.text,
    parentId: index === 0 ? parentId : drafts[index - 1].id,
    selectedChildId: drafts[index + 1]?.id ?? null,
    ...(draft.wireContent === undefined ? {} : { wireContent: draft.wireContent }),
    ...(draft.interrupted === undefined ? {} : { interrupted: draft.interrupted }),
  }));
  return {
    ...session,
    rootId: parentId === null ? first.id : session.rootId,
    messages: [
      ...session.messages.map((message) =>
        message.id === parentId ? { ...message, selectedChildId: first.id } : message
      ),
      ...appended,
    ],
  };
}

/**
 * 切换版本：只允许切**当前路径上某个节点的兄弟**（其余分支的版本不可达，不提供跳转）。
 * 切到根版本时同时换 rootId；该版本已选中的后续分支原样恢复（不丢旧路径的选择）。
 */
export function selectVersion(session: AiConversationSession, messageId: string): AiConversationSession {
  const message = session.messages.find((item) => item.id === messageId);
  if (!message) return session;
  const siblingsVisible = visiblePath(session).some((item) => item.parentId === message.parentId);
  if (!siblingsVisible) return session;
  return {
    ...session,
    rootId: message.parentId === null ? message.id : session.rootId,
    messages: session.messages.map((item) =>
      item.id === message.parentId ? { ...item, selectedChildId: message.id } : item
    ),
  };
}

/** 改一条消息的可变字段（流式正文 / 停止标记）；不改树结构。 */
export function updateTurn(
  session: AiConversationSession,
  messageId: string,
  patch: { text?: string; interrupted?: boolean }
): AiConversationSession {
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return session;
  const messages = session.messages.slice();
  messages[index] = { ...messages[index], ...patch };
  return { ...session, messages };
}

/** 流式增量：追加到指定助手消息的正文。 */
export function appendTurnText(
  session: AiConversationSession,
  messageId: string,
  delta: string
): AiConversationSession {
  const turn = session.messages.find((message) => message.id === messageId);
  if (!turn || !delta) return session;
  return updateTurn(session, messageId, { text: turn.text + delta });
}

/**
 * 删掉一条消息（只用于「停止时一个字都没生成」的空助手占位）。
 * 父节点的 selectedChildId 回落到剩下的最后一个兄弟（重新生成被立即停止 ⇒ 回到旧回答）。
 */
export function removeTurn(session: AiConversationSession, messageId: string): AiConversationSession {
  const target = session.messages.find((message) => message.id === messageId);
  if (!target) return session;
  const siblings = session.messages.filter(
    (message) => message.id !== messageId && message.parentId === target.parentId
  );
  const fallback = siblings.at(-1)?.id ?? null;
  const messages = session.messages
    .filter((message) => message.id !== messageId)
    .map((message) =>
      message.id === target.parentId && message.selectedChildId === messageId
        ? { ...message, selectedChildId: fallback }
        : message
    );
  return {
    ...session,
    rootId: session.rootId === messageId ? fallback : session.rootId,
    messages,
  };
}

/**
 * 当前路径 → 请求上下文。用户消息用自己的 wireContent（含首轮上下文/图片）；
 * 助手消息用正文；空的、被主动停止的半截回答不进上下文（与旧实现的 history 口径一致）。
 */
export function wireMessages(path: readonly AiTurn[]): AiChatMessage[] {
  const messages: AiChatMessage[] = [];
  for (const turn of path) {
    if (turn.role === "assistant" && (!turn.text || turn.interrupted)) continue;
    messages.push({ role: turn.role, content: turn.wireContent ?? turn.text });
  }
  return messages;
}

/**
 * 本地会话的**读取守卫**：只认当前 schemaVersion 且结构自洽的树，其余（旧格式 / 坏 JSON /
 * 断链 / 重复 id）一律返回空会话。会话是本地数据 ⇒ 不迁移、不修补（AGENTS §3#7）。
 */
export function readAiConversationSession(raw: unknown): AiConversationSession {
  const parsed = typeof raw === "string" ? parseJson(raw) : raw;
  if (!isRecord(parsed) || parsed.schemaVersion !== AI_CONVERSATION_SCHEMA_VERSION) {
    return createAiConversationSession();
  }
  const { rootId, messages } = parsed;
  if (rootId !== null && typeof rootId !== "string") return createAiConversationSession();
  if (!Array.isArray(messages)) return createAiConversationSession();
  const turns: AiTurn[] = [];
  for (const message of messages) {
    if (!isRecord(message)) return createAiConversationSession();
    const { id, parentId, selectedChildId, role, text } = message;
    if (typeof id !== "string" || !id) return createAiConversationSession();
    if (parentId !== null && typeof parentId !== "string") return createAiConversationSession();
    if (selectedChildId !== null && typeof selectedChildId !== "string") return createAiConversationSession();
    if (role !== "user" && role !== "assistant") return createAiConversationSession();
    if (typeof text !== "string") return createAiConversationSession();
    const turn: AiTurn = { id, parentId, selectedChildId, role, text };
    if (isWireContent(message.wireContent)) turn.wireContent = message.wireContent;
    if (message.interrupted === true) turn.interrupted = true;
    turns.push(turn);
  }
  const ids = new Set(turns.map((turn) => turn.id));
  if (ids.size !== turns.length) return createAiConversationSession();
  if (turns.some((turn) => turn.parentId !== null && !ids.has(turn.parentId))) {
    return createAiConversationSession();
  }
  if (turns.some((turn) => turn.selectedChildId !== null && !ids.has(turn.selectedChildId))) {
    return createAiConversationSession();
  }
  const roots = turns.filter((turn) => turn.parentId === null);
  if (rootId === null ? roots.length > 0 : !roots.some((turn) => turn.id === rootId)) {
    return createAiConversationSession();
  }
  return { schemaVersion: AI_CONVERSATION_SCHEMA_VERSION, rootId, messages: turns };
}

/** 写本地格式（与读取守卫同源：只写 schemaVersion + rootId + messages）。 */
export function serializeAiConversationSession(session: AiConversationSession): string {
  return JSON.stringify({
    schemaVersion: AI_CONVERSATION_SCHEMA_VERSION,
    rootId: session.rootId,
    messages: session.messages,
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWireContent(value: unknown): value is AiChatMessage["content"] {
  return typeof value === "string" || Array.isArray(value);
}
