/**
 * 「保存并同步」（只推当前这一条小记）独立管线的**窄接口**（261110）。
 *
 * 设计目标：
 *  1. 不进整轮 plan/apply/三方合并/lake 索引/意图账本 —— 只做 quick-notes 空间的单条 upsert；
 *  2. 只暴露它真正用到的原语（remote 的 get/put/deleteMany、发布锁、quick 索引 parse/serialize、
 *     pointer 校验/写、设备：读本条同步行/读 baseline/读正文/资产清点/标同步/写 baseline/落标记）；
 *  3. 引擎 `S3v3SyncEngine.pushQuickNote` 只是薄委托（一份实现），两端适配层也可直接调用。
 *
 * 谁实现：桌面/移动的 DeviceStore 适配器 + S3v3Remote（或测试替身）。
 */
import type { AssetDeclaration } from "../protocol/s3v3Index.js";
import type { DeviceBaseline, QuickPushState } from "../../s3v3DeviceStore.js";

/** 单条推送需要的远端最小面（不暴露 list —— 快路径不做任何列举）。 */
export interface QuickPushRemote {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  /** 原生流式上传（可选；移动端小记资产走字节过桥，桌面走字节路径）。 */
  putFromFile?(key: string, localPath: string, opts?: { gzip?: boolean }): Promise<boolean>;
}

/** 单条推送需要的设备最小面。 */
export interface QuickPushDevice {
  loadBaseline(): Promise<DeviceBaseline | null>;
  /** 轻量状态（只读本条小记 + 标记）。缺失/抛错时回退 `loadState`。 */
  loadQuickPushState?(id: string): Promise<QuickPushState | null>;
  /** 回退用（端口没有 loadQuickPushState 时）。 */
  loadState?(): Promise<import("../../s3v3DeviceStore.js").DeviceState | null>;
  readQuickBody(id: string): Promise<Uint8Array | null>;
  markQuickNoteSynced?(id: string, expectedContentHash: string): Promise<void>;
  saveBaseline(baseline: DeviceBaseline): Promise<void>;
  persistSyncMarkers?(markers: { remotePurged: string[]; restorePending: string[] }): Promise<void>;
  /** 小记资产清点/读取（有图片的小记要上传）。 */
  listQuickAssetStats?(id: string): Promise<Array<{ filename: string; size: number; hash: string }>>;
  listQuickAssets(id: string): Promise<string[]>;
  readQuickAsset(id: string, filename: string): Promise<Uint8Array | null>;
  assetNativePathFor?(space: "lake" | "quickNotes", id: string, filename: string): Promise<string | null>;
}

/** 单条推送结果（与既有 `QuickNotePushResult` 同形；full-sync = 调用方必须整轮，不静默降级）。 */
export type QuickPushResult =
  | { status: "pushed"; uploadedContent: boolean; uploadedAssets: number; unchanged: boolean; generation: number }
  | { status: "full-sync"; reason: "no-cloud" | "no-baseline" | "cloud-changed" | "remote-deleted" }
  | { status: "not-found" };

export interface QuickPushDeps {
  remote: QuickPushRemote;
  device: QuickPushDevice;
  deviceId: string;
  /** 时钟注入（测试对拍/可复现）。 */
  now?: () => Date;
  /** 发布锁等待（默认 LOCK_DEADLINE_MS）。 */
  lockWaitMs?: number;
  /** 分段耗时回调（名字与旧引擎一致：push-state/push-pointer/push-index/push-body/push-upload/push-publish/push-baseline）。 */
  onPhase?: (phase: string, ms: number) => void;
  /** 资产上传并发（默认 12，与整轮一致）。 */
  transferConcurrency?: number;
}

/** 声明类型 re-export 便于适配层/测试构造。 */
export type { AssetDeclaration, DeviceBaseline, QuickPushState };
