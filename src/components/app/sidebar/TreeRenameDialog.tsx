import { useRef, useState } from "react";
import { Dialog } from "../../ui/Overlay";
import { InlineRenameInput } from "../../ui/InlineRenameInput";

/** 目录节点重命名弹窗（用户 261006：原内联输入改成弹窗；打开期间目录栏保持展开）。 */
export function TreeRenameDialog({ initial, onCancel, onConfirm }: { initial: string; onCancel: () => void; onConfirm: (title: string) => void }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();
  // 新建文档会先落默认标题再打开本弹窗；接受默认名也必须能确认。
  // 非空是唯一门槛：改成同名是无副作用的确认，不应把按钮置灰。
  const canConfirm = trimmed.length > 0;
  return (
    <Dialog open onDismiss={onCancel} label="重命名" className="rename-dialog" initialFocus={inputRef}>
      <div className="ln-dialog__head"><span className="ln-dialog__title">重命名</span></div>
      <div className="ln-dialog__body">
        <span className="ln-input">
          {/* 空名策略 = fallback：回车不提交、保持原名（与「确定」按钮的 disabled={!canConfirm} 同一条口径）。 */}
          <InlineRenameInput
            inputRef={inputRef}
            className="ln-input__field"
            ariaLabel="节点名称"
            value={value}
            autoFocus
            selectOnFocus
            emptyPolicy="fallback"
            onChange={setValue}
            onCommit={onConfirm}
            onCancel={onCancel}
          />
        </span>
      </div>
      <div className="ln-dialog__actions">
        <button className="ln-btn ln-btn--ghost" onClick={onCancel}>取消</button>
        <button className="ln-btn ln-btn--primary" disabled={!canConfirm} onClick={() => { if (canConfirm) onConfirm(trimmed); }}>确定</button>
      </div>
    </Dialog>
  );
}
