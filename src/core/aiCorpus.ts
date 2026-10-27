/**
 * AI「本轮资料」块的拼装（纯函数，两端可复用；261023）。
 *
 * 结构（docs/MOBILE-AI.md §9.3）：
 *   【本轮资料开始】共 N 篇 · 约 X 字
 *   【资料 1/N】《标题》（总字数 [，节选前 taken 字]）
 *   <纯文本；图片位置已是 [图片] 占位>
 *   ...
 *   【本轮资料结束】
 *
 * 约束：资料块是**会话级冻结前缀**（放在 system 之后、历史之前），因此这里的输出必须只依赖入参、
 * 逐字节稳定（同样的 docs 永远得到同样的字符串），否则供应商前缀缓存失效。
 */
export const AI_CORPUS_BEGIN = "【本轮资料开始】";
export const AI_CORPUS_END = "【本轮资料结束】";

/** 资料模式下的系统规则（追加在共享 AI_SYSTEM_PROMPT 之后）。 */
export const AI_CORPUS_RULE = [
  "资料规则：",
  "1. 只依据下面的资料回答；资料里没有的内容，直接说「资料里没有」，不要编造。",
  "2. 引用时用《标题》指明来源，并尽量贴近原文。",
  "3. 正文里的 [图片] 只是占位符，不代表你看到了图片。",
].join("\n");

/** 资料为空时的提示（避免模型假装读过文档）。 */
export const AI_NO_CORPUS_RULE = "本轮没有提供资料：只能依据对话历史回答，不要假装看过任何文档。";

export interface AiCorpusDoc {
  title: string;
  /** 已按预算裁好的纯文本。 */
  text: string;
  /** 该文档的完整字数（用于标注节选比例）。 */
  totalChars: number;
  /** 实际收录字数。 */
  takenChars: number;
  truncated: boolean;
}

/** 拼资料块；空数组返回空字符串（调用方据此不注入资料消息）。 */
export function buildAiCorpusBlock(docs: readonly AiCorpusDoc[]): string {
  if (!docs.length) return "";
  const total = docs.reduce((sum, doc) => sum + doc.takenChars, 0);
  const head = AI_CORPUS_BEGIN + "共 " + docs.length + " 篇 · 约 " + total + " 字";
  const body = docs.map((doc, index) => {
    const size = doc.truncated
      ? "（" + doc.totalChars + " 字，节选前 " + doc.takenChars + " 字）"
      : "（" + doc.totalChars + " 字）";
    return "【资料 " + (index + 1) + "/" + docs.length + "】《" + doc.title + "》" + size + "\n" + doc.text;
  }).join("\n");
  return head + "\n" + body + "\n" + AI_CORPUS_END;
}

/** 系统提示 = 共享基础提示 + 资料规则（有/没有资料两种措辞）。 */
export function buildAiSystemPrompt(base: string, hasCorpus: boolean): string {
  return base + "\n\n" + (hasCorpus ? AI_CORPUS_RULE : AI_NO_CORPUS_RULE);
}
