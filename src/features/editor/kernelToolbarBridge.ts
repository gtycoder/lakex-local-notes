/**
 * 卡片浮动工具栏 hover 桥（内核工具条 hover 消失问题的应用侧补丁）。
 *
 * 261112 R2-S9：从 lakeRuntime.ts **原样搬出**（纯搬移：导出名/行为零变化）。
 * 公共符号仍由 ./lakeRuntime 门面 re-export；内核 lazy 边界不变（只被 lakeRuntime 静态 import）。
 */

/** 修复：表格/卡片浮动工具栏 hover 消失。
 * 根因：Lake 卡片工具栏 overlay 的显隐监听挂在卡片根节点上（mouseenter → 显示 /
 * mouseleave → lazyCancel 300ms 后隐藏），工具栏渲染在卡片上方（placement top），
 * 鼠标从卡片移到工具栏即触发卡片 mouseleave → 工具栏在到达前就被隐藏。
 *
 * 方案（两层）：
 * 1. 拦截：mouseleave 不冒泡但有捕获阶段，document 捕获层先于目标监听器执行；
 *    当真实 mouseleave 的目标是卡片、relatedTarget 在工具栏上下文（.ne-card-toolbar /
 *    .ne-ui-boundary-popover / ne-overlay-tmp / 任何 overlay）时 stopImmediatePropagation，
 *    阻止 Lake 排定隐藏 → 悬停工具栏期间工具栏保持。
 * 2. 补发：指针离开工具栏上下文时，向最近停留的卡片补发一次合成 mouseleave
 *    （untrusted 事件拦截器放行），让 Lake 正常延迟隐藏。
 * 返回清理函数。 */
export function setupCardToolbarHoverBridge(host: HTMLElement): () => void {
  let lastCard: Element | null = null;
  let pointerInToolbar = false;
  let hideTimer: number | undefined;
  const HIDE_GRACE_MS = 650;
  const CARD_SELECTOR = "ne-card, ne-table-hole, ne-alert-hole, ne-container-hole";
  const isToolbarContext = (el: Element | null): boolean =>
    !!el?.closest?.(
      ".ne-card-toolbar, .ne-ui-toolbar, .ne-ui-boundary-popover, ne-overlay-tmp, .ant-dropdown, .ant-select-dropdown, .ant-popover, [data-event-boundary=\"overlay\"]",
    );
  const clearHide = (): void => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };
  const visibleToolbarExists = (): boolean => {
    const isVisible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 && rect.height > 0
        && style.display !== "none" && style.visibility !== "hidden"
        // 261005：非活动标签现在**保留布局尺寸**（opacity+visibility 隐藏），隐藏实例的工具条
        // 仍有真实 rect；上面 visibility 那条挡住共享规则，这条挡住画板「贴位置」态的 content-visibility，
        // 否则会把「另一个（隐藏）编辑器的工具条」当成当前编辑器的 ⇒ 卡片工具栏悬停后不消失。
        && style.contentVisibility !== "hidden"
      );
    };
    // 卡工具栏/内核工具栏都在**本编辑器内**；overlay 类浮层 portal 到 body ⇒ 只能全局查。
    const inEditor = host.querySelectorAll<HTMLElement>(".ne-card-toolbar, .ne-ui-toolbar");
    const portaled = document.querySelectorAll<HTMLElement>(".ne-ui-boundary-popover, ne-overlay-tmp, .ant-dropdown, .ant-select-dropdown, .ant-popover");
    return [...inEditor, ...portaled].some(isVisible);
  };
  const fireLeave = (card: Element): void => {
    const fire = (el: Element): void => {
      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true, view: window }));
    };
    fire(card);
    card.querySelectorAll?.("ne-table-wrap").forEach(fire);
  };
  const scheduleHide = (card: Element | null): void => {
    if (!card?.isConnected) return;
    clearHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined;
      // The pointer may cross a small physical gap between a card and its
      // toolbar. Keep Lake alive during the grace period; only synthesize the
      // normal leave after the pointer stayed outside both contexts.
      if (card.matches(":hover") || pointerInToolbar) return;
      fireLeave(card);
      if (lastCard === card) lastCard = null;
    }, HIDE_GRACE_MS);
  };

  const onMouseOver = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target) return;
    if (isToolbarContext(target)) {
      pointerInToolbar = true;
      clearHide();
      return;
    }
    pointerInToolbar = false;
    if (!host.contains(target)) return;
    const card = target.closest?.(CARD_SELECTOR);
    if (card) {
      lastCard = card;
      clearHide();
    }
  };

  // Keep Lake's own hide timer from starting while the pointer is crossing the
  // gap toward a toolbar. The delayed synthetic leave below handles the true
  // exit path and is intentionally tolerant of a few hundred ms of travel.
  const onMouseLeaveCapture = (event: MouseEvent): void => {
    if (!event.isTrusted) return;
    const target = event.target as Element | null;
    const card = target?.closest?.(CARD_SELECTOR);
    if (!target || !card || !host.contains(target) || !visibleToolbarExists()) return;
    event.stopImmediatePropagation();
    scheduleHide(card);
  };

  const onMouseOut = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target || !isToolbarContext(target)) return;
    const related = event.relatedTarget as Element | null;
    if (isToolbarContext(related)) return;
    pointerInToolbar = false;
    scheduleHide(lastCard);
  };

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseleave", onMouseLeaveCapture, true);
  document.addEventListener("mouseout", onMouseOut, true);
  return () => {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseleave", onMouseLeaveCapture, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    clearHide();
    pointerInToolbar = false;
    lastCard = null;
  };
}

