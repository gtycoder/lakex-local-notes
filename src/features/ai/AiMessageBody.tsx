import { MarkdownView } from "../../components/ui/markdown/MarkdownView";
import { useThrottledMarkdown } from "../../components/ui/markdown/useThrottledMarkdown";

/**
 * AI 回答正文的**唯一渲染入口**（261005 预留的**可替换接口**）。
 *
 * 当前 = 自研轻量子集渲染器 MarkdownView（零依赖、无 innerHTML、样式作用域 .md-preview）：
 * 标题 h1–h6 / 段落 / 粗体 / 斜体 / 删除线 / 行内代码 / 代码块 / 引用 / 有序·无序列表（嵌套）/ 链接 / 分割线；
 * 表格与图片按原文呈现；无法识别的语法按段落兜底（模型偶尔吐非 MD 也不会坏）。
 *
 * 将来整体换成 react-markdown / remark-gfm / llm-ui / streamdown，也**只改这一个组件**，
 * 调用方与面板结构都不动。这里走**流式**渲染（每个 delta 重新解析，见 MarkdownView 的 useMemo）。
 */
export function AiMessageBody({ text }: { text: string }) {
  return <MarkdownView source={text} />;
}

/**
 * **流式中的** AI 回答正文：与 `AiMessageBody` 同一渲染器，只是先过一层按渲染耗时的节流。
 *
 * 来源：deepseek-ai/chat-demo（MIT）的 `useThrottleMarkdownRender`（改造说明见
 * `components/ui/markdown/useThrottledMarkdown.ts` 文件头）。
 * 改动：节流只在这一层做，`AiMessageBody` 仍是「完整正文」的唯一渲染入口——生成结束
 * （弹窗把 `streaming` 切成 false）就换回 `AiMessageBody`，最终完整内容当帧渲染，不会残留截断。
 */
export function AiStreamingMessageBody({ text }: { text: string }) {
  // 本组件只在生成中挂载 ⇒ enabled 恒为 true；卸载时 hook 内部会清掉未触发的定时器。
  const shown = useThrottledMarkdown(text, true);
  return <AiMessageBody text={shown} />;
}
