// @vitest-environment jsdom
/**
 * 261122 真机现场：小记编辑态是「文字上、图片下」，列表卡却把首图当封面画在标题上方 ⇒ 顺序反了。
 * 判据：**只有正文首块是媒体**时列表卡才画封面；文字在前的卡片必须按正文顺序渲染。
 * 这里钉 HomePage 的接线（封面门槛 + 隐藏首图只在画了封面时生效）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HOME = readFileSync(process.cwd() + "/src/mobile/home/HomePage.tsx", "utf8");

describe("小记列表卡封面顺序（261122）", () => {
  it("封面门槛 = 正文首块是媒体（quickNoteStartsWithMedia(note.body)）", () => {
    expect(HOME).toContain("quickNoteStartsWithMedia(note.body)");
    expect(HOME).toContain("const thumbUrl = leadingMedia && note.firstImage");
  });

  it("封面只在 thumbUrl 存在时渲染（文字在前的卡片不画封面）", () => {
    expect(HOME).toContain("{thumbUrl && (");
    expect(HOME).toContain('className="qn-card__cover"');
  });

  it("首图隐藏只在封面画了时生效（否则图片按正文原位展示）", () => {
    expect(HOME).toContain("hiddenMediaNames={thumbUrl && note.firstImage ? new Set([note.firstImage]) : undefined}");
    // 有图且无封面 ⇒ 仍用恒定媒体槽，避免卡高变化
    expect(HOME).toContain('slotFrame={note.imageCount > (thumbUrl ? 1 : 0) ? "media" : "text"}');
  });
});
