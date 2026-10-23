/**
 * 移动端表格公式栏（261023 五次定稿）：地址 + 输入 + ↵ + **最右「展开多行」**。
 *
 * - 回显：选区变化时由 viewer 同步 value/address；点网格会先 blur，保证立刻显示新格内容。
 * - 光标：普通 input（点哪落哪、可选中、方向键正常）；多行时是普通 textarea。
 * - 最右侧按钮：展开/收起多行输入（用户点单）。
 */
import { useEffect, useRef } from "react";
import { CornerDownLeft, Maximize2, Minimize2 } from "lucide-react";

export interface SheetFormulaBarProps {
  address: string;
  value: string;
  expanded: boolean;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onToggleExpand: () => void;
  onFocusInput?: () => void;
  onBlurInput?: () => void;
}

export function SheetFormulaBar({ address, value, expanded, onChange, onConfirm, onToggleExpand, onFocusInput, onBlurInput }: SheetFormulaBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRunRef = useRef(true);
  // 展开/收起后把焦点放到当前输入面并把光标放到末尾（展开多行 = 继续输入）。首帧不抢焦点（避免挂载即弹键盘/回显卡住）。
  useEffect(() => {
    if (firstRunRef.current) { firstRunRef.current = false; return; }
    const el = rootRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(".mb-usheet-formula__input");
    if (!el) return;
    el.focus();
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* 忽略 */ }
  }, [expanded]);

  return (
    <div ref={rootRef} className={"mb-usheet-formula" + (expanded ? " is-expanded" : "")} data-prevent-swipe role="group" aria-label="公式栏">
      <span className="mb-usheet-formula__addr" aria-label="当前单元格">{address}</span>
      {expanded ? (
        <textarea
          className="mb-usheet-formula__input mb-usheet-formula__area"
          value={value}
          placeholder=""
          aria-label="单元格内容"
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocusInput}
          onBlur={onBlurInput}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onConfirm(); }
            if (event.key === "Escape") { event.preventDefault(); (event.target as HTMLTextAreaElement).blur(); }
          }}
        />
      ) : (
        <input
          className="mb-usheet-formula__input"
          value={value}
          placeholder=""
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="单元格内容"
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocusInput}
          onBlur={onBlurInput}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); onConfirm(); }
            if (event.key === "Escape") { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
          }}
        />
      )}
      <button type="button" className="mb-usheet-formula__btn" aria-label="确认输入" title="确认" onClick={onConfirm}>
        <CornerDownLeft size={19} />
      </button>
      <button
        type="button"
        className="mb-usheet-formula__btn"
        aria-label={expanded ? "收起多行" : "展开多行"}
        title={expanded ? "收起多行" : "展开多行"}
        aria-pressed={expanded}
        onClick={onToggleExpand}
      >
        {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>
    </div>
  );
}

export default SheetFormulaBar;
