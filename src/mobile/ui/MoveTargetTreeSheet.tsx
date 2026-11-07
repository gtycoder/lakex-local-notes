/**
 * 「移动到…」目标选择（v2 261107 简化，用户点单：**单选 / 多选都只能选笔记本**）。
 *
 * 语义（与旧版「思源式目录树」相比刻意砍掉层级）：
 * · 只列 **笔记本**（分组不展示、不可选 —— 用户口径：移动只需要选笔记本，别搞那么复杂）；
 * · 平铺列表 + 搜索（多笔记本时按名称过滤）；行 = 标准 .mb-row（不再用 <button class=mb-set-name> 导致浏览器默认边框/居中）；
 * · 当前位置标注「当前位置」；选中项打勾；自身/后代（excludedIds）禁用并写明原因；
 * · 确认后回调 parentId；遮罩/返回/滑动关闭统一由 MobileSheet 负责（关闭 = 不修改数据）。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, FolderOpen } from "lucide-react";
import { MobileSheet } from "./MobileSheet";
import { SheetFooter } from "./SheetFooter";
import { EmptyState } from "./EmptyState";

export interface MoveTargetNode {
  id: string;
  title: string;
  parentId: string | null;
  nodeType: string;
}

export interface MoveTargetTreeSheetProps {
  open: boolean;
  /** 容器节点（笔记本/分组都允许传入，组件内部只保留笔记本）。 */
  nodes: readonly MoveTargetNode[];
  /** 当前所在位置（列表里给对应笔记本标注「当前位置」）。 */
  currentParentId: string | null;
  /** 不允许作为目标（选中项自身及后代）。 */
  excludedIds?: readonly string[];
  busy?: boolean;
  error?: string | null;
  onConfirm(parentId: string): void;
  onClose(): void;
}

export function MoveTargetTreeSheet({ open, nodes, currentParentId, excludedIds, busy, error, onConfirm, onClose }: MoveTargetTreeSheetProps) {
  const excluded = useMemo(() => new Set(excludedIds ?? []), [excludedIds]);
  const notebooks = useMemo(() => nodes.filter((node) => node.nodeType === "notebook"), [nodes]);
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setQuery("");
  }, [open]);

  const needle = query.trim().toLocaleLowerCase();
  const rows = needle === ""
    ? notebooks
    : notebooks.filter((node) => (node.title || "未命名").toLocaleLowerCase().includes(needle));
  const pickedNode = picked ? notebooks.find((node) => node.id === picked) ?? null : null;
  const canConfirm = !!pickedNode && !excluded.has(pickedNode.id) && !busy;

  return (
    <MobileSheet
      open={open}
      title="移动到…"
      onClose={() => { if (!busy) onClose(); }}
      bodyClassName="mb-sheet__body--form"
      footer={<SheetFooter
        cancel={{ label: "取消", disabled: busy, onClick: onClose }}
        confirm={{ label: "移动到此处", disabled: !canConfirm, onClick: () => { if (canConfirm && picked) onConfirm(picked); } }}
      />}
    >
      {error && <div className="qn-tag-sheet__error" role="alert">{error}</div>}
      <span className="mb-input qn-tag-sheet__input">
        <input
          value={query}
          aria-label="搜索笔记本"
          placeholder="搜索笔记本…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </span>
      {notebooks.length === 0 ? (
        <EmptyState>还没有笔记本：先新建一个知识库</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>没有匹配的笔记本</EmptyState>
      ) : (
        <div className="mb-tree-list">
          {rows.map((node) => {
            const isCurrent = currentParentId === node.id;
            const isExcluded = excluded.has(node.id);
            const isPicked = picked === node.id;
            return (
              <button
                key={node.id}
                type="button"
                className={"mb-row mb-row--two-line" + (isPicked ? " is-selected" : "")}
                aria-label={"移动到 " + (node.title || "未命名")}
                aria-pressed={isPicked}
                disabled={isExcluded || busy}
                onClick={() => setPicked(isExcluded ? null : node.id)}
              >
                <span className="mb-row__icon" aria-hidden="true"><FolderOpen size={18} /></span>
                <span className="mb-row__main">
                  <span className="mb-row__title">{node.title || "未命名"}</span>
                  {isExcluded ? <span className="mb-row__sub">不能移动到自身内部</span> : isCurrent ? <span className="mb-row__sub">当前位置</span> : null}
                </span>
                {isPicked ? <Check size={18} className="mb-row__chevron" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </MobileSheet>
  );
}
