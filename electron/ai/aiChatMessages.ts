import type { AiChatMessage } from "../../src/core/aiProviders.js";
import { AppError } from "../../src/core/storeErrors.js";

/**
 * AI 对话消息的入参护栏（主进程）。
 * 上限防超长 / 超多消息；坏输入抛 AppError(InvalidInput) 由 registrar 统一编码。
 */
export const AI_MAX_MESSAGES = 40;
export const AI_MAX_TOTAL_CHARS = 200_000;

/**
 * 校验并裁剪消息，**保留最近 `AI_MAX_MESSAGES` 条**。
 *
 * 261005 修：原来取的是**最前面** 40 条（`raw.slice(0, N)`）—— 长对话超过上限时反而把**最新的问答**
 * 丢掉（表现为"突然失忆 / 答非所问"）。改成 `raw.slice(-N)`：更早的上下文先丢，当前这轮一定在。
 */
export function assertMessages(raw: unknown): AiChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AppError("InvalidInput", "消息为空");
  const out: AiChatMessage[] = [];
  let total = 0;
  for (const item of raw.slice(-AI_MAX_MESSAGES)) {
    const m = (item ?? {}) as { role?: unknown; content?: unknown };
    const role = m.role === "system" || m.role === "assistant" ? m.role : "user";
    const content = typeof m.content === "string" ? m.content : "";
    if (!content) continue;
    total += content.length;
    if (total > AI_MAX_TOTAL_CHARS) throw new AppError("InvalidInput", "内容过长");
    out.push({ role, content });
  }
  if (out.length === 0) throw new AppError("InvalidInput", "消息为空");
  return out;
}
