/**
 * 同步 warning 的**合并与去重**（261112 W4 收口；两端共用单一来源）。
 *
 * 背景：引擎/plan 会产出两类东西——
 *  1) `warningDetails`：带 kind/noteId/title 的结构化项（UI 可逐项展示、可定位）；
 *  2) `warnings`：一行式文本（历史路径，很多没有结构化明细，过去只进日志 = UI 看不见）。
 * 这里把「没有结构化明细的一行式 warning」补成结构化项（kind=remote_incomplete，符合既有归类），
 * 并按「结构化 message 已被一行式文本包含 / 反之」去重，避免同一件事在浮层里数两遍。
 *
 * 注意：**apply_skipped 必须由调用方单独传 extra**（那是"本地写失败"，不能归到 remote_incomplete）。
 */
import type { SyncWarning } from "./sharedTypes.js";

export interface MergeSyncWarningsInput {
  /** 引擎/plan 给出的结构化警告。 */
  structured: readonly SyncWarning[];
  /** 额外结构化项（如单篇 apply 失败 = apply_skipped）。 */
  extra?: readonly SyncWarning[];
  /** 一行式 warning 文本（无结构化明细者会被补成 structured）。 */
  logLines: readonly string[];
}

function overlaps(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function mergeSyncWarnings(input: MergeSyncWarningsInput): SyncWarning[] {
  const out: SyncWarning[] = [...input.structured, ...(input.extra ?? [])];
  for (const line of input.logLines) {
    const text = line.trim();
    if (!text) continue;
    if (out.some((w) => overlaps(w.message, text))) continue;
    out.push({ kind: "remote_incomplete", message: text });
  }
  return out;
}
