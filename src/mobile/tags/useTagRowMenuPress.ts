/**
 * 标签详情条目「长按 / 右键 → 动作菜单」的手势接线（261119 用户裁决：条目上的 × 改为长按菜单）。
 *
 * 语义（文档行与小记卡**同一套**，都走这里）：
 *  · 长按 350ms → 打开动作菜单（打开 / 移除标签 / 取消）；
 *  · onContextMenu（外接键盘 ContextMenu 键 / 右键）打开**同一个**菜单 —— 新增交互必须给键盘路径；
 *  · 长按过的那一次吞掉随后补发的 click（否则弹菜单的同时又打开了内容，AGENTS §7#20）；
 *  · 起手点在条目内按钮上（小记卡「展开/收起」）不算长按，交给按钮自己。
 *
 * 计时/阈值/震动反馈只有一份 = `ui/useLongPress`（AGENTS 红线：禁止第二份长按计时器），
 * 这里只做「按下记目标 + 吞 click + 右键」的接线，**不要自己 setTimeout 做长按**。
 */
import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import { useLongPress } from "../ui/useLongPress";

export interface TagRowMenuPressProps {
  onTouchStart: (event: ReactTouchEvent) => void;
  onTouchMove: (event: ReactTouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}

export interface TagRowMenuPress {
  /** 挂到条目容器上；openMenu = 该条目的动作菜单入口（长按到点时用按下那一刻的这份）。 */
  pressProps: (openMenu: () => void) => TagRowMenuPressProps;
  /** 点击处理器先问一次：true = 这次 click 是长按后补发的，吞掉并复位。 */
  swallowClick: () => boolean;
}

export function useTagRowMenuPress(): TagRowMenuPress {
  /** 当前按下的那条要打开的菜单（hook 只挂一份、多条目共用 ⇒ 用 ref 传目标）。 */
  const openMenuRef = useRef<(() => void) | null>(null);
  /** 长按过 ⇒ 松手补发的那次 click 要吞掉（400ms 兜底复位，防止没来 click 时吞掉下一次正常点击）。 */
  const suppressClick = useRef(false);
  const longPress = useLongPress(() => {
    const open = openMenuRef.current;
    if (!open) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 400);
    open();
  });

  const pressProps = useCallback((openMenu: () => void): TagRowMenuPressProps => ({
    onTouchStart: (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      openMenuRef.current = openMenu;
      longPress.onTouchStart(event);
    },
    onTouchMove: longPress.onTouchMove,
    onTouchEnd: longPress.onTouchEnd,
    onTouchCancel: longPress.onTouchCancel,
    onContextMenu: (event) => { event.preventDefault(); openMenu(); },
  }), [longPress]);

  const swallowClick = useCallback((): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { pressProps, swallowClick };
}
