/**
 * 多选模式的顶部栏（v2 261107 重做）：取消 / 已选 N / 全选（全选后变全不选）。
 * 贴边、与抽屉头同高（44）、无容器底色：只靠文字与留白分区，避免进入选择态时头部高度跳变导致树闪烁。
 * 小记列表 / 文档树抽屉共用这一份。
 */
export interface SelectionTopBarProps {
  count: number;
  allSelected: boolean;
  onCancel(): void;
  onToggleAll(): void;
}

export function SelectionTopBar({ count, allSelected, onCancel, onToggleAll }: SelectionTopBarProps) {
  return (
    <header className="mb-sel-topbar" role="toolbar" aria-label="多选操作" data-prevent-swipe>
      <button type="button" className="mb-sel-topbar__btn" onClick={onCancel}>取消</button>
      <div className="mb-sel-topbar__count" aria-live="polite" aria-atomic="true">已选 {count}</div>
      <button type="button" className="mb-sel-topbar__btn" onClick={onToggleAll}>{allSelected ? "全不选" : "全选"}</button>
    </header>
  );
}
