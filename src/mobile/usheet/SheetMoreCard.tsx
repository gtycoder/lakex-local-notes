/**
 * 表格「⋯」卡的**七行图标网格**（261021 P2：对齐语雀 App 的 .lake-sheet-button-set-list-hoz）。
 *
 * 语雀：206×275、底 #fafafa、8px 圆角、每行高 39、无遮罩；语雀有而我们未接的能力保留位置置灰。
 * 第八行是我们自己的「行高/列宽/删除行/列/更多表格工具」——语雀没有，但不能丢能力。
 * 子菜单（颜色/对齐/冻结/行高/列宽/公式）在卡内下钻，复用 SheetPopCard 的行样式。
 */
import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { SheetIcon } from "./SheetIcon";
import { useAnchoredCardStyle, useCardDismiss } from "./sheetCardHooks";
import type { SheetMenuItem, SheetMoreRow } from "./usheetChromeModel";

export interface SheetMoreCardProps {
  host: HTMLElement | null;
  anchor: HTMLElement | null;
  width: number;
  ariaLabel: string;
  rows: SheetMoreRow[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SheetMoreCard({ host, anchor, width, ariaLabel, rows, onSelect, onClose }: SheetMoreCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredCardStyle(host, anchor, width);
  const [submenu, setSubmenu] = useState<{ title: string; items: SheetMenuItem[] } | null>(null);
  useCardDismiss(cardRef, anchor, onClose);

  return (
    <div className="mb-usheet-popcard mb-usheet-morecard" ref={cardRef} role="menu" aria-label={ariaLabel} style={style} data-prevent-swipe>
      {submenu ? (
        <>
          <button type="button" className="mb-usheet-popcard__back" onClick={() => setSubmenu(null)}>
            <ChevronLeft size={16} />
            <span>{submenu.title}</span>
          </button>
          <div className="mb-usheet-popcard__scroll">
            {submenu.items.map((item) => (
              <button key={item.id} type="button" role="menuitem"
                className={"mb-usheet-popcard__row" + (item.danger ? " is-danger" : "") + (item.active ? " is-active" : "")}
                onClick={() => onSelect(item.id)}>
                <span className="mb-usheet-popcard__label">{item.label}</span>
                {item.note && <span className="mb-usheet-popcard__note">{item.note}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="mb-usheet-popcard__scroll">
          {rows.map((row, rowIndex) => (
            <div className="mb-usheet-morecard__row" key={rowIndex}>
              {row.map((button) => (
                <button
                  key={button.id}
                  type="button"
                  className={"mb-usheet-morecard__btn" + (button.active ? " is-active" : "") + (button.danger ? " is-danger" : "")}
                  aria-label={button.label}
                  title={button.label}
                  disabled={button.disabled}
                  onClick={() => {
                    if (button.disabled) return;
                    if (button.children?.length) setSubmenu({ title: button.label, items: button.children });
                    else onSelect(button.id);
                  }}
                >
                  {button.text ? <span className="mb-usheet-morecard__text">{button.text}</span> : <SheetIcon name={button.icon} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SheetMoreCard;
