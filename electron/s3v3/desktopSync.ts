import { createHash } from "node:crypto";
import type { SyncProgress, SyncResult } from "../syncTypes.js";
import type { Store } from "../store.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { S3v3SyncEngine, S3v3SyncError, classifyS3v3Error } from "./syncEngine.js";
import { annotateSyncError } from "./syncErrorInfo.js";
import type { S3v3Remote } from "./ports.js";
import { getQuickNotesStoreForV3 } from "./quickNotesRegistry.js";
import type { QuickNotePushOutcome } from "../../src/core/quickNoteSyncTypes.js";
import { buildS3v3DiagnosticReport, createS3v3PhaseCollector, type S3v3DiagnosticReport } from "../../src/core/s3v3Report.js";

/**
 * 桌面 v3 同步入口（feature flag: LAKE_SYNC_PROTOCOL=v3）。
 * 真实数据 = Store；云端 = S3；协议 = v3。小记暂不在 v3 内同步（由原 quick-notes 通道继续）。
 */
/**
 * 本机历史快照引用的云端资产键（`assets/<noteId>/<filename>`）。
 * 深度清理必须把它们并入 keep 集：历史快照正文在本地 DB，图片/附件仍在 S3，
 * 一旦被清掉，历史面板就是裂图且用户无从恢复（旧协议 buildLakeGcKeepSet 的 historyRefs）。
 */
export function localHistoryAssetRefs(store: Store): Set<string> {
  const refs = new Set<string>();
  try {
    for (const noteId of store.listNoteIdsWithHistory()) {
      for (const filename of store.getProtectedRefs(noteId)) refs.add(`assets/${noteId}/${filename}`);
    }
  } catch { /* 历史库异常不应阻断清理；保守起见按空集处理（下一次清理再保护） */ }
  return refs;
}

/** SD-13：把本轮同步诊断写进 device_state（最近 3 轮环形）；失败不阻断同步结果。 */
function recordV3Diagnostic(store: Store, report: S3v3DiagnosticReport): void {
  try { store.recordV3SyncReport(report); } catch { /* 诊断落盘失败不影响同步 */ }
}

/** 桌面设备 id（整轮与单条推送必须同 id，才能共用发布锁/基线语义）。 */
function desktopDeviceId(store: Store): string {
  return "desktop-" + createHash("sha256").update(store.rootPath).digest("hex").slice(0, 8);
}

/** v3 深度清理：文档 + 小记统一按当前 pointer/index/声明算 keep 集（含历史引用与保留窗口）。 */
export async function runV3DeepCleanup(
  store: Store,
  opts: { dryRun?: boolean; retentionDays?: number; remote?: S3v3Remote } = {},
): Promise<{ deleted: string[]; kept: number }> {
  const settings = store.getS3Settings();
  if (!settings && !opts.remote) throw new Error("请先保存 S3 配置");
  const remote = opts.remote ?? new S3v3S3Remote({
    endpoint: settings!.endpoint, region: settings!.region, bucket: settings!.bucket,
    accessKeyId: settings!.accessKeyId, secretAccessKey: settings!.secretAccessKey,
    prefix: settings!.prefix, forcePathStyle: settings!.forcePathStyle,
  });
  const quickNotes = getQuickNotesStoreForV3();
  const device = new DesktopStoreDevice(store, store.rootPath, { skipQuickNotesGuard: true, ...(quickNotes ? { quickNotes } : {}) });
  await device.init();
  const engine = new S3v3SyncEngine({ remote, device, deviceId: "desktop-cleanup" });
  const gc = store.getS3GcSettings();
  const result = await engine.deepCleanup({
    dryRun: opts.dryRun,
    extraKeep: localHistoryAssetRefs(store),
    retentionDays: opts.retentionDays ?? gc.gcRetentionDays,
  });
  return { deleted: result.deleted, kept: result.kept };
}

export async function syncWithV3(
  store: Store,
  onProgress?: (p: SyncProgress) => void,
  deps: { remote?: S3v3Remote; deviceId?: string } = {},
): Promise<SyncResult> {
  const startedAt = Date.now();
  const report = (p: SyncProgress) => { try { onProgress?.(p); } catch { /* window closed */ } };
  // SD-13：阶段耗时 + 对象数/字节（成功/失败都落 device_state，设置页可一键复制）。
  const diag = createS3v3PhaseCollector();
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
  const deviceId = deps.deviceId ?? process.env.LAKE_S3V3_DEVICE_ID ?? desktopDeviceId(store);
  report({ phase: "connect", message: "v3：连接 S3..." });
  // 进度阶段（对齐旧协议 G1/G2）：引擎阶段 → SyncProgress。首拉/大库时 UI 不再只有 connect→done。
  const PHASE_PROGRESS: Record<string, { phase: SyncProgress["phase"]; message: string }> = {
    "load-state": { phase: "download", message: "v3：读取本地状态..." },
    "read-index": { phase: "download", message: "v3：读取云端索引..." },
    merge: { phase: "download", message: "v3：合并远端变更..." },
    // 首拉/大库：正文/应用/声明/附件都是可观察阶段（渲染层据此渐进刷新，文档边下边出现）。
    bodies: { phase: "download", message: "v3：下载正文..." },
    apply: { phase: "download", message: "v3：应用到本地..." },
    declarations: { phase: "download", message: "v3：读取资产声明..." },
    assets: { phase: "download", message: "v3：下载附件..." },
    finalize: { phase: "manifest", message: "v3：收尾..." },
    downloads: { phase: "download", message: "v3：下载正文/附件..." },
    uploads: { phase: "upload", message: "v3：上传变更..." },
    "publish-save-state": { phase: "manifest", message: "v3：保存发布状态..." },
    "publish-lock": { phase: "manifest", message: "v3：获取发布锁..." },
    "publish-index": { phase: "manifest", message: "v3：写入云端索引..." },
    "publish-pointer": { phase: "manifest", message: "v3：发布指针..." },
    "publish-finalize": { phase: "manifest", message: "v3：确认发布..." },
    pending: { phase: "manifest", message: "v3：清理待删对象..." },
    // v4 四相内核（E2-3）：映射到与既有路径相同的可观察阶段，UI/进度条不用改。
    "round-plan": { phase: "download", message: "v4：读取并合并云端状态..." },
    "round-apply": { phase: "download", message: "v4：应用远端变更..." },
    "round-finalize": { phase: "manifest", message: "v4：发布收尾..." },
  };
  // 引擎进度（每个对象完成回调一次）→ IPC 有节流：2 万个附件不能把桥打满。
  let lastProgressAt = 0;
  let lastProgressPhase = "";
  const reportTransferProgress = (p: { phase: string; done?: number; total?: number }) => {
    const label = p.phase === "bodies" ? "v3：下载正文" : p.phase === "apply" ? "v3：应用到本地"
      : p.phase === "declarations" ? "v3：读取资产声明" : p.phase === "assets" ? "v3：下载附件" : "";
    if (!label) return;
    const now = Date.now();
    if (p.phase === lastProgressPhase && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    lastProgressPhase = p.phase;
    const done = p.done ?? 0;
    const total = p.total ?? 0;
    report({ phase: "download", message: label + (total > 0 ? " " + done + "/" + total : ""), current: done, total });
  };
  // 测试/压测可用 LAKE_S3V3_RANGE_CHUNK 控制大对象分片（0 = 关闭 Range，走整对象）。
  const rangeChunkEnv = process.env.LAKE_S3V3_RANGE_CHUNK;
  const largeAssetChunkBytes = rangeChunkEnv !== undefined && rangeChunkEnv !== "" ? Number(rangeChunkEnv) : undefined;
  const engine = new S3v3SyncEngine({
    remote, device, deviceId,
    ...(largeAssetChunkBytes !== undefined && Number.isFinite(largeAssetChunkBytes) ? { largeAssetChunkBytes } : {}),
    onProgress: (p) => { diag.progress(p); reportTransferProgress(p); },
    onPhase: (phase, ms) => {
      diag.phase(phase, ms);
      if (ms >= 1000) store.logScopes.sync.warn(`[v3][slow] ${phase} ${ms}ms`);
      else store.logScopes.sync.debug(`[v3] ${phase} ${ms}ms`);
      const mapped = PHASE_PROGRESS[phase];
      if (mapped) report({ phase: mapped.phase, message: mapped.message });
    },
  });
  // 转正后默认把「云端无 v3 pointer」视为首次上传：本地就是真相（旧 manifest 不迁移，符合无历史兼容）。
  const emptyMode = (process.env.LAKE_S3V3_EMPTY_CLOUD ?? "upload") as "upload" | "stay" | "throw";
  // 按需资产（P0-4，与移动端同口径）：设置里打开时首拉只同步正文/声明，媒体打开/预览时补拉。
  const deferAssets = store.getSyncSettings().deferAssets === true;
  try {
    const r = await engine.sync({ ...(emptyMode === "throw" ? {} : { onEmptyCloud: emptyMode }), ...(deferAssets ? { deferAssets: true } : {}) });
    // SD-04 + Del-6（261027/261029）：本轮成功同步后推进「墓碑发布水线」（替代逐行 published_at 记账）。
    // 判据 = deleted_at > 水线 ⇒ 本轮之前（含本轮）的 purge 墓碑清零；下一轮新增 purge 仍待同步。
    // 记账失败不影响同步结果；下一轮成功后水线继续前进即可覆盖。
    try {
      const at = new Date().toISOString();
      store.markTombstonesWaterline(at);
      quickNotes?.markTombstonesWaterline(at);
    } catch { /* 记账失败不影响同步结果；下一轮再补 */ }
    // SD-03（261027）：把已发布到云端的文档 id 回填给 Store（供给「缺正文」的「可云恢复」判据）。
    try {
      const baseline = await device.loadBaseline();
      if (baseline) store.markRemoteNoteIds(baseline.lake.notes.map((n) => n.id));
    } catch { /* 读基线失败时保持上一轮集合 */ }
    for (const w of r.warnings) store.logScopes.sync.warn("[v3] " + w);
    const result: SyncResult = {
      uploaded: r.uploadedNotes, downloaded: r.downloadedNotes, conflicts: r.supersededNotes.length,
      manifestId: "v3-g" + r.generation, completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt, supersededNotes: r.supersededNotes,
      // 261028：浮窗「上传/下载细分」数据（引擎 report 直接给出；缺省回退到总数）。
      uploadedDocuments: r.uploadedDocuments ?? r.uploadedNotes,
      downloadedDocuments: r.downloadedDocuments ?? r.downloadedNotes,
      uploadedQuickNotes: r.uploadedQuickNotes ?? 0,
      downloadedQuickNotes: r.downloadedQuickNotes ?? 0,
      foldersUploaded: r.uploadedFolders ?? 0,
      foldersDownloaded: r.downloadedFolders ?? 0,
      uploadedBytes: r.uploadedBytes ?? 0,
      downloadedBytes: r.downloadedBytes ?? 0,
      // 旧协议有的结构化警告（UI SyncStatusPopover 读取 warnings；只增不减）。
      ...(r.warningDetails.length > 0 ? { warnings: r.warningDetails } : {}),
    };
    store.logScopes.sync.info("[v3] sync done " + JSON.stringify({ published: r.published, gen: r.generation, warnings: r.warnings.length, ms: result.durationMs }));
    recordV3Diagnostic(store, buildS3v3DiagnosticReport({
      at: result.completedAt,
      ok: true,
      durationMs: Date.now() - startedAt,
      generation: r.generation,
      published: r.published,
      uploaded: r.uploadedNotes,
      downloaded: r.downloadedNotes,
      deleted: r.deletedObjects,
      conflicts: r.supersededNotes.length,
      warnings: r.warningDetails,
      phases: diag.snapshot(),
    }));
    return result;
  } catch (e) {
    const code = e instanceof S3v3SyncError ? e.code : (e as { code?: string } | null)?.code;
    const errorClass = classifyS3v3Error(e);
    store.logScopes.sync.warn(`[v3][error] class=${errorClass} code=${code ?? "unknown"} msg=${(e as Error).message}`);
    // 失败轮同样落一轮诊断（阶段耗时能区分「卡在锁」还是「卡在传输」）。
    recordV3Diagnostic(store, buildS3v3DiagnosticReport({
      at: new Date().toISOString(),
      ok: false,
      durationMs: Date.now() - startedAt,
      phases: diag.snapshot(),
      error: { code: code ?? "unknown", errorClass, message: (e as Error).message },
    }));
    // 261028 P1：分类随错误一起跨 IPC（errors.ts 读 syncCode/syncClass）⇒ 渲染层区分
    // 「另一台设备在发布（可重试）」与「epoch 不一致（需人工处理）」，不再统一当 INTERNAL。
    if (e instanceof S3v3SyncError && e.code === "empty-cloud") {
      const wrapped = new Error("云端为空：请确认是否首次上传（设置 LAKE_S3V3_EMPTY_CLOUD=upload 以初始化）");
      throw annotateSyncError(wrapped, { code: e.code, className: errorClass });
    }
    throw annotateSyncError(e, { code: code ?? "unknown", className: errorClass });
  }
}

/**
 * 单条小记推送（「保存并同步」，v3 parity E2）：只 upsert 这一条，其余小记条目/标签/墓碑
 * 逐字段保持云端原样（旧 quickNotePush 铁律）。两条退回整轮的路径不静默：
 * 云端无 pointer/无基线/基线不同代，或远端墓碑且本机无恢复标记 ⇒ 这里执行一次整轮同步并回传 full-sync。
 */
export async function pushQuickNoteWithV3(
  store: Store,
  id: string,
  deps: { remote?: S3v3Remote; deviceId?: string } = {},
): Promise<QuickNotePushOutcome> {
  const settings = store.getS3Settings();
  if (!settings && !deps.remote) throw new Error("请先保存 S3 配置");
  const quickNotes = getQuickNotesStoreForV3();
  if (!quickNotes) throw new Error("小记库未就绪（v3 小记通道关闭？）");
  const remote = deps.remote ?? new S3v3S3Remote({
    endpoint: settings!.endpoint, region: settings!.region, bucket: settings!.bucket,
    accessKeyId: settings!.accessKeyId, secretAccessKey: settings!.secretAccessKey,
    prefix: settings!.prefix, forcePathStyle: settings!.forcePathStyle,
  });
  const device = new DesktopStoreDevice(store, store.rootPath, { skipQuickNotesGuard: true, quickNotes });
  await device.init();
  const engine = new S3v3SyncEngine({
    remote, device,
    deviceId: deps.deviceId ?? process.env.LAKE_S3V3_DEVICE_ID ?? desktopDeviceId(store),
  });
  const startedAt = Date.now();
  const result = await engine.pushQuickNote(id);
  store.logScopes.sync.info(`[v3][push-single] ${id} -> ${result.status} ${Date.now() - startedAt}ms`);
  if (result.status === "not-found") return { status: "not-found" };
  if (result.status === "full-sync") {
    const full = await syncWithV3(store, undefined, deps);
    return {
      status: "full-sync",
      reason: result.reason === "remote-deleted" ? "remote-deleted" : "no-remote-manifest",
      result: {
        uploaded: full.uploaded, downloaded: full.downloaded, conflicts: full.conflicts,
        manifestId: full.manifestId, completedAt: full.completedAt,
      },
    };
  }
  return {
    status: "pushed",
    uploadedContent: result.uploadedContent,
    uploadedAssets: result.uploadedAssets,
    unchanged: result.unchanged,
    manifestId: "v3-g" + result.generation,
  };
}
