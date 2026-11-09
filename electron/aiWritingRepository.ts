/**
 * AI 写作空间（桌面）本地仓库：会话 + 消息。
 *
 * 存储 = 主库 metadata.sqlite3 的两张独立表（**不**进树/搜索/同步/S3；设备本地）。
 * 表结构在 electron/schemaInit.ts；形状/上限的单一来源是 src/core/aiWriting.ts。
 */
import crypto from "node:crypto";
import type { DbLike } from "./dbLike.js";
import {
  AI_WRITING_MODES,
  type AiWritingConversation,
  type AiWritingDocRef,
  type AiWritingMessage,
  type AiWritingMode,
} from "../src/core/aiWriting.js";

interface ConversationRow {
  id: string;
  mode: string;
  title: string;
  prompt_text: string | null;
  doc_refs: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  reasoning: string | null;
  duration_ms: number | null;
  stopped: number;
  error: string | null;
  sort_order: number;
  created_at: string;
}

export interface CreateConversationInput {
  mode: AiWritingMode;
  title: string;
  promptText?: string | null;
  docRefs?: readonly AiWritingDocRef[];
}

export interface AppendMessageInput {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  durationMs?: number | null;
  stopped?: boolean;
  error?: string | null;
}

export interface UpdateMessageInput {
  content?: string;
  reasoning?: string | null;
  durationMs?: number | null;
  stopped?: boolean;
  error?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return prefix + "-" + crypto.randomUUID();
}

function normalizeMode(value: string): AiWritingMode {
  return (AI_WRITING_MODES as readonly string[]).includes(value) ? (value as AiWritingMode) : "chat";
}

function safeJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDocRefs(value: string | null): AiWritingDocRef[] {
  const out: AiWritingDocRef[] = [];
  for (const item of safeJsonArray(value)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const kind = row.kind === "quick-note" ? "quick-note" : row.kind === "note" ? "note" : null;
    const id = typeof row.id === "string" ? row.id : "";
    const title = typeof row.title === "string" ? row.title : "";
    if (!kind || !id) continue;
    out.push({ kind, id, title: title || "未命名" });
  }
  return out;
}

function toConversation(row: ConversationRow): AiWritingConversation {
  return {
    id: row.id,
    mode: normalizeMode(row.mode),
    title: row.title,
    promptText: row.prompt_text ?? null,
    docRefs: parseDocRefs(row.doc_refs),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): AiWritingMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    reasoning: row.reasoning ?? null,
    durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
    stopped: row.stopped === 1,
    error: row.error ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function clipTitle(title: string): string {
  const compact = title.replace(/\s+/g, " ").trim();
  return compact ? Array.from(compact).slice(0, 80).join("") : "新的对话";
}

export class AiWritingRepository {
  private readonly db: DbLike;

  constructor(db: DbLike) {
    this.db = db;
  }

  /** 历史列表（按最近更新倒序；消息不预读）。 */
  listConversations(): AiWritingConversation[] {
    const rows = this.db
      .prepare("SELECT id, mode, title, prompt_text, doc_refs, created_at, updated_at FROM ai_writing_conversations ORDER BY updated_at DESC")
      .all() as ConversationRow[];
    return rows.map(toConversation);
  }

  getConversation(id: string): AiWritingConversation | null {
    const row = this.db
      .prepare("SELECT id, mode, title, prompt_text, doc_refs, created_at, updated_at FROM ai_writing_conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;
    return row ? toConversation(row) : null;
  }

  createConversation(input: CreateConversationInput): AiWritingConversation {
    const id = newId("aiw");
    const now = nowIso();
    const docRefs = JSON.stringify((input.docRefs ?? []).slice(0, 200));
    this.db
      .prepare("INSERT INTO ai_writing_conversations(id, mode, title, prompt_text, doc_refs, created_at, updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, normalizeMode(input.mode), clipTitle(input.title), input.promptText ?? null, docRefs, now, now);
    return {
      id,
      mode: normalizeMode(input.mode),
      title: clipTitle(input.title),
      promptText: input.promptText ?? null,
      docRefs: parseDocRefs(docRefs),
      createdAt: now,
      updatedAt: now,
    };
  }

  renameConversation(id: string, title: string): AiWritingConversation | null {
    const now = nowIso();
    this.db.prepare("UPDATE ai_writing_conversations SET title = ?, updated_at = ? WHERE id = ?").run(clipTitle(title), now, id);
    return this.getConversation(id);
  }

  /** 输入卡状态（提示词 chip / 文档 chip / 模式）：重开会话时恢复。 */
  updateConversationComposer(
    id: string,
    patch: { promptText?: string | null; docRefs?: readonly AiWritingDocRef[]; mode?: AiWritingMode },
  ): AiWritingConversation | null {
    const current = this.getConversation(id);
    if (!current) return null;
    const promptText = patch.promptText === undefined ? current.promptText : patch.promptText;
    const docRefs = patch.docRefs === undefined ? current.docRefs : patch.docRefs;
    const mode = patch.mode === undefined ? current.mode : normalizeMode(patch.mode);
    this.db
      .prepare("UPDATE ai_writing_conversations SET prompt_text = ?, doc_refs = ?, mode = ? WHERE id = ?")
      .run(promptText, JSON.stringify(docRefs.slice(0, 200)), mode, id);
    return this.getConversation(id);
  }

  /** 删除会话（消息级联）。 */
  deleteConversation(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM ai_writing_messages WHERE conversation_id = ?").run(id);
      this.db.prepare("DELETE FROM ai_writing_conversations WHERE id = ?").run(id);
    })();
  }

  listMessages(conversationId: string): AiWritingMessage[] {
    const rows = this.db
      .prepare("SELECT id, conversation_id, role, content, reasoning, duration_ms, stopped, error, sort_order, created_at FROM ai_writing_messages WHERE conversation_id = ? ORDER BY sort_order ASC")
      .all(conversationId) as MessageRow[];
    return rows.map(toMessage);
  }

  /** 追加消息（同时把会话 updated_at 推到最新 = 历史列表排序依据）。 */
  appendMessage(input: AppendMessageInput): AiWritingMessage {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM ai_writing_messages WHERE conversation_id = ?")
      .get(input.conversationId) as { maxOrder: number } | undefined;
    const sortOrder = (row?.maxOrder ?? -1) + 1;
    const id = newId("aiwm");
    const now = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO ai_writing_messages(id, conversation_id, role, content, reasoning, duration_ms, stopped, error, sort_order, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(id, input.conversationId, input.role, input.content ?? "", input.reasoning ?? null, input.durationMs ?? null, input.stopped ? 1 : 0, input.error ?? null, sortOrder, now);
      this.db.prepare("UPDATE ai_writing_conversations SET updated_at = ? WHERE id = ?").run(now, input.conversationId);
    })();
    const saved = this.db
      .prepare("SELECT id, conversation_id, role, content, reasoning, duration_ms, stopped, error, sort_order, created_at FROM ai_writing_messages WHERE id = ?")
      .get(id) as MessageRow | undefined;
    if (!saved) throw new Error("消息写入失败");
    return toMessage(saved);
  }

  /** 流式结束/失败时回填内容、思考、耗时、停止与错误。 */
  updateMessage(id: string, patch: UpdateMessageInput): AiWritingMessage | null {
    const current = this.db
      .prepare("SELECT id, conversation_id, role, content, reasoning, duration_ms, stopped, error, sort_order, created_at FROM ai_writing_messages WHERE id = ?")
      .get(id) as MessageRow | undefined;
    if (!current) return null;
    const content = patch.content === undefined ? current.content : patch.content;
    const reasoning = patch.reasoning === undefined ? current.reasoning : patch.reasoning;
    const durationMs = patch.durationMs === undefined ? current.duration_ms : patch.durationMs;
    const stopped = patch.stopped === undefined ? current.stopped : patch.stopped ? 1 : 0;
    const error = patch.error === undefined ? current.error : patch.error;
    this.db
      .prepare("UPDATE ai_writing_messages SET content = ?, reasoning = ?, duration_ms = ?, stopped = ?, error = ? WHERE id = ?")
      .run(content, reasoning, durationMs, stopped, error, id);
    const saved = this.db
      .prepare("SELECT id, conversation_id, role, content, reasoning, duration_ms, stopped, error, sort_order, created_at FROM ai_writing_messages WHERE id = ?")
      .get(id) as MessageRow | undefined;
    return saved ? toMessage(saved) : null;
  }

  deleteMessage(id: string): void {
    this.db.prepare("DELETE FROM ai_writing_messages WHERE id = ?").run(id);
  }

  /** 「重新生成」：删掉最后一条助手消息（不存在则无操作）。 */
  deleteLastAssistantMessage(conversationId: string): void {
    this.db
      .prepare("DELETE FROM ai_writing_messages WHERE id = (SELECT id FROM ai_writing_messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY sort_order DESC LIMIT 1)")
      .run(conversationId);
  }
}
