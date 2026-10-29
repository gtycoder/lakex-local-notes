/**
 * 首页首层 tab（小记 ↔ 知识库）的**横向分页判据** —— 纯函数，单一来源。
 *
 * 交互形态（261019 用户点单）：对齐语雀 App 的横向分页 —— **手指跟手拖动 + 松手吸附**，
 * 由浏览器原生横向滚动容器（`overflow-x:auto` + `scroll-snap-type:x mandatory`）完成，
 * 等价于语雀 RN 侧的 `react-native-pager-view`；这里只负责"滚动位置 → 页码 → tab"的取整与夹紧。
 * DOM 侧（事件、inert、滚动对齐）在 `HomePage`，不在这里。
 */
export const HOME_TABS = ["quick", "library"] as const;
export type HomeTab = (typeof HOME_TABS)[number];

function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/** tab → 分页下标（未知值回落到第一页）。 */
export function tabIndex(tab: HomeTab): number {
  const i = HOME_TABS.indexOf(tab);
  return i < 0 ? 0 : i;
}

/** 分页下标 → tab（越界夹紧；用于"滚到哪一页就切哪个 tab"）。 */
export function tabAt(index: number, count: number = HOME_TABS.length): HomeTab {
  return HOME_TABS[clampIndex(index, Math.min(count, HOME_TABS.length))] ?? HOME_TABS[0];
}

/** 第 index 页对应的滚动位置（px）；宽度非法时归 0（首帧还没量到宽，不要算出一个假位置）。 */
export function pagerScrollLeft(index: number, width: number, count: number = HOME_TABS.length): number {
  if (!(width > 0) || !Number.isFinite(width)) return 0;
  return clampIndex(index, Math.min(count, HOME_TABS.length)) * width;
}

/**
 * 当前滚动位置落在哪一页（吸附完成后用；`scrollLeft` 在回弹/超额时可能是负数或越界 ⇒ 夹紧）。
 * 取整口径 = 四舍五入：过半即视为下一页（与原生吸附的判定方向一致）。
 */
export function settledIndex(scrollLeft: number, width: number, count: number = HOME_TABS.length): number {
  if (!(width > 0) || !Number.isFinite(width) || !Number.isFinite(scrollLeft)) return 0;
  return clampIndex(Math.round(scrollLeft / width), Math.min(count, HOME_TABS.length));
}


/**
 * 分页器的**唯一状态机**（261028 MOB-03：把 HomePage 里 4 份 ref 镜像 + 600ms 定时器的判据收口到这里）。
 *
 * 为什么要收口：程序化滚动 / 用户手势 / 吸附回写三者的先后顺序是这块唯一的难点，
 * 之前用 interactingRef + commitByScrollRef + programmaticRef + programmaticTimerRef 四份镜像表达，
 * 任何一条路径漏清一个标记就会「标签不跟手」或「点 tab 被弹回」。现在：**状态只有一份**，
 * 每个原生事件都是显式事件，转场结果（要不要滚、滚到哪、要不要回写 tab）都是纯函数输出。
 * DOM 侧只负责执行 effect（scrollTo），见 useTabPager.ts。
 */
export interface PagerState {
  /** 当前 tab（与父级路由一致；滚动过半时由 reducePager 回写）。 */
  tab: HomeTab;
  /** 分页容器实测宽度（px）；0 = 首帧还没量到。 */
  width: number;
  /** 程序化滚动进行中：期间的 scroll 事件只代表 scrollTo，不代表用户意图。 */
  programmatic: boolean;
  /** 手指正按在分页上：此时不做程序化对齐（否则会跟手指抢）。 */
  interacting: boolean;
  /** 本次 tab 变化由「滚动过半」回写而来 ⇒ 不要再程序化滚一次（会打断惯性/吸附）。 */
  commitByScroll: boolean;
}

export function initialPagerState(tab: HomeTab, width = 0): PagerState {
  return { tab, width, programmatic: false, interacting: false, commitByScroll: false };
}

/**
 * 原生事件 → 状态机输入。
 * 收口时比旧实现多出 `user-scroll-end`（touchend/touchcancel）与 `settled` 的显式收尾：
 * 旧实现靠 ref 自己清标记，现在由事件负责，避免"忘了清"这类静默失效。
 */
export type PagerEvent =
  /** 滚动中（**过半就回写**，不等到 scrollend）。 */
  | { type: "scroll"; scrollLeft: number }
  /** 手指按下：用户接管，程序化滚动（含动画）作废。 */
  | { type: "user-scroll-start" }
  /** 手指抬起/取消：解除"交互中"，吸附交给原生 scroll-snap。 */
  | { type: "user-scroll-end" }
  /** 程序化滚动开始（DOM 已执行 effect 里的 scrollTo）：其后的 scroll 事件不代表用户意图。 */
  | { type: "programmatic-start" }
  /** 滚动结束（scrollend / 无 scrollend 时的单次兜底）：放开程序化压制并按最终位置回写。 */
  | { type: "settled"; scrollLeft: number }
  /** 顶部 tab 点击或父级路由改 tab（同一 tab 也走这里，用于抑制"自己回写的那一次"）。 */
  | { type: "tab-click"; tab: HomeTab; scrollLeft: number; width: number }
  /** 宽度变化（横竖屏 / 窗口变化）：立即重新对齐；高度变化（键盘）不动横向位置。 */
  | { type: "resize"; scrollLeft: number; width: number };

/** DOM 侧唯一的动作（"DOM 只负责 scrollTo"）。 */
export interface PagerScrollEffect {
  scrollLeft: number;
  behavior: "auto" | "smooth";
}

export interface PagerTransition {
  state: PagerState;
  /** 需要 DOM 执行的滚动；无 = 已对齐/不该滚。 */
  effect?: PagerScrollEffect;
  /** 需要回写给父级的 tab（滚动过半 / 点击）。 */
  commitTab?: HomeTab;
}

/** 对齐目标（宽度非法时 0）；与 pagerScrollLeft 同口径。 */
function alignTarget(tab: HomeTab, width: number): number {
  return pagerScrollLeft(tabIndex(tab), width, HOME_TABS.length);
}

/** scroll → tab 回写：只有"过半且与当前 tab 不同"才提交（避免自触发循环）。 */
function commitFromScroll(state: PagerState, scrollLeft: number): PagerTransition {
  if (!(state.width > 0)) return { state };
  const next = tabAt(settledIndex(scrollLeft, state.width, HOME_TABS.length), HOME_TABS.length);
  if (next === state.tab) return { state };
  return { state: { ...state, tab: next, commitByScroll: true }, commitTab: next };
}

export function reducePager(state: PagerState, event: PagerEvent): PagerTransition {
  switch (event.type) {
    case "resize": {
      const next = { ...state, width: event.width };
      const target = alignTarget(state.tab, event.width);
      // 手指按着时只记宽度，不抢滚动；高度变化（键盘）不改 scrollLeft ⇒ 这条通常直接对齐判定为 no-op。
      // 程序化态由 DOM 执行 scrollTo 后补发 programmatic-start（状态机不假设 DOM 已经照做）。
      if (state.interacting || Math.abs(event.scrollLeft - target) <= 1) return { state: next };
      return { state: next, effect: { scrollLeft: target, behavior: "auto" } };
    }
    case "tab-click": {
      const width = event.width;
      // 滚动回写的 tab 变化：内容已经滚到位（或正在吸附），只销账，不再程序化滚一次。
      const wasScrollCommit = state.commitByScroll && event.tab === state.tab;
      const next = { ...state, tab: event.tab, width, commitByScroll: false };
      if (wasScrollCommit) return { state: next };
      const target = alignTarget(event.tab, width);
      if (state.interacting || Math.abs(event.scrollLeft - target) <= 1) return { state: next };
      return { state: next, effect: { scrollLeft: target, behavior: "smooth" } };
    }
    case "programmatic-start":
      // DOM 已执行 scrollTo：其后的 scroll 事件只代表这次程序化滚动，不回写 tab。
      return { state: { ...state, programmatic: true } };
    case "user-scroll-start":
      return { state: { ...state, interacting: true, programmatic: false } };
    case "user-scroll-end":
      return { state: { ...state, interacting: false } };
    case "scroll":
      // 程序化滚动期间的 scroll 不是用户意图：不回写 tab（否则动画开头会把标签弹回旧页）。
      return state.programmatic ? { state } : commitFromScroll(state, event.scrollLeft);
    case "settled": {
      const next = state.programmatic ? { ...state, programmatic: false } : state;
      return commitFromScroll(next, event.scrollLeft);
    }
  }
}
