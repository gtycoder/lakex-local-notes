/**
 * AI 写作的 Markdown → Lake 转换（261109）。
 *
 * 现象：生成文档 / 保存到小记偶发报「Markdown 转换超时」。
 * 根因（实测）：转换会临时起一个离屏内核，靠 rAF/首帧推进；**窗口被遮挡或最小化时
 * rAF 不触发**（document.visibilityState = hidden），内核不产出 data-lake-id ⇒ 只等着超时。
 * 另有偶发的一次性卡死（临时内核初始化抖动）。
 *
 * 因此这里做三件事（缺一不可）：
 * 1. **窗口不可见先等可见**（上限 10s）：多数情况用户马上就把窗口切回来了；**等不到也照常尝试**——
 *    可见性探测可能误判（实测窗口在前台仍报 hidden），硬失败会把正常转换挡掉；真不可见时会以
 *    「转换超时」收场，提示同样可操作；
 * 2. 单次预算 60s（生产热路径 ~1s，dev 冷启动更慢），**只对 render-timeout 重建一次**；
 * 3. 全程支持 AbortSignal：弹窗「取消」能真正停下，不把转换队列堵在后台。
 *
 * 非超时错误（too-large / no-lake-id / aborted / convert-failed）一律不重试。
 */
import {
  MarkdownImportError,
  convertMarkdownToLake,
  type MarkdownConvertOptions,
  type MarkdownConvertResult,
} from "../import/markdownImportPipeline";

/** 单次转换预算（内核初始化 + 渲染）。 */
export const AI_MARKDOWN_CONVERT_TIMEOUT_MS = 60_000;
/** 窗口不可见时最多等多久再放弃（用户切回前台通常在这一档内）。 */
export const AI_MARKDOWN_VISIBILITY_WAIT_MS = 10_000;
/** 重建前的短暂等待（让上一次的超时内核/队列收尾）。 */
export const AI_MARKDOWN_RETRY_DELAY_MS = 500;

type ConvertFn = (options: MarkdownConvertOptions) => Promise<MarkdownConvertResult>;

/** 可见性策略（可注入，便于单测；浏览器默认读 document + visibilitychange）。 */
export interface ConvertVisibility {
  isHidden(): boolean;
  /** 等到可见（上限 timeoutMs）；**超时 resolve**（继续尝试），只有取消才 reject。 */
  waitVisible(timeoutMs: number, signal?: AbortSignal): Promise<void>;
}

export interface ConvertAiMarkdownOptions {
  /** 取消（弹窗「取消」/关闭）：透传给内核转换与等待。 */
  signal?: AbortSignal;
  /** 测试注入用；缺省 = 浏览器可见性。 */
  visibility?: ConvertVisibility;
}

function abortedError(): MarkdownImportError {
  return new MarkdownImportError("aborted", "已取消");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedError();
}

function isRenderTimeout(error: unknown): boolean {
  return error instanceof MarkdownImportError && error.code === "render-timeout";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortedError()); return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortedError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function browserVisibility(): ConvertVisibility {
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  return {
    isHidden: hidden,
    waitVisible(timeoutMs, signal) {
      if (!hidden()) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          document.removeEventListener("visibilitychange", onVisibility);
          signal?.removeEventListener("abort", onAbort);
        };
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const onVisibility = () => { if (document.visibilityState === "visible") finish(); };
        const onAbort = () => finish(abortedError());
        // 超时不是错误：继续尝试（探测可能误判），真空窗时转换会以 render-timeout 收场。
        const timer = setTimeout(() => finish(), timeoutMs);
        document.addEventListener("visibilitychange", onVisibility);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export async function convertAiMarkdown(
  markdown: string,
  convert: ConvertFn = convertMarkdownToLake,
  options: ConvertAiMarkdownOptions = {},
): Promise<MarkdownConvertResult> {
  const { signal, visibility = browserVisibility() } = options;
  // 1) 先确保窗口可见（不可见时内核不推进，转了也只会白等到超时）。
  //    等不到也继续尝试；但若此刻仍然不可见，重试注定无意义 ⇒ 只跑一次。
  if (visibility.isHidden()) await visibility.waitVisible(AI_MARKDOWN_VISIBILITY_WAIT_MS, signal);
  throwIfAborted(signal);
  const allowRetry = !visibility.isHidden();

  const run = () => convert({ markdown, convertTimeoutMs: AI_MARKDOWN_CONVERT_TIMEOUT_MS, signal });

  // 2) 首次转换；只对 render-timeout 重建一次（临时内核偶发卡死）。
  try {
    return await run();
  } catch (error) {
    if (signal?.aborted || !isRenderTimeout(error) || !allowRetry) throw error;
    await sleep(AI_MARKDOWN_RETRY_DELAY_MS, signal);
    throwIfAborted(signal);
    try {
      return await run();
    } catch (retryError) {
      if (signal?.aborted) throw abortedError();
      if (!isRenderTimeout(retryError)) throw retryError;
      throw new MarkdownImportError(
        "render-timeout",
        "Markdown 转换超时（内核未产出正文）。请确认窗口在前台后重试；仍失败请重启应用再试。",
      );
    }
  }
}
