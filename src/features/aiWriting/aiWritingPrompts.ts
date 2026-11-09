/**
 * AI 写作空间的提示词库与「点一点试试」（语雀同款位置与交互，文案为本项目自有版本）。
 *
 * 单一来源：提示词卡片面板、输入卡 chip、示例 chip 都从这里取；改文案只改这里。
 */
import { BookOpen, Languages, MessageSquareQuote, PenLine, Sigma, Sparkles } from "lucide-react";
import type { AiWritingMode } from "../../core/aiWriting";

export interface AiWritingPromptCard {
  id: string;
  title: string;
  /** 卡片上的一行说明（列表里单行省略）。 */
  description: string;
  /** 点击后挂到输入卡上的完整提示词（不写进正文）。 */
  prompt: string;
  Icon: typeof Sparkles;
}

export const AI_WRITING_PROMPT_CARDS: readonly AiWritingPromptCard[] = [
  {
    id: "slogan",
    title: "生成产品标语",
    description: "你是一个宣传标语专家，为产品写一句押韵、有记忆点的标语",
    prompt: "你是一个宣传标语专家。请为下面的产品设计一句独具创意、朗朗上口的宣传标语：结合产品的核心价值和特点，可以用比喻或双关，要押韵、不要书面化，只输出标语本身，不要解释。产品是：",
    Icon: Sparkles,
  },
  {
    id: "polish",
    title: "润色与改写",
    description: "在保留原意的前提下，把文字改得更简洁、更通顺",
    prompt: "请润色下面这段文字：保留原意与事实，去掉重复和口水话，让句子更短更通顺；术语保持一致，不要添加原文没有的信息。只输出润色后的文字。原文：",
    Icon: PenLine,
  },
  {
    id: "weekly",
    title: "写一份周报",
    description: "把素材整理成「本周进展 / 问题 / 下周计划」的周报",
    prompt: "请把下面的素材整理成一份周报，结构为：本周进展（按项目分组）、遇到的问题与风险、下周计划。条目化、动词开头、去掉套话，只输出周报正文。素材：",
    Icon: MessageSquareQuote,
  },
  {
    id: "notes",
    title: "会议纪要整理",
    description: "从零散记录中提炼结论、待办与责任人",
    prompt: "请把下面的会议记录整理成纪要：一、结论与决议；二、待办（负责人 + 截止时间，未知就留空）；三、需要进一步确认的问题。只输出纪要正文。记录：",
    Icon: BookOpen,
  },
  {
    id: "translate",
    title: "中译英翻译专家",
    description: "按信达雅标准翻译成英文，兼顾语气与地区差异",
    prompt: "你是一个翻译专家，把下面的中文翻译成英文：忠实原意，表达自然，符合目标语言习惯；专有名词保留原文。只输出译文。原文：",
    Icon: Languages,
  },
  {
    id: "formula",
    title: "输出标准公式",
    description: "用 LaTeX 输出公式，行内与块级分开",
    prompt: "请用 LaTeX 输出公式，并用 $$ 包裹块级公式、$ 包裹行内公式；变量含义用一句话说明。内容是：",
    Icon: Sigma,
  },
];

export interface AiWritingSuggestion {
  label: string;
  prompt: string;
}

/** 空态「点一点试试」：两个 chip（对话写作 / 多文档推理各一套）。 */
export const AI_WRITING_SUGGESTIONS: Record<AiWritingMode, readonly AiWritingSuggestion[]> = {
  chat: [
    { label: "今日信息差", prompt: "用条目列出今天值得关注的几件科技与产品动态，每条一句话说明为什么重要。" },
    { label: "推荐一本新书", prompt: "推荐一本适合产品/工程从业者读的书，说明它能解决什么具体问题，再给一段可以立刻实践的清单。" },
  ],
  docs: [
    { label: "根据近一周我编辑的文档写一份周报", prompt: "请根据这些文档写一份周报：本周进展、遇到的问题、下周计划；条目化，不要编造资料里没有的内容。" },
    { label: "把我近一周的小记有条理地汇总成一篇文档", prompt: "请把这些小记汇总成一篇结构清晰的文档：先给一句摘要，再按主题归并，保留具体事实与数字。" },
  ],
};

/** 空态标题：和 <供应商名> 对话写作。 */
export function aiWritingChatTitle(providerLabel: string): string {
  return "和 " + providerLabel + " 对话写作";
}

/** 多文档模式标题：根据 N 篇文档 推理分析 / 根据「名称」推理分析 / 请选择文档。 */
export function aiWritingDocsTitle(docRefs: readonly { title: string }[]): string {
  if (docRefs.length === 0) return "根据 请选择文档 推理分析";
  if (docRefs.length === 1) return "根据 " + docRefs[0].title + " 推理分析";
  return "根据 " + docRefs.length + " 篇文档 推理分析";
}
