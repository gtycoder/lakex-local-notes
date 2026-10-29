/**
 * v3 同步诊断报告（SD-13）：把一轮同步的「阶段耗时 / 对象数 / 字节 / 失败对象 / warnings」
 * 固化成**可落盘、可一键复制**的纯数据；桌面与移动各存最近 3 轮（桌面 `device_state.sync_v3_reports`，
 * 移动 `device_state` 同键），设置页「同步诊断」直接复制这段文本去排障。
 *
 * 纯逻辑、无平台依赖：两端共用同一份结构/格式化，避免又写出两套口径。
 */

/** 环形保留轮数（用户 261028 定：最近 3 轮足够定位「刚才那次为什么慢/失败」）。 */
export const S3V3_DIAGNOSTIC_KEEP = 3;
/** 单轮最多保留的阶段数（防异常路径把数组撑大）。 */
export const S3V3_DIAGNOSTIC_PHASE_KEEP = 24;
/** 单轮最多保留的失败对象数（诊断要短到能贴进聊天窗口）。 */
export const S3V3_DIAGNOSTIC_FAILED_KEEP = 20;

export interface S3v3DiagnosticPhase {
  phase: string;
  /** 该阶段耗时（ms，距上一阶段）。 */
  ms: number;
  /** 阶段内已完成对象数（流水线/应用阶段才有）。 */
  objects?: number;
  totalObjects?: number;
  /** 阶段内已完成字节数（正文/附件阶段才有）。 */
  bytes?: number;
  totalBytes?: number;
}

export interface S3v3DiagnosticFailure {
  kind: string;
  message: string;
  id?: string;
  title?: string;
  filename?: string;
}

export interface S3v3DiagnosticReport {
  at: string;
  ok: boolean;
  durationMs: number;
  generation: number | null;
  published: boolean;
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  warningCount: number;
  /** 警告原文（最多 20 条；失败对象之外的「跳过/降级」也在这里，便于逐字贴给维护者）。 */
  warnings: string[];
  phases: S3v3DiagnosticPhase[];
  /** 失败/被跳过的对象（来自结构化 warning，只保留有 id/filename 的条目）。 */
  failed: S3v3DiagnosticFailure[];
  /** 失败轮的错误摘要（成功轮缺省）。 */
  error?: { code: string; errorClass: string; message: string };
}

export interface S3v3DiagnosticWarning {
  kind?: string;
  message: string;
  noteId?: string;
  title?: string;
  filename?: string;
}

export interface S3v3DiagnosticInput {
  at: string;
  ok: boolean;
  durationMs: number;
  generation?: number | null;
  published?: boolean;
  uploaded?: number;
  downloaded?: number;
  deleted?: number;
  conflicts?: number;
  warnings?: ReadonlyArray<S3v3DiagnosticWarning>;
  /** 仅解析回读时用：保留原始 warningCount 与警告原文。 */
  warningCount?: number;
  warningMessages?: readonly string[];
  phases?: ReadonlyArray<S3v3DiagnosticPhase>;
  error?: { code?: string; errorClass?: string; message: string };
}

export interface S3v3ProgressSnapshot {
  phase: string;
  done?: number;
  total?: number;
  bytesDone?: number;
  bytesTotal?: number;
}

interface PhaseAccumulator {
  phase: string;
  ms: number;
  hasProgress: boolean;
  /** 已结算批次（同一阶段可能被多条流水线复用，如 assets 分三批下载）。 */
  settledObjects: number;
  settledBytes: number;
  /** 当前批次（done 回退 = 新批次开始）。 */
  lastDone: number;
  lastTotal: number;
  lastBytes: number;
  lastTotalBytes: number;
}

export interface S3v3PhaseCollector {
  /** 记录阶段切换（引擎 onPhase 回调）。 */
  phase(name: string, ms: number): void;
  /** 记录进度回调（引擎 onProgress；同一阶段可能多批）。 */
  progress(p: S3v3ProgressSnapshot): void;
  snapshot(): S3v3DiagnosticPhase[];
}

/** 收集器：把「阶段切换 + 进度回调」整理成每阶段一行（含多批累加），供诊断落盘。 */
export function createS3v3PhaseCollector(maxPhases: number = S3V3_DIAGNOSTIC_PHASE_KEEP): S3v3PhaseCollector {
  const accs: PhaseAccumulator[] = [];
  const find = (phase: string): PhaseAccumulator => {
    let acc = accs.find((a) => a.phase === phase);
    if (!acc) {
      acc = { phase, ms: 0, hasProgress: false, settledObjects: 0, settledBytes: 0, lastDone: 0, lastTotal: 0, lastBytes: 0, lastTotalBytes: 0 };
      accs.push(acc);
    }
    return acc;
  };
  return {
    phase(name, ms) {
      const acc = find(name);
      acc.ms = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0;
    },
    progress(p) {
      const acc = find(p.phase);
      acc.hasProgress = true;
      if (typeof p.done === "number") {
        if (p.done < acc.lastDone) {
          // done 回退 ⇒ 上一批结束、新一批开始：按上一批的 total 结算，避免多批只记最后一批。
          acc.settledObjects += acc.lastTotal > 0 ? acc.lastTotal : acc.lastDone;
          acc.settledBytes += acc.lastTotalBytes > 0 ? acc.lastTotalBytes : acc.lastBytes;
          acc.lastDone = 0;
          acc.lastTotal = 0;
          acc.lastBytes = 0;
          acc.lastTotalBytes = 0;
        }
        acc.lastDone = Math.max(acc.lastDone, p.done);
      }
      if (typeof p.total === "number" && p.total >= 0) acc.lastTotal = Math.max(acc.lastTotal, p.total);
      if (typeof p.bytesDone === "number" && p.bytesDone >= 0) acc.lastBytes = Math.max(acc.lastBytes, p.bytesDone);
      if (typeof p.bytesTotal === "number" && p.bytesTotal >= 0) acc.lastTotalBytes = Math.max(acc.lastTotalBytes, p.bytesTotal);
    },
    snapshot() {
      const out: S3v3DiagnosticPhase[] = [];
      for (const acc of accs) {
        const item: S3v3DiagnosticPhase = { phase: acc.phase, ms: acc.ms };
        if (acc.hasProgress) {
          const objects = acc.settledObjects + acc.lastDone;
          const totalObjects = acc.settledObjects + (acc.lastTotal > 0 ? acc.lastTotal : acc.lastDone);
          if (totalObjects > 0) { item.objects = objects; item.totalObjects = totalObjects; }
          const bytes = acc.settledBytes + acc.lastBytes;
          const totalBytes = acc.settledBytes + (acc.lastTotalBytes > 0 ? acc.lastTotalBytes : acc.lastBytes);
          if (totalBytes > 0) { item.bytes = bytes; item.totalBytes = totalBytes; }
        }
        out.push(item);
      }
      return out.slice(-Math.max(1, maxPhases));
    },
  };
}

const num = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const sanitizePhase = (p: S3v3DiagnosticPhase): S3v3DiagnosticPhase => ({
  phase: String(p.phase),
  ms: num(p.ms),
  ...(typeof p.objects === "number" ? { objects: num(p.objects) } : {}),
  ...(typeof p.totalObjects === "number" ? { totalObjects: num(p.totalObjects) } : {}),
  ...(typeof p.bytes === "number" ? { bytes: num(p.bytes) } : {}),
  ...(typeof p.totalBytes === "number" ? { totalBytes: num(p.totalBytes) } : {}),
});

/** 一轮同步结束（成功/失败）都构造一份；纯函数，便于测试与两端共用。 */
export function buildS3v3DiagnosticReport(input: S3v3DiagnosticInput): S3v3DiagnosticReport {
  const warnings = input.warnings ?? [];
  const failed: S3v3DiagnosticFailure[] = [];
  for (const w of warnings) {
    if (failed.length >= S3V3_DIAGNOSTIC_FAILED_KEEP) break;
    if (!w.noteId && !w.filename) continue; // 没有对象指向的警告只计数，不占失败清单
    failed.push({
      kind: w.kind ?? "remote_incomplete",
      message: w.message,
      ...(w.noteId ? { id: w.noteId } : {}),
      ...(w.title ? { title: w.title } : {}),
      ...(w.filename ? { filename: w.filename } : {}),
    });
  }
  return {
    at: input.at,
    ok: input.ok,
    durationMs: num(input.durationMs),
    generation: typeof input.generation === "number" ? input.generation : null,
    published: input.published === true,
    uploaded: num(input.uploaded),
    downloaded: num(input.downloaded),
    deleted: num(input.deleted),
    conflicts: num(input.conflicts),
    warningCount: typeof input.warningCount === "number" ? num(input.warningCount) : warnings.length,
    warnings: [...(input.warningMessages ?? warnings.map((w) => w.message))].slice(0, S3V3_DIAGNOSTIC_FAILED_KEEP),
    phases: (input.phases ?? []).map(sanitizePhase).slice(-S3V3_DIAGNOSTIC_PHASE_KEEP),
    failed,
    ...(input.error ? {
      error: {
        code: input.error.code ?? "unknown",
        errorClass: input.error.errorClass ?? "retryable",
        message: input.error.message,
      },
    } : {}),
  };
}

/** 环形保留最近 keep 轮（默认 3）：写入方只需 push，不关心淘汰。 */
export function pushS3v3DiagnosticReport(
  list: readonly S3v3DiagnosticReport[],
  report: S3v3DiagnosticReport,
  keep: number = S3V3_DIAGNOSTIC_KEEP,
): S3v3DiagnosticReport[] {
  const limit = Math.max(1, Math.floor(keep));
  const next = [...list, report];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** 从 device_state/存储里读回的 JSON 复原（坏数据一律丢弃，不抛错）。 */
export function parseS3v3DiagnosticReports(raw: unknown): S3v3DiagnosticReport[] {
  if (!Array.isArray(raw)) return [];
  const out: S3v3DiagnosticReport[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Partial<S3v3DiagnosticReport>;
    if (typeof r.at !== "string" || typeof r.ok !== "boolean") continue;
    out.push(buildS3v3DiagnosticReport({
      at: r.at,
      ok: r.ok,
      durationMs: typeof r.durationMs === "number" ? r.durationMs : 0,
      generation: typeof r.generation === "number" ? r.generation : null,
      published: r.published === true,
      uploaded: r.uploaded,
      downloaded: r.downloaded,
      deleted: r.deleted,
      conflicts: r.conflicts,
      warnings: Array.isArray(r.failed) ? r.failed.map((f) => ({ kind: f.kind, message: f.message, noteId: f.id, title: f.title, filename: f.filename })) : [],
      warningCount: typeof r.warningCount === "number" ? r.warningCount : undefined,
      warningMessages: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string") : undefined,
      phases: Array.isArray(r.phases) ? r.phases : [],
      ...(r.error ? { error: r.error } : {}),
    }));
  }
  return out.slice(-S3V3_DIAGNOSTIC_KEEP);
}

function formatMs(ms: number): string {
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) + "s";
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KiB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MiB";
}

/** 一键复制的纯文本（设置页「同步诊断」）；空列表返回空串（UI 据此提示「还没有记录」）。 */
export function formatS3v3Diagnostics(reports: readonly S3v3DiagnosticReport[]): string {
  if (reports.length === 0) return "";
  const lines: string[] = ["Lakex 同步诊断（最近 " + reports.length + " 轮，本机记录）"];
  reports.forEach((r, index) => {
    const head = [
      "#" + (index + 1),
      r.at,
      r.ok ? "成功" : "失败",
      formatMs(r.durationMs),
      "gen " + (r.generation === null ? "-" : String(r.generation)),
      "发布 " + (r.published ? "是" : "否"),
      "↑" + r.uploaded + " ↓" + r.downloaded,
      "删除 " + r.deleted,
      "冲突 " + r.conflicts,
      "警告 " + r.warningCount,
    ].join("，");
    lines.push(head);
    if (r.phases.length > 0) {
      lines.push("  阶段：" + r.phases.map((p) => {
        const counts = p.totalObjects !== undefined ? " [" + (p.objects ?? 0) + "/" + p.totalObjects + (p.totalBytes !== undefined ? "，" + formatBytesShort(p.bytes ?? 0) + "/" + formatBytesShort(p.totalBytes) : "") + "]" : "";
        return p.phase + " " + formatMs(p.ms) + counts;
      }).join("；"));
    }
    if (r.failed.length > 0) {
      lines.push("  失败对象：" + r.failed.map((f) => (f.id ?? f.filename ?? "?") + " [" + f.kind + "] " + f.message).join("；"));
    }
    if (r.warnings.length > 0) {
      const shown = r.warnings.slice(0, 8);
      const more = r.warnings.length - shown.length;
      lines.push("  警告：" + shown.join("；") + (more > 0 ? "；…另 " + more + " 条" : ""));
    }
    if (r.error) lines.push("  错误：" + r.error.errorClass + "（" + r.error.code + "）：" + r.error.message);
  });
  return lines.join("\n");
}
