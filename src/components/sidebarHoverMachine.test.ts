import { describe, expect, it } from "vitest";

import {
  INITIAL_HOVER_PHASE,
  SIDEBAR_CORRIDOR_SELECTORS,
  isInSidebarCorridor,
  reduceHover,
  type HoverPhase,
} from "./sidebarHoverMachine";

const idle = INITIAL_HOVER_PHASE;
const armed: HoverPhase = { handleShown: true, dwellArmed: true };

describe("A3 悬停召唤相位机（W5 转移表 = 既有 7 条坑）", () => {
  it("① enter：立刻显示把手并武装驻留", () => {
    const r = reduceHover(idle, { type: "enter" });
    expect(r.phase).toEqual({ handleShown: true, dwellArmed: true });
    expect(r.effects).toEqual(["showHandle", "armDwell"]);
  });

  it("② move 且未武装：显示把手并武装（自愈：面板被误收后还能再唤出）", () => {
    expect(reduceHover(idle, { type: "move" }).effects).toEqual(["showHandle", "armDwell"]);
  });

  it("③ move 且已在武装：只更新把手，**不重置**已在跑的计时", () => {
    const r = reduceHover(armed, { type: "move" });
    expect(r.effects).toEqual(["showHandle"]);
    expect(r.effects).not.toContain("armDwell");
    expect(r.phase).toBe(armed);
  });

  it("④ leave 到 app-shell 内：收把手 + 取消驻留，但不收面板", () => {
    expect(reduceHover(armed, { type: "leave", staysInShell: true }).effects).toEqual(["hideHandle", "cancelDwell"]);
  });

  it("⑤ leave 到 app-shell 外：额外收起面板", () => {
    expect(reduceHover(armed, { type: "leave", staysInShell: false }).effects).toEqual(["hideHandle", "cancelDwell", "hidePreview"]);
  });

  it("⑥ dwellElapsed：浮出预览并清掉武装", () => {
    const r = reduceHover(armed, { type: "dwellElapsed" });
    expect(r.phase.dwellArmed).toBe(false);
    expect(r.effects).toEqual(["showPreview"]);
  });

  it("⑦ click：只翻转固定态（不取消驻留，与改动前逐字一致）", () => {
    expect(reduceHover(armed, { type: "click" }).effects).toEqual(["toggleDock"]);
  });

  it("走廊并集：任一处命中即算在目录里（顺序无关）", () => {
    expect(SIDEBAR_CORRIDOR_SELECTORS).toEqual([".activity-rail", ".sidebar", ".edge-hotzone"]);
    expect(isInSidebarCorridor([false, false, false])).toBe(false);
    expect(isInSidebarCorridor([true, false, false])).toBe(true);
    expect(isInSidebarCorridor([false, true, false])).toBe(true);
    expect(isInSidebarCorridor([false, false, true])).toBe(true);
  });
});
