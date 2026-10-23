/**
 * 移动端表格公式栏（261023 用户定稿：**主要输入位置，不能省**）。
 *
 * 形态：地址 + 输入 + ↵（提交并下移）+ ⤢（多行输入），贴在编辑态 dock 上方。
 * 纯受控组件：值/地址/多行态都由 MobileUsheetViewer 持有，提交时由 viewer 写回单元格。
 */
import { useRef } from "react";
import { ChevronDown, CornerDownLeft, Maximize2, Minimize2 } from "lucide-react";

export interface SheetFormulaBarProps {
  address: string;
  value: string;
  multiline: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onToggleMultiline: () => void;
  /** 输入框获得焦点（用于收起面板：面板开着时点公式栏 = 回键盘输入）。 */
  onFocusInput?: () => void;
}

export function SheetFormulaBar({ address, value, multiline, onChange, onCommit, onToggleMultiline, onFocusInput }: SheetFormulaBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="mb-usheet-formula" data-prevent-swipe role="group" aria-label="公式栏">
      <span className="mb-usheet-formula__addr" aria-label="当前单元格">{address}</span>
      {multiline ? (
        <textarea
          ref={areaRef}
          className="mb-usheet-formula__area"
          value={value}
          placeholder="请输入"
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocusInput}
        />
      ) : (
        <input
          ref={inputRef}
          className="mb-usheet-formula__input"
          value={value}
          placeholder="请输入"
          inputMode="text"
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocusInput}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit();
            }
          }}
        />
      )}
      <button type="button" className="mb-usheet-formula__btn" aria-label="换行并提交" title="换行" onClick={onCommit}>
        <CornerDownLeft size={18} />
      </button>
      <button
        type="button"
        className="mb-usheet-formula__btn"
        aria-label={multiline ? "收起多行输入" : "展开多行输入"}
        title="展开输入"
        aria-pressed={multiline}
        onClick={onToggleMultiline}
      >
        {multiline ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>
      <ChevronDown size={0} aria-hidden="true" />
    </div>
  );
}

export default SheetFormulaBar;
