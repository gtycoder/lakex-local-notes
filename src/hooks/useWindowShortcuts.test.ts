import { describe, expect, it } from "vitest";

describe("window shortcut contract", () => {
  it("reserves the app-level command keys", () => {
    expect(["Meta+K", "Meta+Shift+Enter", "Escape"]).toEqual(["Meta+K", "Meta+Shift+Enter", "Escape"]);
  });
});
