/**
 * 安全模式判据（单一来源，Batch4-D）：安全模式下**不恢复也不写**桌面标签会话。
 *
 * 背景：安全模式启动时 useBootstrap 已跳过恢复（Batch3-B），但 App 的会话写 effect 仍会把
 * 「本次的空标签」写回 localStorage ⇒ 用户原会话被覆盖（下次正常启动也恢复不回来）。
 *
 * 判据实现只有这一处：调用方拿 SafeModeStatus 后统一走 tabSessionWriteDecision。
 * IPC 失败按「非安全模式」兜底（保持既有行为，不把排查态误判成常态）。
 */
import { useEffect, useState } from "react";
import { native } from "../lib/native";

export type SafeModeStatus = "unknown" | "inactive" | "active";

/** 会话文件写入动作：skip = 完全不碰（安全模式/判定未到）；clear = 清空存档；write = 正常落盘。 */
export type TabSessionWriteDecision = "skip" | "clear" | "write";

/**
 * 唯一判据：
 * - active（安全模式）⇒ skip：会话原样保留，等下次正常启动恢复；
 * - unknown（还没问到主进程）⇒ skip：宁可晚一条，也不冒覆盖用户会话的风险；
 * - inactive ⇒ clearTabsOnExit ? clear : write（原有语义）。
 */
export function tabSessionWriteDecision(status: SafeModeStatus, clearTabsOnExit: boolean | undefined): TabSessionWriteDecision {
  if (status !== "inactive") return "skip";
  return clearTabsOnExit === true ? "clear" : "write";
}

/** 启动时问一次主进程并缓存（一个 App 只调一次，避免多处重复 IPC/重复判断）。 */
export function useSafeModeStatus(): SafeModeStatus {
  const [status, setStatus] = useState<SafeModeStatus>("unknown");
  useEffect(() => {
    let alive = true;
    void native.getSafeModeState()
      .then((state) => { if (alive) setStatus(state.active ? "active" : "inactive"); })
      .catch(() => { if (alive) setStatus("inactive"); });
    return () => { alive = false; };
  }, []);
  return status;
}
