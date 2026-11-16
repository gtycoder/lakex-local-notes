/**
 * 端到端 AI 流式计时探针 —— 合成 Markdown 内容（纯函数，无依赖）。
 *
 * 同一份内容被两侧使用：Node 侧假供应商（拆成帧发 SSE）与页面侧 harness（校准渲染成本），
 * 保证「发的」和「量的」是同一段文本。代码围栏用 String.fromCharCode(96) 拼，避免本文件出现反引号。
 */
const FENCE = String.fromCharCode(96).repeat(3);

export function buildMarkdown(totalChars) {
  const parts = ["# 流式压测回答\n\n"];
  let length = parts[0].length;
  let index = 0;
  while (length < totalChars) {
    if (index % 12 === 0) {
      const heading = "## 第 " + (index + 1) + " 组\n\n";
      parts.push(heading);
      length += heading.length;
    } else if (index % 12 === 6) {
      const code = FENCE + "\nconst line" + index + " = \"流式渲染压测\";\n" + FENCE + "\n\n";
      parts.push(code);
      length += code.length;
    } else {
      const line = "- 第 " + (index + 1) + " 条：这是一段用于流式 Markdown 渲染压测的中文内容，包含 **加粗**、行内代码与普通文本，用来逼近长回答的真实解析与建 DOM 成本。\n";
      parts.push(line);
      length += line.length;
    }
    index += 1;
  }
  return parts.join("");
}

/** 把全文切成 frames 帧（尽量等长，至少 1 字符），供假供应商按固定速率吐。 */
export function splitFrames(text, frames) {
  const size = Math.max(1, Math.ceil(text.length / Math.max(1, frames)));
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
/**
 * 「密集 DOM」压测内容：很多极短列表项（每条一个 <li>），用来逼近「长回答 = 大量块」时
 * 每次提交都要重建大量 DOM 的现实成本。仅用于压力档，不代表平均回答。
 */
export function buildDenseMarkdown(totalChars) {
  const parts = ["# 密集压测回答\n\n"];
  let length = parts[0].length;
  let index = 0;
  while (length < totalChars) {
    const line = "- " + (index + 1) + "\n";
    parts.push(line);
    length += line.length;
    index += 1;
  }
  return parts.join("");
}
