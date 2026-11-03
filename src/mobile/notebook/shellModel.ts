/**
 * 平板外壳（侧栏）纯状态机（261103 P4 / 评审 A2）。
 *
 * 背景：261102-261103 期间「树/大纲」用 4 个布尔（open/pinned × 两侧）表达，散在 15 个写点、
 * 18 个派生值、3 个 Esc owner 上，已经产出「固定态被手势关掉」「Esc 逐层失效」等真实不一致。
 * 这里把它收敛成 **每侧一个三态 mode** 的纯 reducer：所有开合/固定/收起/手势/Esc 都只派发 action，
 * 组件只读 selector —— 行为可表驱动测试，不再靠读代码猜。
 *
 * 语义（产品定稿）：
 *   closed   收起（悬浮层隐藏；固定态需先取消固定才会回到 closed？不——closed 时 pinned 信息丢失，
 *            所以「固定后收起」= closed，但偏好 key 只记 pinned ⇒ 见 padPinnedPrefs：closed 记为未固定）
 *   floating 悬浮覆盖（默认，不占布局）
 *   pinned   固定停靠（占布局、可编辑区收窄；只在本会话/设备本地偏好里记忆）
 */
export type PadPanelSide = "left" | "right";
export type PadPanelMode = "closed" | "floating" | "pinned";

export interface PadShellState {
  left: PadPanelMode;
  right: PadPanelMode;
}

/** 持久化偏好形状（padPanelPrefs 的 {tree,outline}；只有 pinned 会被记住）。 */
export interface PadPanelPrefsLike {
  tree: boolean;
  outline: boolean;
}

export function createPadShellState(prefs: PadPanelPrefsLike): PadShellState {
  return {
    left: prefs.tree ? "pinned" : "closed",
    right: prefs.outline ? "pinned" : "closed",
  };
}

export type PadShellAction =
  | { type: "setOpen"; side: PadPanelSide; open: boolean }
  | { type: "toggle"; side: PadPanelSide }
  | { type: "togglePin"; side: PadPanelSide }
  /** 点正文：只收**悬浮**面板；固定态不动（它不是临时浮层）。 */
  | { type: "closeFloating" }
  | { type: "closeAll" };

function nextOpen(mode: PadPanelMode, open: boolean): PadPanelMode {
  if (!open) return "closed";
  return mode === "closed" ? "floating" : mode;
}

export function padShellReducer(state: PadShellState, action: PadShellAction): PadShellState {
  switch (action.type) {
    case "setOpen": {
      const next = nextOpen(state[action.side], action.open);
      return next === state[action.side] ? state : { ...state, [action.side]: next };
    }
    case "toggle": {
      const next = state[action.side] === "closed" ? "floating" : "closed";
      return { ...state, [action.side]: next };
    }
    case "togglePin": {
      const next = state[action.side] === "pinned" ? "floating" : "pinned";
      return { ...state, [action.side]: next };
    }
    case "closeFloating": {
      const left = state.left === "floating" ? "closed" : state.left;
      const right = state.right === "floating" ? "closed" : state.right;
      return left === state.left && right === state.right ? state : { left, right };
    }
    case "closeAll":
      return state.left === "closed" && state.right === "closed" ? state : { left: "closed", right: "closed" };
    default:
      return state;
  }
}

export const isPadPanelOpen = (state: PadShellState, side: PadPanelSide): boolean => state[side] !== "closed";
export const isPadPanelPinned = (state: PadShellState, side: PadPanelSide): boolean => state[side] === "pinned";
/** 有任一侧固定 ⇒ 主列变三栏（占布局）。 */
export const isPadDocked = (state: PadShellState): boolean => state.left === "pinned" || state.right === "pinned";

/** 设备本地偏好只记 pinned（关合不记；冷启按 pinned 直接停靠展开）。 */
export function padPinnedPrefs(state: PadShellState): PadPanelPrefsLike {
  return { tree: state.left === "pinned", outline: state.right === "pinned" };
}

/**
 * Esc 逐层收的**顺序**（单一来源；调用方按返回的 target 派发对应 action）。
 * 顺序 = 先浮层（由 overlay owner 管）→ 再左栏 → 再右栏；固定态不参与。
 */
export function padEscapeTarget(state: PadShellState, hasOverlay: boolean): "overlay" | "left" | "right" | null {
  if (hasOverlay) return "overlay";
  if (state.left === "floating") return "left";
  if (state.right === "floating") return "right";
  return null;
}
