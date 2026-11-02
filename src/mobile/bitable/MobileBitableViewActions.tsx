/**
 * 移动端「视图操作」面板（261102 用户点单：视图重命名 / 复制 / 删除）。
 *
 * 与桌面视图 ⋮（BitableEditor 的 viewMenu：重命名 / 复制视图 / 删除视图）同语义；
 * 三个写操作全走 core 单一来源（renameBitableView / duplicateBitableView / deleteBitableView）。
 * 只读文档不写正文 ⇒ 三项置灰并写明理由；删除前二次确认（只删视图配置，记录本身不受影响）；
 * 重命名走小面板输入（回车 / 确定提交），形态与「数据表操作」面板（MobileBitableTableActions）一致。
 */
import { useEffect, useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { confirmMobile } from "../ui/ConfirmDialog";

export interface MobileBitableViewActionsProps {
  open: boolean;
  viewName: string;
  editable: boolean;
  canDelete: boolean;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function MobileBitableViewActions({ open, viewName, editable, canDelete, onRename, onDuplicate, onDelete, onClose }: MobileBitableViewActionsProps) {
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [draft, setDraft] = useState(viewName);
  useEffect(() => {
    if (!open) return;
    setMode("menu");
    setDraft(viewName);
  }, [open, viewName]);

  const confirmDelete = async () => {
    const ok = await confirmMobile({
      title: "删除视图？",
      body: "「" + viewName + "」的视图配置（筛选 / 排序 / 分组等）会被删除，记录本身不受影响（不能撤销）。",
      confirmText: "删除",
      danger: true,
    });
    if (ok) onDelete();
  };

  return (
    <MobileSheet
      open={open}
      title={mode === "rename" ? "重命名视图" : viewName}
      bodyClassName="mb-sheet__body--form"
      onClose={onClose}
      footer={mode === "rename" ? (
        <div className="mb-sheet__foot">
          <button type="button" className="mb-btn mb-btn--secondary" onClick={() => setMode("menu")}>取消</button>
          <button type="button" className="mb-btn mb-btn--primary" disabled={!draft.trim()} onClick={() => onRename(draft)}>确定</button>
        </div>
      ) : undefined}
    >
      {mode === "rename" ? (
        <label className="mbt-actions-field">
          <span className="mbt-actions-field__label">视图名称</span>
          <input className="mbt-form-input" autoFocus value={draft} aria-label="视图名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && draft.trim()) onRename(draft); }} />
        </label>
      ) : (
        <>
          <div className="mbt-actions">
            <button type="button" className="mbt-action-row" disabled={!editable} onClick={() => setMode("rename")}>
              <Pencil size={17} aria-hidden="true" />重命名
            </button>
            <button type="button" className="mbt-action-row" disabled={!editable} onClick={() => onDuplicate()}>
              <Copy size={17} aria-hidden="true" />复制视图
            </button>
            <button type="button" className="mbt-action-row mbt-action-row--danger" disabled={!editable || !canDelete} onClick={() => void confirmDelete()}>
              <Trash2 size={17} aria-hidden="true" />删除视图
            </button>
          </div>
          {!editable && <div className="mbt-actions-hint">只读状态不能修改视图（视图配置属于正文）</div>}
          {!canDelete && editable && <div className="mbt-actions-hint">至少保留一个视图</div>}
        </>
      )}
    </MobileSheet>
  );
}

export default MobileBitableViewActions;
