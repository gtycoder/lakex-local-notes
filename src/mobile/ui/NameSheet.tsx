/**
 * 移动端「命名弹窗」（v2 261107 用户点单：新建 / 重命名统一用弹窗，不在原位置内联编辑）。
 *
 * 用途：重命名目录项 / 笔记本、新建文档/表格/多维表/画板/手写板/分组时的名称输入。
 * 统一走 MobileSheet（scrim / 右滑关闭 / 返回栈 / 焦点与滚动锁 / 安全区都由它负责），
 * 行内只保留展示，不再出现贴着行的 <input>（避免键盘顶起整棵目录、行高抖动）。
 */
import { useEffect, useRef, useState } from "react";
import { MobileSheet } from "./MobileSheet";
import { SheetFooter } from "./SheetFooter";

export interface NameSheetProps {
  open: boolean;
  /** 弹窗标题，如「重命名」「新建文档」。 */
  title: string;
  /** 初始值（重命名时 = 原名；新建通常为空）。 */
  initialValue?: string;
  placeholder?: string;
  /** 确认按钮文案，默认「确定」。 */
  confirmText?: string;
  /** 空值时的行内错误文案。 */
  emptyError?: string;
  busy?: boolean;
  onClose(): void;
  onSubmit(value: string): void;
}

export function NameSheet({ open, title, initialValue = "", placeholder = "", confirmText = "确定", emptyError = "名称不能为空", busy = false, onClose, onSubmit }: NameSheetProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError(null);
  }, [open, initialValue]);

  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed) { setError(emptyError); return; }
    onSubmit(trimmed);
  };

  return (
    <MobileSheet
      open={open}
      title={title}
      onClose={() => { if (!busy) onClose(); }}
      bodyClassName="mb-sheet__body--form"
      footer={<SheetFooter
        cancel={{ label: "取消", disabled: busy, onClick: onClose }}
        confirm={{ label: confirmText, onClick: submit, busy }}
      />}
    >
      <span className={"mb-input" + (error ? " is-invalid" : "")}>
        <input
          id="mb-name-sheet-input"
          aria-label={title}
          ref={inputRef}
          value={value}
          autoFocus
          placeholder={placeholder}
          onChange={(event) => { setValue(event.target.value); setError(null); }}
          onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
        />
      </span>
      {error && <div className="qn-tag-sheet__error" role="alert">{error}</div>}
    </MobileSheet>
  );
}
