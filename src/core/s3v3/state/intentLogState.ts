/**
 * 同步状态持久化信封 v3 —— 类型化 IntentLog（E3-1 phase2a，261029）。
 *
 * phase1 的交卷是 v2：一个信封里仍是「9 组字段」（intents / pending / quick.* / restore.* /
 * cloudDeleted.* / recovery.*）。本批收敛成**一条 records 判别联合**：每一条「意图」自带 kind，
 * 落盘 = `{ version:3, records, assets, hashCache? }`；load 时投影回 DeviceState 的 9 个字段
 * （**引擎一行不改**，仍消费 DeviceState），save 时摊平。基线不在此文件（桌面 baseline.json.gz / 移动同 JSON 的 baseline 字段）。
 *
 * 断代门（用户 261028 / **261112 二次裁决 B：删除 v1/v2 迁移**）：
 * - v3 直读；未知 record kind → 丢弃该条并收 warning（不崩）。
 * - **v1/v2 信封与无 version 的旧 sidecar（含 MobileV3State）不再迁移**：读到旧形状 ⇒ **账本重置**为空 records，
 *   并收一次可读 warning（不崩、不阻断同步）。
 * - 重置时**保留资产投影与 hashCache**（见下「不走账本」一节）：把它们一起丢会让「未下载」被误判成
 *   「删光附件」⇒ 云端误 GC；hashCache 丢失则要全库重算 sha256。这不是兼容读取，只是同 JSON 里的安全投影。
 * - 非账本形状（null / 字符串 / 空对象）→ null（适配器按空账本处理）。
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
/**
 * 落盘账本（9 本 + 后续账）。`pendingTagDeletes` **不在账本里**：它是设备本地的标签删除抑制集合，
 * 由平台端口直接读写 DB 的 `device_state`（不上传、不进 v3 状态信封），所以不参与这里的穷尽性约束。
 */
export type DeviceLedger = Omit<DeviceState, "lake" | "quickNotes" | "folders" | "pendingTagDeletes" | "tagPendingSettled">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  // purges ∪ purgeTimes 的 id 并集：旧信封只有时间表，单看 quickPurges 会丢时间戳。
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

/**
 * 旧信封（v1/v2）里**必须抢救**的资产投影（Q23 重置账本时保留）：丢了会把「未下载」误判成
 * 「删光附件」⇒ 云端误 GC（见文件头）。v1 形状 = 合并的 assetsHash / quickAssetsHash；
 * v2 形状 = 按空间的 assets.lake / quickNotes。这不是兼容迁移，只取安全投影。
 */
function salvagedAssetsOf(raw: Record<string, unknown>): { lake: Record<string, string>; quickNotes: Record<string, string> } {
  if (isRecord(raw.assets)) return assetsOf(raw.assets);
  return { lake: recordOfStrings(raw.assetsHash), quickNotes: recordOfStrings(raw.quickAssetsHash) };
}

/** 是否「像一本同步账本」——用于区分「旧格式要重置」与「无关/损坏 JSON（→ null）」。 */
const LEDGER_KEYS = [
  "records", "intents", "pending", "quick", "restore", "cloudDeleted", "recovery",
  "assets", "hashCache", "quickDeletes", "quickPurges", "quickPurgeTimes", "remotePurged",
  "restorePending", "quickAssetsHash", "assetsHash", "pendingAssets",
] as const;

function looksLikeLedger(raw: Record<string, unknown>): boolean {
  if (typeof raw.version === "number") return true;
  return LEDGER_KEYS.some((key) => key in raw);
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
 * 任意落盘 JSON → v3 信封。
 * - **v3**：归一后直读（未知 record kind 丢弃 + warning，不崩）。
 * - **旧格式（v1/v2）或未知版本**：Q23（261112 用户裁决 B）起**不再迁移** ⇒ 账本重置（records 空），
 *   收一次可读 warning；资产投影与 hashCache 抢救保留（理由见文件头，避免云端误 GC / 全库重算）。
 * - **非账本形状**（null / 字符串 / 数字 / 空对象）：null（适配器按空账本处理）。
 */
export function migratePersisted(raw: unknown, onWarning?: (message: string) => void): IntentLogStateV3 | null {
  if (!isRecord(raw)) return null;
  if (raw.version === DEVICE_STATE_VERSION) {
    const hashCache = hashCacheOf(raw.hashCache);
    return {
      version: DEVICE_STATE_VERSION,
      records: normalizeRecords(raw.records, onWarning),
      assets: assetsOf(raw.assets),
      ...(hashCache ? { hashCache } : {}),
    };
  }
  if (!looksLikeLedger(raw)) return null;
  onWarning?.(
    "同步账本为旧格式（v1/v2）或未知版本：已按裁决重置为空账本（不再迁移；资产投影与 hash 缓存保留）",
  );
  const hashCache = hashCacheOf(raw.hashCache);
  return {
    version: DEVICE_STATE_VERSION,
    records: [],
    assets: salvagedAssetsOf(raw),
    ...(hashCache ? { hashCache } : {}),
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

/**
 * Q23（261112 裁决 B）：v1/v2 迁移已删除 ⇒ 已不存在「需要迁移」的落盘。
 * 保留导出只为既有调用点（`deviceStore.loadState` 的日志分支）不被打断，**恒 false**；新代码不要用。
 * 旧账本现在由 `migratePersisted` 直接重置（并给一条 warning），不再有「迁移一次」这回事。
 */
export function persistedNeedsMigration(_raw?: unknown): boolean {
  return false;
}

/** records → 9 本账（引擎继续消费 DeviceState；不动引擎）。 */
export function fromPersistedState(raw: unknown, onWarning?: (message: string) => void): { state: DeviceLedger; migrated: boolean } | null {
  const persisted = migratePersisted(raw, onWarning);
  if (!persisted) return null;
  // Q23：迁移已删 —— 「migrated」恒 false（字段保留只为既有调用点签名不变）。
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
