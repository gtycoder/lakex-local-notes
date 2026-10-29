import { sha256Hex } from "./syncUtils.js";
import { S3V3_POINTER_KEY, assetKey, declarationKey, indexKey, quickNoteAssetKey } from "./s3v3/protocol/s3v3Keys.js";
import { declarationHashOf, parseLakeIndexBytes, parseQuickNotesIndexBytes, validateAssetDeclaration, type AssetDeclaration } from "./s3v3/protocol/s3v3Index.js";
import { validatePointer } from "./s3v3/protocol/s3v3Types.js";
import type { S3v3Remote } from "./s3v3Ports.js";
import { runPoolSettled } from "./s3v3Pool.js";

/**
 * v3 资产惰性补拉（回收站预览/恢复等按需场景）。
 *
 * 旧协议把「云端声明了哪些资产」落在本地 declared_assets 表（manifest 下载时顺手写入），
 * 惰性补拉直接读表；v3 不写该表（声明是独立的**内容寻址对象**），所以这里走 v3 原生路径：
 *   pointer → 对应空间索引 → 该条 assetsHash → 声明对象 → 本地差集（同名+同 size+同 sha256 跳过）
 *   → 只对缺失/损坏者 GET，并按 size+sha256 强校验后落盘。
 *
 * 语义约束（与同步引擎一致，勿放宽）：
 * - 只读 pointer/索引/声明/对象，不写云端、不改索引、不动同步账本；
 * - 校验失败的对象**不落盘**（宁可缺图，不可写坏）；
 * - 任一步失败都降级为 warning（调用方是预览/恢复的 best-effort 路径，不得阻塞用户动作）。
 */

export type AssetBackfillSpace = "lake" | "quickNotes";

/** 平台端口：本地资产读写（桌面=Store 资源目录，移动=assetFs）。 */
export interface AssetBackfillPort {
  listLocal(id: string): Promise<string[]>;
  readLocal(id: string, filename: string): Promise<Uint8Array | null>;
  writeLocal(id: string, filename: string, bytes: Uint8Array): Promise<void>;
}

export interface AssetBackfillResult {
  /** 云端索引里找到该条且其声明了资产（false = 无声明/索引缺失，调用方不必报错）。 */
  found: boolean;
  downloaded: number;
  skipped: number;
  /** 人类可读 warning（由调用方透传到 UI/日志）。 */
  warnings: string[];
  /** 云端对象缺失的文件名。 */
  missing: string[];
  /** 对象下载异常或校验失败的文件名。 */
  failed: string[];
}

const DEFAULT_BACKFILL_CONCURRENCY = 4;

/** 读 pointer → 索引 → 该条 assetsHash；返回 null 表示「没有可补拉的声明」（不抛）。 */
async function resolveAssetsHash(remote: S3v3Remote, space: AssetBackfillSpace, id: string, warnings: string[]): Promise<{ assetsHash: string | null; found: boolean }> {
  const pointerBytes = await remote.get(S3V3_POINTER_KEY);
  if (!pointerBytes) { warnings.push("云端没有 v3 pointer（未初始化），跳过资产补拉"); return { assetsHash: null, found: false }; }
  let pointer: { lake: { commit: string }; quickNotes: { commit: string } };
  try {
    const parsed = validatePointer(JSON.parse(new TextDecoder().decode(pointerBytes)));
    if (!parsed.ok) { warnings.push("pointer 非法: " + parsed.reason); return { assetsHash: null, found: false }; }
    pointer = parsed.pointer;
  } catch { warnings.push("pointer 不是合法 JSON"); return { assetsHash: null, found: false }; }
  const commit = space === "lake" ? pointer.lake.commit : pointer.quickNotes.commit;
  const indexBytes = await remote.get(indexKey(space, commit));
  if (!indexBytes) { warnings.push("缺索引对象: " + commit); return { assetsHash: null, found: false }; }
  try {
    if (space === "lake") {
      const idx = parseLakeIndexBytes(indexBytes).index;
      const note = idx.notes.find((n) => n.id === id);
      return { assetsHash: note?.assetsHash ?? null, found: !!note };
    }
    const idx = parseQuickNotesIndexBytes(indexBytes).index;
    const q = idx.items.find((n) => n.id === id);
    return { assetsHash: q?.assetsHash ?? null, found: !!q };
  } catch (e) {
    warnings.push("索引解析失败: " + (e as Error).message);
    return { assetsHash: null, found: false };
  }
}

/** 读取并校验声明对象（内容寻址：declHash 必须与重新序列化的 hash 一致）。 */
async function readDeclaration(remote: S3v3Remote, space: AssetBackfillSpace, id: string, declHash: string, warnings: string[]): Promise<AssetDeclaration | null> {
  const bytes = await remote.get(declarationKey(space, id, declHash));
  if (!bytes) { warnings.push("缺资产声明: " + id); return null; }
  try {
    const decl = validateAssetDeclaration(JSON.parse(new TextDecoder().decode(bytes)));
    if (declarationHashOf(decl) !== declHash) { warnings.push("资产声明 hash 不符: " + id); return null; }
    return decl;
  } catch (e) {
    warnings.push("资产声明非法: " + id + " " + (e as Error).message);
    return null;
  }
}

/**
 * 补拉某条（Lake 文档或小记）在云端声明、本地缺失/损坏的资产。
 * force=true：即使本地已有同内容也重新下（恢复流程要「强拉全量」时用）。
 */
export async function backfillV3Assets(
  remote: S3v3Remote,
  space: AssetBackfillSpace,
  id: string,
  port: AssetBackfillPort,
  opts: { concurrency?: number; force?: boolean } = {},
): Promise<AssetBackfillResult> {
  const result: AssetBackfillResult = { found: false, downloaded: 0, skipped: 0, warnings: [], missing: [], failed: [] };
  let declHash: string | null = null;
  let foundEntry = false;
  try {
    const resolved = await resolveAssetsHash(remote, space, id, result.warnings);
    declHash = resolved.assetsHash;
    foundEntry = resolved.found;
  } catch (e) {
    result.warnings.push("读取 v3 索引失败: " + (e as Error).message);
    return result;
  }
  if (!foundEntry || !declHash) return result; // 无声明 = 无需补拉（新条目/无资产/云端已彻底删除）
  result.found = true;
  const decl = await readDeclaration(remote, space, id, declHash, result.warnings);
  if (!decl) return result;

  let localNames: Set<string>;
  try { localNames = new Set(await port.listLocal(id)); } catch { localNames = new Set(); }
  // force 只覆盖「本地已有同内容」的跳过判定；缺失者无论如何都要拉。
  const need: AssetDeclaration["assets"] = [];
  for (const a of decl.assets) {
    if (!opts.force && localNames.has(a.filename)) {
      const have = await port.readLocal(id, a.filename).catch(() => null);
      if (have && have.length === a.size && sha256Hex(have) === a.hash) { result.skipped++; continue; }
    }
    need.push(a);
  }
  const limit = Math.max(1, Math.min(8, opts.concurrency ?? DEFAULT_BACKFILL_CONCURRENCY));
  const { errors } = await runPoolSettled(need, limit, async (a) => {
    const key = space === "lake" ? assetKey(id, a.filename) : quickNoteAssetKey(id, a.filename);
    const bytes = await remote.get(key);
    if (!bytes) { result.missing.push(a.filename); result.warnings.push("缺附件: " + id + "/" + a.filename); return; }
    if (bytes.length !== a.size || sha256Hex(bytes) !== a.hash) { result.failed.push(a.filename); result.warnings.push("附件校验失败: " + id + "/" + a.filename); return; }
    await port.writeLocal(id, a.filename, bytes);
    result.downloaded++;
  });
  for (const err of errors) {
    const a = need[err.index];
    if (a) result.failed.push(a.filename);
    result.warnings.push("附件下载异常: " + id + "/" + (a?.filename ?? "?") + " " + ((err.error as Error)?.message ?? String(err.error)));
  }
  return result;
}