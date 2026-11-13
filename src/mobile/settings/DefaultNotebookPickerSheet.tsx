/**
 * 默认笔记本选择器（261106 task-86）：设置「导入」分组与「首次分享 Markdown」共用。
 *
 * 261113 用户点单重做：此前用 button.mb-set-item 拼「设置行」，而移动端没有全局 button reset
 * ⇒ 浏览器默认外观在 Sheet 里画出一个带粗边框、文字居中的灰盒子（截图里的「个人笔记」），
 * 既不是设置行也不是选择器。改为**既有选择器原语**（与 ui/PickerSheet 同一套）：
 *   · 浮层 = MobileSheet（.mb-sheet，唯一来源；下滑/返回键/焦点/滚动锁都归它）
 *   · 列表 = .mb-sheet--picker + .mb-list-item 行 + 右侧 .mb-list-item__check 打勾
 *   · 选中语义 = role="option" + aria-selected（不再借设置行的 aria-pressed）
 * 打开时默认选中当前值；点一行即回调（调用方写入设置）。
 */
import { Check } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { SheetFooter } from "../ui/SheetFooter";
import { EmptyState } from "../ui/EmptyState";

export interface DefaultNotebookOption {
  id: string;
  title: string;
}

export interface DefaultNotebookPickerSheetProps {
  open: boolean;
  notebooks: readonly DefaultNotebookOption[];
  /** 当前默认笔记本（高亮/勾选）；null = 未设置。 */
  currentId: string | null;
  busy?: boolean;
  /** 标题（设置页用「默认笔记本」，首次分享用「选择导入位置」）。 */
  title?: string;
  onPick(id: string): void;
  onClose(): void;
}

export function DefaultNotebookPickerSheet({ open, notebooks, currentId, busy, title, onPick, onClose }: DefaultNotebookPickerSheetProps) {
  const label = title ?? "默认笔记本";
  return (
    <MobileSheet
      open={open}
      title={label}
      className="mb-sheet--picker"
      onClose={() => { if (!busy) onClose(); }}
      footer={<SheetFooter cancel={{ label: "取消", disabled: busy, onClick: onClose }} />}
    >
      {notebooks.length === 0 ? (
        <EmptyState inset>还没有笔记本：先新建一个知识库</EmptyState>
      ) : (
        <div
          role="listbox"
          aria-label={label}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)')];
            if (items.length === 0) return;
            event.preventDefault();
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next].focus();
          }}
        >
          {notebooks.map((notebook) => {
            const checked = notebook.id === currentId;
            return (
              <button
                key={notebook.id}
                type="button"
                role="option"
                aria-selected={checked}
                className={"mb-list-item" + (checked ? " is-selected" : "")}
                disabled={busy}
                onClick={() => onPick(notebook.id)}
              >
                <span className="mb-list-item__text mb-ellipsis">{notebook.title || "未命名"}</span>
                <span className="mb-list-item__check" aria-hidden="true">{checked ? <Check size={18} /> : null}</span>
              </button>
            );
          })}
        </div>
      )}
    </MobileSheet>
  );
}
