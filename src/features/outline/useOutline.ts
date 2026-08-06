/**
 * 桌面多标签大纲的数据接线：
 *  - 订阅内核 tocChange + 打开文档时轮询（toc 数据就绪晚于 ready）；
 *  - 滚动高亮（rAF 节流，位置探测可见标题）；
 *  - 虚拟渲染分批重建后重算；
 *  - tab 隐藏时暂停滚动计算；卸载时全部清理。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { OutlineController, type OutlineEntry } from "./OutlineController";
import { resolveScrollNode, type LakeEditorInstance } from "../editor/lakeRuntime";

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
    const kernel = (editor as any)?.kernel;
    if (!kernel) return;

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
    const compute = (): void => {
      if (!active) return;
      const scroller = resolveScrollNode(host);
      const items = controller.getVisibleItems();
      if (!scroller) return;
      if (!items.length) return;
      const vpTop = scroller.getBoundingClientRect().top;
      let current: string | null = null;
      for (const item of items) {
        const el = host.querySelector(`[id="${escapeId(item.id)}"]`) as HTMLElement | null;
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= vpTop) {
          current = item.id;
        } else {
          break;
        }
      }
      // 回到顶部（首个标题仍在视口之下）→ 高亮第一个标题
      if (current === null && scroller.scrollTop < 4 && items.length > 0) {
        current = items[0].id;
      }
      if (current !== null && current !== activeId) {
        activeId = current;
        controller.setSelected(current);
        // 保持当前展开：自动展开选中项的祖先
        if (controller.isKeepCurrentExpand()) {
          controller.expandAncestorsOf(current);
        }
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

    // 打开文档：toc 就绪晚于 ready，轮询直到有内容（≤ 40 次 × 200ms ≈ 8s）
    let attempts = 0;
    const poll = (): void => {
      readToc();
      compute();
      if (controller.getRootItems().length === 0 && attempts < 40) {
        attempts += 1;
        later(poll, 200);
      }
    };
    later(poll, 0);

    let offToc: (() => void) | undefined;
    try {
      offToc = kernel?.onPluginEvent?.("tocChange", readToc);
    } catch {
      /* 忽略 */
    }

    // 编辑时 contentchange 后兜底刷新（tocChange 由内核 aftercontentchange 触发）
    let contentTimer: number | undefined;
    const onContent = (): void => {
      window.clearTimeout(contentTimer);
      contentTimer = window.setTimeout(readToc, 200);
    };
    try {
      (editor as any)?.on?.("contentchange", onContent);
    } catch {
      /* 忽略 */
    }

    const scroller = resolveScrollNode(host);
    scroller.addEventListener("scroll", onScroll, { passive: true });

    // 虚拟渲染分批重建后重算高亮
    let renderer: any = null;
    try {
      renderer = (editor as any)?.renderer;
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
        (editor as any)?.off?.("contentchange", onContent);
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
