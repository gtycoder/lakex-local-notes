/**
 * 内核配置与性能埋点：默认配置合并、自定义卡注册、虚拟渲染/scrollNode、小记工具条清单、__disposeExtras 汇总、window.__lakePerfReport。
 *
 * 261112 R2-S9：从 lakeRuntime.ts **原样搬出**（纯搬移：导出名/行为零变化）。
 * 公共符号仍由 ./lakeRuntime 门面 re-export；内核 lazy 边界不变（只被 lakeRuntime 静态 import）。
 */
import React from "react";
import { renderToString } from "react-dom/server";
import { rlog } from "../../lib/log";
import { errorFields } from "../../core/logFormat";
import { QuickNoteAttachmentToolbarItem, QuickNoteDateToolbarItem, QuickNoteEmojiToolbarItem } from "../quickNotes/quickNoteToolbarWidgets";
import { useClickActivatedWheelGate } from "./canvasInteractionGate";
import { ASSET_ORIGIN } from "../../lib/assetPort";
import type { LocalAssetRef } from "../../core/assetUrl.js";
import type { AttachmentPreviewItem } from "../attachment/attachmentPreviewController.js";
import type { LakeDocInitPerf } from "./lakePerfSubscription";
import type { LakeEditorInstance, LakeKernelBridge } from "./lakeRuntime";
/** 类型安全的 Lake 内核桥接访问器（内部一次边界断言，调用点不再各自断言）。 */
export function lakeBridge(editor: LakeEditorInstance | undefined): LakeKernelBridge {
  return (editor ?? {}) as unknown as LakeKernelBridge;
}

/** Deep merge: defaults ← overrides */
export function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
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

/** vendor customCard 条目（lakex-doc-react `configs/customCard.ts`）：只声明本文件改写到的字段。 */
interface VendorCardSlashEntry {
  label?: string | (() => { zhCN: string });
  description?: string | (() => { zhCN: string });
  mainSearch?: string;
}

interface VendorCustomCardConfig {
  name?: unknown;
  slash?: VendorCardSlashEntry;
  viewerComponent?: React.ComponentType<Record<string, unknown>>;
  editorComponent?: React.ComponentType<Record<string, unknown>>;
}

/** cards 数组在 prepareCustomCards 后存的是**展开后的 config**（沿用既有实现），所以两者字段都允许。 */
interface VendorCustomCardEntry extends VendorCustomCardConfig {
  config?: VendorCustomCardConfig;
}

export function prepareCustomCards(config: Record<string, unknown>): void {
  const cc = config.customCard as { cards?: VendorCustomCardEntry[] } | undefined;
  if (!cc?.cards) return;
  cc.cards = cc.cards.map((card) => {
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
                  ? React.forwardRef<unknown, Record<string, unknown>>((props, ref) => {
                      const injected = props as { editor?: { theme?: { currentThemeSchema?: unknown } } };
                      const editor = injected.editor?.theme?.currentThemeSchema
                        ? injected.editor
                        : { theme: { currentThemeSchema: { colorScheme: "auto" } } };
                      return React.createElement(cfg.viewerComponent as React.ComponentType<Record<string, unknown>>, { ...props, editor, ref });
                    })
                  : cfg.viewerComponent,
              )
            : cfg.viewerComponent,
          cardName
        )
      : undefined;
    const editorComponent = isCanvasCard && cfg.editorComponent
      ? withCardBoundary(withCanvasWheelGate(cfg.editorComponent), cardName)
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
    // DT-08：错误来自内核/第三方卡片组件（Drawnix/mindmap）的渲染，属于我们这一层的兜底失败路径 ⇒ 走 rlog。
    rlog.error("editor", "卡片渲染失败", error, { card: this.props.cardName, componentStack: errorInfo.componentStack ?? undefined });
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
export function ensureCustomCardIcons(config: Record<string, unknown>): void {
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
export function lakeMark(name: string): void {
  try { performance.mark(name); } catch { /* 非浏览器环境忽略 */ }
}

export function lakeMeasure(name: string, startMark: string, endMark: string): void {
  try {
    if (performance.getEntriesByName(startMark).length) performance.measure(name, startMark, endMark);
  } catch { /* 忽略 */ }
}

/** 长任务（Long Tasks）观测：量化 setDocument 之后主线程的阻塞。
 * 滚动窗口上限 100 条：仅诊断用，避免长会话无界增长。 */
const lakeLongTasks: Array<{ start: number; duration: number }> = [];
const LAKE_LONG_TASKS_LIMIT = 100;
let lakeLongTaskObserver: PerformanceObserver | null = null;

export function ensureLakeLongTaskObserver(): void {
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


let lakeLastDocInitPerf: LakeDocInitPerf | null = null;


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
      rlog.warn("editor", "__lakePerfReport 生成失败", { ...errorFields(error) });
    }
    try {
      if (lakeLongTasks.length) {
        const total = lakeLongTasks.reduce((sum, t) => sum + t.duration, 0);
        const last = lakeLongTasks[lakeLongTasks.length - 1];
        console.group(`长任务（共 ${lakeLongTasks.length} 个，合计 ${total}ms，最后结束于 ${last ? last.start + last.duration + "ms" : "?"}）`);
        console.table([...lakeLongTasks].sort((a, b) => a.start - b.start).map((t) => ({ start: `${t.start}ms`, duration: `${t.duration}ms` })));
        console.groupEnd();
      } else {
        rlog.warn("editor", "未观测到长任务（可能尚未打开文档，或未在编辑器创建前启用观测）");
      }
      if (lakeLastDocInitPerf) {
        console.group("Lake docInitPerf（parseTime/renderTime/nodeLength）");
        console.table([lakeLastDocInitPerf]);
        console.groupEnd();
      } else {
        rlog.info("editor", "尚未收到 Lake docInitPerf（若编辑器已打开，说明 monitorLog 订阅未生效）");
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
        rlog.info("editor", `首图发起: ${images[0].start}，共 ${images.length} 个请求，最后一个: ${images[images.length - 1].start}`);
        console.groupEnd();
      } else {
        rlog.warn("editor", "未发现本地图片请求（文档可能没有图片，或尚未打开）");
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
export const VIRTUAL_RENDERING = {
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
export function resolveScrollNode(scrollNode?: HTMLElement | null | (() => HTMLElement | null)): HTMLElement {
  // 允许传 getter：宿主组件挂载晚于编辑器创建时（移动端 .mobile-doc-body 的 ref 在首帧才有值），
  // 内核在每次测量时会重新调用本函数 ⇒ 用 getter 才能拿到真实滚动容器。
  const resolved = typeof scrollNode === "function" ? scrollNode() : scrollNode;
  const hostNode = (resolved
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
   * 图片显示缩略档位（px，仅任务-26 移动端小记写作卡传 1024）：>0 且同时有 `imageThumbAllowFiles` 时，
   * 给 allowlist 内的本地图片显示 URL 加 `?w=<值>`（保留 token/其它 query），不影响模型/保存。
   * 桌面/文档编辑器不传 = 零变化。
   */
  imageThumbWidth?: number;
  /**
   * 允许加显示缩略的本地资产 **filename** 集合（`core/quickNoteImageThumb.ts` 从正文解析）。
   * **没有这个集合就绝不加 w**（fail-safe）：缺 `original` 的历史卡会被内核把缩略图尺寸写成原尺寸。
   */
  imageThumbAllowFiles?: ReadonlySet<string>;
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
 * **小卡片（未展开）工具条 = 用户指定的 9 项**（261010 定稿）：
 * 日期 · 表情 · 图片 · 附件 · 待办 · 无序 · 有序 · 引用 · 分隔线。
 *
 * 两类条目：
 * - **字符串 id** = 内核内置工具项（`image` / `taskList` / `unorderedList` / `orderedList` / `quote` / `hr`）。
 *   注：图片/待办必须用标准项 —— 内核 note 专用项 `note-image`/`notetaskList` 画的是语雀 App 私有
 *   symbol，本地渲染成空白按钮（见 docs/LAKEX-CONTRACT.md §5.11 三）。
 * - **自定义工具项类** = 日期 / 表情 / 附件（`quickNoteToolbarWidgets.ts`）。实测内核**静默丢弃未知 id**
 *   （`date`/`dateCard`/`emoji`/`file`/`attachment` 都无效，11 个候选只渲染 6 个）⇒ 只能走官方自定义通道：
 *   items 元素是**函数**时内核 `new Cls(editor, id)` + `init()`，再按 `Cls.Type` 渲染控件（bundle 160955-160503）。
 *
 * **紧凑条里没有「＋」插入面板入口**（用户 261010 定稿：移动端太突兀）⇒ 其余格式现在只有一条路：
 * **桌面写作卡展开**（fullscreen）→ 完整工具栏（`DEFAULT_TOOLBAR_ITEMS`，含 `cardSelect` 面板）。
 * （`/` 斜杠在本构建**不可靠**：LAKEX-CONTRACT §5.23 早先实测 + 261010 用 keydown/insertText 复测都没唤起面板
 * ⇒ 不能把它当入口。移动端因此暂时插不了表格/代码块/公式/高亮块/分栏/画板，**显示**不受影响。）
 */
/** 小记卡片工具条（**唯一来源**）：261010 用户定 9 项 → **261014 精简为 7 项**
 *  （用户："桌面端小记做一下精简，去掉引用，有序列表"）。
 *  顺序 = 日期 · 表情 · 图片 · 附件 · 待办 · 无序 · 分隔线；字符串条目必须是内核有效 id（无效 id 会被内核静默丢弃）。 */
export const QUICK_NOTE_TOOLBAR_ITEMS = [
  QuickNoteDateToolbarItem,
  QuickNoteEmojiToolbarItem,
  "image",
  QuickNoteAttachmentToolbarItem,
  "taskList",
  "unorderedList",
  "hr",
] as const;

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
export const QUICK_NOTE_FULL_TOOLBAR_ITEMS = DEFAULT_TOOLBAR_ITEMS.filter(
  (item) => item !== "toc" && item !== "materialLibrary",
);

// 语雀/Lake 导出的 bookmark 卡（bookmarkInline 标题样式 / bookmark 块卡样式）在本地
// 无法展示完整详情（无语雀 API），会渲染成"无标题 + 不可点击 + 无样式浮窗"的死卡。
// 用户明确要求：新粘贴的内容统一降级为普通超链接（与虎扑/果壳一致，Lake 的 ne-link，
// 可点击跳转）。降级原理：Lake 内置 cardToLink 命令提供"卡→链接"转换。
// 只在用户粘贴时触发降级新出现的 bookmark 卡；历史/加载的文档不主动改动，seen 幂等收敛。


/**
 * DT-07：把一段「额外清理」挂到 editor.__disposeExtras 上。
 *
 * 顺序与原写法一致（LIFO：后注册的先清），createLakeDocument 只负责汇总；
 * 每一段清理各自 try/catch，单段失败不影响其余（与原嵌套 prevDispose 行为相同）。
 */
export function appendDisposeExtras(editor: LakeEditorInstance, dispose: () => void): void {
  const prevDispose = editor.__disposeExtras;
  editor.__disposeExtras = () => {
    try { if (typeof prevDispose === "function") prevDispose(); } catch { /* ignore */ }
    try { dispose(); } catch { /* ignore */ }
  };
}


/** 内部 plumbing（拆分后唯一写点；语义 = 原 `lakeLastDocInitPerf = perf`，时序不变）。 */
export function recordLakeDocInitPerf(perf: LakeDocInitPerf): void {
  lakeLastDocInitPerf = perf;
}

