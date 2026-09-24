/**
 * A3 左缘悬停召唤 —— 纯决策层（260923 W5）。
 *
 * 只描述"什么事件、在什么相位、产生哪些副作用"，不碰 DOM / 定时器 / React state：
 * 相位由调用方从**真实来源**读出（把手是否带 .is-active、dwell 定时器是否在跑），
 * 因此不会出现"机器状态与实现状态漂移"，也不会引入额外渲染。
 * 行为契约见 docs/PANEL-CONTRACT.md §3；回归护栏 = scripts/e2e-sidebar-hover.mjs（真实指针 8 项）。
 */
export interface HoverPhase {
  /** 跟手把手是否可见（.edge-hotzone.is-active） */
  handleShown: boolean;
  /** 240ms 驻留定时器是否在跑 */
  dwellArmed: boolean;
}

export const INITIAL_HOVER_PHASE: HoverPhase = { handleShown: false, dwellArmed: false };

export type HoverEvent =
  | { type: "enter" }
  | { type: "move" }
  | { type: "leave"; staysInShell: boolean }
  | { type: "dwellElapsed" }
  | { type: "click" };

export type HoverEffect =
  | "showHandle"
  | "hideHandle"
  | "armDwell"
  | "cancelDwell"
  | "showPreview"
  | "hidePreview"
  | "toggleDock";

/**
 * 转移表：
 *   idle  + enter        → armed : showHandle, armDwell
 *   *     + move         → armed : showHandle[, armDwell 仅当没在跑 —— 自愈；已在跑的不重置]
 *   *     + leave        → idle  : hideHandle, cancelDwell[, hidePreview 仅当指针离开整个 app-shell]
 *   armed + dwellElapsed → -     : showPreview（清 dwellArmed）
 *   *     + click        → idle  : toggleDock, hideHandle, cancelDwell
 *                                  （点击后**必须**收把手 + 取消驻留：否则 is-active 残留，
 *                                  回到「收起」态时把手会"常驻"；残留的驻留还会在收起后立刻把浮层再唤出来）
 */
export function reduceHover(phase: HoverPhase, event: HoverEvent): { phase: HoverPhase; effects: HoverEffect[] } {
  switch (event.type) {
    case "enter":
      return { phase: { handleShown: true, dwellArmed: true }, effects: ["showHandle", "armDwell"] };
    case "move":
      return phase.dwellArmed
        ? { phase, effects: ["showHandle"] }
        : { phase: { handleShown: true, dwellArmed: true }, effects: ["showHandle", "armDwell"] };
    case "leave": {
      const effects: HoverEffect[] = ["hideHandle", "cancelDwell"];
      if (!event.staysInShell) effects.push("hidePreview");
      return { phase: { handleShown: false, dwellArmed: false }, effects };
    }
    case "dwellElapsed":
      return { phase: { handleShown: phase.handleShown, dwellArmed: false }, effects: ["showPreview"] };
    case "click":
      return { phase: { handleShown: false, dwellArmed: false }, effects: ["toggleDock", "hideHandle", "cancelDwell"] };
  }
}

/** floating 态下"还算在目录里"的走廊并集（顺序无关，任一命中即算在内）。 */
export const SIDEBAR_CORRIDOR_SELECTORS = [".activity-rail", ".sidebar", ".edge-hotzone"] as const;
export type SidebarCorridorSelector = (typeof SIDEBAR_CORRIDOR_SELECTORS)[number];
export function isInSidebarCorridor(hits: readonly boolean[]): boolean {
  return hits.some(Boolean);
}
