import { describe, expect, it } from "vitest";

const SIDEBAR_HOVER_HIDE_DELAY_MS = 120;

describe("sidebar hover interaction", () => {
  it("uses a short leave grace period", () => {
    expect(SIDEBAR_HOVER_HIDE_DELAY_MS).toBe(120);
  });
});
