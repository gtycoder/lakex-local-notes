/**
 * 移动端底部 Sheet 原语（MOB-11）。
 *
 * 背景：以前每个面板各写一套骨架 —— scrim、`data-prevent-swipe`（别让底层抽屉手势同时触发）、
 * `useSwipeToClose`、`pushBackHandler`（返回键/返回手势先关面板）。少写一件就是 MOB-01 那类洞：
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
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { pushBackHandler } from "./backStack";
import { useSwipeToClose } from "./useSwipeToClose";

/** 打开中的面板数：滚动锁的嵌套计数（0 → 1 时上锁，回到 0 时还原原值）。 */
let openSheets = 0;
let bodyOverflow = "";
let rootOverflow = "";

function lockPageScroll(): () => void {
  if (openSheets === 0) {
    bodyOverflow = document.body.style.overflow;
    rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  openSheets += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openSheets = Math.max(0, openSheets - 1);
    if (openSheets > 0) return;
    document.body.style.overflow = bodyOverflow;
    document.documentElement.style.overflow = rootOverflow;
  };
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
  /** 无障碍名（默认取字符串标题）。 */
  ariaLabel?: string;
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
  ariaLabel,
  children,
}: MobileSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  /** 打开前的焦点元素：关闭时还回去（面板是临时层，不能让焦点停在 body 上）。 */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => { if (dismissible) onClose(); }, [dismissible, onClose]);

  // 返回键：面板自己消费（否则会落到父层「退工作区 / 退出 App」）。
  useEffect(() => {
    if (!open || !dismissible) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, dismissible, onClose]);

  // 右滑关闭（阈值沿用浮层默认 64px；data-prevent-swipe 让底层抽屉手势不重复响应）。
  useSwipeToClose(sheetRef, dismiss, open && dismissible);

  // 滚动锁：面板开着时页面不跟着滚。
  useEffect(() => { if (!open) return; return lockPageScroll(); }, [open]);

  // 焦点收进面板 / 关闭时归还。
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    // 子内容自带 autoFocus（搜索框 / 知识库名称输入）时不要抢焦点：React 的 autoFocus
    // 在本次 effect 之前已聚焦，再 focus 面板会把光标抢走、软键盘也跟着消失。
    const sheet = sheetRef.current;
    if (sheet && !(active instanceof Node && sheet.contains(active))) sheet.focus({ preventScroll: true });
    return () => {
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

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
        <div className="mb-sheet__grab" />
        <div className="mb-sheet__head">
          <span className={"mb-sheet__title" + (titleClassName ? " " + titleClassName : "")}>{title}</span>
          {dismissible && (
            <button type="button" className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
          )}
        </div>
        <div className={"mb-sheet__body" + (bodyClassName ? " " + bodyClassName : "")}>{children}</div>
        {footer}
      </div>
    </>
  );
}

export default MobileSheet;
