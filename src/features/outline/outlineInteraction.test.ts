import { describe, expect, it } from "vitest";
import { OUTLINE_HOVER_HIDE_DELAY_MS, OUTLINE_HOVER_TRIGGER_WIDTH, OUTLINE_SCROLLBAR_CLEARANCE } from "./outlineInteraction";

describe("outline hover hitbox contract", () => {
  it("keeps the trigger narrower than the editor scrollbar track", () => {
    expect(OUTLINE_HOVER_TRIGGER_WIDTH).toBeLessThanOrEqual(14);
    expect(OUTLINE_HOVER_TRIGGER_WIDTH).toBeGreaterThanOrEqual(12);
  });

  it("keeps the editor scrollbar outside the floating panel", () => {
    expect(OUTLINE_SCROLLBAR_CLEARANCE).toBe(10);
  });

  it("keeps a short rail-to-panel grace period", () => {
    expect(OUTLINE_HOVER_HIDE_DELAY_MS).toBe(120);
  });
});
