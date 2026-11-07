/**
 * 「动作失败 → 错误 toast」的统一出口（261107 架构整理）。
 *
 * 收口前全仓 37 处手写：`showToast("X失败：" + getNativeErrorMessage(e), { type: "error" })`，
 * 四种错误取文案方式（getNativeErrorMessage / Error.message / instanceof 三目 / String）并存，
 * 文案随入口漂移。这里只统一**取文案与 toast 形态**，不改任何入口的动作名与措辞。
 *
 * 需要额外可观测性的调用方仍可直接用 reportMobileActionError（本函数默认也记一条 debug 日志）。
 */
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { showToast } from "../ui/toastBus";
import { reportMobileActionError } from "./reportMobileActionError";

export interface ToastActionErrorOptions {
  /** 是否同时记一条 mobile-action debug 日志（默认 true；重复记录时传 false）。 */
  report?: boolean;
  /** 追加在错误文案后的补充，如「；可重试」。 */
  suffix?: string;
}

/** 统一失败 toast：`<动作>失败：<错误文案>`（与旧手写文案逐字一致）。 */
export function toastActionError(action: string, error: unknown, options: ToastActionErrorOptions = {}): void {
  const detail = getNativeErrorMessage(error);
  if (options.report !== false) reportMobileActionError(action, error);
  showToast(action + "失败：" + detail + (options.suffix ?? ""), { type: "error" });
}
