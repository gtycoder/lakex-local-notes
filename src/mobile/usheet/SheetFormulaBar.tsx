/**
 * 移动端表格公式栏（261023 二次定稿：**形态照原来的内核移动公式栏**）。
 *
 * 结构（左 → 右）：✕ 取消 · ✓ 确认 · fx 图标 · 输入框 · ▲ 收起键盘。
 * 纯受控组件：值由 MobileUsheetViewer 持有；✕/✓/▲ 三个动作都抛给 viewer 执行。
 * 说明：原内核公式栏（Univer mobile-formula-bar）就是这样，换成自绘是为了把它放到 dock 上方并统一交互。
 */
import { X, Check, ChevronUp } from "lucide-react";

export interface SheetFormulaBarProps {
  value: string;
  onChange: (value: string) => void;
  /** ✓：写回当前单元格（= 公式 / 数字 / 文本）。 */
  onConfirm: () => void;
  /** ✕：放弃本次输入（恢复单元格原值）。 */
  onCancel: () => void;
  /** ▲：收起键盘（不提交、不改值）。 */
  onCollapse: () => void;
  onFocusInput?: () => void;
  onBlurInput?: () => void;
}

export function SheetFormulaBar({ value, onChange, onConfirm, onCancel, onCollapse, onFocusInput, onBlurInput }: SheetFormulaBarProps) {
  return (
    <div className="mb-usheet-formula" data-prevent-swipe role="group" aria-label="公式栏">
      <button type="button" className="mb-usheet-formula__btn is-cancel" aria-label="取消编辑" title="取消" onClick={onCancel}>
        <X size={20} />
      </button>
      <button type="button" className="mb-usheet-formula__btn is-confirm" aria-label="确认输入" title="确认" onClick={onConfirm}>
        <Check size={20} />
      </button>
      <span className="mb-usheet-formula__fx" aria-hidden="true">fx</span>
      <input
        className="mb-usheet-formula__input"
        value={value}
        placeholder=""
        inputMode="text"
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocusInput}
        onBlur={onBlurInput}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); onConfirm(); }
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        }}
      />
      <button type="button" className="mb-usheet-formula__btn is-collapse" aria-label="收起键盘" title="收起键盘" onClick={onCollapse}>
        <ChevronUp size={20} />
      </button>
    </div>
  );
}

export default SheetFormulaBar;
