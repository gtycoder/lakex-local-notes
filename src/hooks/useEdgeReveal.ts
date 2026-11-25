/**
 * 左缘触发把手（260922 用户定稿：隐形 8px 热区 + 跟手把手）：
 * 指针进入热区 → 立刻淡入把手（Y 跟随指针，钳制在热区内）；**驻留 EDGE_HANDLE_DWELL_MS** 后
 * 才浮出目录面板预览（防止只是划过左缘就弹）。把手点击 = 固定/取消固定（与热区点击同语义）。
 *
 * D-05（261125 审计终审批次）：从 src/App.tsx 纯搬家（零行为变化），含定时器/监听器清理。
 * 只用 ref + class 操作 DOM：mousemove 高频，不能每次 setState 触发整棵 App 重渲染。
 * 相位机纯决策在 components/model/sidebarHoverMachine（W5）；相位从 DOM/定时器真实来源读取。
 */
import { useCallback, useEffect, useRef } from "react";
import { EDGE_HANDLE_DWELL_MS } from "../desktop/desktopTypes";
import { reduceHover, type HoverEffect, type HoverEvent } from "../components/model/sidebarHoverMachine";

export interface UseEdgeRevealOptions {
  /** 驻留到点后浮出目录面板预览。 */
  showSidebarPreview: () => void;
  hideSidebarPreview: () => void;
  toggleSidebarDock: () => void;
  /** 目录栏渲染形态：离开 collapsed 态即收把手（把手只服务收起态的召唤）。 */
  sidebarRenderMode: string;
}

export function useEdgeReveal({ showSidebarPreview, hideSidebarPreview, toggleSidebarDock, sidebarRenderMode }: UseEdgeRevealOptions) {
  const edgeHotzoneRef = useRef<HTMLDivElement | null>(null);
  const edgePreviewTimer = useRef<number | null>(null);
  const cancelEdgePreview = useCallback(() => {
    if (edgePreviewTimer.current !== null) {
      window.clearTimeout(edgePreviewTimer.current);
      edgePreviewTimer.current = null;
    }
  }, []);
  const showEdgeHandle = useCallback((clientY: number) => {
    const el = edgeHotzoneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = Math.max(rect.top + 40, Math.min(rect.bottom - 40, clientY));
    el.style.setProperty("--edge-handle-y", `${Math.round(y)}px`);
    el.classList.add("is-active");
  }, []);
  const hideEdgeHandle = useCallback(() => {
    cancelEdgePreview();
    edgeHotzoneRef.current?.classList.remove("is-active");
  }, [cancelEdgePreview]);
  const armEdgePreview = useCallback(() => {
    cancelEdgePreview();
    edgePreviewTimer.current = window.setTimeout(() => {
      edgePreviewTimer.current = null;
      showSidebarPreview();
    }, EDGE_HANDLE_DWELL_MS);
  }, [cancelEdgePreview, showSidebarPreview]);
  useEffect(() => () => cancelEdgePreview(), [cancelEdgePreview]);
  // W5：把手相位机（纯决策在 ./components/model/sidebarHoverMachine；相位从 DOM/定时器真实来源读取，不额外持有 state）
  const edgeHandleShown = useCallback(() => Boolean(edgeHotzoneRef.current?.classList.contains("is-active")), []);
  const edgeDwellArmed = useCallback(() => edgePreviewTimer.current !== null, []);
  const applyEdgeEffects = useCallback((effects: HoverEffect[], clientY: number) => {
    for (const effect of effects) {
      if (effect === "showHandle") showEdgeHandle(clientY);
      else if (effect === "hideHandle") hideEdgeHandle();
      else if (effect === "armDwell") armEdgePreview();
      else if (effect === "cancelDwell") cancelEdgePreview();
      else if (effect === "showPreview") showSidebarPreview();
      else if (effect === "hidePreview") hideSidebarPreview();
      else if (effect === "toggleDock") toggleSidebarDock();
    }
  }, [showEdgeHandle, hideEdgeHandle, armEdgePreview, cancelEdgePreview, showSidebarPreview, hideSidebarPreview, toggleSidebarDock]);
  const dispatchEdge = useCallback((event: HoverEvent, clientY: number) => {
    const { effects } = reduceHover({ handleShown: edgeHandleShown(), dwellArmed: edgeDwellArmed() }, event);
    applyEdgeEffects(effects, clientY);
  }, [applyEdgeEffects, edgeHandleShown, edgeDwellArmed]);

  // 非指针清理（260924）：窗口失焦 / 页面隐藏时**收不到 pointerleave**，否则 is-active 残留 ⇒
  // 回到「收起」态时把手"常驻"。这里只收把手 + 取消驻留，不动面板模式。
  useEffect(() => {
    const clearEdgeHandle = () => hideEdgeHandle();
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") clearEdgeHandle(); };
    window.addEventListener("blur", clearEdgeHandle);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearEdgeHandle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hideEdgeHandle]);

  // 把手是 10px 边缘热区的「召唤物」，不是持久 UI。窗口失焦/页面隐藏之外，快速划出左缘、
  // 首次进入知识库时指针已经停在热区里、或热区因布局重建吞掉 pointerleave，都可能留下
  // `.is-active`。这里用全局 pointermove 做真实位置兜底：指针一旦明确离开热区/目录栏就收把手。
  useEffect(() => {
    if (sidebarRenderMode !== "collapsed") hideEdgeHandle();
  }, [hideEdgeHandle, sidebarRenderMode]);

  useEffect(() => {
    const clearWhenOutside = (event: PointerEvent) => {
      const hotzone = edgeHotzoneRef.current;
      if (!hotzone?.classList.contains("is-active")) return;
      const path = event.composedPath();
      if (path.includes(hotzone)) return;
      if (path.some((node) => node instanceof Element && (node.classList.contains("sidebar") || node.classList.contains("edge-hotzone-handle")))) return;
      hideEdgeHandle();
    };
    window.addEventListener("pointermove", clearWhenOutside, true);
    return () => window.removeEventListener("pointermove", clearWhenOutside, true);
  }, [hideEdgeHandle]);

  return { edgeHotzoneRef, dispatchEdge, hideEdgeHandle };
}
