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
import { useCallback, useEffect, useRef, type CSSProperties, type MutableRefObject, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";

export type OverlayKind = "dialog" | "menu" | "popover";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  /** dialog 追加到遮罩的类（如 .ln-scrim--top 顶部对齐） */
  scrimClassName?: string;
  /** 外部面板 ref（可拖拽/缩放的浮窗需要把自己的 panelRef 接到表面元素） */
  surfaceRef?: Ref<HTMLElement>;
  /** dialog 打开后的首焦点；缺省取首个可操作项 */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Overlay({ open = true, kind, onDismiss, label, className, style, surfaceClassName, scrimClassName, surfaceRef, initialFocus, children }: OverlayProps) {
  const innerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // 把外部 ref（可拖拽面板）与内部 ref 都挂到同一个表面元素上
  const setSurface = useCallback((el: HTMLElement | null) => {
    innerRef.current = el;
    if (typeof surfaceRef === "function") surfaceRef(el);
    else if (surfaceRef) (surfaceRef as MutableRefObject<HTMLElement | null>).current = el;
  }, [surfaceRef]);

  // Esc 关闭（三型通用，capture 阶段，避免被下层快捷键抢先）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onDismiss]);

  // 外点关闭（menu / popover；dialog 由遮罩 mousedown 关闭）
  useEffect(() => {
    if (!open || kind === "dialog") return;
    const onDown = (e: MouseEvent) => {
      const el = innerRef.current;
      if (el && !el.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, kind, onDismiss]);

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

  if (kind === "dialog") {
    return createPortal(
      <div className={"ln-scrim" + (scrimClassName ? " " + scrimClassName : "")} data-prevent-swipe onMouseDown={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>
        <section
          ref={setSurface}
          data-prevent-swipe
          className={(surfaceClassName ?? "ln-dialog") + (className ? " " + className : "")}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          style={style}
          onKeyDown={onKeyDown}
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
      className={"ln-overlay-surface " + surfaceClass + (className ? " " + className : "")}
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

/** 菜单预设：锚定定位 + 外点/Esc 关闭（无遮罩）。 */
export function Menu(props: Omit<OverlayProps, "kind">) {
  return <Overlay kind="menu" {...props} />;
}

/** 气泡/面板预设：同菜单职责，表面为 .ln-popover。 */
export function Popover(props: Omit<OverlayProps, "kind">) {
  return <Overlay kind="popover" {...props} />;
}
