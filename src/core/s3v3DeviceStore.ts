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
  /** 远端已彻底删除、本地保留的回收站副本 id（Lake 文档 / 小记共用一张 id 表；不参与同步上传）。
   * 契约（261026 定稿，引擎侧唯一权威，适配器只做 DB 投影）：
   *  - 由引擎在「基线有条目、远端索引缺失」时写入并持久化（上一轮丢了 ⇒ 副本会被当本地新建重新上传）；
   *  - 失效三态：显式恢复（restorePending → 允许重新上传）、远端同 id 复活（跟随远端下载）、本地彻底删除；
   *  - 标记内的条目：发布索引与三方合并都看不到它 → 不上传、不复活，但本地副本保留可恢复。 */
  remotePurged?: string[];
  /** 本地显式恢复标记（唯一提前例外）。 */
  restorePending?: string[];
  /** 本地已软删/待传播的小记 ID（小记回收站墓碑）；用于区分“远端新增”与“本地删除”。 */
  quickDeletes?: string[];
  /** 本地已彻底删除的小记 ID（purged 墓碑；跨端传播不可恢复删除）。 */
  quickPurges?: string[];
  /** 本地小记彻底删除时间（id → purgedAt）；与他端恢复的 updatedAt 比较，避免本地 purge 被误判成远端恢复。 */
  quickPurgeTimes?: Record<string, string>;
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
  /** 批量读正文（可选；261026 续传提速）：一次调用读一批，减少移动端逐篇桥往返。
   *  返回顺序与 ids 一致；不支持时引擎回退逐篇 readBody。 */
  readBodies?(ids: string[]): Promise<Array<Uint8Array | null>>;
  /** 批量 stat 正文（可选；261026）：续传时先按 hash 比对，一致且文件存在就完全不用读内容。 */
  statBodies?(ids: string[]): Promise<Array<{ exists: boolean; size: number }>>;
  writeBody(id: string, bytes: Uint8Array): Promise<void>;
  deleteBody(id: string): Promise<void>;
  writeHistory(id: string, bytes: Uint8Array): Promise<string>;
  archiveBody(id: string, bytes: Uint8Array | null): Promise<void>;

  listAssets(id: string): Promise<string[]>;
  /** 本地资产「文件名→size/sha256」原生清单（可选，261026）：附件差集不必把字节读回 JS。
   *  不支持时（旧 APK/桌面）缺失或抛错 ⇒ 引擎回退 readAsset+sha256。 */
  listAssetStats?(id: string): Promise<Array<{ filename: string; size: number; hash: string }>>;
  listQuickAssetStats?(id: string): Promise<Array<{ filename: string; size: number; hash: string }>>;
  readAsset(id: string, filename: string): Promise<Uint8Array | null>;
  writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void>;
  deleteAssetsDir(id: string): Promise<void>;

  readQuickBody(id: string): Promise<Uint8Array | null>;
  readQuickBodies?(ids: string[]): Promise<Array<Uint8Array | null>>;
  statQuickBodies?(ids: string[]): Promise<Array<{ exists: boolean; size: number }>>;
  writeQuickBody(id: string, bytes: Uint8Array): Promise<void>;
  deleteQuickBody(id: string): Promise<void>;
  listQuickAssets(id: string): Promise<string[]>;
  readQuickAsset(id: string, filename: string): Promise<Uint8Array | null>;
  writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void>;
  deleteQuickAssetsDir(id: string): Promise<void>;

  /** 单条推送后的记账（可选）：仅当本地内容仍等于 expectedContentHash 时才标已同步（I2 守卫），
   *  并清掉显式恢复标记。未实现时引擎退回 saveState（整表投影，可能误清新条目的待同步角标）。 */
  markQuickNoteSynced?(id: string, expectedContentHash: string): Promise<void>;

  /** 资产在本机「原生资产根」下的相对路径（可选，P0-4）；不支持时返回 null ⇒ 走 JS 字节路径。
   *  移动端 = note-assets 根下的 `<id>/<filename>`（原生 AssetSync getFile/putFile 的 localKey 语义）；
   *  桌面端不实现（本机写盘已经很快，不需要绕过 JS）。 */
  assetNativePath?(id: string, filename: string): Promise<string | null>;

  /** 轻量持久化同步标记（可选）：单条推送等「不走整轮 saveState」的路径用它清理 remotePurged/restorePending，
   *  并同步 DB 侧投影（cloud_deleted），避免 sidecar/DB 残留已恢复 id 的「云端已删除·仅本地」标记。 */
  persistSyncMarkers?(markers: { remotePurged: string[]; restorePending: string[] }): Promise<void>;

  /** 小记冲突副本（可选，parity C8）：双端同改、远端胜出时把本地版本归档进小记回收站
   *  （旧协议 archiveLocalQuickNoteToTrash 语义：新 id、纯本地、恢复后是一条新小记）。
   *  未实现时退化为历史快照尝试（桌面）或不留副本（移动端产品定稿：小记无历史快照）。 */
  archiveQuickNote?(id: string): Promise<void>;
}
