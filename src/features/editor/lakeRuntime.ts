import React from "react";
import { renderToString } from "react-dom/server";
import { Doc, DefaultEditorConfig } from "lakex-editor-react-component";
import { uploadLakeResource } from "./resourceUpload";
import { BoardCard } from "./BoardCard";

export interface LakeEditorInstance {
  setDocument(type: "text/lake", content: string): void;
  getDocument(type: "text/lake"): string;
  on(event: string, listener: () => void): void;
  off?: (event: string, listener: () => void) => void;
  destroy?: () => void;
  destory?: () => void;
}

/** Deep merge: defaults ← overrides */
function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    const ov = overrides[key];
    const bv = result[key];
    if (key === "customCard" && ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      const bo = bv as Record<string, unknown>;
      const oo = ov as Record<string, unknown>;
      result[key] = {
        ...bo,
        ...oo,
        cards: [...((bo.cards as unknown[]) || []), ...((oo.cards as unknown[]) || [])],
      };
    } else if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      result[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

/**
 * Prepare customCard cards for Doc.createOpenEditor().
 * LakexEditor's i() spreads card.config to top level and resolves
 * slash label/description from () => ({zhCN, enUS}) to strings.
 * Without this, registerCard() reads e.name as undefined.
 */
function prepareCustomCards(config: Record<string, unknown>): void {
  const cc = config.customCard as { cards?: unknown[] } | undefined;
  if (!cc?.cards) return;
  cc.cards = cc.cards.map((card: any) => {
    if (!card.config) return card;
    const cfg = card.config;
    const slash = { ...cfg.slash };
    if (typeof slash.label === "function") {
      const r = slash.label();
      slash.label = r.zhCN;
    }
    if (typeof slash.description === "function") {
      const r = slash.description();
      slash.description = r.zhCN;
    }
    return { ...cfg, slash };
  });
}

/** Render customCard icon SVG symbols into document.body */
function ensureCustomCardIcons(config: Record<string, unknown>): void {
  const SPRITE_ID = "icon-lakexui-custom-cards";
  if (document.getElementById(SPRITE_ID)) return;
  const cc = config.customCard as { cards?: Array<Record<string, unknown>> } | undefined;
  if (!cc?.cards) return;
  const icons = cc.cards
    .filter((c) => c.icon)
    .map((c) => renderToString(React.createElement(c.icon as React.ComponentType)));
  if (icons.length === 0) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = SPRITE_ID;
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = icons.join("");
  document.body.prepend(svg);
}

declare global {
  interface Window {
    /** 在 DevTools 控制台手动调用，输出最近一次编辑器初始化的耗时明细 */
    __lakePerfReport?: () => void;
  }
}

/** 性能埋点：默认只打 mark（开销极小），控制台执行 window.__lakePerfReport() 查看明细 */
function lakeMark(name: string): void {
  try { performance.mark(name); } catch { /* 非浏览器环境忽略 */ }
}

function lakeMeasure(name: string, startMark: string, endMark: string): void {
  try {
    if (performance.getEntriesByName(startMark).length) performance.measure(name, startMark, endMark);
  } catch { /* 忽略 */ }
}

/** 长任务（Long Tasks）观测：量化 setDocument 之后主线程的阻塞 */
const lakeLongTasks: Array<{ start: number; duration: number }> = [];
let lakeLongTaskObserver: PerformanceObserver | null = null;

function ensureLakeLongTaskObserver(): void {
  if (lakeLongTaskObserver || typeof PerformanceObserver === "undefined") return;
  try {
    lakeLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        lakeLongTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
      }
    });
    lakeLongTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch { /* 环境不支持则忽略 */ }
}

let lakeLastDocInitPerf: Record<string, unknown> | null = null;

if (typeof window !== "undefined") {
  window.__lakePerfReport = () => {
    try {
      const measures = performance
        .getEntriesByType("measure")
        .filter((e) => e.name.startsWith("lake:"))
        .map((e) => ({ name: e.name, duration: `${Math.round(e.duration)}ms`, start: `${Math.round(e.startTime)}ms` }));
      console.table(measures);
      const marks = performance
        .getEntriesByType("mark")
        .filter((m) => m.name.startsWith("lake:"))
        .map((m) => ({ name: m.name, t: `${Math.round(m.startTime)}ms` }));
      console.table(marks);
    } catch (error) {
      console.warn("__lakePerfReport failed", error);
    }
    try {
      if (lakeLongTasks.length) {
        const total = lakeLongTasks.reduce((sum, t) => sum + t.duration, 0);
        const last = lakeLongTasks[lakeLongTasks.length - 1];
        console.group(`长任务（共 ${lakeLongTasks.length} 个，合计 ${total}ms，最后结束于 ${last ? last.start + last.duration + "ms" : "?"}）`);
        console.table([...lakeLongTasks].sort((a, b) => a.start - b.start).map((t) => ({ start: `${t.start}ms`, duration: `${t.duration}ms` })));
        console.groupEnd();
      } else {
        console.warn("未观测到长任务（可能尚未打开文档，或未在编辑器创建前启用观测）");
      }
      if (lakeLastDocInitPerf) {
        console.group("Lake docInitPerf（parseTime/renderTime/nodeLength）");
        console.table([lakeLastDocInitPerf]);
        console.groupEnd();
      } else {
        console.log("尚未收到 Lake docInitPerf（若编辑器已打开，说明 monitorLog 订阅未生效）");
      }
      // TOC 探测：区分「侧边栏没创建 / 数据为空 / 数据有但 CSS 隐藏」
      try {
        // TOC 条目渲染为 div.ne-toc-item（不是 <a>），并探测尺寸/定位判断是否「渲染了但看不见」
        const tocSidebar = document.querySelector(".ne-toc-sidebar, .ne-viewer-toc-sidebar");
        const tocItems = tocSidebar ? tocSidebar.querySelectorAll(".ne-toc-item").length : 0;
        const tocAnchors = tocSidebar ? tocSidebar.querySelectorAll("a").length : 0;
        const rect = tocSidebar ? tocSidebar.getBoundingClientRect() : null;
        const cs = tocSidebar ? getComputedStyle(tocSidebar) : null;
        console.group("TOC 探测（打开后跑一次；编辑后再跑一次对比）");
        console.table([{
          sidebar存在: !!tocSidebar,
          条目div数: tocItems,
          条目a数: tocAnchors,
          尺寸: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : "-",
          display: cs?.display, visibility: cs?.visibility, opacity: cs?.opacity, position: cs?.position,
          leftTop: rect ? `${Math.round(rect.left)},${Math.round(rect.top)}` : "-",
          html片段: tocSidebar ? tocSidebar.innerHTML.slice(0, 120).replace(/\s+/g, " ") : "(无侧边栏)",
        }]);
        console.groupEnd();
      } catch { /* 忽略 */ }
    } catch { /* 忽略 */ }
    try {
      // 本地图片资源请求的实际发起时间（Resource Timing，回顾式，无需提前监听）
      const images = performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("127.0.0.1:19876/"))
        .map((e) => ({
          name: e.name.replace(/^http:\/\/127\.0\.0\.1:19876\//, "").slice(0, 64),
          start: `${Math.round(e.startTime)}ms`,
          duration: `${Math.round(e.duration)}ms`,
        }))
        .sort((a, b) => parseFloat(a.start) - parseFloat(b.start));
      if (images.length) {
        console.group("本地图片请求（按发起时间排序）");
        console.table(images);
        console.log(`首图发起: ${images[0].start}，共 ${images.length} 个请求，最后一个: ${images[images.length - 1].start}`);
        console.groupEnd();
      } else {
        console.warn("未发现本地图片请求（文档可能没有图片，或尚未打开）");
      }
    } catch { /* 忽略 */ }
  };
}

/**
 * 虚拟渲染（正式实现，原 experiment/virtual-rendering 分支收敛）
 * ==============================================================
 * 背景：Lake 1.6.0+ 的 virtualRendering 解决「大文档首屏图片 hydration 被拖后
 * ~3.5s」的实测问题（107 个 codeblock 卡片时，实测首图 3.5s→88ms）。
 *
 * 关键前提（来自 lakex-editor-react-component README + dist 反编译）：
 *  - scrollNode 必须指向真实滚动容器：本项目经高度链修复后是 .ne-editor-wrap
 *    （body overflow:hidden，Lake 默认回退 document.scrollingElement/body 会拿错，
 *     导致虚拟渲染视口测量错误、TOC 高亮/跳转错位）
 *  - cardLazyInit = allowCardLazyInit 的配置键：视口外卡片懒初始化（配合
 *    ensureCardsInViewHydrated 修复粘贴卡片卡壳）
 */
const VIRTUAL_RENDERING = {
  enabled: true,
  scrollContainerSelector: ".document-pane",
  cardLazyInit: true,
};

/**
 * 解析虚拟渲染/大纲定位的真实滚动容器。
 *
 * 高度链修复后（styles.css .lake-editor-tab 高度链），真实滚动容器是 Lake 原生
 * 的 `.ne-editor-wrap`（height:100% + overflow-y:auto）——TOC 侧边栏是 absolute
 * 钉在 `.ne-editor-body` 上的，只有内部滚动时大纲才不会滚出视口，且
 * scrollNode 的 getBoundingClientRect 才是正确的视口测量基准。
 *
 * 说明：
 *  - 新建标签元素在编辑器创建时尚未布局（useEffect 同步阶段 clientHeight=0），
 *    读 offsetHeight 强制同步布局，让高度落地后再交给 Lake；
 *  - 仅 `.lake-editor-tab`（桌面多标签）启用内部滚动；移动端单编辑器路径
 *    （无 scrollNode 参数）仍走外层 .document-pane，行为不变。
 */
export function resolveScrollNode(scrollNode?: HTMLElement | null): HTMLElement {
  const hostNode = (scrollNode
    || (document.querySelector(VIRTUAL_RENDERING.scrollContainerSelector) as HTMLElement | null)
    || document.scrollingElement
    || document.body) as HTMLElement;
  void hostNode.offsetHeight;
  if (hostNode.classList?.contains("lake-editor-tab")) {
    const wrap = hostNode.querySelector?.(".ne-editor-wrap") as HTMLElement | null;
    if (wrap) return wrap;
  }
  return hostNode;
}

export interface LakeEditorPrefs {
  /** 正文字号（内核支持 12/13/14/15/16/19/22/24） */
  fontSize?: number;
  /** 显示编辑器工具栏 */
  showToolbar?: boolean;
  /**
   * 彻底禁用原生编辑 TOC 侧栏（桌面多标签自建大纲时置 true）。
   * 仅关闭编辑模式 UI：内核 toc 数据与 tocChange 事件照常产生（详见 docs/OUTLINE-RESEARCH.md §9）。
   * 移动端（LakeEditor）不传此字段，保持原生行为。
   */
  disableNativeToc?: boolean;
}

export function createLakeDocument(
  element: HTMLElement,
  mode: "viewer" | "editor",
  onChange: () => void,
  tocEnabled: boolean,
  noteId: string,
  scrollNode?: HTMLElement | null,
  prefs?: LakeEditorPrefs
): LakeEditorInstance {
  const mount = document.createElement("div");
  mount.className = "lake-editor-mount ne-doc-major-editor";
  element.replaceChildren(mount);

  const prefsSize = typeof prefs?.fontSize === "number" ? prefs.fontSize : 18;
  const customOptions: Record<string, unknown> = {
    disabledPlugins: mode === "viewer"
      ? ["save", "toolbar", "emoji"]
      : ["save", "emoji", ...(prefs?.showToolbar === false ? ["toolbar"] : [])],
    input: {},
    defaultFontsize: prefsSize,
    toc: { enable: mode === "viewer" ? tocEnabled : !!tocEnabled && !prefs?.disableNativeToc },
    codeblock: { codemirrorURL: "./vendor/lakex-doc/codemirror.js" },
    math: { KaTexURL: ["./vendor/lakex-doc/katex.min.js", "https://gw.alipayobjects.com/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js"] },
    image: {
      createUploadPromise: (request: unknown) => uploadLakeResource(request, noteId),
      // 本地资源服务器 URL 必须排除，否则 Lake 每次 setDocument 都会重新下载并上传本地图片
      isCaptureImageURL: (url: string) => !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("http://127.0.0.1:19876/"),
    },
    file: {
      createUploadPromise: (request: unknown) => uploadLakeResource(request, noteId),
    },
    slash: {
      cardSelect: {
        general: {
          groups: (() => {
            const groups = (DefaultEditorConfig as any).slash?.cardSelect?.general?.groups?.filter(
              (g: any) => g.name !== "third-party-services"
            ) || [];
            for (const g of groups) {
              if (g.title === "程序员" || g.name === "developer") {
                if (!g.items.includes("custom-board-card")) { g.items = [...(g.items || []), "custom-board-card"]; }
                break;
              }
            }
            return groups;
          })(),
        },
        table: {
          groups: (DefaultEditorConfig as any).slash?.cardSelect?.table?.groups?.filter(
            (g: any) => g.name !== "third-party-services"
          ) || [],
        },
      },
    },
    customCard: { cards: [BoardCard] },
    ...(VIRTUAL_RENDERING.enabled
      ? {
          virtualRendering: true,
          scrollNode: () => resolveScrollNode(scrollNode),
          cardLazyInit: VIRTUAL_RENDERING.cardLazyInit,
        }
      : {}),
  };

  const mergedOptions = deepMerge(
    DefaultEditorConfig as Record<string, unknown>,
    customOptions
  );

  prepareCustomCards(mergedOptions);
  ensureCustomCardIcons(mergedOptions);

  ensureLakeLongTaskObserver();
  lakeMark("lake:create:start");
  const editor = mode === "viewer"
    ? (Doc as any).createOpenViewer(mount, mergedOptions)
    : (Doc as any).createOpenEditor(mount, mergedOptions);

  lakeMark("lake:create:end");
  lakeMeasure("lake:create:openEditor", "lake:create:start", "lake:create:end");
  if (mode === "editor") {
    editor.on("contentchange", onChange);
    // 虚拟渲染下 Lake 原生 TOC watcher 的二分探测失效（视口外标题无 DOM），
    // 自研滚动跟随高亮 + 点击精确滚动；另有表格浮动工具栏 hover 桥。
    // 清理函数挂在 editor 上由 destroyLakeEditor 调。
    try {
      const disposes: Array<() => void> = [];
      if (!prefs?.disableNativeToc) {
        try { disposes.push(setupTocScrollFollow(element, editor, () => resolveScrollNode(scrollNode))); } catch { /* 忽略 */ }
      }
      try { disposes.push(setupCardToolbarHoverBridge(element)); } catch { /* 忽略 */ }
      (editor as any).__disposeExtras = () => {
        for (const dispose of disposes) {
          try { dispose(); } catch { /* 忽略 */ }
        }
      };
    } catch { /* 非编辑器环境忽略 */ }
  }
  // 订阅 Lake 内置性能监控：docInitPerf（code 55），直接给出异步渲染管线的
  // parseTime / renderTime / nodeLength，用于量化 setDocument 之后的主线程耗时
  try {
    (editor as any).on?.("monitorLog", (payload: any) => {
      const d = payload?.data;
      if (d && typeof d.m1 === "number" && typeof d.m2 === "number") {
        lakeMark("lake:render:completed");
        lakeLastDocInitPerf = {
          parseTime: d.m1,
          renderTime: d.m2,
          nodeLength: d.m4,
          total: (d.m1 || 0) + (d.m2 || 0),
        };
      }
    });
  } catch { /* 非编辑器环境忽略 */ }
  return editor;
}

/** 虚拟渲染 + cardLazyInit 下，粘贴/新建的卡片可能永远停留在未水合的空壳
 * （Lake 的可见性观察器观察的是 hole 节点，hole.$appear 不会传播到卡片 UI；
 *  实测直接调用 卡片._neRef._virtualNode.$appear() 可立即水合）。
 * 这里做修复性水合：contentchange / 滚动 / 渲染批次完成后，对视口内未 appear 的
 * 卡片主动 $appear。保留 cardLazyInit 的懒加载收益，同时保证粘贴立即可见。 */
function ensureCardsInViewHydrated(host: HTMLElement): void {
  try {
    const scroller = host.querySelector?.(".ne-editor-wrap") || host;
    const vp = scroller.getBoundingClientRect();
    host.querySelectorAll("ne-card").forEach((card) => {
      const vn = (card as any)._neRef?._virtualNode;
      if (!vn || vn.isAppear) return;
      const r = card.getBoundingClientRect();
      if (r.top < vp.bottom && r.bottom > vp.top && r.width > 0 && r.height > 0) {
        vn.$appear();
      }
    });
  } catch { /* 忽略 */ }
}

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
function setupCardToolbarHoverBridge(host: HTMLElement): () => void {
  let lastCard: Element | null = null;
  const CARD_SELECTOR = "ne-card, ne-table-hole, ne-alert-hole, ne-container-hole";
  const isToolbarContext = (el: Element | null): boolean =>
    !!el?.closest?.(".ne-card-toolbar, .ne-ui-boundary-popover, ne-overlay-tmp, [data-event-boundary=\"overlay\"]");

  // 记录指针最近停留的卡片（= 当前工具栏的关联卡片）
  const onMouseOver = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target || !host.contains(target)) return;
    const card = target.closest?.(CARD_SELECTOR);
    if (card) lastCard = card;
  };

  // 拦截：卡片 → 工具栏上下文的真实 mouseleave。
  // 多 tab 隔离：document 捕获监听对所有实例生效，必须用 host.contains 限定只处理
  // 本编辑器容器内的卡片事件——否则其他 tab 的实例也会拦截/干预本 tab 的工具栏行为
  const onMouseLeaveCapture = (event: MouseEvent): void => {
    if (!event.isTrusted) return;
    const target = event.target as Element | null;
    if (!target || !host.contains(target)) return;
    if (target?.closest?.(CARD_SELECTOR) && isToolbarContext(event.relatedTarget as Element | null)) {
      event.stopImmediatePropagation();
    }
  };

  // 离开工具栏上下文（含移回卡片/移到外部）：补发合成 mouseleave 触发正常隐藏。
  // 注意：Lake 的卡片工具栏监听绑在卡片的 _rootNode 上——表格的 _rootNode 是
  // ne-table-wrap（ne-table-hole 的子孙，而非 hole 本身），所以对跟踪到的卡片
  // 及其 ne-table-wrap 子孙都补发，保证命中监听元素。
  const onMouseOut = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target || !isToolbarContext(target)) return;
    const related = event.relatedTarget as Element | null;
    if (isToolbarContext(related)) return; // 工具栏内部移动（如进下拉菜单）
    if (lastCard?.isConnected) {
      const fire = (el: Element): void => {
        el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true, view: window }));
      };
      fire(lastCard);
      lastCard.querySelectorAll?.("ne-table-wrap").forEach(fire);
    }
    lastCard = null;
  };

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseleave", onMouseLeaveCapture, true);
  document.addEventListener("mouseout", onMouseOut, true);
  return () => {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseleave", onMouseLeaveCapture, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    lastCard = null;
  };
}

/** 虚拟渲染下 Lake 原生 TOC watcher 失效（二分探测视口外标题无 DOM，永远 -1 不选中）。
 * 自研滚动跟随高亮 + 点击精确滚动：
 *  - 高亮：滚动时按文档序遍历 toc 标题，取位于视口上 1/3 带内的最后（即当前）标题，
 *    给对应 .ne-toc-item 加 ne-toc-selected（与 Lake 的 selected 状态同语义）。
 *  - 点击：Lake 的 scrollByNodeId 负责渲染目标单元并初滚；cardLazyInit 下邻近卡片
 *    是占位高度，首次定位会偏，这里在 50/200ms 做两次精确校正。
 * 返回清理函数。 */
function setupTocScrollFollow(
  host: HTMLElement,
  editor: LakeEditorInstance | null,
  getScrollNode: () => HTMLElement
): () => void {
  let cleanup: (() => void) | null = null;
  let sidebar: HTMLElement | null = null;
  let activeId: string | null = null;
  let pollTimer: number | undefined;
  let scrollTimer: number | undefined;

  const getTocIds = (): string[] => {
    try {
      const toc = (editor as any)?.kernel?.getDocExtraContent?.()?.toc;
      return Array.isArray(toc) ? toc.map((t: any) => t?.id).filter(Boolean) : [];
    } catch { return []; }
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
  // 审计 #15：所有延迟定时器统一登记，destroy 时清理（避免销毁后回调空跑）
  const pendingTimers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => { pendingTimers.delete(id); fn(); }, ms);
    pendingTimers.add(id);
  };
  const clearPendingTimers = (): void => {
    for (const id of pendingTimers) window.clearTimeout(id);
    pendingTimers.clear();
  };
  const scheduleUpdate = (): void => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(update, 80);
    // 虚拟渲染异步重建 DOM：延迟重算 + 视口内懒卡片水合（修复粘贴/懒初始化卡壳）
    later(update, 250);
    later(update, 500);
    later(() => ensureCardsInViewHydrated(host), 120);
    later(() => ensureCardsInViewHydrated(host), 400);
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
    window.setTimeout(() => correctScrollTo(id), 50);
    window.setTimeout(() => correctScrollTo(id), 200);
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
      window.clearTimeout(contentChangeTimer);
      contentChangeTimer = window.setTimeout(() => {
        ensureCardsInViewHydrated(host);
        update();
      }, 120);
      later(() => ensureCardsInViewHydrated(host), 600);
      later(() => ensureCardsInViewHydrated(host), 1500);
    };
    try { (editor as any)?.on?.("contentchange", onContentChange); } catch { /* 忽略 */ }
    // 虚拟渲染每批重建完成后重算高亮（滚动瞬间视口顶标题可能尚未渲染）
    let renderer = null;
    try { renderer = (editor as any)?.renderer; } catch { /* 忽略 */ }
    const onTileRender = (): void => { update(); ensureCardsInViewHydrated(host); };
    renderer?.on?.("tileRenderCompleted", onTileRender);
    renderer?.on?.("generalRenderCompleted", onTileRender);
    cleanup = () => {
      scroller.removeEventListener("scroll", onScroll);
      el.removeEventListener("click", onClick, true);
      try { (editor as any)?.off?.("contentchange", onContentChange); } catch { /* 忽略 */ }
      window.clearTimeout(contentChangeTimer);
      clearPendingTimers();
      observer.disconnect();
      renderer?.off?.("tileRenderCompleted", onTileRender);
      renderer?.off?.("generalRenderCompleted", onTileRender);
      window.clearTimeout(scrollTimer);
      sidebar = null;
      activeId = null;
    };
    window.setTimeout(update, 0);
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
  window.setTimeout(tryBind, 0);
  window.setTimeout(tryBind, 600);
  pollTimer = window.setInterval(tryBind, 250);
  try {
    (editor as any)?.kernel?.onPluginEvent?.("tocChange", () => {
      window.setTimeout(tryBind, 0);
      window.setTimeout(() => apply(activeId, true), 60);
    });
  } catch { /* 忽略 */ }

  return () => {
    window.clearInterval(pollTimer);
    window.clearTimeout(scrollTimer);
    cleanup?.();
  };
}

/** 修复：Lake 编辑器 TOC 侧边栏创建时用空 toc 渲染（jI.render(GY, {toc: []})），
 * 若 ready 在 tocChange 之前触发，侧边栏永远不会被填充（打开文档时大纲为 0，
 * 编辑触发新 tocChange 后才出现）。setDocument 后调用一次，把最新 toc 数据
 * 同步进侧边栏，弥补这个加载时机缺口。
 * 重试收敛：最多 8 次，延时 200ms 起、封顶 500ms（侧边栏通常 ~600ms 内出现）。 */
export function refreshTocSidebar(editor: LakeEditorInstance | null, host?: HTMLElement | null): void {
  // toc 数据权威来源是内核的 docExtraContent（TOC 管理器 setDocExtraContent({toc})）。
  // 通过内核官方事件总线重放 tocChange（与编辑触发路径一致），并重试直到条目出现。
  // 审计 #15：条目计数限定在当前编辑器容器内——多标签下其他编辑器的 TOC 条目
  // 会让本编辑器提前停止重试（第二个及后续标签偶发不显示大纲）。
  const scope = host ?? document;
  let attempt = 0;
  const tryOnce = (): void => {
    try {
      const anyEditor = editor as any;
      const kernel = anyEditor?.kernel;
      const tocData = kernel?.getDocExtraContent?.()?.toc;
      if (kernel?.emitPluginEvent && Array.isArray(tocData) && tocData.length > 0) {
        kernel.emitPluginEvent("tocChange", tocData);
      }
      const itemsAfter = scope.querySelectorAll(".ne-toc-sidebar .ne-toc-item").length;
      if (itemsAfter === 0 && attempt < 8) {
        attempt += 1;
        setTimeout(tryOnce, Math.min(200 * attempt, 500));
      }
    } catch (error) {
      console.warn("refreshTocSidebar failed", error);
    }
  };
  setTimeout(tryOnce, 0);
}

export function destroyLakeEditor(editor: LakeEditorInstance | null): void {
  try {
    (editor as any)?.__disposeExtras?.();
  } catch (error) {
    console.warn("Lake editor extras cleanup failed", error);
  }
  try {
    editor?.destroy?.();
    if (!editor?.destroy) editor?.destory?.();
  } catch (error) {
    console.warn("Lake editor cleanup failed", error);
  }
}
