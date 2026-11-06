/**
 * 默认笔记本选择器（261106 task-86）：设置「导入」分组与「首次分享 Markdown」共用。
 * 只用 MobileSheet + 既有行原语；打开时**默认选中当前值**（Check 标记），选中即回调（调用方写入设置）。
 */
import { Check } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";

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
  return (
    <MobileSheet
      open={open}
      title={title ?? "默认笔记本"}
      onClose={() => { if (!busy) onClose(); }}
      bodyClassName="mb-sheet__body--form"
      footer={<div className="mb-sheet__foot">
        <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={onClose}>取消</button>
      </div>}
    >
      {notebooks.length === 0 ? (
        <div className="mb-empty">还没有笔记本：先新建一个知识库</div>
      ) : (
        <div className="mb-set-items">
          {notebooks.map((notebook) => {
            const checked = notebook.id === currentId;
            return (
              <button
                key={notebook.id}
                type="button"
                className={"mb-set-item" + (checked ? " is-selected" : "")}
                aria-label={"选择笔记本 " + (notebook.title || "未命名")}
                aria-pressed={checked}
                disabled={busy}
                onClick={() => onPick(notebook.id)}
              >
                <span className="mb-set-item__main">
                  <span className="mb-set-name">{notebook.title || "未命名"}</span>
                  {checked && <span className="mb-set-item__desc">当前默认</span>}
                </span>
                <span className="mb-set-item__ctl">{checked ? <Check size={18} /> : null}</span>
              </button>
            );
          })}
        </div>
      )}
    </MobileSheet>
  );
}
