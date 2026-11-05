/**
 * 移动端全局异常兜底（261105）：window error / unhandledrejection → crashLog 落盘。
 *
 * 为什么必须装：桌面 `src/main.tsx:18-23` 有同款兜底；移动端此前缺 ⇒ 未捕获异常只进 Logcat。
 * 本文件不吞异常（不阻止默认行为）—— 只是留证据；React 渲染异常由 MobileErrorBoundary 兜底。
 *
 * 可测性：target 参数化（默认 window），返回卸载函数。
 */
import { reportCrash } from "./crashLog";

type ErrorTarget = Pick<Window, "addEventListener" | "removeEventListener">;

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

export function installGlobalErrorHandlers(target: ErrorTarget = window): () => void {
  const onError = (event: Event): void => {
    const errorEvent = event as ErrorEvent;
    reportCrash({
      scope: "window",
      message: messageOf(errorEvent.error ?? errorEvent.message),
      stack: errorEvent.error instanceof Error ? errorEvent.error.stack : undefined,
    });
  };
  const onRejection = (event: Event): void => {
    const rejection = event as PromiseRejectionEvent;
    reportCrash({
      scope: "promise",
      message: messageOf(rejection.reason),
      stack: rejection.reason instanceof Error ? rejection.reason.stack : undefined,
    });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
