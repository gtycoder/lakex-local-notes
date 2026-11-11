/**
 * 锁定态（Viewer）分帧渲染（内核 option `tileRendering`）的配套工具。
 *
 * 背景（261111）：内核 ViewerRenderer 有两个渲染 controller（lakex.js 57222-57224
 * `viewer.option.isTileRendering() ? new <tile> : new <direct>`）：
 *  - direct（默认）：一次 forEach 把整篇顶层块渲完 ⇒ 长文档首帧同步阻塞（实测 1500 块 ~135ms）；
 *  - tile（`tileRendering: true`）：每帧只渲 30 个顶层块（_tileSize 硬编码，lakex.js 57095），
 *    首帧 ~9ms、长任务被摊平到 N 帧；**DOM 节点与堆总量和 direct 完全一致**（不省占用，只省阻塞）。
 *
 * 代价（必须配套，否则大纲一定出问题 —— 用户 261111 明确要求两套大纲都验证过）：
 *  1. 内核阅读态大纲点击 `_scrollTo(id)`（lakex.js 236848-236876）用
 *     `viewer.domRootNode.querySelector('[id="…"]')` 找标题，**命中不到就静默不滚**；
 *  2. 应用自建大纲点击走 `renderer.scrollByNodeId`，而 Viewer 的 renderer **没有这个方法**
 *     （实测 undefined）⇒ 落地完全依赖「目标块已在 DOM 里」的几何对齐；
 *  3. 锁/解锁切换的阅读位置恢复（EditorTab.restoreByAnchor）同理：锚点块没进 DOM 就只能按比例映射，位置会偏。
 *  ⇒ 收集期（分帧还没铺到目标块）任何「按 id 定位」都必须先 `flushViewerTiles` 把剩余块渲完，
 *    或者逐帧等到目标块出现。
 *
 * 本模块只做这三件事，不改内核行为；内核私有字段缺失时全部优雅降级（direct 渲染下等同旧行为）。
 */
import { escapeId } from "../../lib/cssEscape";
import type { LakeEditorInstance } from "./lakeRuntime";

/** Viewer 的分帧渲染控制器（闭源实例私有字段，按实测形状收敛一次；字段缺失即降级）。 */
interface ViewerTileController {
  /** 内核私有方法（lakex.js 57119）；`tileControllerOf` 已按 typeof 校验过。 */
  tileRender: () => void;
  _currentTileIndex?: number;
  _tileCount?: number;
  _total?: number;
  _tileSize?: number;
}

/** 内核硬编码的每帧块数（lakex.js 57095 `_tileSize = 30`）。 */
const TILE_SIZE_FALLBACK = 30;
/** 防御上限：内核实现变化导致索引不推进时立刻退出，不硬跑。 */
const FLUSH_GUARD = 1024;
/** 兜底等待：flush 不可用时逐帧等目标块出现（1500 块 ≈ 50 帧 ≈ 830ms）。 */
const DEFAULT_WAIT_MS = 1500;
/** 卡片/图片落地后还会改版式，对齐后补一次（与既有 50/200ms 双校正同义，只保留一次）。 */
const DEFAULT_REALIGN_MS = 140;

function viewerRenderer(editor: LakeEditorInstance | null | undefined): Record<string, unknown> | null {
  if (!editor) return null;
  const direct = (editor as unknown as { renderer?: Record<string, unknown> }).renderer;
  if (direct && typeof direct === "object") return direct;
  const legacy = (editor as unknown as { _renderer?: Record<string, unknown> })._renderer;
  return legacy && typeof legacy === "object" ? legacy : null;
}

function tileControllerOf(editor: LakeEditorInstance | null | undefined): ViewerTileController | null {
  const renderer = viewerRenderer(editor);
  if (!renderer || typeof renderer !== "object") return null;
  const controller = (renderer as { _renderController?: ViewerTileController })._renderController;
  if (!controller || typeof controller.tileRender !== "function") return null;
  return controller;
}

/**
 * 把当前分帧渲染一次性推到「全部铺完」（best-effort）。
 *
 * 只对锁定态（Viewer + tileRendering）有意义：编辑态/阅读态 direct 下拿不到该 controller，
 * 直接返回 false 由调用方降级。渲染是同步的（内核 `tileRender()` 内部 forEach + pB），
 * 因此调用点会阻塞「剩余块数 / 30 帧」的时间（1500 块实测 ~100ms），只在用户显式跳转/恢复位置时调。
 */
export function flushViewerTiles(editor: LakeEditorInstance | null | undefined): boolean {
  const controller = tileControllerOf(editor);
  if (!controller) return false;
  const total = Number(controller._total);
  const size = Number(controller._tileSize) > 0 ? Number(controller._tileSize) : TILE_SIZE_FALLBACK;
  const tileCount = Number.isFinite(total) && total > 0
    ? Math.ceil(total / size)
    : Number(controller._tileCount ?? 0);
  if (!Number.isFinite(tileCount) || tileCount <= 0) return false;
  let lastIndex = -1;
  for (let guard = 0; guard < FLUSH_GUARD; guard += 1) {
    const index = Number(controller._currentTileIndex ?? 0);
    if (!Number.isFinite(index) || index >= tileCount) return true;
    // 索引不推进 = 内核实现变了：立刻停手，别把同一批块反复 init。
    if (index === lastIndex) return false;
    lastIndex = index;
    try {
      controller.tileRender();
    } catch {
      return false;
    }
  }
  return true;
}

/** 目标块是否已在 DOM：只认当前挂载点，锁/解锁过渡期旧层（.is-outgoing）不算。 */
export function findRenderedNode(host: HTMLElement | null | undefined, id: string): HTMLElement | null {
  if (!host || !id) return null;
  const query = (root: ParentNode): HTMLElement | null => {
    try {
      return root.querySelector<HTMLElement>(`[id="${escapeId(id)}"]`);
    } catch {
      return null;
    }
  };
  // 宿主下挂着挂载点时只认「当前层」：锁/解锁过渡期旧层（.is-outgoing）几何属于上一态，
  // 命中它会把新实例滚到错误位置（EditorTab 的锚点恢复实测踩过）。只有旧层时返回 null，
  // 让调用方等新实例渲染，而不是按旧层算。
  const mounts = Array.from(host.querySelectorAll<HTMLElement>(":scope > .lake-editor-mount"));
  if (mounts.length) {
    // 新实例总是 append 在旧实例之后（createLakeDocument 先建挂载点再 append）⇒ 取「最后一个未标记
    // is-outgoing 的挂载点」= 当前实例；锁/解锁过渡期旧层尚未打标记时也不会误命中旧层几何。
    let current: HTMLElement | null = null;
    for (const mount of mounts) if (!mount.classList.contains("is-outgoing")) current = mount;
    return current ? query(current) : null;
  }
  // 结构不是「宿主 > 挂载点」（例如调用方直接传 mount）时退回整棵子树。
  return query(host);
}

function alignNode(scroller: HTMLElement, el: HTMLElement, offset: number): void {
  const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
  if (Math.abs(delta) > 1) scroller.scrollTop += delta;
}

/**
 * 只把分帧推进到「目标块已经进 DOM」为止（tile 是顺序渲染，目标在第 n 帧 ⇒ 渲到第 n 帧即可，
 * 不必整篇铺完）。锚点恢复/大纲跳转都走这里，避免为了一次定位把长文档整篇同步渲染。
 * 拿不到 controller（direct/编辑态）时退化为一次 `flushViewerTiles` 再取。
 */
function ensureNodeRendered(
  host: HTMLElement | null | undefined,
  id: string,
  editor?: LakeEditorInstance | null
): HTMLElement | null {
  const existing = findRenderedNode(host, id);
  if (existing) return existing;
  const controller = tileControllerOf(editor ?? null);
  if (!controller) {
    flushViewerTiles(editor);
    return findRenderedNode(host, id);
  }
  const total = Number(controller._total);
  const size = Number(controller._tileSize) > 0 ? Number(controller._tileSize) : TILE_SIZE_FALLBACK;
  const tileCount = Number.isFinite(total) && total > 0
    ? Math.ceil(total / size)
    : Number(controller._tileCount ?? 0);
  if (!Number.isFinite(tileCount) || tileCount <= 0) return findRenderedNode(host, id);
  let lastIndex = -1;
  for (let guard = 0; guard < FLUSH_GUARD; guard += 1) {
    const index = Number(controller._currentTileIndex ?? 0);
    if (!Number.isFinite(index) || index >= tileCount) break;
    if (index === lastIndex) break;
    lastIndex = index;
    try {
      controller.tileRender();
    } catch {
      return null;
    }
    const found = findRenderedNode(host, id);
    if (found) return found;
  }
  return findRenderedNode(host, id);
}

export interface ScrollIntoViewOptions {
  /** 目标块顶部与滚动容器顶部的间距（默认 0，与内核阅读态大纲 `_scrollTo` 同口径）。 */
  offset?: number;
  /** 兜底逐帧等待上限。 */
  timeoutMs?: number;
  /** 对齐后补一次校正的延迟（0 = 不补）。 */
  realignMs?: number;
}

/**
 * 把 id 对应的块滚到滚动容器顶部 —— `大綱点击/锚点恢复` 的统一入口。
 *
 * 目标块还没渲染（锁定态分帧收集期）时：先 `flushViewerTiles` 一次性铺完并重试；仍拿不到
 * （内核私有字段变化 / 非 tile 渲染）则逐帧等到出现，最多 `timeoutMs`。返回取消函数。
 */
export function scrollIntoViewByNodeId(
  host: HTMLElement | null | undefined,
  scroller: HTMLElement | null | undefined,
  id: string,
  editor?: LakeEditorInstance | null,
  options: ScrollIntoViewOptions = {}
): () => void {
  const offset = options.offset ?? 0;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_MS;
  const realignMs = options.realignMs ?? DEFAULT_REALIGN_MS;
  let disposed = false;
  let raf = 0;
  let timer = 0;

  const cancel = (): void => {
    disposed = true;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    window.clearTimeout(timer);
    timer = 0;
  };

  if (!host || !scroller || !id) return cancel;

  const settle = (el: HTMLElement): void => {
    alignNode(scroller, el, offset);
    if (realignMs > 0) {
      timer = window.setTimeout(() => {
        timer = 0;
        if (disposed) return;
        const again = findRenderedNode(host, id);
        if (again) alignNode(scroller, again, offset);
      }, realignMs);
    }
  };

  const immediate = findRenderedNode(host, id);
  if (immediate) {
    settle(immediate);
    return cancel;
  }

  // 分帧收集期：把分帧推进到目标块出现（顺序渲染，不整篇铺完），再取一次。
  const afterFlush = ensureNodeRendered(host, id, editor);
  if (afterFlush) {
    settle(afterFlush);
    return cancel;
  }

  // 兜底：flush 不可用（direct / 内核字段变化）时逐帧等目标块出现。
  const deadline = performance.now() + Math.max(0, timeoutMs);
  const tick = (): void => {
    raf = 0;
    if (disposed) return;
    const el = findRenderedNode(host, id);
    if (el) {
      settle(el);
      return;
    }
    if (performance.now() >= deadline) return;
    raf = window.requestAnimationFrame(tick);
  };
  raf = window.requestAnimationFrame(tick);
  return cancel;
}

/**
 * 锁定态（Viewer）原生大纲点击兜底。
 *
 * 内核阅读态大纲点击（lakex.js 236848 `_scrollTo`）在冒泡阶段用 querySelector 找标题：
 * 分帧收集期找不到就**静默不滚**。这里在宿主捕获阶段先记下 id，延后一帧再按几何对齐
 * （此时内核自己的 `_scrollTo` 已经跑过：命中时先滚过一次，我们只做同口径对齐；没命中由我们补上）。
 *
 * 另外内核阅读态大纲的「当前小节」watcher 只在滚动时重算，收集期算出来的高亮会停在首个小节，
 * 因此在 viewer `ready`（全部分帧铺完）时补发一次 scroll 事件，让它自己重算。
 * 返回清理函数。
 */
export function setupViewerTocClickAssist(
  host: HTMLElement | null | undefined,
  editor: LakeEditorInstance | null | undefined,
  getScrollNode: () => HTMLElement | null
): () => void {
  if (!host) return () => undefined;
  let cancelScroll: (() => void) | null = null;
  let raf = 0;
  let disposed = false;

  const schedule = (id: string): void => {
    if (raf) window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      if (disposed) return;
      const scroller = getScrollNode();
      if (!scroller) return;
      cancelScroll?.();
      cancelScroll = scrollIntoViewByNodeId(host, scroller, id, editor);
    });
  };

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const item = target?.closest?.(".ne-viewer-toc-sidebar .ne-toc-item") as HTMLElement | null;
    if (!item) return;
    const id = item.getAttribute("data-id") ?? item.dataset?.id;
    if (id) schedule(id);
  };

  const onReady = (): void => {
    try {
      getScrollNode()?.dispatchEvent(new Event("scroll"));
    } catch {
      /* 忽略 */
    }
  };

  host.addEventListener("click", onClick, true);
  try {
    editor?.on?.("ready", onReady);
  } catch {
    /* 忽略 */
  }

  return () => {
    disposed = true;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    cancelScroll?.();
    cancelScroll = null;
    host.removeEventListener("click", onClick, true);
    try {
      editor?.off?.("ready", onReady);
    } catch {
      /* 忽略 */
    }
  };
}