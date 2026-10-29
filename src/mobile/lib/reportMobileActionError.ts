/**
 * 移动端交互动作失败的可观测兜底（MOB-14 保守版）。
 *
 * 背景：移动端有大量 `catch {}`（261027 审计记 197 处），多数是「内核 / Univer API 不可用」
 * 的合理 no-op；但**命令路径**（撤销/重做/插入、目录行重命名、搜索…）静默失败时，
 * 用户只看到「点了没反应」，排障也没有任何信号。
 *
 * 本函数只做两件事：
 *  · 每次失败记一条 debug 日志（`rlog.debug`；正式环境不输出，不添日志噪音）；
 *  · 调用方**显式要求**时才弹 toast（默认不弹，避免把合理 no-op 变成打扰）。
 *
 * 边界：不要用它全量替换空 catch —— 「可预期 no-op」白名单保持原样（AGENTS §3#17）。
 */
import { rlog } from "../../lib/log";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { showToast, type ToastType } from "../ui/toastBus";

export interface ReportMobileActionErrorOptions {
  /** true = 弹默认文案「<动作>失败」；字符串 = 自定义文案；省略 / false = 只记日志。 */
  toast?: boolean | string;
  /** toast 类型，默认 error。 */
  type?: ToastType;
}

/** 记一条动作失败日志；需要用户可见时再弹 toast。动作名用短中文，例：「撤销」「读取历史版本」。 */
export function reportMobileActionError(
  action: string,
  error?: unknown,
  options: ReportMobileActionErrorOptions = {},
): void {
  const detail = error === undefined ? "" : getNativeErrorMessage(error);
  rlog.debug("mobile-action", action + "失败" + (detail ? "：" + detail : ""));
  if (!options.toast) return;
  const text = typeof options.toast === "string" ? options.toast : action + "失败";
  showToast(text, { type: options.type ?? "error" });
}
