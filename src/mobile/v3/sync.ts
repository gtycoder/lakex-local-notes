import { S3v3SyncEngine, type S3v3SyncReport } from "../../core/s3v3Engine.js";
import type { S3v3Remote, S3v3Settings } from "../../core/s3v3Ports.js";
import type { MobileDb } from "../data/sqliteDb.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { createMobileS3v3Remote } from "./s3v3Remote.js";

/**
 * 移动端 v3 同步编排（feature flag 下由 bridge.syncNow 调用）。
 * 注意：v1 只同步 Lake 文档（无附件/小记/目录写入）；真实库若含这些数据不得切 v3。
 */

const DEVICE_ID_KEY = "local-lakex-notes-mobile.v3.deviceId";
const EMPTY_CLOUD_KEY = "local-lakex-notes-mobile.v3.emptyCloud";

export function isMobileV3Enabled(): boolean {
  // 转正默认：未显式设置 legacy 即走 v3；`syncProtocol=legacy` 为回滚开关。
  try { return localStorage.getItem("local-lakex-notes-mobile.syncProtocol") !== "legacy"; } catch { return true; }
}

function mobileDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = "mobile-" + globalThis.crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch { return "mobile-unknown"; }
}

export interface MobileV3SyncOptions {
  /** 测试/CLI 注入；缺省用 Capacitor S3 client。 */
  remote?: S3v3Remote;
  deviceId?: string;
  /** 云端为空时的决策；缺省读 localStorage 开关，否则 throw。 */
  emptyCloud?: "upload" | "stay" | "throw";
}

export async function runMobileV3Sync(db: MobileDb, settings: S3v3Settings, opts: MobileV3SyncOptions = {}): Promise<S3v3SyncReport> {
  const store = new MobileDeviceStore(db);
  await store.init();
  const remote = opts.remote ?? createMobileS3v3Remote(settings);
  const engine = new S3v3SyncEngine({
    remote, device: store, deviceId: opts.deviceId ?? mobileDeviceId(),
    onPhase: (phase, ms) => { if (ms >= 2000) console.warn(`[v3][slow] ${phase} ${ms}ms`); },
  });
  let mode: "upload" | "stay" | "throw" = opts.emptyCloud ?? "upload";
  if (!opts.emptyCloud) {
    try {
      const override = localStorage.getItem(EMPTY_CLOUD_KEY);
      if (override === "upload" || override === "stay" || override === "throw") mode = override;
    } catch { /* ignore */ }
  }
  return engine.sync(mode === "throw" ? {} : { onEmptyCloud: mode });
}
