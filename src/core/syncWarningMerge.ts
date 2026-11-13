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
import type { PlanWarning } from "./s3v3/plan/types.js";
import type { SyncWarning, SyncWarningKind } from "./sharedTypes.js";

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

/** 结构化项去重键（261113 F-11）：kind + 归属；同键只留第一条（引擎/plan 可能重复产出）。 */
function dedupeKey(w: SyncWarning): string {
  return [w.kind, w.noteId ?? "", w.filename ?? "", w.title ?? ""].join("\u0000");
}

/**
 * 单篇 apply 失败的**唯一映射**（261112 task-104 F-07）：`PlanWarning` → `SyncWarning`。
 * core 现在直接产出 `apply_skipped`；这里只做字段搬运，不再把 kind 改写成 remote_incomplete
 * （两端消费方都直接用本函数的结果，禁止二次映射）。
 */
export function syncWarningOfApplyFailure(warning: PlanWarning): SyncWarning {
  const kind: SyncWarningKind = warning.code === "apply_skipped" ? "apply_skipped"
    : warning.code === "conflict_kept_history" ? "conflict_kept_history"
      : "remote_incomplete";
  return {
    kind,
    ...(warning.id ? { noteId: warning.id } : {}),
    ...(warning.title ? { title: warning.title } : {}),
    ...(warning.filename ? { filename: warning.filename } : {}),
    message: warning.detail ?? "",
  };
}

export function mergeSyncWarnings(input: MergeSyncWarningsInput): SyncWarning[] {
  const out: SyncWarning[] = [];
  const seen = new Set<string>();
  for (const warning of [...input.structured, ...(input.extra ?? [])]) {
    const key = dedupeKey(warning);
    if (seen.has(key)) continue; // F-11：同键只留一条，避免浮层里数两遍
    seen.add(key);
    out.push(warning);
  }
  for (const line of input.logLines) {
    const text = line.trim();
    if (!text) continue;
    if (out.some((w) => overlaps(w.message, text))) continue;
    // F-11：部分 PlanWarning 只有 id/kind（message 为空）⇒ 文本包含判重失效，会变成
    // 「一条结构化 + 一条一行式日志」两项。这里按归属（noteId/title/filename）再判一次。
    if (out.some((w) => (!!w.noteId && text.includes(w.noteId))
      || (!!w.title && text.includes(w.title))
      || (!!w.filename && text.includes(w.filename)))) continue;
    out.push({ kind: "remote_incomplete", message: text });
  }
  return out;
}
