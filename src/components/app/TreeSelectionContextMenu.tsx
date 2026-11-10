
/**
 * 多选态右键菜单（261106 task-88；261106 副本追加第 4 项）：**恰好四项**
 * 「创建副本 / 移动… / 导出… / 移入回收站」。
 *
 * 顺序固定：创建副本在最前（非破坏性动作），危险动作「移入回收站」保持最后、红色样式与普通右键「删除」一致。
 * 与浮动操作条共用同一套动作判定（父级传 actions）：选区里**全是文档**才能创建副本；分组/混选不能移入回收站
 * 但可以移动、可导出其下文档（主进程递归展开）；busy 期间四项全部禁用。
 * 未多选时不渲染本菜单（旧右键菜单不变）。
 */
import { useEffect, useRef, useState } from "react";
import { Copy, Download, FolderInput, ListChecks, Pin, Tag, Trash2 } from "lucide-react";
import { Menu } from "../ui/Overlay";

export interface TreeSelectionContextMenuProps {
  x: number;
  y: number;
  count: number;
  actions: { duplicate: boolean; trash: boolean; move: boolean; export: boolean; pin: boolean; tag: boolean };
  /** 选区是否**全部**已置顶（决定「置顶」还是「取消置顶」）。 */
  pinnedAll?: boolean;
  busy?: boolean;
  onPin(): void;
  onDuplicate(): void;
  onTrash(): void;
  onMove(): void;
  onExport(): void;
  /** 批量追加标签（只新增，不提供移除/编辑）。 */
  onTag(): void;
  /** 选中全部可见项。 */
  onSelectAll(): void;
  onClose(): void;
}

export function TreeSelectionContextMenu({ x, y, count, actions, pinnedAll = false, busy = false, onPin, onDuplicate, onTrash, onMove, onExport, onTag, onSelectAll, onClose }: TreeSelectionContextMenuProps) {
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
      <button className="ln-menu__item" role="menuitem" disabled={!actions.pin || busy}
        onClick={() => { onPin(); onClose(); }}>
        <Pin size={15} aria-hidden="true" /><span>{pinnedAll ? "取消置顶" : "置顶"}</span>
      </button>
      <button className="ln-menu__item" role="menuitem" disabled={!actions.duplicate || busy}
        title={actions.duplicate ? undefined : "只有文档可以创建副本（分组/笔记本不可）"}
        onClick={() => { onDuplicate(); onClose(); }}>
        <Copy size={15} aria-hidden="true" /><span>创建副本</span>
      </button>
      <button className="ln-menu__item" role="menuitem" disabled={!actions.move || busy} onClick={() => { onMove(); onClose(); }}>
        <FolderInput size={15} aria-hidden="true" /><span>移动…</span>
      </button>
      <button className="ln-menu__item" role="menuitem" disabled={!actions.export || busy} onClick={() => { onExport(); onClose(); }}>
        <Download size={15} aria-hidden="true" /><span>导出…</span>
      </button>
      <button className="ln-menu__item" role="menuitem" disabled={!actions.tag || busy}
        title={actions.tag ? undefined : "只有文档可以添加标签"}
        onClick={() => { onTag(); onClose(); }}>
        <Tag size={15} aria-hidden="true" /><span>添加标签…</span>
      </button>
      <div className="context-menu-sep" role="separator" />
      <button className="ln-menu__item" role="menuitem" disabled={busy} onClick={() => { onSelectAll(); onClose(); }}>
        <ListChecks size={15} aria-hidden="true" /><span>全选</span>
      </button>
      <div className="context-menu-sep" role="separator" />
      {/* 危险动作放最后、红色样式与普通右键「删除」同一 class（261106 task-91） */}
      <button className="ln-menu__item danger" role="menuitem" disabled={!actions.trash || busy}
        title={actions.trash ? undefined : "分组不能删除"}
        onClick={() => { onTrash(); onClose(); }}>
        <Trash2 size={15} aria-hidden="true" /><span>删除</span>
      </button>
    </Menu>
  );
}