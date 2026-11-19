import "./notePaneSkeleton.css";

/**
 * F-E（261119 移动端平滑度审计）：重依赖正文（表格 / 多维表 / 手写板）首开的**同构骨架**。
 *
 * 旧 Suspense 兜底 = <DelayedLoading><EmptyState>正在加载…</EmptyState></DelayedLoading>：
 * 居中文字空态一小块，模块到达后整个查看器（头部行 / 工具条 / 画布）替换进来 ⇒ 页面高度、
 * 顶部元素位置全变（换构跳变，审计 F-E）。现在 fallback 与查看器**同构同槽**：
 *   · bitable = 头部两行 + 网格行框（对应 .mbt-header + 网格）；
 *   · usheet  = 顶部工作表条 + 满幅画布（对应 .mb-usheet-topbar + Univer 画布）；
 *   · ink     = 满幅纸面（.ink-pad--mobile 的导航/工具坞是 overlay，不占布局）。
 * 尺寸同源清单与对拍护栏见 notePaneSkeleton.css 头注释 / notePaneSkeleton.geometry.test.ts。
 *
 * 两点刻意行为：
 * ① **立即显示、不包 DelayedLoading**（ui/delayedLoading.tsx 只延迟「加载态出现」）——
 *    骨架本身就是要一直占着的几何，「空 300ms → 骨架 → 查看器」是三段换构，「骨架 → 查看器」才是单段；
 * ② 填充 = .mb-skel（mobile.css 自带呼吸 + prefers-reduced-motion 名单已登记），本组件零动效。
 */
export type PaneSkeletonKind = "bitable" | "usheet" | "ink";

const SKELETON_LABEL: Record<PaneSkeletonKind, string> = {
  bitable: "正在打开多维表",
  usheet: "正在打开表格",
  ink: "正在打开手写板",
};

/** 网格行框条数（骨架只画「头部 + 行框」的同构外形，行数不承诺与真实网格一致）。 */
const GRID_ROWS = 6;

export function NotePaneSkeleton({ kind }: { kind: PaneSkeletonKind }) {
  return (
    <div
      className={"mb-pane-skel mb-pane-skel--" + kind}
      role="status"
      aria-busy="true"
      aria-label={SKELETON_LABEL[kind]}
    >
      {kind === "ink" ? (
        <div className="mb-skel mb-pane-skel__paper" />
      ) : (
        <>
          {/* 头部槽位与真实头部同源（.mbt-header 两行 / .mb-usheet-topbar 一条）：
              同样声明 topChrome 契约（data-edge="nested" ⇒ 不重复消费安全区，与真实端一致）。 */}
          <div className="mb-pane-skel__head" data-mb-topbar data-edge="nested">
            <span className={"mb-skel mb-pane-skel__bar " + (kind === "bitable" ? "mb-pane-skel__bar--row1" : "mb-pane-skel__bar--tab")} />
            {kind === "bitable" ? <span className="mb-skel mb-pane-skel__bar mb-pane-skel__bar--row2" /> : null}
          </div>
          <div className="mb-pane-skel__rows">
            {Array.from({ length: GRID_ROWS }, (_, i) => (
              <span key={i} className="mb-skel mb-pane-skel__row" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
