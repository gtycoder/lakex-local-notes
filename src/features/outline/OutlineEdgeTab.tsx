import { useRef } from "react";
import { ListTree } from "lucide-react";

interface OutlineEdgeTabProps {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}

/** 非固定（hidden）时的右缘触发标签：hover 悬浮、点击固定（常驻）。
 *  挂载后 500ms 内忽略 hover——刚收起/启动时光标可能正好在标签上，避免立刻弹开。 */
export function OutlineEdgeTab({ onMouseEnter, onMouseLeave, onClick }: OutlineEdgeTabProps) {
  const mountTimeRef = useRef(Date.now());
  return (
    <button
      className="outline-edge-tab"
      title="大纲"
      aria-label="大纲"
      onMouseEnter={() => {
        if (Date.now() - mountTimeRef.current < 500) return;
        onMouseEnter();
      }}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <ListTree size={14} />
      <span>大纲</span>
    </button>
  );
}
