import { extractText, getDocumentProxy } from "unpdf";
import { AppError } from "../../src/core/storeErrors.js";

export const AI_PDF_MAX_BYTES = 32 * 1024 * 1024;
export const AI_PDF_MAX_CHARS = 60_000;
export const AI_PDF_TIMEOUT_MS = 10_000;

interface PdfCacheEntry { text: string; pages: number; truncated: boolean; at: number }

/** 请求间缓存：整列 AI 生成会对同一份 PDF 重复抽取（key = noteId/filename/size）。 */
const cache = new Map<string, PdfCacheEntry>();
const CACHE_MAX_ENTRIES = 24;
const CACHE_TTL_MS = 10 * 60_000;

/** 仅测试用：清空抽取缓存。 */
export function clearPdfTextCache(): void { cache.clear(); }

function cacheGet(key: string): PdfCacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit;
}
function cacheSet(key: string, entry: PdfCacheEntry): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

function withTimeout<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError("InvalidInput", message)), ms);
    timer.unref?.();
    task.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * 抽取 PDF 文本（主进程）：供应商侧不支持 PDF 文档输入，统一在本地抽成文本。
 * 上限 = 源文件 32MiB / 结果 6 万字符 / 单文档 10s；抽不到文字（扫描件）明确报错，绝不静默发空。
 */
export async function extractPdfText(bytes: Buffer, cacheKey?: string): Promise<{ text: string; pages: number; truncated: boolean }> {
  if (bytes.length > AI_PDF_MAX_BYTES) throw new AppError("InvalidInput", "PDF 文件过大（上限 " + Math.round(AI_PDF_MAX_BYTES / 1024 / 1024) + "MB）");
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) return { text: hit.text, pages: hit.pages, truncated: hit.truncated };
  }
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  let result: { totalPages: number; text: string };
  try {
    result = await withTimeout(extractText(pdf, { mergePages: true }) as Promise<{ totalPages: number; text: string }>, AI_PDF_TIMEOUT_MS, "读取 PDF 超时");
  } finally {
    try { await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* 忽略 */ }
  }
  const raw = typeof result.text === "string" ? result.text : "";
  const truncated = raw.length > AI_PDF_MAX_CHARS;
  const text = truncated ? raw.slice(0, AI_PDF_MAX_CHARS) + "\n…（内容过长，已截断）" : raw;
  if (!text.trim()) throw new AppError("InvalidInput", "PDF 里没有可提取的文字（可能是扫描件）");
  if (cacheKey) cacheSet(cacheKey, { text, pages: result.totalPages, truncated, at: Date.now() });
  return { text, pages: result.totalPages, truncated };
}
