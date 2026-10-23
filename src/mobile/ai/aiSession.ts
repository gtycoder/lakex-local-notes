/**
 * 移动端 AI 会话的纯逻辑（261023 P1）：资料预算 / 请求消息装配 / 建议 chips。
 *
 * 与 UI 解耦、可单测；不碰 IO。装配规则见 docs/MOBILE-AI.md §9：
 *   system（固定）→ 资料块（会话级冻结，只含本轮发送清单）→ 最近 12 轮问答 → 本轮问题。
 * 资料块字节必须只依赖入参（前缀缓存前提）。
 */
import { buildAiCorpusBlock, type AiCorpusDoc } from "../../core/aiCorpus";
import { lakeTextParagraph } from "../../core/lakeDocForm";

/** 一次会话最多选几篇资料（对齐桌面 AI_MAX_DOCUMENTS）。 */
export const AI_CORPUS_MAX_DOCS = 5;
/** 资料总字数上限（≈4 万 token，给历史与输出留余量）。 */
export const AI_CORPUS_MAX_CHARS = 60_000;
/** 低于此字数视为空文档，不收录。 */
export const AI_CORPUS_MIN_CHARS = 200;
/** 只保留最近 N 轮问答（一轮 = 用户 + 助手两条消息）。 */
export const AI_HISTORY_MAX_TURNS = 12;

export interface CorpusDocInput {
  id: string;
  title: string;
  /** 全文纯文本。 */
  text: string;
}

export interface CorpusTake {
  doc: CorpusDocInput;
  text: string;
  totalChars: number;
  takenChars: number;
  truncated: boolean;
  excluded: boolean;
}

export interface CorpusBudget {
  takes: CorpusTake[];
  used: number;
  truncated: boolean;
  excluded: number;
}

/** 按选择顺序收录（段落边界截断），超预算的显式标记 —— 绝不静默。 */
export function takeCorpus(docs: readonly CorpusDocInput[]): CorpusBudget {
  let remaining = AI_CORPUS_MAX_CHARS;
  const takes: CorpusTake[] = [];
  for (const doc of docs) {
    const total = doc.text.length;
    if (total < AI_CORPUS_MIN_CHARS) {
      takes.push({ doc, text: "", totalChars: total, takenChars: 0, truncated: false, excluded: true });
      continue;
    }
    const take = Math.min(total, Math.max(0, remaining));
    const text = take >= total ? doc.text : cutAtBoundary(doc.text, take);
    const takenChars = text.length;
    const truncated = takenChars < total;
    if (!truncated) remaining -= takenChars;
    else remaining = Math.max(0, remaining - takenChars);
    takes.push({ doc, text, totalChars: total, takenChars, truncated, excluded: takenChars <= 0 });
  }
  return {
    takes,
    used: takes.reduce((sum, t) => sum + t.takenChars, 0),
    truncated: takes.some((t) => t.truncated),
    excluded: takes.filter((t) => t.excluded).length,
  };
}

const OMIT_MARKER = "\n……（以下省略）";

/** 在 limit 附近的段落边界（换行/句号）裁断，并**预留省略标记的字数**，保证结果长度 ≤ limit。 */
function cutAtBoundary(text: string, limit: number): string {
  if (limit <= 0) return "";
  if (limit <= OMIT_MARKER.length) return text.slice(0, limit);
  const room = limit - OMIT_MARKER.length;
  const slice = text.slice(0, room);
  const cut = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf("。"));
  const at = cut > room * 0.6 ? cut + 1 : room;
  return text.slice(0, Math.min(at, room)) + OMIT_MARKER;
}

/** 资料块（给 core 的拼装器；只传已裁好的文本）。 */
export function corpusBlockOf(budget: CorpusBudget): string {
  const docs: AiCorpusDoc[] = budget.takes
    .filter((t) => !t.excluded && t.takenChars > 0)
    .map((t) => ({ title: t.doc.title, text: t.text, totalChars: t.totalChars, takenChars: t.takenChars, truncated: t.truncated }));
  return buildAiCorpusBlock(docs);
}

export interface ChatTurn { role: "user" | "assistant"; text: string }

export interface ChatMessageLike { role: "system" | "user" | "assistant"; content: string }

export interface BuildMessagesArgs {
  system: string;
  /** 已拼好的资料块；空串 = 本轮不带资料。 */
  corpusBlock: string;
  /** 历史（含本轮之前的问答；按时间正序）。 */
  history: readonly ChatTurn[];
  question: string;
}

/** 装配一次请求的消息数组（内容全是字符串，原生通道只收纯文本）。 */
export function buildChatMessages(args: BuildMessagesArgs): ChatMessageLike[] {
  const out: ChatMessageLike[] = [{ role: "system", content: args.system }];
  if (args.corpusBlock) out.push({ role: "user", content: args.corpusBlock });
  for (const turn of capTurns(args.history)) out.push({ role: turn.role, content: turn.text });
  out.push({ role: "user", content: args.question });
  return out;
}

/** 只保留最近 N 轮（成对裁，避免留下孤立的 assistant 回复）。 */
export function capTurns(history: readonly ChatTurn[]): ChatTurn[] {
  const max = AI_HISTORY_MAX_TURNS * 2;
  return history.length <= max ? [...history] : history.slice(history.length - max);
}

/** 结果保存为新文档时的标题：问句前 30 字（去掉换行）。 */
export function answerTitle(question: string): string {
  const title = question.replace(/\s+/g, " ").trim().slice(0, 30);
  return title || "AI 回答";
}

/** 空态建议 chips（随资料有无切换）。 */
export function suggestions(hasCorpus: boolean, docCount: number): string[] {
  if (!hasCorpus) return ["写一段周报", "翻译一段文字", "头脑风暴", "解释一个概念"];
  return ["总结这 " + docCount + " 篇", "对比异同", "列出待办", "提炼要点"];
}

/** 把纯文本回答落成 Lake 正文（每行一个段落；媒体一律走卡片，这里只产文本段落）。 */
export function lakeBodyFromText(text: string, newId: () => string = () => crypto.randomUUID()): string {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const paragraphs = (lines.length > 0 ? lines : [""]).map((line) => lakeTextParagraph(newId(), newId(), line));
  return paragraphs.join("");
}
