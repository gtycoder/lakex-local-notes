/**
 * 多维表视图页签栏（V01 多视图工作台）。
 *
 * 职责单一：把当前数据表的 `views[]` 渲染成一排「可切换 / 拖拽排序 / 双击重命名 / ⋯ 菜单」的页签，
 * 并提供「新建视图」入口（五种视图类型）。视图**内容**不在这里，见 `BitableEditor` 的视图分派；
 * 视图配置的读写仍由 `BitableEditor` 统一落 doc，这里只上报意图。
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { BITABLE_VIEW_TYPES, BITABLE_VIEW_TYPE_LABEL, type BitableView, type BitableViewType } from "../../core/bitableDoc.js";
import { Popover } from "./bitableCells.js";
import { ViewTypeIcon } from "./bitableViews.js";

export interface BitableViewBarProps {
  views: BitableView[];
  activeViewId: string;
  readOnly: boolean;
  /** 数据表列表收起后的「展开 + 切换数据表」区（属于表格维度，不属于视图）。 */
  leading?: ReactNode;
  onSelect: (viewId: string) => void;
  /** 双击页签 = 重命名（弹窗由上层持有）。 */
  onRenameRequest: (viewId: string) => void;
  /** ⋯ = 重命名/复制/删除菜单（浮层由上层持有：它要读 views 长度等配置）。 */
  onMore: (viewId: string, anchor: HTMLElement) => void;
  onAddView: (type: BitableViewType) => void;
  onReorder: (fromId: string, toId: string) => void;
}

export function BitableViewBar({ views, activeViewId, readOnly, leading, onSelect, onRenameRequest, onMore, onAddView, onReorder }: BitableViewBarProps) {
  /** 拖拽重排是页签栏自己的展示态，不进正文、也不该由编辑器持有。 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="bt-viewbar">
      {leading}
      {views.map((view) => (
        <div key={view.id}
          className={"bt-view-tab" + (view.id === activeViewId ? " active" : "") + (draggingId === view.id ? " dragging" : "")}
          draggable={!readOnly}
          onDragStart={() => setDraggingId(view.id)}
          onDragOver={() => { if (draggingId && draggingId !== view.id) onReorder(draggingId, view.id); }}
          onDragEnd={() => setDraggingId(null)}>
          <button type="button" className="bt-view-name" onClick={() => onSelect(view.id)} onDoubleClick={() => onRenameRequest(view.id)}>
            <span className="bt-view-icon" aria-hidden="true"><ViewTypeIcon type={view.type} /></span>{view.name}
          </button>
          <button type="button" className="bt-view-more" title="视图操作" aria-label="视图操作" disabled={readOnly}
            onClick={(event) => onMore(view.id, event.currentTarget)}><ChevronDown size={12} /></button>
        </div>
      ))}
      <button type="button" className="bt-icon-btn" title="新建视图" aria-label="新建视图" disabled={readOnly}
        onClick={(event) => setAddAnchor(event.currentTarget)}><Plus size={14} /></button>
      <Popover open={Boolean(addAnchor)} anchor={addAnchor} onClose={() => setAddAnchor(null)} width={200}>
        <div className="bt-panel">
          {BITABLE_VIEW_TYPES.map((type) => (
            <button key={type} type="button" className="bt-menu-item ln-menu__item"
              onClick={() => { onAddView(type); setAddAnchor(null); }}>
              <ViewTypeIcon type={type} />{BITABLE_VIEW_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
