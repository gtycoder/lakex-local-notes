import { createHash } from "node:crypto";
import type { SyncProgress, SyncResult } from "../syncTypes.js";
import type { Store } from "../store.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine, S3v3SyncError, classifyS3v3Error } from "./syncEngine.js";
import type { S3v3Remote } from "./ports.js";
import { getQuickNotesStoreForV3 } from "./quickNotesRegistry.js";

/**
 * 桌面 v3 同步入口（feature flag: LAKE_SYNC_PROTOCOL=v3）。
 * 真实数据 = Store；云端 = S3；协议 = v3。小记暂不在 v3 内同步（由原 quick-notes 通道继续）。
 */
/** v3 深度清理：文档 + 小记统一按当前 pointer/index/声明算 keep 集。 */
export async function runV3DeepCleanup(store: Store, opts: { dryRun?: boolean } = {}): Promise<{ deleted: string[]; kept: number }> {
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  const remote = new S3v3S3Remote({
    endpoint: settings.endpoint, region: settings.region, bucket: settings.bucket,
    accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey,
    prefix: settings.prefix, forcePathStyle: settings.forcePathStyle,
  });
  const quickNotes = getQuickNotesStoreForV3();
  const device = new DesktopStoreDevice(store, store.rootPath, { skipQuickNotesGuard: true, ...(quickNotes ? { quickNotes } : {}) });
  await device.init();
  const engine = new S3v3SyncEngine({ remote, device, deviceId: "desktop-cleanup" });
  return engine.deepCleanup(opts);
}

export async function syncWithV3(
  store: Store,
  onProgress?: (p: SyncProgress) => void,
  deps: { remote?: S3v3Remote; deviceId?: string } = {},
): Promise<SyncResult> {
  const startedAt = Date.now();
  const report = (p: SyncProgress) => { try { onProgress?.(p); } catch { /* window closed */ } };
  const settings = store.getS3Settings();
  if (!settings && !deps.remote) throw new Error("请先保存 S3 配置");
  const remote = deps.remote ?? new S3v3S3Remote({
    endpoint: settings!.endpoint, region: settings!.region, bucket: settings!.bucket,
    accessKeyId: settings!.accessKeyId, secretAccessKey: settings!.secretAccessKey,
    prefix: settings!.prefix, forcePathStyle: settings!.forcePathStyle,
  });
  // 转正默认：v3 文档通道下小记也默认走 v3（旧 quick-notes 通道只在 legacy 或显式 0 时使用）。
  const quickV3 = process.env.LAKE_SYNC_PROTOCOL !== "legacy" && process.env.LAKE_S3V3_QUICK_NOTES !== "0";
  const quickNotes = quickV3 ? getQuickNotesStoreForV3() : null;
  const device = new DesktopStoreDevice(store, store.rootPath, { skipQuickNotesGuard: true, ...(quickNotes ? { quickNotes } : {}) });
  await device.init();
  const deviceId = deps.deviceId ?? process.env.LAKE_S3V3_DEVICE_ID ?? "desktop-" + createHash("sha256").update(store.rootPath).digest("hex").slice(0, 8);
  report({ phase: "connect", message: "v3：连接 S3..." });
  // 进度阶段（对齐旧协议 G1/G2）：引擎阶段 → SyncProgress。首拉/大库时 UI 不再只有 connect→done。
  const PHASE_PROGRESS: Record<string, { phase: SyncProgress["phase"]; message: string }> = {
    "load-state": { phase: "download", message: "v3：读取本地状态..." },
    "read-index": { phase: "download", message: "v3：读取云端索引..." },
    merge: { phase: "download", message: "v3：合并远端变更..." },
    downloads: { phase: "download", message: "v3：下载正文/附件..." },
    uploads: { phase: "upload", message: "v3：上传变更..." },
    "publish-save-state": { phase: "manifest", message: "v3：保存发布状态..." },
    "publish-lock": { phase: "manifest", message: "v3：获取发布锁..." },
    "publish-index": { phase: "manifest", message: "v3：写入云端索引..." },
    "publish-pointer": { phase: "manifest", message: "v3：发布指针..." },
    "publish-finalize": { phase: "manifest", message: "v3：确认发布..." },
    pending: { phase: "manifest", message: "v3：清理待删对象..." },
  };
  const engine = new S3v3SyncEngine({
    remote, device, deviceId,
    onPhase: (phase, ms) => {
      if (ms >= 1000) store.logScopes.sync.warn(`[v3][slow] ${phase} ${ms}ms`);
      else store.logScopes.sync.debug(`[v3] ${phase} ${ms}ms`);
      const mapped = PHASE_PROGRESS[phase];
      if (mapped) report({ phase: mapped.phase, message: mapped.message });
    },
  });
  // 转正后默认把「云端无 v3 pointer」视为首次上传：本地就是真相（旧 manifest 不迁移，符合无历史兼容）。
  const emptyMode = (process.env.LAKE_S3V3_EMPTY_CLOUD ?? "upload") as "upload" | "stay" | "throw";
  try {
    const r = await engine.sync(emptyMode === "throw" ? {} : { onEmptyCloud: emptyMode });
    for (const w of r.warnings) store.logScopes.sync.warn("[v3] " + w);
    const result: SyncResult = {
      uploaded: r.uploadedNotes, downloaded: r.downloadedNotes, conflicts: r.supersededNotes.length,
      manifestId: "v3-g" + r.generation, completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt, supersededNotes: r.supersededNotes,
      // 旧协议有的结构化警告（UI SyncStatusPopover 读取 warnings；只增不减）。
      ...(r.warningDetails.length > 0 ? { warnings: r.warningDetails } : {}),
    };
    store.logScopes.sync.info("[v3] sync done " + JSON.stringify({ published: r.published, gen: r.generation, warnings: r.warnings.length, ms: result.durationMs }));
    return result;
  } catch (e) {
    const code = e instanceof S3v3SyncError ? e.code : (e as { code?: string } | null)?.code;
    store.logScopes.sync.warn(`[v3][error] class=${classifyS3v3Error(e)} code=${code ?? "unknown"} msg=${(e as Error).message}`);
    if (e instanceof S3v3SyncError && e.code === "empty-cloud") throw new Error("云端为空：请确认是否首次上传（设置 LAKE_S3V3_EMPTY_CLOUD=upload 以初始化）");
    throw e;
  }
}
