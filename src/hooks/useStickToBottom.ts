import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * 「贴底跟随」（sticky bottom）——P2。
 *
 * 来源：deepseek-ai/chat-demo（MIT）的
 * `src/components/messages/MessageList.tsx`：`stickyRef` 记住是否跟随底部；
 * ResizeObserver 观察滚动容器与内容，尺寸变化时若仍跟随就 `scrollTop = scrollHeight`；
 * 用户自己往上滚则脱离，滚回底部附近重新吸附。
 *
 * 我们改了什么：
 * - 抽成通用 hook：入参 = 滚动容器 ref + 内容信号（条数/最后一条长度等合成标量）+ enabled；
 *   不依赖会话/消息模型，AI 弹窗与 AI 写作两个宿主共用一套（删掉原来的 nearBottom 近似）；
 * - 阈值统一 80px（参考实现 40px；本仓原 AI 写作是 160px，取中间值）；
 * - 用户主动上滚的判据扩到 wheel / touchmove（按手指方向）/ 键盘（↑/PageUp/Home/Shift+Space）；
 * - 监听器全部 passive（只读事件，不 preventDefault），**不用** setPointerCapture（会吞掉子元素 click）；
 * - 卸载/禁用时清掉 ResizeObserver 与全部事件监听；
 * - 暴露 scrollToBottom()（强制贴底并重新吸附），供「发送后立即看最新」一类调用；
 * - 暴露 detach()（主动退出跟随）：切消息版本时先退出，再把滚动位置锚回原处，
 *   避免「切到旧版本 → 内容变短 → 又被强制贴底」跳出阅读位置。
 *
 * 已知边界：jsdom 没有真实布局（scrollHeight/clientHeight 恒 0），测试用自定义属性模拟；
 * 真实滚动/惯性滚动的时序只能在 Electron 里验。
 */

/** 距底部小于该值视为「在底部」，内容增长时继续跟着滚。 */
const DEFAULT_THRESHOLD_PX = 80;

/** 会让阅读位置往上走的按键：一律视为用户主动脱离。 */
const UPWARD_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

export interface StickToBottomOptions {
  /** 滚动容器（通常是 overflow:auto 的那个盒子）。 */
  scrollRef: RefObject<HTMLElement | null>;
  /**
   * 内容信号：任一变化都视为「内容可能变高」。
   * 传**稳定标量**（例如 `条数 + ":" + 最后一条长度`），不要每次渲染新建对象/数组。
   */
  contentSignal: string | number;
  /** false = 不挂监听、不滚动（面板关闭/空间隐藏）。缺省 true。 */
  enabled?: boolean;
  /** 「在底部附近」的阈值（px）。缺省 80。 */
  threshold?: number;
}

export interface StickToBottom {
  /** 强制滚到底并重新吸附（不受当前跟随状态限制）。 */
  scrollToBottom: () => void;
  /** 退出跟随态：之后内容变化不再强制贴底（切版本时保持阅读位置）。 */
  detach: () => void;
}

export function useStickToBottom({
  scrollRef,
  contentSignal,
  enabled = true,
  threshold = DEFAULT_THRESHOLD_PX,
}: StickToBottomOptions): StickToBottom {
  /** 是否处于跟随态：初始/重新启用时 true（打开面板默认看最新）。 */
  const stuckRef = useRef(true);
  /** 上一次看到的 scrollTop：判「用户往上滚」只认方向，不认绝对位置。 */
  const lastTopRef = useRef(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const observedChildRef = useRef<Element | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stuckRef.current = true;
    el.scrollTop = el.scrollHeight;
    lastTopRef.current = el.scrollTop;
  }, [scrollRef]);

  // 内容变化 / 重新启用：跟随态下贴底。用 layout effect 在绘制前落位，避免闪一帧旧位置。
  useLayoutEffect(() => {
    if (!enabled) {
      // 关闭期间不跟随；下次打开从最新位置开始。
      stuckRef.current = true;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    if (stuckRef.current) {
      el.scrollTop = el.scrollHeight;
      lastTopRef.current = el.scrollTop;
    }
    // 内容子节点可能整块替换（空态 → 线程）：把 ResizeObserver 迁到当前内容上。
    const ro = roRef.current;
    const child = el.firstElementChild;
    if (ro && child !== observedChildRef.current) {
      if (observedChildRef.current) ro.unobserve(observedChildRef.current);
      if (child) ro.observe(child);
      observedChildRef.current = child;
    }
  }, [contentSignal, enabled, scrollRef]);

  // 监听用户主动上滚 + 容器/内容尺寸变化；enabled 变化时重建，关闭期间不挂任何监听。
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    const follow = () => {
      if (!stuckRef.current) return;
      el.scrollTop = el.scrollHeight;
      lastTopRef.current = el.scrollTop;
    };
    const onScroll = () => {
      const top = el.scrollTop;
      const distance = el.scrollHeight - top - el.clientHeight;
      if (distance <= threshold) {
        // 回到底部附近：重新吸附。
        stuckRef.current = true;
      } else if (top < lastTopRef.current) {
        // 只在**往上**滚时脱离：内容/布局突然增高会把 scrollTop 顶上去，不能误判成用户上滚。
        stuckRef.current = false;
      }
      lastTopRef.current = top;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stuckRef.current = false;
    };
    let touchStartY = 0;
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      // 手指往下拖 = 内容往回看（scrollTop 变小）；留 4px 抖动余量。
      if (y !== undefined && y - touchStartY > 4) stuckRef.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (UPWARD_KEYS.has(event.key) || (event.key === " " && event.shiftKey)) stuckRef.current = false;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(follow);
      ro.observe(el);
      const child = el.firstElementChild;
      if (child) ro.observe(child);
      roRef.current = ro;
      observedChildRef.current = child;
    }
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      ro?.disconnect();
      if (roRef.current === ro) roRef.current = null;
      observedChildRef.current = null;
    };
  }, [enabled, scrollRef, threshold]);

  const detach = useCallback(() => {
    stuckRef.current = false;
  }, []);

  return { scrollToBottom, detach };
}
