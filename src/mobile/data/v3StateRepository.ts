import type { LakeIndex, QuickNotesIndex } from "../../core/s3v3Index.js";
import type { DeletionIntent } from "../../core/s3v3Intent.js";
import type { PendingDelete } from "../../core/s3v3Gate.js";
import type { MobileDb } from "./sqliteDb.js";

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
 * 移动端 v3 同步专属状态（baseline / intents / pending / remotePurged / restorePending / assetsHash）。
 * 元数据与正文仍以 notes 表 + BodyStore 为准；此表只存“同步账本”。
 * 表名/JSON 列在正式接入时随 MOBILE_SCHEMA_VERSION 一起迁移；本仓库函数先提供读写与建表能力。
 */

export interface MobileV3State {
  baseline: MobileV3Baseline | null;
  intents: DeletionIntent[];
  pending: PendingDelete[];
  remotePurged: string[];
  restorePending: string[];
  assetsHash: Record<string, string>;
}

export const EMPTY_MOBILE_V3_STATE: MobileV3State = { baseline: null, intents: [], pending: [], remotePurged: [], restorePending: [], assetsHash: {} };

export async function ensureV3StateTable(db: MobileDb): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS sync_v3_state (id TEXT PRIMARY KEY, json TEXT NOT NULL)").run();
}

export async function loadV3State(db: MobileDb): Promise<MobileV3State> {
  const row = await db.prepare("SELECT json FROM sync_v3_state WHERE id='state'").get() as { json?: string } | undefined;
  if (!row?.json) return { ...EMPTY_MOBILE_V3_STATE };
  try {
    const parsed = JSON.parse(row.json) as Partial<MobileV3State>;
    return {
      baseline: parsed.baseline ?? null,
      intents: Array.isArray(parsed.intents) ? parsed.intents : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      remotePurged: Array.isArray(parsed.remotePurged) ? parsed.remotePurged : [],
      restorePending: Array.isArray(parsed.restorePending) ? parsed.restorePending : [],
      assetsHash: parsed.assetsHash && typeof parsed.assetsHash === "object" ? parsed.assetsHash : {},
    };
  } catch {
    // 损坏的账本不应让同步中断：视为空账本（baseline 丢失会触发更保守的合并，由引擎决定）。
    return { ...EMPTY_MOBILE_V3_STATE };
  }
}

export async function saveV3State(db: MobileDb, state: MobileV3State): Promise<void> {
  const json = JSON.stringify(state);
  await db.prepare("INSERT INTO sync_v3_state (id, json) VALUES ('state', ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(json);
}
