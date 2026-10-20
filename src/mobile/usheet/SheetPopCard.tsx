/**
 * 移动端表格的**锚定卡片**（261021：对齐语雀 App 的二级菜单）。
 *
 * 语雀的二级菜单不是底部 Sheet，而是从触发按钮下方展开的卡片：无遮罩、不占全屏、点外部/再点按钮关闭。
 * 这个原语负责「定位 + 外部关闭 + 子菜单下钻 + 分组标题」，内容由 usheetChromeModel 决定；
 * 卡片渲染在 .mobile-usheet 内部（position:absolute），不 portal、不用 fixed，
 * 避免路由层 transform 把 fixed 包含块改掉的历史坑。
 */
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SheetIcon } from "./SheetIcon";
import { useAnchoredCardStyle, useCardDismiss } from "./sheetCardHooks";
import type { SheetMenuItem } from "./usheetChromeModel";

export interface SheetPopCardProps {
  /** 表格宿主（.mobile-usheet），用于把触发按钮的视口坐标换算成宿主内坐标。 */
  host: HTMLElement | null;
  /** 触发按钮；卡片从它下方展开，点它本身不触发外点关闭。 */
  anchor: HTMLElement | null;
  width: number;
  ariaLabel: string;
  items: SheetMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function SheetPopCard({ host, anchor, width, ariaLabel, items, onSelect, onClose }: SheetPopCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredCardStyle(host, anchor, width);
  /** 子菜单路径：空 = 根；点击带 children 的行会 push 一层（卡片内下钻，不叠第二张卡）。 */
  const [path, setPath] = useState<SheetMenuItem[]>([]);
  useCardDismiss(cardRef, anchor, onClose);

  const current = path.length > 0 ? path[path.length - 1].children ?? [] : items;
  const title = path.length > 0 ? path[path.length - 1].label : null;

  return (
    <div className="mb-usheet-popcard" ref={cardRef} role="menu" aria-label={ariaLabel} style={style} data-prevent-swipe>
      {title && (
        <button type="button" className="mb-usheet-popcard__back" onClick={() => setPath((prev) => prev.slice(0, -1))}>
          <ChevronLeft size={16} />
          <span>{title}</span>
        </button>
      )}
      <div className="mb-usheet-popcard__scroll">
        {current.map((item) => (
          item.header ? (
            <div key={item.id} className="mb-usheet-popcard__header">{item.label}</div>
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={"mb-usheet-popcard__row" + (item.danger ? " is-danger" : "") + (item.active ? " is-active" : "")}
              onClick={() => {
                if (item.children?.length) setPath((prev) => [...prev, item]);
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
      </div>
    </div>
  );
}

export default SheetPopCard;
