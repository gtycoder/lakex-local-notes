import { useLayoutEffect, useRef, useState } from "react";
import { Copy, FolderInput, History, Info, Lock, LockOpen, Pencil, Pin, Tag as TagIcon, Trash } from "lucide-react";
import { Menu } from "../../ui/Overlay";
import { ExportSubmenuItem, type ExportFormat } from "../../ui/ExportSubmenuItem";
import type { TreeNode } from "../../../lib/types";

export interface ContextMenuProps {
  node: TreeNode;
  x: number;
  y: number;
  onRename: () => void;
  /** 261106 task-90：单条「移动…」与多选共用同一个树形弹窗。 */
  onMove: () => void;
  onDelete: () => void;
  onCopyMarkdown: () => void;
  onExportAs: (format: ExportFormat) => void;
  onCopyPaths: () => void;
  onShowInfo: () => void;
  onOpenHistory: () => void;
  /** 该文档当前是否已锁定（只读） */
  locked: boolean;
  onToggleLock: () => void;
  /** 只对 note 行出现：「打标签…」打开复用属性面板标签行的弹层（P1 三修）。 */
  onAddTags: () => void;
  /** 只对 note 行出现：「创建副本」（261106；与多选右键共用 duplicate_notes）。 */
  onDuplicate: () => void;
  /** 「置顶」入口（261107，设备本地）：文档/分组/笔记本都可置顶；不改变原目录。 */
  pinned: boolean;
  onTogglePin: () => void;
  /** 批量操作进行中：创建副本禁用（IPC 并发复制没有意义）。 */
  busy: boolean;
  onClose: () => void;
}

export const ContextMenu = ({ node, x, y, onRename, onMove, onDelete, onCopyMarkdown, onExportAs, onCopyPaths, onShowInfo, onOpenHistory, locked, onToggleLock, onAddTags, onDuplicate, pinned, onTogglePin, busy, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 视口边缘翻转：按光标先挂载，量出菜单真实尺寸后再定位——下方放不下就向上展开，保证整张菜单可点。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    if (left + w + margin > window.innerWidth) left = window.innerWidth - w - margin;
    left = Math.max(margin, left);
    let top = y;
    if (top + h + margin > window.innerHeight) {
      const above = y - h;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - h - margin);
    }
    top = Math.max(margin, top);
    setPos({ left, top });
  }, [x, y]);
  // Portal 到 body：侧边栏带 transform（含 translateX(0)）时，position: fixed 会退化为
  // 相对侧边栏定位，导致菜单偏离光标右下；挂到 body 后恢复真正的视口固定定位。
  return (
    <Menu surfaceClassName="context-menu" onDismiss={onClose} surfaceRef={menuRef} style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: "hidden" }}>
      {/* 261106 用户验收：右键菜单**不再提供「新建」**（行内/头部的「＋」已是唯一入口，
          同一组创建动作只保留一处，菜单更短）。创建动作仍走 CREATE_CHILD_ITEMS 单一来源。 */}
      {node.nodeType === "note" ? (
        <>
          {/* 分组 1：行本身的命名与固定 */}
          <button className="ln-menu__item" role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={15} /><span>重命名</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onTogglePin(); onClose(); }}><Pin size={15} /><span>{pinned ? "取消置顶" : "置顶"}</span></button>
          <div className="context-menu-sep" role="separator" />
          {/* 分组 2：树结构 / 内容复制 */}
          <button className="ln-menu__item" role="menuitem" disabled={busy} title={busy ? "正在执行其他操作，请稍候" : undefined}
            onClick={() => { onDuplicate(); onClose(); }}><Copy size={15} /><span>创建副本</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onMove(); onClose(); }}><FolderInput size={15} /><span>移动…</span></button>
          <div className="context-menu-sep" role="separator" />
          {/* 分组 3：内容信息（版本/分类/元数据） */}
          <button className="ln-menu__item" role="menuitem" onClick={() => { onOpenHistory(); onClose(); }}><History size={15} /><span>历史版本</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onAddTags(); onClose(); }}><TagIcon size={15} /><span>标签…</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onShowInfo(); onClose(); }}><Info size={15} /><span>属性</span></button>
          <div className="context-menu-sep" role="separator" />
          {/* 分组 4：状态与输出 */}
          <button className="ln-menu__item" role="menuitem" onClick={() => { onToggleLock(); onClose(); }}>
            {locked ? <LockOpen size={15} /> : <Lock size={15} />}<span>{locked ? "解锁" : "锁定（只读）"}</span>
          </button>
          {/* 按文档类型给各自的导出菜单（doc/sheet/bitable/board 不混用）；见 ExportSubmenuItem */}
          <ExportSubmenuItem kind={node.kind ?? "doc"} onExportAs={onExportAs} onCopyMarkdown={onCopyMarkdown} onCopyPaths={onCopyPaths} onClose={onClose} />
        </>
      ) : node.nodeType === "group" ? (
        <>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={15} /><span>重命名</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onTogglePin(); onClose(); }}><Pin size={15} /><span>{pinned ? "取消置顶" : "置顶"}</span></button>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onMove(); onClose(); }}><FolderInput size={15} /><span>移动…</span></button>
        </>
      ) : (
        <button className="ln-menu__item" role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={15} /><span>重命名</span></button>
      )}
      <div className="context-menu-sep" role="separator" />
      <button role="menuitem" className="danger" onClick={() => { onDelete(); onClose(); }}><Trash size={15} /><span>删除</span></button>
    </Menu>
  );
};
