import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TreeRowFace } from "./TreeRowFace";
import type { TreeRowProps } from "./treeRowProps";

/**
 * Finder 式展开/收起高度动画（261123 用户点单「目录展开要像访达一样丝滑」）。
 *
 * DESIGN Motion 红线「不动布局属性」的**登记例外**（参照「输入卡例外 261116」）：
 * 只在「目录展开/收起」这一个语义上动 height；时长走既有档（--lake-motion-fast 250ms /
 * ease-out）；状态切换（hover/颜色）仍瞬时；reduced-motion 由 a11y 层统一兜底
 * （其 transition-property 白名单不含 height ⇒ 自动瞬时，组件不写自己的 reduce 分支），
 * 于是结束判定 = transitionend(propertyName=height) + 320ms 兜底定时器（无过渡也能收尾）。
 *
 * 每层 .tree-children 各自动各的容器（嵌套展开不逐层重播，261122 被杀的 shell-tree-reveal 不复活）；
 * 收起动画结束才卸载子树（与旧行为一致：closed 时不占 DOM）。
 */
const TreeChildren = memo(function TreeChildren({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const ref = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const firstRef = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      // 初始即关闭（mounted=false 无 DOM）：这已是「非初始打开」的一次 effect ⇒ 消费首跳标记，
      // 否则随后的首次展开会被误当「初始打开」跳过动画（261123 实测坑）。
      firstRef.current = false;
      if (open && !mounted) setMounted(true); // 先挂载，下一轮 effect 再起动画
      return;
    }
    // 打断进行中的动画：摘掉旧监听/定时器，从**当前实际高度**接着走（不落旧动画的终态）。
    cancelRef.current?.();
    cancelRef.current = null;
    if (firstRef.current) {
      firstRef.current = false;
      if (open) return; // 初始即打开（启动恢复/搜索展开）：不播动画
    }
    const settle = (end: "open" | "closed") => {
      cancelRef.current = null;
      if (end === "open") {
        el.style.height = ""; // 交还 auto，后续内容变化自适应
      } else {
        // 保持 0px 直到卸载：若先清成 auto，React 卸载前会闪一帧全高（261123 实测 559→-1 中间的回闪）。
        el.style.height = "0px";
      }
      el.classList.remove("is-animating");
      if (end === "closed") setMounted(false);
    };
    if (open) {
      const target = el.scrollHeight;
      el.style.height = "0px";
      el.classList.add("is-animating");
      void el.offsetHeight; // 强制回流后再改目标高度，保证 0 → target 起播
      el.style.height = target + "px";
    } else {
      const from = el.getBoundingClientRect().height;
      el.style.height = from + "px";
      el.classList.add("is-animating");
      void el.offsetHeight;
      el.style.height = "0px";
    }
    const end = () => settle(open ? "open" : "closed");
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== el || event.propertyName !== "height") return;
      end();
    };
    el.addEventListener("transitionend", onEnd);
    const timer = window.setTimeout(end, 320); // reduced-motion/无过渡兜底
    cancelRef.current = () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
    };
    return () => { cancelRef.current?.(); cancelRef.current = null; };
  }, [open, mounted]);

  return mounted ? <div ref={ref} className="tree-children">{children}</div> : null;
});

export const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const children = (props.treeIndex.childrenByParent.get(props.node.id) ?? []).filter((node) => props.treeIndex.visibleIds.has(node.id));
  const expandable = children.length > 0 || props.node.nodeType !== "note";
  const open = props.expanded.has(props.node.id) || Boolean(props.query);

  const dropPosition = props.dropTarget?.id === props.node.id ? props.dropTarget.position : null;
  const isDragging = props.dragMoved === true && props.draggingId === props.node.id;
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
    <TreeChildren open={open}>
      {children.map((child) => <TreeRow key={child.id} {...props} node={child} depth={props.depth + 1} />)}
    </TreeChildren>
  </div>;
});