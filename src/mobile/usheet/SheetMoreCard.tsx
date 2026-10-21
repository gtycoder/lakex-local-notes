/**
 * 表格「⋯」卡的**七行图标网格**（261021 P2：对齐语雀 App 的 .lake-sheet-button-set-list-hoz）。
 *
 * 语雀：206×275、底 #fafafa、8px 圆角、每行高 39、无遮罩；语雀有而我们未接的能力保留位置置灰。
 * 第八行是我们自己的「行高/列宽/删除行/列/更多表格工具」——语雀没有，但不能丢能力。
 *
 * 261021 P4-2：子菜单统一走 `SheetMenuBody`（列表 / 圆点色板 / 图标行三种形态），
 * 与 `SheetPopCard` 共用同一份渲染与同一套下钻语义。
 */
import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { SheetIcon } from "./SheetIcon";
import { useAnchoredCardStyle, useCardDismiss } from "./sheetCardHooks";
import { SheetMenuBody } from "./SheetMenuBody";
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
  /** 下钻路径：空 = 七行网格；点了带 children 的按钮 push 一层（卡内下钻，不叠第二张卡）。 */
  const [path, setPath] = useState<SheetMenuItem[]>([]);
  useCardDismiss(cardRef, anchor, onClose);

  const parent = path.length > 0 ? path[path.length - 1] : null;

  return (
    <div className="mb-usheet-popcard mb-usheet-morecard" ref={cardRef} role="menu" aria-label={ariaLabel} style={style} data-prevent-swipe>
      {parent ? (
        <>
          <button type="button" className="mb-usheet-popcard__back" onClick={() => setPath((prev) => prev.slice(0, -1))}>
            <ChevronLeft size={16} />
            <span>{parent.label}</span>
          </button>
          <div className="mb-usheet-popcard__scroll">
            <SheetMenuBody
              items={parent.children ?? []}
              layout={parent.childLayout ?? "list"}
              onSelect={onSelect}
              onDrill={(item) => setPath((prev) => [...prev, item])}
            />
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
                    if (button.children?.length) setPath([button]);
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
