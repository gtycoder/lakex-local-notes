/**
 * 虚拟渲染下的卡片水合 / 新插入卡自动打开 / 可见卡水合（header 保持原注释）。
 *
 * 261112 R2-S9：从 lakeRuntime.ts **原样搬出**（纯搬移：导出名/行为零变化）。
 * 公共符号仍由 ./lakeRuntime 门面 re-export；内核 lazy 边界不变（只被 lakeRuntime 静态 import）。
 */
import { shouldSkipBoardCardFocus } from "./canvasInteractionGate";
import { lakeBridge } from "./kernelConfig";
import type { LakeEditorInstance, LakeKernelBridge } from "./lakeRuntime";
/**
 * 内核卡片 DOM 上的私有 ref（`_neRef._virtualNode`）：虚拟渲染的 appear 状态 + 卡片实例。
 * 闭源 lakex 无类型声明 ⇒ 只声明本文件实测用到的字段，全部可选（结构变了就静默降级）。
 */
interface LakeCardVirtualNode {
  isAppear?: boolean;
  $appear?: () => void;
  _instance?: LakeCardInstance;
}

/** 卡片实例上挂 UI 控制器的两个位置（不同卡片类型各用其一）。 */
interface LakeCardInstance {
  _$cardUI?: LakeCardUiController;
  _ui?: LakeCardUiController;
}

/** 卡片 UI 控制器（表情选择器/公式编辑器）：focus() 打开浮层，getReactRef() 取 React ref。 */
interface LakeCardUiController {
  focus?: () => void;
  uiViewProxy?: { getReactRef?: () => LakeUiReactRef | null };
  _uiViewProxy?: { getReactRef?: () => LakeUiReactRef | null };
}

/** 内核 UI 的 React 组件 ref（卡片浮层挂 `_overlay`；TOC 侧栏 ref 上挂 `setNormalViewStatus`）。 */
export interface LakeUiReactRef {
  _overlay?: unknown;
  setNormalViewStatus?: (normal: boolean) => void;
}

/** 带内核私有 ref 的卡片 DOM 元素（querySelector 结果按需断言到它）。 */
interface LakeCardElement extends Element {
  _neRef?: { _virtualNode?: LakeCardVirtualNode };
}


/** 虚拟渲染 + cardLazyInit 下，粘贴/新建的卡片可能永远停留在未水合的空壳
 * （Lake 的可见性观察器观察的是 hole 节点，hole.$appear 不会传播到卡片 UI；
 *  实测直接调用 卡片._neRef._virtualNode.$appear() 可立即水合）。
 * 这里做修复性水合：contentchange / 滚动 / 渲染批次完成后，对视口内未 appear 的
 * 卡片主动 $appear。保留 cardLazyInit 的懒加载收益，同时保证粘贴立即可见。 */
function ensureCardsInViewHydrated(host: HTMLElement, getScrollNode: () => HTMLElement): void {
  try {
    const scroller = getScrollNode();
    const vp = scroller.getBoundingClientRect();
    host.querySelectorAll("ne-card").forEach((card) => {
      const vn = (card as LakeCardElement)._neRef?._virtualNode;
      if (!vn || vn.isAppear) return;
      const r = card.getBoundingClientRect();
      if (r.top < vp.bottom && r.bottom > vp.top && r.width > 0 && r.height > 0) {
        vn.$appear?.();
      }
    });
  } catch { /* 忽略 */ }
}



/**
 * 独立维护可见卡片的水合。此前它意外寄生在 setupTocScrollFollow：桌面端
 * disableNativeToc=true 时完全不会订阅，导致 Slash 新建的 inline codeblock 不会
 * 收到 $appear，继而 showCode / CodeMirror 不执行；关闭文档重开时 setDocument
 * 的水合路径又会掩盖该问题。
 */
/** 表情（unicodeEmoji）/ 公式（math）卡片在 Slash 插入后，Lake 会把选区放进卡片并调用
 * 卡片 view node 的 focus()（打开表情选择器 / 公式编辑器），但卡片 UI 是懒初始化的
 * （_uiViewProxy 未就绪时 focus() 是空操作），且选区已停在卡片内导致后续点击不再触发
 * focus——表现为“插入后出现方框，必须先点别处再点方框才能打开”。
 * 这里在卡片 DOM 出现时若选区落在卡片内，对卡片 UI 控制器（_$cardUI.focus()）做有限重试，
 * UI 就绪后即可直接弹出选择器/编辑器；点击方框时也直接触发，覆盖“第一次点击方框”的场景。
 */
export function setupInsertedCardAutoOpen(host: HTMLElement): () => void {
  const seen = new Set<string>();
  let timer: number | undefined;
  let disposed = false;

  const isTargetCard = (el: Element): boolean => {
    const name = (el as HTMLElement).dataset?.cardName || "";
    return name === "unicodeEmoji" || name === "math";
  };
  const getController = (el: Element): LakeCardUiController | null => {
    try {
      const inst = (el as LakeCardElement)._neRef?._virtualNode?._instance;
      return inst?._$cardUI || inst?._ui || null;
    } catch { return null; }
  };
  const selectionInside = (el: Element): boolean => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const node = sel.anchorNode;
      if (!node) return false;
      const container = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      return !!container && el.contains(container);
    } catch { return false; }
  };
  const overlayOpened = (controller: LakeCardUiController | null): boolean => {
    try {
      // 数学编辑器/表情选择器可能渲染到卡片外的 overlay 容器，做全局可见性检测
      const editors = document.querySelectorAll('[data-testid="ne-math-editor"], .ne-math-editor');
      for (const m of editors) {
        const r = (m as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
      const ref = controller?.uiViewProxy?.getReactRef?.() || controller?._uiViewProxy?.getReactRef?.();
      if (ref?._overlay) return true;
    } catch { /* ignore */ }
    return false;
  };

  const tryFocusCard = (el: Element, requireSelection: boolean): void => {
    const id = (el as HTMLElement).id;
    if (!id || seen.has(id)) return;
    if (requireSelection && !selectionInside(el)) return;
    seen.add(id);
    let attempts = 0;
    const tick = (): void => {
      if (disposed) return;
      const controller = getController(el);
      if (controller) {
        try { if (typeof controller.focus === "function") controller.focus(); } catch { /* ignore */ }
        if (overlayOpened(controller)) return;
      }
      attempts++;
      if (attempts < 12) timer = window.setTimeout(tick, 80);
    };
    tick();
  };

  const scan = (): void => {
    if (disposed) return;
    try {
      host.querySelectorAll("ne-card").forEach((el) => {
        if (!isTargetCard(el)) return;
        // 插入后自动打开：要求选区落在卡片内，避免误开已加载/粘贴的旧卡片
        tryFocusCard(el, true);
      });
    } catch { /* ignore */ }
  };
  const schedule = (): void => {
    if (disposed) return;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(scan, 60);
  };
  // 点击卡片方框时直接触发（含“第一次点击方框”）：不需要选区先落进卡片
  const handleCardMouseDown = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    const el = target.closest("ne-card");
    if (!el || !host.contains(el)) return;
    if (!isTargetCard(el)) return;
    const insideBoard = Boolean((target as Element).closest(".plait-board-container"));
    const canvasActive = el.querySelector<HTMLElement>("[data-canvas-interaction=active]") !== null;
    if (shouldSkipBoardCardFocus(insideBoard, canvasActive)) return;
    tryFocusCard(el, false);
  };

  const mo = new MutationObserver(schedule);
  try { mo.observe(host, { childList: true, subtree: true }); } catch { /* ignore */ }
  host.addEventListener("mousedown", handleCardMouseDown, true);
  schedule();

  return () => {
    disposed = true;
    if (timer !== undefined) window.clearTimeout(timer);
    try { mo.disconnect(); } catch { /* ignore */ }
    host.removeEventListener("mousedown", handleCardMouseDown, true);
  };
}

export function setupVisibleCardHydration(
  host: HTMLElement,
  editor: LakeEditorInstance | null,
  getScrollNode: () => HTMLElement,
  observeContentChange: boolean,
): { dispose: () => void; requestHydration: () => void } {
  const pendingTimers = new Set<number>();
  const pendingFrames = new Set<number>();
  let scrollTimer: number | undefined;
  let disposed = false;

  const runHydration = (): void => {
    if (!disposed) ensureCardsInViewHydrated(host, getScrollNode);
  };
  const later = (delay: number): void => {
    const id = window.setTimeout(() => {
      pendingTimers.delete(id);
      runHydration();
    }, delay);
    pendingTimers.add(id);
  };
  const requestHydration = (): void => {
    if (disposed) return;
    // 新建标签/切换隐藏标签时，先等一次布局帧，再给 Lake 的异步卡片渲染
    // 两个稳定窗口。所有句柄都登记，销毁时不会回调已卸载的编辑器。
    if (typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(() => {
        pendingFrames.delete(frame);
        runHydration();
      });
      pendingFrames.add(frame);
    } else {
      runHydration();
    }
    later(120);
    later(400);
  };
  const onScroll = (): void => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      scrollTimer = undefined;
      runHydration();
    }, 80);
    later(250);
    later(500);
  };
  const onContentChange = (): void => {
    // 新建卡片的 DOM / virtual node 会分批落位，保留延迟重试而非重建编辑器。
    requestHydration();
    later(600);
    later(1500);
  };
  const onTileRender = (): void => requestHydration();

  const scroller = getScrollNode();
  scroller.addEventListener("scroll", onScroll, { passive: true });
  if (observeContentChange) {
    try { editor?.on?.("contentchange", onContentChange); } catch { /* 忽略 */ }
  }
  let renderer: LakeKernelBridge["renderer"];
  try { renderer = lakeBridge(editor ?? undefined).renderer; } catch { /* 忽略 */ }
  renderer?.on?.("tileRenderCompleted", onTileRender);
  renderer?.on?.("generalRenderCompleted", onTileRender);
  requestHydration();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    scroller.removeEventListener("scroll", onScroll);
    if (observeContentChange) {
      try { editor?.off?.("contentchange", onContentChange); } catch { /* 忽略 */ }
    }
    renderer?.off?.("tileRenderCompleted", onTileRender);
    renderer?.off?.("generalRenderCompleted", onTileRender);
    window.clearTimeout(scrollTimer);
    for (const id of pendingTimers) window.clearTimeout(id);
    for (const id of pendingFrames) window.cancelAnimationFrame(id);
    pendingTimers.clear();
    pendingFrames.clear();
  };

  return { dispose, requestHydration };
}

