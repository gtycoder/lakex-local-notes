import { MarkdownView } from "../../components/markdown/MarkdownView";

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
