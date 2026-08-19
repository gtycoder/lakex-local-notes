import { describe, expect, it } from "vitest";
import { initialSearchIndex, nextSearchIndex } from "./searchNavigation";

describe("search keyboard navigation", () => {
  it("wraps active results and handles empty lists", () => {
    expect(initialSearchIndex(0)).toBe(-1);
    expect(initialSearchIndex(3)).toBe(0);
    expect(nextSearchIndex(0, -1, 3)).toBe(2);
    expect(nextSearchIndex(2, 1, 3)).toBe(0);
  });
});
