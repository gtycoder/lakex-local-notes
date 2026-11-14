import { describe, expect, it } from "vitest";
import { isSpaceVisible, resolveVisibleSpace, sanitizeHiddenSpaces, visibleSpaces } from "./hiddenSpaces";

const ORDER = ["library", "quick-notes", "diary", "ai-writing", "tags"] as const;
const HIDEABLE = ["diary", "ai-writing"] as const;

describe("一级空间关闭（隐藏入口）判据（261114）", () => {
  it("存档值只保留合法 + 去重；非法/未知 id 丢弃", () => {
    expect(sanitizeHiddenSpaces(["diary", "diary", "tags", 1, null, "nope"], HIDEABLE)).toEqual(["diary"]);
    expect(sanitizeHiddenSpaces("diary", HIDEABLE)).toEqual([]);
    expect(sanitizeHiddenSpaces(undefined, HIDEABLE)).toEqual([]);
  });

  it("可见空间 = 定义顺序 − 隐藏项（顺序不重排）", () => {
    expect(visibleSpaces(ORDER, ["diary", "ai-writing"])).toEqual(["library", "quick-notes", "tags"]);
    expect(visibleSpaces(ORDER, ["ai-writing"])).toEqual(["library", "quick-notes", "diary", "tags"]);
    expect(isSpaceVisible("library", ["diary"])).toBe(true);
    expect(isSpaceVisible("diary", ["diary"])).toBe(false);
  });

  it("落点被关闭 ⇒ 回落到第一个可见空间", () => {
    expect(resolveVisibleSpace("diary", ORDER, ["diary"])).toBe("library");
    expect(resolveVisibleSpace("ai-writing", ORDER, ["ai-writing"])).toBe("library");
    expect(resolveVisibleSpace("tags", ORDER, ["diary"])).toBe("tags");
  });
});
