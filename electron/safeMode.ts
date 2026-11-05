/**
 * 安全模式（Batch3-B，261105）：上次运行捕获到**连续/反复**的未捕获异常时，本次启动以最小风险集合运行，
 * 让用户还能看到界面、把数据导出/备份出去，而不是在崩溃循环里反复起不来。
 *
 * 做什么（最小集，参考思源）：
 * - **不自动同步**（跳过开/关应用自动同步、定时同步、未完成同步续传；手动 syncNow 仍可用）；
 * - **不恢复上次标签页**（渲染层按本模块状态跳过；会话本身保留，下次正常启动仍可恢复）；
 * - **不预热内核 chunk**（渲染层跳过 kernelPrefetch）。
 *
 * 不做什么：不改同步语义、不降级数据、不隐藏文档（主界面可用、能看能编辑）。
 *
 * 标记生命周期（与 startupRecovery 的 crash-marker.json 配合）：
 * - 进入安全模式时**不清** crash-marker（诊断线索保留）；
 * - 显式「退出安全模式」= 写 active:false + 删 crash-marker（下次启动正常）；
 * - 正常启动（未进入安全模式）时消费 crash-marker（沿用旧语义）并清掉遗留状态文件。
 *
 * 本文件只放**主进程可单测的纯逻辑 + 文件读写**（不 import electron），便于单测。
 */
import fs from "node:fs";
import path from "node:path";
import type { CrashMarker } from "./startupRecovery.js";

/** 状态文件名（userData 下；不进 git、不参与同步）。 */
export const SAFE_MODE_FILE = "safe-mode.json";

/** 「连续 2 次崩溃」的时间窗：30 分钟（用户口径）。 */
export const CRASH_REPEAT_WINDOW_MS = 30 * 60 * 1000;

/** 次数阈值：crash-marker.occurrences 达到它即进入安全模式。 */
export const CRASH_REPEAT_THRESHOLD = 2;

/** 持久化的安全模式状态（设备本地；**不**进 S3/同步）。 */
export interface SafeModeState {
  /** true = 本次（以及直到用户显式退出前的每次）启动都是安全模式。 */
  active: boolean;
  /** 最近一次进入安全模式的时间（ISO）。 */
  since?: string;
  /** 用户显式退出安全模式的时间（ISO）。 */
  exitedAt?: string;
  /** 进入原因（人类可读，供提示条/诊断）。 */
  reason?: string;
  /** 触发时的 crash-marker 摘要（提示条展示「累计 N 次」）。 */
  crashTime?: string;
  occurrences?: number;
}

export function safeModePath(userDataDir: string): string {
  return path.join(userDataDir, SAFE_MODE_FILE);
}

/** 读状态：损坏/不存在一律 null（启动路径绝不能因状态文件再失败一次）。 */
export function readSafeModeState(userDataDir: string): SafeModeState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(safeModePath(userDataDir), "utf8")) as Partial<SafeModeState>;
    if (typeof parsed?.active !== "boolean") return null;
    return {
      active: parsed.active,
      ...(typeof parsed.since === "string" ? { since: parsed.since } : {}),
      ...(typeof parsed.exitedAt === "string" ? { exitedAt: parsed.exitedAt } : {}),
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
      ...(typeof parsed.crashTime === "string" ? { crashTime: parsed.crashTime } : {}),
      ...(typeof parsed.occurrences === "number" && Number.isFinite(parsed.occurrences) ? { occurrences: parsed.occurrences } : {}),
    };
  } catch {
    return null;
  }
}

/** 写状态（自身绝不抛错：启动路径不能因为写不下状态文件而失败）。 */
export function writeSafeModeState(userDataDir: string, state: SafeModeState): boolean {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(safeModePath(userDataDir), JSON.stringify(state, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** 删状态文件（正常启动时清掉遗留状态，别让下一次启动误读）。 */
export function removeSafeModeState(userDataDir: string): void {
  try { fs.rmSync(safeModePath(userDataDir), { force: true }); } catch { /* 尽力删除 */ }
}

/** 用户显式退出安全模式：写 active:false + exitedAt（下次启动正常）。 */
export function exitSafeModeState(userDataDir: string, now: Date = new Date()): SafeModeState {
  const next: SafeModeState = { active: false, exitedAt: now.toISOString() };
  writeSafeModeState(userDataDir, next);
  return next;
}

/** 标记里最近几次崩溃时间（兼容旧标记：没有 recentTimes 时只有 time 一条）。 */
export function crashTimesOf(marker: CrashMarker | null): string[] {
  if (!marker) return [];
  const listed = Array.isArray(marker.recentTimes) ? marker.recentTimes : [];
  const times = [...listed, marker.time].filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return [...new Set(times)].sort();
}

/**
 * 「崩溃反复出现」判据（纯函数）：
 * - occurrences >= 2：上次成功启动以来已经崩过 2 次（主判据）；
 * - 或 **30 分钟内**出现 2 次崩溃（兜底：旧标记/跨多次成功启动的连发）。
 * 返回进入原因；不满足返回 null。
 */
export function repeatedCrashReason(
  marker: CrashMarker | null,
  now: Date = new Date(),
  windowMs: number = CRASH_REPEAT_WINDOW_MS,
): string | null {
  if (!marker) return null;
  if (marker.occurrences >= CRASH_REPEAT_THRESHOLD) {
    return "上次运行累计捕获 " + marker.occurrences + " 次未捕获异常";
  }
  const recent = crashTimesOf(marker).filter((time) => now.getTime() - Date.parse(time) <= windowMs);
  if (recent.length >= CRASH_REPEAT_THRESHOLD) {
    return "30 分钟内连续捕获 " + recent.length + " 次未捕获异常";
  }
  return null;
}

export interface SafeModeDecisionInput {
  /** 上次留下的安全模式状态（用户显式退出后 active=false）。 */
  previous?: SafeModeState | null;
  /** 上次运行的崩溃标记（startupRecovery.readCrashMarker）。 */
  crashMarker?: CrashMarker | null;
  now?: Date;
  windowMs?: number;
}

export interface SafeModeDecision {
  /** 本次启动是否进入安全模式。 */
  active: boolean;
  reason: string;
  /** 要落盘的状态（active=false 时也应写回，覆盖旧的 active 记录）。 */
  state: SafeModeState;
}

/**
 * 启动安全模式判定（纯函数）：
 * - 上次已进入安全模式且用户没显式退出 ⇒ 继续安全模式（崩溃可能发生在用户还没看到界面前）；
 * - 否则看崩溃标记：反复崩溃 ⇒ 进入；只有一次 ⇒ 正常；
 * - 正常启动 ⇒ 清掉遗留状态（state.active=false），不写 since。
 */
export function decideSafeMode(input: SafeModeDecisionInput = {}): SafeModeDecision {
  const now = input.now ?? new Date();
  const previous = input.previous ?? null;
  const marker = input.crashMarker ?? null;
  if (previous?.active) {
    return {
      active: true,
      reason: previous.reason ?? "上次进入安全模式后尚未退出",
      state: {
        ...previous,
        active: true,
        since: previous.since ?? now.toISOString(),
        reason: previous.reason ?? "上次进入安全模式后尚未退出",
      },
    };
  }
  const reason = repeatedCrashReason(marker, now, input.windowMs);
  if (marker && reason) {
    return {
      active: true,
      reason,
      state: {
        active: true,
        since: now.toISOString(),
        reason,
        crashTime: marker.time,
        occurrences: marker.occurrences,
      },
    };
  }
  return { active: false, reason: "", state: { active: false } };
}

/** 渲染层/提示条用的运行时快照（IPC get_safe_mode_state 返回）。 */
export interface SafeModeSnapshot {
  active: boolean;
  since?: string;
  reason?: string;
  crashTime?: string;
  occurrences?: number;
  logPath: string;
  dataDir: string;
}

/** 诊断文本（「复制诊断」按钮）：崩溃现场 + 环境 + 日志路径，直接贴进 issue。 */
export function buildSafeModeDiagnostics(input: {
  state: SafeModeState;
  crashMarker: CrashMarker | null;
  appVersion: string;
  platform: string;
  dataDir: string;
  logPath: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const lines = [
    "LakexLocalNotes 安全模式诊断",
    "生成时间：" + now.toISOString(),
    "版本：" + input.appVersion,
    "平台：" + input.platform,
    "数据目录：" + input.dataDir,
    "日志：" + input.logPath,
    "进入原因：" + (input.state.reason ?? "（未记录）"),
    "进入时间：" + (input.state.since ?? "（未记录）"),
  ];
  const marker = input.crashMarker;
  if (marker) {
    lines.push("上次崩溃：" + marker.time + " · 累计 " + marker.occurrences + " 次");
    lines.push("崩溃原因：" + marker.reason);
    const times = crashTimesOf(marker);
    if (times.length > 0) lines.push("最近崩溃时间：" + times.join(", "));
    if (marker.stack) lines.push("堆栈：", marker.stack);
  } else {
    lines.push("上次崩溃：无（标记已被消费或从未崩溃）");
  }
  return lines.join("\n");
}
