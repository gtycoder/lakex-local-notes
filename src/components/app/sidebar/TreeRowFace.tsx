import { memo } from "react";
import { ChevronRight, Lock, MoreVertical, Plus } from "lucide-react";
import { prefetchEditorKernelNow } from "../../../features/editor/kernelPrefetch";
import { nodeIcon } from "../treeIcons";
import type { TreeRowFaceProps } from "./treeRowProps";

/** 行内容只接本行状态，缓存图标/按钮等重型子树；递归分支仍传播全局状态，不能跳过子孙更新。
 * 默认浅比较保留 node/回调更新语义，不用会忽略新回调或后代选中的自定义比较器。 */
export const TreeRowFace = memo(function TreeRowFace(props: TreeRowFaceProps) {
  const icon = nodeIcon(props.node.nodeType, props.open, props.node.icon, props.node.kind ?? "doc");
  return (
    <div
      role="treeitem"
      tabIndex={0}
      data-tree-node-id={props.node.id}
      className={`note-row tree-row type-${props.node.nodeType} ${props.active ? "active" : ""} ${props.selected ? "is-multi-selected" : ""} ${props.context ? "context" : ""} ${props.dragging ? "dragging" : ""} ${props.releasing ? "releasing" : ""} ${props.dropParent ? "drop-parent" : ""} ${props.sameLevelLine ? `drop-line-${props.dropPosition}` : ""}`}
      aria-selected={props.selected || undefined}
      onClick={(event) => {
        if (props.consumeSuppressedClick()) return;
        props.onRowClick(event, props.node);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          // 261111 意图预取：键盘打开文档也先开始加载内核 chunk（与 hover/pointerdown 同一入口）。
          if (props.node.nodeType === "note") prefetchEditorKernelNow();
          props.node.nodeType === "note" ? props.onSelect(props.node.id) : props.onToggle(props.node.id);
        }
      }}
      // 261111 意图预取：文档行 hover / 按下即开始加载内核 chunk（不拦截事件、不改冒泡）。
      // 不用 onFocus（目录栏的 onFocus 属于「重命名输入全选」单一实现，见 namePromptWiring 护栏）。
      onMouseEnter={props.node.nodeType === "note" ? prefetchEditorKernelNow : undefined}
      onPointerDown={(event) => {
        if (props.node.nodeType === "note") prefetchEditorKernelNow();
        props.onPointerDown(event, props.node.id);
      }}
      onContextMenu={(event) => props.onContextMenu(event, props.node)}
    >
      <button type="button" className={`tree-chevron ${props.open && props.expandable ? "open" : ""}`} disabled={!props.expandable} onClick={(event) => { event.stopPropagation(); if (props.expandable) props.onToggle(props.node.id); }} aria-label={props.open ? "收起" : "展开"}>{props.expandable ? <ChevronRight size={14} /> : null}</button>
      <span className="tree-row-icon" title="设置图标" onClick={(event) => { event.stopPropagation(); props.onIconClick?.(props.node, event); }}>{icon}</span>
      <span className="note-row-copy">
        <strong>{props.node.title}</strong>
      </span>
      {/* 锁标识格**每行都在**（未锁时为空）：否则 grid 的行内条目数与列数不一致时，"⋯"会掉到下一行（用户报的换行） */}
      {props.locked
        ? <span className="tree-row-lock" title="已锁定（只读）" aria-label="已锁定"><Lock size={12} /></span>
        : <span className="tree-row-lock" aria-hidden="true" />}
      {/* 行内悬浮动作（对齐思源：⋯ = more-root 弹右键菜单，＋ = new 新建子文档）。
          悬浮才显形（选中态不常驻）；标题恒单行、列宽处直接裁切，不打省略号。 */}
      <span className="tree-row-actions">
        {/* ⋯ = 完整右键菜单；＋ = 新建子项（对齐思源 new-root）；用户 261006：＋ 放最右 */}
        <button
          type="button"
          className="tree-row-action ln-iconbtn ln-iconbtn--compact"
          aria-label="更多操作"
          title="更多"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); props.onContextMenu(event, props.node); }}
        >
          <MoreVertical size={15} />
        </button>
        <button
          type="button"
          className="tree-row-action ln-iconbtn ln-iconbtn--compact"
          aria-label="新建子项"
          title="新建"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); props.onCreateMenu(event, props.node); }}
        >
          <Plus size={15} />
        </button>
      </span>
    </div>
  );
});
