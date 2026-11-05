/**
 * 安全模式判据（单一来源，Batch4-D / P2-C）：安全模式下**不恢复也不写**桌面标签会话。
 *
 * 失败语义 = **fail-closed（unknown）**：问不到主进程（IPC 失败/超时/返回形状不对）时**绝不**当成
 * 「非安全模式」——那会让 App 照常把本次的空标签写回会话文件、并在 bootstrap 里恢复标签，
 * 从而覆盖用户原会话、也无视安全模式的「不恢复标签」契约。unknown 一律 skip（宁可晚一条）。
 */
import { useEffect, useState } from "react";
import { native } from "../lib/native";

export type SafeModeStatus = "unknown" | "inactive" | "active";

/** 会话文件写入动作：skip = 完全不碰（安全模式/判定未到）；clear = 清空存档；write = 正常落盘。 */
export type TabSessionWriteDecision = "skip" | "clear" | "write";

/**
 * 唯一判据：
 * - active（安全模式）⇒ skip：会话原样保留，等下次正常启动恢复；
 * - unknown（问不到/还没问到）⇒ skip：宁可晚一条，也不冒覆盖用户会话的风险；
 * - inactive ⇒ clearTabsOnExit ? clear : write（原有语义）。
 */
export function tabSessionWriteDecision(status: SafeModeStatus, clearTabsOnExit: boolean | undefined): TabSessionWriteDecision {
  if (status !== "inactive") return "skip";
  return clearTabsOnExit === true ? "clear" : "write";
}

/**
 * 问一次主进程：成功且形状正确才给 active/inactive，其余（IPC 失败、返回 null/非对象、
 * active 不是布尔）一律返回 **unknown**（fail-closed），调用方据此 skip 会话写/恢复。
 */
export async function readSafeModeStatus(): Promise<SafeModeStatus> {
  try {
    const state = await native.getSafeModeState();
    if (!state || typeof state.active !== "boolean") return "unknown";
    return state.active ? "active" : "inactive";
  } catch {
    // IPC 失败不静默降级成 inactive（P2-8：旧实现就是在这里 fail-open 的）。
    return "unknown";
  }
}

/** 启动时问一次主进程并缓存（一个 App 只调一次，避免多处重复 IPC/重复判断）。 */
export function useSafeModeStatus(): SafeModeStatus {
  const [status, setStatus] = useState<SafeModeStatus>("unknown");
  useEffect(() => {
    let alive = true;
    void readSafeModeStatus().then((next) => { if (alive) setStatus(next); });
    return () => { alive = false; };
  }, []);
  return status;
}
