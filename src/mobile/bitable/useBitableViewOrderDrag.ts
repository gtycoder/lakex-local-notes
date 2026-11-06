/**
 * 移动端多维表「视图列表」长按拖拽排序（261105 P1 parity 小项）。
 *
 * **不新造拖拽实现**：手势 = mobile 唯一长按实现 `ui/useLongPress`（350ms / 移动 10px 取消 / 震动反馈），
 * 落点计算和提交方式沿用同仓标签管理（261105 `MobileQuickNoteTagManager`）与目录树同一套口径
 * （`document.elementFromPoint` + `[data-view-id]` 行中线判 before/after）。
 * 这里只做「一次拖拽 → (fromId, overId, position)」的接线，**顺序的语义在 mobileBitableViewOrder**。
 *
 * 与标签管理的两点差异（都是本列表的必需项，不是新范式）：
 * 1. 只读态不参与拖拽（视图顺序属正文，只读文档不写盘）；
 * 2. 拖完那一次抬手后的 click 要**吞掉**（且只吞一次），否则会顺手把视图切走/弹出操作面板；
 *    吞 click 的做法与 `features/ink/InkPagesPanel`、`MultiTabEditor` 同源（这里是消费式：吞掉即复位）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLongPress, type LongPressHandlers } from "../ui/useLongPress";
import type { ViewDropPosition } from "./mobileBitableViewOrder";

export interface ViewOrderDragState {
  /** 正在拖的视图 id。 */
  id: string;
  /** 当前落点行（不含自己）；null = 还没拖到有效行。 */
  overId: string | null;
  /** 落点在目标行的下半 ⇒ true（插到它后面）。 */
  after: boolean;
}

export interface UseBitableViewOrderDragOptions {
  /** 只读态关闭（视图顺序属正文，不在只读文档里拖）。 */
  enabled: boolean;
  onReorder: (fromId: string, overId: string, position: ViewDropPosition) => void;
}

export interface UseBitableViewOrderDragResult {
  drag: ViewOrderDragState | null;
  /** 挂到每一行的 touch 事件（行级：行内按钮的触摸也会冒泡到这里，与标签管理同款）。 */
  longPress: LongPressHandlers;
  /** 在这一行按下（长按回调只能挂一次，用 ref 记住"按下的是哪一行"）。 */
  pressView: (viewId: string) => void;
  /** 长按触发后的那一次 click 要吞掉（返回 true = 这次 click 属于拖拽，不执行行动作）。 */
  consumeDragClick: () => boolean;
}

export function useBitableViewOrderDrag(options: UseBitableViewOrderDragOptions): UseBitableViewOrderDragResult {
  const { enabled, onReorder } = options;
  const [drag, setDrag] = useState<ViewOrderDragState | null>(null);
  const dragRef = useRef<ViewOrderDragState | null>(null);
  dragRef.current = drag;
  const pressedId = useRef<string | null>(null);
  const startPoint = useRef<{ clientX: number; clientY: number } | null>(null);
  /** 长按真的触发过 ⇒ 随后的 click 不执行行动作；抬手后 setTimeout(0) 复位（与 InkPagesPanel 同款）。 */
  const suppressClick = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  /**
   * 新的一次按下 = 新手势：先复位"吞 click"标记（上一次拖拽若因故没收到 click，不会误吞这一次的点击）。
   * 长按到点后再置 true，吞掉拖拽抬手后的那一次 click。
   */
  const pressView = useCallback((viewId: string) => {
    pressedId.current = viewId;
    suppressClick.current = false;
  }, []);

  /** 长按 = 进入拖拽排序；移动取消阈值 0（行上一动就是要滚动，不能误判成长按）。 */
  const longPress = useLongPress((touch) => {
    const id = pressedId.current;
    if (!id || !enabledRef.current) return;
    startPoint.current = touch;
    suppressClick.current = true;
    setDrag({ id, overId: null, after: false });
  }, { moveCancelPx: 0 });

  // 拖拽期间：跟手算落点（行中线判前后），松手提交一次重排。
  useEffect(() => {
    if (!drag) return;
    const compute = (clientY: number): { overId: string | null; after: boolean } => {
      const hit = document.elementFromPoint(startPoint.current?.clientX ?? 0, clientY) as HTMLElement | null;
      const row = hit?.closest("[data-view-id]") as HTMLElement | null;
      const overId = row?.getAttribute("data-view-id") ?? null;
      if (!overId || overId === dragRef.current?.id) return { overId: null, after: false };
      const rect = row!.getBoundingClientRect();
      return { overId, after: clientY > rect.top + rect.height / 2 };
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      // 拖拽中不把纵向手势交给列表滚动（否则 WebView 会先 touchcancel 掉拖拽）。
      event.preventDefault();
      const next = compute(touch.clientY);
      const current = dragRef.current;
      if (!current) return;
      if (current.overId === next.overId && current.after === next.after) return;
      setDrag({ ...current, ...next });
    };
    const finish = () => {
      const current = dragRef.current;
      setDrag(null);
      startPoint.current = null;
      // 标记留给随后到来的那一次 click（由 consumeDragClick 消费掉；下一次 touchstart 也会复位）。
      if (!current?.overId || current.overId === current.id) return;
      onReorderRef.current(current.id, current.overId, current.after ? "after" : "before");
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
  }, [drag !== null]);

  // 卸载：清掉"吞 click"标记，避免下次挂载误吞。
  useEffect(() => () => { suppressClick.current = false; }, []);

  /** 消费式：返回 true 表示这次 click 属于拖拽抬手，调用方**不执行**行内动作。 */
  const consumeDragClick = useCallback((): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return { drag, longPress, pressView, consumeDragClick };
}
