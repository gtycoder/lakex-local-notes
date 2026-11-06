/**
 * 多选模式的**底部操作条**（261106 task-82）：按列表给不同动作（小记：打标签/删除；文档：移动/移入回收站/打标签；
 * 回收站：恢复）。按钮复用 .mb-btn（命中 44）；容器 .mobile-selection-bar 只有一条几何规则（页内距 + 安全区），
 * fixed 变体用于首页（常驻层），列表内（设置页 / Sheet）用内联版。
 */
import type { LucideIcon } from "lucide-react";

export interface SelectionAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  /** 可访问性：动作按钮的 aria-pressed（目录树多选条按任务约定显式给 false；其它列表不传 = 不加属性）。 */
  ariaPressed?: boolean;
}

export interface SelectionActionBarProps {
  actions: readonly SelectionAction[];
  onAction(id: string): void;
  /** 首页这类常驻层用 fixed（固定在底部、盖住胶囊位置）；列表/Sheet 内用内联。 */
  fixed?: boolean;
  /** 左侧附加说明（例如失败条目数）。 */
  hint?: string;
}

export function SelectionActionBar({ actions, onAction, fixed, hint }: SelectionActionBarProps) {
  return (
    <div className={"mobile-selection-bar" + (fixed ? " is-fixed" : "")} role="group" aria-label="批量操作">
      {hint && <span className="mb-row__meta mb-flex1">{hint}</span>}
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            className={"mb-btn" + (action.danger ? " mb-btn--danger" : " mb-btn--secondary")}
            disabled={action.disabled}
            aria-pressed={action.ariaPressed}
            onClick={() => onAction(action.id)}
          >
            {Icon ? <Icon size={16} /> : null}{action.label}
          </button>
        );
      })}
    </div>
  );
}
