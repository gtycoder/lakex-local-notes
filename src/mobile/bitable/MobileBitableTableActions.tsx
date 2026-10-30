/**
 * 移动端「数据表操作」面板（261030 用户点单：重命名 / 复制 / 删除）。
 *
 * 与桌面左侧表列表的 ⋮ 菜单同语义（core 单一来源：renameBitableTable / duplicateBitableTable / deleteBitableTable）；
 * 只读文档不写正文 ⇒ 三项全部置灰并写明理由；删除前二次确认（带记录数）；重命名走小面板输入。
 */
import { useEffect, useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { confirmMobile } from "../ui/ConfirmDialog";

export interface MobileBitableTableActionsProps {
  open: boolean;
  tableName: string;
  recordCount: number;
  editable: boolean;
  canDelete: boolean;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function MobileBitableTableActions({ open, tableName, recordCount, editable, canDelete, onRename, onDuplicate, onDelete, onClose }: MobileBitableTableActionsProps) {
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [draft, setDraft] = useState(tableName);
  useEffect(() => {
    if (!open) return;
    setMode("menu");
    setDraft(tableName);
  }, [open, tableName]);

  const confirmDelete = async () => {
    const ok = await confirmMobile({
      title: "删除数据表？",
      body: "「" + tableName + "」及其中 " + recordCount + " 条记录会被删除（不能撤销）。",
      confirmText: "删除",
      danger: true,
    });
    if (ok) onDelete();
  };

  return (
    <MobileSheet
      open={open}
      title={mode === "rename" ? "重命名数据表" : tableName}
      onClose={onClose}
      footer={mode === "rename" ? (
        <div className="mbt-actions-foot">
          <button type="button" className="mb-btn mb-btn--secondary" onClick={() => setMode("menu")}>取消</button>
          <button type="button" className="mb-btn mb-btn--primary" disabled={!draft.trim()} onClick={() => onRename(draft)}>确定</button>
        </div>
      ) : undefined}
    >
      {mode === "rename" ? (
        <label className="mbt-actions-field">
          <span className="mbt-actions-field__label">数据表名称</span>
          <input className="mbt-form-input" autoFocus value={draft} aria-label="数据表名称"
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
              <Copy size={17} aria-hidden="true" />复制数据表
            </button>
            <button type="button" className="mbt-action-row mbt-action-row--danger" disabled={!editable || !canDelete} onClick={() => void confirmDelete()}>
              <Trash2 size={17} aria-hidden="true" />删除数据表
            </button>
          </div>
          {!editable && <div className="mbt-actions-hint">只读状态不能修改数据表</div>}
          {!canDelete && editable && <div className="mbt-actions-hint">至少保留一张数据表</div>}
        </>
      )}
    </MobileSheet>
  );
}

export default MobileBitableTableActions;
