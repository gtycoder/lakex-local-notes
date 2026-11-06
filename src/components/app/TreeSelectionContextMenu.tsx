
/**
 * 多选态右键菜单（261106 task-88）：**恰好三项**「移入回收站 / 移动… / 导出…」。
 *
 * 顺序固定：移动… / 导出… / 移入回收站（危险动作最后、红色样式与普通右键「删除」一致）。
 * 与浮动操作条共用同一套动作判定（父级传 actions）：分组/混选不能移入回收站但可以移动、
 * 可导出其下文档（主进程递归展开）；busy 期间三项全部禁用。未多选时不渲染本菜单（旧右键菜单不变）。
 */
import { useEffect, useRef, useState } from "react";
import { Download, FolderInput, Trash2 } from "lucide-react";
import { Menu } from "../ui/Overlay";

export interface TreeSelectionContextMenuProps {
  x: number;
  y: number;
  count: number;
  actions: { trash: boolean; move: boolean; export: boolean };
  busy?: boolean;
  onTrash(): void;
  onMove(): void;
  onExport(): void;
  onClose(): void;
}

export function TreeSelectionContextMenu({ x, y, count, actions, busy = false, onTrash, onMove, onExport, onClose }: TreeSelectionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 与目录右键菜单同一套视口边缘翻转：先挂载量真实尺寸，再夹进视口。
  useEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const margin = 8;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
    const top = y + height + margin > window.innerHeight ? Math.max(margin, y - height) : Math.max(margin, y);
    setPos({ left, top });
  }, [x, y]);
  return (
    <Menu surfaceClassName="context-menu tree-selection-menu" onDismiss={onClose} surfaceRef={menuRef} label={"已选 " + count + " 项"}
      style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: "hidden" }}>
      <button role="menuitem" disabled={!actions.move || busy} onClick={() => { onMove(); onClose(); }}>
        <FolderInput size={15} aria-hidden="true" /><span>移动…</span>
      </button>
      <button role="menuitem" disabled={!actions.export || busy} onClick={() => { onExport(); onClose(); }}>
        <Download size={15} aria-hidden="true" /><span>导出…</span>
      </button>
      {/* 危险动作放最后、红色样式与普通右键「删除」同一 class（261106 task-91） */}
      <button role="menuitem" className="danger" disabled={!actions.trash || busy}
        title={actions.trash ? undefined : "分组不能移入回收站"}
        onClick={() => { onTrash(); onClose(); }}>
        <Trash2 size={15} aria-hidden="true" /><span>移入回收站</span>
      </button>
    </Menu>
  );
}