import { clipboard } from "electron";
import {
  buildSafeModeDiagnostics,
  exitSafeModeState,
  type SafeModeSnapshot,
  type SafeModeState,
} from "../safeMode.js";
import { readCrashMarker, removeCrashMarker } from "../startupRecovery.js";
import type { IpcRegistrar } from "./registrar.js";

/**
 * 安全模式 IPC（Batch3-B）：提示条要的三件事——读状态、复制诊断、显式退出。
 *
 * 语义（与 electron/safeMode.ts 头注释一致）：
 * - 读状态只回快照，**不改**任何文件；
 * - 「退出安全模式」= 写 active:false + 删 crash-marker（用户确认这次能正常跑）⇒ 下次启动正常；
 * - 「复制诊断」= 主进程直接写系统剪贴板（渲染层不接触日志文件路径以外的敏感信息）。
 */
export interface SafeModeIpcOptions {
  userDataDir: string;
  logPath: string;
  appVersion: string;
  platform: string;
  /** 本次进程的安全模式状态（null = 未进入）。 */
  state: () => SafeModeState | null;
  /** 用户显式退出时同步清掉进程内状态（提示条随之消失）。 */
  onExit: () => void;
}

export function registerSafeModeIpc(ipc: IpcRegistrar, options: SafeModeIpcOptions): void {
  ipc.handle("get_safe_mode_state", (): SafeModeSnapshot => {
    const state = options.state();
    return {
      active: state?.active === true,
      ...(typeof state?.since === "string" ? { since: state.since } : {}),
      ...(typeof state?.reason === "string" ? { reason: state.reason } : {}),
      ...(typeof state?.crashTime === "string" ? { crashTime: state.crashTime } : {}),
      ...(typeof state?.occurrences === "number" ? { occurrences: state.occurrences } : {}),
      logPath: options.logPath,
      dataDir: options.userDataDir,
    };
  });

  ipc.handle("exit_safe_mode", () => {
    const result = exitSafeModeState(options.userDataDir);
    if (!result.ok) {
      // P2-C：失败**保留**进程内状态与 crash-marker（不 onExit）⇒ 提示条继续显示，
      // UI 据 ok:false 明说「未生效，请重启再试」，不会出现"界面以为退了、下次启动仍在安全模式"。
      return { ok: false as const, reason: result.reason ?? "退出安全模式失败", state: result.state };
    }
    // 成功才清崩溃标记：显式退出 = 明确「这次能正常跑」⇒ 下次启动不再提示/不再进入安全模式。
    // 删标记是尽力而为（失败也无害：标记还在 ⇒ 下次启动按连崩判据重新评估，属 fail-safe）。
    removeCrashMarker(options.userDataDir);
    options.onExit();
    return { ok: true as const, state: result.state };
  });

  ipc.handle("copy_safe_mode_diagnostics", () => {
    const state = options.state() ?? { active: false };
    const text = buildSafeModeDiagnostics({
      state,
      crashMarker: readCrashMarker(options.userDataDir),
      appVersion: options.appVersion,
      platform: options.platform,
      dataDir: options.userDataDir,
      logPath: options.logPath,
    });
    try {
      clipboard.writeText(text);
      return { ok: true as const, text };
    } catch {
      return { ok: false as const, text };
    }
  });
}
