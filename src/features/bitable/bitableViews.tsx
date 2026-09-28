/**
 * 多维表「视图类型」的外观与安全回退（V01 多视图工作台）。
 *
 * 职责边界：视图页签栏在 `BitableViewBar.tsx`，视图**内容**分派在 `BitableEditor.tsx`；
 * 这里只回答两件事 —— 某个视图类型长什么样（图标）、本版本还渲染不了的视图怎么回退。
 *
 * 回退铁律（数据侧见 src/core/bitableDoc.ts）：未知视图类型**只回退显示，绝不改正文**；
 * 表格照常渲染，视图配置与记录一个字节都不动，也绝不白屏。
 */
import { Calendar, ClipboardList, HelpCircle, LayoutGrid, SquareKanban, Table2 } from "lucide-react";
import { isKnownViewType, viewTypeLabel, type BitableView } from "../../core/bitableDoc.js";
import "./bitableViews.css";

/** 视图类型图标（未知类型给 HelpCircle；与 `FieldTypeIcon` 同口径）。 */
export function ViewTypeIcon({ type, size = 13 }: { type: string; size?: number }) {
  switch (type) {
    case "grid": return <Table2 size={size} />;
    case "form": return <ClipboardList size={size} />;
    case "kanban": return <SquareKanban size={size} />;
    case "gallery": return <LayoutGrid size={size} />;
    case "calendar": return <Calendar size={size} />;
    default: return <HelpCircle size={size} />;
  }
}

/** 本版本还渲染不了的视图 → 明确回退提示（表格继续渲染在下方，数据不动）。 */
export function BitableViewFallback({ view }: { view: BitableView }) {
  return (
    <div className="bt-view-fallback" role="status">
      <ViewTypeIcon type={view.type} size={14} />
      <span>
        {isKnownViewType(view.type)
          ? "「" + viewTypeLabel(view.type) + "」正在开发中，当前先按表格视图显示；视图配置与数据会完整保留。"
          : "本版本不认识「" + view.type + "」视图类型，已按表格视图显示；视图配置与数据会完整保留。"}
      </span>
    </div>
  );
}
