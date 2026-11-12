/**
 * 目录树行组件的 props 契约（261112 R2 S6：从 Sidebar.tsx 原样搬出，**不改字段/行为**）。
 *
 * 为什么单独一个 types-only 文件：TreeRow（行壳+递归）与 TreeRowFace（行内容，memo 边界）
 * 互相引用同一组回调签名；放在这里避免两个组件文件循环 import。
 */
import type { TreeNode } from "../../../lib/types";
import type { TreeIndex } from "../../../core/treeIndex";

export type DropPosition = "before" | "inside" | "after";

export interface TreeRowProps {
  node: TreeNode;
  depth: number;
  treeIndex: TreeIndex;
  query: string;
  activeId: string | null;
  contextId: string | null;
  expanded: Set<string>;
  draggingId: string | null;
  dropParentId: string | null;
  draggedParentId: string | null;
  releasingId: string | null;
  dropTarget: { id: string; position: DropPosition } | null;
  editingId: string | null;
  onBeginRename: (node: TreeNode) => void;
  onPointerDown: (event: React.PointerEvent, id: string) => void;
  consumeSuppressedClick: () => boolean;
  onContext: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  /** 目录行「＋」：弹「新建子项」快捷菜单 */
  onCreateMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onIconClick?: (node: TreeNode, event: React.MouseEvent<HTMLElement>) => void;
  /** 已锁定（只读）的文档 id 集（行尾显示小锁） */
  lockedNoteIds: ReadonlySet<string>;
  /** 多选集合（行显示最小选中态；笔记本永远不会在里面）。 */
  selectedIds: ReadonlySet<string>;
  /** 行点击（⌘/Shift 语义与普通点击都在 Sidebar 的 handleRowClick 里）。 */
  onRowClick: (event: React.MouseEvent, node: TreeNode) => void;
}

export interface TreeRowFaceProps {
  node: TreeNode;
  open: boolean;
  expandable: boolean;
  active: boolean;
  /** 多选选中态（与单选 active 分开；图标/背景更轻） */
  selected: boolean;
  context: boolean;
  dragging: boolean;
  releasing: boolean;
  dropParent: boolean;
  sameLevelLine: boolean;
  dropPosition: DropPosition | null;
  locked: boolean;
  onPointerDown: TreeRowProps["onPointerDown"];
  onContextMenu: TreeRowProps["onContextMenu"];
  onCreateMenu: TreeRowProps["onCreateMenu"];
  onToggle: TreeRowProps["onToggle"];
  onSelect: TreeRowProps["onSelect"];
  onRowClick: TreeRowProps["onRowClick"];
  onIconClick: TreeRowProps["onIconClick"];
  onContext: TreeRowProps["onContext"];
  consumeSuppressedClick: TreeRowProps["consumeSuppressedClick"];
}
