import { describe, expect, it } from "vitest";
import {
  DESKTOP_HIDEABLE_SPACES,
  DESKTOP_HIDDEN_SPACES_KEY,
  DESKTOP_PRIMARY_SPACES,
  isDesktopHideableSpace,
  isDesktopPrimarySpace,
} from "./spaceVisibility";

describe("桌面空间关闭（仅日记 / AI 写作）", () => {
  it("可关闭集合只有日记与 AI 写作；知识库/小记/标签不可关闭", () => {
    expect([...DESKTOP_HIDEABLE_SPACES]).toEqual(["ai-writing", "diary"]);
    expect(isDesktopHideableSpace("diary")).toBe(true);
    expect(isDesktopHideableSpace("ai-writing")).toBe(true);
    expect(isDesktopHideableSpace("library")).toBe(false);
    expect(isDesktopHideableSpace("quick-notes")).toBe(false);
    expect(isDesktopHideableSpace("tags")).toBe(false);
  });

  it("一级空间 = ⌘1–5 的五项；回收站/资源不算", () => {
    expect([...DESKTOP_PRIMARY_SPACES]).toEqual(["library", "quick-notes", "tags", "ai-writing", "diary"]);
    expect(isDesktopPrimarySpace("trash")).toBe(false);
    expect(isDesktopPrimarySpace("resources")).toBe(false);
  });

  it("设备本地键不参与同步（独立 localStorage 键）", () => {
    expect(DESKTOP_HIDDEN_SPACES_KEY).toBe("lakex-local-notes-v3.hidden-spaces");
  });
});
