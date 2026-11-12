/**
 * 多维表正文（core/bitable）：AI 字段：提示词组装与入参上限。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import { extOf, isImageExtension } from "../assetNaming.js";
import type { AiChatMessage, AiContentPart } from "../aiProviders.js";
import type { BitableAiMessagesResult, BitableDisplayContext, BitableDoc, BuildAiFieldOptions } from "./types.js";
import { isAiFieldType } from "./types.js";
import { bitableAttachments, bitableFieldText } from "./values.js";

/** AI 字段系统提示（单一来源）：命令里的字段变量已替换成当前行的值，只输出结果本身。 */
export const BITABLE_AI_SYSTEM_PROMPT =
  "你是数据表字段的 AI 生成助手。严格按用户给出的命令生成该字段的内容；命令里的字段变量已经被替换成当前记录对应字段的值。只输出结果本身：不要解释、不要前后缀、不要引号或代码块。";

/** 单次请求字符上限（主进程 ai_chat 入参上限 20 万，留出余量；与画板 AI 同口径）。 */
export const BITABLE_AI_MAX_CHARS = 190000;

/** 命令里的字段变量：`{{字段名}}`（两端可含空白）。 */
const AI_TOKEN_SOURCE = "\\{\\{([^{}]+)\\}\\}";

/** 命令里引用的字段名（去重、按首次出现顺序；不做字段存在性判断——UI 用它提示「未找到字段」）。 */
export function aiPromptFieldNames(prompt: string): string[] {
  const names: string[] = [];
  const re = new RegExp(AI_TOKEN_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    const name = match[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** AI 字段一并发送的附件上限（与主进程 aiChatMessages 护栏同口径）。 */
export const AI_FIELD_MAX_IMAGES = 10;

export const AI_FIELD_MAX_DOCUMENTS = 5;

/**
 * 组装一次 AI 字段生成请求（**单一来源**，纯函数）：
 * 固定系统提示 + 命令（`{{字段名}}` **原位替换**为当前行该字段的展示值——值走 bitableFieldText 口径，
 * 空值 / 字段不存在 / 自引用按「（空）」）。
 * 字段开启 `includeAttachments` 且给了 noteId 时，被引用字段里的图片 / PDF **额外**作为内容块发送
 * （图片 → image 块、PDF → document 块，由主进程解析；其余附件类型仍只出展示名）。
 * 未配置 / 命令里没有变量 / 变量全失效 / 附件超量 / 超长 → 返回可展示的错误。
 */
export function buildAiFieldMessages(doc: BitableDoc, tableId: string, recordId: string, fieldId: string, options: BuildAiFieldOptions = {}): BitableAiMessagesResult {
  const table = doc.tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  const record = table?.records.find((r) => r.id === recordId);
  if (!table || !field || !record) return { ok: false, error: "找不到目标字段或记录" };
  if (!isAiFieldType(field.type)) return { ok: false, error: "这个字段不是 AI 字段" };
  const prompt = field.ai?.prompt.trim() ?? "";
  if (!prompt) return { ok: false, error: "AI 字段还没有配置命令：请在「编辑字段」里写命令，并用「插入字段」加入字段变量" };
  if (aiPromptFieldNames(prompt).length === 0) return { ok: false, error: "命令里还没有字段变量：请用「插入字段」把要参考的字段插入到命令里" };
  const ctx: BitableDisplayContext = { tables: doc.tables };
  let resolved = 0;
  const text = prompt.replace(new RegExp(AI_TOKEN_SOURCE, "g"), (_raw, inner: string) => {
    const ref = table.fields.find((f) => f.id !== field.id && f.name === String(inner).trim());
    if (!ref) return "（空）";
    resolved += 1;
    return bitableFieldText(record, ref, ctx).trim() || "（空）";
  });
  if (resolved === 0) return { ok: false, error: "命令里引用的字段都不存在了：请用「插入字段」重新添加" };
  const noteId = typeof options.noteId === "string" ? options.noteId : "";
  const parts: AiContentPart[] = [];
  if (field.ai?.includeAttachments === true && noteId) {
    const seen = new Set<string>();
    let images = 0;
    let documents = 0;
    for (const name of aiPromptFieldNames(prompt)) {
      const ref = table.fields.find((f) => f.id !== field.id && f.name === name);
      if (!ref || (ref.type !== "image" && ref.type !== "attachment")) continue;
      for (const attachment of bitableAttachments(record.values[ref.id])) {
        if (seen.has(attachment.file)) continue;
        seen.add(attachment.file);
        const asset = { noteId, filename: attachment.file, name: attachment.name };
        if (isImageExtension(extOf(attachment.file))) {
          if (images >= AI_FIELD_MAX_IMAGES) return { ok: false, error: "这一行引用的图片超过上限（" + AI_FIELD_MAX_IMAGES + " 张）" };
          images += 1;
          parts.push({ type: "image", asset });
        } else if (extOf(attachment.file).replace(/^\./, "").toLowerCase() === "pdf") {
          if (documents >= AI_FIELD_MAX_DOCUMENTS) return { ok: false, error: "这一行引用的 PDF 超过上限（" + AI_FIELD_MAX_DOCUMENTS + " 个）" };
          documents += 1;
          parts.push({ type: "document", asset });
        }
      }
    }
  }
  const total = BITABLE_AI_SYSTEM_PROMPT.length + text.length;
  if (total > BITABLE_AI_MAX_CHARS) return { ok: false, error: "上下文太长（" + total + " 字符），请精简命令" };
  const userContent: AiChatMessage["content"] = parts.length > 0 ? [{ type: "text", text }, ...parts] : text;
  return { ok: true, messages: [{ role: "system", content: BITABLE_AI_SYSTEM_PROMPT }, { role: "user", content: userContent }] };
}
