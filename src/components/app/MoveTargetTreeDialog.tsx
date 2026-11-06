
/**
 * 桌面「移动…」目标选择 = **思源式目录树弹窗**（261106 task-90，替换原扁平列表）。
 *
 * 交互：笔记本 → 分组 → 子分组递归；行左箭头展开/收起（键盘可操作、aria-expanded）；
 * 默认展开「当前所在路径」并把当前父级标「当前位置」；搜索按名称过滤、命中自动展开祖先并高亮；
 * 只允许选容器，防环（自身/后代）与回收站行禁用并给原因；底部「移动到此处」未选禁用。
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog } from "../ui/Overlay";
import { Book, ChevronRight, Folder } from "lucide-react";
import type { TreeNode } from "../../lib/types";
import { buildMoveTreeRows, initialMoveTreeExpanded, visibleMoveTreeRows, type MoveTreeRow } from "../../desktop/moveTreeModel";

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

  if (!open) return null;

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const canConfirm = !!selected && !busy;

  return (
    <Dialog open onDismiss={() => { if (!busy) onClose(); }} label="移动到…" className="move-target-tree-dialog">
      <div className="ln-dialog__head"><span className="ln-dialog__title">移动到…</span></div>
      <div className="ln-dialog__body">
        <span className="ln-input move-target-tree-dialog__search">
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
          <div className="move-target-tree-dialog__tree" role="tree" aria-label="目标位置">
            {rows.map((row) => (
              <div
                key={row.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                aria-selected={selected === row.id}
                aria-disabled={row.disabled || undefined}
                data-depth={Math.min(row.depth, 7)}
                className={"move-target-tree-dialog__node" + (row.current ? " is-current" : "") + (row.disabled ? " is-disabled" : "")}
              >
                <button
                  type="button"
                  className={"move-target-tree-dialog__toggle" + (row.expanded ? " is-open" : "")}
                  disabled={!row.hasChildren}
                  aria-label={row.expanded ? "收起子分组" : "展开子分组"}
                  tabIndex={row.hasChildren ? 0 : -1}
                  onClick={() => toggle(row.id)}
                >
                  {row.hasChildren ? <ChevronRight size={13} /> : null}
                </button>
                <button
                  type="button"
                  className={"ln-row move-target-tree-dialog__item" + (selected === row.id ? " is-selected" : "")}
                  disabled={row.disabled || busy}
                  title={row.reason ?? row.title}
                  onClick={() => setSelected(row.id)}
                >
                  {row.nodeType === "notebook" ? <Book size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
                  <span className="ln-ellipsis move-target-tree-dialog__title">{highlightTitle(row.title, query)}</span>
                  {row.current && <span className="move-target-tree-dialog__badge">当前位置</span>}
                  {row.disabled && row.reason && <em className="move-target-tree-dialog__reason">{row.reason}</em>}
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <p className="move-target-tree-dialog__error" role="alert">{error}</p>}
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
