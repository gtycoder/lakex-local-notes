import type { LakeIndex, QuickNotesIndex } from "./s3v3Index.js";
import type { DeletionIntent } from "./s3v3Intent.js";
import type { PendingDelete } from "./s3v3Gate.js";

/** S3 v3 设备端存储契约：引擎只依赖此接口，便于接入现有 Store / 移动端 SQLite。 */

export interface DeviceState {
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
  folders: LakeIndex["folders"];
  intents: DeletionIntent[];
  pending: PendingDelete[];
  /** 远端已彻底删除、本地保留的回收站副本（不参与同步上传）。 */
  remotePurged?: string[];
  /** 本地显式恢复标记（唯一提前例外）。 */
  restorePending?: string[];
  /** 本地已软删/待传播的小记 ID（小记回收站墓碑）；用于区分“远端新增”与“本地删除”。 */
  quickDeletes?: string[];
  /** 全量重拉/重置时归档的本地条目（不参与同步）。 */
  archived?: Array<{ id: string; kind: "lake" | "quickNote"; title?: string }>;
}

export interface DeviceBaseline {
  epoch: string;
  generation: number;
  lakeCommit: string;
  quickNotesCommit: string;
  lake: LakeIndex;
  quickNotes: QuickNotesIndex;
}

export interface S3v3DeviceStore {
  init(): Promise<void>;
  loadState(): Promise<DeviceState | null>;
  saveState(state: DeviceState): Promise<void>;
  loadBaseline(): Promise<DeviceBaseline | null>;
  saveBaseline(baseline: DeviceBaseline): Promise<void>;

  readBody(id: string): Promise<Uint8Array | null>;
  writeBody(id: string, bytes: Uint8Array): Promise<void>;
  deleteBody(id: string): Promise<void>;
  writeHistory(id: string, bytes: Uint8Array): Promise<string>;
  archiveBody(id: string, bytes: Uint8Array | null): Promise<void>;

  listAssets(id: string): Promise<string[]>;
  readAsset(id: string, filename: string): Promise<Uint8Array | null>;
  writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void>;
  deleteAssetsDir(id: string): Promise<void>;

  readQuickBody(id: string): Promise<Uint8Array | null>;
  writeQuickBody(id: string, bytes: Uint8Array): Promise<void>;
  deleteQuickBody(id: string): Promise<void>;
  listQuickAssets(id: string): Promise<string[]>;
  readQuickAsset(id: string, filename: string): Promise<Uint8Array | null>;
  writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void>;
  deleteQuickAssetsDir(id: string): Promise<void>;
}
