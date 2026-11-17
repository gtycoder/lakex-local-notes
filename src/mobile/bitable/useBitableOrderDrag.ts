/**
 * 多维表列表「长按拖拽重排」的**手势单一实现**（261117 P1-4 抽取）：
 * 视图列表（useBitableViewOrderDrag）与字段列表（MobileBitableFieldSheet）共用这一份，
 * 只有「行命中属性」不同（data-view-id / data-field-id），**不写第二套手势**。
 *
 * 手势口径与原实现逐字一致（261111 惯例）：
 * - 长按 = mobile 唯一长按实现 `ui/useLongPress`（350ms / 震动反馈；拖拽起手后移动取消阈值 0）；
 * - **容器级手势不用 setPointerCapture**（会把 mousedown/up 与合成 click 重定向 ⇒ 行内按钮全失效），
 *   拖拽期间挂 window/document 的 move/up/cancel，抬手或卸载时摘掉；
 * - 落点 = `document.elementFromPoint` 命中行的中线判 before/after（与标签管理/目录树同一判据）；
 * - 长按触发后的那一次 click 吞掉（消费式，只吞一次），否则抬手会顺手触发行内动作。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLongPress, type LongPressHandlers } from "../ui/useLongPress";

export interface OrderDragState {
  /** 正在拖的行 id。 */
  id: string;
  /** 当前落点行（不含自己）；null = 还没拖到有效行。 */
  overId: string | null;
  /** 落点在目标行的下半 ⇒ true（插到它后面）。 */
  after: boolean;
}

export type OrderDropPosition = "before" | "after";

export interface UseBitableOrderDragOptions {
  /** 只读态关闭（顺序属正文，不在只读文档里拖）。 */
  enabled: boolean;
  /** 行命中属性（默认 data-view-id；字段列表传 data-field-id）。 */
  rowAttr?: string;
  onReorder: (fromId: string, overId: string, position: OrderDropPosition) => void;
}

export interface UseBitableOrderDragResult {
  drag: OrderDragState | null;
  /** 挂到每一行的 touch 事件（行级：行内按钮的触摸也会冒泡到这里，与标签管理同款）。 */
  longPress: LongPressHandlers;
  /** 在这一行按下（长按回调只能挂一次，用 ref 记住"按下的是哪一行"）。 */
  pressRow: (id: string) => void;
  /** 长按触发后的那一次 click 要吞掉（返回 true = 这次 click 属于拖拽，不执行行动作）。 */
  consumeDragClick: () => boolean;
}

export function useBitableOrderDrag(options: UseBitableOrderDragOptions): UseBitableOrderDragResult {
  const { enabled, onReorder } = options;
  const rowAttr = options.rowAttr ?? "data-view-id";
  const [drag, setDrag] = useState<OrderDragState | null>(null);
  const dragRef = useRef<OrderDragState | null>(null);
  dragRef.current = drag;
  const pressedId = useRef<string | null>(null);
  const startPoint = useRef<{ clientX: number; clientY: number } | null>(null);
  /** 长按真的触发过 ⇒ 随后的 click 不执行行动作；抬手后由 consumeDragClick 消费复位。 */
  const suppressClick = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const rowAttrRef = useRef(rowAttr);
  rowAttrRef.current = rowAttr;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  /**
   * 新的一次按下 = 新手势：先复位"吞 click"标记（上一次拖拽若因故没收到 click，不会误吞这一次的点击）。
   * 长按到点后再置 true，吞掉拖拽抬手后的那一次 click。
   */
  const pressRow = useCallback((id: string) => {
    pressedId.current = id;
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
      const row = hit?.closest("[" + rowAttrRef.current + "]") as HTMLElement | null;
      const overId = row?.getAttribute(rowAttrRef.current) ?? null;
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

  return { drag, longPress, pressRow, consumeDragClick };
}
