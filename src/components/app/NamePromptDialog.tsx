import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Overlay";
import { InlineRenameInput } from "../ui/InlineRenameInput";

/**
 * 「输入一个名字再创建」的通用弹窗（261105 用户验收：所有需要写名字的新建统一走这里）。
 *
 * 结构与视觉**与目录「重命名」弹窗（TreeRenameDialog / .rename-dialog）一致**（用户 261105 复验）：
 * - Dialog 下 `.ln-dialog__head` 与 `.ln-dialog__body` **同级**，页脚动作是 body 的兄弟（`.ln-dialog__actions`）；
 * - 尺寸/内距/标题与正文档 / 控件高度复用 rename-dialog 那套（见 styles/dialog.css 与 overlay.css 的并列选择器），
 *   本组件不再自带一套尺寸；
 * - 主按钮 `ln-btn--primary`「创建」（busy 时「创建中…」）、次按钮 ghost「取消」，footer 右对齐；
 * - 打开即聚焦；Enter = 提交（空名不提交）、Esc = 取消；空名禁用主按钮；
 * - 错误在本弹窗内显示（`.name-prompt-dialog__error`，令牌色）且**不关闭**，由调用方 onSubmit 抛错驱动。
 */
export interface NamePromptDialogProps {
  open: boolean;
  /** 弹窗标题 / aria-label（如「新建笔记本」「新建标签」）。 */
  title: string;
  /** 输入框的 aria-label（如「笔记本名称」「新标签名称」）。 */
  inputLabel: string;
  placeholder?: string;
  /** 预填名字（新建文档/表格等默认名；可直接确认）。 */
  initialValue?: string;
  submitText?: string;
  cancelText?: string;
  busy?: boolean;
  /** 提交失败的可读原因（显示在弹窗内，弹窗不关闭）。 */
  error?: string | null;
  /** 提交（已 trim、非空）；抛错 ⇒ 弹窗显示错误并保留输入。 */
  onSubmit(name: string): void | Promise<void>;
  onClose(): void;
}

export function NamePromptDialog({
  open, title, inputLabel, placeholder, initialValue = "", submitText = "创建", cancelText = "取消",
  busy = false, error = null, onSubmit, onClose,
}: NamePromptDialogProps) {
  const [name, setName] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // 每次打开重置输入（预填默认名；避免上次残留/重开后误提交旧名字）。
  useEffect(() => { if (open) setName(initialValue); }, [open, initialValue]);
  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    void onSubmit(trimmed);
  };
  return (
    <Dialog open={open} onDismiss={() => { if (!busy) onClose(); }} label={title} className="name-prompt-dialog" initialFocus={inputRef}>
      <div className="ln-dialog__head"><span className="ln-dialog__title">{title}</span></div>
      <div className="ln-dialog__body">
        <span className="ln-input">
          <InlineRenameInput
            inputRef={inputRef}
            className="ln-input__field"
            value={name}
            autoFocus
            emptyPolicy="fallback"
            ariaLabel={inputLabel}
            placeholder={placeholder}
            onChange={setName}
            onCommit={() => submit()}
            onCancel={onClose}
          />
        </span>
        {error && <p className="name-prompt-dialog__error" role="alert">{error}</p>}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" disabled={busy} onClick={onClose}>{cancelText}</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={busy || !trimmed} onClick={submit}>
          {busy ? "创建中…" : submitText}
        </button>
      </div>
    </Dialog>
  );
}
