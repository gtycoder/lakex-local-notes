/**
 * v4 Commit 的 IO 半段（E2-2b）：**发布锁 + 读回校验 + pointer 写入**，与 v3 引擎逐条等价。
 *
 * 为什么单独成模块：这是同步里唯一有并发语义的部分，也是历史上最容易出"静默分叉"的地方。
 * 不变量（任何一条被破坏都会让两端各自以为自己是真相）：
 *  1. 写索引前必须持锁，指针写入前**再确认锁仍属自己**（无 CAS 的 provider 只能靠锁 + 读回）；
 *  2. 写指针前读回 pointer，必须仍是计划所基于的那一代（epoch/generation/两个 commit 全等），否则放弃重试；
 *  3. 写指针后读回，generation 与两个 commit 必须等于本次写的值，否则放弃重试（可能被别的端覆盖）；
 *  4. 释放锁只删**自己的**锁（他端抢走时不能误删）；
 *  5. 索引 commit 与 base 完全一致 ⇒ 不写对象、不拿锁（零变更轮不产生任何 S3 写）；
 *  6. 只写「变了的那半边」索引（大库空跑时省一次全量 gzip 序列化）。
 *
 * 本函数**不重试**：返回 retry 结果，由编排层（引擎/E3）做退避重试，避免两层各退一次。
 */
import { S3V3_POINTER_KEY, S3V3_POINTER_VERSION, indexHashOf, indexKey, serializeLakeIndex, serializeQuickNotesIndex, validatePointer, type LakeIndex, type QuickNotesIndex, type S3v3Pointer } from "../protocol/index.js";
import type { SyncPlan } from "../plan/types.js";

export const COMMIT_LOCK_KEY = "meta/lock.json";
export const COMMIT_LOCK_TTL_MS = 120_000;
export const COMMIT_LOCK_SETTLE_MS = 40;
export const COMMIT_LOCK_WAIT_MS = 3_000;

export interface CommitPorts {
  getRemote(key: string): Promise<Uint8Array | null>;
  putRemote(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
  deleteRemoteKeys(keys: string[]): Promise<void>;
}

export interface CommitInput {
  plan: SyncPlan;
  /** buildPublishIndex 的结果（已含上传失败回退与 assetsHash）；null = 本轮不提交。 */
  next: { lake: LakeIndex; quickNotes: QuickNotesIndex } | null;
  /** 计划所基于的 pointer：读回校验的锚点。 */
  /** null = 首传（云端还没有 pointer）：发布 generation 1。 */
  base: S3v3Pointer | null;
  deviceId: string;
}

export interface CommitOptions {
  lockWaitMs?: number;
  lockTtlMs?: number;
  lockSettleMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  createdAt?: string;
}

export type CommitOutcome =
  | { status: "skipped"; reason: "no-publish-plan" }
  | { status: "unchanged"; pointer: S3v3Pointer }
  | { status: "published"; pointer: S3v3Pointer; generation: number; lakeCommit: string; quickNotesCommit: string; wroteLake: boolean; wroteQuick: boolean }
  | { status: "retry"; reason: "lock-busy" | "pointer-moved" | "lock-lost" | "readback-mismatch" | "pointer-corrupt" };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 发布本轮索引与 pointer。返回 retry 由调用方决定退避重试。 */
export async function commitPlan(input: CommitInput, ports: CommitPorts, opts: CommitOptions = {}): Promise<CommitOutcome> {
  const { plan, next, base, deviceId } = input;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const lockWaitMs = opts.lockWaitMs ?? COMMIT_LOCK_WAIT_MS;
  const lockTtlMs = opts.lockTtlMs ?? COMMIT_LOCK_TTL_MS;
  const lockSettleMs = opts.lockSettleMs ?? COMMIT_LOCK_SETTLE_MS;
  if (!plan.publish || !next) return { status: "skipped", reason: "no-publish-plan" };

  // 只序列化真的变了的半边（大库空跑的主 CPU 就在这里）。
  const lakeSerialized = serializeLakeIndex(next.lake);
  const lakeCommit = indexHashOf(lakeSerialized);
  const quickSerialized = serializeQuickNotesIndex(next.quickNotes);
  const quickCommit = indexHashOf(quickSerialized);
  const wroteLake = base === null || lakeCommit !== base.lake.commit;
  const wroteQuick = base === null || quickCommit !== base.quickNotes.commit;
  if (base !== null && !wroteLake && !wroteQuick) return { status: "unchanged", pointer: base };

  const owner = async (): Promise<string | null> => {
    const raw = await ports.getRemote(COMMIT_LOCK_KEY);
    if (!raw) return null;
    try { return (JSON.parse(new TextDecoder().decode(raw)) as { deviceId?: string }).deviceId ?? null; } catch { return null; }
  };

  const acquire = async (): Promise<boolean> => {
    const deadline = now() + lockWaitMs;
    for (;;) {
      const current = await owner();
      if (current && current !== deviceId) {
        const raw = await ports.getRemote(COMMIT_LOCK_KEY);
        let fresh = false;
        if (raw) {
          try { const l = JSON.parse(new TextDecoder().decode(raw)) as { time?: number; ttl?: number }; fresh = now() - (l.time ?? 0) < (l.ttl ?? lockTtlMs); }
          catch { fresh = false; }
        }
        if (fresh) {
          if (now() > deadline) return false;
          await sleep(60 + Math.floor(Math.random() * 240));
          continue;
        }
      }
      const lock = { deviceId, time: now(), ttl: lockTtlMs };
      await ports.putRemote(COMMIT_LOCK_KEY, new TextEncoder().encode(JSON.stringify(lock)));
      await sleep(lockSettleMs);
      if (await owner() === deviceId) return true;
      if (now() > deadline) return false;
      await sleep(60 + Math.floor(Math.random() * 240));
    }
  };

  const readPointer = async (): Promise<S3v3Pointer | null | "corrupt"> => {
    const bytes = await ports.getRemote(S3V3_POINTER_KEY);
    if (!bytes) return null;
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { return "corrupt"; }
    const parsed = validatePointer(raw);
    return parsed.ok ? parsed.pointer : "corrupt";
  };

  if (!(await acquire())) return { status: "retry", reason: "lock-busy" };
  try {
    // 首传：云端必须仍然没有 pointer（别人抢先发布了就作废重来）。
    if (base === null) {
      const existing = await readPointer();
      if (existing !== null) return { status: "retry", reason: "pointer-moved" };
    }
    // 读回：仍是计划所基于的那一代吗？（他端已发布 ⇒ 本轮决定作废）
    const current = await readPointer();
    if (current === "corrupt") return { status: "retry", reason: "pointer-corrupt" };
    if (base !== null && (!current
      || current.epoch !== base.epoch
      || current.generation !== base.generation
      || current.lake.commit !== base.lake.commit
      || current.quickNotes.commit !== base.quickNotes.commit)) {
      return { status: "retry", reason: "pointer-moved" };
    }

    if (wroteLake) await ports.putRemote(indexKey("lake", lakeCommit), new TextEncoder().encode(lakeSerialized), { gzip: true });
    if (wroteQuick) await ports.putRemote(indexKey("quickNotes", quickCommit), new TextEncoder().encode(quickSerialized), { gzip: true });

    // 指针写入前复核锁归属（静置后可能被抢走）。
    if (await owner() !== deviceId) return { status: "retry", reason: "lock-lost" };
    const generation = base === null ? 1 : base.generation + 1;
    const pointer: S3v3Pointer = {
      v: S3V3_POINTER_VERSION, epoch: base?.epoch ?? (globalThis.crypto.randomUUID()), generation,
      lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit },
      createdAt: opts.createdAt ?? new Date(now()).toISOString(), deviceId,
    };
    await ports.putRemote(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(pointer)));

    // 读回确认（无 CAS：只能靠"写完再读"，被别人覆盖就必须放弃）。
    const check = await readPointer();
    if (check === "corrupt") return { status: "retry", reason: "pointer-corrupt" };
    if (!check || check.generation !== generation || check.lake.commit !== lakeCommit || check.quickNotes.commit !== quickCommit) {
      return { status: "retry", reason: "readback-mismatch" };
    }
    return { status: "published", pointer: check, generation, lakeCommit, quickNotesCommit: quickCommit, wroteLake, wroteQuick };
  } finally {
    // 只删自己的锁：他端抢走后误删会让他端"以为持锁"却已无锁。
    try { if (await owner() === deviceId) await ports.deleteRemoteKeys([COMMIT_LOCK_KEY]); } catch { /* 释放失败不改变发布结果 */ }
  }
}
