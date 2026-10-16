/**
 * 移动端互斥域实例（判据单一来源：src/core/maintenancePolicy.ts）。
 *
 * - 写域 writeLock：**本地写**（用户写 + 同步引擎的 DB 片段短锁）。
 * - 维护域 maintenanceQueue：**轮次级**网络/维护（syncNow / gcDeepCleanup / 资产补拉）。
 * - 高优先域 priorityQueue：**用户当场发起**且必须不等整轮同步的单条推送（syncQuickNote）。
 *   它与维护域是**两条独立队列**（彼此可并行），交叉风险由调用方的"推送后回核"兜底。
 *
 * 为什么必须是两个实例（F16）：曾用同一条 key 固定为 "main" 的队列包住「整轮同步（含全部网络往返）」
 * 与「所有本地写」⇒ 弱网下用户保存要等 152.0s（基线写 32ms）。
 *
 * I3：KeyedAsyncQueue 无重入 ⇒ **禁止在同域内再取同域**（会自锁）。
 * 同步侧经 withWriteLock 取「片段级」短锁：一次端口调用进一次出一次，网络往返不在其中。
 */
import { KeyedAsyncQueue } from "../../core/keyedAsyncQueue.js";

export const writeLock = new KeyedAsyncQueue();
export const maintenanceQueue = new KeyedAsyncQueue();
/** 高优先域：用户当场发起的单条推送 —— 彼此串行，但**绝不**排在整轮同步后面（用户 261013）。 */
export const priorityQueue = new KeyedAsyncQueue();

/** 取写域短锁（片段级）。同步端口用它把每个 DB 片段串行化，但**不**跨网络往返持有。 */
export function withWriteLock<T>(task: () => T | Promise<T>): Promise<T> {
  return writeLock.run("write", task);
}