/**
 * F1 应用内日志读取（桌面主进程专用；含纯函数 tailLinesMatching 供单测）。
 *
 * - 纯函数：按关键字过滤 + 保留上下文 ±1 行，返回尾部优先、条数封顶。
 * - IPC（registerLogIpc）：白名单路径 = userData/logs/lake-notes.log（+ 轮转 .old），
 *   渲染层只传 keyword/maxLines，绝不接受任意路径。
 */

export interface LogTailMatch {
  line: string;
  /** 是否关键字命中行（上下文行 false） */
  hit: boolean;
}

export interface LogTailOptions {
  keyword?: string;
  maxLines: number;
  /** 每条命中前后保留的上下文行数 */
  context?: number;
}

/** 纯函数：全文 → 命中行（含上下文），尾部优先；keyword 空 = 取末尾 maxLines 行。 */
export function tailLinesMatching(fullText: string, opts: LogTailOptions): LogTailMatch[] {
  const context = Math.max(0, opts.context ?? 1);
  const lines = fullText.split("\n");
  const kw = opts.keyword?.trim();
  const hits: number[] = [];
  if (!kw) {
    // 无关键字：直接取末尾 maxLines 行（全当上下文展示，无命中标记）
    const start = Math.max(0, lines.length - opts.maxLines);
    return lines.slice(start).map((line) => ({ line, hit: false }));
  }
  const lower = kw.toLowerCase();
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(lower)) hits.push(i);
  });
  if (hits.length === 0) return [];
  const show = new Set<number>();
  for (const h of hits) {
    for (let d = -context; d <= context; d++) show.add(h + d);
  }
  const filtered: Array<{ i: number; line: string }> = [];
  for (const i of [...show].sort((a, b) => a - b)) {
    if (i >= 0 && i < lines.length) filtered.push({ i, line: lines[i] });
  }
  // 尾部优先：封顶取最后 maxLines 条
  const tail = filtered.slice(-opts.maxLines);
  return tail.map(({ i, line }) => ({ line, hit: hits.includes(i) }));
}
