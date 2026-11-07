/**
 * 多选模式的底部操作条（v2 261107 重做）：**浮动柔光玻璃条 + 等分图标按钮**。
 * - 树抽屉里用 overlay（绝对定位贴在抽屉底，树本体不因插入动作条而改变高度 ⇒ 不闪）；
 * - 首页小记/回收站用 fixed（贴视口底、盖住胶囊位置）；
 * - 每个动作 = 图标 + 两字标签，危险动作用红字但仍是等分格（不再出现「两个胶囊 + 一整行红字」的失衡排版）。
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
  /** 首页这类常驻层用 fixed（固定在底部、盖住胶囊位置）；列表/Sheet/抽屉内用 overlay（绝对贴容器底）。 */
  fixed?: boolean;
  overlay?: boolean;
  /** 左侧附加说明（例如失败条目数）。 */
  hint?: string;
}

export function SelectionActionBar({ actions, onAction, fixed, overlay, hint }: SelectionActionBarProps) {
  return (
    <div
      className={"mb-sel-actions mb-glass" + (fixed ? " is-fixed" : "") + (overlay ? " is-overlay" : "")}
      role="group"
      aria-label="批量操作"
    >
      {hint && <span className="mb-sel-actions__hint">{hint}</span>}
      <div className="mb-sel-actions__row">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              className={"mb-sel-act" + (action.danger ? " is-danger" : "")}
              disabled={action.disabled}
              aria-pressed={action.ariaPressed}
              onClick={() => onAction(action.id)}
            >
              {Icon ? <Icon size={19} strokeWidth={1.75} aria-hidden="true" /> : null}
              <span className="mb-sel-act__label">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
