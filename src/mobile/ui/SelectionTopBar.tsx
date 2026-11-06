/**
 * 多选模式的**顶部栏**（261106 task-82）：取消 / 已选 N / 全选（全选后变全不选）。
 * 复用设置页页头原语（.mobile-settings-head + .mobile-page-head：sticky、三格、页内距 16），
 * 按钮用 .mb-btn（命中 44）；三个列表（小记 / 文档列表 / 回收站）共用同一份。
 */
export interface SelectionTopBarProps {
  count: number;
  allSelected: boolean;
  onCancel(): void;
  onToggleAll(): void;
}

export function SelectionTopBar({ count, allSelected, onCancel, onToggleAll }: SelectionTopBarProps) {
  return (
    <header className="mobile-settings-head mobile-page-head" role="toolbar" aria-label="多选操作">
      <button type="button" className="mb-btn mb-btn--ghost" onClick={onCancel}>取消</button>
      <div className="mobile-settings-title mb-flex1" aria-live="polite">已选 {count}</div>
      <button type="button" className="mb-btn mb-btn--ghost" onClick={onToggleAll}>{allSelected ? "全不选" : "全选"}</button>
    </header>
  );
}
