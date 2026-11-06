
/**
 * 目录树多选浮动操作条（261106 task-81）。
 *
 * 纯展示组件（不摸 IPC）：由 Sidebar 控制可见性/选择集并注入动作；位置在壳层底部居中
 * （z = --lake-z-statusbar-popover：压状态栏、低于侧栏/顶栏），只在目录树多选时出现。
 * 261106 副本：文档多选时多一个「创建副本」（与右键菜单第 1 项同一判据：选区全是文档）。
 */
import { Copy, MoveRight, Pin, Tag as TagIcon, Trash2, X } from "lucide-react";
import type { TreeSelectionActions } from "../../desktop/treeSelection";

/** 浮动条动作 = 多选动作判定（treeSelectionActions）+ 创建副本（与右键菜单同一判据：选区全是文档）。 */
export type TreeSelectionBarActions = TreeSelectionActions & { duplicate?: boolean };

export interface TreeSelectionBarProps {
  count: number;
  actions: TreeSelectionBarActions;
  busy?: boolean;
  /** 最近一次批量结果提示（成功/部分失败）；null = 不显示。 */
  notice?: string | null;
  /** 提示行右侧的动作（如导出后的「打开所在文件夹」）。 */
  noticeAction?: { label: string; onClick(): void } | null;
  /** 创建副本（与右键菜单第 1 项同一动作；选区全是文档时才出现）。 */
  onDuplicate?(): void;
  /** 选区是否全部已置顶（决定「置顶」还是「取消置顶」）。 */
  pinnedAll?: boolean;
  onPin?(): void;
  onMove(): void;
  onTrash(): void;
  onTag(): void;
  onSelectAll(): void;
  onCancel(): void;
}

export function TreeSelectionBar({ count, actions, busy = false, notice = null, noticeAction = null, onDuplicate, pinnedAll = false, onPin, onMove, onTrash, onTag, onSelectAll, onCancel }: TreeSelectionBarProps) {
  // 选择被清空后仍要能看到批量结果（成功/部分失败）：只留提示条，不再显示动作。
  if (count <= 0 && !notice) return null;
  return (
    <div className="tree-selection-bar" role="region" aria-label="批量操作">
      {count > 0 && <div className="tree-selection-bar__row">
        <strong className="tree-selection-bar__count">已选 {count} 项</strong>
        <div className="tree-selection-bar__actions">
          {actions.pin && (
            <button type="button" className="ln-btn ln-btn--secondary" onClick={onPin} disabled={busy || !onPin}>
              <Pin size={14} aria-hidden="true" />{pinnedAll ? "取消置顶" : "置顶"}
            </button>
          )}
          {actions.duplicate && (
            <button type="button" className="ln-btn ln-btn--secondary" onClick={onDuplicate} disabled={busy || !onDuplicate}>
              <Copy size={14} aria-hidden="true" />创建副本
            </button>
          )}
          {actions.move && (
            <button type="button" className="ln-btn ln-btn--secondary" onClick={onMove} disabled={busy}>
              <MoveRight size={14} aria-hidden="true" />移动…
            </button>
          )}
          {actions.trash && (
            <button type="button" className="ln-btn ln-btn--secondary ln-btn--danger-text" onClick={onTrash} disabled={busy}>
              <Trash2 size={14} aria-hidden="true" />移入回收站
            </button>
          )}
          {actions.tag && (
            <button type="button" className="ln-btn ln-btn--secondary" onClick={onTag} disabled={busy}>
              <TagIcon size={14} aria-hidden="true" />打标签…
            </button>
          )}
        </div>
        <div className="tree-selection-bar__tail">
          <button type="button" className="ln-btn ln-btn--ghost" onClick={onSelectAll} disabled={busy}>全选</button>
          <button type="button" className="ln-btn ln-btn--ghost" onClick={onCancel} disabled={busy}>
            <X size={14} aria-hidden="true" />取消
          </button>
        </div>
      </div>}
      {notice && (
        <div className="tree-selection-bar__notice-row">
          <p className="tree-selection-bar__notice" role="status">{notice}</p>
          {noticeAction && (
            <button type="button" className="ln-btn ln-btn--ghost ln-btn--compact" onClick={noticeAction.onClick}>{noticeAction.label}</button>
          )}
        </div>
      )}
    </div>
  );
}
