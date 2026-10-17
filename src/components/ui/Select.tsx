import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Menu } from "./Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { useScrollFade } from "../../hooks/useScrollFade";

/**
 * 下拉原语（261006 Phase 2.2）。
 *
 * 为什么不用原生 `<select>`：它的弹层由 Chromium/OS 绘制，**应用完全无法控制**——
 * 选中项是一条铺满、无内边距、无圆角的系统蓝条，会把我们的菜单表面「盖住」。
 * 这里改为「触发器（复用 .ln-select 的外观）+ 我们自己的菜单表面（.ln-menu）」，于是
 * 圆角/内边距/悬停/选中/阴影/暗色适配全部回到设计系统里。
 *
 * 可访问性：触发器 aria-haspopup=listbox + aria-expanded；选项 role=option + aria-selected；
 * ↑/↓ 移动、Enter/Space 选中、Esc 关闭（关闭后焦点回到触发器）。
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** 无可见 label 时必填（读屏用） */
  label: string;
  className?: string;
  disabled?: boolean;
  /** 弹层宽度跟随触发器（默认 true） */
  matchWidth?: boolean;
}

export function Select({ value, options, onChange, label, className, disabled, matchWidth = true }: SelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 261017 B：弹层列表的上下边缘渐隐（只在真有内容被裁的一侧出现）
  useScrollFade(listRef, open);
  const current = options.find((o) => o.value === value);

  const anchor = triggerRef.current;
  const { surfaceRef, style } = usePopoverPosition({
    open,
    anchor,
    width: matchWidth && anchor ? anchor.offsetWidth : undefined,
    gap: 4,
  });

  const commit = useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
  );

  // 打开后把焦点放到「当前项」，键盘用户不必从第一项开始走。
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? list?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
  }, [open]);

  const move = (dir: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const items = [...list.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = i < 0 ? (dir === 1 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
    items[next].focus();
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={"ln-select" + (className ? " " + className : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="ln-select__value">{current?.label ?? ""}</span>
        <ChevronDown size={14} className="ln-select__chevron" aria-hidden="true" />
      </button>
      {open && (
        <Menu
          onDismiss={() => setOpen(false)}
          surfaceRef={surfaceRef}
          style={style ?? { visibility: "hidden" }}
          label={label}
        >
          <div
            ref={listRef}
            className="ln-select__list"
            role="listbox"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
              else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            }}
          >
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={o.disabled}
                  className={"ln-menu__item ln-select__item" + (selected ? " is-selected" : "")}
                  onClick={() => commit(o.value)}
                >
                  <span className="ln-menu__check" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
                  <span className="ln-menu__label">{o.label}</span>
                </button>
              );
            })}
          </div>
        </Menu>
      )}
    </>
  );
}
