/**
 * 左目录抽屉的树列表（从 NotebookWorkspace 抽出）：大列表只渲染视口 ± 缓冲。
 *
 * 2000 节点时旧实现一次挂 2000 个 <button>（每行 2 个动作 + 图标 ⇒ 约 2–3 万 DOM 节点），
 * 且工作区任意一次重渲染（开抽屉 / 树变更 / 切换标签 / 标题输入）都整份重建 ⇒ 主线程卡死，
 * 表现就是「点文档没反应、点新建没反应」。现在可见行由 notebookTreeIndex 一次算出，
 * 超过阈值交给 @tanstack/react-virtual（与小记时间线同一套，见 HomePage.tsx 的 quickVirtualizer）
 * 只挂视口附近的 ~35 行；小树保持原来的全量渲染（无定位开销，行为完全不变）。
 *
 * 保真约束（全部沿用原实现）：data-node-id / data-depth、选中态、图标、分组 chevron、
 * 行内 ⋮/＋、长按拖拽（源行留在原位、落点线伪元素挂在 .mb-row 上）、重命名输入框。
 * 滚动容器仍是 .side-panel-body（拖拽的边缘自动滚动、拖拽态 touch-action 与 CSS 都依赖这个类）。
 *
 * 定位样式用内联 style 是**动态列表坐标**（行 start / 总高 / translateY），与小记虚拟列表同一写法；
 * 静态视觉仍在 mobile.css / kit.css，不要往这里加颜色/字号。
 */
import { useCallback, useState } from "react";
import { ChevronRight, File, FolderOpen, MoreVertical, Plus } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import type { LongPressHandlers } from "../ui/useLongPress";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import type { NotebookTreeRow } from "./notebookTreeIndex";

/** 超过这个行数才虚拟化：小树一次渲染更简单，也不会引入定位/测量开销。 */
export const TREE_VIRTUAL_THRESHOLD = 60;
/** 估算行高 = kit.css .mb-row 的 min-height（--mb-ctl-h = 44）；真实高度由 measureElement 校正。 */
export const TREE_ROW_ESTIMATE_PX = 44;
/** 视口上下各多挂 8 行：手指下的落点行/长按源行不会恰好落在窗口外。 */
export const TREE_OVERSCAN = 8;

/** 拖拽落点（与 NotebookWorkspace 的 drag state 同形，只取渲染需要的字段）。 */
export interface NotebookTreeDragState {
  id: string;
  overId: string | null;
  position: "before" | "after" | "inside" | null;
}

export interface NotebookTreeListProps {
  rows: readonly NotebookTreeRow[];
  expanded: ReadonlySet<string>;
  hasChildren: (id: string) => boolean;
  activeId: string | null;
  drag: NotebookTreeDragState | null;
  renamingId: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  longPress: LongPressHandlers;
  /** 按下行时登记长按目标（拖拽起手要用）。 */
  onPressRow: (item: NotebookTreeItem) => void;
  /** 点行：有子节点 → 展开/折叠；文档 → 打开（判据在调用方，保持原语义）。 */
  onActivate: (item: NotebookTreeItem) => void;
  onOpenMenu: (item: NotebookTreeItem) => void;
  onOpenCreate: (item: NotebookTreeItem) => void;
}

export function NotebookTreeList(props: NotebookTreeListProps) {
  const { rows, expanded, hasChildren, activeId, drag, renamingId, renameValue } = props;
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const setScrollNode = useCallback((node: HTMLDivElement | null) => setScrollElement(node), []);
  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);
  const virtualEnabled = rows.length > TREE_VIRTUAL_THRESHOLD;
  const getItemKey = useCallback(
    (index: number) => rows[index]?.item.id ?? index,
    [rows],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: virtualEnabled ? rows.length : 0,
    getScrollElement,
    estimateSize: () => TREE_ROW_ESTIMATE_PX,
    getItemKey,
    overscan: TREE_OVERSCAN,
    enabled: virtualEnabled,
    initialRect: { width: 360, height: 800 },
  });

  const virtualItems = virtualEnabled ? virtualizer.getVirtualItems() : [];
  /**
   * 重命名中的行即使滚出虚拟窗口也保留一条（绝对定位到它自己的 start）：
   * 行被窗口卸掉会连带 autoFocus 输入框消失（焦点/内容都可能丢）。只多挂这一行，不破坏窗口化。
   */
  const renamingIndex = renamingId && virtualEnabled ? rows.findIndex((row) => row.item.id === renamingId) : -1;
  const renamingInWindow = renamingIndex >= 0 && virtualItems.some((entry) => entry.index === renamingIndex);
  const renamingOffset = renamingIndex >= 0 && !renamingInWindow
    ? virtualizer.getOffsetForIndex(renamingIndex)?.[0]
    : undefined;

  const renderRow = (row: NotebookTreeRow) => {
    const it = row.item;
    const kids = hasChildren(it.id);
    const NodeIcon = it.kind === "group" ? FolderOpen : File;
    return (
      <button
        className={"mb-row mb-indent" + (activeId === it.id ? " is-selected" : "") + (drag?.id === it.id ? " nb-dragging" : "") + (drag?.overId === it.id && drag.position ? (drag.position === "inside" ? " drop-parent" : " drop-line-" + drag.position) : "")}
        data-depth={row.depth}
        data-node-id={it.id}
        onClick={() => {
          if (renamingId) return;
          props.onActivate(it);
        }}
        onTouchStart={(e) => { props.onPressRow(it); props.longPress.onTouchStart(e); }}
        onTouchMove={props.longPress.onTouchMove}
        onTouchEnd={props.longPress.onTouchEnd}
        onTouchCancel={props.longPress.onTouchCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {kids ? <ChevronRight size={16} className={expanded.has(it.id) ? "mb-chevron open" : "mb-chevron"} /> : <span className="mb-chevron-spacer" />}
        {renamingId === it.id ? (
          <input
            className="mb-input"
            autoFocus
            value={renameValue}
            onChange={(e) => props.onRenameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => props.onRenameCommit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onRenameCommit();
              if (e.key === "Escape") props.onRenameCancel();
            }}
          />
        ) : (
          <>
            {it.icon ? <span className="mb-tree-icon"><MobileNodeIconGlyph value={it.icon} /></span> : <NodeIcon size={16} className="mb-tree-icon" />}
            <span className="mb-row__title">{it.title}</span>
            {/* 移动端无 hover：动作常显（对齐思源移动端 .b3-list-item 不带 --hide-action）。
                ⋯ = 行菜单，＋ = 新建子项。 */}
            <span className="nb-tree-actions">
              <span role="button" tabIndex={0} className="nb-tree-action mb-tap" aria-label="更多" onClick={(e) => { e.stopPropagation(); props.onOpenMenu(it); }}><MoreVertical size={17} /></span>
              <span role="button" tabIndex={0} className="nb-tree-action mb-tap" aria-label="新建子项" title="新建子项" onClick={(e) => { e.stopPropagation(); props.onOpenCreate(it); }}><Plus size={17} /></span>
            </span>
          </>
        )}
      </button>
    );
  };

  return (
    <div className="side-panel-body" ref={setScrollNode}>
      {rows.length === 0 && <div className="mb-empty">暂无文档，点右上新建</div>}
      {virtualEnabled ? (
        <div style={{ position: "relative", height: virtualizer.getTotalSize() }}>
          {renamingOffset !== undefined && rows[renamingIndex] && (
            <div
              key={"pin-" + renamingIndex}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${renamingOffset}px)` }}
            >
              {renderRow(rows[renamingIndex])}
            </div>
          )}
          {virtualItems.map((entry) => {
            const row = rows[entry.index];
            if (!row) return null;
            return (
              <div
                key={entry.key}
                data-index={entry.index}
                ref={virtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${entry.start}px)` }}
              >
                {renderRow(row)}
              </div>
            );
          })}
        </div>
      ) : (
        rows.map((row) => <div key={row.item.kind + "-" + row.item.id}>{renderRow(row)}</div>)
      )}
    </div>
  );
}
