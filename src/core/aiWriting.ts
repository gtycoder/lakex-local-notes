/**
 * AI 写作空间（桌面，v1）：**纯逻辑**（无 node / 无 React）。
 *
 * 单一来源：
 * - 会话/消息形状与上限（渲染层、主进程仓库、测试共用）；
 * - 标题推导、日期分组（历史列表）；
 * - 请求组装（系统提示 + 多文档资料 + 历史轮次 + 本轮输入，带字符预算）。
 *
 * 红线：AI Key 与网络只在主进程（见 electron/ai/aiClient.ts）；本模块只产出消息数组。
 * 规格：docs/AI-WRITING.md。
 */
import type { AiChatMessage } from "./aiProviders";

export type AiWritingMode = "chat" | "docs";
export const AI_WRITING_MODES: readonly AiWritingMode[] = ["chat", "docs"];

/** 多文档模式的资料引用（选择时解析成具体文档；快捷组也落成具体清单）。 */
export interface AiWritingDocRef {
  kind: "note" | "quick-note";
  id: string;
  title: string;
}

export interface AiWritingConversation {
  id: string;
  mode: AiWritingMode;
  title: string;
  /** 输入卡上挂着的提示词（语雀同款 chip）；空 = 无。 */
  promptText: string | null;
  /** 多文档模式的已选资料（重开会话时恢复 chip）。 */
  docRefs: AiWritingDocRef[];
  createdAt: string;
  updatedAt: string;
}

export interface AiWritingMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  /** Markdown 原文（渲染层用 MarkdownView 渲染）。 */
  content: string;
  /** 思考内容（DeepSeek 等供应商的 reasoning_content）；null = 该供应商没有思考输出。 */
  reasoning: string | null;
  durationMs: number | null;
  /** 用户主动停止：保留已生成片段，UI 标注「已停止」。 */
  stopped: boolean;
  /** 请求失败原因（消息级错误行，可重试）。 */
  error: string | null;
  sortOrder: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// IPC 载荷（渲染层 native 桥 / 主进程 registerAiWriting 共用这一份；不各写一遍）
// ---------------------------------------------------------------------------

export interface AiWritingConversationCreateInput {
  mode: AiWritingMode;
  title: string;
  promptText?: string | null;
  docRefs?: AiWritingDocRef[];
}

/** 输入卡状态补丁（提示词 chip / 文档 chip / 模式）：重开会话时恢复。 */
export interface AiWritingComposerPatch {
  promptText?: string | null;
  docRefs?: AiWritingDocRef[];
  mode?: AiWritingMode;
}

export interface AiWritingMessageAppendInput {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  durationMs?: number | null;
  stopped?: boolean;
  error?: string | null;
}

export interface AiWritingMessagePatch {
  content?: string;
  reasoning?: string | null;
  durationMs?: number | null;
  stopped?: boolean;
  error?: string | null;
}

export interface AiWritingConversationDetail {
  conversation: AiWritingConversation;
  messages: AiWritingMessage[];
}

/** 标题：首条用户消息首行，去掉 Markdown 标记，≤24 字。 */
export const AI_WRITING_TITLE_MAX = 24;
export function aiWritingTitleFrom(text: string): string {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n");
  const firstLine = raw.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const compact = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/[\x60~*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "新的对话";
  const chars = Array.from(compact);
  return chars.length > AI_WRITING_TITLE_MAX ? chars.slice(0, AI_WRITING_TITLE_MAX).join("") : compact;
}

/** 历史列表分组：今天 / 昨天 / 更早（按 updatedAt 倒序稳定分组）。 */
export type AiWritingHistoryGroupLabel = "今天" | "昨天" | "更早";
export interface AiWritingHistoryGroup {
  label: AiWritingHistoryGroupLabel;
  conversations: AiWritingConversation[];
}
/**
 * 侧栏「置顶」拆分（261110 用户定稿：做**搜索 + 置顶**，不做对话分组）。
 * pinned 顺序 = 传入的置顶顺序（最新置顶在前）；rest 为其余会话（顺序/日期分组交给调用方）。
 * 判据只在这里：组件不自己写「哪些算置顶」。
 */
export function splitPinnedConversations(
  conversations: readonly AiWritingConversation[],
  pinnedIds: readonly string[],
): { pinned: AiWritingConversation[]; rest: AiWritingConversation[] } {
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const pinned: AiWritingConversation[] = [];
  const seen = new Set<string>();
  for (const id of pinnedIds) {
    const conversation = byId.get(id);
    if (!conversation || seen.has(id)) continue;
    pinned.push(conversation);
    seen.add(id);
  }
  return { pinned, rest: conversations.filter((conversation) => !seen.has(conversation.id)) };
}

export function groupAiWritingHistory(conversations: readonly AiWritingConversation[], now: Date): AiWritingHistoryGroup[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const buckets: Record<AiWritingHistoryGroupLabel, AiWritingConversation[]> = { 今天: [], 昨天: [], 更早: [] };
  const sorted = [...conversations].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  for (const conversation of sorted) {
    const time = Date.parse(conversation.updatedAt);
    const bucket = Number.isNaN(time) ? "更早" : time >= today ? "今天" : time >= yesterday ? "昨天" : "更早";
    buckets[bucket].push(conversation);
  }
  return (["今天", "昨天", "更早"] as AiWritingHistoryGroupLabel[])
    .map((label) => ({ label, conversations: buckets[label] }))
    .filter((group) => group.conversations.length > 0);
}

// ---------------------------------------------------------------------------
// 请求组装
// ---------------------------------------------------------------------------

/** 多文档上限：篇数 / 单篇字符 / 合计字符（超出截断，见 docs/AI-WRITING.md）。 */
export const AI_WRITING_MAX_DOCS = 20;
export const AI_WRITING_DOC_CHARS = 12_000;
export const AI_WRITING_TOTAL_DOC_CHARS = 40_000;
/** 历史轮次预算：只取最近 N 轮 + 总字符上限（防止长会话把上下文打爆）。 */
export const AI_WRITING_MAX_HISTORY_TURNS = 12;
export const AI_WRITING_HISTORY_CHARS = 24_000;

export interface AiWritingDocContext {
  title: string;
  text: string;
}

export interface AiWritingHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BuildAiWritingMessagesInput {
  mode: AiWritingMode;
  /** 本轮用户输入（必填）。 */
  input: string;
  /** 输入卡上的提示词（作为本轮约束追加到用户内容前）。 */
  promptText?: string | null;
  /** 多文档资料（chat 模式忽略）。 */
  docs?: readonly AiWritingDocContext[];
  /** 已有对话（不含本轮）；按时间正序。 */
  history?: readonly AiWritingHistoryTurn[];
}

export const AI_WRITING_SYSTEM_PROMPT = [
  "你是一个中文写作助手，服务于个人笔记应用。",
  "要求：直接给出可用的成品，用 Markdown 输出（标题/列表/表格/代码块/公式按需使用）；",
  "不要复述我的要求，不要加“好的/当然”之类客套话；信息不足时先给最合理的版本。",
].join("");

function clipText(text: string, limit: number): string {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  return chars.slice(0, limit).join("").trimEnd() + "…（已截断）";
}

/** 资料块：`【资料 N】标题` + 正文，单篇/合计双重预算。 */
export function buildAiWritingDocsBlock(docs: readonly AiWritingDocContext[]): string {
  if (docs.length === 0) return "";
  const picked: string[] = [];
  let total = 0;
  const limited = docs.slice(0, AI_WRITING_MAX_DOCS);
  for (let index = 0; index < limited.length; index += 1) {
    const doc = limited[index];
    const remain = AI_WRITING_TOTAL_DOC_CHARS - total;
    if (remain <= 0) break;
    const head = "【资料 " + (index + 1) + "】" + (doc.title || "未命名") + "\n";
    const bodyLimit = Math.min(AI_WRITING_DOC_CHARS, Math.max(0, remain - head.length));
    const body = clipText(doc.text ?? "", bodyLimit);
    picked.push(head + body);
    total += head.length + body.length;
  }
  return picked.join("\n\n");
}

/** 历史轮次：最近 N 轮 + 字符预算（从最新往回取，输出仍为正序）。 */
export function pickAiWritingHistory(history: readonly AiWritingHistoryTurn[]): AiWritingHistoryTurn[] {
  const turns = history.filter((turn) => turn.content.trim().length > 0).slice(-AI_WRITING_MAX_HISTORY_TURNS);
  const kept: AiWritingHistoryTurn[] = [];
  let total = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const cost = turn.content.length;
    if (total + cost > AI_WRITING_HISTORY_CHARS) break;
    kept.unshift(turn);
    total += cost;
  }
  return kept;
}

/**
 * 组装一次请求的消息数组（OpenAI 兼容：system + history + user）。
 * 多文档模式把资料块并入本轮用户消息（与语雀「根据 N 篇文档推理分析」一致：资料属于提问）。
 */
export function buildAiWritingMessages(input: BuildAiWritingMessagesInput): AiChatMessage[] {
  const { mode, input: rawInput, promptText, docs = [], history = [] } = input;
  const messages: AiChatMessage[] = [{ role: "system", content: AI_WRITING_SYSTEM_PROMPT }];
  for (const turn of pickAiWritingHistory(history)) {
    messages.push({ role: turn.role, content: turn.content });
  }
  const parts: string[] = [];
  const prompt = String(promptText ?? "").trim();
  if (prompt) parts.push("【要求】" + prompt);
  const inputText = String(rawInput ?? "").trim();
  if (inputText) parts.push(inputText);
  if (mode === "docs") {
    const docsBlock = buildAiWritingDocsBlock(docs);
    if (docsBlock) parts.push("【参考资料】\n" + docsBlock);
  }
  const content = parts.join("\n\n");
  messages.push({ role: "user", content: content || inputText });
  return messages;
}
