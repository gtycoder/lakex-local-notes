import { describe, expect, it } from "vitest";
import { DOCK_GUTTER, FIXED_RAIL_WIDTH } from "./layoutMetrics";

describe("desktop rail geometry", () => {
  it("uses one shared, slightly wider-than-34px rail", () => {
    expect(FIXED_RAIL_WIDTH).toBe(40);
    expect(FIXED_RAIL_WIDTH).toBeGreaterThan(34);
    expect(FIXED_RAIL_WIDTH).toBeLessThan(43);
    expect(DOCK_GUTTER).toBe(4);
  });
});
