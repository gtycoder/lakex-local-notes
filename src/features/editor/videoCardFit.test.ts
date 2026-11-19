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
    expect(css).toContain('ne-card[data-card-name="image"]');
    expect(css).not.toContain("max-height: min(72vh, 720px)");
    expect(css).not.toContain(".ne-card-video-content { height: 450px");
  });

  it("桌面保留拖拽缩放把手（边缘长条 + 角点 + ew/nwse 光标）", () => {
    expect(DESKTOP).toContain(".lake-media-resize-handle");
    expect(DESKTOP).toContain("cursor: ew-resize");
    expect(DESKTOP).toContain("cursor: nwse-resize");
  });

  it("移动端把手族已删（261119 用户裁决：移动端禁用图片/视频拖拽缩放）", () => {
    // 断言跑在去注释后的规则文本上（注释里会提到把手族名）。
    const rules = MOBILE.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toContain(".lake-media-resize-handle");
    expect(rules).not.toContain(".lake-media-resize-box");
    expect(rules).not.toContain("lake-media-resizing");
    // CSS 兜底保留：内核原生四角拖拽 resizer 继续整组隐藏，不得回流。
    expect(rules).toContain(".ne-ui-image-resizer-handler");
    expect(rules).toMatch(/\.ne-ui-image-resizer-handler[^}]*display: none/);
  });
});
