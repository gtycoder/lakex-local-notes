/**
 * DT-07：虚拟渲染下的 TOC 滚动跟随 / 点击精确定位（从 lakeRuntime.createLakeDocument 抽出）。
 *
 * 为什么单独成模块：这里持有 **1 个 setInterval + 多个 setTimeout + MutationObserver +
 * 内核事件订阅**，是 createLakeDocument 里计时器最密的一段；独立成文件后 dispose 范围一眼可数
 * （返回的清理函数仍由 createLakeDocument 汇总进 __disposeExtras，时序不变）。
 *
 * 依赖倒置：本模块不 import lakeRuntime（lakeBridge 在那边），TOC 数据取法由调用方注入
 * getTocIds，避免 lakeRuntime ↔ 本模块的循环 import。
 */
import type { LakeEditorInstance, LakeKernelBridge } from "./lakeRuntime";

/** 虚拟渲染下 Lake 原生 TOC watcher 失效（二分探测视口外标题无 DOM，永远 -1 不选中）。
 * 自研滚动跟随高亮 + 点击精确滚动：
 *  - 高亮：滚动时按文档序遍历 toc 标题，取位于视口上 1/3 带内的最后（即当前）标题，
 *    给对应 .ne-toc-item 加 ne-toc-selected（与 Lake 的 selected 状态同语义）。
 *  - 点击：Lake 的 scrollByNodeId 负责渲染目标单元并初滚；cardLazyInit 下邻近卡片
 *    是占位高度，首次定位会偏，这里在 50/200ms 做两次精确校正。
 * 返回清理函数。 */
export function setupTocScrollFollow(
  host: HTMLElement,
  editor: LakeEditorInstance | null,
  getScrollNode: () => HTMLElement,
  /** 当前 TOC 节点 id 列表（调用方经内核 getDocExtraContent 提供；本模块不 import lakeRuntime，避免循环依赖）。 */
  getTocIds: () => string[],
  /** 内核事件总线（tocChange 重绑用）；由调用方从 lakeBridge(editor).kernel 传入。 */
  kernel: LakeKernelBridge["kernel"]
): () => void {
  let cleanup: (() => void) | null = null;
  let sidebar: HTMLElement | null = null;
  let activeId: string | null = null;
  let pollTimer: number | undefined;
  let scrollTimer: number | undefined;
  let removeTocChangeListener: (() => void) | null = null;
  const pendingTimers = new Set<number>();
  const later = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      pendingTimers.delete(id);
      fn();
    }, ms);
    pendingTimers.add(id);
    return id;
  };
  const clearLater = (id: number | undefined): void => {
    if (id === undefined) return;
    window.clearTimeout(id);
    pendingTimers.delete(id);
  };

  const apply = (id: string | null, force = false): void => {
    if (!force && id === activeId) return;
    activeId = id;
    if (!sidebar) return;
    sidebar.querySelectorAll(".ne-toc-item").forEach((el) => {
      el.classList.toggle("ne-toc-selected", (el as HTMLElement).dataset.id === id);
    });
    // 长大纲跟随：把选中项滚到列表可视区（复刻 Lake GY._makeVisible 的居中逻辑）。
    // Lake 原逻辑挂在自身 watcher 的 _reset 上，虚拟渲染下 watcher 失效永不触发，
    // 自研高亮需要自己补这一段。
    if (id) {
      const scroller = sidebar.querySelector(".ne-toc-view-inner") as HTMLElement | null;
      const item = scroller?.querySelector(`.ne-toc-item[data-id="${id}"]`) as HTMLElement | null;
      if (scroller && item) {
        const vp = scroller.getBoundingClientRect();
        const r = item.getBoundingClientRect();
        if (r.top <= vp.top + 10 || r.bottom >= vp.bottom - 10) {
          scroller.scrollTop += r.top - (vp.top + vp.height / 2);
        }
      }
    }
  };

  const update = (): void => {
    const scroller = getScrollNode();
    const ids = getTocIds();
    if (!ids.length) return;
    const vpTop = scroller.getBoundingClientRect().top;
    let current: string | null = null;
    for (const id of ids) {
      const el = host.querySelector(`[id="${id}"]`) as HTMLElement | null;
      if (!el) continue; // 虚拟渲染：视口外标题无 DOM，跳过
      const top = el.getBoundingClientRect().top;
      // 标题顶部越过视口顶 → 成为当前小节（经典大纲语义）
      if (top <= vpTop) current = id;
      else break; // 标题按文档序递增，之后的都在下方
    }
    if (current !== null) apply(current);
    // 文档开头是正文/引言（首个标题在视口之下）：回到顶部时高亮第一个标题，
    // 避免残留滚动到底部的旧高亮
    else if (scroller.scrollTop < 4) apply(ids[0]);
  };

  // 虚拟渲染是异步重建 DOM：滚动瞬间视口顶的标题可能还没渲染出来，
  // 单次 update 会漏算。滚动后按 80/250/500ms 重算 + 每次渲染批次完成后重算。
  // 所有延迟定时器统一登记，destroy 时清理（避免销毁后回调空跑）。
  const clearPendingTimers = (): void => {
    for (const id of pendingTimers) window.clearTimeout(id);
    pendingTimers.clear();
  };
  const scheduleUpdate = (): void => {
    clearLater(scrollTimer);
    scrollTimer = later(update, 80);
    // 虚拟渲染异步重建 DOM：延迟重算；卡片水合由独立订阅处理，
    // 以便 disableNativeToc=true 的桌面自建大纲同样生效。
    later(update, 250);
    later(update, 500);
  };

  const correctScrollTo = (id: string): void => {
    const el = host.querySelector(`[id="${id}"]`) as HTMLElement | null;
    const scroller = getScrollNode();
    if (!el || !scroller) return;
    const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (Math.abs(delta) > 2) scroller.scrollTop += delta;
  };

  const onScroll = (): void => {
    scheduleUpdate();
  };

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const item = target?.closest?.(".ne-toc-item") as HTMLElement | null;
    const id = item?.getAttribute?.("data-id");
    if (!id) return;
    // Lake 的 item onClick（冒泡阶段）会先执行 scrollByNodeId 渲染目标单元并初滚；
    // 懒卡片占位高度导致的偏差在渲染/水合稳定后校正两次。
    later(() => correctScrollTo(id), 50);
    later(() => correctScrollTo(id), 200);
  };

  const bind = (): boolean => {
    const el = host.querySelector?.(".ne-toc-sidebar") as HTMLElement | null;
    if (!el) return false;
    if (el === sidebar && cleanup) return true;
    if (cleanup) { cleanup(); cleanup = null; }
    sidebar = el;
    activeId = null;
    const scroller = getScrollNode();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("click", onClick, true);
    const observer = new MutationObserver(() => apply(activeId, true));
    observer.observe(el, { childList: true, subtree: true });
    // contentchange（粘贴/编辑/插入卡片）：异步等卡片落位后水合 + 刷新高亮。
    // 审计 #15：600/1500ms 曾把裸函数传给 setTimeout → host 为 undefined →
    // querySelectorAll 抛错被吞、水合重试完全失效；改箭头闭包并登记定时器。
    let contentChangeTimer: number | undefined;
    const onContentChange = (): void => {
      clearLater(contentChangeTimer);
      contentChangeTimer = later(update, 120);
    };
    try { editor?.on?.("contentchange", onContentChange); } catch { /* 忽略 */ }
    // 虚拟渲染每批重建完成后重算高亮（滚动瞬间视口顶标题可能尚未渲染）
    let renderer: LakeEditorInstance["renderer"];
    try { renderer = editor?.renderer; } catch { /* 忽略 */ }
    const onTileRender = (): void => update();
    renderer?.on?.("tileRenderCompleted", onTileRender);
    renderer?.on?.("generalRenderCompleted", onTileRender);
    cleanup = () => {
      scroller.removeEventListener("scroll", onScroll);
      el.removeEventListener("click", onClick, true);
      try { editor?.off?.("contentchange", onContentChange); } catch { /* 忽略 */ }
      clearLater(contentChangeTimer);
      clearPendingTimers();
      observer.disconnect();
      renderer?.off?.("tileRenderCompleted", onTileRender);
      renderer?.off?.("generalRenderCompleted", onTileRender);
      window.clearTimeout(scrollTimer);
      sidebar = null;
      activeId = null;
    };
    later(update, 0);
    return true;
  };

  const tryBind = (): void => {
    if (bind()) {
      window.clearInterval(pollTimer);
      return;
    }
    // 轮询收敛：最多 20 次（250ms × 20 ≈ 5s）；后续由 tocChange 钩子重绑
    pollCount += 1;
    if (pollCount >= 20) window.clearInterval(pollTimer);
  };
  let pollCount = 0;

  // 侧边栏创建时机晚于编辑器 ready（ready 早于 tocChange）；轮询 + tocChange 后重绑
  later(tryBind, 0);
  later(tryBind, 600);
  pollTimer = window.setInterval(tryBind, 250);
  try {
    const onTocChange = (): void => {
      later(tryBind, 0);
      later(() => apply(activeId, true), 60);
    };
    const unsubscribe = kernel?.onPluginEvent?.("tocChange", onTocChange);
    if (typeof unsubscribe === "function") {
      removeTocChangeListener = unsubscribe;
    } else if (typeof kernel?.offPluginEvent === "function") {
      removeTocChangeListener = () => kernel?.offPluginEvent?.("tocChange", onTocChange);
    }
  } catch { /* 忽略 */ }

  return () => {
    window.clearInterval(pollTimer);
    clearLater(scrollTimer);
    removeTocChangeListener?.();
    removeTocChangeListener = null;
    clearPendingTimers();
    cleanup?.();
  };
}
