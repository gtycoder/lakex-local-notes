import type { LakeIndex, QuickNotesIndex } from "../../core/s3v3/protocol/s3v3Index.js";
import type { DeletionIntent } from "../../core/s3v3Intent.js";
import type { PendingDelete } from "../../core/s3v3Gate.js";
import type { MobileDb } from "./sqliteDb.js";
import type { PendingAssetRetry } from "../../core/s3v3DeviceStore.js";
import { fromPersistedState, migratePersisted, type IntentLogStateV3, type IntentRecord } from "../../core/s3v3/state/intentLogState.js";
import { deleteBaselineFile, isPlausibleBaseline, readBaselineFile, writeBaselineFile } from "./v3BaselineFile.js";

/** 与 electron/s3v3/deviceStore 的 DeviceBaseline 结构一致；移动端不 import electron。 */
export interface MobileV3Baseline {
  epoch: string;
  generation: number;
  lakeCommit: string;
  quickNotesCommit: string;
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
}

/**
 * 移动端 v3 同步**内存视图**（落盘形状见下）。
 *
 * 261113（D1-C）：`sync_v3_state` 的 json 列只存 core 的 v2/v3 信封（intents/pending/assetsHash/标记），
 * **baseline 已搬到独立文件**（`sync-v3/baseline.json.gz.b64`，见 data/v3BaselineFile.ts；桌面同构
 * `sync-v3/baseline.json.gz`）。原因：baseline 是整行 JSON 里最大的一块（5000 文档 ≈2.28MB），
 * 随行读写每次都要整份过 Capacitor 桥（实测 129–207ms/次）；落文件后过桥只剩压缩字节。
 * 本模块负责「信封 ↔ MobileV3State」双向转换与 baseline 的读取优先级（文件 → 旧行内嵌 → 一次性迁移）。
 * 旧格式（无 version 的 MobileV3State JSON）加载时由 core migratePersisted 一次性迁移，下一次写即 v2。
 */
export interface MobileV3State {
  baseline: MobileV3Baseline | null;
  intents: DeletionIntent[];
  pending: PendingDelete[];
  remotePurged: string[];
  restorePending: string[];
  quickPurgeTimes?: Record<string, string>;
  assetsHash: Record<string, string>;
  /** 待补资产账本（261027）：附件下载失败后由引擎记账，下一轮同步开头重试。 */
  pendingAssets?: PendingAssetRetry[];
}

export const EMPTY_MOBILE_V3_STATE: MobileV3State = { baseline: null, intents: [], pending: [], remotePurged: [], restorePending: [], assetsHash: {}, quickPurgeTimes: {}, pendingAssets: [] };

/**
 * 基线丢失（文件损坏/被删，但本机**已有** v3 信封 = 曾同步过）。
 *
 * 为什么必须硬失败而不是「当作没有 baseline」：引擎对「pointer 存在 + 无基线」走全量重拉
 * （`syncPullAllRound`），移动端会把「本机有、云上没有」的**从未同步过的小记物理丢弃**
 * （`discardQuickNote`）。所以宁可这一轮同步失败并提示用户「从云端恢复」，也绝不把
 * 「基线缺失」当成「云端缺席 = 删除」。
 */
export class SyncBaselineLostError extends Error {
  readonly code = "baseline-lost";
  constructor() {
    super("移动端同步基线文件损坏或丢失；为避免误删本机数据，本次同步已中止。请到「设置 → 云同步 → 从云端恢复」以云端为准重建本机基线");
    this.name = "SyncBaselineLostError";
  }
}

export async function ensureV3StateTable(db: MobileDb): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS sync_v3_state (id TEXT PRIMARY KEY, json TEXT NOT NULL)").run();
}

/** 读原始落盘 JSON（未迁移；nil = 无行/坏行由调用方决定语义）。 */
export async function readRawV3State(db: MobileDb): Promise<unknown> {
  const row = await db.prepare("SELECT json FROM sync_v3_state WHERE id='state'").get() as { json?: string } | undefined;
  if (!row?.json) return null;
  try { return JSON.parse(row.json); } catch { return null; }
}

/** 旧落盘形状（D1-C 之前）里内嵌的 baseline（一次性迁移源）。 */
function legacyBaselineOf(raw: unknown): MobileV3Baseline | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = (raw as { baseline?: unknown }).baseline;
  return isPlausibleBaseline(candidate) ? candidate : null;
}

export type PersistedBaselineStatus = "file" | "migrated" | "absent" | "lost";

export interface PersistedBaselineResult {
  baseline: MobileV3Baseline | null;
  /** file = 文件正常；migrated = 旧行内嵌 → 已一次性迁移；absent = 从未有过基线；lost = 有过但文件坏了/丢了。 */
  status: PersistedBaselineStatus;
}

/**
 * baseline 读取优先级（唯一判据）：
 *  1. 文件正常 ⇒ 用文件（不读行——稳态下每次加载都是 1 次文件读 + 0 次行读）；
 *  2. 文件缺失/损坏，但旧行里还内嵌 baseline ⇒ **一次性迁移**：写出文件并返回行内值
 *     （写失败不阻断，下次加载再试；行内字段会在下一次信封写入时剔除）；
 *  3. 都没有：从未持久化过（无行/认不出的旧格式）⇒ absent；
 *     认得的 v3 信封却没有基线文件 ⇒ lost（同步路径必须硬失败，见 SyncBaselineLostError）。
 */
export async function readPersistedBaseline(db: MobileDb, opts: { raw?: unknown; baselineFile?: string } = {}): Promise<PersistedBaselineResult> {
  const file = await readBaselineFile(opts.baselineFile);
  if (file.status === "ok") return { baseline: file.baseline, status: "file" };
  let raw = opts.raw;
  if (!("raw" in opts)) raw = await readRawV3State(db);
  const legacy = legacyBaselineOf(raw);
  if (legacy) {
    try { await writeBaselineFile(legacy, opts.baselineFile); }
    catch (error) { console.warn("[v3] baseline 一次性迁移写文件失败（下次加载再试）: " + (error instanceof Error ? error.message : String(error))); }
    return { baseline: legacy, status: "migrated" };
  }
  const knownEnvelope = migratePersisted(raw) !== null;
  return { baseline: null, status: knownEnvelope ? "lost" : "absent" };
}

/** 同步路径（引擎 / 单条快路径）专用：基线丢失 ⇒ 抛 SyncBaselineLostError，绝不静默降级成「无基线」。 */
export async function loadSyncBaseline(db: MobileDb, baselineFile?: string): Promise<MobileV3Baseline | null> {
  const persisted = await readPersistedBaseline(db, { baselineFile });
  if (persisted.status === "lost") throw new SyncBaselineLostError();
  return persisted.baseline;
}

export async function loadV3State(db: MobileDb, baselineFile?: string): Promise<MobileV3State> {
  return (await loadV3StateWithRaw(db, baselineFile)).state;
}

/**
 * 同 loadV3State，但同时回传落盘原始信封（261113 D1）：需要「读信封 → 写信封」的调用方
 * （persistSyncMarkers 等）可把 raw 传给 saveV3State，省掉它内部的第二次整行读。
 * 261113 D1-C 后信封行已不含 baseline（只剩几 KB 的账本记录），这条优化退化为毫秒级。
 */
export async function loadV3StateWithRaw(db: MobileDb, baselineFile?: string): Promise<{ state: MobileV3State; raw: unknown }> {
  const raw = await readRawV3State(db);
  if (raw === null) return { state: { ...EMPTY_MOBILE_V3_STATE }, raw: null };
  const persisted = migratePersisted(raw);
  const ledger = fromPersistedState(raw);
  if (!persisted || !ledger) {
    // 未知版本/损坏的账本不应让同步中断（与旧口径一致：视为空账本；baseline 丢失由引擎按保守合并处理）。
    // 但基线本身能救则救（旧行内嵌字段）。
    const { baseline } = await readPersistedBaseline(db, { raw, baselineFile });
    return { state: { ...EMPTY_MOBILE_V3_STATE, baseline }, raw };
  }
  const { baseline } = await readPersistedBaseline(db, { raw, baselineFile });
  return {
    raw,
    state: {
      baseline,
      intents: ledger.state.intents,
      pending: ledger.state.pending,
      remotePurged: ledger.state.remotePurged ?? [],
      restorePending: ledger.state.restorePending ?? [],
      quickPurgeTimes: ledger.state.quickPurgeTimes ?? {},
      // 旧移动端把两空间合并存一个 Map；v2 信封按空间分开 ⇒ 加载侧合并读，行为不变。
      assetsHash: { ...persisted.assets.lake, ...persisted.assets.quickNotes },
      pendingAssets: ledger.state.pendingAssets ?? [],
    },
  };
}

/**
 * 写 v2/v3 信封（不含 baseline）：core 的 saveState 落盘唯一入口（`persisted` 由 core toPersistedState 生成）。
 * baseline 由 saveBaseline / saveV3State 负责落文件（261113 D1-C：行里不再内嵌基线）。
 */
export async function savePersistedV3State(db: MobileDb, persisted: IntentLogStateV3): Promise<void> {
  const json = JSON.stringify(persisted);
  await db.prepare("INSERT INTO sync_v3_state (id, json) VALUES ('state', ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(json);
}

/**
 * 兼容写入口：调用方手里只有 MobileV3State（persistSyncMarkers / 便携包导入 / 测试等记账路径）。
 * 信封里不在内存视图中的字段（quick.deletes / quick.purges / recovery.bodyPending / 小记资产投影）
 * 从现有落盘信封保留，避免「只为标 baseline 顺手把明细清空」。
 * baseline 按传入值落**文件**（null ⇒ 删文件，防止覆盖导入后残留旧基线）。
 */
export async function saveV3State(db: MobileDb, state: MobileV3State, currentRaw?: unknown, baselineFile?: string): Promise<void> {
  // 261113（D1）：调用方已读过落盘信封时传 currentRaw，省掉这次整行读（未传则按旧行为自读）。
  const current = migratePersisted(currentRaw === undefined ? await readRawV3State(db) : currentRaw);
  // 内存视图里没有的明细（quick-delete / quick-purge / body-recovery）从现有 v3 信封原样保留。
  const carried = (current?.records ?? []).filter((r) => r.kind === "quick-delete" || r.kind === "quick-purge" || r.kind === "body-recovery");
  const records: IntentRecord[] = [
    ...state.intents.map((it): IntentRecord => ({
      kind: "delete-intent", noteId: it.noteId, targetEpoch: it.targetEpoch, targetGeneration: it.targetGeneration,
      ...(it.purgedAt ? { purgedAt: it.purgedAt } : {}),
    })),
    ...state.pending.map((payload): IntentRecord => ({ kind: "pending-delete", payload })),
    ...state.remotePurged.map((id): IntentRecord => ({ kind: "cloud-deleted", id })),
    ...state.restorePending.map((noteId): IntentRecord => ({ kind: "restore", noteId })),
    ...(state.pendingAssets ?? []).map((payload): IntentRecord => ({ kind: "asset-retry", payload })),
    ...carried,
  ];
  // quickPurgeTimes 里未落在 carried quick-purge 的时间戳补成 quick-purge 记录（时间戳保真）。
  const carriedPurgeIds = new Set(carried.filter((r) => r.kind === "quick-purge").map((r) => (r as { id: string }).id));
  for (const [id, at] of Object.entries(state.quickPurgeTimes ?? {})) {
    if (!carriedPurgeIds.has(id)) records.push({ kind: "quick-purge", id, at });
  }
  // 内存视图只有一个合并 Map（移动端历史形状）⇒ 写回文档空间；小记投影沿用现有信封。
  const persisted: IntentLogStateV3 = {
    version: 3,
    records,
    assets: { lake: state.assetsHash, quickNotes: current?.assets.quickNotes ?? {} },
    ...(current?.hashCache ? { hashCache: current.hashCache } : {}),
  };
  await savePersistedV3State(db, persisted);
  // 基线落文件（行里已不再内嵌）；null ⇒ 删文件（「从云端恢复」/纯离线导入后不得留旧基线）。
  if (state.baseline) await writeBaselineFile(state.baseline, baselineFile);
  else await deleteBaselineFile(baselineFile);
}

/** 清空本机 v3 同步账本（「从云端恢复」唯一前置）：删信封行 + baseline 文件，不碰正文/历史/资产/业务行。 */
export async function clearV3State(db: MobileDb, baselineFile?: string): Promise<void> {
  await ensureV3StateTable(db);
  await db.prepare("DELETE FROM sync_v3_state").run();
  await deleteBaselineFile(baselineFile);
}
