import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 流式 Markdown 按「渲染耗时」节流（P1）。
 *
 * 来源：deepseek-ai/chat-demo（MIT）的
 * `src/components/markdown/useThrottleMarkdownRender.ts`：
 * 记下本次渲染耗时，按「耗时 × 2」算出下次允许更新的时间点（上限 2s）；没到期就挂定时器，
 * 连续 delta 只保留最新内容，到期才提交一次渲染。
 *
 * 我们改了什么：
 * - 抽成**通用 hook**（只管内容节流，不依赖 MarkdownView / 会话模型），两个流式宿主共用；
 * - 计时器收进 `timerRef`：卸载、禁用、内容再次变化都显式清掉（参考实现只靠 effect cleanup，
 *   禁用时已排的定时器仍会再走一次，生成结束后可能晚一帧才显示完整内容）；
 * - 禁用时把 `output` 同步成最新内容，重新启用时不会先闪一帧旧内容；
 * - `performance.now` 缺失（SSR / 极简测试环境）时退化 `Date.now`；只用 React 18 已有 API；
 * - 用 layout effect 量「提交耗时」，比普通 effect 更接近本次渲染/提交的实际开销（SSR 下退化 useEffect）。
 *
 * 调用约定：只在「生成中」传 enabled=true；生成结束立即传 false，返回值当帧就是完整 content。
 */

/**
 * 两次提交之间允许的最长等待（毫秒）：渲染再贵也不能把流式界面卡超过这个间隔。
 * 261116 由 2000 收紧到 300（依据：scripts/ai-stream-probe.mjs 端到端实测 ——
 * 640KB/密集 DOM 的贵渲染场景下，旧值出现 1708ms 的可见更新间隔（用户报「2 秒才更新一屏」）；
 * 收到 300 后同一场景最大间隔压到约 1 个渲染成本 + 300ms，且 60KB 普通回答不受影响。
 * 300 同时给「最短可见更新节奏」一个下限 3.3fps（<250 会让贵重渲染每次提交都排队过密）。
 */
const MAX_WAIT_MS = 300;
/**
 * 上次渲染耗时的倍数：渲染越贵，两次更新间隔越长。
 * 261116 由 2 收到 1.5：2×cost 会把「等一次渲染」翻倍成「等两倍渲染」，对长回答是纯延迟；
 * 1.5 仍保留「贵渲染降频」的节流收益，同时把成本档（cost 20–200ms）的间隔压到 30–300ms。
 */
const COST_RATE = 1.5;

/** SSR 没有 layout effect，退化成 effect（本 hook 不依赖 DOM 布局）。 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function now(): number {
  // 测试/SSR 环境可能没有 performance：退化到 Date.now（fake timers 也能驱动）。
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * @param content 流式最新的完整内容（每来一个 delta 就更新）
 * @param enabled 是否节流；false = 立即返回 content（生成结束必须传 false）
 * @returns 本次应该渲染的内容（可能比 content 旧，但不会超过 MAX_WAIT_MS）
 */
export function useThrottledMarkdown(content: string, enabled: boolean): string {
  // 首次渲染从挂载时开始计时。
  const startRef = useRef(now());
  /** 下次允许更新的时间点（0 = 立即可更新）。 */
  const updatableAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [output, setOutput] = useState(content);
  /** 当前已提交的内容：与 content 相同就不必再排一次「原样重渲染」。 */
  const outputRef = useRef(output);
  outputRef.current = output;
  /** 定时器触发时取最新内容：回调闭包里的 content 可能已过期（期间又来了 delta）。 */
  const latestContentRef = useRef(content);
  latestContentRef.current = content;

  // 每次真正提交 output 后量一次耗时，算出下次允许更新的时间点。
  useIsomorphicLayoutEffect(() => {
    const at = now();
    const cost = Math.max(0, at - startRef.current);
    updatableAtRef.current = at + Math.min(MAX_WAIT_MS, cost * COST_RATE);
  }, [output]);

  useEffect(() => {
    if (!enabled) {
      // 禁用（生成结束/即将卸载）：清掉已排定时器并立刻对齐最终内容，绝不残留截断。
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setOutput((prev) => (prev === content ? prev : content));
      return;
    }
    // 内容没变（含初次挂载）：不需要为了「同一份内容」再排一次渲染。
    if (outputRef.current === content) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    const update = () => {
      timerRef.current = null;
      startRef.current = now();
      setOutput(latestContentRef.current);
    };
    const delay = updatableAtRef.current - now();
    if (delay <= 0) {
      update();
      return;
    }
    timerRef.current = setTimeout(update, delay);
    return () => {
      // 内容又变 / 禁用 / 卸载：旧定时器一律作废（连续 delta 只保留最新内容）。
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [content, enabled]);

  // 禁用时不必等 state 同步：直接透传最新内容。
  return enabled ? output : content;
}
