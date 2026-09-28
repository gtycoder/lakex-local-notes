/**
 * Lake S3 回收：keep 集、差集对账、深度清理与旧 manifest 裁剪。
 * 从原 electron/sync.ts 拆出；传输层见 s3Store.ts，同步编排见 syncEngineController.ts。
 */
import type { Store } from "./store.js";
import type { LoggerScopes } from "../src/core/logger.js";
import type { Manifest } from "../src/core/manifestTypes.js";
import { parseLakeManifest, MAX_MANIFEST_BYTES, validateS3Settings } from "../src/core/syncUtils.js";
import { gcCutoffMs, isPastWindow, parseIsoMs } from "../src/core/gcPolicy.js";
import { buildGcKeepSet } from "../src/core/gcDecisions.js";
import { ObjectStore } from "./s3Store.js";

/** 保留的 manifest commit 链长度（回归设计 S3-GC-DESIGN D4/§85「最近 3 份 commit，沿链 O(3) 遍历」）。
 * 实现曾一度提到 8（"多留提高容错"），但 prune 在每次有变更的发布里都沿链回捞 = N 次串行 GET，
 * 是稳态同步的纯浪费（实测单张 89B 图片的首传同步被拖到 4.4s，其中约 1.3s 就是回捞 8 份历史 manifest）。
 * 浅链不影响数据安全：活动对象恒在 latest 全量快照内，被降级出 latest 的旧键另有
 * 「本地历史 refs 保护 + 7 天年龄保护 + 重新引用即撤销 s3_gc_pending」三重兜底；prevCommitId 链只是
 * 更保守的容错回溯窗口。prune / runGcReconcile / runDeepCleanup 三者共用此常量，必须一致，
 * 否则深度清理会把「多留的份」在窗口后删掉。 */
const MANIFEST_CHAIN_KEEP = 3;
/** 滞后裁剪水位（份）：prune 不再每次发布都做链遍历，累计超过 (2 + KEEP + SLACK) 才裁回 (2 + KEEP)。
 *  把「list + 沿链 GET」的 housekeeping 摊薄到约每 SLACK 次发布一次；期间 manifests/ 目录略多占几个小文件，无正确性影响。 */
const MANIFEST_PRUNE_SLACK = 6;
/**
 * 清单加载护栏（W-13）：manifest 是同步的第一个解析对象，且在零变更早退之前。
 * 异常/恶意清单（投毒、版本 bug、gzip 炸弹）不得打爆主进程：
 * - 字节上限：parseLakeManifest 在 JSON.parse 之前检查解压后体积，
 *   框死 gzip 炸弹与异常膨胀清单的内存占用；
 * - 条目数上限：validateManifest 内拒绝畸形数组，避免后续 O(n) 校验耗资源。
 * 上限取值依据：1 万条笔记清单约 3-5MB 未压缩；20 万条 ≈ 60MB，宽裕一个数量级。
 */
// ===== S3 GC：权威引用集与执行器（M5/M7，keep 集单一来源） =====
/**
 * Lake 侧「云端仍被权威引用」的键全集：
 *   latest.json 本身 + latest 清单引用（正文/资源/文件夹） + prevCommitId 链上 KEEP(3) 份 commit
 *   + 本设备任意历史快照引用的资源（B1：本设备最佳努力，非跨设备承诺）。
 * 对账与深度清理必须共用本函数——否则两处各按一份 keep 判断，会出现口径漂移
 * （2026-09-03 排查：UI「待回收 23」与「对账/深度清理 0」看似矛盾即源于多入口语义不清）。
 */
export async function buildLakeGcKeepSet(store: Store, remote: ObjectStore, latest: Manifest | null): Promise<Set<string>> {
  const keep = new Set<string>(["manifests/latest.json"]);
  const extraManifests: Manifest[] = [];
  if (latest) {
    let prev = latest.prevCommitId;
    let chain = 0;
    while (prev && chain < MANIFEST_CHAIN_KEEP) {
      const key = `manifests/${prev}.json`;
      keep.add(key);
      const bytes = await remote.getOptional(key, { maxBytes: MAX_MANIFEST_BYTES });
      if (!bytes) break;
      const m = parseLakeManifest(bytes);
      extraManifests.push(m);
      prev = m.prevCommitId;
      chain += 1;
    }
  }
  const refs = buildGcKeepSet({
    manifest: latest,
    extraManifests,
    prefix: "",
    historyRefs: store.listNoteIdsWithHistory().flatMap((noteId) =>
      Array.from(store.getProtectedRefs(noteId), (filename) => `assets/${noteId}/${filename}`),
    ),
  });
  for (const key of refs) keep.add(key);
  // 本设备历史引用保护（B1：最佳努力）
  return keep;
}

export interface GcReconcileResult {
  /** 本次实际删除的对象数（已过窗口 ∧ 不再被权威引用）。 */
  deleted: number;
  /** 仍在保留窗口内、暂不可删的待回收行数（表内继续保留）。 */
  kept: number;
  /** 已过窗口但仍被权威引用 → 从待回收表清除（不是冗余，不再展示为待回收），对象不动。 */
  clearedReferenced: number;
  /** 标记时间缺失/非法、无法判定窗口的行数（保守保留）。 */
  ageUnknown: number;
}

/**
 * 差集对账（M5）：逐行审视本机 s3_gc_pending，按「窗口 + 权威引用集 keep」三分：
 *   · 已过窗口 ∧ 不在 keep → 云端删除 + 清表（deleted）
 *   · 已过窗口 ∧ 在 keep   → 已被再次引用（本设备发布 / 他端发布），清表不动对象（clearedReferenced）
 *   · 窗口内 / 时间戳非法  → 保留等窗口（kept / ageUnknown）
 * 说明：旧实现只删「已过窗口 ∧ 不在 keep」，把「已过窗口但仍被引用」的行永久留在表里，
 * 造成 UI「待回收」数字只增不清、与实际可回收量脱节（2026-09-03 用户排查现象的一部分）。
 */
export async function runGcReconcile(store: Store, opts?: { ignoreRetention?: boolean }): Promise<GcReconcileResult> {
  const gcStart = Date.now();
  store.logScopes.gc.info("[perf] gc-reconcile start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);

  const latestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  if (!latestBytes) { store.logScopes.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (no manifest)`); return { deleted: 0, kept: 0, clearedReferenced: 0, ageUnknown: 0 }; }
  const latest = parseLakeManifest(latestBytes);
  const keep = await buildLakeGcKeepSet(store, remote, latest);

  const cfg = store.getS3GcSettings();
  // 手动对账（UI 按钮）= 显式清理云端 → 无视保留窗口（边界推到未来，所有可解析标记都视为到期）；
  // 自动/定时对账仍按窗口走（opts.ignoreRetention 缺省 false）。
  const cutoff = opts?.ignoreRetention ? Number.MAX_SAFE_INTEGER : gcCutoffMs(Date.now(), cfg.gcRetentionDays);
  const toDelete: string[] = [];
  const toClear: string[] = [];
  let kept = 0;
  let ageUnknown = 0;
  for (const p of store.listS3GcPending()) {
    const ms = parseIsoMs(p.markedAt);
    if (ms === null) { ageUnknown += 1; continue; }     // 判不出就不删（保守）
    if (ms <= cutoff) {
      if (keep.has(p.key)) toClear.push(p.key);         // 仍被引用 → 撤销表内冗余项
      else toDelete.push(p.key);                        // 真冗余且已过窗口 → 删除
    } else {
      kept += 1;                                        // 窗口内暂不可删
    }
  }
  if (toDelete.length > 0) {
    await remote.deleteMany(toDelete);
    store.removeS3GcPending(toDelete);
    for (const key of toDelete) store.recordS3GcLog("delete", key, "retention", latest.commitId, "local", true);
  }
  if (toClear.length > 0) store.removeS3GcPending(toClear);
  store.logScopes.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (deleted=${toDelete.length}, kept=${kept}, cleared=${toClear.length}, ageUnknown=${ageUnknown})`);
  return { deleted: toDelete.length, kept, clearedReferenced: toClear.length, ageUnknown };
}

// ===== S3 GC：深度清理（M7，Lake 侧；小记清理在 quickNotesSync） =====
export interface DeepCleanupResult {
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  keys: string[];
}

/**
 * 深度清理（M7）：云端实扫 objects/assets/manifests，删除「不在权威引用集 ∧ 已过保留窗口」的键。
 * 窗口判定用「对象创建时间（lastModified）+ 本机待回收表」双锚：
 *   若该键在本机 s3_gc_pending 中 → 还须待回收标记也过窗口（即 max(created, removed)+窗口 语义，
 *   避免「刚被移除、还处在撤销/恢复窗口内」的对象被创建年龄提前清掉，与对账 M5 同口径）；
 *   无待回收标记（他端移除/历史孤儿）→ 仅看创建年龄。
 * dryRun=true 只列出不删；删除写 s3_gc_log。只枚举 Lake 子空间；quick-notes/ 由 runQuickNotesDeepCleanup 单独处理。
 * opts.ignoreRetention=true（手动 UI 触发）= 显式清理云端：删除当前全部未引用键、无视 7 天窗口（自动/定时仍默认窗口）。
 */
export async function runDeepCleanup(store: Store, opts?: { dryRun?: boolean; extraKeep?: Set<string>; ignoreRetention?: boolean }): Promise<DeepCleanupResult> {
  const deepStart = Date.now();
  store.logScopes.gc.info(`[perf] deep-cleanup start (dryRun=${opts?.dryRun ?? false}, ignoreRetention=${opts?.ignoreRetention ?? false})`);
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);
  const dryRun = opts?.dryRun ?? false;
  const extraKeep = opts?.extraKeep ?? new Set<string>();
  const ignoreRetention = opts?.ignoreRetention ?? false;

  const latestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  if (!latestBytes) { store.logScopes.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (no manifest)`); return { dryRun, candidateCount: 0, deletedCount: 0, keys: [] }; }
  const latest = parseLakeManifest(latestBytes);

  const keep = await buildLakeGcKeepSet(store, remote, latest);
  for (const k of extraKeep) keep.add(k);

  const cfg = store.getS3GcSettings();
  const cutoff = gcCutoffMs(Date.now(), cfg.gcRetentionDays);
  // 本机待回收表（键 → 标记时刻）：供「移除时间」锚定（见函数注释）。
  const pendingByKey = new Map(store.listS3GcPending().map((p) => [p.key, p.markedAt] as const));

  // TRASH-NOTEBOOK：回收站条目是 active 条目（assets 在 manifest keep 集），不再需要前缀保护 hack；
  // deleted 墓碑仅剩 purge 场景（其对象已由 M4 deletePrefix 删除）。
  const all = [
    ...(await remote.list("objects/")),
    ...(await remote.list("assets/")),
    ...(await remote.list("manifests/")),
  ];
  const candidates = all
    .filter((item) => !keep.has(item.key))
    .filter((item) => {
      if (ignoreRetention) return true;                       // 手动深度清理：显式清云端 → 全部未引用（含窗口内/年龄未知）
      if (!isPastWindow(item.lastModified, cutoff)) return false;   // 自动：创建不足窗口 → 保护
      const marked = pendingByKey.get(item.key);
      return marked === undefined || isPastWindow(marked, cutoff);  // 自动：本机已标记但窗口未过 → 保护
    })
    .map((item) => item.key);

  if (dryRun || candidates.length === 0) {
    store.logScopes.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=0)`);
    return { dryRun, candidateCount: candidates.length, deletedCount: 0, keys: candidates };
  }
  await remote.deleteMany(candidates);
  for (const key of candidates) store.recordS3GcLog("delete", key, "deep-clean", latest.commitId, "local", true);
  store.logScopes.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=${candidates.length})`);
  return { dryRun, candidateCount: candidates.length, deletedCount: candidates.length, keys: candidates };
}
/**

 * 验收 #3（修订）：裁剪 manifests/ 目录，保留 latest.json + 刚写入 commit + 沿 prevCommitId 链 KEEP(3) 份
 * （稳态 targetFiles = 2 + KEEP = 5 个文件）。为把「list + 沿链 GET」的 housekeeping 摊薄出同步热路径，
 * 采用滞后裁剪：目录内文件数未超过 targetFiles + SLACK 时直接返回（仅一次 list，不做链遍历 GET），
 * 仅当超水位才沿链算出 keep 集并把多余的旧 commit 删回 target。只沿 latest 可达链裁剪：任何不在链上
 * 的 manifest 对 GC/对账均不可达，删除安全；删除失败不阻断同步（下次同步再试）。
 */
export async function pruneOldManifests(remote: ObjectStore, commitId: string, remoteManifest: Manifest | null, logScopes: LoggerScopes): Promise<void> {
  const targetFiles = 2 + MANIFEST_CHAIN_KEEP;          // latest.json + 刚写入 commit + 链 prev（KEEP 份）
  const all = (await remote.list("manifests/")).map((item) => item.key);
  // 滞后水位：未到阈值只花一次 list，跳过链遍历（省 KEEP 次串行 GET）；这是本次性能优化的主菜。
  if (all.length <= targetFiles + MANIFEST_PRUNE_SLACK) return;
  const keep = new Set<string>(["manifests/latest.json", `manifests/${commitId}.json`]);
  let prev = remoteManifest?.commitId ?? null;
  let chain = 0;
  while (prev && chain < MANIFEST_CHAIN_KEEP) {
    const key = `manifests/${prev}.json`;
    keep.add(key);
    try {
      const bytes = await remote.getOptional(key);
      if (!bytes) break;
      const m = parseLakeManifest(bytes);

      prev = m.prevCommitId;
    } catch { break; }
    chain += 1;
  }
  const toDelete = all.filter((key) => !keep.has(key));
  if (toDelete.length === 0) return;
  await remote.deleteMany(toDelete);
  logScopes.sync.info(`[perf] manifest prune ${toDelete.length} old (kept=${keep.size})`);
}
