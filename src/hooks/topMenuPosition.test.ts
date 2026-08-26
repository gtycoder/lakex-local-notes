import { describe, expect, it } from "vitest";
import { chooseVisibleAnchor, clampPopoverPosition } from "./topMenuPosition";

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };

function element(rect: Rect) {
  return { getBoundingClientRect: () => rect };
}

describe("top menu positioning", () => {
  it("prefers a visible candidate when the shared ref points at a hidden keep-alive instance", () => {
    const hidden = element({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    const visible = element({ top: 5, bottom: 33, left: 196, right: 226, width: 30, height: 28 });

    expect(chooseVisibleAnchor(hidden, [hidden, visible])).toBe(visible);
  });

  it("keeps a fixed popover inside the viewport", () => {
    expect(clampPopoverPosition(
      { top: 5, bottom: 33, left: 196, right: 226 },
      { width: 750, height: 500 },
      { width: 320, height: 240 },
      8,
    )).toEqual({ top: 41, left: 196 });

    expect(clampPopoverPosition(
      { top: 5, bottom: 33, left: 700, right: 730 },
      { width: 750, height: 500 },
      { width: 320, height: 240 },
      8,
    )).toEqual({ top: 41, left: 422 });
  });
});
