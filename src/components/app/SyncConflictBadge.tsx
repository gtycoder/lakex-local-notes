/** 同步记录账本角标（P1）：状态栏同步图标上的**未读同步记录**小圆点（不是文档内容冲突）。
 *  261112 UI 审计 17 I-6 收口「冲突」三义：文档内容冲突 = 「内容冲突」（状态栏胶囊）；
 *  本角标 = 「同步记录」；冲突副本/远端覆盖留档 = 「历史快照」。没有未读时渲染 null。 */
export function SyncConflictBadge({ count, className = "" }: { count: number; className?: string }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <span className={"sync-conflict-badge" + (className ? " " + className : "")} aria-hidden="true" data-sync-conflict-badge={count > 99 ? "99+" : String(count)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
