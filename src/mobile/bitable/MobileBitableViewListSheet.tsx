/**
 * 移动端多维表「视图列表」底部面板（261030 P0，对齐钉钉右上 ≡）。
 *
 * 只做切换：点一行切到该视图（写设备本地导航，不进正文）。
 * 「新建视图」在只读态禁用并写明理由；编辑态同样暂不支持（P0 不扩写视图配置）。
 */
import { Check } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import type { BitableTable, BitableView } from "../../core/bitableDoc.js";
import { mobileViewTabLabel } from "./mobileBitableViewTabs";

export interface MobileBitableViewListSheetProps {
  open: boolean;
  table: BitableTable;
  activeViewId: string;
  onSelect: (viewId: string) => void;
  onClose: () => void;
}

export function MobileBitableViewListSheet({ open, table, activeViewId, onSelect, onClose }: MobileBitableViewListSheetProps) {
  return (
    <MobileSheet open={open} title="视图" onClose={onClose} bodyClassName="mbt-viewlist mb-sheet__body--form">
      <div className="mbt-viewlist-rows">
        {table.views.map((view: BitableView) => {
          const on = view.id === activeViewId;
          return (
            <button key={view.id} type="button" className={"mbt-viewrow" + (on ? " is-on" : "")} onClick={() => onSelect(view.id)}>
              <span className="mbt-viewrow__name">{view.name}</span>
              <span className="mbt-viewrow__type">{mobileViewTabLabel(view)}</span>
              {on && <Check size={16} className="mbt-viewrow__check" />}
            </button>
          );
        })}
      </div>
      <button type="button" className="mb-btn mb-btn--secondary mb-btn--block" disabled>+ 新建视图（只读）</button>
      <div className="mbt-vcfg-hint">看板 / 画册 / 日历在桌面已支持；移动端本轮先做 表单 + 内容（表格/卡片）。</div>
    </MobileSheet>
  );
}

export default MobileBitableViewListSheet;
