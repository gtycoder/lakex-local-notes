/**
 * AI 助手**首轮预设提示词**（单一来源，261005）。
 *
 * 交互约定：点击预设 = 只把提示词**填进输入框**，仍由用户点「生成」确认（绝不自动发送）；
 * 选中文字会自动拼在提示词末尾（见 AiAssistantDialog 的 firstPrompt）⇒ 模板只写「指令」。
 * 「自定义」= 空输入，由调用方按 `AI_PROMPT_CUSTOM_ID` 处理，放在最后。
 */
export interface AiPromptPreset {
  id: string;
  label: string;
  prompt: string;
}

export const AI_PROMPT_PRESETS: AiPromptPreset[] = [
  { id: "summary", label: "总结", prompt: "请把下面的内容总结成要点：" },
  { id: "continue", label: "续写", prompt: "请顺着下面的内容继续写，保持风格一致：" },
  { id: "abstract", label: "摘要", prompt: "请为下面的内容写一段简短摘要（150 字以内）：" },
  { id: "fix", label: "修正", prompt: "请修正下面内容的错别字、语法和标点，不改变原意：" },
];

/** 图片上下文的预设提示词（图片浮栏「AI」/ 选区含图时用；同样只填词、不发送）。 */
export const AI_IMAGE_PRESETS: AiPromptPreset[] = [
  { id: "image-describe", label: "描述", prompt: "请详细描述这张图片的内容：" },
  { id: "image-ocr", label: "提取文字", prompt: "请提取这张图片里的所有文字，原样输出：" },
  { id: "image-translate", label: "翻译", prompt: "请把这张图片里的文字翻译成中文：" },
];

/** 「自定义」段（默认/兜底，排在最后）。 */
export const AI_PROMPT_CUSTOM_ID = "custom";
export const AI_PROMPT_CUSTOM_LABEL = "自定义";
