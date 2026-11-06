/**
 * 移动端多维表「视图列表」底部面板（261030 P0，对齐钉钉右上 ≡）。
 *
 * 切换：点一行切到该视图（写设备本地导航，不进正文）。
 * 新建（261030 用户点单第二轮）：编辑态给「新建视图」入口 —— 表单排第一且做成主按钮，其余四种
 * （表格/看板/画册/日历）用 `.mb-chip` 胶囊；只读态禁用并**写明原因**（触屏没有 hover，不能静默不可点）。
 * 新建本身走 core `addBitableView`（默认配置与桌面同一来源），是否切换、怎么切换由父级决定。
 * 视图操作（261102）：每行 ⋯ 交给父级打开「视图操作」面板（重命名 / 复制 / 删除）。
 * 排序（261105 P1）：编辑态**长按行拖动**改视图顺序（顺序属正文、走与重命名同一份文档写路径；只读态不可拖）。
 * 行结构 = wrapper div + 选择按钮 + ⋯ 图标按钮（按钮不能嵌套），行外观/选中态留在 wrapper 上。
 */
import { useEffect, useState } from "react";
import { Check, MoreHorizontal, Plus } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { BITABLE_VIEW_TYPE_LABEL, type BitableTable, type BitableView, type BitableViewType } from "../../core/bitableDoc.js";
import { mobileViewTabLabel } from "./mobileBitableViewTabs";
import { useBitableViewOrderDrag } from "./useBitableViewOrderDrag";
import type { ViewDropPosition } from "./mobileBitableViewOrder";

/** 新建菜单里除表单外的类型（表单单独做成主按钮 = 「优先表单」）。 */
const SECONDARY_VIEW_TYPES: readonly BitableViewType[] = ["grid", "kanban", "gallery", "calendar"] as const;

export interface MobileBitableViewListSheetProps {
  open: boolean;
  table: BitableTable;
  activeViewId: string;
  /** 文档编辑态：只有编辑态能新建视图（正文写入）。 */
  editable: boolean;
  onSelect: (viewId: string) => void;
  /** 新建视图：类型由这里选，创建 + 切到新视图由父级完成。 */
  onAddView: (type: BitableViewType) => void;
  /** 行内 ⋯：打开该视图的操作面板（父级负责面板与写操作）。 */
  onViewActions: (viewId: string) => void;
  /**
   * 长按拖拽后的新顺序（父级写成正文 —— 视图顺序属**文档数据**，不是设备本地偏好）。
   * 缺省 = 本面板不提供排序（只读态 / 单视图这里也不会起手）。
   */
  onReorderViews?: (fromId: string, overId: string, position: ViewDropPosition) => void;
  onClose: () => void;
}

export function MobileBitableViewListSheet({ open, table, activeViewId, editable, onSelect, onAddView, onViewActions, onReorderViews, onClose }: MobileBitableViewListSheetProps) {
  /** 是否展开类型选择（默认只显示「新建视图」一个入口，避免面板一打开就铺开五项）。 */
  const [choosing, setChoosing] = useState(false);
  /** 排序：只读态 / 单视图 / 父级没给回调 ⇒ 不起手。 */
  const canReorder = editable && table.views.length > 1 && !!onReorderViews;
  const { drag, longPress, pressView, consumeDragClick } = useBitableViewOrderDrag({
    enabled: canReorder,
    onReorder: (fromId, overId, position) => onReorderViews?.(fromId, overId, position),
  });
  // 面板关闭后复位：下次打开仍从「列表 + 新建视图」这一层开始。
  useEffect(() => { if (!open) setChoosing(false); }, [open]);

  const pick = (type: BitableViewType) => {
    setChoosing(false);
    onAddView(type);
  };

  return (
    <MobileSheet open={open} title="视图" onClose={onClose} bodyClassName="mbt-viewlist mb-sheet__body--form">
      <div className={"mbt-viewlist-rows" + (drag ? " is-dragging" : "")}>
        {table.views.map((view: BitableView) => {
          const on = view.id === activeViewId;
          const dropBefore = drag?.overId === view.id && !drag.after;
          const dropAfter = drag?.overId === view.id && drag.after;
          return (
            <div
              key={view.id}
              data-view-id={view.id}
              className={"mbt-viewrow" + (on ? " is-on" : "")
                + (drag?.id === view.id ? " is-dragging" : "")
                + (dropBefore ? " is-drop-before" : "")
                + (dropAfter ? " is-drop-after" : "")}
              onTouchStart={(event) => { pressView(view.id); longPress.onTouchStart(event); }}
              onTouchMove={longPress.onTouchMove}
              onTouchEnd={longPress.onTouchEnd}
              onTouchCancel={longPress.onTouchCancel}
            >
              <button type="button" className="mbt-viewrow__main" aria-label={"选择视图 " + view.name}
                onClick={() => { if (consumeDragClick()) return; onSelect(view.id); }}>
                <span className="mbt-viewrow__name">{view.name}</span>
                <span className="mbt-viewrow__type">{mobileViewTabLabel(view)}</span>
                {on && <Check size={16} className="mbt-viewrow__check" />}
              </button>
              <button type="button" className="mb-iconbtn" aria-label={"视图操作 " + view.name}
                onClick={() => { if (consumeDragClick()) return; onViewActions(view.id); }}>
                <MoreHorizontal size={18} />
              </button>
            </div>
          );
        })}
      </div>
      {canReorder && <div className="mbt-vcfg-hint">长按拖动可排序（顺序随文档同步）。</div>}

      {!editable ? (
        <div className="mb-set-items">
          <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" disabled>
            <Plus size={16} />新建视图
          </button>
          <div className="mbt-vcfg-hint">只读状态不能新建视图，点右上角「编辑」后可新建。</div>
        </div>
      ) : choosing ? (
        <div className="mb-set-items">
          <button type="button" className="mb-btn mb-btn--primary mb-btn--block" onClick={() => pick("form")}>
            <Plus size={16} />{"新建" + BITABLE_VIEW_TYPE_LABEL.form}
          </button>
          <div className="mb-chip-row" role="group" aria-label="选择视图类型">
            {SECONDARY_VIEW_TYPES.map((type) => (
              <button key={type} type="button" className="mb-chip" onClick={() => pick(type)}>{BITABLE_VIEW_TYPE_LABEL[type]}</button>
            ))}
          </div>
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--block" onClick={() => setChoosing(false)}>取消</button>
        </div>
      ) : (
        <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" onClick={() => setChoosing(true)}>
          <Plus size={16} />新建视图
        </button>
      )}
      {editable && <div className="mbt-vcfg-hint">新建的视图与桌面共用同一份文档，可随时切换。</div>}
    </MobileSheet>
  );
}

export default MobileBitableViewListSheet;
