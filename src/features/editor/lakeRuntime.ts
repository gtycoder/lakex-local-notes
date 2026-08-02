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
        const tocSidebar = document.querySelector(".ne-toc-sidebar, .ne-viewer-toc-sidebar");
        const tocItems = tocSidebar ? tocSidebar.querySelectorAll("a").length : 0;
        console.group("TOC 探测（打开文档后、编辑前跑一次；编辑后再跑一次对比）");
        console.table([{
          sidebar存在: !!tocSidebar,
          侧边栏条目数: tocItems,
          html片段: tocSidebar ? tocSidebar.innerHTML.slice(0, 160).replace(/\s+/g, " ") : "(无侧边栏)",
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
 * 虚拟渲染试验（experiment/virtual-rendering 分支）
 * =================================================
 * 目的：验证 Lake 1.6.0+ 的 virtualRendering 能否解决「大文档首屏图片
 * hydration 被拖后 ~3.5s」的实测问题（107 个 codeblock 卡片时）。
 *
 * 关键前提（来自 lakex-editor-react-component README + dist 反编译）：
 *  - scrollNode 必须指向真实滚动容器：本项目滚动容器是 .document-pane
 *    （body overflow:hidden，Lake 默认回退 document.scrollingElement/body 会拿错，
 *     导致虚拟渲染视口测量错误、TOC 高亮/跳转错位）
 *  - cardLazyInit = allowCardLazyInit 的配置键：视口外卡片懒初始化
 *
 * 回归清单见 VIRTUAL-RENDERING-TEST.md。试验结束合回主干前把 enabled 置 false 或删除本块。
 */
const VIRTUAL_RENDERING = {
  enabled: true,
  scrollContainerSelector: ".document-pane",
  cardLazyInit: true,
};

export function createLakeDocument(
  element: HTMLElement,
  mode: "viewer" | "editor",
  onChange: () => void,
  tocEnabled: boolean,
  noteId: string,
  scrollNode?: HTMLElement | null
): LakeEditorInstance {
  const mount = document.createElement("div");
  mount.className = "lake-editor-mount ne-doc-major-editor";
  element.replaceChildren(mount);

  const customOptions: Record<string, unknown> = {
    disabledPlugins: mode === "viewer" ? ["save", "toolbar", "emoji"] : ["save", "emoji"],
    input: {},
    defaultFontsize: 18,
    toc: { enable: tocEnabled },
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
          scrollNode: () => {
            // 新建标签元素在编辑器创建时尚未布局（useEffect 同步阶段），
            // clientHeight=0 会让虚拟渲染初始视口按 0 计算，导致 TOC 标题
            // 收集错乱（打开时大纲为空，编辑后才出现）。读 offsetHeight
            // 强制同步布局，让高度落地后再交给 Lake。
            const node = (scrollNode
              || (document.querySelector(VIRTUAL_RENDERING.scrollContainerSelector) as HTMLElement | null)
              || document.scrollingElement
              || document.body) as HTMLElement;
            void node.offsetHeight;
            return node;
          },
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
  if (mode === "editor") editor.on("contentchange", onChange);
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
        console.log("[lake-perf] docInitPerf", lakeLastDocInitPerf);
      }
    });
  } catch { /* 非编辑器环境忽略 */ }
  return editor;
}

export function destroyLakeEditor(editor: LakeEditorInstance | null): void {
  try {
    editor?.destroy?.();
    if (!editor?.destroy) editor?.destory?.();
  } catch (error) {
    console.warn("Lake editor cleanup failed", error);
  }
}
