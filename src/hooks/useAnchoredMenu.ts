import { createElement, useCallback, useMemo, useState, type CSSProperties, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { Menu } from "../components/ui/Overlay";
import { usePopoverPosition } from "./usePopoverPosition";

/**
 * 锚定菜单原语（DT-12，261028）：把「open 状态 + 锚点按钮 + 测量式定位 + <Menu> 关闭」收敛成一处。
 *
 * 为什么有它：小记页的排序/类型筛选/标签筛选/⋯/行内⋯，以及大纲「展开到级别」，各自手写
 *   `const [xOpen, setXOpen] = useState(false)` + `const [xAnchor, setXAnchor] = useState(null)`
 * + `usePopoverPosition({ open, anchor, gap: 6, margin: 6 })`，再在每个按钮上重复
 * `aria-haspopup/aria-expanded` 与「已开则关、否则以当前按钮为锚点」的 toggle。逻辑一模一样却抄了六遍，
 * 少一处 aria 或 toggle 口径不一致都会出「点了不关 / 关不掉」。
 *
 * 迁移只收敛实现：**DOM 结构、类名、几何参数（gap/margin）全部保持原值**，`anchorProps()` 只补点击与 aria。
 * 本文件是 .ts ⇒ `menu()` 用 createElement 产出 <Menu> 元素（不引 JSX，文件名按约定保留 .ts）。
 */
export interface UseAnchoredMenuOptions {
  /** 与锚点的间距（沿用各处原值，默认 6）。 */
  gap?: number;
  /** 视口留白（沿用各处原值，默认 6）。 */
  margin?: number;
  align?: "start" | "end";
  side?: "below" | "right" | "below-fixed";
  /** 固定宽度（首帧就要写进 style，见 usePopoverPosition）。 */
  width?: number;
}

export interface AnchoredMenuTriggerOptions {
  /** 行内按钮上补 stopPropagation（点该按钮不应触发整行点击）。 */
  stopPropagation?: boolean;
}

export interface AnchoredMenuTriggerProps {
  onClick: (event: MouseEvent<HTMLElement>) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
}

export interface AnchoredMenu<Id extends string = string> {
  open: boolean;
  /** 当前打开项（行内⋯这类「同一个菜单服务多行」的场景）；普通菜单为 null。 */
  id: Id | null;
  anchor: HTMLElement | null;
  /** 触发按钮 props：点击开/收（同一行再点 = 收起），并补上菜单所需的 aria。 */
  anchorProps(id?: Id | null, trigger?: AnchoredMenuTriggerOptions): AnchoredMenuTriggerProps;
  /** 该行是否当前打开的那一条（行内按钮的 aria-expanded 用；普通菜单等价于 open）。 */
  isOpenFor(id: Id): boolean;
  openAt(anchor: HTMLElement, id?: Id | null): void;
  close(): void;
  toggle(anchor: HTMLElement, id?: Id | null): void;
  /** usePopoverPosition 的结果（需要自己渲染表面 / 等 placed 时用）。 */
  pos: { surfaceRef: (el: HTMLElement | null) => void; style: CSSProperties | null; placed: boolean };
  /** <Menu> 的最简接线（需要自定义表面类名时自行渲染 Menu 用）。 */
  menuProps: { open: boolean; onDismiss: () => void; surfaceRef: (el: HTMLElement | null) => void; style: CSSProperties | undefined };
  /** 直接产出 <Menu> 元素，等价于手写 <Menu open onDismiss surfaceRef style>。 */
  menu(children: ReactNode, surfaceClassName?: string): ReactElement;
}

export function useAnchoredMenu<Id extends string = string>(options: UseAnchoredMenuOptions = {}): AnchoredMenu<Id> {
  const { gap = 6, margin = 6, align = "start", side = "below", width } = options;
  /** 锚点与「哪一行」放在同一份 state 里：两者永远一起变，不会出现「锚点已换、id 还是旧的」。 */
  const [state, setState] = useState<{ anchor: HTMLElement | null; id: Id | null }>({ anchor: null, id: null });
  const open = state.anchor !== null;
  // 定位仍走测量式原语（DT-03）：先挂屏外量真实宽高，再「下方优先 → 放不下翻上 → 夹进视口」。
  const pos = usePopoverPosition({ open, anchor: state.anchor, gap, margin, align, side, width });

  const close = useCallback(() => setState({ anchor: null, id: null }), []);
  const openAt = useCallback((anchor: HTMLElement, id: Id | null = null) => setState({ anchor, id }), []);
  const toggle = useCallback((anchor: HTMLElement, id: Id | null = null) => {
    // 「已开且仍是同一个目标（普通菜单不区分目标）」→ 收起；否则以当前按钮为锚点打开/换行。
    setState((current) => (current.anchor !== null && (id === null || current.id === id)
      ? { anchor: null, id: null }
      : { anchor, id }));
  }, []);

  const isOpenFor = useCallback((id: Id) => open && state.id === id, [open, state.id]);

  const anchorProps = useCallback((id: Id | null = null, trigger: AnchoredMenuTriggerOptions = {}): AnchoredMenuTriggerProps => ({
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (trigger.stopPropagation) event.stopPropagation();
      toggle(event.currentTarget, id);
    },
    "aria-haspopup": "menu",
    "aria-expanded": id === null ? open : open && state.id === id,
  }), [toggle, open, state.id]);

  const menuProps = useMemo(() => ({ open, onDismiss: close, surfaceRef: pos.surfaceRef, style: pos.style ?? undefined }), [open, close, pos.surfaceRef, pos.style]);
  const menu = useCallback((children: ReactNode, surfaceClassName?: string) => createElement(
    Menu,
    // children 放进 props：Menu 的 props 类型要求带 children（createElement 的第 3 参不参与该重载）。
    { open: menuProps.open, onDismiss: menuProps.onDismiss, surfaceClassName, surfaceRef: menuProps.surfaceRef, style: menuProps.style, children },
  ), [menuProps]);

  return { open, id: state.id, anchor: state.anchor, anchorProps, isOpenFor, openAt, close, toggle, pos, menuProps, menu };
}
