
/**
 * 桌面「移动…」目标选择 = 思源式目录树弹窗（261106 task-90；task-91 按截图重做视觉）。
 *
 * 交互：笔记本 → 分组 → 子分组递归；行左箭头展开/收起；默认展开当前所在路径并把当前父级标
 * 「当前位置」；搜索按名称过滤、命中自动展开祖先并高亮；只允许选容器，防环（自身/后代）与回收站行
 * 禁用并给原因；底部「取消 / 移动到此处」（未选禁用）。
 *
 * 视觉全部走既有原语：kit Dialog（标题区/内容区/底部按钮区、遮罩、焦点陷阱、Esc）、
 * ln-input--search（带图标输入）、ln-row（行/选中/禁用/hover）、ln-btn（底部按钮）；
 * 本组件只补树形缩进/展开箭头/「当前位置」徽标/命中高亮这几条必要声明（全令牌）。
 *
 * 键盘：↑/↓ 在可选行间移动选中（自动滚进视野）、Enter 确认、Tab 可到展开箭头。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../ui/Overlay";
import { Book, ChevronRight, Folder, Search } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { buildMoveTreeRows, initialMoveTreeExpanded, visibleMoveTreeRows, type MoveTreeRow } from "../../core/moveTreeModel";

export interface MoveTargetTreeDialogProps {
  open: boolean;
  /** 完整目录树（用于生成层级与防环）。 */
  nodes: readonly TreeNode[];
  /** 正在移动的节点（单条 = 长度 1）。 */
  movingIds: readonly string[];
  /** 移动项当前父级（同父级批量时给；不同父级 = null）。 */
  currentParentId: string | null;
  busy?: boolean;
  error?: string | null;
  onConfirm(parentId: string): void;
  onClose(): void;
}

/** 命中文字高亮（大小写不敏感；只在有搜索词时生效）。 */
function highlightTitle(title: string, query: string) {
  const needle = query.trim();
  if (!needle) return title;
  const index = title.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return title;
  return (
    <>
      {title.slice(0, index)}
      <mark className="move-target-tree-dialog__mark">{title.slice(index, index + needle.length)}</mark>
      {title.slice(index + needle.length)}
    </>
  );
}

export function MoveTargetTreeDialog({
  open, nodes, movingIds, currentParentId, busy = false, error = null, onConfirm, onClose,
}: MoveTargetTreeDialogProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => initialMoveTreeExpanded(nodes, currentParentId));
  const treeRef = useRef<HTMLDivElement | null>(null);

  // 每次打开重置：搜索清空、未选目标、默认展开当前路径（让「当前位置」直接可见）
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(null);
    setExpanded(initialMoveTreeExpanded(nodes, currentParentId));
  }, [open, nodes, currentParentId]);

  const result = useMemo(
    () => buildMoveTreeRows({ nodes, movingIds, currentParentId, expanded, query }),
    [nodes, movingIds, currentParentId, expanded, query],
  );
  const rows = useMemo<MoveTreeRow[]>(
    () => (query.trim() ? result.rows : visibleMoveTreeRows(result.rows)),
    [result, query],
  );
  const selectableRows = useMemo(() => rows.filter((row) => !row.disabled), [rows]);

  /** 选中行滚进树容器自己的可视区（只动本容器，不 scrollIntoView）。 */
  const scrollRowIntoView = useCallback((id: string) => {
    const container = treeRef.current;
    if (!container) return;
    const row = [...container.querySelectorAll<HTMLElement>("[data-move-row-id]")].find((element) => element.dataset.moveRowId === id);
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = Math.max(0, top - 4);
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight + 4;
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /** ↑/↓ 在可选行间步进（跳过禁用行）；Enter 确认。 */
  const moveSelection = useCallback((delta: 1 | -1) => {
    if (selectableRows.length === 0) return;
    const index = selectableRows.findIndex((row) => row.id === selected);
    const nextIndex = index < 0
      ? (delta > 0 ? 0 : selectableRows.length - 1)
      : (index + delta + selectableRows.length) % selectableRows.length;
    const next = selectableRows[nextIndex];
    setSelected(next.id);
    window.requestAnimationFrame(() => scrollRowIntoView(next.id));
  }, [selectableRows, selected, scrollRowIntoView]);

  if (!open) return null;

  const canConfirm = !!selected && !busy;
  const onBodyKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); moveSelection(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); moveSelection(-1); return; }
    if (event.key === "Enter" && canConfirm && selected) { event.preventDefault(); onConfirm(selected); }
  };

  return (
    <Dialog open onDismiss={() => { if (!busy) onClose(); }} label="移动到…" className="move-target-tree-dialog">
      <div className="ln-dialog__head"><span className="ln-dialog__title">移动到…</span></div>
      <div className="ln-dialog__body" onKeyDown={onBodyKeyDown}>
        <span className="ln-input ln-input--search move-target-tree-dialog__search">
          <Search size={14} className="ln-input__icon" aria-hidden="true" />
          <input
            className="ln-input__field"
            value={query}
            aria-label="搜索目标位置"
            placeholder="搜索笔记本或分组"
            onChange={(event) => setQuery(event.target.value)}
          />
        </span>
        {rows.length === 0 ? (
          <p className="ln-empty">没有匹配的位置。</p>
        ) : (
          <div className="move-target-tree-dialog__tree" role="tree" aria-label="目标位置" ref={treeRef}>
            {rows.map((row) => (
              <div
                key={row.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                aria-selected={selected === row.id}
                aria-disabled={row.disabled || undefined}
                data-depth={Math.min(row.depth, 7)}
                data-move-row-id={row.id}
                className={"move-target-tree-dialog__node" + (row.current ? " is-current" : "")}
              >
                <button
                  type="button"
                  className={"move-target-tree-dialog__toggle" + (row.expanded ? " is-open" : "")}
                  disabled={!row.hasChildren}
                  aria-label={row.expanded ? "收起子分组" : "展开子分组"}
                  tabIndex={row.hasChildren ? 0 : -1}
                  onClick={() => toggle(row.id)}
                >
                  {row.hasChildren ? <ChevronRight size={13} aria-hidden="true" /> : null}
                </button>
                <button
                  type="button"
                  className={"ln-row move-target-tree-dialog__item" + (selected === row.id ? " is-selected" : "") + (row.nodeType === "notebook" ? " ln-row--notebook" : "")}
                  disabled={row.disabled || busy}
                  title={row.reason ?? row.title}
                  onClick={() => setSelected(row.id)}
                >
                  {row.nodeType === "notebook"
                    ? <Book size={14} className="ln-row__icon" aria-hidden="true" />
                    : <Folder size={14} className="ln-row__icon" aria-hidden="true" />}
                  <span className="ln-row__title">{highlightTitle(row.title, query)}</span>
                  {row.current && <span className="move-target-tree-dialog__badge">当前位置</span>}
                  {row.disabled && row.reason && <em className="move-target-tree-dialog__reason">{row.reason}</em>}
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <p className="move-target-tree-dialog__error" role="alert">{error}</p>}
        <p className="move-target-tree-dialog__hint">↑↓ 选择位置，Enter 确认；只可移动到笔记本或分组。</p>
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!canConfirm} onClick={() => { if (selected) onConfirm(selected); }}>
          {busy ? "处理中…" : "移动到此处"}
        </button>
      </div>
    </Dialog>
  );
}
