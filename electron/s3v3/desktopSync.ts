import { createHash } from "node:crypto";
import type { SyncProgress, SyncResult } from "../syncTypes.js";
import type { Store } from "../store.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine, S3v3SyncError, classifyS3v3Error } from "./syncEngine.js";
import type { S3v3Remote } from "./ports.js";

/**
 * 桌面 v3 同步入口（feature flag: LAKE_SYNC_PROTOCOL=v3）。
 * 真实数据 = Store；云端 = S3；协议 = v3。小记暂不在 v3 内同步（由原 quick-notes 通道继续）。
 */
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
  const device = new DesktopStoreDevice(store, store.rootPath, { skipQuickNotesGuard: true });
  await device.init();
  const deviceId = deps.deviceId ?? process.env.LAKE_S3V3_DEVICE_ID ?? "desktop-" + createHash("sha256").update(store.rootPath).digest("hex").slice(0, 8);
  report({ phase: "connect", message: "v3：连接 S3..." });
  const engine = new S3v3SyncEngine({
    remote, device, deviceId,
    onPhase: (phase, ms) => {
      if (ms >= 1000) store.logScopes.sync.warn(`[v3][slow] ${phase} ${ms}ms`);
      else store.logScopes.sync.debug(`[v3] ${phase} ${ms}ms`);
    },
  });
  const emptyMode = (process.env.LAKE_S3V3_EMPTY_CLOUD ?? "throw") as "upload" | "stay" | "throw";
  try {
    const r = await engine.sync(emptyMode === "throw" ? {} : { onEmptyCloud: emptyMode });
    for (const w of r.warnings) store.logScopes.sync.warn("[v3] " + w);
    const result: SyncResult = {
      uploaded: r.uploadedNotes, downloaded: r.downloadedNotes, conflicts: 0,
      manifestId: "v3-g" + r.generation, completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt, supersededNotes: [],
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
