import { memo } from "react";
import { TreeRowFace } from "./TreeRowFace";
import type { TreeRowProps } from "./treeRowProps";

export const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const children = (props.treeIndex.childrenByParent.get(props.node.id) ?? []).filter((node) => props.treeIndex.visibleIds.has(node.id));
  const expandable = children.length > 0 || props.node.nodeType !== "note";
  const open = props.expanded.has(props.node.id) || Boolean(props.query);

  const dropPosition = props.dropTarget?.id === props.node.id ? props.dropTarget.position : null;
  const isDragging = props.draggingId === props.node.id;
  // 只有“放入”才标记目标父项蓝框；before/after 永远表示最终插入线，
  // 即使跨级把子项拖到父项同级，也要把线画在父项实际目标边缘。
  const isDropParent = dropPosition === "inside" && props.dropParentId === props.node.id;
  const sameLevelLine = Boolean(dropPosition && dropPosition !== "inside");

  return <div className="tree-item">
    <TreeRowFace
      node={props.node} open={open} expandable={expandable}
      active={props.node.id === props.activeId}
      selected={props.selectedIds.has(props.node.id)}
      context={props.node.id === props.contextId && props.editingId !== props.node.id}
      dragging={isDragging} releasing={props.releasingId === props.node.id}
      dropParent={isDropParent} sameLevelLine={sameLevelLine} dropPosition={dropPosition}
      locked={Boolean(props.node.nodeType === "note" && props.node.noteFileId && props.lockedNoteIds.has(props.node.noteFileId))}
      onPointerDown={props.onPointerDown} onContextMenu={props.onContextMenu}
      onCreateMenu={props.onCreateMenu} onToggle={props.onToggle} onSelect={props.onSelect}
      onRowClick={props.onRowClick}
      onIconClick={props.onIconClick} onContext={props.onContext}
      consumeSuppressedClick={props.consumeSuppressedClick}
    />
    {open && <div className="tree-children">
      {children.map((child) => <TreeRow key={child.id} {...props} node={child} depth={props.depth + 1} />)}
    </div>}
  </div>;
});
