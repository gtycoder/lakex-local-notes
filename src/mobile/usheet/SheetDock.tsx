/**
 * 移动端表格编辑态 dock（261023 定稿：与文档编辑器底部 dock 同一套形态与交互）。
 *
 * - 单行图标工具条，贴在键盘上沿；一级按钮顺序 ＝ ＋插入 | T | 数据 | 视图 | ⋯更多 | 撤销 | 重做，右侧固定键盘。
 * - 一级按钮展开面板时**变成 ✕**（同文档 .med-toggle.med-open），再点 ✕ = 收面板并放回键盘。
 * - 键盘键两态：键盘开着 = 键盘+斜线（收起）；键盘收起/面板开着 = 键盘（展开）。
 * - 261024：A 批只改面板样式；dock 不新增确认键（确认由公式栏 ↵ 承担，用户要求去掉重复的 ✓）。
 */
import { Filter, Keyboard, KeyboardOff, LayoutGrid, MoreHorizontal, Plus, Redo2, Type, Undo2, X } from "lucide-react";
import { SHEET_DOCK_ITEMS, type SheetDockId } from "./usheetChromeModel";

const DOCK_ICONS: Record<SheetDockId, typeof Plus> = {
  insert: Plus,
  format: Type,
  data: Filter,
  view: LayoutGrid,
  more: MoreHorizontal,
};

export interface SheetDockProps {
  open: SheetDockId | null;
  keyboardOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToggle: (id: SheetDockId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onKeyboard: () => void;
}

export function SheetDock({ open, keyboardOpen, canUndo, canRedo, onToggle, onUndo, onRedo, onKeyboard }: SheetDockProps) {
  const kbLabel = open ? "收起面板" : keyboardOpen ? "收起键盘" : "展开键盘";
  return (
    <div className="mb-usheet-dock" data-prevent-swipe role="toolbar" aria-label="表格工具">
      <div className="mb-usheet-dock__scroll">
        {SHEET_DOCK_ITEMS.map((item) => {
          const Icon = DOCK_ICONS[item.id];
          const active = open === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={"mb-usheet-dock__btn" + (active ? " is-open" : "")}
              aria-label={active ? "关闭" + item.label : item.label}
              title={item.label}
              aria-pressed={active}
              onClick={() => onToggle(item.id)}
            >
              {active ? <X size={20} /> : item.id === "format" ? <span className="mb-usheet-dock__glyph">T</span> : <Icon size={20} />}
            </button>
          );
        })}
        <button type="button" className="mb-usheet-dock__btn" aria-label="撤销" title="撤销" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={19} />
        </button>
        <button type="button" className="mb-usheet-dock__btn" aria-label="重做" title="重做" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={19} />
        </button>
      </div>
      <button type="button" className="mb-usheet-dock__btn mb-usheet-dock__kb" aria-label={kbLabel} title={kbLabel} onClick={onKeyboard}>
        {keyboardOpen && !open ? <KeyboardOff size={20} /> : <Keyboard size={20} />}
      </button>
    </div>
  );
}

export default SheetDock;
