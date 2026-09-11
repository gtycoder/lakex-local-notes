/**
 * 桌面多标签大纲的数据接线：
 *  - 订阅内核 tocChange + 打开文档时轮询（toc 数据就绪晚于 ready）；
 *  - 滚动高亮（rAF 节流，位置探测可见标题）；
 *  - 虚拟渲染分批重建后重算；
 *  - tab 隐藏时暂停滚动计算；卸载时全部清理。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { OutlineController, type OutlineEntry } from "./OutlineController";
import { lakeBridge, resolveScrollNode, type LakeEditorInstance, type LakeKernelBridge } from "../editor/lakeRuntime";

function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}

export function useOutline(
  editor: LakeEditorInstance | null,
  host: HTMLElement | null,
  noteId: string,
  enabled: boolean,
  /** 标签是否可见（控制滚动高亮计算；数据订阅不受影响） */
  active: boolean
): { controller: OutlineController; refresh: () => void } {
  const controller = useMemo(() => new OutlineController(noteId), [noteId]);
  const computeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled || !editor || !host) {
      computeRef.current = () => {};
      return;
    }
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number): void => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const readToc = (): void => {
      try {
        const kernel = lakeBridge(editor).kernel;
        const toc = kernel?.getDocExtraContent?.()?.toc;
        if (Array.isArray(toc)) {
          controller.updateToc(toc as OutlineEntry[]);
        }
      } catch {
        /* 忽略 */
      }
    };

    // 滚动高亮
    let raf = 0;
    let activeId: string | null = null;
    let lastScrollTop = 0;
    let hasScrollSample = false;
    const compute = (): void => {
      if (!active) return;
      const scroller = resolveScrollNode(host);
      const items = controller.getVisibleItems();
      if (!scroller || !items.length) return;

      const scrollTop = scroller.scrollTop;
      const movingDown = hasScrollSample && scrollTop > lastScrollTop + 1;
      const movingUp = hasScrollSample && scrollTop < lastScrollTop - 1;
      lastScrollTop = scrollTop;
      hasScrollSample = true;

      // 使用视口上方约四分之一作为“当前章节线”，比卡在最顶边稳定，
      // 也能避免 H2/H3 边界因虚拟渲染短暂缺少 DOM 而跳回 H1。
      const vp = scroller.getBoundingClientRect();
      const anchorTop = vp.top + Math.min(120, Math.max(48, vp.height * 0.24));
      let candidate: string | null = null;
      let candidateIndex = -1;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const el = host.querySelector(`[id="${escapeId(item.id)}"]`) as HTMLElement | null;
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        // 不要因为一个虚拟节点暂时不存在就 break；后面的已渲染标题仍可能可用。
        if (top <= anchorTop) {
          candidate = item.id;
          candidateIndex = i;
        }
      }

      if (candidate === null && scrollTop < 4) {
        candidate = items[0].id;
        candidateIndex = 0;
      }
      if (candidate === null) return;

      // 只在滚动方向允许的方向切换。这样向下滚过 H2/H3 边界时，
      // 即使 H2/H3 的 DOM 正在异步重建，也不会瞬间回跳到更高层的 H1。
      const activeIndex = activeId ? items.findIndex((item) => item.id === activeId) : -1;
      if (activeIndex >= 0 && ((movingDown && candidateIndex < activeIndex) || (movingUp && candidateIndex > activeIndex))) {
        return;
      }

      if (candidate !== activeId) {
        activeId = candidate;
        controller.setSelected(candidate);
        if (controller.isKeepCurrentExpand()) controller.expandAncestorsOf(candidate);
      }
    };

    const onScroll = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    computeRef.current = compute;

    // 打开文档：toc 就绪晚于 ready；重开文档时内核也可能晚于本 effect 就绪（此前 !kernel 直接 return → 永不重建 = “关闭重开大纲不渲染”）。
    // 改为在轮询里动态取内核，就绪后再订阅 tocChange，并持续到有内容（≤ 40 次 × 200ms ≈ 8s）。
    let offToc: (() => void) | undefined;
    const subscribeToc = (): void => {
      if (offToc) return;
      try {
        const kernel = lakeBridge(editor).kernel;
        offToc = kernel?.onPluginEvent?.("tocChange", readToc);
      } catch {
        /* 忽略 */
      }
    };
    let attempts = 0;
    const poll = (): void => {
      subscribeToc();
      readToc();
      compute();
      if (controller.getRootItems().length === 0 && attempts < 40) {
        attempts += 1;
        later(poll, 200);
      }
    };
    later(poll, 0);

    // 编辑时 contentchange 后兜底刷新（tocChange 由内核 aftercontentchange 触发）
    let contentTimer: number | undefined;
    const onContent = (): void => {
      window.clearTimeout(contentTimer);
      contentTimer = window.setTimeout(readToc, 200);
    };
    try {
      lakeBridge(editor).on?.("contentchange", onContent);
    } catch {
      /* 忽略 */
    }

    const scroller = resolveScrollNode(host);
    scroller.addEventListener("scroll", onScroll, { passive: true });

    // 虚拟渲染分批重建后重算高亮
    let renderer: LakeKernelBridge["renderer"] = undefined;
    try {
      renderer = lakeBridge(editor).renderer;
    } catch {
      /* 忽略 */
    }
    const onTile = (): void => compute();
    renderer?.on?.("tileRenderCompleted", onTile);
    renderer?.on?.("generalRenderCompleted", onTile);

    return () => {
      try {
        offToc?.();
      } catch {
        /* 忽略 */
      }
      try {
        lakeBridge(editor).off?.("contentchange", onContent);
      } catch {
        /* 忽略 */
      }
      renderer?.off?.("tileRenderCompleted", onTile);
      renderer?.off?.("generalRenderCompleted", onTile);
      scroller.removeEventListener("scroll", onScroll);
      window.clearTimeout(contentTimer);
      for (const id of timers) window.clearTimeout(id);
      if (raf) cancelAnimationFrame(raf);
      computeRef.current = () => {};
    };
  }, [editor, host, noteId, enabled, active, controller]);

  const refresh = useCallback(() => {
    computeRef.current?.();
  }, []);

  return { controller, refresh };
}
