/** 同步记录角标（P1）：状态栏同步图标上的未读小圆点。没有未读时渲染 null。 */
export function SyncConflictBadge({ count, className = "" }: { count: number; className?: string }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <span className={"sync-conflict-badge" + (className ? " " + className : "")} aria-hidden="true" data-sync-conflict-badge={count > 99 ? "99+" : String(count)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
