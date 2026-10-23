/**
 * 表格「T」卡（261022 晚用户点单）：文字格式二级 —— B / I / S / U + 字体颜色。
 *
 * 一级工具条只留一个 **T**（「做成一个T一级标签，点击展开这5个选项」）；本卡是它的二级展开。
 * 卡内两段：四个开关（按当前选区格式亮起）+ 8 色字体颜色圆点（点一下立即套用当前选区）。
 * 不拥有数据/命令：动作仍由 MobileUsheetViewer 分派（开关 → dispatchMenu("bold"…)；颜色 → dispatchMenu("font-#…")）。
 */
import { useRef } from "react";
import { SheetIcon } from "./SheetIcon";
import { useAnchoredCardStyle, useCardDismiss } from "./sheetCardHooks";
import {
  SHEET_FONT_COLORS,
  SHEET_FORMAT_TOGGLES,
  type SheetCellFormatLite,
} from "./usheetChromeModel";

export interface SheetFormatCardProps {
  host: HTMLElement | null;
  anchor: HTMLElement | null;
  width: number;
  ariaLabel: string;
  fmt: SheetCellFormatLite;
  /** B / I / S / U 开关（id = bold|italic|strike|underline）。 */
  onToggle: (id: string) => void;
  /** 颜色（id = font-#rrggbb）。 */
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SheetFormatCard({ host, anchor, width, ariaLabel, fmt, onToggle, onSelect, onClose }: SheetFormatCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredCardStyle(host, anchor, width);
  useCardDismiss(cardRef, anchor, onClose);

  return (
    <div className="mb-usheet-popcard mb-usheet-formatcard" ref={cardRef} role="menu" aria-label={ariaLabel} style={style} data-prevent-swipe>
      <div className="mb-usheet-formatcard__toggles">
        {SHEET_FORMAT_TOGGLES.map((item) => {
          const active = Boolean(fmt[item.key]);
          return (
            <button
              key={item.id}
              type="button"
              className={"mb-usheet-formatcard__toggle" + (active ? " is-active" : "")}
              aria-label={item.label}
              title={item.label}
              aria-pressed={active}
              onClick={() => onToggle(item.id)}
            >
              <SheetIcon name={item.icon} />
            </button>
          );
        })}
      </div>
      <div className="mb-usheet-formatcard__swatches" role="group" aria-label="字体颜色">
        {SHEET_FONT_COLORS.map((color) => (
          <button
            key={color.id}
            type="button"
            className="mb-usheet-formatcard__dot"
            // 色块颜色是数据驱动（来自单一来源的色板表），属 DESIGN.md 允许的动态颜色例外。
            style={{ backgroundColor: color.swatch }}
            aria-label={color.label + "字体颜色"}
            title={color.label}
            onClick={() => onSelect(color.id)}
          />
        ))}
      </div>
    </div>
  );
}

export default SheetFormatCard;
