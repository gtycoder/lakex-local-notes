import { ListTree } from "lucide-react";

interface OutlineRailProps {
  /** 悬浮面板是否打开（图标高亮提示） */
  active: boolean;
  belowToolbar?: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

/** 右侧 40px 图标栏：hover 自动弹出悬浮大纲，点击固定/取消固定（思源 dock 模式） */
export function OutlineRail({ active, belowToolbar, onMouseEnter, onMouseLeave, onClick }: OutlineRailProps) {
  return (
    <div className={`outline-rail${belowToolbar ? " below-toolbar" : ""}`}>
      <button
        className={`outline-rail__btn${active ? " is-active" : ""}`}
        title="大纲"
        aria-label="大纲"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        <ListTree size={16} />
      </button>
    </div>
  );
}
