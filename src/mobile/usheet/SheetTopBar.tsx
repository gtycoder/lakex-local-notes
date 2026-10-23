/**
 * 移动端表格顶部行（261023 用户定稿：选择态的这些东西都放顶部、与 Sheet 同一行，不算工具栏）。
 *
 * 左：工作表页签（可横滑）；右：高亮当前行列 + 视图比例 + ＋新建工作表 + 工作表列表。
 * 底栏（旧 MobileSheetFooter）已删：底部只留编辑态 dock，阅读/选择态底部不再有工具条。
 */
import { Grid2x2, List, Plus } from "lucide-react";
import type { MobileSheetTab } from "./useSheetChromeState";

export interface SheetTopBarProps {
  sheets: MobileSheetTab[];
  activeId: string;
  zoom: number;
  crosshairOn: boolean;
  onSelect: (id: string) => void;
  onOpenList: (anchor: HTMLElement) => void;
  onCycleZoom: () => void;
  onToggleCrosshair: () => void;
  onAddSheet: () => void;
}

export function SheetTopBar({
  sheets,
  activeId,
  zoom,
  crosshairOn,
  onSelect,
  onOpenList,
  onCycleZoom,
  onToggleCrosshair,
  onAddSheet,
}: SheetTopBarProps) {
  return (
    <div className="mb-usheet-topbar" data-prevent-swipe role="toolbar" aria-label="工作表">
      <div className="mb-usheet-topbar__tabs" role="tablist" aria-label="工作表页签">
        {sheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={sheet.id === activeId}
            className={"mb-usheet-topbar__tab" + (sheet.id === activeId ? " is-active" : "")}
            onClick={() => onSelect(sheet.id)}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      <div className="mb-usheet-topbar__actions">
        <button
          type="button"
          className={"mb-usheet-topbar__btn" + (crosshairOn ? " is-active" : "")}
          aria-label="高亮当前行列"
          title="高亮当前行列"
          aria-pressed={crosshairOn}
          onClick={onToggleCrosshair}
        >
          <Grid2x2 size={18} />
        </button>
        <button type="button" className="mb-usheet-topbar__btn mb-usheet-topbar__zoom" aria-label="视图比例" title="视图比例" onClick={onCycleZoom}>
          {Math.round(zoom)}%
        </button>
        <button type="button" className="mb-usheet-topbar__btn" aria-label="新建工作表" title="新建工作表" onClick={onAddSheet}>
          <Plus size={18} />
        </button>
        <button
          type="button"
          className="mb-usheet-topbar__btn"
          aria-label="工作表列表"
          title="工作表列表"
          onClick={(event) => onOpenList(event.currentTarget)}
        >
          <List size={18} />
        </button>
      </div>
    </div>
  );
}

export default SheetTopBar;
