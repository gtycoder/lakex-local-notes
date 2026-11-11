/**
 * 桌面内核 chunk 的预取（P12-①，261103；261111 冷启动预热重做）。
 *
 * 背景：MultiTabEditor 的 EditorTab 已改 React.lazy（P11-④ 实测首屏图 2.07MB → 0.22MB gz），
 * 但 cold code cache 下首次打开文档仍要等内核 chunk（≈1.61MB gz / 6.0MB raw）加载+解析。
 *
 * 261111 用户反馈「刚打开软件进来时展示正在加载编辑器」：桌面**启动时必然会打开一篇文档**
 * （有恢复标签就恢复整批，没有则落 lastOpenedNoteId），EditorTab 在启动几百 ms 内就挂载，
 * 而旧实现要「就绪后 3s 的第一个空闲回调」才开始预取 ⇒ 预取永远慢于真实首次挂载，等于没帮忙。
 * 现在三种触发，全部幂等、都不阻塞首屏：
 *   ① **立即**（prefetchEditorKernelNow）：安全模式判据一到（useSafeModeStatus）、
 *      恢复标签计划确定、冷启动首篇候选确定、以及用户意图（目录行/标签页/搜索结果的
 *      mouseenter/focus/pointerdown）时调用 ⇒ 与首屏/数据恢复**并行**开跑；
 *   ② **空闲兜底**（prefetchEditorKernel）：首批首帧后的第一段空闲（最多等 500ms），
 *      给「安全模式判据未知 / 没有任何触发点」的路径保底；
 *   ③ 两者共享同一份 id 与同一个 `import("./EditorTab")`（与 MultiTabEditor 的 lazy 目标同一模块
 *      ⇒ 共享 chunk），重复调用只生效一次。
 *
 * 语义约定：
 * - 幂等：模块级 flag；Now 会清掉尚未触发的空闲定时器，避免二次 import；
 * - SSR/测试守卫：没有 window/document 直接 no-op；
 * - 失败静默：预取失败不影响功能（真正打开文档时仍会 import，Suspense 兜底）；
 * - **不用 rAF 门控**（隐藏窗口 rAF 不触发），也不新增全局监听 —— 只在既有事件/启动流程里调。
 */
let scheduled = false;
let prefetched = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function loadEditorChunk(): void {
  if (prefetched) return;
  prefetched = true;
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  // 与 MultiTabEditor 的 lazy 目标同一模块 ⇒ 共享 chunk（连带 lakeRuntime / 内核）。
  void import("./EditorTab").catch(() => {
    /* 预取失败：不打扰用户，首文档打开时还会再 import 一次 */
  });
}

/**
 * 立即预取（不排空闲）：安全模式判据一到 / 恢复标签 / 冷启动首篇 / 用户意图时调用。
 * 幂等；若之前已排过空闲回调，会取消它（同一 chunk 只 import 一次）。
 */
export function prefetchEditorKernelNow(): void {
  if (prefetched) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  scheduled = true;
  loadEditorChunk();
}

/**
 * 空闲兜底预取：首帧后 500ms 起的第一个空闲回调（timeout 1500 保证隐藏窗口也会跑）。
 * 261111：由「就绪后 3s」提前到「首帧后最早空闲」——实测启动就绪 ~350ms、首篇编辑器挂载
 * ~1.7s（dev/冷缓存），3s 才开跑已错过整段首篇窗口；空闲回调保证不抢首屏关键路径。
 */
export function prefetchEditorKernel(): void {
  if (scheduled || prefetched) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  scheduled = true;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    const idle = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    }).requestIdleCallback;
    if (typeof idle === "function") idle(loadEditorChunk, { timeout: 1500 });
    else loadEditorChunk();
  }, 500);
}
