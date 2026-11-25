/**
 * 启动判定（C-04 从 main.ts C+D+G 原样搬出）：崩溃标记读取、安全模式判定、中断的工作区换位回滚、
 * 条件深检 + 完整性预检 + Store 打开 + 恢复决策、S3 恢复 seed/dev seed 回填。
 * 边界：只做「读信号 → 判定 → 开库」；恢复页动作 = boot/recoveryWiring；小记库 = boot/quickNotesWiring。
 * 时序（C-04 不可动②④）：本文件读 workspaceRoot()/userData ⇒ assertUserDataPathApplied；
 * 开库/后续 hash ⇒ assertNativeSha256Installed。
 * 契约：P1-5「先预检再建 Store」（坏库不进普通启动）；Batch3-B 安全模式语义见 electron/safeMode.ts；
 * P2-B 条件深检（启动标 dirty、正常退出才写 clean）见 electron/startupRecovery.ts。
 */
import path from "node:path";
import { Store } from "../store.js";
import { createLocalSecretCipher } from "../secretCipher.js";
import { readAndRemoveS3RestoreSeed, recoverInterruptedWorkspaceSwap } from "../workspaceBackup.js";
import {
  decideStartupCheckDepth,
  decideStartupRecovery,
  inspectDatabaseForStartup,
  markStartupInProgress,
  readCrashMarker,
  readStartupRunHealth,
} from "../startupRecovery.js";
import { decideSafeMode, readSafeModeState, writeSafeModeState } from "../safeMode.js";
import { readDevS3Settings } from "../devConfig.js";
import { log } from "../logger.js";
import { errorFields, formatLogFields } from "../../src/core/logFormat.js";
import { isDev } from "./paths.js";
import { assertNativeSha256Installed, assertUserDataPathApplied } from "./startupOrder.js";

export interface StartupSignals {
  crashMarker: ReturnType<typeof readCrashMarker>;
  safeModeDecision: ReturnType<typeof decideSafeMode>;
}

/** C：崩溃标记 + 安全模式判定（先于任何启动动作）+ 中断的工作区换位回滚（幂等）。 */
export function readStartupSignals(userDataDir: string): StartupSignals {
  assertUserDataPathApplied("readStartupSignals");
  // P1-5：**先做完整性预检，再建 Store**。坏库/打不开时不再继续普通启动
  //（旧实现先构造 Store 再弹阻塞式 dialog，Store 构造抛错时会直接卡死在 boot splash）。
  const crashMarker = readCrashMarker(userDataDir);
  if (crashMarker) {
    log.app.warn("[crash] 上次运行捕获到未捕获异常" + formatLogFields({ time: crashMarker.time, occurrences: crashMarker.occurrences, reason: crashMarker.reason }));
  }
  // Batch3-B：崩溃反复出现（occurrences>=2 或 30 分钟内连续 2 次）⇒ 本次进安全模式：
  // 不自动同步 / 不恢复上次标签页 / 不预热内核；主界面照常可用可编辑（语义见 electron/safeMode.ts）。
  const safeModeDecision = decideSafeMode({ previous: readSafeModeState(userDataDir), crashMarker, now: new Date() });
  if (safeModeDecision.active) {
    writeSafeModeState(userDataDir, safeModeDecision.state);
    log.app.warn("[safe-mode] 本次启动进入安全模式（不自动同步/不恢复标签页/不预热内核）"
      + formatLogFields({ reason: safeModeDecision.reason, occurrences: crashMarker?.occurrences ?? 0 }));
  }
  return { crashMarker, safeModeDecision };
}

/** 261201（P2-A）：中断的工作区换位（便携包导入/整库恢复在 materialize 中途崩溃）先回滚到换位前，
 * 再做启动预检（对齐移动侧「中断自动回滚」契约 §3 第 2 条；幂等，无标记零开销）。 */
export function rollbackInterruptedWorkspaceSwap(workspaceRoot: string): void {
  const swapRecovery = recoverInterruptedWorkspaceSwap(workspaceRoot);
  if (swapRecovery.recovered) {
    log.app.warn("[workspace] 检测到中断的工作区换位，已恢复" + formatLogFields({ restored: swapRecovery.restored }));
  }
}

export interface StartupProbeResult {
  startupDecision: ReturnType<typeof decideStartupRecovery>;
  openedStore: Store | null;
  startupOpenError: unknown;
}

/** D：条件深检（只读打开）+ 完整性预检 + Store 构造 + 恢复决策（P1-5 顺序原样）。 */
export function openStoreWithStartupProbe(deps: {
  userDataDir: string;
  workspaceRoot: () => string;
  crashMarker: ReturnType<typeof readCrashMarker>;
}): StartupProbeResult {
  assertUserDataPathApplied("openStoreWithStartupProbe");
  assertNativeSha256Installed("openStoreWithStartupProbe");
  // 261105 P2-B：条件深检（只读打开）。上次正常退出且无 crash-marker ⇒ 轻量检查（只读打开 + 关键表）；
  // 上次脏退出/有崩溃标记 ⇒ 才跑全库 quick_check + foreign_key_check。
  // 启动开始即标 dirty：进程在本次启动/运行中崩溃 ⇒ 下次自动深检；正常退出才写「上次 OK」。
  const previousRun = readStartupRunHealth(deps.userDataDir);
  markStartupInProgress(deps.userDataDir);
  const startupCheckDepth = decideStartupCheckDepth({ crashMarker: deps.crashMarker, previousRun });
  log.app.info("[store] 启动预检深度=" + startupCheckDepth + formatLogFields({ previousRun: previousRun?.lastRun ?? "unknown", crashMarker: !!deps.crashMarker }));
  const startupIntegrity = inspectDatabaseForStartup(path.join(deps.workspaceRoot(), "metadata.sqlite3"), { deep: startupCheckDepth === "deep" });
  let startupOpenError: unknown = null;
  let openedStore: Store | null = null;
  if (startupIntegrity.ok) {
    try {
      openedStore = new Store(deps.workspaceRoot(), createLocalSecretCipher(deps.userDataDir), log);
    } catch (error) {
      startupOpenError = error;
      log.app.error("[store] 打开本地数据库失败" + formatLogFields(errorFields(error)));
    }
  } else {
    log.app.error("[store] 启动完整性预检未通过" + formatLogFields({ detail: startupIntegrity.detail }));
  }
  const startupDecision = decideStartupRecovery({ integrity: startupIntegrity, openError: startupOpenError, crashMarker: deps.crashMarker });
  return { startupDecision, openedStore, startupOpenError };
}

/** G：A2 云端恢复 seed 回填 + 开发版可选 S3 seed（原 main.ts 774-789，顺序原样）。 */
export function backfillS3Seed(deps: { workspaceRoot: () => string; store: Store }): void {
  // A2 云端恢复（换机/坏库）：重启后若存在恢复 seed（prepareCloudRestore 写入的 settings 密文行），
  // 原样写回新库再删除——secretAccessKey 保持密文形态（绝不明文落盘）；非 enc:v2: 前缀存量（含旧钥匙串 enc:v1:）按未配置读出（261204），用户重填即转 v2。
  try {
    const seed = readAndRemoveS3RestoreSeed(deps.workspaceRoot());
    if (seed && typeof seed === "string" && !deps.store.getS3Settings()) {
      deps.store.importS3SettingsRow(seed);
      log.app.info("[restore] S3 凭据（密文行）已从恢复 seed 回填新库");
    }
  } catch (e) { log.app.warn(`[restore] S3 seed 回填失败: ${(e as Error).message}`); }
  // 开发版可选 S3 seed（多端联调用）：凭据只从环境变量读取；
  // 没有配置时保持纯本地模式，不把共享密钥打进源码或新开发数据。
  if (isDev && !deps.store.getS3Settings()) {
    const devS3Settings = readDevS3Settings();
    if (devS3Settings) deps.store.saveS3Settings(devS3Settings);
    else log.app.info("dev S3 seed skipped: credentials are not configured");
  }
}
