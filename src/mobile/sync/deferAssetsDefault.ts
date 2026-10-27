/**
 * 「按需下载附件」默认值解析（261027 评估结论）。
 *
 * 背景：按需资产对**新设备首拉**收益最大（实测移动端首拉 364–384s → 96s，约 4 倍），
 * 但老设备习惯「全量离线可用」，直接翻默认会让人以为图片丢了。所以规则是：
 *  - 用户存过同步设置 ⇒ 以用户值为准（不迁移、不打扰）；
 *  - 没存过 + 本机已有 v3 账本（baseline / 资产哈希）⇒ 老设备，维持 false（行为不变）；
 *  - 没存过 + 账本为空 ⇒ **全新设备**（本机从未同步过），默认开，并固化进设置，
 *    避免出现「首次按需、下一次同步又全量下载」的抖动。
 */
import type { MobileDb } from "../data/sqliteDb.js";
import { loadV3State, type MobileV3State } from "../data/v3StateRepository.js";
import { hasStoredSyncSettings, readSyncSettings } from "../bridge/context";

/** 本机是否从未参与过 v3 同步（账本为空 = baseline 为空且没有任何资产哈希）。 */
export function isFreshDeviceState(state: Pick<MobileV3State, "baseline" | "assetsHash">): boolean {
  if (state.baseline !== null) return false;
  return Object.keys(state.assetsHash ?? {}).length === 0;
}

export interface DeferAssetsResolution {
  /** 本轮同步是否按需下载附件。 */
  deferAssets: boolean;
  /** 是否由「新设备默认」得出（调用方应把它固化进设置，避免下一轮漂移）。 */
  defaulted: boolean;
}

/** 解析本轮同步的按需资产开关（纯判定，不写设置）。 */
export async function resolveDeferAssets(db: MobileDb): Promise<DeferAssetsResolution> {
  if (hasStoredSyncSettings()) return { deferAssets: readSyncSettings().deferAssets === true, defaulted: false };
  const state = await loadV3State(db);
  if (!isFreshDeviceState(state)) return { deferAssets: false, defaulted: false };
  return { deferAssets: true, defaulted: true };
}
