/**
 * AI「插入到选区后」的**标记**（**单一来源**）。
 *
 * 用户 261005 定稿：**不再用引用包裹** AI 内容 —— Lake 的容器（引用/高亮块/分栏/折叠块）都装不下表格，
 * 表格会从引用里跳出来、且前后文字被并进同一个引用 ⇒ 顺序错位（实测见 `docs/LAKEX-CONTRACT.md` §5.16）。
 * 改为：AI 内容**前后各一条分隔线** + 一条「以下内容由 AI 生成」提示；AI 正文按**原生 Markdown** 插入
 * （表格/代码块/标题都是原生块，顺序正确）。
 *
 * 只有「插入到选区后」用这套标记；「替换选区」原样插入、不加任何格式。
 */
export const AI_INSERT_HINT = "以下内容由 AI 生成";

/** 组装插入用的 Markdown：分隔线 + 提示 + AI 正文 + 分隔线。 */
export function buildAiInsertMarkdown(aiText: string): string {
  const body = String(aiText ?? "").replace(/\r\n/g, "\n").trim();
  return "---\n\n" + AI_INSERT_HINT + "\n\n" + body + "\n\n---";
}
