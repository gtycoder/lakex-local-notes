/**
 * 移动端表格公式栏（261023 三次定稿：**恢复自绘「仿钉钉」形态**）。
 *
 * 结构（左 → 右）：地址（A11）· 输入框 · ↵ 确认。
 * 必须支持：① **回显**——切换单元格时显示该格内容；② **光标**——普通 input，点哪落哪、可定位可选中。
 * 输入框是受控组件但只在「未聚焦」时接受外部回显，避免把用户正在输入的内容冲掉。
 */
import { CornerDownLeft } from "lucide-react";

export interface SheetFormulaBarProps {
  address: string;
  value: string;
  onChange: (value: string) => void;
  /** ↵：写回当前单元格（公式 / 数字 / 文本）。 */
  onConfirm: () => void;
  onFocusInput?: () => void;
  onBlurInput?: () => void;
}

export function SheetFormulaBar({ address, value, onChange, onConfirm, onFocusInput, onBlurInput }: SheetFormulaBarProps) {
  return (
    <div className="mb-usheet-formula" data-prevent-swipe role="group" aria-label="公式栏">
      <span className="mb-usheet-formula__addr" aria-label="当前单元格">{address}</span>
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
      <button type="button" className="mb-usheet-formula__btn" aria-label="确认输入" title="确认" onClick={onConfirm}>
        <CornerDownLeft size={19} />
      </button>
    </div>
  );
}

export default SheetFormulaBar;
