/**
 * 共享检索分词（lake-core）：中文/日文/韩文按单字，拉丁与数字按整词，其余为分隔符。
 * 索引端与查询端必须使用同一函数，保证「写什么、查什么」逐字节一致。
 * 中文单字 + FTS5 unicode61 = 任意长度子串都可走索引；配合查询侧的引号短语要求位置相邻。
 */
const CJK_RE = /[\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{F900}-\u{FAFF}\u{3040}-\u{30FF}\u{AC00}-\u{D7AF}\u{20000}-\u{2FA1F}]/u;
const WORD_RE = /[\p{L}\p{N}]/u;

export function segmentText(text: string): string[] {
  const out: string[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer) {
      out.push(buffer);
      buffer = "";
    }
  };
  for (const char of text) {
    if (CJK_RE.test(char)) {
      flush();
      out.push(char);
    } else if (WORD_RE.test(char)) {
      buffer += char;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

export function segmentToIndexText(text: string): string {
  return segmentText(text).join(" ");
}
