import { describe, expect, it } from "vitest";
import { shouldBlockCanvasWheel, shouldRestoreDocumentScrollAfterBoardChange, shouldSkipBoardCardFocus } from "./canvasInteractionGate";

describe("canvas interaction gate", () => {
  it("blocks embedded wheel handlers while passive", () => {
    expect(shouldBlockCanvasWheel(false)).toBe(true);
    expect(shouldBlockCanvasWheel(true)).toBe(false);
  });

  it("does not arm document scroll restoration for selection-only updates", () => {
    expect(shouldRestoreDocumentScrollAfterBoardChange(false)).toBe(false);
    expect(shouldRestoreDocumentScrollAfterBoardChange(true)).toBe(true);
  });

  it("skips outer card focus for clicks inside an active board", () => {
    expect(shouldSkipBoardCardFocus(true, true)).toBe(true);
    expect(shouldSkipBoardCardFocus(true, false)).toBe(false);
    expect(shouldSkipBoardCardFocus(false, true)).toBe(false);
  });
});
