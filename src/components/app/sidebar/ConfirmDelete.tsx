import { Dialog } from "../../ui/Overlay";
import type { TreeNode } from "../../../lib/types";

export interface ConfirmDeleteProps {
  node: TreeNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDelete = ({ node, onConfirm, onCancel }: ConfirmDeleteProps) => (
  <Dialog open onDismiss={onCancel} label={"删除“" + node.title + "”？"} className="confirm-dialog">
    <div className="ln-dialog__head"><span className="ln-dialog__title">删除“{node.title}”？</span></div>
    <div className="ln-dialog__body">将删除该节点及其所有子项，移入本地回收站（可在回收站中恢复或彻底删除）。</div>
    <div className="ln-dialog__actions">
      <button className="ln-btn ln-btn--ghost" onClick={onCancel}>取消</button>
      <button className="ln-btn ln-btn--secondary ln-btn--danger-text" onClick={onConfirm}>删除</button>
    </div>
  </Dialog>
);
