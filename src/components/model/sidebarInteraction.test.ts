import { describe, expect, it } from "vitest";

import { shouldCollapseSidebarOnHoverLeave, shouldKeepSidebarPreviewOpen } from "./sidebarInteraction";

const SIDEBAR_HOVER_HIDE_DELAY_MS = 120;

describe("sidebar hover interaction", () => {
  it("uses a short leave grace period", () => {
    expect(SIDEBAR_HOVER_HIDE_DELAY_MS).toBe(120);
  });
});


describe("sidebar mode guard", () => {
  it("only collapses a floating sidebar, never a docked sidebar", () => {
    expect(shouldCollapseSidebarOnHoverLeave("floating")).toBe(true);
    expect(shouldCollapseSidebarOnHoverLeave("docked")).toBe(false);
    expect(shouldCollapseSidebarOnHoverLeave("collapsed")).toBe(false);
  });
});


describe("sidebar resize interaction", () => {
  it("keeps a floating sidebar open while its resize handle owns the pointer", () => {
    expect(shouldKeepSidebarPreviewOpen("floating", true)).toBe(true);
    expect(shouldKeepSidebarPreviewOpen("floating", false)).toBe(false);
    expect(shouldKeepSidebarPreviewOpen("docked", true)).toBe(false);
  });
});
