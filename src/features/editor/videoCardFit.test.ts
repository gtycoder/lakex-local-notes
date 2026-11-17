import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DESKTOP = readFileSync(new URL("../../styles/feature.css", import.meta.url), "utf8");
const MOBILE = readFileSync(new URL("../../mobile/editor/edit-surface-kernel.css", import.meta.url), "utf8");

describe("Lakex 视频卡自适应", () => {
  it.each([
    ["desktop", DESKTOP],
    ["mobile", MOBILE],
  ])("%s 完成态按视频 intrinsic ratio 收窄，支持持久化缩放与三档对齐", (_label, css) => {
    expect(css).toContain(".ne-card-video-content.ne-card-video-done");
    expect(css).toContain("width: fit-content");
    expect(css).toContain("height: auto");
    expect(css).toContain('ne-card[data-card-name="video"]:has(.ne-card-video-done)');
    expect(css).toContain("var(--lake-video-max-width, 100%)");
    expect(css).toContain('data-video-align="center"');
    expect(css).toContain('data-video-align="right"');
    expect(css).toContain(".lake-media-resize-handle");
    expect(css).toContain('ne-card[data-card-name="image"]');
    expect(css).toContain("cursor: col-resize");
    expect(css).not.toContain("max-height: min(72vh, 720px)");
    expect(css).not.toContain(".ne-card-video-content { height: 450px");
  });
});
