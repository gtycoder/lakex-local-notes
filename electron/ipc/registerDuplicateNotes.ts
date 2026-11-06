/**
 * 261106 文档「创建副本」——桌面 IPC \`duplicate_notes\`（261107 并发/性能重构）。
 *
 * 架构（三阶段，解决"多选混合类型并发复制"的准确性与速度）：
 * 1) **prepare（同步、只读）**：校验 + 读正文 + 改写 + 收集资源清单/标签；不写盘不写库。
 * 2) **copy（异步、有界并发）**：把所有条目的资源复制任务摊平，用 \`copyConcurrency\`（默认 4）
 *    并发执行 \`fs.promises.copyFile\`（临时文件 + rename 原子落盘）。I/O 期间主进程事件循环不被阻塞。
 *    单条资源失败只影响该条（清理其半成品目录），其它条继续。
 * 3) **commit（同步、串行）**：逐条走新建管线落库（sort_order 紧邻插入 + 缓存/索引 + 标签），
 *    条与条之间 \`setImmediate\` 让出事件循环。提交是同步的 ⇒ 同批/跨批插入顺序天然准确。
 *
 * 并发安全：
 * - **整批单飞**（模块级 promise 链）：多个 \`duplicate_notes\` 请求不会交错三个阶段的半成品；
 * - 提交阶段同步执行 ⇒ 与其它树的同步写（重命名/移动/删除）不会在"读 sort_order → 移位 → 插入"中间被插入；
 * - 移动端 \`bridge.duplicateNotes\` 走 \`runWrite\` 写域（同一互斥模型），资源复制同样有界并发。
 *
 * 结果契约不变：{ ok, results:[{id,ok,newId?,reason?}], summary, reason?, message? }。
 */
import fs from "node:fs";
import path from "node:path";
import type { IpcRegistrar } from "./registrar.js";
import type { PreparedDuplicate, Store } from "../store.js";
import { log } from "../logger.js";
import { runPoolSettled } from "../../src/core/asyncPool.js";
import {
  duplicateReasonOf,
  normalizeDuplicateIds,
  summarizeDuplicateResults,
  type DuplicateNotesItemResult,
  type DuplicateNotesReason,
  type DuplicateNotesResult,
} from "../../src/core/duplicateNotes.js";

export interface DuplicateNotesIpcDeps {
  store: Store;
  /** 测试注入：覆盖单条复制实现（走旧单条同步路径）。 */
  duplicateOne?: (sourceId: string) => { id: string };
  /** 资源复制并发上限（默认 4；测试可设 1 以断言串行）。 */
  copyConcurrency?: number;
  /** 事件循环让出（测试可注入）。 */
  yieldNow?: () => Promise<void>;
}

const DEFAULT_COPY_CONCURRENCY = 4;

/** 整批单飞：多个请求串行进入三阶段，避免半成品交错 / IO 抖动。 */
let batchChain: Promise<unknown> = Promise.resolve();
function enqueueBatch<T>(run: () => Promise<T>): Promise<T> {
  const next = batchChain.then(run, run);
  batchChain = next.then(() => undefined, () => undefined);
  return next;
}

const defaultYield = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

interface AssetCopyJob {
  prepared: PreparedDuplicate;
  filename: string;
  sourcePath: string;
}

/** 把一条条目的资源复制进它的目标目录（临时文件 + rename，失败由调用方清理）。 */
async function copyAssetJob(store: Store, job: AssetCopyJob): Promise<void> {
  const targetDir = store.noteAssetsPathFor(job.prepared.newId);
  await fs.promises.mkdir(targetDir, { recursive: true });
  const destination = path.join(targetDir, job.filename);
  const temporary = destination + ".tmp-" + process.pid + "-" + Math.random().toString(16).slice(2);
  try {
    await fs.promises.copyFile(job.sourcePath, temporary);
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    try { await fs.promises.rm(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

async function cleanupPreparedAssets(store: Store, prepared: PreparedDuplicate): Promise<void> {
  try { await fs.promises.rm(store.noteAssetsPathFor(prepared.newId), { force: true, recursive: true }); } catch { /* best effort */ }
}

async function runBatch(raw: unknown, deps: DuplicateNotesIpcDeps): Promise<DuplicateNotesResult> {
  const payload = (raw ?? {}) as { ids?: unknown };
  const normalized = normalizeDuplicateIds(payload.ids);
  if (!normalized.ok) {
    return { ok: false, results: [], summary: { total: 0, done: 0, failed: 0 }, reason: normalized.reason, message: normalized.message };
  }
  const yieldNow = deps.yieldNow ?? defaultYield;
  const concurrency = Math.max(1, deps.copyConcurrency ?? DEFAULT_COPY_CONCURRENCY);
  const resultById = new Map<string, DuplicateNotesItemResult>();
  const failedIds = new Set<string>();

  // 测试注入：保持旧单条同步路径（便于构造执行期异常用例）。
  if (deps.duplicateOne) {
    const duplicateOne = deps.duplicateOne;
    for (const id of normalized.ids) {
      try {
        const created = duplicateOne(id);
        resultById.set(id, { id, ok: true, newId: created.id });
      } catch (error) {
        resultById.set(id, { id, ok: false, reason: duplicateReasonOf(error) });
      }
      await yieldNow();
    }
    return finish(normalized.ids, resultById);
  }

  // ---- 阶段 1：prepare（同步只读）----
  const preparedItems: PreparedDuplicate[] = [];
  for (const id of normalized.ids) {
    try {
      preparedItems.push(deps.store.prepareDuplicate(id));
    } catch (error) {
      resultById.set(id, { id, ok: false, reason: duplicateReasonOf(error) });
    }
  }
  await yieldNow();

  // ---- 阶段 2：copy（异步有界并发）----
  const jobs: AssetCopyJob[] = [];
  for (const prepared of preparedItems) {
    for (const asset of prepared.assets) jobs.push({ prepared, filename: asset.filename, sourcePath: asset.sourcePath });
  }
  if (jobs.length > 0) {
    const { errors } = await runPoolSettled(jobs, concurrency, (job) => copyAssetJob(deps.store, job));
    for (const { index } of errors) {
      const prepared = jobs[index].prepared;
      if (failedIds.has(prepared.sourceId)) continue;
      failedIds.add(prepared.sourceId);
      resultById.set(prepared.sourceId, { id: prepared.sourceId, ok: false, reason: "failed" });
      await cleanupPreparedAssets(deps.store, prepared);
    }
  }
  await yieldNow();

  // ---- 阶段 3：commit（同步串行）----
  for (const prepared of preparedItems) {
    if (failedIds.has(prepared.sourceId)) continue;
    try {
      const created = deps.store.commitPreparedDuplicate(prepared);
      resultById.set(prepared.sourceId, { id: prepared.sourceId, ok: true, newId: created.id });
    } catch (error) {
      resultById.set(prepared.sourceId, { id: prepared.sourceId, ok: false, reason: duplicateReasonOf(error) });
      await cleanupPreparedAssets(deps.store, prepared);
    }
    await yieldNow();
  }

  return finish(normalized.ids, resultById);
}

function finish(ids: readonly string[], resultById: Map<string, DuplicateNotesItemResult>): DuplicateNotesResult {
  const results = ids.map((id) => resultById.get(id) ?? { id, ok: false, reason: "failed" as DuplicateNotesReason });
  const summary = summarizeDuplicateResults(results);
  const result: DuplicateNotesResult = { ok: summary.failed === 0, results, summary };
  const failed = results.filter((item) => !item.ok).map((item) => ({ id: item.id, reason: item.reason ?? null }));
  log.app.info("[duplicate] " + JSON.stringify({ requested: ids.length, total: summary.total, done: summary.done, failed: summary.failed, failedItems: failed.slice(0, 20) }));
  return result;
}

/** 跑一批（单飞；IPC 与测试共用入口）。 */
export function runDesktopDuplicateNotes(raw: unknown, deps: DuplicateNotesIpcDeps): Promise<DuplicateNotesResult> {
  return enqueueBatch(() => runBatch(raw, deps));
}

export function registerDuplicateNotesIpc(ipc: IpcRegistrar, deps: DuplicateNotesIpcDeps): void {
  // payload：{ ids: string[] }（与移动端 bridge.duplicateNotes 完全一致）
  ipc.handle("duplicate_notes", (raw: unknown) => runDesktopDuplicateNotes(raw, deps));
}
