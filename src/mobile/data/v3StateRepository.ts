import type { LakeIndex, QuickNotesIndex } from "../../core/s3v3/protocol/s3v3Index.js";
import type { DeletionIntent } from "../../core/s3v3Intent.js";
import type { PendingDelete } from "../../core/s3v3Gate.js";
import type { MobileDb } from "./sqliteDb.js";
import type { PendingAssetRetry } from "../../core/s3v3DeviceStore.js";
import { fromPersistedState, migratePersisted, type IntentLogStateV3, type IntentRecord } from "../../core/s3v3/state/intentLogState.js";

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
 * E3-1 phase1（261029）：sync_v3_state 的 json 列落盘 = core 的 v2 信封（`IntentLogStateV2`）
 * + 同一条 JSON 里的 `baseline`（「baseline 不动」：仍是 v3 基线账本，随本行持久化）。
 * 本模块负责「信封 ↔ MobileV3State」双向转换；bridge / 引擎 / 适配器继续读内存视图，字段语义不变。
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

export async function ensureV3StateTable(db: MobileDb): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS sync_v3_state (id TEXT PRIMARY KEY, json TEXT NOT NULL)").run();
}

/** 读原始落盘 JSON（未迁移；nil = 无行/坏行由调用方决定语义）。 */
export async function readRawV3State(db: MobileDb): Promise<unknown> {
  const row = await db.prepare("SELECT json FROM sync_v3_state WHERE id='state'").get() as { json?: string } | undefined;
  if (!row?.json) return null;
  try { return JSON.parse(row.json); } catch { return null; }
}

export async function loadV3State(db: MobileDb): Promise<MobileV3State> {
  const raw = await readRawV3State(db);
  if (raw === null) return { ...EMPTY_MOBILE_V3_STATE };
  const persisted = migratePersisted(raw);
  const ledger = fromPersistedState(raw);
  if (!persisted || !ledger) {
    // 未知版本/损坏的账本不应让同步中断（与旧口径一致：视为空账本；baseline 丢失由引擎按保守合并处理）。
    return { ...EMPTY_MOBILE_V3_STATE };
  }
  const baseline = (raw && typeof raw === "object" && "baseline" in raw)
    ? ((raw as { baseline?: MobileV3Baseline | null }).baseline ?? null)
    : null;
  return {
    baseline,
    intents: ledger.state.intents,
    pending: ledger.state.pending,
    remotePurged: ledger.state.remotePurged ?? [],
    restorePending: ledger.state.restorePending ?? [],
    quickPurgeTimes: ledger.state.quickPurgeTimes ?? {},
    // 旧移动端把两空间合并存一个 Map；v2 信封按空间分开 ⇒ 加载侧合并读，行为不变。
    assetsHash: { ...persisted.assets.lake, ...persisted.assets.quickNotes },
    pendingAssets: ledger.state.pendingAssets ?? [],
  };
}

/**
 * 写 v2 信封 + baseline（适配器 saveState 的唯一写入口；`persisted` 由 core toPersistedState 生成）。
 * baseline 与本行同 JSON 是既有约定（E3-1「baseline 不动」），不属于信封本身。
 */
export async function savePersistedV3State(db: MobileDb, persisted: IntentLogStateV3, baseline: MobileV3Baseline | null): Promise<void> {
  const json = JSON.stringify({ ...persisted, baseline });
  await db.prepare("INSERT INTO sync_v3_state (id, json) VALUES ('state', ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(json);
}

/**
 * 兼容写入口：调用方手里只有 MobileV3State（saveBaseline / persistSyncMarkers 等引擎记账路径）。
 * 信封里不在内存视图中的字段（quick.deletes / quick.purges / recovery.bodyPending / 小记资产投影）
 * 从现有落盘信封保留，避免「只为标 baseline 顺手把明细清空」。
 */
export async function saveV3State(db: MobileDb, state: MobileV3State): Promise<void> {
  const current = migratePersisted(await readRawV3State(db));
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
  await savePersistedV3State(db, persisted, state.baseline);
}

/** 清空本机 v3 同步账本（「从云端恢复」唯一前置）：只删本行，不碰正文/历史/资产/业务行。 */
export async function clearV3State(db: MobileDb): Promise<void> {
  await ensureV3StateTable(db);
  await db.prepare("DELETE FROM sync_v3_state").run();
}
