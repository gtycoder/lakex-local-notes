/**
 * v4 Applier（E2-1）：消费 SyncPlan 的 reads/transfers/writes/deletes，**只做 IO，不做决策**。
 *
 * 契约（07 RFC §6.2 / 08 §25.2）：
 *  - 决策全部来自 plan（本文件不读合并函数、不看基线）；重复应用同一 plan 无副作用（正文按 hash 内容寻址）；
 *  - **数据安全不变量在此兜底**：绝不把空正文当删除（本地缺正文 ⇒ 跳过上传 + local_body_missing）；
 *    绝不写校验不过的字节（下载 sha256 不符 ⇒ 不落盘 + hash_mismatch）；绝不上传 hash 与 key 不符的字节；
 *    绝不删除本地正文（唯一例外 = plan 明确给出的 user-purge DeleteOp）；
 *  - 失败只影响单对象（all-or-isolate，errors 收集不抛）；
 *  - 声明读取（ReadOp kind=declaration）只把**声明内容**取回并校验 hash，**不做资产差集**
 *    ⇒ 资产层面的 PUT/GET 是 Apply 的二次展开（E2-1b），届时消费本函数返回的 declarations。
 *  - WriteOp kind=apply-remote / set-lifecycle 的**索引行变更**不在这里做：那是 Commit 消费 plan.writes
 *    的职责（applier 只负责与之关联的正文 IO）。
 */
import { declarationHashOf, declarationKey, lakeBodyKey, quickNoteBodyKey, validateAssetDeclaration, type AssetDeclEntry, type AssetDeclaration } from "../protocol/index.js";
import { sha256Hex } from "../../syncUtils.js";
import { runTransferPipeline } from "../../s3v3Transfer.js";
import type { PlanWarning, ReadOp, Space, SyncPlan, WriteOp } from "../plan/types.js";

/** Applier 需要的最小 IO 面（比 S3v3DeviceStore 窄：E2-4 才收敛成单一 DeviceStore）。 */
export interface ApplyPorts {
  getRemote(key: string): Promise<Uint8Array | null>;
  putRemote(key: string, bytes: Uint8Array): Promise<void>;
  deleteRemoteKeys(keys: string[]): Promise<void>;
  deleteRemotePrefix(prefix: string): Promise<number>;
  readLocalBody(space: Space, id: string): Promise<Uint8Array | null>;
  writeLocalBody(space: Space, id: string, bytes: Uint8Array): Promise<void>;
  archiveLocal(space: Space, id: string, reason: "remote-wins" | "cloud-absent"): Promise<void>;
  deleteLocalBody(space: Space, id: string): Promise<void>;
}

export type ApplyPhase = "archives" | "reads" | "uploads" | "deletes";

export interface ApplyOptions {
  /** 并发上限（读取/上传两段流水线；默认 8，与 v3 声明流水线同档）。 */
  concurrency?: number;
  /** 下载后校验 sha256（默认开）；关掉只用于「历史数据 hash 存疑」的排障。 */
  verifyDownloadHashes?: boolean;
  /** 首拉 lazy 档：跳过声明读取（连声明的 GET 都不该有）。 */
  deferDeclarations?: boolean;
  onProgress?: (p: { phase: ApplyPhase; done: number; total: number; bytes: number }) => void;
}

export type AppliedStatus = "applied" | "skipped-remote-missing" | "skipped-hash-mismatch";

export interface AppliedEntry { space: Space; id: string; bodyHash: string | null; status: AppliedStatus }

export interface ApplyResult {
  entries: AppliedEntry[];
  /** 已取回并校验过的资产声明（供 applyAssets 做差集；含 size/hash 才能跳过已落地资产）。 */
  declarations: Array<{ space: Space; id: string; declHash: string; assets: AssetDeclEntry[] }>;
  uploaded: { documents: number; quickNotes: number; bytes: number };
  downloaded: { documents: number; quickNotes: number; bytes: number };
  deletedObjects: number;
  warnings: PlanWarning[];
  /** 本地正文缺失导致跳过上传：Commit **必须**把该条目回退到远端旧版本（不得进新索引）。 */
  failedUploads: Array<{ space: Space; id: string }>;
  errors: Array<{ op: string; detail?: string; error: unknown }>;
}

const DEFAULT_CONCURRENCY = 8;

/** 纯执行：按 plan 做 IO 并返回副作用清单。幂等（同一 plan 重复执行结果一致）。 */
export async function applyPlan(plan: SyncPlan, ports: ApplyPorts, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const result: ApplyResult = {
    entries: [], declarations: [],
    uploaded: { documents: 0, quickNotes: 0, bytes: 0 },
    downloaded: { documents: 0, quickNotes: 0, bytes: 0 },
    deletedObjects: 0, warnings: [], failedUploads: [], errors: [],
  };
  const rawConcurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const concurrency = Number.isSafeInteger(rawConcurrency) && rawConcurrency >= 1 ? rawConcurrency : DEFAULT_CONCURRENCY;
  const verify = opts.verifyDownloadHashes !== false;
  const warn = (w: PlanWarning) => result.warnings.push(w);

  // 1) 归档本地版本先于任何正文覆盖（冲突/云端缺席时先留档；顺序不是契约，集合才是）。
  const archives = plan.writes.filter((w): w is Extract<WriteOp, { kind: "archive-local" }> => w.kind === "archive-local");
  for (let i = 0; i < archives.length; i++) {
    const op = archives[i];
    try { await ports.archiveLocal(op.space, op.id, op.reason); }
    catch (error) { result.errors.push({ op: "archive", detail: op.space + ":" + op.id, error }); }
    opts.onProgress?.({ phase: "archives", done: i + 1, total: archives.length, bytes: 0 });
  }

  // 2) 声明读取：只取回 + 校验 hash（差集留 E2-1b）。
  const declReads = opts.deferDeclarations ? [] : plan.reads.filter((r): r is Extract<ReadOp, { kind: "declaration" }> => r.kind === "declaration");
  for (const r of declReads) {
    try {
      const bytes = await ports.getRemote(declarationKey(r.space, r.id, r.declHash));
      if (!bytes) { warn({ code: "remote_incomplete", space: r.space, id: r.id, detail: "资产声明缺失: " + r.declHash }); continue; }
      const decl: AssetDeclaration = validateAssetDeclaration(JSON.parse(new TextDecoder().decode(bytes)));
      if (declarationHashOf(decl) !== r.declHash) { warn({ code: "hash_mismatch", space: r.space, id: r.id, detail: "声明 hash 不符: " + r.declHash }); continue; }
      result.declarations.push({ space: r.space, id: r.id, declHash: r.declHash, assets: decl.assets });
    } catch (error) { result.errors.push({ op: "declaration", detail: r.space + ":" + r.id, error }); }
  }

  // 3) 正文下载：get → 校验 → 落盘。
  const bodyReads = plan.reads.filter((r): r is Extract<ReadOp, { kind: "body" }> => r.kind === "body");
  const readRun = await runTransferPipeline(bodyReads, concurrency, async (r) => {
    const key = r.space === "lake" ? lakeBodyKey(r.id, r.hash) : quickNoteBodyKey(r.hash);
    const bytes = await ports.getRemote(key);
    if (!bytes) {
      warn({ code: "remote_incomplete", space: r.space, id: r.id, detail: "缺正文: " + r.id });
      result.entries.push({ space: r.space, id: r.id, bodyHash: r.hash, status: "skipped-remote-missing" });
      return 0;
    }
    if (verify && sha256Hex(bytes) !== r.hash) {
      warn({ code: "hash_mismatch", space: r.space, id: r.id, detail: "正文 sha256 与索引不符: " + r.hash });
      result.entries.push({ space: r.space, id: r.id, bodyHash: r.hash, status: "skipped-hash-mismatch" });
      return 0;
    }
    await ports.writeLocalBody(r.space, r.id, bytes);
    if (r.space === "lake") result.downloaded.documents += 1; else result.downloaded.quickNotes += 1;
    result.downloaded.bytes += bytes.length;
    result.entries.push({ space: r.space, id: r.id, bodyHash: r.hash, status: "applied" });
    return bytes.length;
  }, { phase: "bodies", onProgress: (p) => opts.onProgress?.({ phase: "reads", done: p.done, total: p.total, bytes: p.bytesDone }) });
  for (const e of readRun.errors) {
    const item = bodyReads[e.index];
    // 单对象 GET 失败必须同时留「结构化警告」：只进 errors 的话 UI/诊断看不到"少了一篇"。
    if (item) warn({ code: "remote_incomplete", space: item.space, id: item.id, detail: "正文下载失败: " + (e.error instanceof Error ? e.error.message : String(e.error)) });
    result.errors.push({ op: "read", detail: item ? item.space + ":" + item.id : undefined, error: e.error });
  }

  // 4) 正文上传：读本地字节 → 复算 sha256 → 与计划 hash 一致才 PUT（绝不把字节错配到内容地址）。
  const puts = plan.transfers.filter((t) => t.op === "put" && t.kind === "body");
  const putRun = await runTransferPipeline(puts, concurrency, async (t) => {
    const bytes = await ports.readLocalBody(t.space, t.id);
    if (!bytes) {
      // 数据安全：缺正文 ≠ 用户删了内容。跳过上传并让 Commit 回退到远端旧版本。
      warn({ code: "local_body_missing", space: t.space, id: t.id });
      result.failedUploads.push({ space: t.space, id: t.id });
      return 0;
    }
    const hash = sha256Hex(bytes);
    if (hash !== t.hash) {
      warn({ code: "hash_mismatch", space: t.space, id: t.id, detail: "本地正文与计划 hash 不符: " + t.hash });
      result.failedUploads.push({ space: t.space, id: t.id });
      return 0;
    }
    await ports.putRemote(t.key, bytes);
    if (t.space === "lake") result.uploaded.documents += 1; else result.uploaded.quickNotes += 1;
    result.uploaded.bytes += bytes.length;
    return bytes.length;
  }, { phase: "uploads", onProgress: (p) => opts.onProgress?.({ phase: "uploads", done: p.done, total: p.total, bytes: p.bytesDone }) });
  for (const e of putRun.errors) {
    const item = puts[e.index];
    if (item) result.failedUploads.push({ space: item.space, id: item.id });
    result.errors.push({ op: "upload", detail: item ? item.space + ":" + item.id : undefined, error: e.error });
  }

  // 5) 对象删除：只有 plan 明确的用户语义（user-purge）才删远端/本地。
  const prefixes = plan.deletes.flatMap((d) => d.prefixes ?? []);
  const keys = plan.deletes.flatMap((d) => d.keys ?? []);
  try {
    for (const prefix of prefixes) result.deletedObjects += await ports.deleteRemotePrefix(prefix);
    if (keys.length > 0) { await ports.deleteRemoteKeys(keys); result.deletedObjects += keys.length; }
  } catch (error) { result.errors.push({ op: "delete", detail: prefixes.concat(keys).join(","), error }); }
  for (let i = 0; i < plan.deletes.length; i++) {
    const d = plan.deletes[i];
    try { await ports.deleteLocalBody(d.space, d.id); }
    catch (error) { result.errors.push({ op: "delete-local", detail: d.space + ":" + d.id, error }); }
    opts.onProgress?.({ phase: "deletes", done: i + 1, total: plan.deletes.length, bytes: 0 });
  }

  return result;
}
