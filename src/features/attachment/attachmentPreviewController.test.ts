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
