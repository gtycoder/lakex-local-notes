/**
 * S3 GC 诊断（桌面侧装配）。
 *
 * 把三份输入喂给 `src/core/gcDiagnostics` 的纯函数：
 *   ① 本机待回收表 s3_gc_pending（同步时标记，含窗口内不可删的）
 *   ② 云端实扫（Lake objects/assets/manifests + 小记 quick-notes/，带 LastModified + Size）
 *   ③ 权威引用集 keep（Lake 清单链 + 本设备历史 refs + 小记清单，与实际执行器同一函数）
 * 产出「总数 / 已过窗口 / 窗口内 / 云端未引用 / 时间戳未知」的可解释统计。
 *
 * 为什么单独成模块：需要同时用 s3Maintenance.ts（Lake）与 quickNotesSync.ts（小记）的引用集；
 * 放在同步 Controller 里会制造循环依赖。
 */
import { ObjectStore } from "./s3Store.js";
import { buildLakeGcKeepSet } from "./s3Maintenance.js";
import { parseLakeManifest, validateS3Settings } from "../src/core/syncUtils.js";
import { buildQuickNotesKeepSet, QUICK_NOTES_ROOT } from "./quickNotesSync.js";
import { computeGcDiagnostics, type GcCloudObject, type GcDiagnostics } from "../src/core/gcDiagnostics.js";
import { MAX_MANIFEST_BYTES } from "../src/core/syncUtils.js";
import type { Store } from "./store.js";

export type { GcDiagnostics };

/** 云端对象总量/未引用量/可回收量 + 待回收表分类；只读，不做任何删除。 */
export async function runGcDiagnostics(store: Store): Promise<GcDiagnostics> {
  const t0 = Date.now();
  store.logScopes.gc.info("[perf] gc-diagnostics start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);

  const latestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  const latest = latestBytes ? parseLakeManifest(latestBytes) : null;

  // keep 集 = Lake 引用闭包 ∪ 小记引用闭包（与实际执行器共用同一构造函数，保证预览数 == 实删数）
  const [lakeKeep, quickRefs] = await Promise.all([
    buildLakeGcKeepSet(store, remote, latest),
    buildQuickNotesKeepSet(remote),
  ]);
  const keep = new Set<string>(lakeKeep);
  for (const key of quickRefs.keep) keep.add(key);

  // 4 次分页 list 并发（元数据命令，远低于 S3 并发峰值 8 红线）
  const [objects, assets, manifests, quick] = await Promise.all([
    remote.list("objects/"),
    remote.list("assets/"),
    remote.list("manifests/"),
    remote.list(`${QUICK_NOTES_ROOT}/`),
  ]);
  const cloud: GcCloudObject[] = [...objects, ...assets, ...manifests, ...quick];

  const cfg = store.getS3GcSettings();
  const result = computeGcDiagnostics({
    pending: store.listS3GcPending(),
    cloud,
    keep,
    nowMs: Date.now(),
    retentionDays: cfg.gcRetentionDays,
    manifest: latest ? { commitId: latest.commitId, notes: latest.notes.length, folders: latest.folders.length } : null,
  });
  store.logScopes.gc.info(
    `[perf] gc-diagnostics done ${Date.now() - t0}ms ` +
    `(cloud=${cloud.length} keep=${keep.size} pending=${result.pending.total}/${result.pending.due}due ` +
    `cloudDue=${result.cloud.due} unreferenced=${result.cloud.unreferenced} ageUnknown=${result.cloud.ageUnknown})`
  );
  return result;
}
