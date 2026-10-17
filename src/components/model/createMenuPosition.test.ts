import { describe, expect, it } from "vitest";
import { getCreateMenuPosition } from "./createMenuPosition";

describe("create menu positioning", () => {
  it("keeps the menu inside a narrow sidebar instead of letting the document pane cover it", () => {
    const result = getCreateMenuPosition(
      { bottom: 75, right: 213 },
      { left: 38, right: 194, width: 156 },
      { width: 1280, height: 820 },
    );

    expect(result.width).toBe(150);
    expect(result.left + result.width).toBeLessThanOrEqual(186);
    expect(result.top).toBe(83);
  });
});
