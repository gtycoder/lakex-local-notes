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
import { AI_MAX_IMAGES } from "./aiChatMessages";
import type { AiAssetRef, AiChatMessage, AiContentPart, AiLocalFileRef } from "./aiProviders";

export type AiWritingMode = "chat" | "docs";
export const AI_WRITING_MODES: readonly AiWritingMode[] = ["chat", "docs"];

/** 多文档模式的资料引用（选择时解析成具体文档；快捷组也落成具体清单）。 */
export interface AiWritingDocRef {
  kind: "note" | "quick-note";
  id: string;
  title: string;
}

/**
 * 附件引用（261116 第四稿）：
 * - 文档资产图片 = AiAssetRef（Phase 1 既有形状，**保持兼容**，没有 kind 字段）；
 * - 本机文件 = AiLocalFileRef（kind:"local"，只有主进程能按 token 读到字节）。
 * 持久化/历史只存引用与元数据；历史气泡按类型显示缩略图或文件名 chip。
 */
export type AiWritingAttachment = AiAssetRef | AiLocalFileRef;

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
  /** 该条用户消息随发的附件（图片/本机文件；**只随当轮发送**，历史轮不重发；存引用不存字节）。 */
  attachRefs?: AiWritingAttachment[];
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
  /** 附件引用（仅 user 消息允许；主进程按 AI_WRITING_MAX_ATTACHMENTS + 模式判据校验）。 */
  attachRefs?: AiWritingAttachment[];
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
  const sorted = conversations.toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
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
/**
 * 单轮图片附件上限：**与主进程 ai_chat 同一预算**（core/aiChatMessages 的 AI_MAX_IMAGES），
 * 不在 AI 写作侧另立第二套上限。超限在选择器里就拦住，不发出去再报错。
 */
export const AI_WRITING_MAX_ATTACHMENTS = AI_MAX_IMAGES;

export interface AiWritingDocContext {
  title: string;
  text: string;
}

/** 带附件发送失败时的可执行提示：**不维护视觉模型清单**，只提示「可能不支持附件」+ 两个出口。 */
export function aiWritingAttachmentErrorHint(error: string | null | undefined, attachmentCount: number): string | null {
  const message = error?.trim();
  if (!message || attachmentCount <= 0) return message ? message : null;
  if (!/400|请求参数|bad request|unsupported|image/i.test(message)) return message;
  return message + "（本次带了 " + attachmentCount + " 个附件：若当前模型不支持该附件类型（例如非视觉模型收到图片）会返回 400，可换用支持视觉的模型，或移除附件后重试。）";
}

/**
 * **模式判据（单一来源，261116 第四稿）**：UI / 请求组装 / IPC 校验都读这张表，不在各处 if。
 * - 对话写作 = 纯对话：不选文档（docs=false）；附件两类来源都可用（docAssets + localFiles）；
 * - 多文档推理 = 知识库问答：必须选文档（docs=true）；附件只允许「所选文档里的」（localFiles=false，
 *   attachmentsLimitedToDocs=true）。
 */
export interface AiWritingModeCapabilities {
  /** 是否显示/接受 docRefs（知识库上下文）。 */
  docs: boolean;
  /** 是否允许从「文档资产」选附件（图片引用，不注入正文）。 */
  docAssets: boolean;
  /** 是否允许从本机选文件附件（仅主进程可按 token 读字节）。 */
  localFiles: boolean;
  /** 附件是否必须限定在已选文档集合内。 */
  attachmentsLimitedToDocs: boolean;
}

export const AI_WRITING_MODE_CAPABILITIES: Readonly<Record<AiWritingMode, AiWritingModeCapabilities>> = {
  chat: { docs: false, docAssets: true, localFiles: true, attachmentsLimitedToDocs: false },
  docs: { docs: true, docAssets: true, localFiles: false, attachmentsLimitedToDocs: true },
};

export function aiWritingModeCapabilities(mode: AiWritingMode): AiWritingModeCapabilities {
  return AI_WRITING_MODE_CAPABILITIES[mode] ?? AI_WRITING_MODE_CAPABILITIES.chat;
}

export interface AiWritingHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** 是否本机文件附件（kind:"local"；缺 kind = Phase 1 的文档资产图片，保持兼容）。 */
export function isAiWritingLocalAttachment(ref: AiWritingAttachment): ref is AiLocalFileRef {
  return (ref as AiLocalFileRef).kind === "local";
}

/** 附件引用 → 展示名（本机文件用 name；资产用 name 优先、回落磁盘名）。 */
export function aiWritingAttachmentLabel(ref: AiWritingAttachment): string {
  if (isAiWritingLocalAttachment(ref)) return ref.name?.trim() || "本机文件";
  const name = ref.name?.trim();
  return name ? name : ref.filename;
}

/** 附件去重键（本机文件按 token；资产按 noteId/filename）。 */
export function aiWritingAttachmentKey(ref: AiWritingAttachment): string {
  if (isAiWritingLocalAttachment(ref)) return "local:" + ref.token;
  return ref.noteId + "/" + ref.filename;
}

/**
 * 归一附件引用（渲染层 / 主进程 IPC / DB 三处共用同一份形状判据）：
 * - 无 kind 且 noteId/filename 非空 = Phase 1 文档资产图片（兼容旧数据）；
 * - kind:"local" = 本机文件（token/name/mimeType 非空、size ≥ 0）；
 * 按 key 去重、按 AI_WRITING_MAX_ATTACHMENTS 截断；无效项直接丢弃。
 * 需要「非法输入报错」的调用方（IPC）应先用原始长度比对，见 electron/ipc/registerAiWriting.ts。
 */
export function normalizeAiWritingAttachments(raw: unknown): AiWritingAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: AiWritingAttachment[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { kind?: unknown; token?: unknown; name?: unknown; size?: unknown; mimeType?: unknown; noteId?: unknown; filename?: unknown };
    let ref: AiWritingAttachment | null = null;
    if (row.kind === "local") {
      if (typeof row.token !== "string" || !row.token) continue;
      if (typeof row.name !== "string" || !row.name) continue;
      if (typeof row.mimeType !== "string" || !row.mimeType) continue;
      if (typeof row.size !== "number" || !Number.isFinite(row.size) || row.size < 0) continue;
      ref = { kind: "local", token: row.token, name: row.name, size: row.size, mimeType: row.mimeType };
    } else {
      const noteId = typeof row.noteId === "string" ? row.noteId : "";
      const filename = typeof row.filename === "string" ? row.filename : "";
      if (!noteId || !filename) continue;
      const asset: AiAssetRef = { noteId, filename };
      if (typeof row.name === "string" && row.name) asset.name = row.name;
      ref = asset;
    }
    const key = aiWritingAttachmentKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= AI_WRITING_MAX_ATTACHMENTS) break;
  }
  return out;
}

/**
 * 按模式过滤附件（**请求组装 / 渲染层 prune 共用**）：
 * - docs 模式：只留 noteId 在 docRefs 里的资产图片（本机文件与悬空资产一律剔除）；
 * - chat 模式：允许资产图片（不限定文档）与本机文件。
 */
export function filterAiWritingAttachmentsForMode(
  mode: AiWritingMode,
  attachments: unknown,
  docRefs: readonly AiWritingDocRef[] = [],
): AiWritingAttachment[] {
  const cap = aiWritingModeCapabilities(mode);
  const allowedDocs = new Set(docRefs.map((doc) => doc.id));
  return normalizeAiWritingAttachments(attachments).filter((ref) => {
    if (isAiWritingLocalAttachment(ref)) return cap.localFiles;
    if (!cap.docAssets) return false;
    return !cap.attachmentsLimitedToDocs || allowedDocs.has(ref.noteId);
  });
}

/** IPC 侧模式判据（返错不静默）：坏的组合给出可执行中文原因。 */
export function aiWritingAttachmentModeError(
  mode: AiWritingMode,
  attachments: readonly AiWritingAttachment[],
  docRefs: readonly AiWritingDocRef[] = [],
): string | null {
  const cap = aiWritingModeCapabilities(mode);
  const allowedDocs = new Set(docRefs.map((doc) => doc.id));
  for (const ref of attachments) {
    if (isAiWritingLocalAttachment(ref)) {
      if (!cap.localFiles) return "多文档推理只允许「所选文档里的附件」，不能混入本机文件";
      continue;
    }
    if (!cap.docAssets) return "当前模式不允许文档资产附件";
    if (cap.attachmentsLimitedToDocs && !allowedDocs.has(ref.noteId)) {
      return "附件必须来自已选文档（《" + aiWritingAttachmentLabel(ref) + "》不在本次资料里）";
    }
  }
  return null;
}

export interface BuildAiWritingMessagesInput {
  mode: AiWritingMode;
  /** 本轮用户输入（必填）。 */
  input: string;
  /**
   * 本轮随发的附件（只出现在**本轮 user 消息**里；历史轮仍只送文本）。
   * 资产图片 → image 块；本机文件 → local_file 块（主进程按 token 读，渲染层不读字节）。
   * docs 模式只允许 noteId ∈ docRefs 的资产图片；本机文件只在 chat 模式允许（判据见 mode capabilities）。
   */
  attachments?: readonly AiWritingAttachment[];
  /** docs 模式的已选资料（用于过滤「附件必须来自已选文档」）。 */
  docRefs?: readonly AiWritingDocRef[];
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
  const { mode, input: rawInput, promptText, docs = [], docRefs = [], history = [], attachments = [] } = input;
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
  // 附件**只挂在本轮 user 消息**：历史轮仍只送文本（不重发、不重复计费）。
  // 组装层也按模式判据过滤一次（UI 已 prune；这里是请求侧的最后一道，防坏数据/越权组合）。
  const attachmentsForMode = filterAiWritingAttachmentsForMode(mode, attachments, docRefs);
  if (attachmentsForMode.length === 0) {
    messages.push({ role: "user", content: content || inputText });
    return messages;
  }
  const userParts: AiContentPart[] = [];
  if (content) userParts.push({ type: "text", text: content });
  for (const ref of attachmentsForMode) {
    if (isAiWritingLocalAttachment(ref)) {
      userParts.push({ type: "local_file", file: { kind: "local", token: ref.token, name: ref.name, size: ref.size, mimeType: ref.mimeType } });
    } else {
      userParts.push({ type: "image", asset: { noteId: ref.noteId, filename: ref.filename, ...(ref.name ? { name: ref.name } : {}) } });
    }
  }
  messages.push({ role: "user", content: userParts });
  return messages;
}
