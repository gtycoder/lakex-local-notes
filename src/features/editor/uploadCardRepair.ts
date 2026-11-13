/**
 * 按图片上传日志回填正文卡片（261114）。
 *
 * 当编辑器实例在上传完成前被重建时，内核会把卡片写成 `status:"error"` / `src:""` /
 * `errorMessage:"unknown error"`（virtual task 3s 超时，且内核超时分支传的是字符串
 * ⇒ `.message` 为 undefined）。但 taskId 会保留在卡片里，而我们的 uploadJournal
 * 记录了同一 taskId 的真实结果 ⇒ 打开文档时把真实资产/真实原因写回卡片。
 *
 * 这是**纯函数**（不碰 DOM/IO），EditorTab 在 createLakeDocument/setDocument 之前调用：
 * 正文里已是 done 的卡不会重复改；只处理空 src 的未完成卡，幂等。
 */
import { getUploadEntry, uploadsForNote, type UploadJournalEntry } from "./uploadJournal";

export interface UploadCardRepairResult {
  content: string;
  changed: boolean;
  repairedTaskIds: string[];
}

interface ImageCardMatch {
  raw: string;
  valueStart: number;
  valueEnd: number;
  value: string;
}

const CARD_PATTERN = /<card\b[^>]*>/g;

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp("\\b" + name + "=\"([^\"]*)\"").exec(attributes);
  return match ? match[1] : null;
}

/** 找出正文里所有 image 卡的 value（记录它在字符串中的区间，便于原位替换）。 */
export function findImageCardValues(content: string): ImageCardMatch[] {
  const results: ImageCardMatch[] = [];
  for (const match of content.matchAll(CARD_PATTERN)) {
    const tag = match[0];
    if (attribute(tag, "name") !== "image") continue;
    const valueAttribute = /\bvalue="([^"]*)"/.exec(tag);
    if (!valueAttribute) continue;
    const value = valueAttribute[1];
    const valueStart = (match.index ?? 0) + valueAttribute.index + "value=\"".length;
    results.push({ raw: tag, valueStart, valueEnd: valueStart + value.length, value });
  }
  return results;
}

function decodeCardValue(value: string): Record<string, unknown> | null {
  try {
    const encoded = value.startsWith("data:") ? value.slice("data:".length) : value;
    const decoded = decodeURIComponent(encoded);
    const parsed: unknown = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function encodeCardValue(value: Record<string, unknown>): string {
  return "data:" + encodeURIComponent(JSON.stringify(value));
}

/** 把一条日志结果应用到卡片 value 上；返回新 value（未改动返回 null）。 */
export function applyJournalEntryToCard(
  value: Record<string, unknown>,
  entry: UploadJournalEntry,
): Record<string, unknown> | null {
  if (value.taskId !== entry.taskId) return null;
  const hasSrc = typeof value.src === "string" && value.src.length > 0;
  // 已完成的卡（含内核正常成功路径写回的）绝不覆盖；只修「空 src 的未完成卡」。
  if (value.status === "done" && hasSrc) return null;
  if (hasSrc) return null;

  if (entry.status === "done" && entry.output) {
    return {
      ...value,
      src: entry.output.url,
      name: entry.output.filename,
      size: entry.output.size,
      status: "done",
      errorMessage: undefined,
    };
  }
  if (entry.status === "error") {
    const message = entry.error || "图片下载失败";
    if (value.status === "error" && value.errorMessage === message) return null;
    return { ...value, status: "error", errorMessage: message };
  }
  return null;
}

/** 正文回填：done → 写回真实资产 URL；error → 写回真实失败原因。幂等。 */
export function repairUploadCards(content: string, noteId: string): UploadCardRepairResult {
  if (!content || !content.includes("<card")) return { content, changed: false, repairedTaskIds: [] };
  const entries = uploadsForNote(noteId);
  if (entries.length === 0) return { content, changed: false, repairedTaskIds: [] };
  const byTask = new Map(entries.map((entry) => [entry.taskId, entry]));

  let changed = false;
  const repairedTaskIds: string[] = [];
  let output = "";
  let cursor = 0;
  for (const card of findImageCardValues(content)) {
    const value = decodeCardValue(card.value);
    if (!value || typeof value.taskId !== "string") continue;
    const entry = byTask.get(value.taskId);
    if (!entry) continue;
    const patched = applyJournalEntryToCard(value, entry);
    if (!patched) continue;
    output += content.slice(cursor, card.valueStart) + encodeCardValue(patched);
    cursor = card.valueEnd;
    changed = true;
    repairedTaskIds.push(entry.taskId);
  }
  if (!changed) return { content, changed: false, repairedTaskIds: [] };
  output += content.slice(cursor);
  return { content: output, changed: true, repairedTaskIds };
}

/** 当前正文里是否还有「该 taskId 的未完成图卡」（用于判断晚到结果要不要触发编辑器自愈）。 */
export function hasUnresolvedImageTask(content: string, taskId: string): boolean {
  if (!content || !content.includes(taskId)) return false;
  for (const card of findImageCardValues(content)) {
    const value = decodeCardValue(card.value);
    if (!value || value.taskId !== taskId) continue;
    const hasSrc = typeof value.src === "string" && value.src.length > 0;
    if (hasSrc) return false;
    // error 卡已带真实原因 = 已回填过；仍为空/unknown 的才算未解决。
    if (value.status === "error" && typeof value.errorMessage === "string" && value.errorMessage !== "unknown error") return false;
    return true;
  }
  return false;
}

/** 日志里该 note 是否还有可恢复任务（供 EditorTab 决定是否发起恢复）。 */
export function hasJournalUploads(noteId: string): boolean {
  return uploadsForNote(noteId).some((entry) => entry.status === "pending" || (entry.status === "done" && entry.output));
}

/** 单条日志读取（测试/诊断）。 */
export { getUploadEntry };
