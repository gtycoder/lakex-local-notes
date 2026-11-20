import { useLayoutEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, ArrowDownToLine, ArrowUpToLine, Copy, FolderInput, History, Info, Lock, LockOpen, Pencil, Pin, Tag as TagIcon, Trash } from "lucide-react";
import { Menu, Submenu } from "../../ui/Overlay";
import { ExportSubmenuItem, type ExportFormat } from "../../ui/ExportSubmenuItem";
import { CreateChildItems, type CreateChildKind } from "./CreateChildItems";
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
  /** 261120：「收起 / 取消收起」——**笔记本专属**（用户：和重命名、删除并列；笔记本本来就没有置顶）。
   *  collapsible = core/notebookCollapse.canCollapseNotebook（回收站/未分类/日记本逻辑排除，不给入口）。 */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** 批量操作进行中：创建副本禁用（IPC 并发复制没有意义）。 */
  busy: boolean;
  /** 261120：在上方 / 在下方新建（与当前文档同父级紧邻插入；只有文档行提供）。
   *  kind = 我们自己的六种新建之一（CREATE_CHILD_ITEMS 单一来源，二级菜单直接复用）。 */
  onCreateSibling: (position: "above" | "below", kind: CreateChildKind) => void;
  onClose: () => void;
}

export const ContextMenu = ({ node, x, y, onRename, onMove, onDelete, onCopyMarkdown, onExportAs, onCopyPaths, onShowInfo, onOpenHistory, locked, onToggleLock, onAddTags, onDuplicate, pinned, onTogglePin, collapsible, collapsed, onToggleCollapse, onCreateSibling, busy, onClose }: ContextMenuProps) => {
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
      {/* 261120 用户点单（**推翻 261106「右键菜单不再提供新建」**）：菜单最顶部 = 两个二级菜单
          「在上方新建 / 在下方新建」，子项就是我们自己的新建清单（CREATE_CHILD_ITEMS 单一来源，含
          文档/表格/多维表/画板/手写板/分组）；**不再有第三个「新建」**（用户 261120 明确去掉）。
          落位 = 与当前文档同父级、紧邻上/下（afterSortOrder 锚点，同事务挪同级）；
          点开二级菜单后仍走统一新建弹窗（要写名字），按文案规则二级菜单不加「…」。 */}
      {node.nodeType === "note" && (
        <>
          <Submenu label={<><ArrowUpToLine size={15} aria-hidden="true" /><span>在上方新建</span></>}>
            <CreateChildItems onNewChild={(kind) => onCreateSibling("above", kind)} onClose={onClose} />
          </Submenu>
          <Submenu label={<><ArrowDownToLine size={15} aria-hidden="true" /><span>在下方新建</span></>}>
            <CreateChildItems onNewChild={(kind) => onCreateSibling("below", kind)} onClose={onClose} />
          </Submenu>
          <div className="context-menu-sep" role="separator" />
        </>
      )}
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
        <>
          <button className="ln-menu__item" role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={15} /><span>重命名</span></button>
          {/* 261120 用户点单：笔记本行与「重命名/删除」并列的「收起」（= 置顶的反向，纯设备本地）。
              回收站/未分类/日记本由 core/notebookCollapse 逻辑排除 ⇒ 这里连入口都不给。 */}
          {collapsible && onToggleCollapse && (
            <button className="ln-menu__item" role="menuitem" onClick={() => { onToggleCollapse(); onClose(); }}>
              {collapsed ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              <span>{collapsed ? "取消收起" : "收起"}</span>
            </button>
          )}
        </>
      )}
      <div className="context-menu-sep" role="separator" />
      <button role="menuitem" className="danger" onClick={() => { onDelete(); onClose(); }}><Trash size={15} /><span>删除</span></button>
    </Menu>
  );
};
