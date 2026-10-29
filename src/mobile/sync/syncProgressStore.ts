/**
 * 移动端同步进度（P0-6）：引擎 onProgress → 节流 → UI 订阅。
 *
 * 约束（用户 261026）：大进度只在同步进行中显示；增量同步只显示短文案。
 * 节流：≥250ms 或百分比变化 ≥1% 才通知；阶段切换/结束立即通知。
 */
import type { S3v3Progress } from "../../core/s3v3Engine.js";

export interface SyncProgressSnapshot {
  phase: string;
  done?: number;
  total?: number;
  bytesDone?: number;
  bytesTotal?: number;
  /** 最近一次更新时间（ms）；UI 可据此显示"停滞"。 */
  at: number;
}

let current: SyncProgressSnapshot | null = null;
const listeners = new Set<() => void>();
let lastEmitAt = 0;
let lastPct = -1;
let lastPhase = "";
const MIN_INTERVAL_MS = 250;

function emit(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* 订阅方自行负责 */ }
  }
}

export function readSyncProgress(): SyncProgressSnapshot | null { return current; }

export function subscribeSyncProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function beginSyncProgress(): void {
  current = null; lastEmitAt = 0; lastPct = -1; lastPhase = "";
  emit();
}

export function endSyncProgress(): void {
  current = null; lastEmitAt = 0; lastPct = -1; lastPhase = "";
  emit();
}

export function pushSyncProgress(p: S3v3Progress): void {
  const now = Date.now();
  const pct = p.total && p.total > 0 ? Math.floor(((p.done ?? 0) / p.total) * 100) : -1;
  const phaseChanged = p.phase !== lastPhase;
  if (!phaseChanged && now - lastEmitAt < MIN_INTERVAL_MS && (pct < 0 || pct === lastPct)) return;
  if (!phaseChanged && pct >= 0 && pct === lastPct && now - lastEmitAt < MIN_INTERVAL_MS) return;
  lastEmitAt = now;
  lastPct = pct;
  lastPhase = p.phase;
  current = { phase: p.phase, done: p.done, total: p.total, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, at: now };
  emit();
}

const PHASE_LABEL: Record<string, string> = {
  metadata: "读取云端索引",
  bodies: "下载正文",
  apply: "应用到本地",
  declarations: "读取资产声明",
  assets: "下载附件",
  uploads: "上传变更",
  finalize: "收尾",
  done: "完成",
};

export function formatBytesShort(n: number | undefined): string {
  if (!n || n <= 0) return "0B";
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + "MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + "GB";
}

/** 一行式进度文案（设置卡/首页 title 共用）：大阶段带计数与字节，增量只给短文案。 */
export function describeSyncProgress(p: SyncProgressSnapshot | null): string {
  if (!p) return "";
  const label = PHASE_LABEL[p.phase] ?? p.phase;
  if (p.phase === "finalize" || p.phase === "done" || p.phase === "metadata") return label + "…";
  const counted = p.total !== undefined && p.total > 0;
  const bytes = p.bytesTotal !== undefined && p.bytesTotal > 0;
  if (!counted && !bytes) return label + "…";
  if (counted && bytes) return label + " " + (p.done ?? 0) + "/" + p.total + "，" + formatBytesShort(p.bytesDone) + "/" + formatBytesShort(p.bytesTotal);
  if (counted) return label + " " + (p.done ?? 0) + "/" + p.total;
  return label + "，" + formatBytesShort(p.bytesDone) + "/" + formatBytesShort(p.bytesTotal);
}
