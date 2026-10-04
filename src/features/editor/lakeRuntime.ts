import React from "react";
import { renderToString } from "react-dom/server";
import { Doc, GetDefaultEditorConfig } from "@dlient/lakex-doc-react";
import { mountBlockHoverHandle } from "./blockHandleMount";
import { mountSelectionToolbar } from "./selectionToolbar/mountSelectionToolbar";
import { uploadLakeResource } from "./resourceUpload";
import { filterQuickNoteInsert } from "../quickNotes/quickNoteInsertFilter";
import type { ResourceUploadOutput } from "../../lib/types";
import { shouldSkipBoardCardFocus, useClickActivatedWheelGate } from "./canvasInteractionGate";
import { ASSET_ORIGIN } from "../../lib/assetPort";
import type { LocalAssetRef } from "../../core/assetUrl.js";
import type { AttachmentPreviewItem } from "../attachment/attachmentPreviewController.js";

/** 与下方 math.KaTexURL 保持同一份相对路径，供预注入脚本去重匹配。 */
const LAKE_KATEX_SCRIPT = "./vendor/cdn/os/lib/katex/0.16.8/dist/katex.min.js";
const LAKE_MHCHEM_SCRIPT = "./vendor/cdn/os/lib/katex/0.16.8/dist/contrib/mhchem.min.js";

/**
 * 按 katex → mhchem 顺序把本地镜像脚本注入 <body>。
 * 动态脚本默认 async=true，执行顺序无保证；显式 async=false 后经典脚本
 * 按插入顺序执行，保证 mhchem 运行时 window.katex 一定已就绪。
 * 复用 Lake gJ 的 loaded/error 属性协议，避免其再次注入或等待永不触发的 load 事件。
 */
function injectKatexScriptsInOrder(): void {
  if (typeof document === "undefined") return;
  const ensure = (src: string): void => {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.addEventListener("load", () => el.setAttribute("loaded", "true"), { once: true });
    el.addEventListener("error", () => el.setAttribute("error", "true"), { once: true });
    document.body.appendChild(el);
  };
  ensure(LAKE_KATEX_SCRIPT);
  ensure(LAKE_MHCHEM_SCRIPT);
}

export interface LakeKernelInstance {
  /** 内核命令入口（style/insertCard/insertAtSelection/delete… 与编辑器同一套命令）。 */
  execCommand?(name: string, ...args: unknown[]): unknown;
}

export interface LakeEditorInstance {
  setDocument(type: "text/lake", content: string): void;
  /** 编辑器命令入口（等同内核命令，用于 blockMenuHelpers 等处的 style/insertCard 调用）。 */
  execCommand?(name: string, ...args: unknown[]): unknown;
  /** 读取命令当前值（active 态/字号/样式：bold→"true"、style→"p"/"h1"、fontsize→px 或 "null"）。 */
  queryCommandValue?(name: string, ...args: unknown[]): unknown;
  /** 命令是否可用（链接等先用它把门：link 需选区、insertLink 需光标）。 */
  queryCommandEnabled?(name: string): unknown;
  /** 命令执行态（内核 CommandState：-1 Unavailable / 0 NotExecuted / 1 Executed / 2 Unknown）。
   *  块级命令（列表/待办/引用）的生效与禁用判据，见 useSelectionToolbar.readState。 */
  queryCommandState?(name: string): unknown;
  /** 内核实例（命令/选区都挂在这里）。 */
  kernel?: LakeKernelInstance;
  /** 锁定态 Viewer 可能不完整支持 markdown/plain（调用方需 typeof 守卫 + try/catch）。 */
  getDocument(type: "text/lake" | "text/markdown" | "text/plain"): string;
  on(event: string, listener: () => void): void;
  off?: (event: string, listener: () => void) => void;
  destroy?: () => void;
  destory?: () => void;
  /** 请求对当前可见卡片执行一次懒初始化水合。 */
  requestCardHydration?: () => void;
}

/**
 * Lake 内核运行时桥接（闭源 lakex 无类型声明）：kernel/renderer/事件系统集中在此声明，
 * 调用方经 lakeBridge(editor) 访问，避免散落的 (editor as any)（PROJECT-AUDIT 建议收敛）。
 */
export interface LakeKernelBridge {
  kernel?: {
    getDocExtraContent?(): { toc?: unknown };
    onPluginEvent?(event: string, listener: () => void): (() => void) | undefined;
  };
  renderer?: {
    execCommand?(name: string, ...args: unknown[]): unknown;
    scrollByNodeId?(id: string): unknown;
    on?(event: string, listener: () => void): unknown;
    off?(event: string, listener: () => void): unknown;
  };
  on?(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
}

/** 类型安全的 Lake 内核桥接访问器（内部一次性断言，调用点不再出现 as any）。 */
export function lakeBridge(editor: LakeEditorInstance | undefined): LakeKernelBridge {
  return (editor ?? {}) as unknown as LakeKernelBridge;
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
/** Drawnix 画板系列卡片的注册名（`configs/customCard.ts` → `cards/DrawingBoard/index.ts`）。
 *  它们和 @xiangfa 导图卡一样是 canvas，需要「点击激活滚轮门控」。 */
const BOARD_CARD_NAMES = new Set([
  "drawing-board",
  "flowchart-board",
  "uml-board",
  "drawing-mindmap-board",
]);

function withCanvasWheelGate(Comp: React.ComponentType<Record<string, unknown>>): React.ComponentType<Record<string, unknown>> {
  return React.forwardRef<unknown, Record<string, unknown>>((props, forwardedRef) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    useClickActivatedWheelGate(rootRef);
    return React.createElement(
      "div",
      { ref: rootRef, className: "mindmap-interaction-gate", "data-canvas-interaction": "passive" },
      React.createElement(Comp as React.ComponentType<Record<string, unknown> & { ref?: unknown }>, { ...props, ref: forwardedRef }),
    );
  });
}

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
    // lakex-doc-react 的 mindmap viewer 直接读取
    // this.props.editor.theme，但 Lake 的 createOpenViewer 只注入 viewer/cardValue，
    // 不会向 viewerComponent 注入 editor。锁定态因此会在 render 阶段抛出
    // "Cannot read properties of undefined (reading 'theme')"，整张思维导图变成空白。
    // 不修改 node_modules：在注册配置边界补一个最小 editor.theme 兼容层。
    // 除了 name，同时兼容资源里使用 slash.mainSearch 标识的旧/新卡片配置，避免
    // 依赖某个 lakex-doc-react 版本的字段形状。
    const isMindmap = cfg.name === "mindmap-card"
      || cfg.name === "custom-mindmap-card"
      || cfg.slash?.mainSearch === "/mindmap";
    // Canvas 类卡片（Drawnix 画板/流程图/UML/导图板 + @xiangfa 导图卡）都要走「点击激活滚轮门控」：
    // 否则光标只是路过时，滚轮/触控板就会滚动或缩放画布，文档反而滑不动（用户 260916 反馈）。
    // 识别：主图卡名，或 slash 主搜索词（Drawnix 的 4 张板卡共用 /hb）。
    const isBoardCard = BOARD_CARD_NAMES.has(String(cfg.name ?? "")) || cfg.slash?.mainSearch === "/hb";
    const isCanvasCard = isMindmap || isBoardCard;
    // Drawnix/mindmap 运行时在渲染阶段抛错时，不能让单个卡片拖垮整个编辑器：
    // 编辑态和锁定态组件都包一层错误边界，保留卡片骨架并给出可读提示。
    const cardName = String(cfg.name || "card");
    const viewerComponent = cfg.viewerComponent
      ? withCardBoundary(
          isCanvasCard
            ? withCanvasWheelGate(
                isMindmap
                  ? React.forwardRef((props: any, ref: any) => {
                      const editor = props.editor?.theme?.currentThemeSchema
                        ? props.editor
                        : { theme: { currentThemeSchema: { colorScheme: "auto" } } };
                      return React.createElement(cfg.viewerComponent as any, { ...props, editor, ref });
                    })
                  : (cfg.viewerComponent as any),
              )
            : (cfg.viewerComponent as any),
          cardName
        )
      : undefined;
    const editorComponent = isCanvasCard && cfg.editorComponent
      ? withCardBoundary(withCanvasWheelGate(cfg.editorComponent as any), cardName)
      : cfg.editorComponent;
    return {
      ...cfg,
      ...(viewerComponent ? { viewerComponent } : {}),
      ...(editorComponent ? { editorComponent } : {}),
      slash,
    };
  });
}

interface CardErrorBoundaryProps {
  cardName: string;
  children?: React.ReactNode;
}

interface CardErrorBoundaryState {
  error: Error | null;
}

/** 单卡错误边界：Drawnix/mindmap 渲染异常只降级该卡片，不影响编辑器其它内容。 */
class CardErrorBoundary extends React.Component<CardErrorBoundaryProps, CardErrorBoundaryState> {
  constructor(props: CardErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): CardErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[card-error] ${this.props.cardName} render failed:`, error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      // 样式在 styles/compat.css（双端共用）：AGENTS §3 #14 禁止内联样式、颜色只走 --lake-* 令牌
      return React.createElement(
        "div",
        { className: "ne-card-error-fallback" },
        React.createElement("div", null, `卡片渲染失败（${this.props.cardName}）`),
        React.createElement(
          "div",
          { className: "ne-card-error-fallback-reason" },
          this.state.error.message
        )
      );
    }
    return this.props.children;
  }
}

function withCardBoundary(
  Comp: React.ComponentType<Record<string, unknown>>,
  cardName: string
): React.ComponentType<Record<string, unknown>> {
  const Wrapped = React.forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    React.createElement(
      CardErrorBoundary,
      { cardName },
      React.createElement(Comp as React.ComponentType<Record<string, unknown> & { ref?: unknown }>, {
        ...props,
        ref,
      })
    )
  );
  return Wrapped as unknown as React.ComponentType<Record<string, unknown>>;
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

/** 长任务（Long Tasks）观测：量化 setDocument 之后主线程的阻塞。
 * 滚动窗口上限 100 条：仅诊断用，避免长会话无界增长。 */
const lakeLongTasks: Array<{ start: number; duration: number }> = [];
const LAKE_LONG_TASKS_LIMIT = 100;
let lakeLongTaskObserver: PerformanceObserver | null = null;

function ensureLakeLongTaskObserver(): void {
  if (lakeLongTaskObserver || typeof PerformanceObserver === "undefined") return;
  try {
    lakeLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        lakeLongTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
        if (lakeLongTasks.length > LAKE_LONG_TASKS_LIMIT) lakeLongTasks.shift();
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
        .filter((e) => e.name.includes(`${ASSET_ORIGIN}/`))
        .map((e) => ({
          name: e.name.startsWith(`${ASSET_ORIGIN}/`) ? e.name.slice(ASSET_ORIGIN.length + 1).slice(0, 64) : e.name.slice(0, 64),
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
 * 关键前提（来自 lakex-doc-react README + 内核 bundle 反编译）：
 *  - scrollNode 必须指向真实滚动容器：编辑态是 .ne-editor-wrap，锁定 Viewer 是
 *    .ne-viewer（body overflow:hidden，Lake 默认回退 document.scrollingElement/body 会拿错，
 *     导致虚拟渲染视口测量错误、TOC 高亮/跳转错位）
 *  - cardLazyInit = allowCardLazyInit 的配置键：视口外卡片懒初始化（配合
 *    ensureCardsInViewHydrated 修复粘贴卡片卡壳）
 */
const VIRTUAL_RENDERING = {
  // 开启虚拟渲染（用户 260911 拍板：大纲已修好，怎么快怎么来）。
  // scrollNode 已与虚拟渲染解耦（见下 customOptions）：无论本开关如何都下发；
  // 本开关只决定 virtualRendering + cardLazyInit。
  // 大文档 A/B（「测试1112」15 标题，同文档 reload×2，本机）：ON 首资产 ~2.0-2.3s / 仅 2 个
  // 视口资产；OFF 首资产 ~4.13s / 36 个资产请求。原生大纲两种模式都渲染 15 条（关键是
  // EditorTab 补上了 refreshTocSidebar，与虚拟渲染无关）。故保持开启。
  enabled: true,
  scrollContainerSelector: ".document-pane",
  cardLazyInit: true,
};

/**
 * 解析虚拟渲染/大纲定位的真实滚动容器。
 *
 * 高度链修复后（styles.css .lake-editor-tab 高度链），编辑态真实滚动容器是 Lake 原生
 * 的 `.ne-editor-wrap`，锁定 Viewer 则是 `.ne-viewer`（均 height:100% + overflow-y:auto）——TOC 侧边栏是 absolute
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
    // 编辑态滚动在 .ne-editor-wrap，锁定态原生 Viewer 没有该节点，
    // 必须回退到 .ne-viewer，否则锁定文档会把滚轮交给已被隐藏的外层 pane。
    // 锁/解锁过渡期旧实例层（.is-outgoing）仍留在 DOM 里（见 createLakeDocument 与
    // EditorTab 的延迟销毁），它排在前面但已是过期节点：必须跳过，否则滚动恢复、
    // 大纲跟随、画板锚点都会拿到旧容器。
    const candidates = hostNode.querySelectorAll?.(".ne-editor-wrap, .ne-viewer");
    const wrap = candidates
      ? (Array.from(candidates).find((el) => !el.closest(".is-outgoing")) ?? null)
      : null;
    if (wrap) return wrap as HTMLElement;
  }
  return hostNode;
}

export interface LakeEditorPrefs {
  /** 正文字号（内核支持 12/13/14/15/16/19/22/24） */
  fontSize?: number;
  /** 显示编辑器「固定工具栏」（内核顶部工具栏）。默认开；false 时经 disabledPlugins 收掉 toolbar 插件。 */
  showToolbar?: boolean;
  /**
   * 浮动工具栏（桌面编辑态）：选中文字/图片时在选区上方弹出格式浮框。
   * 与固定工具栏互相独立；仅在显式传 true 时挂载。
   */
  floatingToolbar?: boolean;
  /**
   * 彻底禁用原生编辑 TOC 侧栏（桌面多标签自建大纲时置 true）。
   * 仅关闭编辑模式 UI：内核 toc 数据与 tocChange 事件照常产生。
   * 移动端（LakeEditor）不传此字段，保持原生行为。
   */
  disableNativeToc?: boolean;
  /**
   * 增强大纲（应用自建）开启时置 true：原生大纲只是被 CSS `display:none` 隐藏，但内核仍处于
   * 「大纲展开」布局态（编辑根 .ne-normal-toc），会给正文块留 `max-width:750px;
   * margin-right:280px` 的占位 → 增强大纲下出现大段空白（260916 用户报）。
   * 置 true 后显式传官方 `toc.normalView=false`（语雀文档 65），让内核进入收纳布局态、
   * 不再加 .ne-normal-toc；显式传值优先于内核 localStorage 里的用户偏好（bundle 177935）。
   */
  collapseNativeToc?: boolean;
  /**
   * 块悬浮手柄 + 块操作菜单（桌面编辑态专用，默认关）。
   * 菜单动作全部走内核原生命令（转化/删除/复制/剪切/缩进/在下方添加），不含拖拽移动。
   * 只在桌面编辑态传 true：移动端无 hover 语义，锁定态是 viewer。
   */
  blockHandle?: boolean;
  /** 禁用编辑态虚拟渲染（移动端用）：移动端单编辑器无 Lake 内部滚动容器（页面滚动），
   * scrollNode fallback 到 .document-pane（移动端不存在）会导致视口测量错误——编辑态只渲染
   * 视口内内容（正文不全）、保存时 getDocument 输出不完整（图片丢失）。置 true 全量渲染。 */
  disableVirtualRendering?: boolean;
  /** 附件能力（移动端注入；桌面走 native.openAttachment 无需注入）：
   * - resolveDisplayUrl：把本地资产引用解析为可显示的 URL（移动端 canonical 本地可达，可不提供；
   *   桌面 canonical URL 已可直接加载，无需提供）
   * - onOpenAttachment：点"用系统应用打开"的动作（移动端：系统应用打开；缺省桌面系统打开）
   * - directOpen：移动端 true 时点击附件卡片**直接**系统应用打开（跳过 WebView 预览弹窗——
   *   既然用的是本机能力就不需要中间层） */
  attachment?: {
    resolveDisplayUrl?: (ref: LocalAssetRef) => string | null;
    onOpenAttachment?: (item: AttachmentPreviewItem) => void;
    directOpen?: boolean;
  };
  /**
   * 小记编辑器的版式（260919 用户定稿）：
   * - `card`：小卡片（最小工具条 + 右上角展开 → 同一实例切完整工具条），用于**分块视图**的写作卡；
   * - `full`：**直接就是文档样式**（完整工具条、无展开按钮），用于**列表视图**右侧的编辑器。
   * 两者都只把「+」插入面板收成白名单（预览显示不了的不给插）；卡片注册保持全量。
   *
   * 传了这个字段就代表"这是小记编辑器"；文档编辑器不传 ⇒ 能力与外观完全不受影响。
   *
   * 分工：小记的**存储**永远由内核产出（标准 lake 标记，不手拼），**卡片预览**是我们自己的只读渲染器
   * （不挂内核，见 `src/features/quickNotes/quickNotePreviewParser.ts`）。两边要对齐，就把"预览显示不了的"
   * 从**工具栏**（`toolbar.agentConfig.default`）和**「+」插入面板**（`slash.filterOption`）里收掉 ——
   * 用户口径：「不能预览展示的就不让插入」。**卡片注册照旧全量**（否则已有小记里的表格/自定义卡一旦编辑
   * 就会被内核丢弃，见 docs/LAKEX-CONTRACT.md §5.8）。
   *
   */
  quickNoteUi?: "card" | "full";
}

/**
 * **小卡片（未展开）**的工具条 = 用户指定的最小集（260919 定稿）：
 * 图片 · 待办 · 有序列表 · 无序列表 · 分割线。
 *
 * 展开（fullscreen）后切到**完整工具栏**（`DEFAULT_TOOLBAR_ITEMS` = 内核内置默认），
 * 与文档页一致；「+」插入面板在两种状态下都由 `filterQuickNoteInsert` 收成白名单。
 *
 * 注：图片/待办用**标准项**（`image` / `taskList`）——内核 note 专用项 `note-image`/`notetaskList`
 * 画的是语雀 App 私有 symbol，本地会渲染成空白按钮（见 docs/LAKEX-CONTRACT.md §5.11 三）。
 */
export const QUICK_NOTE_TOOLBAR_ITEMS = ["image", "taskList", "orderedList", "unorderedList", "hr"] as const;

/**
 * 展开态（fullscreen）用的完整工具栏 = **逐字等于内核内置默认**（bundle `xP`）。
 * 内核合并 toolbar option 时 `agentConfig` 这一层是**整体替换**（实测：只传 note 项 ⇒ 默认工具条变空），
 * 所以补 note 项时必须把默认项一并带上。内核版本已 pin（v1.99.0，勿随意升级）。
 */
const DEFAULT_TOOLBAR_ITEMS = [
  "cardSelect", "|", "undo", "redo", "formatPainter", "clearFormat", "|",
  "style", "fontsize", "bold", "italic", "strikethrough", "underline", "mixedTextStyle", "|",
  "color", "bgColor", "|",
  "alignment", "unorderedList", "orderedList", "indent", "lineHeight", "|",
  "taskList", "link", "quote", "hr", "|",
  "search", "correction", "arrangement", "translate", "toc", "materialLibrary",
] as const;

/**
 * 小记展开态（fullscreen）的工具条 = 内核默认工具栏 **再收掉两个"能往正文里插、预览却还原不了"的入口**：
 * - `toc`：插大纲卡（小记没有大纲，预览也只能给占位条）；
 * - `materialLibrary`：素材库（云端服务，本地无内容，同样属于插入入口）。
 *
 * 为什么收这里就够（用户 260920「工具栏的『…』溢出菜单也要收一下」）：工具条塞不下时，剩下的项是收进
 * 「…」浮层里的**同一批工具项**（bundle 实测：`ne-ui-toolbar-more-button` 的 overlay `content: props.widgets`），
 * 并不是另一套插入面板 ⇒ 从 items 里去掉即同时从「…」里消失。
 * 文档编辑器不传 `quickNoteUi`，用的仍是内核默认项（这条只看小记）。
 */
const QUICK_NOTE_FULL_TOOLBAR_ITEMS = DEFAULT_TOOLBAR_ITEMS.filter(
  (item) => item !== "toc" && item !== "materialLibrary",
);

// 语雀/Lake 导出的 bookmark 卡（bookmarkInline 标题样式 / bookmark 块卡样式）在本地
// 无法展示完整详情（无语雀 API），会渲染成"无标题 + 不可点击 + 无样式浮窗"的死卡。
// 用户明确要求：新粘贴的内容统一降级为普通超链接（与虎扑/果壳一致，Lake 的 ne-link，
// 可点击跳转）。降级原理：Lake 内置 cardToLink 命令提供"卡→链接"转换。
// 只在用户粘贴时触发降级新出现的 bookmark 卡；历史/加载的文档不主动改动，seen 幂等收敛。

/** 需要降级为超链接的 bookmark 卡名（Lake INode 的 card name；块卡落盘后为 bookmarklink）。 */
const BOOKMARK_CARD_NAMES = ["bookmarkInline", "bookmark", "bookmarklink"] as const;
/** 卡→链接转换用到的 Lake 命令名。 */
const CARD_TO_LINK_COMMAND = "cardToLink";
/** 粘贴后等待 Lake 渲染卡的首个延时（ms）。 */
const BOOKMARK_DEGRADE_FIRST_DELAY = 150;
/** 若卡尚未渲染/未拿到 src，后续重试的延时步进（ms）。 */
const BOOKMARK_DEGRADE_RETRY_DELAY = 350;
/** 单次粘贴后最多重试次数，兼顾 Lake 异步渲染慢（大文档/移动端）的场景。 */
const BOOKMARK_DEGRADE_MAX_RETRY = 3;

/** Lake 内核压缩 bundle 未公开 bookmark 卡数据接口，沿用项目现有私有路径访问。 */
interface LakeBookmarkCardData {
  getSrc?: () => string;
  getDetail?: () => { title?: unknown } & Record<string, unknown>;
  getCardValue?: () => { text?: string };
}

/** 从渲染后的 bookmark 卡 DOM 节点读取转换所需的（卡 id / 链接 / 标题）。 */
function readBookmarkCardInfo(
  card: Element,
): { id: string; src: string; title: string } | null {
  const id = card.getAttribute("id");
  if (!id) return null;
  const anyCard = card as unknown as {
    _neRef?: {
      _virtualNode?: { _instance?: { cardData?: unknown; _cardData?: unknown } };
      _instance?: { cardData?: unknown; _cardData?: unknown };
    };
  };
  const inst = anyCard._neRef?._virtualNode?._instance ?? anyCard._neRef?._instance;
  const data = (inst?.cardData ?? inst?._cardData) as LakeBookmarkCardData | undefined;
  const src = data?.getSrc?.() ?? "";
  if (!src) return { id, src: "", title: "" };
  const detail = data?.getDetail?.() ?? {};
  const title = (detail.title as string) || data?.getCardValue?.()?.text || src;
  return { id, src, title };
}

/**
 * 内核兼容补丁：**实例销毁后，工具条的 tooltip 仍会查一次热键表**。
 *
 * 内核 hotkey 插件的 `destroy()` 会 `delete this._named`（bundle 实测），但工具条每个按钮渲染时都会走
 * `getTooltip → renderer.getHotKeyByName(name) → this._named[name]` ⇒ 销毁之后再渲染一次就
 * `TypeError: Cannot read properties of undefined (reading 'undo'/'slash'/…)`，
 * 而这是 **React 渲染期抛错**：整棵工具条（进而整个小记面板）崩掉、不断重试 ⇒ 用户看到"反复闪烁、
 * 保存/取消都点不动"（260920 实测：列表视图里保存/取消/换条目连续操作，12 秒内 20+ 条同类错误）。
 *
 * 我们的编辑器生命周期里"销毁旧实例"是常态（小记切草稿、换条目、保存后重建），所以这里给
 * `renderer.getHotKeyByName` 包一层：**拿不到就返回 null**（工具条少一个快捷键提示），
 * 不再让一次迟到渲染炸掉整棵 UI。对健康实例是完全透明的（正常路径直接透传返回值）。
 */
function hardenDestroyedHotKeyLookup(editor: unknown): void {
  try {
    const renderer = (editor as { renderer?: Record<string, unknown> } | null | undefined)?.renderer;
    const original = renderer?.getHotKeyByName;
    if (!renderer || typeof original !== "function") return;
    renderer.getHotKeyByName = function hardened(this: unknown, name: unknown) {
      try { return (original as (this: unknown, value: unknown) => unknown).call(this, name) ?? null; }
      catch { return null; }
    };
  } catch { /* 拿不到 renderer 就跳过：补丁只是兜底，不改变正常路径 */ }
}

/** 监听编辑器挂载容器的粘贴事件，把新出现的 bookmark 卡降级为普通超链接。 */
function installBookmarkCardDegrade(
  scope: HTMLElement,
  editor: unknown,
): () => void {
  const selectors = BOOKMARK_CARD_NAMES.map((name) => `ne-card[data-card-name="${name}"]`).join(", ");
  const converted = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retriesLeft = 0;

  const degradeOnce = () => {
    timer = null;
    const failed: Element[] = [];
    for (const card of Array.from(scope.querySelectorAll(selectors))) {
      const info = readBookmarkCardInfo(card);
      if (!info) continue;
      // 已成功的卡跳过；src 尚未就绪/转换失败则进入下一轮重试
      if (converted.has(info.id)) continue;
      if (!info.src) { failed.push(card); continue; }
      try {
        (editor as { execCommand?: (...args: unknown[]) => void }).execCommand?.(
          CARD_TO_LINK_COMMAND, info.id, info.src, info.title,
        );
        converted.add(info.id);
      } catch {
        failed.push(card);
      }
    }
    if (failed.length > 0 && retriesLeft > 0) {
      retriesLeft -= 1;
      timer = setTimeout(degradeOnce, BOOKMARK_DEGRADE_RETRY_DELAY * (BOOKMARK_DEGRADE_MAX_RETRY - retriesLeft));
    }
  };

  const schedule = () => {
    retriesLeft = BOOKMARK_DEGRADE_MAX_RETRY;
    if (timer != null) return;
    timer = setTimeout(degradeOnce, BOOKMARK_DEGRADE_FIRST_DELAY);
  };
  // Lake 粘贴会经 document 捕获阶段，事件仍会冒泡到挂载容器。
  scope.addEventListener("paste", schedule, true);
  return () => {
    if (timer != null) { clearTimeout(timer); timer = null; }
    scope.removeEventListener("paste", schedule, true);
  };
}

export function createLakeDocument(
  element: HTMLElement,
  mode: "viewer" | "editor",
  onChange: () => void,
  tocEnabled: boolean,
  noteId: string,
  scrollNode?: HTMLElement | null,
  prefs?: LakeEditorPrefs,
  /** 覆盖资源上传落盘（小记编辑态用它把图片写进 quick-notes 空间；缺省走文档资源空间）。 */
  uploadResource?: (request: unknown) => Promise<ResourceUploadOutput>
): LakeEditorInstance {
  /** 小记版式：仅编辑态可用（阅读态是 viewer，没有工具条/展开语义）。 */
  /**
   * 小记专用：文档编辑器外观 + 受限格式（只影响小记，文档编辑器不传这个开关）。
   * 注意两个 default：
   * - 挂载点仍是文档版式（`ne-doc-major-editor`）⇒ 小记编辑态与文档页长得一样；
   * - 只裁剪「工具栏 items」与「+ 面板 filterOption」，卡片注册、上传钩子、其余 option 全部照旧。
   */
  const quickNoteUi = mode === "editor" ? prefs?.quickNoteUi : undefined;
  const mount = document.createElement("div");
  // 小记走内核 note 版式（小卡片外观 + 展开按钮）；`.ne-doc-note-editor` 是小记版式的挂载点前缀
  // （内核 fullscreen 把 `.ne-ui-fullscreen` 加到 editorNode 的父节点 = 本 mount，小记的展开整窗规则
  // `.ne-doc-note-editor.ne-ui-fullscreen` 也以此为前缀）；`.lakex-note-editor` 命中内核唯一的
  // `.lakex-note-editor .ne-ui-enter-fullscreen{top:6px;right:6px}`（展开按钮内缩量）。
  mount.className = quickNoteUi === "card"
    ? "lake-editor-mount ne-doc-note-editor lakex-note-editor"
    : "lake-editor-mount ne-doc-major-editor";
  // 锁/解锁是「同一文档换渲染模式」，旧实例若立刻销毁，正文区会空白数帧到数百毫秒
  // （大文档更久）＝白屏闪烁。EditorTab 因此把旧挂载点标记 is-outgoing 交给新实例
  // （见其 pendingDisposeRef）：这里保留这些仍在显示旧内容的节点，其余照旧清掉。
  // outgoing 由 CSS 抬到新挂载点之上，新实例首屏渲染出正文后整层移除，中间没有空白帧。
  for (const child of Array.from(element.children)) {
    if (!child.classList.contains("is-outgoing")) child.remove();
  }
  element.appendChild(mount);
  const prefsSize = typeof prefs?.fontSize === "number" ? prefs.fontSize : 18;
  // viewer（阅读态）内核不消费 defaultFontsize，落回自身 14px 默认——字号挂到 mount 根，
  // 阅读/编辑两态同源继承（设置里的正文字号此前在移动端阅读态从未生效）。
  mount.style.fontSize = `${prefsSize}px`;
  // lakex-doc-react 的默认配置是函数（按语言生成）；本项目固定 zh-cn。
  const defaultConfig = GetDefaultEditorConfig("zh-cn") as Record<string, unknown>;
  const customOptions: Record<string, unknown> = {
    // 编辑态不禁用 emoji 插件：unicodeEmoji 卡片的表情选择器依赖其默认数据，
    // 禁用后选择器渲染为空（0x0）。Viewer 仍保持纯只读。
    disabledPlugins: mode === "viewer"
      ? ["save", "toolbar", "emoji"]
      : ["save", ...(prefs?.showToolbar === false ? ["toolbar"] : [])],
    // 语雀/Lake 导出的 bookmark 卡（bookmarkInline / bookmark）能否被注册进内核，
    // 取决于 BookmarkEditorPlugin(option name="bookmark") 的 isEnable，而其
    // isEnable = !!_option.detailAction || !!_option.fetchDetailHandler。
    // 本地没有语雀 API，故提供 fetchDetailHandler 返回最小 detail，仅用于让插件
    // 走三参 registerInlineCard/registerBlockCard 注册卡类（否则 getCardClass 返回
    // null 直接崩溃）。已有 detail 的剪贴板卡不会走到该 handler；真正缺少 detail 的
    // 纯 URL 粘贴时才被调用，这里返回基于 url 的最小结构、不出网。
    bookmark: {
      fetchDetailHandler: (src: unknown) => {
        const url = typeof src === "string" ? src : String((src as { url?: unknown })?.url ?? "");
        return Promise.resolve({
          title: url,
          icon: null,
          image: null,
          desc: null,
          url,
        });
      },
    },
    input: {},
    defaultFontsize: prefsSize,
    // 小记专用：**只裁剪入口**（工具栏 items + 「+」面板 filterOption），外观与文档页完全一致。
    // 文档编辑器不传 `restrictedFormats` ⇒ 这段完全不生效（红线：不要影响文档）。
    ...(quickNoteUi
      ? {
          // 两种版式的工具条：card＝小卡片最小集 + 展开后完整；full＝直接完整（文档样式）。
          ...(quickNoteUi === "card" ? { uiSwitch: { default: "note" }, fullscreen: { enable: true } } : {}),
          toolbar: {
            agentConfig: {
              ...(quickNoteUi === "card" ? { note: { items: [...QUICK_NOTE_TOOLBAR_ITEMS] } } : {}),
              default: { items: [...QUICK_NOTE_FULL_TOOLBAR_ITEMS] },
            },
          },
        }
      : {}),
    toc: {
      enable: !!tocEnabled && !prefs?.disableNativeToc,
      // 增强大纲 = 原生大纲被 CSS 隐藏，但必须同时让内核退出「展开」布局态，否则 .ne-normal-toc
      // 仍给正文留 280px 占位（大段空白）。官方配置项 toc.normalView（默认 true=展开）；显式传值
      // 时内核不读 localStorage，故能可靠压过用户上次的展开偏好。
      // allowAutoPin/rememberLastPin 必须一起关：内核在 viewSizeChange 时会 isAllowAutoPin() 自动
      // 把大纲展开（bundle 179780），只传 normalView=false 会在创建后又被改回展开 → 占位复发。
      ...(prefs?.collapseNativeToc ? { normalView: false, allowAutoPin: false, rememberLastPin: false } : {}),
      // 内核默认 allowModifyHash=true（lakex.js 编辑态 ekg / 阅读态 ezx 两套默认都是 !0）：
      // 点击大纲会把 location.hash 改成标题节点 id → 触发浏览器锚点导航 → 浏览器滚锚点的
      // 整条祖先滚动链（.ne-editor-wrap 之外还滚 html）→ html 被滚 42px（=topbar 高，html
      // 未锁 overflow 时）→ 整壳上移、topbar 滚出视野、tab 栏顶到第一行（260916 实测，用户
      // 报「点大纲布局乱套」）。关闭后走 scrollByNodeId 正常跳转、不再写 hash；base.css 的
      // html,body{overflow:hidden} 为兜底。注意：内核 option 是扁平 schema（OptionName 'toc'，
      // 编辑/阅读共用），allowModifyHash 直接挂在 toc 下，没有 editing/reading 嵌套。
      allowModifyHash: false,
    },
    // 官方阅读器配置（语雀文档 47）：阅读态大纲判定「当前标题」时忽略顶部这么多像素。
    // 内核编辑态写死 40（bundle 179499），阅读态默认 0 → 两态高亮口径不一致（阅读态刚滚过
    // 标题就切高亮）。统一为 40。仅阅读态传（编辑态无此 option）。
    ...(mode === "viewer" ? { boundaryTopOffset: 40 } : {}),
    codeblock: {
      // 使用与当前 Lake 资源链匹配的 CodeMirror 7.1.3，旧版 lakex-doc 资源
      // 在 Slash 新建代码块时可能只留下空壳而没有可编辑实例。
      codemirrorURL: "./vendor/cdn/as/g/larkgroup/lake-codemirror/7.1.3/CodeMirror.js",
    },
    math: {
      // 统一使用随应用镜像的 KaTeX 0.16.8 与 mhchem，避免外链脚本加载顺序/全局
      // `katex.__defineMacro` 不存在导致包含公式或思维导图文档出现运行时异常。
      KaTexURL: [LAKE_KATEX_SCRIPT, LAKE_MHCHEM_SCRIPT],
    },
    image: {
      createUploadPromise: (request: unknown) => (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request),
      // 本地资源服务器 URL 必须排除，否则 Lake 每次 setDocument 都会重新下载并上传本地图片
      isCaptureImageURL: (url: string) => !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith(`${ASSET_ORIGIN}/`),
    },
    file: {
      createUploadPromise: (request: unknown) => (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request),
    },
    // 视频/音频卡片：必须配 createUploadPromise，否则 Lake 走默认 uploadFileURL（/api/upload/video，
    // 应用内不存在）→ 上传失败/一直"上传中"。uploadLakeResource 对非图片 File 走附件落盘
    // （note-assets + canonical URL），video/audio 卡片 src=canonical 本地可达、持久可加载。
    video: {
      createUploadPromise: (request: unknown) => (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request),
    },
    audio: {
      createUploadPromise: (request: unknown) => (uploadResource ?? ((req: unknown) => uploadLakeResource(req, noteId)))(request),
      // audio 卡上传成功后 setId(audioId = canonical URL)，播放地址 = canonical（本地可达，持久）。
      // 不配 queryAudioUrl 时 Lake 走 queryURL 轮询（应用无此端点）→ 永远"上传中"。
      // allowAudioPlayer=false（Lake 默认，版权保护）会把卡片渲染成"版权限制"链接（点击跳系统
      // 浏览器打开附件 URL）——本地私有笔记应内嵌播放，必须置 true。
      allowAudioPlayer: true,
      queryAudioUrl: (cardData: unknown) => {
        const info = (cardData as { getAudioInfo?: () => { id?: string | null } } | null)?.getAudioInfo?.();
        const url = info?.id ?? null;
        return url
          ? Promise.resolve({ audioUrl: url, downloadUrl: url })
          : Promise.reject(new Error("audio url unavailable"));
      },
    },
    // 移除第三方 embed 分组（我们不渲染外部嵌入卡）；画板/导图等分组由 lakex-doc-react 的卡片配置自带。
    slash: {
      // 小记专用：「+」面板收成白名单（官方钩子；文档编辑器不传 restrictedFormats ⇒ 保持全量）。
      ...(quickNoteUi ? { filterOption: filterQuickNoteInsert } : {}),
      cardSelect: {
        general: {
          groups: ((defaultConfig as any).slash?.cardSelect?.general?.groups || []).filter(
            (g: any) => g.name !== "third-party-services"
          ),
        },
        table: {
          groups: ((defaultConfig as any).slash?.cardSelect?.table?.groups || []).filter(
            (g: any) => g.name !== "third-party-services"
          ),
        },
      },
    },
    // scrollNode 与虚拟渲染解耦：原生 TOC 的点击定位/滚动高亮需要真实滚动容器
    // （body overflow:hidden 时 Lake 默认回退 document.scrollingElement||document.body 会拿错，
    // TROUBLESHOOTING #26）。编辑态与锁定 Viewer 都要下发：阅读态 TOC 点击跳转走
    // viewer.scrollNode.scrollTop（bundle 236871），不下发时回退 html——html 已被
    // overflow:hidden 锁死（W-8 兜底），点击大纲正文就不滚了（260916 用户实测）。
    // 移动端 disableVirtualRendering=true 表示无内部滚动容器，不传。
    ...(prefs?.disableVirtualRendering
      ? {}
      : { scrollNode: () => resolveScrollNode(scrollNode) }),
    ...(VIRTUAL_RENDERING.enabled && mode === "editor" && !prefs?.disableVirtualRendering
      ? {
          // Viewer 不需要编辑态的卡片懒加载。原生 Viewer 在虚拟卡片节点尚未
          // appear 时可能只留下 hole，尤其是 Drawnix 画板会在锁定切换后丢失。
          // 锁定文档数量通常远小于编辑态交互频率，Viewer 直接完整渲染更稳定。
          virtualRendering: true,
          cardLazyInit: VIRTUAL_RENDERING.cardLazyInit,
        }
      : {}),
  };

  const mergedOptions = deepMerge(defaultConfig, customOptions);

  // 先收集图标：新 vendor 的 React `icon` 挂在 `{ config, icon }` 包装上，prepareCustomCards 解包后会丢。
  ensureCustomCardIcons(mergedOptions);
  prepareCustomCards(mergedOptions);

  ensureLakeLongTaskObserver();
  lakeMark("lake:create:start");
  // Lake 的 gJ 注入的是默认 async 的动态 <script>，katex/mhchem 并行加载时
  // 执行顺序无保证；mhchem 抢先运行时 window.katex 尚未就绪就会抛
  // "Cannot read properties of undefined (reading '__defineMacro')"。
  // 这里在编辑器创建前按顺序预注入（async=false 强制经典脚本顺序执行），
  // Lake 稍后通过 script[src] 去重复用，不再重复注入。
  injectKatexScriptsInOrder();
  const editor = mode === "viewer"
    ? (Doc as any).createOpenViewer(mount, mergedOptions)
    : (Doc as any).createOpenEditor(mount, mergedOptions);

  lakeMark("lake:create:end");
  lakeMeasure("lake:create:openEditor", "lake:create:start", "lake:create:end");
  hardenDestroyedHotKeyLookup(editor);
  if (mode === "editor") {
    editor.on("contentchange", onChange);
  }
  // 语雀 bookmark 卡本地降级为普通超链接（ne-link），见 installBookmarkCardDegrade。
  if (mode === "editor") {
    try { (editor as any).__disposeBookmarkDegrade = installBookmarkCardDegrade(mount, editor); } catch { /* 忽略 */ }
  }
  // 仅编辑态启用 virtualRendering + cardLazyInit，因此可见卡片水合只挂在编辑器实例；
  // 锁定态 Viewer 明确关闭虚拟渲染，避免自定义卡片停留在 hole 空壳。
  if (mode === "editor" && VIRTUAL_RENDERING.enabled && VIRTUAL_RENDERING.cardLazyInit) {
    // 虚拟渲染下 Lake 原生 TOC watcher 的二分探测失效（视口外标题无 DOM），
    // 自研滚动跟随高亮 + 点击精确滚动；另有表格浮动工具栏 hover 桥。
    // 清理函数挂在 editor 上由 destroyLakeEditor 调。
    try {
      const disposes: Array<() => void> = [];
      // 代码块等卡片的 $appear / CodeMirror 初始化不能依赖原生 TOC。桌面端关闭
      // 原生 TOC、改用应用自建大纲时，这条水合订阅仍必须保留；Viewer 同样需要。
      try {
        const hydration = setupVisibleCardHydration(
          element,
          editor,
          () => resolveScrollNode(scrollNode),
          mode === "editor",
        );
        disposes.push(hydration.dispose);
        editor.requestCardHydration = hydration.requestHydration;
      } catch { /* 忽略 */ }
      if (mode === "editor" && !prefs?.disableNativeToc) {
        try { disposes.push(setupTocScrollFollow(element, editor, () => resolveScrollNode(scrollNode))); } catch { /* 忽略 */ }
      }
      if (mode === "editor") {
        try { disposes.push(setupCardToolbarHoverBridge(element)); } catch { /* 忽略 */ }
      }
      (editor as any).__disposeExtras = () => {
        for (const dispose of disposes) {
          try { dispose(); } catch { /* 忽略 */ }
        }
      };
    } catch { /* 非编辑器环境忽略 */ }
  }
  // 表情/公式卡片插入后自动打开选择器/编辑器（不依赖虚拟渲染开关）
  if (mode === "editor") {
    try {
      const disposeAutoOpen = setupInsertedCardAutoOpen(element);
      const prevDispose = (editor as any).__disposeExtras;
      (editor as any).__disposeExtras = () => {
        try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
        try { disposeAutoOpen(); } catch { /* ignore */ }
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
  // audio 卡内嵌播放兜底（桌面/移动端共用）：Lake 的 queryAudioUrl 自动触发在「加载已有卡」时
  // 不稳定（渲染成版权/错误链接，点击会跳系统浏览器打开附件 URL）。直接调 onTranscodeSuccess
  // 设置播放器（audio 元素 src=canonical，应用内嵌播放）。卡渲染完成后调用才生效——持续重试
  // （最长 ~20s）直到播放器出现；编辑器销毁时经 __disposeExtras 清理。
  {
    const audioTimers: number[] = [];
    const tryEnsureAudio = (tries: number): void => {
      let allReady = true;
      try {
        // audio + video 卡都覆盖：两者初次渲染都可能撞上 AssetServer 启动竞态（error 4）。
        // §6.1-#4：扫描范围收窄到本实例自己的 mount——此前用 document.querySelectorAll 扫全工作区，
        // 每个 keep-alive 编辑器实例都重复扫同一批卡（实测 8 标签 ~53 次/前 6s）。卡都在本 mount 内。
        const cards = mount.querySelectorAll('ne-card[name="audio"], NE-CARD[data-card-name="audio"], ne-card[name="video"], NE-CARD[data-card-name="video"]');
        if (cards.length === 0) {
          // 卡尚未渲染（setDocument 异步）——前几轮继续等待；之后无媒体卡则停止（避免白跑）
          allReady = tries >= 5;
        } else {
          cards.forEach((card) => {
            // 播放器已渲染但加载失败（server 启动竞态/瞬时失败 → networkState 3 + error）→ 重载
            const mediaEl = card.querySelector("audio, video") as HTMLMediaElement | null;
            if (mediaEl && mediaEl.networkState === 3 && mediaEl.error) {
              const s = mediaEl.getAttribute("src");
              if (s) { mediaEl.preload = "metadata"; mediaEl.src = s; mediaEl.load(); }
            }
            if (card.querySelector("audio, video")) return;
            if (card.getAttribute("name") === "video" || card.getAttribute("data-card-name") === "video") return; // video 卡无 onTranscodeSuccess 流程
            allReady = false;
            // 编辑器实例在 _virtualNode._instance；viewer（只读）实例在 _neRef._instance
            const inst = (card as unknown as { _neRef?: { _virtualNode?: { _instance?: { cardData?: unknown; _cardData?: unknown; onTranscodeSuccess?: (e: unknown) => void }; }; _instance?: { cardData?: unknown; _cardData?: unknown; onTranscodeSuccess?: (e: unknown) => void } } })._neRef?._virtualNode?._instance
              ?? (card as unknown as { _neRef?: { _instance?: { cardData?: unknown; _cardData?: unknown; onTranscodeSuccess?: (e: unknown) => void } } })._neRef?._instance;
            const cd = inst?.cardData ?? inst?._cardData;
            const info = (cd as { getAudioInfo?: () => { id?: string | null } } | null | undefined)?.getAudioInfo?.();
            const url = info?.id;
            if (!url) return;
            const status = (cd as { getStatus?: () => string } | null | undefined)?.getStatus?.();
            if (status === "error") return;
            if (typeof inst?.onTranscodeSuccess === "function") {
              inst.onTranscodeSuccess({ success: true, data: { audio: url, origin: url } });
            } else {
              // viewer 实例无 onTranscodeSuccess（Lake viewer audio 卡不跑查询流程）→
              // 直接写 audioInfo.url = canonical + sync(true) + rerender（实测三者缺一不可：
              // sync 触发渲染、rerender 传 audioUrl/uiStatus 给播放器组件）
              const instAny = inst as { cardData?: { setAudioInfo?: (v: unknown) => void; sync?: (u: boolean) => void }; _cardUI?: { uiViewProxy?: { rerender?: (p: unknown) => void } }; _$cardUI?: { uiViewProxy?: { rerender?: (p: unknown) => void } } } | null | undefined;
              const cd2 = instAny?.cardData;
              if (cd2 && typeof cd2.setAudioInfo === "function") {
                cd2.setAudioInfo({ ...info, url });
                try { cd2.sync?.(true); } catch { /* 忽略 */ }
              }
              const ui = instAny?._cardUI ?? instAny?._$cardUI;
              try { ui?.uiViewProxy?.rerender?.({ audioUrl: url, uiStatus: "transcoded" }); } catch { /* 忽略 */ }
            }
          });
        }
      } catch { /* 单卡兜底失败不阻断 */ }
      if (!allReady && tries < 25) {
        audioTimers.push(window.setTimeout(() => tryEnsureAudio(tries + 1), 800));
      }
    };
    audioTimers.push(window.setTimeout(() => tryEnsureAudio(0), 80));
    const prevDispose = (editor as any).__disposeExtras;
    (editor as any).__disposeExtras = () => {
      try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
      audioTimers.forEach((t) => window.clearTimeout(t));
    };
  }
  // 块悬浮手柄 + 块操作菜单（桌面编辑态 opt-in；见 blockHandleMount 的安全边界说明）
  if (mode === "editor" && prefs?.blockHandle) {
    const disposeHandle = mountBlockHoverHandle(element, mount, editor);
    const prevDispose = (editor as any).__disposeExtras;
    (editor as any).__disposeExtras = () => {
      try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
      disposeHandle();
    };
  }
  // 浮动工具栏（桌面编辑态 opt-in）：选中文字/图片时在选区上方弹出浮框。
  if (mode === "editor" && prefs?.floatingToolbar) {
    const disposeSelectionToolbar = mountSelectionToolbar(element, mount, editor);
    const prevDispose = (editor as any).__disposeExtras;
    (editor as any).__disposeExtras = () => {
      try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
      disposeSelectionToolbar();
    };
  }
  return editor;
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
      const vn = (card as any)._neRef?._virtualNode;
      if (!vn || vn.isAppear) return;
      const r = card.getBoundingClientRect();
      if (r.top < vp.bottom && r.bottom > vp.top && r.width > 0 && r.height > 0) {
        vn.$appear();
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
function setupInsertedCardAutoOpen(host: HTMLElement): () => void {
  const seen = new Set<string>();
  let timer: number | undefined;
  let disposed = false;

  const isTargetCard = (el: Element): boolean => {
    const name = (el as HTMLElement).dataset?.cardName || "";
    return name === "unicodeEmoji" || name === "math";
  };
  const getController = (el: Element): any => {
    try {
      const inst = (el as any)._neRef?._virtualNode?._instance;
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
  const overlayOpened = (controller: any): boolean => {
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
function setupVisibleCardHydration(
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
  let renderer: any = null;
  try { renderer = (editor as any)?.renderer; } catch { /* 忽略 */ }
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
    try { (editor as any)?.on?.("contentchange", onContentChange); } catch { /* 忽略 */ }
    // 虚拟渲染每批重建完成后重算高亮（滚动瞬间视口顶标题可能尚未渲染）
    let renderer = null;
    try { renderer = (editor as any)?.renderer; } catch { /* 忽略 */ }
    const onTileRender = (): void => update();
    renderer?.on?.("tileRenderCompleted", onTileRender);
    renderer?.on?.("generalRenderCompleted", onTileRender);
    cleanup = () => {
      scroller.removeEventListener("scroll", onScroll);
      el.removeEventListener("click", onClick, true);
      try { (editor as any)?.off?.("contentchange", onContentChange); } catch { /* 忽略 */ }
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
    const kernel = (editor as any)?.kernel;
    const onTocChange = (): void => {
      later(tryBind, 0);
      later(() => apply(activeId, true), 60);
    };
    const unsubscribe = kernel?.onPluginEvent?.("tocChange", onTocChange);
    if (typeof unsubscribe === "function") {
      removeTocChangeListener = unsubscribe;
    } else if (typeof kernel?.offPluginEvent === "function") {
      removeTocChangeListener = () => kernel.offPluginEvent("tocChange", onTocChange);
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

/** 原生 TOC 侧栏实例的应用侧可用面（编辑态/阅读态插件同构：bundle 179515 / 236760 均有 update，
 * close/open 两态同名）。全部可选：内核 bundle 改结构时静默降级。
 * setNormalView：展开/收纳统一入口——阅读态实例自带 setNormalViewStatus；编辑态实例没有，
 * 但两态共用同一 React 组件（ek0），经组件 ref 的 setNormalViewStatus 等价切换。 */
export interface NativeTocSidebar {
  update?: (toc: unknown) => void;
  open?: () => void;
  close?: () => void;
  /** 展开/收纳切换（true=展开 305px / false=收纳迷你条）。 */
  setNormalView?: (normal: boolean) => void;
}

/** 取原生 TOC 侧栏实例（bundle: 编辑器 toc 插件 afterInit `this._tocSidebar = ao(qY, …)`；
 * 阅读态插件同构，同挂点 `_tocSidebar`）。返回绑定包装（不改动内核实例）。
 * 插件实例挂在 editor._plugins（数组/Map/对象），逐个找带 `_tocSidebar.update` 的那个。
 * 属私有结构 hack：找不到返回 null，调用方回退到 tocChange 事件重放。 */
function findNativeTocSidebar(editor: LakeEditorInstance | null): NativeTocSidebar | null {
  try {
    const ps = (editor as any)?._plugins;
    const list: unknown[] = Array.isArray(ps)
      ? ps
      : ps && typeof (ps as Map<unknown, unknown>).values === "function"
        ? [...(ps as Map<unknown, unknown>).values()]
        : ps && typeof ps === "object"
          ? Object.values(ps as Record<string, unknown>)
          : [];
    for (const p of list) {
      const sb = (p as { _tocSidebar?: Record<string, unknown> })?._tocSidebar;
      if (sb && typeof sb.update === "function") {
        const anySb = sb as any;
        return {
          update: (toc) => anySb.update(toc),
          open: () => anySb.open?.(),
          close: () => anySb.close?.(),
          setNormalView: (normal) => {
            if (typeof anySb.setNormalViewStatus === "function") { anySb.setNormalViewStatus(normal); return; }
            // 编辑态：组件 ref 上 setNormalViewStatus（ek0 为编辑/阅读共用组件）
            const ref = anySb._view?.getReactRef?.();
            if (ref && typeof ref.setNormalViewStatus === "function") ref.setNormalViewStatus(normal);
          },
        };
      }
    }
  } catch { /* 内核插件结构变化时静默降级 */ }
  return null;
}

/** 修复：Lake 编辑器 TOC 侧边栏创建时用空 toc 渲染（jI.render(GY, {toc: []})），
 * 若 ready 在 tocChange 之前触发，侧边栏永远不会被填充（打开文档时大纲为 0，
 * 编辑触发新 tocChange 后才出现）。setDocument 后调用一次，把最新 toc 数据
 * 同步进侧边栏，弥补这个加载时机缺口。
 * 重试收敛：固定 120ms 轮询、上限 40 次（≈4.8s）。侧栏就绪通常 ~2s，慢速递增重试会让
 * 大纲多等 1s+（实测条目出现从 ~2.1s 拖到 ~3.1-3.6s）。
 * onSidebarReady：侧栏实例首次可用时回调一次（锁定态用它延续锁定前的大纲可见/展开状态——
 * 内核阅读态 ready 时无条件 open+展开，必须在其后覆盖）。 */
export function refreshTocSidebar(
  editor: LakeEditorInstance | null,
  host?: HTMLElement | null,
  onSidebarReady?: (sidebar: NativeTocSidebar) => void,
): () => void {
  // toc 数据权威来源是内核的 docExtraContent（TOC 管理器 setDocExtraContent({toc})）。
  // 通过内核官方事件总线重放 tocChange（与编辑触发路径一致），并重试直到条目出现。
  // 审计：重试定时器必须由调用方在 editor 销毁时取消，避免关闭文档后继续触碰旧实例。
  const scope = host ?? document;
  const timers = new Set<number>();
  let disposed = false;
  let attempt = 0;
  let readyCallback = onSidebarReady;
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };
  const tryOnce = (): void => {
    try {
      const anyEditor = editor as any;
      const kernel = anyEditor?.kernel;
      const tocData = kernel?.getDocExtraContent?.()?.toc;
      // 数据就绪即重放，不前置检查侧栏 DOM：
      // ① 编辑态侧栏在 afterInit 就挂载（.ne-toc-sidebar），直接 update 绕过 1s 节流（实测 ~90ms）；
      // ② 阅读态（锁定 viewer）的侧栏 DOM 只在收到 length>0 的 tocChange 时才创建
      //    （bundle 236953：无实例则 new ezD），内核 tocChange 先于插件监听发完 → 锁定大纲永远空壳。
      //    emitPluginEvent 重放正是触发它挂载+填充的手段（260916 锁定态大纲不渲染的修复）。
      if (Array.isArray(tocData) && tocData.length > 0) {
        const sidebar = findNativeTocSidebar(editor);
        let done = false;
        if (sidebar?.update) {
          try { sidebar.update(tocData); done = true; } catch { done = false; }
        }
        if (done && readyCallback && sidebar) {
          try { readyCallback(sidebar); } catch { /* 状态应用失败不影响填充 */ }
          readyCallback = undefined;
        }
        if (!done && kernel?.emitPluginEvent) kernel.emitPluginEvent("tocChange", tocData);
      }
      // 条目类名编辑态/阅读态一致（.ne-toc-item），无需限定容器。
      // 但必须排除正在退场的旧实例层（.is-outgoing）：它的条目不代表新实例已渲染好，
      // 否则会误判为完成而停止重试 —— 锁定后台/大纲空壳的老问题会因此复发。
      const itemsAfter = Array.from(scope.querySelectorAll(".ne-toc-item"))
        .filter((el) => !el.closest(".is-outgoing")).length;
      if (itemsAfter === 0 && attempt < 40) {
        attempt += 1;
        later(tryOnce, 120);
      }
    } catch (error) {
      console.warn("refreshTocSidebar failed", error);
    }
  };
  later(tryOnce, 0);
  return () => {
    disposed = true;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
}

export function destroyLakeEditor(editor: LakeEditorInstance | null): void {
  try {
    (editor as any)?.__disposeExtras?.();
  } catch (error) {
    console.warn("Lake editor extras cleanup failed", error);
  }
  try {
    (editor as any)?.__disposeBookmarkDegrade?.();
  } catch { /* 忽略 */ }
  try {
    editor?.destroy?.();
    if (!editor?.destroy) editor?.destory?.();
  } catch (error) {
    console.warn("Lake editor cleanup failed", error);
  }
}
