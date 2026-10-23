/**
 * AI 历史对话的索引仓储（设备本地；261023 P1.6）。
 *
 * 分工：消息正文 + 资料快照在 `files/ai/conversations/{id}.json`（BodyStore 原子写，≤2MiB/份），
 * 这里只存「列表 / 搜索 / 淘汰」需要的元数据；**不进 S3**。
 */
import type { MobileDb } from "./sqliteDb";

export const AI_CONVERSATION_MAX_COUNT = 50;
export const AI_CONVERSATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AiConversationMeta {
  id: string;
  title: string;
  /** 搜索结果/列表副标题用的短摘录（首问 + 末条回答，≤240 字）。 */
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  bytes: number;
  /** 资料快照的文档标题（只用于列表展示，如 ["周报", "内核笔记"]）。 */
  docs: Array<{ id: string; title: string }>;
}

type DbRow = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function rowToMeta(row: DbRow): AiConversationMeta {
  let docs: Array<{ id: string; title: string }> = [];
  try {
    const parsed: unknown = JSON.parse(text(row.docs_json, "[]"));
    if (Array.isArray(parsed)) {
      docs = parsed.flatMap((doc: unknown) => {
        if (!doc || typeof doc !== "object") return [];
        const item = doc as { id?: unknown; title?: unknown };
        return typeof item.id === "string" && typeof item.title === "string" ? [{ id: item.id, title: item.title }] : [];
      });
    }
  } catch {
    docs = [];
  }
  return {
    id: text(row.id),
    title: text(row.title),
    preview: text(row.preview),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    messageCount: Number(row.message_count ?? 0),
    bytes: Number(row.bytes ?? 0),
    docs,
  };
}

/** 列表 / 搜索（title + preview 的 LIKE；最多 50 条）。 */
export async function listAiConversations(d: MobileDb, query = ""): Promise<AiConversationMeta[]> {
  const keyword = query.trim();
  if (!keyword) {
    const rows = await d.prepare(
      "SELECT id, title, preview, created_at, updated_at, message_count, bytes, docs_json FROM ai_conversations ORDER BY updated_at DESC LIMIT " + AI_CONVERSATION_MAX_COUNT,
    ).all();
    return rows.map(rowToMeta);
  }
  const like = "%" + keyword.replace(/[%_]/g, (ch) => "\\" + ch) + "%";
  const rows = await d.prepare(
    "SELECT id, title, preview, created_at, updated_at, message_count, bytes, docs_json FROM ai_conversations WHERE title LIKE ? ESCAPE '\\' OR preview LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT " + AI_CONVERSATION_MAX_COUNT,
  ).all(like, like);
  return rows.map(rowToMeta);
}

/** 全量（仅供淘汰/迁移；不做分页上限）。 */
export async function listAllAiConversations(d: MobileDb): Promise<AiConversationMeta[]> {
  const rows = await d.prepare(
    "SELECT id, title, preview, created_at, updated_at, message_count, bytes, docs_json FROM ai_conversations ORDER BY updated_at DESC",
  ).all();
  return rows.map(rowToMeta);
}

export async function getAiConversationMeta(d: MobileDb, id: string): Promise<AiConversationMeta | null> {
  const row = await d.prepare(
    "SELECT id, title, preview, created_at, updated_at, message_count, bytes, docs_json FROM ai_conversations WHERE id=?",
  ).get(id);
  return row ? rowToMeta(row) : null;
}

/** 最新的会话 id（启动恢复用）。 */
export async function latestAiConversationId(d: MobileDb): Promise<string | null> {
  const row = await d.prepare("SELECT id FROM ai_conversations ORDER BY updated_at DESC LIMIT 1").get() as { id?: string } | undefined;
  return row?.id ?? null;
}

export async function listAiConversationIds(d: MobileDb): Promise<string[]> {
  const rows = await d.prepare("SELECT id FROM ai_conversations").all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export async function upsertAiConversation(d: MobileDb, meta: AiConversationMeta): Promise<void> {
  await d.prepare(
    "INSERT INTO ai_conversations(id,title,preview,created_at,updated_at,message_count,bytes,docs_json) VALUES(?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET title=excluded.title, preview=excluded.preview, updated_at=excluded.updated_at, " +
    "message_count=excluded.message_count, bytes=excluded.bytes, docs_json=excluded.docs_json",
  ).run(meta.id, meta.title, meta.preview, meta.createdAt, meta.updatedAt, meta.messageCount, meta.bytes, JSON.stringify(meta.docs));
}

export async function deleteAiConversation(d: MobileDb, id: string): Promise<void> {
  await d.prepare("DELETE FROM ai_conversations WHERE id=?").run(id);
}

export async function clearAiConversations(d: MobileDb): Promise<void> {
  await d.prepare("DELETE FROM ai_conversations").run();
}

/** 淘汰候选：超过条数上限或超过 30 天（纯函数，可单测）。保留最新的 maxCount 条。 */
export function pickPruneIds(metas: readonly AiConversationMeta[], now: number = Date.now()): string[] {
  const ids: string[] = [];
  metas.forEach((meta, index) => {
    const updated = Date.parse(meta.updatedAt);
    const expired = !Number.isFinite(updated) || now - updated > AI_CONVERSATION_MAX_AGE_MS;
    if (index >= AI_CONVERSATION_MAX_COUNT || expired) ids.push(meta.id);
  });
  return ids;
}
