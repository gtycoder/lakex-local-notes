/**
 * P1-4 正文突变保护（261105）：区分「用户编辑」与「正文文件被外部损坏/替换」。
 *
 * 故障场景：正文是文件（桌面 .lake 等），桌面 `listNotesSyncMeta` 给 `'' AS content_hash`
 * （electron/store.ts:439）⇒ core loadState 每轮**按文件实算 hash**。外部把文件截断/清空/换成二进制后：
 * 实算 hash ≠ 基线 hash ⇒ 三方合并判成「本地改了」⇒ 坏内容当编辑上传；发布后旧正文对象被清理
 * ⇒ 坏内容覆盖云端（只能靠历史回退）。
 *
 * 判据（保守，宁可漏拦不可误伤）——三条同时成立才算 suspicious：
 *  ① 基线里有该篇 hash H0，且本轮实算 hash ≠ H0；
 *  ② 本地 DB 行 `updatedAt` **没有前进**（≤ 基线条目 updatedAt）：App 内保存一定会 bump 它，
 *     「hash 变了但行没动」= 这次变化不是 App 写的（外部改动 / 写盘失败 / 磁盘损坏）；
 *  ③ 内容本身像坏了：空 / 非 UTF-8 / 含 NUL 字节（可选：相对上次已知大小骤降 ≤10%）。
 * 正常编辑（updatedAt 前进）永不拦；无基线不拦（新设备/首拉没有「原来是什么」的判据）。
 *
 * 纯函数、零 IO，两端共用（引擎负责读字节与传 flag）。
 */

/** 「大小骤降」阈值：≤ 上次大小的 10% 视为可疑（仅在调用方给得出 previousSize 时生效）。 */
export const SUSPICIOUS_BODY_SIZE_RATIO = 0.1;

export interface BodyChangeFacts {
  /** 基线条目里的正文 hash（远程索引 = 上次同步的真相）；没有 = 无基线，不判。 */
  baselineHash: string | null | undefined;
  /** 基线条目的 updatedAt。 */
  baselineUpdatedAt: string | null | undefined;
  /** 本地 DB 行的 updatedAt。 */
  localUpdatedAt: string | null | undefined;
  /** 本轮实算（或 DB 给出）的本地正文 hash。 */
  localHash: string;
}

/**
 * ①+②：变化「不可解释」——基线有 hash、hash 变了、但行 updatedAt 没有前进。
 * 时间戳缺失时一律判 false（保守：拿不准就当正常编辑，交给既有路径）。
 */
export function isUnexplainedBodyChange(facts: BodyChangeFacts): boolean {
  const baselineHash = facts.baselineHash ?? "";
  if (!baselineHash) return false;
  if (!facts.localHash || facts.localHash === baselineHash) return false;
  const baseAt = facts.baselineUpdatedAt ?? "";
  const localAt = facts.localUpdatedAt ?? "";
  if (!baseAt || !localAt) return false;
  return localAt <= baseAt;
}

export interface CorruptedBodyOptions {
  /** 上次已知的正文大小（字节）；桌面可由 hashCache 得到，移动端通常没有 ⇒ 不参与判定。 */
  previousSize?: number | null;
}

/**
 * ③：内容像坏了——空、非法 UTF-8、含 NUL，或（有上次大小时）大小骤降。
 * bytes === null 表示正文文件读不到：那是「缺正文」通道（local_body_missing / 云端拉回），不在这里判。
 */
export function looksLikeCorruptedBody(bytes: Uint8Array | null | undefined, options: CorruptedBodyOptions = {}): boolean {
  if (!bytes) return false;
  if (bytes.length === 0) return true;
  const previousSize = options.previousSize ?? 0;
  if (previousSize > 0 && bytes.length <= previousSize * SUSPICIOUS_BODY_SIZE_RATIO) return true;
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] === 0) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

/** ①+②+③ 合成判据（引擎对每个候选篇调一次）。 */
export function isSuspiciousBodyChange(facts: BodyChangeFacts & { bytes: Uint8Array | null | undefined }, options: CorruptedBodyOptions = {}): boolean {
  if (!isUnexplainedBodyChange(facts)) return false;
  return looksLikeCorruptedBody(facts.bytes, options);
}
