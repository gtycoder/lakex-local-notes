/**
 * 移动端弹层菜单（思源 .b3-menu--fullscreen.b3-menu--sheet 口径，逐条对齐 siyuan-master menus/Menu.ts）：
 *  - 贴底面板、高 56dvh（思源 setSheetHeight = innerHeight * .56）、顶部圆角 + grabber、遮罩 opacity .2；
 *  - 根层无标题（.b3-menu__title--root），下钻后标题 = 上一层项名 + 左箭头返回；
 *  - 子菜单 = 整屏横向平移（.b3-menu__item--show > .b3-menu__submenu{transform:translateX(-100%)}）；
 *  - 危险项 .b3-menu__item--warning（--b3-theme-error）；进出场 150ms cubic-bezier(0,0,.2,1)。
 * 替换原 .mobile-dropdown（跟随手指的小浮层 = 桌面右键语义）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { pushBackHandler } from "./backStack";
import { useSwipeToClose } from "./useSwipeToClose";

export interface MobileSheetItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** 危险操作：红色（思源 __item--warning） */
  danger?: boolean;
  disabled?: boolean;
  /** 右侧浅色说明（计数/状态） */
  note?: string;
  children?: MobileSheetItem[];
}

export interface MobileSheetMenuProps {
  open: boolean;
  items: MobileSheetItem[];
  onClose: () => void;
  /** 叶子项被点击（父项点击只做下钻）；path = 从根到该项的项链 */
  onSelect: (item: MobileSheetItem, path: MobileSheetItem[]) => void;
  /** 标题右侧动作（思源不放 X，靠遮罩/返回；这里留可选逃生口） */
  headerAction?: ReactNode;
}

const CLOSE_MS = 170;

export function MobileSheetMenu({ open, items, onClose, onSelect, headerAction }: MobileSheetMenuProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [path, setPath] = useState<MobileSheetItem[]>([]);
  const timer = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
      setMounted(true);
      setPath([]);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    timer.current = window.setTimeout(() => { timer.current = null; setMounted(false); }, CLOSE_MS);
    return () => { if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; } };
  }, [open]);

  const close = useCallback(() => { setShown(false); onClose(); }, [onClose]);
  const back = useCallback((): boolean => {
    let consumed = false;
    setPath((p) => { if (p.length === 0) return p; consumed = true; return p.slice(0, -1); });
    return consumed;
  }, []);

  // 返回键/返回手势：先退子菜单，退无可退再关面板
  useEffect(() => {
    if (!mounted) return;
    return pushBackHandler(() => { if (back()) return true; close(); return true; });
  }, [mounted, back, close]);

  // 右滑关闭/返回（对齐思源：全屏 menu/model 右滑；子层右滑 = 返回上一层）
  const dismiss = useCallback(() => { if (!back()) close(); }, [back, close]);
  useSwipeToClose(sheetRef, dismiss, mounted);

  if (!mounted) return null;

  const renderLevel = (levelItems: MobileSheetItem[], depth: number): ReactNode => levelItems.map((it) => {
    const hasChildren = !!it.children?.length;
    const expanded = path[depth]?.id === it.id;
    const Icon = it.icon;
    return (
      <button key={it.id} role="menuitem" disabled={it.disabled}
        className={"mb-menusheet__item" + (expanded ? " is-show" : "") + (it.danger ? " is-danger" : "")}
        onClick={() => {
          if (it.disabled) return;
          if (hasChildren) { setPath((p) => [...p.slice(0, depth), it]); return; }
          onSelect(it, [...path.slice(0, depth), it]);
        }}>
        {Icon ? <span className="mb-menusheet__icon"><Icon size={18} /></span> : <span className="mb-menusheet__icon" aria-hidden="true" />}
        <span className="mb-menusheet__label">{it.label}</span>
        {it.note && <span className="mb-menu-note">{it.note}</span>}
        {hasChildren && <span className="mb-menusheet__icon"><ChevronRight size={16} /></span>}
        {hasChildren && (
          <div className="mb-menusheet__submenu">
            <div className="mb-menusheet__items">{renderLevel(it.children!, depth + 1)}</div>
          </div>
        )}
      </button>
    );
  });

  const title = path.length === 0 ? null : path[path.length - 1].label;
  return (
    <>
      <div className="mb-scrim mb-scrim--state is-open" data-prevent-swipe onClick={close} aria-hidden="true" />
      <div ref={sheetRef} className={"mb-menusheet" + (shown ? " is-open" : "")} role="menu" data-prevent-swipe>
        <div className={"mb-menusheet__title" + (path.length === 0 ? " mb-menusheet__title--root" : "")} onClick={() => { back(); }} data-prevent-swipe>
          {path.length > 0 && <span className="mb-menusheet__icon"><ChevronLeft size={18} /></span>}
          <span className="mb-menusheet__label">{title ?? ""}</span>
          {headerAction && <span className="mb-menu-head-action">{headerAction}</span>}
        </div>
        <div className="mb-menusheet__items">{renderLevel(items, 0)}</div>
      </div>
    </>
  );
}
