/**
 * 移动端多维表「视图列表」长按拖拽排序（261105 P1 parity 小项；261117 P1-4 起改为通用手势的薄壳）。
 *
 * **不新造拖拽实现**：手势收口在 `useBitableOrderDrag`（视图/字段两个列表共用一份；
 * 长按 = `ui/useLongPress`、document move/up/cancel、落点 = 行中线，261111 惯例全在那里）。
 * 这里只固定「行命中属性 = data-view-id」并保留原 API；**顺序的语义在 mobileBitableViewOrder**。
 *
 * 两点既有约定（不是新范式）：
 * 1. 只读态不参与拖拽（视图顺序属正文，只读文档不写盘）；
 * 2. 拖完那一次抬手后的 click 要**吞掉**（且只吞一次），否则会顺手把视图切走/弹出操作面板。
 */
import type { LongPressHandlers } from "../ui/useLongPress";
import { useBitableOrderDrag, type OrderDragState, type OrderDropPosition } from "./useBitableOrderDrag";
import type { ViewDropPosition } from "./mobileBitableViewOrder";

export type ViewOrderDragState = OrderDragState;

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
  const result = useBitableOrderDrag({
    enabled: options.enabled,
    rowAttr: "data-view-id",
    onReorder: (fromId, overId, position: OrderDropPosition) => options.onReorder(fromId, overId, position),
  });
  return {
    drag: result.drag,
    longPress: result.longPress,
    pressView: result.pressRow,
    consumeDragClick: result.consumeDragClick,
  };
}
