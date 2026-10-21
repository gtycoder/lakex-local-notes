/**
 * 锚定卡片里的**菜单主体**（261021 P4-2 收口成单一来源）。
 *
 * 语雀的二级菜单有三种形态，全部由 `usheetChromeModel` 的数据决定，不在组件里各写一套：
 * - `list`（默认）：文字行（可带图标 / 备注 / 危险色 / 下钻箭头 / 分组标题）；
 * - `swatch`：**圆点色板**（字色 / 填充色；色值来自 `SheetMenuItem.swatch`，属于"数据驱动颜色"，不是写死的视觉）；
 * - `icons`：**图标行**（水平对齐）。
 *
 * 色板/图标行只做"点一下就选"，不参与下钻；列表行里带 `children` 的走 `onDrill`。
 */
import { ChevronRight } from "lucide-react";
import { SheetIcon } from "./SheetIcon";
import type { SheetMenuItem } from "./usheetChromeModel";

export type SheetMenuLayout = "list" | "swatch" | "icons";

export interface SheetMenuBodyProps {
  items: SheetMenuItem[];
  layout?: SheetMenuLayout;
  onSelect: (id: string) => void;
  /** 列表行里有子菜单时下钻（由卡片自己维护路径栈）。 */
  onDrill: (item: SheetMenuItem) => void;
}

export function SheetMenuBody({ items, layout = "list", onSelect, onDrill }: SheetMenuBodyProps) {
  if (layout === "swatch") {
    return (
      <div className="mb-usheet-swatches">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={"mb-usheet-swatch" + (item.active ? " is-active" : "")}
            aria-label={item.label}
            title={item.label}
            style={{ backgroundColor: item.swatch }}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>
    );
  }
  if (layout === "icons") {
    return (
      <div className="mb-usheet-icons">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={"mb-usheet-icons__btn" + (item.active ? " is-active" : "")}
            aria-label={item.label}
            title={item.label}
            onClick={() => onSelect(item.id)}
          >
            <SheetIcon name={item.icon ?? "align-left"} size={18} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <>
      {items.map((item) => (
        item.header ? (
          <div key={item.id} className="mb-usheet-popcard__header">{item.label}</div>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={"mb-usheet-popcard__row" + (item.danger ? " is-danger" : "") + (item.active ? " is-active" : "")}
            onClick={() => {
              if (item.children?.length) onDrill(item);
              else onSelect(item.id);
            }}
          >
            {item.icon && <span className="mb-usheet-popcard__icon"><SheetIcon name={item.icon} size={16} /></span>}
            <span className="mb-usheet-popcard__label">{item.label}</span>
            {item.note && <span className="mb-usheet-popcard__note">{item.note}</span>}
            {item.children?.length ? <ChevronRight size={14} className="mb-usheet-popcard__chev" /> : null}
          </button>
        )
      ))}
    </>
  );
}

export default SheetMenuBody;
