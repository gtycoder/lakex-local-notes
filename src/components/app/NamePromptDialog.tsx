import { useEffect, useState } from "react";
import { Dialog } from "../ui/Overlay";
import { InlineRenameInput } from "../ui/InlineRenameInput";

/**
 * 「输入一个名字再创建」的通用弹窗（261105 用户验收：新建笔记本 / 新建标签从内联输入改成弹窗）。
 *
 * 交互定稿（两处同一套，不要各写一份）：
 * - 标题 + 输入框，打开即聚焦（autoFocus）、全不选中；
 * - Enter = 提交（空名不提交）、Esc = 取消（点击遮罩同样取消，不创建）；
 * - 空名时「创建」禁用；提交中按钮显示进行中并禁用；
 * - 错误（重名等）在本弹窗内显示且**不关闭**，由调用方的 onSubmit 抛错驱动。
 *
 * 只负责输入与按钮；真正的创建动作（onCreateTag / onCreate）由调用方注入。
 */
export interface NamePromptDialogProps {
  open: boolean;
  /** 弹窗标题 / aria-label（如「新建笔记本」「新建标签」）。 */
  title: string;
  /** 输入框的 aria-label（如「笔记本名称」「新标签名称」）。 */
  inputLabel: string;
  placeholder?: string;
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
  open, title, inputLabel, placeholder, submitText = "创建", cancelText = "取消",
  busy = false, error = null, onSubmit, onClose,
}: NamePromptDialogProps) {
  const [name, setName] = useState("");
  // 每次打开重置输入（避免上次残留/重开后误提交旧名字）。
  useEffect(() => { if (open) setName(""); }, [open]);
  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    void onSubmit(trimmed);
  };
  return (
    <Dialog open={open} onDismiss={() => { if (!busy) onClose(); }} label={title} className="name-prompt-dialog">
      <div className="ln-dialog__body">
        <header className="ln-dialog__head">
          <span className="ln-dialog__title">{title}</span>
        </header>
        <span className="ln-input">
          <InlineRenameInput
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
        {error && <p className="ln-empty name-prompt-dialog__error" role="alert">{error}</p>}
        <footer className="ln-dialog__actions">
          <button type="button" className="ln-btn ln-btn--ghost" disabled={busy} onClick={onClose}>{cancelText}</button>
          <button type="button" className="ln-btn ln-btn--secondary" disabled={busy || !trimmed} onClick={submit}>
            {busy ? "创建中…" : submitText}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
