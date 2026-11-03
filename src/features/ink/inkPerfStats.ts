/**
 * 手写板性能观测（261103 十一批）：只读、默认关、**零行为改变**。
 *
 * 目的：先把「大文档到底什么时候变慢」量化出来，再决定要不要做存储层 v4（页粒度 manifest +
 * 每页 blob 的增量保存 / 虚拟加载）。现在测三件事：
 *   · load  —— 打开文档时 parseInkBody 的耗时与正文字节数、页数；
 *   · save  —— 每次真正落盘（500ms 防抖后）时 inkToBody 的耗时、字节数、页数；
 *   · 可选 strokes/points 计数（只在 debug 开启时统计，避免给保存路径加常驻开销）。
 *
 * 取数：window.__inkPerfStats()；清空：window.__inkPerfReset()。
 * 开日志：localStorage.setItem("lakex-local-notes-v3.ink-perf-debug","1")（或 window.__inkPerfDebug = true）
 *   → 每样本一行 [ink-perf] save 26.7ms 11.4MiB pages=300，超过阈值打 warn。
 *
 * 阈值（判断 v4 是否值得立项，见 docs/INK-PAD.md 的 v4 提案）：
 *   · 正文字节 > 4 MiB，或页数 > 50，或单次序列化 > 50ms，或单次解析 > 300ms。
 */
export interface InkPerfSample {
  kind: "load" | "save";
  /** 解析 / 序列化耗时（ms）。 */
  ms: number;
  /** 正文字节数（与 MAX_INK_BODY_CHARS 同口径）。 */
  bytes: number;
  pages: number;
  strokes?: number;
  points?: number;
  at: number;
}

export const INK_PERF_WARN_BYTES = 4 * 1024 * 1024;
export const INK_PERF_WARN_PAGES = 50;
export const INK_PERF_WARN_SERIALIZE_MS = 50;
export const INK_PERF_WARN_PARSE_MS = 300;

const STORAGE_KEY = "lakex-local-notes-v3.ink-perf-debug";
const MAX_SAMPLES = 40;

let samples: InkPerfSample[] = [];
let hooksInstalled = false;

export function inkPerfDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as { __inkPerfDebug?: boolean }).__inkPerfDebug === true) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + "MiB";
}

/** 阈值判据（纯函数，便于单测）：返回触发的阈值名列表。 */
export function inkPerfThresholdHits(sample: Pick<InkPerfSample, "kind" | "ms" | "bytes" | "pages">): string[] {
  const hits: string[] = [];
  if (sample.bytes > INK_PERF_WARN_BYTES) hits.push("bytes>4MiB");
  if (sample.pages > INK_PERF_WARN_PAGES) hits.push("pages>50");
  if (sample.kind === "save" && sample.ms > INK_PERF_WARN_SERIALIZE_MS) hits.push("serialize>50ms");
  if (sample.kind === "load" && sample.ms > INK_PERF_WARN_PARSE_MS) hits.push("parse>300ms");
  return hits;
}

export function recordInkPerf(sample: Omit<InkPerfSample, "at">): void {
  const full: InkPerfSample = { ...sample, at: Date.now() };
  samples.push(full);
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
  const hits = inkPerfThresholdHits(full);
  if (!inkPerfDebugEnabled()) return;
  const detail = "[ink-perf] " + full.kind + " " + Math.round(full.ms) + "ms " + formatMiB(full.bytes)
    + " pages=" + full.pages
    + (full.strokes !== undefined ? " strokes=" + full.strokes : "")
    + (full.points !== undefined ? " points=" + full.points : "");
  if (hits.length > 0) console.warn(detail + " ⚠ " + hits.join(","));
  else console.info(detail);
}

export function inkPerfStats(): { enabled: boolean; samples: InkPerfSample[]; thresholds: Record<string, number> } {
  return {
    enabled: inkPerfDebugEnabled(),
    samples: samples.slice(),
    thresholds: {
      bytes: INK_PERF_WARN_BYTES,
      pages: INK_PERF_WARN_PAGES,
      serializeMs: INK_PERF_WARN_SERIALIZE_MS,
      parseMs: INK_PERF_WARN_PARSE_MS,
    },
  };
}

export function resetInkPerf(): void {
  samples = [];
}

/** 装 window 取数钩子（幂等；生产也只是挂两个函数，不产生监听）。 */
export function installInkPerfHooks(): void {
  if (typeof window === "undefined" || hooksInstalled) return;
  hooksInstalled = true;
  const w = window as {
    __inkPerfStats?: () => unknown;
    __inkPerfReset?: () => void;
  };
  w.__inkPerfStats = () => inkPerfStats();
  w.__inkPerfReset = () => resetInkPerf();
}
