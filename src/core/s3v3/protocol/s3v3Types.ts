/**
 * S3 同步协议 v3 · 共享类型与纯校验（lake-core，无 node 依赖）。
 * 设计来源：docs/SYNC-PROTOCOL.md（历史设计稿 S3-REDESIGN 已删，git 可查；含两份独立审计处置）。
 */

/** pointer 版本号。 */
export const S3V3_POINTER_VERSION = 3 as const;
/** 内容 hash 形态（sha256 hex）。 */
export const S3V3_HASH_RE = /^[a-f0-9]{64}$/;
/** epoch 形态（随机 UUID）。 */
export const S3V3_EPOCH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 云端唯一可变小对象 meta/pointer.json。 */
export interface S3v3Pointer {
  v: typeof S3V3_POINTER_VERSION;
  epoch: string;
  /** 单调递增的发布流水号（每次发布 +1）。 */
  generation: number;
  lake: { commit: string };
  quickNotes: { commit: string };
  createdAt: string;
  /** 最后发布者（排障用，不参与判定）。 */
  deviceId?: string;
}

/** 设备本地「上次成功同步后的世界状态」。 */
export interface S3v3Baseline {
  epoch: string;
  generation: number;
  lakeCommit: string;
  quickNotesCommit: string;
}

export type CloudState =
  | "no-baseline"
  | "empty-cloud"
  | "pointer-corrupt"
  | "epoch-mismatch"
  | "generation-rollback"
  | "fork"
  | "ok";

export interface CloudStateInput {
  pointer: S3v3Pointer | null;
  baseline: S3v3Baseline | null;
  /** pointer 缺失时云端是否已有对象（objects/ 或 meta/index/）。 */
  cloudHasObjects: boolean;
}

/** 校验 pointer 结构/取值；不合法返回原因。 */
export function validatePointer(raw: unknown): { ok: true; pointer: S3v3Pointer } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "pointer 非对象" };
  const p = raw as Partial<S3v3Pointer>;
  if (p.v !== S3V3_POINTER_VERSION) return { ok: false, reason: "pointer 版本不兼容" };
  if (typeof p.epoch !== "string" || !S3V3_EPOCH_RE.test(p.epoch)) return { ok: false, reason: "pointer epoch 非法" };
  if (typeof p.generation !== "number" || !Number.isSafeInteger(p.generation) || p.generation < 0) return { ok: false, reason: "pointer generation 非法" };
  if (!p.lake || typeof p.lake.commit !== "string" || !S3V3_HASH_RE.test(p.lake.commit)) return { ok: false, reason: "pointer lake.commit 非法" };
  if (!p.quickNotes || typeof p.quickNotes.commit !== "string" || !S3V3_HASH_RE.test(p.quickNotes.commit)) return { ok: false, reason: "pointer quickNotes.commit 非法" };
  if (typeof p.createdAt !== "string" || p.createdAt.length === 0) return { ok: false, reason: "pointer createdAt 非法" };
  return { ok: true, pointer: p as S3v3Pointer };
}
