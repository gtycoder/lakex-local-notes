/**
 * 小记写作卡的兜底骨架（261022）。
 *
 * 为什么要独立成文件：懒加载壳（模块未到）和真实 Composer（模块已到、内核还在初始化）
 * 都要用**同一份**骨架，避免「骨架 → 白卡 → 写作卡」多一次闪；Composer 里用它盖住
 * 内核就绪前的空白区域（纯进度占位，不是启动遮罩，不延迟任何东西）。
 */
export function QuickNoteComposerSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div
      className={(bare ? "mb-composer-skeleton mb-composer-skeleton--bare" : "mobile-qn-composer mb-composer-skeleton")}
      aria-busy="true"
      aria-label="正在加载编辑器"
    >
      <div className="mb-composer-skeleton__body">
        <span className="mb-skel mb-composer-skeleton__title" />
        <span className="mb-skel mb-composer-skeleton__line" />
        <span className="mb-skel mb-composer-skeleton__line" />
        <span className="mb-skel mb-composer-skeleton__line" />
        <span className="mb-skel mb-composer-skeleton__line mb-composer-skeleton__line--short" />
      </div>
      <span className="mb-skel mb-composer-skeleton__tag" />
      <div className="mb-composer-skeleton__actions">
        <span className="mb-skel mb-composer-skeleton__btn" />
        <span className="mb-skel mb-composer-skeleton__btn mb-composer-skeleton__btn--primary" />
      </div>
    </div>
  );
}
