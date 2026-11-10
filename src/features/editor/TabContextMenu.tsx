/**
 * 标签右键菜单（唯一实现）：文档标签与日记标签共用。
 *
 * 从 `MultiTabEditor` 抽出（261110）：App 里的日记标签条也要这套动作，而 **App 不能静态 import
 * MultiTabEditor**（那会把内核懒加载边界与首屏预算打破，desktopKernelLazy/check-bundle 会红）。
 *
 * 语义（思源式）：关闭 / 关闭其他 / 关闭全部 / 关闭左侧 / 关闭右侧 / 钉住；**钉住的标签不参与批量关闭**，
 * 由调用方在 handler 里跳过（菜单只负责发动作）。
 */
import { ArrowLeftRight, ChevronsLeft, ChevronsRight, Pin, X, XCircle, XSquare } from "lucide-react";
import { Menu } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";

export interface TabContextMenuProps {
  x: number;
  y: number;
  /** 复合的分屏标签：只给分屏专属动作（取消分屏 / 左右互换），不混入单页的关闭/钉住语义。 */
  split?: { onExit: () => void; onSwap: () => void };
  pinned: boolean;
  onTogglePin: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  onCloseAll: () => void;
  canCloseOthers: boolean;
  hasLeft: boolean;
  hasRight: boolean;
  onClose: () => void;
}

export function TabContextMenu({ x, y, split, pinned, onTogglePin, onCloseTab, onCloseOthers, onCloseLeft, onCloseRight, onCloseAll, canCloseOthers, hasLeft, hasRight, onClose }: TabContextMenuProps) {
  // 坐标菜单统一走「先量尺寸、贴底翻上方」的共用定位（不再按 210/280 估算高度夹取）
  const { surfaceRef, style } = usePopoverPosition({ open: true, at: { x, y } });
  if (split) {
    return (
      <Menu surfaceClassName="context-menu" surfaceRef={surfaceRef} onDismiss={onClose} style={style ?? undefined}>
        <button role="menuitem" onClick={() => { split.onExit(); onClose(); }}><X size={15} /><span>取消分屏</span></button>
        <button role="menuitem" onClick={() => { split.onSwap(); onClose(); }}><ArrowLeftRight size={15} /><span>左右互换</span></button>
      </Menu>
    );
  }
  return (
    <Menu surfaceClassName="context-menu" surfaceRef={surfaceRef} onDismiss={onClose} style={style ?? undefined}>
      <button role="menuitem" onClick={() => { onCloseTab(); onClose(); }}><X size={15} /><span>关闭</span></button>
      {canCloseOthers && <button role="menuitem" onClick={() => { onCloseOthers(); onClose(); }}><XCircle size={15} /><span>关闭其他</span></button>}
      {canCloseOthers && <button role="menuitem" onClick={() => { onCloseAll(); onClose(); }}><XSquare size={15} /><span>关闭全部</span></button>}
      {hasLeft && <button role="menuitem" onClick={() => { onCloseLeft(); onClose(); }}><ChevronsLeft size={15} /><span>关闭左侧</span></button>}
      {hasRight && <button role="menuitem" onClick={() => { onCloseRight(); onClose(); }}><ChevronsRight size={15} /><span>关闭右侧</span></button>}
      <div className="context-menu-sep" />
      <button role="menuitem" onClick={() => { onTogglePin(); onClose(); }}><Pin size={15} /><span>{pinned ? "取消钉住" : "钉住"}</span></button>
    </Menu>
  );
}
