/**
 * 表格底栏（261021 P3）：对齐语雀 App 的 .lake-sheet-footer（32px / #fafafa / 上边框）。
 * 左侧工作表列表（≡，打开锚定卡）· 中间页签横滑 · 右侧缩放 −/百分比/+。
 * 只做 chrome；工作表切换 / 缩放都走 Univer facade / command，不碰数据格式。
 */
import { List, Minus, Plus } from "lucide-react";

export interface MobileSheetTab {
  id: string;
  name: string;
}

export interface MobileSheetFooterProps {
  sheets: MobileSheetTab[];
  activeId: string;
  zoom: number;
  onSelect: (id: string) => void;
  onZoom: (delta: number) => void;
  onOpenList: (anchor: HTMLElement) => void;
}

export function MobileSheetFooter({ sheets, activeId, zoom, onSelect, onZoom, onOpenList }: MobileSheetFooterProps) {
  return (
    <div className="mb-usheet-footer" data-prevent-swipe role="toolbar" aria-label="工作表底栏">
      <button type="button" className="mb-usheet-footer__list" aria-label="工作表列表" title="工作表列表"
        onClick={(event) => onOpenList(event.currentTarget)}>
        <List size={16} />
      </button>
      <div className="mb-usheet-footer__tabs" role="tablist" aria-label="工作表">
        {sheets.map((sheet) => (
          <button key={sheet.id} type="button" role="tab" aria-selected={sheet.id === activeId}
            className={"mb-usheet-footer__tab" + (sheet.id === activeId ? " is-active" : "")}
            onClick={() => onSelect(sheet.id)}>
            {sheet.name}
          </button>
        ))}
      </div>
      <div className="mb-usheet-footer__zoom">
        <button type="button" className="mb-usheet-footer__zoom-btn" aria-label="缩小" title="缩小" onClick={() => onZoom(-0.1)}>
          <Minus size={16} />
        </button>
        <span className="mb-usheet-footer__zoom-value">{String(zoom) + "%"}</span>
        <button type="button" className="mb-usheet-footer__zoom-btn" aria-label="放大" title="放大" onClick={() => onZoom(0.1)}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

export default MobileSheetFooter;
