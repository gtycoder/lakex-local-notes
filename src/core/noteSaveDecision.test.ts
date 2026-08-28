import { describe, expect, it } from "vitest";
import { hasNoteSaveChanges } from "./noteSaveDecision";

describe("hasNoteSaveChanges", () => {
  it("ignores cache-only or repeated saves", () => {
    expect(hasNoteSaveChanges(
      { title: "标题", content: "<p>正文</p>" },
      { title: "标题", content: "<p>正文</p>" },
    )).toBe(false);
  });

  it("accepts a real title or body change", () => {
    expect(hasNoteSaveChanges(
      { title: "标题", content: "<p>正文</p>" },
      { title: "新标题", content: "<p>正文</p>" },
    )).toBe(true);
    expect(hasNoteSaveChanges(
      { title: "标题", content: "<p>正文</p>" },
      { title: "标题", content: "<p>新正文</p>" },
    )).toBe(true);
  });
});
