/**
 * 同步状态持久化信封 v3 —— 类型化 IntentLog（E3-1 phase2a，261029）。
 *
 * phase1 的交卷是 v2：一个信封里仍是「9 组字段」（intents / pending / quick.* / restore.* /
 * cloudDeleted.* / recovery.*）。本批收敛成**一条 records 判别联合**：每一条「意图」自带 kind，
 * 落盘 = `{ version:3, records, assets, hashCache? }`；load 时投影回 DeviceState 的 9 个字段
 * （**引擎一行不改**，仍消费 DeviceState），save 时摊平。基线不在此文件（桌面 baseline.json.gz / 移动同 JSON 的 baseline 字段）。
 *
 * 断代门（用户已裁）：v3 客户端只写 v3；
 * - v3 直读；
 * - v2 信封与 v1 旧格式（无 version 的 sidecar / MobileV3State）**单向迁移**到 v3（只此一次）；
 * - 未知 version → null（适配器按空账本/重来）；未知 record kind → 丢弃该条并收 warning（不崩）。
 *
 * 不走账本、但必须随信封持久化的两类数据：
 * - `assets`：最后一次声明过的资产 hash 投影（丢了会把「未下载」误判为「删光附件」→ 云端误 GC）；
 * - `hashCache`（可选，桌面适配器私有）：正文 mtime+size→sha256，跨重启复用避免全库重算。
 */
import type { DeviceState, PendingAssetRetry } from "../../s3v3DeviceStore.js";
import type { PendingDelete } from "../../s3v3Gate.js";

/** 持久化信封版本（v3 一次到位，不做双写）。 */
export const DEVICE_STATE_VERSION = 3 as const;

/** 桌面 hash 缓存条目（适配器私有；引擎不读）。 */
export interface PersistedHashCacheEntry {
  mtimeMs: number;
  size: number;
  hash: string;
}

/**
 * 一条「意图」记录（判别联合）。字段语义严格沿用 v2 的同名字段，只换承载形状：
 * | record.kind | 来自 v2 字段 |
 * | --- | --- |
 * | delete-intent | intents[] |
 * | pending-delete | pending[]（payload 原样，含 noteId/key 等） |
 * | quick-delete | quick.deletes |
 * | quick-purge（at = 原 quickPurgeTimes[id]） | quick.purges + quick.purgeTimes |
 * | cloud-deleted | cloudDeleted.ids |
 * | restore | restore.pending（noteId 含 Lake 文档与小记 id） |
 * | body-recovery | recovery.bodyPending |
 * | asset-retry | recovery.assetRetries（payload 原样） |
 */
export type IntentRecord =
  | { kind: "delete-intent"; noteId: string; targetEpoch: string; targetGeneration: number; purgedAt?: string }
  | { kind: "pending-delete"; payload: PendingDelete }
  | { kind: "quick-delete"; id: string }
  | { kind: "quick-purge"; id: string; at?: string }
  | { kind: "cloud-deleted"; id: string }
  | { kind: "restore"; noteId: string }
  | { kind: "body-recovery"; id: string }
  | { kind: "asset-retry"; payload: PendingAssetRetry };

/** 落盘信封（唯一形态）。 */
export interface IntentLogStateV3 {
  version: typeof DEVICE_STATE_VERSION;
  records: IntentRecord[];
  assets: { lake: Record<string, string>; quickNotes: Record<string, string> };
  hashCache?: Record<string, PersistedHashCacheEntry>;
}

/** 9 本账 = DeviceState 去掉 world（lake/quickNotes/folders）。 */
export type DeviceLedger = Omit<DeviceState, "lake" | "quickNotes" | "folders">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

function hashCacheOf(value: unknown): Record<string, PersistedHashCacheEntry> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, PersistedHashCacheEntry> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isRecord(v)) continue;
    const { mtimeMs, size, hash } = v;
    if (typeof mtimeMs === "number" && typeof size === "number" && typeof hash === "string") out[k] = { mtimeMs, size, hash };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function assetsOf(raw: unknown): { lake: Record<string, string>; quickNotes: Record<string, string> } {
  const assets = isRecord(raw) ? raw : {};
  return { lake: recordOfStrings(assets.lake), quickNotes: recordOfStrings(assets.quickNotes) };
}

function assetsHashOf(entries: ReadonlyArray<{ id: string; assetsHash?: string }> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries ?? []) if (entry.assetsHash) out[entry.id] = entry.assetsHash;
  return out;
}

/** 内存 DeviceState → v3 信封（摊平：9 字段 → records；唯一写出形态）。 */
export function toPersistedState(state: DeviceState): IntentLogStateV3 {
  const records: IntentRecord[] = [];
  for (const intent of state.intents ?? []) {
    records.push({
      kind: "delete-intent", noteId: intent.noteId, targetEpoch: intent.targetEpoch, targetGeneration: intent.targetGeneration,
      ...(intent.purgedAt ? { purgedAt: intent.purgedAt } : {}),
    });
  }
  for (const payload of state.pending ?? []) records.push({ kind: "pending-delete", payload });
  for (const id of state.quickDeletes ?? []) records.push({ kind: "quick-delete", id });
  // purges ∪ purgeTimes 的 id 并集：与 v2→v3 迁移同口径（旧信封只有时间表，单看 quickPurges 会丢时间戳）。
  const purgeTimes = state.quickPurgeTimes ?? {};
  for (const id of new Set([...(state.quickPurges ?? []), ...Object.keys(purgeTimes)])) {
    records.push({ kind: "quick-purge", id, ...(purgeTimes[id] ? { at: purgeTimes[id] } : {}) });
  }
  for (const id of state.remotePurged ?? []) records.push({ kind: "cloud-deleted", id });
  for (const noteId of state.restorePending ?? []) records.push({ kind: "restore", noteId });
  for (const id of state.bodyRecoveryPending ?? []) records.push({ kind: "body-recovery", id });
  for (const payload of state.pendingAssets ?? []) records.push({ kind: "asset-retry", payload });
  return {
    version: DEVICE_STATE_VERSION,
    records,
    assets: { lake: assetsHashOf(state.lake.notes), quickNotes: assetsHashOf(state.quickNotes.items) },
  };
}

/** v2 信封（phase1 形状）→ records。 */
function recordsFromV2(raw: Record<string, unknown>, onWarning?: (message: string) => void): IntentRecord[] {
  const records: IntentRecord[] = [];
  const quick = isRecord(raw.quick) ? raw.quick : {};
  const restore = isRecord(raw.restore) ? raw.restore : {};
  const cloudDeleted = isRecord(raw.cloudDeleted) ? raw.cloudDeleted : {};
  const recovery = isRecord(raw.recovery) ? raw.recovery : {};
  if (Array.isArray(raw.intents)) {
    for (const value of raw.intents) {
      const it = isRecord(value) ? value : null;
      if (!it || typeof it.noteId !== "string") { onWarning?.("v3 迁移：丢弃非法 delete-intent"); continue; }
      records.push({
        kind: "delete-intent", noteId: it.noteId,
        targetEpoch: typeof it.targetEpoch === "string" ? it.targetEpoch : "",
        targetGeneration: typeof it.targetGeneration === "number" ? it.targetGeneration : 0,
        ...(typeof it.purgedAt === "string" ? { purgedAt: it.purgedAt } : {}),
      });
    }
  }
  if (Array.isArray(raw.pending)) for (const value of raw.pending) if (isRecord(value)) records.push({ kind: "pending-delete", payload: value as unknown as PendingDelete });
  const purgeTimes = recordOfStrings(quick.purgeTimes);
  for (const id of strings(quick.deletes)) records.push({ kind: "quick-delete", id });
  // purges ∪ purgeTimes 的 id 并集：保住 v1/v2 里独立记录的清理时间戳（旧桌面 quickPurges 是 DB 派生，信封只有时间表）。
  for (const id of new Set([...strings(quick.purges), ...Object.keys(purgeTimes)])) {
    records.push({ kind: "quick-purge", id, ...(purgeTimes[id] ? { at: purgeTimes[id] } : {}) });
  }
  for (const id of strings(cloudDeleted.ids)) records.push({ kind: "cloud-deleted", id });
  for (const noteId of strings(restore.pending)) records.push({ kind: "restore", noteId });
  for (const id of strings(recovery.bodyPending)) records.push({ kind: "body-recovery", id });
  if (Array.isArray(recovery.assetRetries)) for (const value of recovery.assetRetries) if (isRecord(value)) records.push({ kind: "asset-retry", payload: value as unknown as PendingAssetRetry });
  return records;
}

/** v1 旧格式（无 version 的 sidecar / MobileV3State）→ v2 形状（phase1 迁移规则原样复用）。 */
function legacyToV2(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 2,
    intents: raw.intents,
    pending: raw.pending,
    quick: { deletes: raw.quickDeletes, purges: raw.quickPurges, purgeTimes: raw.quickPurgeTimes },
    restore: { pending: raw.restorePending },
    cloudDeleted: { ids: raw.remotePurged },
    recovery: { bodyPending: raw.bodyRecoveryPending, assetRetries: raw.pendingAssets },
    assets: { lake: raw.assetsHash, quickNotes: raw.quickAssetsHash },
    hashCache: raw.hashCache,
  };
}

function isLegacyShape(raw: Record<string, unknown>): boolean {
  return ["intents", "pending", "remotePurged", "restorePending", "quickPurgeTimes", "pendingAssets", "assetsHash", "quickAssetsHash", "baseline"]
    .some((key) => key in raw);
}

/** v3 records 校验/归一：未知 kind 丢弃 + warning（断代门：不猜测旧 kind）。 */
function normalizeRecords(value: unknown, onWarning?: (message: string) => void): IntentRecord[] {
  if (!Array.isArray(value)) return [];
  const out: IntentRecord[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.kind !== "string") { onWarning?.("v3 信封：丢弃非法 record（非对象/缺 kind）"); continue; }
    switch (item.kind) {
      case "delete-intent":
        if (typeof item.noteId !== "string") { onWarning?.("v3 信封：丢弃非法 delete-intent"); continue; }
        out.push({
          kind: "delete-intent", noteId: item.noteId,
          targetEpoch: typeof item.targetEpoch === "string" ? item.targetEpoch : "",
          targetGeneration: typeof item.targetGeneration === "number" ? item.targetGeneration : 0,
          ...(typeof item.purgedAt === "string" ? { purgedAt: item.purgedAt } : {}),
        });
        break;
      case "pending-delete":
        if (!isRecord(item.payload)) { onWarning?.("v3 信封：丢弃非法 pending-delete"); continue; }
        out.push({ kind: "pending-delete", payload: item.payload as unknown as PendingDelete });
        break;
      case "quick-delete":
        if (typeof item.id !== "string") { onWarning?.("v3 信封：丢弃非法 quick-delete"); continue; }
        out.push({ kind: "quick-delete", id: item.id });
        break;
      case "quick-purge":
        if (typeof item.id !== "string") { onWarning?.("v3 信封：丢弃非法 quick-purge"); continue; }
        out.push({ kind: "quick-purge", id: item.id, ...(typeof item.at === "string" ? { at: item.at } : {}) });
        break;
      case "cloud-deleted":
        if (typeof item.id !== "string") { onWarning?.("v3 信封：丢弃非法 cloud-deleted"); continue; }
        out.push({ kind: "cloud-deleted", id: item.id });
        break;
      case "restore":
        if (typeof item.noteId !== "string") { onWarning?.("v3 信封：丢弃非法 restore"); continue; }
        out.push({ kind: "restore", noteId: item.noteId });
        break;
      case "body-recovery":
        if (typeof item.id !== "string") { onWarning?.("v3 信封：丢弃非法 body-recovery"); continue; }
        out.push({ kind: "body-recovery", id: item.id });
        break;
      case "asset-retry":
        if (!isRecord(item.payload)) { onWarning?.("v3 信封：丢弃非法 asset-retry"); continue; }
        out.push({ kind: "asset-retry", payload: item.payload as unknown as PendingAssetRetry });
        break;
      default:
        onWarning?.("v3 信封：丢弃未知 record kind " + item.kind);
    }
  }
  return out;
}

/**
 * 任意落盘 JSON → v3 信封（v2/v1 单向迁移；未知 version/损坏 → null；未知 record kind 丢弃+warning）。
 * 迁移只发生一次：返回 v3 后由 fromPersistedState 标记 migrated，适配器下一轮 save 落 v3。
 */
export function migratePersisted(raw: unknown, onWarning?: (message: string) => void): IntentLogStateV3 | null {
  if (!isRecord(raw)) return null;
  if (raw.version === DEVICE_STATE_VERSION) {
    return {
      version: DEVICE_STATE_VERSION,
      records: normalizeRecords(raw.records, onWarning),
      assets: assetsOf(raw.assets),
      ...(hashCacheOf(raw.hashCache) ? { hashCache: hashCacheOf(raw.hashCache) } : {}),
    };
  }
  if (typeof raw.version === "number") {
    if (raw.version !== 2) return null; // 未知版本（含未来 4）：不猜、不降级
    return {
      version: DEVICE_STATE_VERSION,
      records: recordsFromV2(raw, onWarning),
      assets: assetsOf(raw.assets),
      ...(hashCacheOf(raw.hashCache) ? { hashCache: hashCacheOf(raw.hashCache) } : {}),
    };
  }
  if (!isLegacyShape(raw)) return null;
  const v2 = legacyToV2(raw);
  return {
    version: DEVICE_STATE_VERSION,
    records: recordsFromV2(v2, onWarning),
    assets: { lake: recordOfStrings(raw.assetsHash), quickNotes: recordOfStrings(raw.quickAssetsHash) },
    ...(hashCacheOf(raw.hashCache) ? { hashCache: hashCacheOf(raw.hashCache) } : {}),
  };
}

/** 已迁移信封 → 9 本账投影（纯函数）。loadState 自己迁移一次后直接用它，别再 migrate 第二遍。 */
export function ledgerOf(persisted: IntentLogStateV3): DeviceLedger {
  const state: DeviceLedger = {
    intents: [], pending: [], remotePurged: [], restorePending: [],
    quickDeletes: [], quickPurges: [], quickPurgeTimes: {}, bodyRecoveryPending: [], pendingAssets: [],
  };
  for (const record of persisted.records) {
    switch (record.kind) {
      case "delete-intent":
        state.intents.push({
          noteId: record.noteId, targetEpoch: record.targetEpoch, targetGeneration: record.targetGeneration,
          ...(record.purgedAt ? { purgedAt: record.purgedAt } : {}),
        });
        break;
      case "pending-delete": state.pending.push(record.payload); break;
      case "quick-delete": state.quickDeletes!.push(record.id); break;
      case "quick-purge":
        state.quickPurges!.push(record.id);
        if (record.at) state.quickPurgeTimes![record.id] = record.at;
        break;
      case "cloud-deleted": state.remotePurged!.push(record.id); break;
      case "restore": state.restorePending!.push(record.noteId); break;
      case "body-recovery": state.bodyRecoveryPending!.push(record.id); break;
      case "asset-retry": state.pendingAssets!.push(record.payload); break;
    }
  }
  return state;
}

/** 落盘 JSON 是否是旧格式（v1/v2）：v3 客户端直读，其余走单向迁移。 */
export function persistedNeedsMigration(raw: unknown): boolean {
  return !(isRecord(raw) && raw.version === DEVICE_STATE_VERSION);
}

/** records → 9 本账（引擎继续消费 DeviceState；不动引擎）。 */
export function fromPersistedState(raw: unknown, onWarning?: (message: string) => void): { state: DeviceLedger; migrated: boolean } | null {
  const persisted = migratePersisted(raw, onWarning);
  if (!persisted) return null;
  return { state: ledgerOf(persisted), migrated: persistedNeedsMigration(raw) };
}

/** 把 v3 引擎的轻量标记并入信封（persistSyncMarkers 用）：替换 cloud-deleted/restore 两类记录，其余原样。 */
export function mergeSyncMarkers(
  persisted: IntentLogStateV3,
  markers: { remotePurged: readonly string[]; restorePending: readonly string[] },
): IntentLogStateV3 {
  const kept = persisted.records.filter((r) => r.kind !== "cloud-deleted" && r.kind !== "restore");
  return {
    ...persisted,
    records: [
      ...kept,
      ...markers.remotePurged.map((id): IntentRecord => ({ kind: "cloud-deleted", id })),
      ...markers.restorePending.map((noteId): IntentRecord => ({ kind: "restore", noteId })),
    ],
  };
}
