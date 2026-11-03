/**
 * 桌面内核 chunk 的空闲预取（P12-①，261103）。
 *
 * 背景：MultiTabEditor 的 EditorTab 已改 React.lazy（P11-④ 实测首屏图 2.07MB → 0.22MB gz），
 * 但 cold code cache 下首次打开文档仍要等内核 chunk（≈1.61MB gz / 6.0MB raw）加载+解析
 * （实测「点击→引擎」约 0.54s）。这里在启动就绪后 ~3s 的第一个空闲回调里预取同一模块，
 * 把这段开销挪到用户看首页/读列表的空档；命中后首文档打开不再等 chunk。
 *
 * 语义约定：
 * - 幂等：模块级 flag，重复调用只排一次；
 * - SSR/测试守卫：没有 window/document 直接 no-op；
 * - 失败静默：预取失败不影响功能（真正打开文档时仍会 import，Suspense 兜底）；
 * - 不用 rAF 门控（隐藏窗口 rAF 不触发），也不新增全局监听 —— 只在 App 既有的启动就绪 effect 里调一次。
 */
let scheduled = false;
let prefetched = false;

export function prefetchEditorKernel(): void {
  if (scheduled || prefetched) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  scheduled = true;
  const load = (): void => {
    prefetched = true;
    // 与 MultiTabEditor 的 lazy 目标同一模块 ⇒ 共享 chunk（连带 lakeRuntime / 内核）。
    void import("./EditorTab").catch(() => {
      /* 预取失败：不打扰用户，首文档打开时还会再 import 一次 */
    });
  };
  setTimeout(() => {
    const idle = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    }).requestIdleCallback;
    if (typeof idle === "function") idle(load, { timeout: 2000 });
    else load();
  }, 3000);
}
