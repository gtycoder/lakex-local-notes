/**
 * 移动端选择器（P7 追加）：**底部 Sheet 选项列表**，替代原生 <select> 的系统弹层。
 *
 * 为什么不用原生 select（用户 261012 反馈"有点丑"）：
 *   · 原生弹层由系统绘制 —— 不跟我们的主题、字号、圆角走（深色下也是白底、选中态是系统蓝/绿圈）；
 *   · 与既有浮层语言割裂：移动端已经统一成「底部 Sheet / ActionSheet」（见 floating.css）。
 * 方案 = 触发器（.mb-select 外观但**是按钮**，无系统弹层）+ 底部 Sheet 列表：
 *   选中项右侧打勾 + 强调色文字；遮罩点击 / 下拉手势 / 安卓返回键三种关闭方式与其它 Sheet 一致。
 * 口径：结构复用既有原语（.mb-sheet + .mb-list-item），不新造第二套浮层（AGENTS §3#14）。
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { pushBackHandler } from "./backStack";
import { useSwipeToClose } from "./useSwipeToClose";

export interface PickerOption<T extends string | number = number> {
  value: T;
  label: string;
}

/** 通用选择器：值可以是 number（字号/数量）或 string（枚举，如同步模式）。 */
export function PickerSheet<T extends string | number>({
  label,
  value,
  options,
  onChange,
  formatValue,
}: {
  /** Sheet 标题（同时作为触发器的无障碍名） */
  label: string;
  value: T;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  /** 触发器上的文本（默认取当前项 label） */
  formatValue?: (value: T) => string;
}) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useSwipeToClose(sheetRef, () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => { setOpen(false); return true; });
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="mb-select mb-select--trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="mb-select__value">{formatValue ? formatValue(value) : current?.label ?? String(value)}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="mb-scrim" data-prevent-swipe onClick={() => setOpen(false)} />
          <div ref={sheetRef} className="mb-sheet mb-sheet--picker" role="dialog" aria-modal="true" aria-label={label} data-prevent-swipe>
            <div className="mb-sheet__head">
              <span className="mb-sheet__title">{label}</span>
            </div>
            <div className="mb-sheet__body" role="listbox" aria-label={label}>
              {options.map((o) => {
                const selected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={"mb-list-item" + (selected ? " is-selected" : "")}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                  >
                    <span className="mb-list-item__text">{o.label}</span>
                    <span className="mb-list-item__check" aria-hidden="true">{selected ? <Check size={18} /> : null}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
