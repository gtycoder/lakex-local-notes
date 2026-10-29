import type { LakeIndex, QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import type { DeletionIntent } from "./s3v3Intent.js";
import type { PendingDelete } from "./s3v3Gate.js";

/**
 * S3 v3 设备端存储契约：引擎只依赖此接口，便于接入现有 Store / 移动端 SQLite。
 *
 * 端口分两类（261028 SD-06 契约化；完整矩阵与双端差异见 docs/SYNC-DEVICE-CONTRACT.md）：
 * - **必需**：引擎无条件调用。缺失/抛错 = 本轮同步失败，没有降级路径——
 *   init/loadState/saveState/loadBaseline/saveBaseline、readBody/writeBody/deleteBody/
 *   writeHistory/archiveBody、listAssets/readAsset/writeAsset/deleteAssetsDir、
 *   readQuickBody/writeQuickBody/deleteQuickBody、listQuickAssets/readQuickAsset/
 *   writeQuickAsset/deleteQuickAssetsDir。
 * - **可选**（接口里带 `?`）：缺失或抛错时引擎回退到慢路径，**只影响性能/体验，不改变同步语义**；
 *   每个可选端口的退化行为写在其自身注释里（下文 `【缺失退化】`）。
 *
 * 适配器必须满足的不变量（**单实现契约** defineDeviceContract 钉住：桌面/移动各 21 例 + mixed 3 例，E2-4 C-3c）：
 * 1. saveState/saveBaseline 是「引擎合并结果的投影」：不得自己重做 LWW/墓碑/恢复判定，
 *    必须把 state 原样落库（含 updatedAt、isLocked/lockedAt、assetsHash 等元数据）。
 * 2. 删除 = 缺席。同步路径只允许软删进回收站，**禁止**因为「本轮 state 里没有」而物理删正文/历史。
 * 3. remotePurged/restorePending/quickPurges/pendingAssets 由引擎写、适配器持久化并投影到 DB；
 *    适配器可以补充读取（restore_pending_at / cloud_deleted / deleted_notes），但不得改写语义。
 * 4. 资产声明是内容寻址的权威快照：本地资产目录为空 **不等于** 用户删光附件；上传侧由引擎
 *    「保留云端声明 + 自愈补拉」兜底（声明保留，见契约文档 §4）。
 */

/** 冲突留档保护窗口（天；B3/261026）：适配器写历史快照时落 protected_until，历史清理不会先清它。
 * 移动端 MobileDeviceStore 使用；桌面 v3 归档路径沿用 store.createHistorySnapshot 的既有行为（不传保护窗口）。
 * 原在 v2 同步引擎端口模块，D-7 收口时随设备存储契约迁到此处。 */
export const HISTORY_SNAPSHOT_PROTECT_DAYS = 30;

/** 待补资产账本条目（261027）：附件下载失败后落账，下一轮同步开头自动重试。 */
export interface PendingAssetRetry {
  space: "lake" | "quickNotes";
  /** 文档 / 小记 id（对象 key 由 space + id + filename 现算，不落 key 避免空间规则变更后失配）。 */
  id: string;
  filename: string;
  size: number;
  hash: string;
  /** 已失败轮数；超过上限即丢弃（声明里的对象可能已被清理，避免账本无限重试）。 */
  attempts: number;
}

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
  /** 缺正文恢复队列（事件驱动）：只在**真的观察到**正文缺失时写入（打开/资源页体检/读失败），
   *  正常增量同步不扫描、不产生额外 IO；引擎消费后清空。 */
  bodyRecoveryPending?: string[];
  /** 待补资产账本：附件下载失败后由引擎记录、下一轮同步开头自动重试（适配器只负责持久化）。 */
  pendingAssets?: PendingAssetRetry[];
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
   *  返回顺序与 ids 一致。【缺失退化】引擎按 100 篇一批回退逐篇 readBody。
   *  【异常退化】整批调用抛错时同样回退逐篇。 */
  readBodies?(ids: string[]): Promise<Array<Uint8Array | null>>;
  /** 批量 stat 正文（可选；261026）：续传时先按 hash 比对，一致且文件存在就完全不用读内容。
   *  【缺失/异常退化】返回 null ⇒ 引擎回退「批量读正文 + 逐条 sha256」。（不落盘、不改状态。） */
  statBodies?(ids: string[]): Promise<Array<{ exists: boolean; size: number }>>;
  writeBody(id: string, bytes: Uint8Array): Promise<void>;
  deleteBody(id: string): Promise<void>;
  writeHistory(id: string, bytes: Uint8Array): Promise<string>;
  archiveBody(id: string, bytes: Uint8Array | null): Promise<void>;

  listAssets(id: string): Promise<string[]>;
  /** 本地资产「文件名→size/sha256」原生清单（可选，261026）：附件差集不必把字节读回 JS。
   *  【缺失/异常退化】引擎回退 listAssets 取文件名 + readAsset 读字节 + JS sha256。
   *  【注意】不能「缺失就当没有资产」：清单为空会走引擎的声明保留判定，不得在这里删声明。 */
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
   *  并清掉显式恢复标记。【缺失退化】本轮不逐条清 dirty：等下一次整轮
   *  saveState/saveBaseline 收尾（桌面 saveQuickNotes 的 markSyncedIfUnchanged / 移动 saveBaseline），
   *  期间该条可能短暂保留「待同步」角标。绝不可以用「无条件清 dirty」代替。 */
  markQuickNoteSynced?(id: string, expectedContentHash: string): Promise<void>;

  /** 资产在本机「原生资产根」下的相对路径（可选，P0-4）；不支持时返回 null ⇒ 走 JS 字节路径。
   *  移动端 = note-assets 根下的 `<id>/<filename>`（原生 AssetSync getFile/putFile 的 localKey 语义）；
   *  桌面端不实现（本机写盘已经很快，不需要绕过 JS）。
   *  【缺失退化】引擎回退 readAsset/writeAsset 的字节路径；仅当 remote 也支持 getToFile/putFromFile
   *  时才启用原生流式，否则有路径也不生效。 */
  assetNativePath?(id: string, filename: string): Promise<string | null>;
  /** 同上，按空间返回（261027）：lake = note-assets/<id>/<file>，quickNotes = quick-notes/assets/<id>/<file>。
   *  供「所有附件上传走原生流式」使用（小记图片此前没有原生路径，只能字节过桥）。
   *  【优先级】assetNativePathFor 优先；它缺失时仅 lake 空间回退 assetNativePath；都缺 ⇒ 字节路径。 */
  assetNativePathFor?(space: "lake" | "quickNotes", id: string, filename: string): Promise<string | null>;

  /** 轻量持久化同步标记（可选）：单条推送等「不走整轮 saveState」的路径用它清理 remotePurged/restorePending，
   *  并同步 DB 侧投影（cloud_deleted），避免 sidecar/DB 残留已恢复 id 的「云端已删除·仅本地」标记。
   *  【缺失退化】引擎跳过该次落盘（推送本身仍成功），残留标记由下一轮整轮 saveState 清理；
   *  【异常退化】抛错只记 warning，不打断单条推送。 */
  persistSyncMarkers?(markers: { remotePurged: string[]; restorePending: string[] }): Promise<void>;

  /** 小记冲突副本（可选，parity C8）：双端同改、远端胜出时把本地版本归档进小记回收站
   *  （旧协议 archiveLocalQuickNoteToTrash 语义：新 id、纯本地、恢复后是一条新小记）。
   *  【缺失退化】引擎退化为 writeHistory("quick-"+id)；两端 v3 的 writeHistory 对小记都是 no-op
   *  ⇒ 实际效果 = 不留副本（移动端产品定稿：小记无历史快照）。两端现已都实现本端口。 */
  archiveQuickNote?(id: string): Promise<void>;
}
