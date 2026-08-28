import { describe, expect, it } from "vitest";
import { shouldAcceptEditorChange } from "./editorChangeGuard";

describe("shouldAcceptEditorChange", () => {
  it("rejects initialization callbacks", () => {
    expect(shouldAcceptEditorChange({ initializing: true, previous: "<p>x</p>", next: "<p>y</p>" })).toBe(false);
  });

  it("rejects repeated content callbacks", () => {
    expect(shouldAcceptEditorChange({ initializing: false, previous: "<p>x</p>", next: "<p>x</p>" })).toBe(false);
  });

  it("accepts a real content change", () => {
    expect(shouldAcceptEditorChange({ initializing: false, previous: "<p>x</p>", next: "<p>y</p>" })).toBe(true);
  });
});
