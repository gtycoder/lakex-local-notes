import type { AiAssetRef, AiChatMessage, AiContentPart, AiLocalFileRef } from "./aiProviders.js";
import { AppError } from "./storeErrors.js";

/**
 * AI 对话消息的入参护栏（**两端共用**，261023 从 electron/ai 上收）：
 * 主进程（桌面）与移动端原生通道都走这一份预算，避免出现第二套上限。
 * 限制防超长 / 超多消息 / 超量附件；坏输入抛 AppError(InvalidInput)。
 */
export const AI_MAX_MESSAGES = 40;
export const AI_MAX_TOTAL_CHARS = 200_000;
/** 单次请求的附件块上限（图片 / 文档各自计数；与多维表 AI 字段同口径）。 */
export const AI_MAX_IMAGES = 10;
export const AI_MAX_DOCUMENTS = 5;

/** 校验资产引用：noteId / filename 必须是非空字符串（调用方解析时还会做路径段校验）。 */
function normalizeAsset(raw: unknown): AiAssetRef | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<AiAssetRef>;
  if (typeof a.noteId !== "string" || !a.noteId) return null;
  if (typeof a.filename !== "string" || !a.filename) return null;
  const ref: AiAssetRef = { noteId: a.noteId, filename: a.filename };
  if (typeof a.name === "string" && a.name) ref.name = a.name;
  return ref;
}

/** 归一「本机文件」引用：token/name/mimeType 必须非空字符串，size 必须有限非负数。 */
function normalizeLocalFile(raw: unknown): AiLocalFileRef | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<AiLocalFileRef>;
  if (typeof f.token !== "string" || !f.token) return null;
  if (typeof f.name !== "string" || !f.name) return null;
  if (typeof f.mimeType !== "string" || !f.mimeType) return null;
  if (typeof f.size !== "number" || !Number.isFinite(f.size) || f.size < 0) return null;
  const ref: AiLocalFileRef = { kind: "local", token: f.token, name: f.name, size: f.size, mimeType: f.mimeType };
  if (typeof f.pages === "number" && Number.isFinite(f.pages) && f.pages > 0) ref.pages = Math.round(f.pages);
  return ref;
}

/** 归一内容块数组：未知块丢弃；图片 / 文档 / 本机文件只允许 user 消息。 */
function normalizeParts(raw: unknown, role: AiChatMessage["role"]): AiContentPart[] {
  if (!Array.isArray(raw)) return [];
  const parts: AiContentPart[] = [];
  for (const item of raw) {
    const part = (item ?? {}) as { type?: unknown; text?: unknown; asset?: unknown; file?: unknown };
    if (part.type === "text") {
      if (typeof part.text === "string" && part.text) parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image" || part.type === "document") {
      if (role !== "user") throw new AppError("InvalidInput", "图片 / 文档只能作为「用户」消息发送");
      const asset = normalizeAsset(part.asset);
      if (asset) parts.push(part.type === "image" ? { type: "image", asset } : { type: "document", asset });
      continue;
    }
    if (part.type === "local_file") {
      if (role !== "user") throw new AppError("InvalidInput", "附件只能作为「用户」消息发送");
      const file = normalizeLocalFile(part.file);
      if (file) parts.push({ type: "local_file", file });
    }
  }
  return parts;
}

/**
 * 超限时保留最近 N 条；**首条 system 必须保住**（261021 P0：系统提示词固定在首条，
 * 不能被「保留最近」裁掉，否则长对话会忽然丢失规则）。
 */
function capMessages(raw: unknown[]): unknown[] {
  if (raw.length <= AI_MAX_MESSAGES) return raw;
  const first = raw[0] as { role?: unknown } | null;
  const hasLeadingSystem = Boolean(first && typeof first === "object" && first.role === "system");
  return hasLeadingSystem ? [raw[0], ...raw.slice(-(AI_MAX_MESSAGES - 1))] : raw.slice(-AI_MAX_MESSAGES);
}

/**
 * 校验并裁剪消息，**保留最近 `AI_MAX_MESSAGES` 条**（261005：超限时丢更早的上下文，当前这轮一定在）。
 * 纯文本消息保持 `content: string`（兼容既有调用方）；含附件时才用内容块数组。
 */
export function assertMessages(raw: unknown): AiChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AppError("InvalidInput", "消息为空");
  const out: AiChatMessage[] = [];
  let total = 0;
  let images = 0;
  let documents = 0;
  let localFiles = 0;
  for (const item of capMessages(raw)) {
    const m = (item ?? {}) as { role?: unknown; content?: unknown };
    const role: AiChatMessage["role"] = m.role === "system" || m.role === "assistant" ? m.role : "user";
    const isString = typeof m.content === "string";
    const parts = isString ? null : normalizeParts(m.content, role);
    const plain = isString ? (m.content as string) : (parts ?? []).filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("");
    const hasAttachment = (parts ?? []).some((p) => p.type !== "text");
    if (!plain && !hasAttachment) continue;
    total += plain.length;
    if (total > AI_MAX_TOTAL_CHARS) throw new AppError("InvalidInput", "内容过长");
    if (parts) {
      images += parts.filter((p) => p.type === "image").length;
      documents += parts.filter((p) => p.type === "document").length;
      localFiles += parts.filter((p) => p.type === "local_file").length;
      if (images > AI_MAX_IMAGES) throw new AppError("InvalidInput", "一次最多发送 " + AI_MAX_IMAGES + " 张图片");
      if (documents > AI_MAX_DOCUMENTS) throw new AppError("InvalidInput", "一次最多发送 " + AI_MAX_DOCUMENTS + " 个文档");
      // 附件总入口上限：本地文件与图片共用 10 个（逐个读文件的实际类型/体积由主进程 resolver 兜底）。
      if (images + localFiles > AI_MAX_IMAGES) throw new AppError("InvalidInput", "一次最多发送 " + AI_MAX_IMAGES + " 个附件");
    }
    out.push({ role, content: hasAttachment && parts ? parts : plain });
  }
  if (out.length === 0) throw new AppError("InvalidInput", "消息为空");
  return out;
}
