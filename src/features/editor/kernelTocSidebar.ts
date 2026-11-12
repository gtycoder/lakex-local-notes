/**
 * 内核 TOC 侧栏实例访问与刷新（阅读态/编辑态同构）。
 *
 * 261112 R2-S9：从 lakeRuntime.ts **原样搬出**（纯搬移：导出名/行为零变化）。
 * 公共符号仍由 ./lakeRuntime 门面 re-export；内核 lazy 边界不变（只被 lakeRuntime 静态 import）。
 */
import { rlog } from "../../lib/log";
import { errorFields } from "../../core/logFormat";
import { lakeBridge } from "./kernelConfig";
import type { LakeUiReactRef } from "./kernelCardHydration";
import type { LakeEditorInstance } from "./lakeRuntime";
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

/** 内核侧栏实例的真实形状（闭源 bundle：编辑器态自带 update/open/close + setNormalViewStatus，
 *  部分形态只有组件 ref；`_view` 是 React 组件包装，ref 上才是 setNormalViewStatus）。 */
interface NativeTocSidebarInternals {
  update?: (toc: unknown) => void;
  open?: () => void;
  close?: () => void;
  setNormalViewStatus?: (normal: boolean) => void;
  _view?: { getReactRef?: () => LakeUiReactRef | null };
}


/** 取原生 TOC 侧栏实例（bundle: 编辑器 toc 插件 afterInit `this._tocSidebar = ao(qY, …)`；
 * 阅读态插件同构，同挂点 `_tocSidebar`）。返回绑定包装（不改动内核实例）。
 * 插件实例挂在 editor._plugins（数组/Map/对象），逐个找带 `_tocSidebar.update` 的那个。
 * 属私有结构 hack：找不到返回 null，调用方回退到 tocChange 事件重放。 */
function findNativeTocSidebar(editor: LakeEditorInstance | null): NativeTocSidebar | null {
  try {
    const ps = editor?._plugins;
    const list: unknown[] = Array.isArray(ps)
      ? ps
      : ps && typeof (ps as Map<unknown, unknown>).values === "function"
        ? [...(ps as Map<unknown, unknown>).values()]
        : ps && typeof ps === "object"
          ? Object.values(ps as Record<string, unknown>)
          : [];
    for (const p of list) {
      const sb = (p as { _tocSidebar?: NativeTocSidebarInternals })?._tocSidebar;
      if (sb && typeof sb.update === "function") {
        const sidebar = sb;
        return {
          update: (toc) => sidebar.update?.(toc),
          open: () => sidebar.open?.(),
          close: () => sidebar.close?.(),
          setNormalView: (normal) => {
            if (typeof sidebar.setNormalViewStatus === "function") { sidebar.setNormalViewStatus(normal); return; }
            // 编辑态：组件 ref 上 setNormalViewStatus（ek0 为编辑/阅读共用组件）
            const ref = sidebar._view?.getReactRef?.();
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
      const kernel = lakeBridge(editor ?? undefined).kernel;
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
      rlog.warn("editor", "refreshTocSidebar 失败", { ...errorFields(error) });
    }
  };
  later(tryOnce, 0);
  return () => {
    disposed = true;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
}

