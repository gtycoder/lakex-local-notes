/**
 * 浮层原语（Phase 1a，260926）。
 *
 * 为什么有它：全仓曾有 21 处手写 createPortal 浮层，各自处理遮罩/外点/Esc/层序，漏一处就出
 * 「透明面板 / 遮罩盖不住外壳」这类结构 bug。这里把「portal + 层序 + 外点关闭 + Esc + 焦点 +
 * 滚动锁」收敛成唯一入口；表面（底色/描边/圆角/阴影）由 overlay.css 的 .ln-scrim / .ln-dialog /
 * .ln-menu / .ln-popover 单一来源提供。调用方只传内容，不自造表面。
 *
 * 用法：
 *   <Dialog open={open} onDismiss={close} label="删除确认">…</Dialog>
 *   <Menu open={open} onDismiss={close} style={{ left, top }}>…</Menu>
 *   <Popover open={open} onDismiss={close} style={{ left, top }}>…</Popover>
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

export type OverlayKind = "dialog" | "menu" | "popover" | "drawer";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let overlaySeq = 0;
/** 当前打开的浮层栈（后开者在栈顶）。Esc 只关栈顶，避免「对话框内开着下拉时把对话框一起关掉」。 */
const openOverlayStack: number[] = [];

interface OverlayProps {
  /** 缺省 true：条件渲染的调用方（menu/popover）可省略；dialog 一般显式传。 */
  open?: boolean;
  kind: OverlayKind;
  /** 外点 / Esc / 遮罩的统一关闭回调 */
  onDismiss: () => void;
  /** 映射 aria-label（对话框必填，菜单不填） */
  label?: string;
  /** 只加「内容级」类；不要用来造表面 */
  className?: string;
  /** menu / popover 的定位（left/top 等） */
  style?: CSSProperties;
  /** 覆盖默认表面类（默认 dialog=.ln-dialog / menu=.ln-menu / popover=.ln-popover）。表面仍只由 overlay.css 提供。 */
  surfaceClassName?: string;
  /** dialog 追加到遮罩的类（如 .ln-scrim--top 顶部对齐 / .ln-scrim--right 侧边抽屉） */
  scrimClassName?: string;
  /** 菜单/气泡抬到对话框之上（对话框内打开的嵌套下拉/颜色面板）；默认层序见 overlay.css 令牌带 */
  raised?: boolean;
  /** 外部面板 ref（可拖拽/缩放的浮窗需要把自己的 panelRef 接到表面元素） */
  surfaceRef?: Ref<HTMLElement>;
  /** 外点关闭豁免：返回 true 时不关闭（如锚点按钮本身） */
  ignoreOutside?: (target: Node) => boolean;
  /** 点击其它嵌套浮层时也关闭本层；默认 false = 保留悬停子菜单的父层保护。 */
  closeOnNestedOverlay?: boolean;
  /** dialog 打开后的首焦点；缺省取首个可操作项 */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Overlay({ open = true, kind, onDismiss, label, className, style, surfaceClassName, scrimClassName, raised, surfaceRef, ignoreOutside, closeOnNestedOverlay = false, initialFocus, children }: OverlayProps) {
  const [overlayId] = useState(() => (overlaySeq += 1));
  const innerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // 把外部 ref（可拖拽面板）与内部 ref 都挂到同一个表面元素上
  const setSurface = useCallback((el: HTMLElement | null) => {
    innerRef.current = el;
    if (typeof surfaceRef === "function") surfaceRef(el);
    else if (surfaceRef) (surfaceRef as MutableRefObject<HTMLElement | null>).current = el;
  }, [surfaceRef]);

  // 入栈/出栈：Esc 只会关掉栈顶那一层（对话框内的下拉开着时，先关下拉、不动对话框）
  useEffect(() => {
    if (!open) return;
    openOverlayStack.push(overlayId);
    return () => {
      const i = openOverlayStack.lastIndexOf(overlayId);
      if (i >= 0) openOverlayStack.splice(i, 1);
    };
  }, [open, overlayId]);

  // Esc 关闭（三型通用，capture 阶段，避免被下层快捷键抢先）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openOverlayStack[openOverlayStack.length - 1] !== overlayId) return;
      e.stopPropagation();
      onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onDismiss, overlayId]);

  // 外点关闭（menu / popover；dialog 由遮罩 mousedown 关闭）
  useEffect(() => {
    if (!open || kind === "dialog" || kind === "drawer") return;
    const onDown = (e: MouseEvent) => {
      const el = innerRef.current;
      const target = e.target as Node;
      if (ignoreOutside?.(target)) return;
      if (el && !el.contains(target)) {
        // 嵌套浮层（悬停子菜单）：点在另一层浮层表面时不关闭本层，交给那层处理。
        const node = target instanceof Element ? target : target.parentElement;
        if (node?.closest("[data-context-menu]") && !closeOnNestedOverlay) return;
        onDismiss();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, kind, onDismiss, ignoreOutside, closeOnNestedOverlay]);

  // dialog：首焦点 + 滚动锁 + 关闭后恢复焦点
  useEffect(() => {
    if (!open || kind !== "dialog") return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const surface = innerRef.current;
    if (surface) {
      const first = initialFocus?.current ?? surface.querySelector<HTMLElement>(FOCUSABLE) ?? surface;
      first.focus();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, kind, initialFocus]);

  if (!open) return null;

  // Tab 圈闭（dialog）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (kind !== "dialog" || e.key !== "Tab") return;
    const surface = innerRef.current;
    if (!surface) return;
    const items = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) {
      e.preventDefault();
      surface.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (kind === "dialog" || kind === "drawer") {
    const isDialog = kind === "dialog";
    return createPortal(
      <div className={"ln-scrim" + (isDialog ? "" : " ln-scrim--drawer") + (scrimClassName ? " " + scrimClassName : "")} data-prevent-swipe onMouseDown={(e) => { if (isDialog && e.target === e.currentTarget) onDismiss(); }}>
        <section
          ref={setSurface}
          data-prevent-swipe
          className={(surfaceClassName ?? "ln-dialog") + (className ? " " + className : "")}
          role="dialog"
          aria-modal={isDialog}
          aria-label={label}
          tabIndex={-1}
          style={style}
          onKeyDown={isDialog ? onKeyDown : undefined}
        >
          {children}
        </section>
      </div>,
      document.body,
    );
  }

  const surfaceClass = surfaceClassName ?? (kind === "menu" ? "ln-menu" : "ln-popover");
  return createPortal(
    <div
      ref={setSurface}
      className={"ln-overlay-surface " + surfaceClass + (raised ? " ln-overlay-surface--raised" : "") + (className ? " " + className : "")}
      data-context-menu
      role={kind === "menu" ? "menu" : "dialog"}
      aria-label={label}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}

/** 对话框预设：遮罩 + 居中 + 焦点圈闭 + Esc/外点关闭 + 滚动锁。 */
export function Dialog(props: Omit<OverlayProps, "kind">) {
  return <Overlay kind="dialog" {...props} />;
}

/** 抽屉预设：右侧停靠、无遮罩、不锁滚动/焦点（表格仍可交互），Esc 关闭；用于记录详情。 */
export function Drawer(props: Omit<OverlayProps, "kind">) {
  return <Overlay kind="drawer" {...props} />;
}

/** 菜单预设：锚定定位 + 外点/Esc 关闭（无遮罩）。 */
export function Menu(props: Omit<OverlayProps, "kind">) {
  return <Overlay kind="menu" {...props} />;
}

/** 气泡/面板预设：同菜单职责，表面为 .ln-popover。 */
export function Popover(props: Omit<OverlayProps, "kind">) {
  return <Overlay kind="popover" {...props} />;
}

export interface HoverPopoverProps extends Omit<OverlayProps, "kind" | "open" | "surfaceRef"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 表面形态：popover（默认，.ln-popover）/ menu（.ln-menu，role=menu；用于子菜单）。 */
  kind?: "menu" | "popover";
  /** 触发元素（锚点按钮）：与浮层表面共享同一段悬停区（进入打开 / 离开关闭），光标可自由移入操作。 */
  anchorRef: RefObject<HTMLElement | null>;
  /** 外部获取表面元素（子菜单需要测量尺寸做定位）。 */
  panelRef?: Ref<HTMLElement>;
  /** 进入打开的延时（ms）；缺省 200，防误触。 */
  openDelayMs?: number;
  /** 离开关闭的延时（ms）；缺省 150，给「锚点 → 表面」的过渡留出时间。 */
  closeDelayMs?: number;
}

/**
 * 悬停可交互气泡（260926 标准化，补 Overlay 原语缺口）。
 *
 * 与 <Popover> 的差别：<Popover> 只按「点击/外点」开关，适合点开的菜单；
 * 而「指针悬停即展开详情，且允许把光标移进气泡里点按钮/看列表」是一类常用交互
 * （云同步状态、空间状态…），此前各组件手写 createPortal/内联浮层 + 各自的 hover 定时器，
 * 结果光标常常进不去气泡。这里把「锚点与表面共享悬停区 + 开/关延时」收敛成唯一入口；
 * portal / 外点 / Esc / 层序仍全部复用 Overlay。
 */
export function HoverPopover({ open, onOpenChange, anchorRef, kind = "popover", panelRef, openDelayMs = 200, closeDelayMs = 150, onDismiss, ...rest }: HoverPopoverProps) {
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const surfaceElRef = useRef<HTMLElement | null>(null);
  const setSurface = useCallback((el: HTMLElement | null) => {
    surfaceElRef.current = el;
    if (typeof panelRef === "function") panelRef(el);
    else if (panelRef) (panelRef as MutableRefObject<HTMLElement | null>).current = el;
  }, [panelRef]);
  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; onOpenChange(false); }, closeDelayMs);
  }, [onOpenChange, closeDelayMs]);

  // 锚点悬停：进入延时打开（与表面共享同一段悬停区）
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const onEnter = () => {
      clearTimers();
      openTimer.current = window.setTimeout(() => { openTimer.current = null; onOpenChange(true); }, openDelayMs);
    };
    const onLeave = () => scheduleClose();
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [anchorRef, clearTimers, scheduleClose, onOpenChange, openDelayMs]);

  // 表面悬停：原生 mouseenter/leave 直接挂到表面元素（portal 内 React 合成 enter/leave 不可靠，
  // 会导致「光标移进气泡就关闭」）。进入取消关闭，离开延时关闭。
  useEffect(() => {
    if (!open) return;
    const el = surfaceElRef.current;
    if (!el) return;
    const onEnter = () => clearTimers();
    const onLeave = () => scheduleClose();
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [open, clearTimers, scheduleClose]);

  return (
    <Overlay
      kind={kind}
      open={open}
      surfaceRef={setSurface}
      onDismiss={onDismiss ?? (() => onOpenChange(false))}
      {...rest}
    />
  );
}

export interface SubmenuProps {
  /** 触发行内容（图标 + 文案）；外层 .context-menu-item-label 由本组件包好。 */
  label: ReactNode;
  /** 子菜单内容（按钮等菜单项）。 */
  children: ReactNode;
  disabled?: boolean;
  openDelayMs?: number;
  closeDelayMs?: number;
}

/**
 * 悬停子菜单（260926 标准化）：父菜单里一行「▸」，悬停时在相邻侧展开子菜单面板，光标可移入点选项。
 *
 * 复用 <HoverPopover>（portal + 外点/Esc/层序 + .ln-menu 表面）；本组件只负责：
 *  - 相邻侧定位：默认贴行右侧，放不下自动翻左；上下夹在视口内；
 *  - 行 UI（.context-menu-item.has-submenu + ▸）。
 * 点本行/子菜单都不会误关父菜单（Overlay 的嵌套浮层保护按 [data-context-menu] 放行）。
 */
export function Submenu({ label, children, disabled = false, openDelayMs = 120, closeDelayMs = 150 }: SubmenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const row = rowRef.current;
    const panel = panelRef.current;
    if (!row || !panel) return;
    const margin = 8;
    const gap = 2;
    const rowRect = row.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const openLeft = rowRect.right + gap + width + margin > window.innerWidth;
    const left = openLeft ? rowRect.left - gap - width : rowRect.right + gap;
    const top = Math.min(Math.max(margin, rowRect.top - 4), Math.max(margin, window.innerHeight - margin - height));
    setPosition({ left: Math.max(margin, left), top });
  }, [open]);

  return (
    <>
      <div
        ref={rowRef}
        className={"context-menu-item has-submenu" + (disabled ? " is-disabled" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { if (!disabled) setOpen(true); }}
      >
        <span className="context-menu-item-label">{label}</span>
        <ChevronRight size={14} />
      </div>
      <HoverPopover
        kind="menu"
        open={disabled ? false : open}
        onOpenChange={setOpen}
        anchorRef={rowRef}
        panelRef={panelRef}
        onDismiss={() => setOpen(false)}
        ignoreOutside={(target) => rowRef.current?.contains(target) ?? false}
        className="context-menu-submenu"
        style={position ?? undefined}
        openDelayMs={openDelayMs}
        closeDelayMs={closeDelayMs}
      >
        {children}
      </HoverPopover>
    </>
  );
}
