import { flushSync } from "react-dom";

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => unknown;
};

/**
 * 用 View Transitions API 包裹一次同步 DOM 更新（Chromium 150 已 Baseline）。
 * - 支持时：startViewTransition + flushSync 保证新旧快照各是一次完整渲染，得到平滑过渡；
 * - 不支持时（旧内核/测试环境）：直接执行，行为与之前完全一致。
 * 只用于「切换类」交互（如切换标签页），不要在打字/拖拽过程中调用。
 */
export function withViewTransition(update: () => void): void {
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition !== "function") {
    update();
    return;
  }
  doc.startViewTransition(() => {
    flushSync(update);
  });
}
