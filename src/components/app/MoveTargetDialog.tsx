
/**
 * 「移动到…」目标选择层（261106 task-81）：复用 kit 的 .ln-row / .ln-btn / Dialog 表面，
 * 候选来自 buildMoveTargets（只列笔记本/分组，已排除选中项及其后代 = 防环）。
 */
import { Dialog } from "../ui/Overlay";
import { Folder, Book } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { buildMoveTargets } from "../../desktop/moveTargets";

export interface MoveTargetDialogProps {
  open: boolean;
  /** 目录树（完整节点集，用于生成目标候选）。 */
  nodes: readonly TreeNode[];
  /** 正在移动的节点 id（排除它们及其后代）。 */
  movingIds: readonly string[];
  busy?: boolean;
  error?: string | null;
  onPick(parentId: string): void;
  onClose(): void;
}

export function MoveTargetDialog({ open, nodes, movingIds, busy = false, error = null, onPick, onClose }: MoveTargetDialogProps) {
  if (!open) return null;
  const targets = buildMoveTargets(nodes, movingIds);
  return (
    <Dialog open onDismiss={() => { if (!busy) onClose(); }} label="移动到…" className="move-target-dialog">
      <div className="ln-dialog__head"><span className="ln-dialog__title">移动到…</span></div>
      <div className="ln-dialog__body">
        {targets.length === 0 ? (
          <p className="ln-empty">没有可用的目标位置（先新建一个笔记本或分组）。</p>
        ) : (
          <div className="move-target-dialog__list" role="listbox" aria-label="目标位置">
            {targets.map((target) => (
              <button key={target.id} type="button" role="option" aria-selected={false}
                className="ln-row move-target-dialog__item"
                data-depth={Math.min(target.depth, 7)}
                disabled={busy}
                onClick={() => onPick(target.id)}>
                {target.nodeType === "notebook" ? <Book size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
                <span className="ln-ellipsis">{target.title}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="move-target-dialog__error" role="alert">{error}</p>}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
      </div>
    </Dialog>
  );
}
