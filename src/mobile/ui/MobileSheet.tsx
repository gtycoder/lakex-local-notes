/**
 * 移动端底部 Sheet 原语（MOB-11）。
 *
 * 背景：以前每个面板各写一套骨架 —— scrim、`data-prevent-swipe`（别让底层抽屉手势同时触发）、
 * `useSwipeDownDismiss`、`pushBackHandler`（返回键/返回手势先关面板）。少写一件就是 MOB-01 那类洞：
 * 返回键直接退出 App 或退出工作区（用户体感「闪退」）。这里一次做对，业务面板只留「标题 + 内容」。
 *
 * 表面与几何**全部沿用既有 `.mb-sheet` 系列类名**（floating.css 是唯一来源，不新造第二套弹层）：
 *   .mb-scrim + .mb-sheet > (.mb-sheet__grab, .mb-sheet__head > .mb-sheet__title, .mb-sheet__body)
 * ⇒ 迁移方把原来手写的 scrim/sheet 换成 <MobileSheet> 即可，类名与 DOM 结构不变（视觉快照不变）。
 *
 * 边界（不要在本文件里加视觉）：
 *  · 只有**底部** Sheet；左右抽屉走 `.side-panel` + `usePanelDrag`，不属本原语。
 *  · 可下钻菜单走 `MobileSheetMenu`（子菜单整屏平移、返回栈先退子层），不要套本原语。
 *  · 焦点：打开时把焦点收进面板、关闭时还给原元素；**不做 Tab 硬陷阱** —— 移动端没有 Tab 遍历，
 *    硬 trap 会跟 WebView 软键盘/输入法抢焦点，且本仓没有设备门禁能验（AGENTS §7#17 口径）。
 *  · 滚动锁：打开期间锁住页面滚动（html/body 的 overflow），按**打开中的面板数**嵌套计数，
 *    叠层时先关掉的那一个不会把锁提前放开。
 */
import { useCallback, useEffect, useRef, type ReactNode, type Ref } from "react";
import { lockPageScroll } from "../../lib/pageScrollLock";
import { restoreFocus } from "../../lib/focusRestore";
import { X } from "lucide-react";
import { pushBackHandler } from "./backStack";
import { useKeyboardStableSheet } from "../hooks/useKeyboardStableSheet";
import { dismissKeyboardOnPointerDown } from "./dismissKeyboard";
import { useSheetResize } from "./useSheetResize";
import { useSwipeDownDismiss } from "./useSwipeDownDismiss";

/** 模态移动浮层共用焦点收放与嵌套滚动锁；不规定头部/正文结构，不增加Tab陷阱。 */
export function useSheetModalFocus(open: boolean, surfaceRef: import("react").RefObject<HTMLElement | null>): void {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // 滚动锁：面板开着时页面不跟着滚。
  useEffect(() => { if (!open) return; return lockPageScroll(); }, [open]);

  // 焦点收进面板 / 关闭时归还。
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    // 子内容自带 autoFocus（搜索框 / 知识库名称输入）时不要抢焦点：React 的 autoFocus
    // 在本次 effect 之前已聚焦，再 focus 面板会把光标抢走、软键盘也跟着消失。
    const sheet = surfaceRef.current;
    if (sheet && !(active instanceof Node && sheet.contains(active))) sheet.focus({ preventScroll: true });
    return () => {
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // 261116：触发器（卡片「更多」）常在打开 Sheet 的同一次更新里卸载 ⇒ 退到主区域，不落 body。
      restoreFocus(previous);
    };
  }, [open]);

  // 261116：模态 Sheet 打开期间让背景不可聚焦（aria-modal 只是声明）。
  // 做法 = 沿 Sheet 的祖先链，把每一级的兄弟节点惰性化（Sheet 自身与祖先保持可用）；
  // 遮罩 .mb-scrim 必须跳过 —— 它是关闭入口，inert 掉就点不动了。
  // 按属性判断跳过「别人已经加的 inert」，关闭时只摘自己加的。
  useEffect(() => {
    if (!open) return;
    const sheet = surfaceRef.current;
    if (!sheet) return;
    const applied: HTMLElement[] = [];
    let node: HTMLElement | null = sheet;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === node) continue;
        if (sibling.matches(".mb-scrim")) continue;
        if (["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(sibling.tagName)) continue;
        if (sibling.hasAttribute("inert")) continue;
        sibling.setAttribute("inert", "");
        applied.push(sibling);
      }
      node = parent;
    }
    return () => {
      for (const el of applied) el.removeAttribute("inert");
    };
  }, [open, surfaceRef]);
}

export interface MobileSheetProps {
  open: boolean;
  /** 标题（不给就只留关闭按钮）；无障碍名默认取字符串标题。 */
  title?: ReactNode;
  /** 追加到 `.mb-sheet__title` 的类名（例：`mb-ellipsis` 长标题省略号 —— 迁移既有面板时保持原类名）。 */
  titleClassName?: string;
  /** 关闭入口：遮罩 / 右滑 / 返回键 / 右上 × 共用同一个回调。 */
  onClose: () => void;
  /** 允许用户关闭（false = 只能由流程自己关：不收遮罩点击、不响应右滑/返回键，也不画 × ）。 */
  dismissible?: boolean;
  /** 固定在 `.mb-sheet` 底部的脚注（flex 子项；样式由使用方给现有 mb-* 类，本原语不加 CSS）。 */
  footer?: ReactNode;
  /** 追加到 `.mb-sheet` 的类名（迁移既有面板时保留原类名 ⇒ 视觉不变）。 */
  className?: string;
  /** 追加到 `.mb-sheet__body` 的类名。 */
  bodyClassName?: string;
  /** 追加到 `.mb-sheet__body` 的 ref（长列表虚拟化需要拿到滚动容器；不改变默认行为）。 */
  bodyRef?: Ref<HTMLDivElement>;
  /** 无障碍名（默认取字符串标题）。 */
  ariaLabel?: string;
  /** 头部拖拽可**自主调整高度**（261117 用户点单）：上拉变高、下拉变矮、松手停驻；到最小高度继续下拉松手 = 关闭。 */
  resizable?: boolean;
  children: ReactNode;
}

export function MobileSheet({
  open,
  title,
  titleClassName,
  onClose,
  dismissible = true,
  footer,
  className,
  bodyClassName,
  bodyRef,
  ariaLabel,
  resizable = false,
  children,
}: MobileSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => { if (dismissible) onClose(); }, [dismissible, onClose]);

  // 返回键：面板自己消费（否则会落到父层「退工作区 / 退出 App」）。
  useEffect(() => {
    if (!open || !dismissible) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, dismissible, onClose]);

  // 右滑关闭（阈值沿用浮层默认 64px；data-prevent-swipe 让底层抽屉手势不重复响应）。
  // 261110 用户点单：底部 Sheet = 下滑关闭（手柄的本义）；内部滚动不在顶部时不启动，避免抢列表滚动。
  // resizable Sheet 的**头部**拖拽归 useSheetResize（调高度）⇒ 下滑关闭忽略头部起点。
  useSwipeDownDismiss(sheetRef, dismiss, {
    enabled: open && dismissible,
    scrollSelector: ".mb-sheet__body",
    ignoreSelector: resizable ? ".mb-sheet__head" : undefined,
  });
  // 261117 用户点单：头部拖拽自主调整高度（自由停驻；到最小高度继续下拉松手 = 关闭）。
  useSheetResize(headRef, sheetRef, { enabled: open && resizable, onDismiss: dismiss });

  useSheetModalFocus(open, sheetRef);
  // 261106 task-94：键盘弹起时**不推动弹窗**（top/height 钉在键盘前几何，键盘覆盖下方列表；输入框自动滚入可见区）。
  // 本原语覆盖全部含输入/无输入的底部 Sheet；无输入焦点时零副作用。
  useKeyboardStableSheet(sheetRef, open);

  if (!open) return null;

  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);
  return (
    <>
      <div className="mb-scrim" data-prevent-swipe onClick={dismiss} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={"mb-sheet" + (className ? " " + className : "")}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-prevent-swipe
      >
        <div className="mb-sheet__grab" onPointerDown={dismissKeyboardOnPointerDown} />
        {/* 261117：点标题区 = 「完成编辑」的显式出口（收起键盘、露出底部确认钮）；返回键优先收键盘见 backStack。 */}
        <div ref={headRef} className="mb-sheet__head mb-glass mb-glass--bar" data-mb-topbar data-edge="sheet" onPointerDown={dismissKeyboardOnPointerDown}>
          <span className={"mb-sheet__title" + (titleClassName ? " " + titleClassName : "")}>{title}</span>
          {dismissible && (
            <button type="button" className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
          )}
        </div>
        <div ref={bodyRef} className={"mb-sheet__body" + (bodyClassName ? " " + bodyClassName : "")}>{children}</div>
        {footer}
      </div>
    </>
  );
}

export default MobileSheet;
