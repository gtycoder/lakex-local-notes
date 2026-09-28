import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildAttachmentPreviewItem,
  closeAttachmentPreview,
  openAttachmentPreview,
  subscribeAttachmentPreview,
} from "./attachmentPreviewController.js";

describe("attachmentPreviewController", () => {
  it("builds preview item with parsed ref and kind", () => {
    const item = buildAttachmentPreviewItem(
      "http://127.0.0.1:19876/note-abc/1787733338672_a1b2c3d4.pdf",
      "需求文档.pdf",
      2048,
    );
    expect(item.ref).toEqual({ space: "note", noteId: "note-abc", filename: "1787733338672_a1b2c3d4.pdf" });
    expect(item.kind).toBe("pdf");
    expect(item.size).toBe(2048);
  });

  it("falls back to other kind for unknown src", () => {
    const item = buildAttachmentPreviewItem("https://example.com/x.xyz", "x.xyz", 10);
    expect(item.ref).toBeNull();
    expect(item.kind).toBe("other");
  });

  it("open/close notifies subscribers with platform handlers", () => {
    const listener = vi.fn();
    const unsub = subscribeAttachmentPreview(listener);
    const item = buildAttachmentPreviewItem("http://127.0.0.1:19876/n/1.mp4", "v.mp4", 100);
    const onOpen = vi.fn();
    const onShow = vi.fn();
    openAttachmentPreview(item, onOpen, onShow);
    expect(listener).toHaveBeenLastCalledWith({ item, onOpen, onShowInFolder: onShow });
    closeAttachmentPreview();
    expect(listener).toHaveBeenLastCalledWith(null);
    unsub();
  });
});

describe("附件预览层（源码级围栏）", () => {
  const PREVIEW_CSS = readFileSync(new URL("./attachment-preview.css", import.meta.url), "utf8");
  const PREVIEW_TSX = readFileSync(new URL("./AttachmentPreview.tsx", import.meta.url), "utf8");

  it("表面与图片 Lightbox 同源：图片/视频/音频统一浅色背景（260928 用户要求）", () => {
    // 与 image-lightbox.css 的 .image-lightbox 同一套表面：淡遮罩 + 背景模糊
    expect(PREVIEW_CSS).toMatch(/\.attachment-preview \{[^}]*background: var\(--lake-media-scrim\)/);
    expect(PREVIEW_CSS).toMatch(/\.attachment-preview \{[^}]*backdrop-filter: blur\(14px\)/);
    // 不能再用「媒体暗底」令牌做整层背景（那是视频/音频黑底的来源）
    expect(PREVIEW_CSS).not.toMatch(/\.attachment-preview \{[^}]*background: var\(--lake-media-surface\)/);
    // 工具栏随之走浅色，否则浅底上是深色条、文字还沿用浅色令牌
    expect(PREVIEW_CSS).toMatch(/\.attachment-preview__toolbar \{[^}]*background: var\(--lake-bg-panel\)/);
    expect(PREVIEW_CSS).not.toMatch(/\.attachment-preview__toolbar \{[^}]*color: var\(--lake-media-on\)/);
  });

  it("macOS 红绿灯让位：预览铺满整窗时标题不能钻到系统按钮底下（260928 用户报）", () => {
    expect(PREVIEW_CSS).toMatch(/\.attachment-preview\.is-mac \.attachment-preview__toolbar \{[^}]*padding-left: 82px/);
    expect(PREVIEW_TSX).toMatch(/is-mac/);
    // portal 到 body ⇒ 拿不到壳上的 .platform-mac，组件必须自己判定平台
    expect(PREVIEW_TSX).toMatch(/\/Mac\|iPhone\|iPad\//);
  });
});
